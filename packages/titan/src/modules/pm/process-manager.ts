/**
 * Process Manager Implementation
 *
 * Core class that manages process lifecycle, spawning processes as Netron services,
 * and providing type-safe inter-process communication.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import path from 'path';

import { Injectable } from '../../decorators/index.js';
import type { ILogger } from '../logger/logger.types.js';

import type {
  IProcessManager,
  IProcessOptions,
  IProcessInfo,
  ServiceProxy,
  IProcessPool,
  IProcessPoolOptions,
  IProcessMetrics,
  IHealthStatus,
  IProcessManagerConfig,
  ISupervisorOptions,
  IProcessMetadata
} from './types.js';

import { ProcessStatus } from './types.js';

import { PROCESS_METADATA_KEY } from './decorators.js';
import { ProcessPool } from './process-pool.js';
// import { EnhancedProcessPool } from './process-pool-enhanced.js';
import { ProcessSupervisor } from './process-supervisor.js';
import { ProcessWorkflow } from './process-workflow.js';
import { ServiceProxyHandler } from './service-proxy.js';
import { ProcessSpawnerFactory } from './process-spawner.js';
import type { IProcessSpawner } from './types.js';
import { ProcessRegistry } from './process-registry.js';
import { ProcessMetricsCollector } from './process-metrics.js';
import { ProcessHealthChecker } from './process-health.js';

/**
 * Main Process Manager implementation
 */
@Injectable()
export class ProcessManager extends EventEmitter implements IProcessManager {
  private processes = new Map<string, IProcessInfo>();
  private workers = new Map<string, any>(); // Now stores IWorkerHandle
  private serviceProxies = new Map<string, any>();
  private isShuttingDown = false;

  private readonly registry: ProcessRegistry;
  private readonly spawner: IProcessSpawner;
  private readonly metricsCollector: ProcessMetricsCollector;
  private readonly healthChecker: ProcessHealthChecker;

  constructor(
    private readonly logger: ILogger,
    private readonly config: IProcessManagerConfig = {}
  ) {
    super();

    // Initialize sub-components
    this.registry = new ProcessRegistry();

    // Use factory to create appropriate spawner
    this.spawner = ProcessSpawnerFactory.create(this.logger, this.config);

    this.metricsCollector = new ProcessMetricsCollector(this.logger);
    this.healthChecker = new ProcessHealthChecker(this.logger);

    // Setup shutdown handlers only in production
    if (process.env['NODE_ENV'] !== 'test') {
      this.setupShutdownHandlers();
    }
  }

  /**
   * Spawn a new process as a Netron service
   */
  async spawn<T>(
    processPathOrClass: string | (new (...args: any[]) => T),
    options: IProcessOptions = {}
  ): Promise<ServiceProxy<T>> {
    const processId = randomUUID();

    // Handle both string path and class
    let ProcessClass: (new (...args: any[]) => T) | null = null;
    let processName: string;

    if (typeof processPathOrClass === 'string') {
      // File path case - we'll use the name from options or derive from path
      processName = options.name || path.basename(processPathOrClass, '.js');
    } else {
      // Class constructor case
      ProcessClass = processPathOrClass;
      processName = ProcessClass.name;
    }

    const processMetadata = ProcessClass ? this.getProcessMetadata(ProcessClass) : undefined;
    const mergedOptions = this.mergeOptions(processMetadata, options);

    // Create process info
    const processInfo: IProcessInfo = {
      id: processId,
      name: mergedOptions.name || processName,
      status: ProcessStatus.PENDING,
      startTime: Date.now(),
      restartCount: 0
    };

    this.processes.set(processId, processInfo);

    try {
      // Update status
      processInfo.status = ProcessStatus.STARTING;
      this.emit('process:spawn', processInfo);

      // Spawn the process with unified interface
      const handle = await this.spawner.spawn(processPathOrClass, {
        processId,
        name: mergedOptions.name,
        version: mergedOptions.version,
        config: mergedOptions,  // Pass whole options as config
        transport: mergedOptions.netron?.transport as any,
        host: mergedOptions.netron?.host,
        isolation: mergedOptions.security?.isolation as any
      });

      // Store references
      this.workers.set(processId, handle);
      (processInfo as any).transportUrl = handle.transportUrl;

      // Check if worker is already running
      if (handle.status === ProcessStatus.RUNNING) {
        processInfo.status = ProcessStatus.RUNNING;
      } else {
        // Wait for process to be ready
        await this.waitForProcessReady(processId);
      }

      // Use proxy from handle if available
      const proxy = handle.proxy || await this.createServiceProxy<T>(
        ProcessClass || {} as any,  // Pass empty object if using file path
        processId,
        null,
        mergedOptions
      );

      this.serviceProxies.set(processId, proxy);

      // Register in the registry for discovery
      this.registry.register(processInfo);

      // Update status
      processInfo.status = ProcessStatus.RUNNING;
      processInfo.pid = (handle as any).pid || process.pid;
      this.emit('process:ready', processInfo);

      // Setup monitoring
      if (mergedOptions.health?.enabled) {
        this.healthChecker.startMonitoring(processId, proxy, mergedOptions.health);
      }

      if (mergedOptions.observability?.metrics) {
        this.metricsCollector.startCollection(processId, proxy);
      }

      return proxy;
    } catch (error) {
      processInfo.status = ProcessStatus.FAILED;
      processInfo.errors = [error as Error];
      this.emit('process:crash', processInfo, error);
      throw error;
    }
  }

