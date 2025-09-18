/**
 * Process Lifecycle Module
 *
 * Provides comprehensive process lifecycle management including:
 * - Signal handling (SIGTERM, SIGINT, SIGHUP, SIGUSR1, SIGUSR2)
 * - Graceful shutdown orchestration
 * - Error handling (uncaught exceptions, unhandled rejections)
 * - Resource cleanup management
 * - Health checks and readiness probes
 * - Application state transitions
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import { Token, createToken, Injectable } from '@omnitron-dev/nexus';

import { IModule, IApplication } from '../../types.js';
import { ILogger } from '../logger.module.js';
import { ConfigModule } from '../config/config.module.js';
import {
  IProcessLifecycleConfig,
  IShutdownTask,
  ShutdownReason,
  ProcessSignal,
  IProcessMetrics,
  ILifecycleEvent,
  LifecycleState,
  ShutdownPriority
} from './types.js';

export const ProcessLifecycleToken: Token<ProcessLifecycleModule> = createToken<ProcessLifecycleModule>('ProcessLifecycleModule');

/**
 * Default configuration for process lifecycle
 */
const DEFAULT_CONFIG: IProcessLifecycleConfig = {
  shutdownTimeout: 30000, // 30 seconds
  enableGracefulShutdown: true,
  handleUncaughtExceptions: true,
  handleUnhandledRejections: true,
  handleSignals: ['SIGTERM', 'SIGINT', 'SIGHUP'],
  exitOnError: true,
  logLevel: 'info',
  healthCheckInterval: 30000, // 30 seconds
  enableHealthChecks: true,
  forceKillTimeout: 5000, // 5 seconds after graceful timeout
};

/**
 * Process Lifecycle Module Implementation
 */
@Injectable()
export class ProcessLifecycleModule implements IModule {
  readonly name = 'process-lifecycle';
  readonly version = '1.0.0';

  private readonly eventEmitter = new EventEmitter();
  private readonly shutdownTasks = new Map<string, IShutdownTask>();
  private readonly signalHandlers = new Map<string, (...args: any[]) => any>();
  private readonly cleanupHandlers = new Set<() => Promise<void> | void>();

  private config: IProcessLifecycleConfig;
  private state: LifecycleState = LifecycleState.Created;
  private isShuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;
  private startTime: number = Date.now();
  private application?: IApplication;

  constructor(
    private readonly logger?: ILogger,
    private readonly configModule?: ConfigModule
  ) {
    this.config = DEFAULT_CONFIG;

    // Load configuration if available
    if (this.configModule) {
      const customConfig = this.configModule.get<Partial<IProcessLifecycleConfig>>('processLifecycle');
      if (customConfig) {
        this.config = { ...DEFAULT_CONFIG, ...customConfig };
      }
    }
  }

  /**
   * Initialize the module
   */
  async initialize(app: IApplication): Promise<void> {
    this.application = app;
    this.state = LifecycleState.Initializing;

    this.logger?.info('Initializing Process Lifecycle Module');

    // Register default shutdown tasks
    this.registerDefaultShutdownTasks();

    // Setup signal handlers if enabled
    if (this.config.enableGracefulShutdown) {
      this.setupSignalHandlers();
    }

    // Setup error handlers
    if (this.config.handleUncaughtExceptions) {
      this.setupUncaughtExceptionHandler();
    }

    if (this.config.handleUnhandledRejections) {
      this.setupUnhandledRejectionHandler();
    }

    this.state = LifecycleState.Initialized;
    this.emit('initialized');
  }

  /**
   * Start the module
   */
  async start(): Promise<void> {
    this.state = LifecycleState.Starting;
    this.startTime = Date.now();

    this.logger?.info('Process Lifecycle Module started');

    this.state = LifecycleState.Running;
    this.emit('started');
  }

  /**
   * Stop the module
   */
  async stop(): Promise<void> {
    if (this.state !== LifecycleState.Running) {
      return;
    }

    this.state = LifecycleState.Stopping;

    // Cleanup signal handlers
    this.cleanupSignalHandlers();

    // Run cleanup handlers
    await this.runCleanupHandlers();

    this.state = LifecycleState.Stopped;
    this.emit('stopped');
  }

