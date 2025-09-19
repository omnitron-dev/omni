/**
 * Process Lifecycle Types
 */

export interface IProcessLifecycleConfig {
  /**
   * Timeout for graceful shutdown in milliseconds
   */
  shutdownTimeout: number;

  /**
   * Enable graceful shutdown handling
   */
  enableGracefulShutdown: boolean;

  /**
   * Handle uncaught exceptions
   */
  handleUncaughtExceptions: boolean;

  /**
   * Handle unhandled promise rejections
   */
  handleUnhandledRejections: boolean;

  /**
   * List of signals to handle
   */
  handleSignals: string[];

  /**
   * Exit process on critical errors
   */
  exitOnError: boolean;

  /**
   * Logging level for lifecycle events
   */
  logLevel: 'debug' | 'info' | 'warn' | 'error';

  /**
   * Health check interval in milliseconds
   */
  healthCheckInterval: number;

  /**
   * Enable health checks
   */
  enableHealthChecks: boolean;

  /**
   * Force kill timeout after graceful shutdown timeout
   */
  forceKillTimeout: number;

  /**
   * Disable actual process.exit calls (for testing)
   */
  disableProcessExit?: boolean;
}

/**
 * Shutdown task definition
 */
export interface IShutdownTask {
  /**
   * Unique task identifier
   */
  id?: string;

  /**
   * Task name for logging
   */
  name: string;

  /**
   * Task priority (lower numbers run first)
   */
  priority?: number;

  /**
   * Task handler function
   */
  handler: (reason: ShutdownReason, details?: any) => Promise<void> | void;

  /**
   * Timeout for this task in milliseconds
   */
  timeout?: number;

  /**
   * If true, shutdown will abort if this task fails
   */
  critical?: boolean;

  /**
   * If true, task can be run in parallel with others of same priority
   */
  parallel?: boolean;
}

/**
 * Reasons for shutdown
 */
export enum ShutdownReason {
  Manual = 'manual',
  SIGTERM = 'SIGTERM',
  SIGINT = 'SIGINT',
  SIGHUP = 'SIGHUP',
  Signal = 'signal',
  UncaughtException = 'uncaughtException',
  UnhandledRejection = 'unhandledRejection',
  Timeout = 'timeout',
  Error = 'error',
  Reload = 'reload',
  Upgrade = 'upgrade',
  Maintenance = 'maintenance',
}

/**
 * Process signals
 */
export type ProcessSignal =
  | 'SIGTERM'
  | 'SIGINT'
  | 'SIGHUP'
  | 'SIGUSR1'
  | 'SIGUSR2'
  | 'SIGQUIT'
  | 'SIGABRT';

/**
 * Process metrics
 */
export interface IProcessMetrics {
  /**
   * Process uptime in milliseconds
   */
  uptime: number;

  /**
   * Memory usage information
   */
  memoryUsage: NodeJS.MemoryUsage;

  /**
   * CPU usage information
   */
  cpuUsage: NodeJS.CpuUsage;

  /**
   * Process ID
   */
  pid: number;

  /**
   * Parent process ID
   */
  ppid: number;

  /**
   * Platform
   */
  platform: NodeJS.Platform;

  /**
   * Node.js version
   */
  nodeVersion: string;

  /**
   * Current lifecycle state
   */
  state: LifecycleState;

  /**
   * Number of registered shutdown tasks
   */
  shutdownTasksCount: number;

  /**
   * Number of registered cleanup handlers
   */
  cleanupHandlersCount: number;
}

/**
 * Lifecycle event
 */
export interface ILifecycleEvent {
  /**
   * Event type
   */
  type: string;

  /**
   * Event timestamp
   */
  timestamp: number;

  /**
   * Event data
   */
  data?: any;
}

/**
 * Lifecycle states
 */
export enum LifecycleState {
  Created = 'created',
  Initializing = 'initializing',
  Initialized = 'initialized',
  Starting = 'starting',
  Running = 'running',
  Stopping = 'stopping',
  Stopped = 'stopped',
  ShuttingDown = 'shuttingDown',
  Error = 'error',
}

/**
 * Shutdown priority levels
 */
export enum ShutdownPriority {
  First = 0,
  VeryHigh = 10,
  High = 20,
  AboveNormal = 30,
  Normal = 50,
  BelowNormal = 70,
  Low = 80,
  VeryLow = 90,
  Last = 100,
}

/**
 * Health check result
 */
export interface IHealthCheckResult {
  /**
   * Overall health status
   */
  healthy: boolean;

  /**
   * Individual component health
   */
  components: Map<string, {
    healthy: boolean;
    message?: string;
    lastCheck?: number;
  }>;

  /**
   * Readiness status
   */
  ready: boolean;

  /**
   * Liveness status
   */
  live: boolean;

  /**
   * Last check timestamp
   */
  lastCheck: number;
}

/**
 * Lifecycle hook definition
 */
export interface ILifecycleHook {
  /**
   * Hook name
   */
  name: string;

  /**
   * Hook phase
   */
  phase: 'beforeInit' | 'afterInit' | 'beforeStart' | 'afterStart' | 'beforeStop' | 'afterStop';

  /**
   * Hook handler
   */
  handler: () => Promise<void> | void;

  /**
   * Hook priority (lower runs first)
   */
  priority?: number;

  /**
   * Hook timeout
   */
  timeout?: number;
}

/**
 * Process lifecycle manager interface
 */
export interface IProcessLifecycleManager {
  /**
   * Register a shutdown task
   */
  registerShutdownTask(task: IShutdownTask): void;

  /**
   * Unregister a shutdown task
   */
  unregisterShutdownTask(taskId: string): void;

  /**
   * Register a cleanup handler
   */
  registerCleanup(handler: () => Promise<void> | void): void;

  /**
   * Perform graceful shutdown
   */
  shutdown(reason: ShutdownReason, details?: any): Promise<void>;

  /**
   * Get process metrics
   */
  getMetrics(): IProcessMetrics;

  /**
   * Get current state
   */
  getState(): LifecycleState;

  /**
   * Check if shutting down
   */
  isShuttingDownNow(): boolean;

  /**
   * Subscribe to lifecycle events
   */
  on(event: string, handler: (event: ILifecycleEvent) => void): void;

  /**
   * Force immediate shutdown
   */
  forceShutdown(code?: number): void;
}