  /**
   * Create a process pool for load balancing
   */
  async pool<T>(
    processPathOrClass: string | (new (...args: any[]) => T),
    options: IProcessPoolOptions = {}
  ): Promise<IProcessPool<T>> {
    const pool = new ProcessPool<T>(
      this,
      processPathOrClass,
      options,
      this.logger
    );

    await pool.initialize();

    // Create a proxy that allows direct method calls on the pool
    return new Proxy(pool, {
      get(target, property: string | symbol) {
        // Return pool properties and methods if they exist
        if (property in target) {
          return (target as any)[property];
        }

        // Prevent the proxy from being treated as a Promise
        if (property === 'then' || property === 'catch' || property === 'finally') {
          return undefined;
        }

        // For unknown properties, create a function that executes through the pool
        if (typeof property === 'string' && property !== 'constructor') {
          return async (...args: any[]) => target.execute(property, ...args);
        }

        return undefined;
      }
    }) as IProcessPool<T>;
  }

  /**
   * Discover a service by name
   *
   * Note: This only checks local registry. For distributed discovery,
   * use the Discovery module at the application level or implement
   * discovery within your process logic.
   */
  async discover<T>(serviceName: string): Promise<ServiceProxy<T> | null> {
    // Check local registry
    const localProcess = this.registry.findByServiceName(serviceName);
    if (localProcess) {
      return this.serviceProxies.get(localProcess.id) as ServiceProxy<T>;
    }

    // For remote discovery, processes should use the Discovery module
    // or implement their own discovery mechanism
    return null;
  }

  /**
   * Create a workflow
   */
  async workflow<T>(WorkflowPathOrClass: string | (new () => T)): Promise<T> {
    // For now, workflows must be classes, not file paths
    if (typeof WorkflowPathOrClass === 'string') {
      throw new Error('Workflow file paths are not yet supported. Please pass the workflow class directly.');
    }

    const workflow = new ProcessWorkflow<T>(
      this,
      WorkflowPathOrClass,
      this.logger
    );

    return workflow.create();
  }

  /**
   * Create a supervisor tree
   */
  async supervisor(
    SupervisorClass: new () => any,
    options: ISupervisorOptions = {}
  ): Promise<any> {
    const supervisor = new ProcessSupervisor(
      this,
      SupervisorClass,
      options,
      this.logger
    );

    await supervisor.start();
    return supervisor;
  }

  /**
   * Get process information
   */
  getProcess(processId: string): IProcessInfo | undefined {
    return this.processes.get(processId);
  }

  /**
   * List all processes
   */
  listProcesses(): IProcessInfo[] {
    return Array.from(this.processes.values());
  }

  /**
   * Kill a process
   */
  async kill(processId: string, signal: string = 'SIGTERM'): Promise<boolean> {
    const processInfo = this.processes.get(processId);
    if (!processInfo) {
      return false;
    }

    processInfo.status = ProcessStatus.STOPPING;
    this.emit('process:stop', processInfo);

    try {
      // Cleanup proxy
      const proxy = this.serviceProxies.get(processId);
      if (proxy && '__destroy' in proxy) {
        await (proxy as any).__destroy();
      }

      // Stop monitoring
      this.healthChecker.stopMonitoring(processId);
      this.metricsCollector.stopCollection(processId);

      // Terminate worker handle
      const handle = this.workers.get(processId);
      if (handle && 'terminate' in handle) {
        await handle.terminate();
      }

      // Cleanup references
      this.workers.delete(processId);
      this.serviceProxies.delete(processId);

      // Unregister from registry
      this.registry.unregister(processId);

      // Update status
      processInfo.status = ProcessStatus.STOPPED;
      processInfo.endTime = Date.now();

      return true;
    } catch (error) {
      this.logger.error({ error, processId }, 'Failed to kill process');
      processInfo.status = ProcessStatus.FAILED;
      processInfo.errors = [...(processInfo.errors || []), error as Error];
      return false;
    }
  }