  /**
   * Register a shutdown task
   */
  registerShutdownTask(task: IShutdownTask): void {
    if (!task.id) {
      task.id = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // Set default priority if not provided
    if (task.priority === undefined) {
      task.priority = ShutdownPriority.Normal;
    }

    this.shutdownTasks.set(task.id, task);
    this.logger?.debug({ taskId: task.id, taskName: task.name }, 'Registered shutdown task');
  }

  /**
   * Unregister a shutdown task
   */
  unregisterShutdownTask(taskId: string): void {
    this.shutdownTasks.delete(taskId);
  }

  /**
   * Register a cleanup handler
   */
  registerCleanup(handler: () => Promise<void> | void): void {
    this.cleanupHandlers.add(handler);
  }

  /**
   * Perform graceful shutdown
   */
  async shutdown(reason: ShutdownReason, details?: any): Promise<void> {
    // Prevent multiple concurrent shutdowns
    if (this.isShuttingDown) {
      return this.shutdownPromise!;
    }

    this.isShuttingDown = true;
    this.state = LifecycleState.ShuttingDown;

    this.logger?.info({ reason, details }, 'Starting graceful shutdown');
    this.emit('shutdown:start', { reason, details });

    // Create shutdown promise with timeout
    this.shutdownPromise = this.executeShutdown(reason, details);

    // Add timeout
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Shutdown timeout after ${this.config.shutdownTimeout}ms`));
      }, this.config.shutdownTimeout);
    });

    try {
      await Promise.race([this.shutdownPromise, timeoutPromise]);

      this.logger?.info('Graceful shutdown completed successfully');
      this.emit('shutdown:complete', { reason, success: true });

      // Exit process if configured
      if (this.config.exitOnError && reason !== ShutdownReason.Manual) {
        process.exit(0);
      }
      return;
    } catch (error) {
      this.logger?.error({ error }, 'Graceful shutdown failed or timed out');
      this.emit('shutdown:error', { reason, error });

      // Force exit after additional timeout
      if (this.config.forceKillTimeout > 0) {
        setTimeout(() => {
          this.logger?.fatal('Force killing process after timeout');
          process.exit(1);
        }, this.config.forceKillTimeout);
      } else {
        process.exit(1);
      }
      throw error; // Re-throw to match Promise<void> expectation
    }
  }

  /**
   * Execute shutdown tasks
   */
  private async executeShutdown(reason: ShutdownReason, details?: any): Promise<void> {
    // Sort tasks by priority (lower numbers first)
    const sortedTasks = Array.from(this.shutdownTasks.values())
      .sort((a, b) => (a.priority || 50) - (b.priority || 50));

    // Execute tasks in priority order
    for (const task of sortedTasks) {
      try {
        this.logger?.debug({ taskName: task.name }, 'Executing shutdown task');

        // Create task promise with optional timeout
        let taskPromise = Promise.resolve(task.handler(reason, details));

        if (task.timeout) {
          const timeoutPromise = new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error(`Task timeout: ${task.name}`)), task.timeout);
          });
          taskPromise = Promise.race([taskPromise, timeoutPromise]);
        }

        await taskPromise;

        this.logger?.debug({ taskName: task.name }, 'Shutdown task completed');
        this.emit('shutdown:task:complete', { task: task.name });

      } catch (error) {
        this.logger?.error({ error, taskName: task.name }, 'Shutdown task failed');
        this.emit('shutdown:task:error', { task: task.name, error });

        // Continue with other tasks even if one fails
        if (!task.critical) {
          continue;
        } else {
          // Critical task failed, abort shutdown
          throw new Error(`Critical shutdown task failed: ${task.name}`);
        }
      }
    }

    // Stop the application if available
    if (this.application) {
      await this.application.stop({
        timeout: this.config.shutdownTimeout,
        signal: details?.signal
      });
    }

    return this.shutdownPromise!;
  }

  /**
   * Register default shutdown tasks
   */
  private registerDefaultShutdownTasks(): void {
    // Flush logs
    this.registerShutdownTask({
      id: 'flush-logs',
      name: 'Flush Logs',
      priority: ShutdownPriority.Last,
      handler: async () => {
        this.logger?.info('Flushing logs');
        // Give time for logs to flush
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    });

    // Close active connections
    this.registerShutdownTask({
      id: 'close-connections',
      name: 'Close Active Connections',
      priority: ShutdownPriority.High,
      handler: async () => {
        this.logger?.info('Closing active connections');
        // This will be handled by individual modules
      }
    });

    // Save application state
    this.registerShutdownTask({
      id: 'save-state',
      name: 'Save Application State',
      priority: ShutdownPriority.VeryHigh,
      handler: async () => {
        this.logger?.info('Saving application state');
        this.emit('state:save');
      }
    });
  }

  /**
   * Setup signal handlers
   */
  private setupSignalHandlers(): void {
    for (const signal of this.config.handleSignals) {
      const handler = () => this.handleSignal(signal as ProcessSignal);
      this.signalHandlers.set(signal, handler);
      process.on(signal as any, handler);
      this.logger?.debug({ signal }, 'Registered signal handler');
    }
  }

  /**
   * Handle process signal
   */
  private handleSignal(signal: ProcessSignal): void {
    this.logger?.info({ signal }, 'Received process signal');
    this.emit('signal', { signal });

    // Map signals to shutdown reasons
    let reason: ShutdownReason;
    switch (signal) {
      case 'SIGTERM':
        reason = ShutdownReason.SIGTERM;
        break;
      case 'SIGINT':
        reason = ShutdownReason.SIGINT;
        break;
      case 'SIGHUP':
        // SIGHUP typically means reload config, but we'll treat as shutdown
        reason = ShutdownReason.Reload;
        break;
      default:
        reason = ShutdownReason.Signal;
    }

    // Initiate shutdown
    this.shutdown(reason, { signal }).catch(error => {
      this.logger?.fatal({ error }, 'Failed to handle signal');
      process.exit(1);
    });
  }

  /**
   * Setup uncaught exception handler
   */
  private setupUncaughtExceptionHandler(): void {
    const handler = (error: Error) => {
      this.logger?.fatal({ error }, 'Uncaught exception');
      this.emit('uncaughtException', { error });

      // Initiate shutdown
      this.shutdown(ShutdownReason.UncaughtException, { error }).catch(err => {
        this.logger?.fatal({ error: err }, 'Failed to handle uncaught exception');
        process.exit(1);
      });
    };

    this.signalHandlers.set('uncaughtException', handler);
    process.on('uncaughtException', handler);
  }

  /**
   * Setup unhandled rejection handler
   */
  private setupUnhandledRejectionHandler(): void {
    const handler = (reason: any, promise: Promise<any>) => {
      this.logger?.error({ reason, promise }, 'Unhandled promise rejection');
      this.emit('unhandledRejection', { reason, promise });

      // Only shutdown if configured (some apps may want to continue)
      if (this.config.exitOnError) {
        this.shutdown(ShutdownReason.UnhandledRejection, { reason, promise }).catch(error => {
          this.logger?.fatal({ error }, 'Failed to handle unhandled rejection');
          process.exit(1);
        });
      }
    };

    this.signalHandlers.set('unhandledRejection', handler);
    process.on('unhandledRejection', handler);
  }

  /**
   * Cleanup signal handlers
   */
  private cleanupSignalHandlers(): void {
    for (const [event, handler] of this.signalHandlers.entries()) {
      process.removeListener(event as any, handler as any);
    }
    this.signalHandlers.clear();
  }

  /**
   * Run cleanup handlers
   */
  private async runCleanupHandlers(): Promise<void> {
    for (const handler of this.cleanupHandlers) {
      try {
        await handler();
      } catch (error) {
        this.logger?.error({ error }, 'Cleanup handler failed');
      }
    }
    this.cleanupHandlers.clear();
  }

  /**
   * Emit lifecycle event
   */
  private emit(event: string, data?: any): void {
    const lifecycleEvent: ILifecycleEvent = {
      type: event,
      timestamp: Date.now(),
      data
    };
    this.eventEmitter.emit(event, lifecycleEvent);
  }

  /**
   * Subscribe to lifecycle events
   */
  on(event: string, handler: (event: ILifecycleEvent) => void): void {
    this.eventEmitter.on(event, handler);
  }

  /**
   * Get process metrics
   */
  getMetrics(): IProcessMetrics {
    return {
      uptime: Date.now() - this.startTime,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      pid: process.pid,
      ppid: process.ppid,
      platform: process.platform,
      nodeVersion: process.version,
      state: this.state,
      shutdownTasksCount: this.shutdownTasks.size,
      cleanupHandlersCount: this.cleanupHandlers.size
    };
  }

  /**
   * Get current lifecycle state
   */
  getState(): LifecycleState {
    return this.state;
  }

  /**
   * Check if shutting down
   */
  isShuttingDownNow(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Force immediate shutdown (emergency use only)
   */
  forceShutdown(code: number = 1): void {
    this.logger?.fatal(`Force shutdown with code ${code}`);
    process.exit(code);
  }
}

// Export convenience function for registering shutdown tasks
export function onShutdown(
  name: string,
  handler: (reason: ShutdownReason) => Promise<void> | void,
  priority: number = ShutdownPriority.Normal
): void {
  // This will be connected to the module instance when available
  // For now, we store them for later registration
  if (!global.__titanShutdownTasks) {
    global.__titanShutdownTasks = [];
  }
  global.__titanShutdownTasks.push({ name, handler, priority });
}