  /**
   * Get metrics for a process
   */
  async getMetrics(processId: string): Promise<IProcessMetrics | null> {
    const proxy = this.serviceProxies.get(processId);
    if (!proxy || !('__getMetrics' in proxy)) {
      return null;
    }

    try {
      return await (proxy as any).__getMetrics();
    } catch (error) {
      this.logger.error({ error, processId }, 'Failed to get process metrics');
      return null;
    }
  }

  /**
   * Get health status
   */
  async getHealth(processId: string): Promise<IHealthStatus | null> {
    const proxy = this.serviceProxies.get(processId);
    if (!proxy || !('__getHealth' in proxy)) {
      return null;
    }

    try {
      return await (proxy as any).__getHealth();
    } catch (error) {
      this.logger.error({ error, processId }, 'Failed to get process health');
      return null;
    }
  }

  /**
   * Shutdown all processes
   */
  async shutdown(options: { timeout?: number; force?: boolean } = {}): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    const { timeout = 30000, force = false } = options;

    this.logger.info('Shutting down Process Manager');

    const shutdownPromises = Array.from(this.processes.keys()).map(processId =>
      this.kill(processId, force ? 'SIGKILL' : 'SIGTERM')
    );

    try {
      await Promise.race([
        Promise.all(shutdownPromises),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Shutdown timeout')), timeout)
        )
      ]);
    } catch (error) {
      if (force) {
        // Force kill all processes
        for (const processId of this.processes.keys()) {
          await this.kill(processId, 'SIGKILL');
        }
      } else {
        throw error;
      }
    }

    this.logger.info('Process Manager shutdown complete');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Get process metadata from decorators
   */
  private getProcessMetadata(ProcessClass: any): IProcessMetadata | undefined {
    return Reflect.getMetadata(PROCESS_METADATA_KEY, ProcessClass);
  }

  /**
   * Merge process options
   */
  private mergeOptions(
    metadata: IProcessMetadata | undefined,
    options: IProcessOptions
  ): IProcessOptions {
    return {
      // Set memory limit from PM config if not specified
      memory: {
        limit: this.config.resources?.maxMemory,
        ...metadata?.memory,
        ...options.memory
      },
      ...metadata,
      ...options
    };
  }

  /**
   * Wait for process to be ready
   */
  private async waitForProcessReady(processId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Process ${processId} failed to start`));
      }, 30000);

      const checkReady = () => {
        const processInfo = this.processes.get(processId);
        if (processInfo?.status === ProcessStatus.RUNNING) {
          clearTimeout(timeout);
          resolve();
        } else if (processInfo?.status === ProcessStatus.FAILED) {
          clearTimeout(timeout);
          reject(new Error(`Process ${processId} failed to start`));
        } else {
          setTimeout(checkReady, 100);
        }
      };

      checkReady();
    });
  }

  /**
   * Create a type-safe service proxy
   */
  private async createServiceProxy<T>(
    ProcessClass: new (...args: any[]) => T,
    processId: string,
    netron: any,
    options: IProcessOptions
  ): Promise<ServiceProxy<T>> {
    const handler = new ServiceProxyHandler<T>(
      processId,
      netron,
      ProcessClass.name,
      this.logger
    );

    return handler.createProxy();
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupShutdownHandlers(): void {
    const signals = ['SIGINT', 'SIGTERM', 'SIGUSR2'];

    signals.forEach(signal => {
      process.on(signal as any, async () => {
        this.logger.info({ signal }, 'Received shutdown signal');
        await this.shutdown();
        process.exit(0);
      });
    });

    process.on('uncaughtException', async (error) => {
      this.logger.error({ error }, 'Uncaught exception');
      await this.shutdown({ force: true });
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason, promise) => {
      this.logger.error({ reason, promise }, 'Unhandled rejection');
      await this.shutdown({ force: true });
      process.exit(1);
    });
  }
}