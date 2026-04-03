/**
 * Process Manager Types and Interfaces
 *
 * Core types for the Titan Process Manager module that treats every process
 * as a Netron service with full type safety and transparent distribution.
 */

import type { IModule } from '@omnitron-dev/titan/nexus';
import type { EventEmitter } from '@omnitron-dev/eventemitter';

// ============================================================================
// Core Process Types
// ============================================================================

/**
 * Process configuration options
 */
export interface IProcessOptions {
  /** Process name for identification */
  name?: string;

  /** Service version for discovery */
  version?: string;

  /** Process description */
  description?: string;

  /**
   * Mark all methods as publicly accessible via RPC.
   * When true, all methods are exposed without needing @Public() decorator.
   * Reduces boilerplate for services where all methods should be public.
   * @default false
   */
  allMethodsPublic?: boolean;

  /** Process dependencies for initialization */
  dependencies?: Record<string, any>;

  /** Environment variables to inject into the child process */
  env?: Record<string, string>;

  /** Working directory for the child process (defaults to parent's CWD) */
  cwd?: string;

  /** Netron peer configuration */
  netron?: {
    port?: number | 'auto';
    transport?: 'tcp' | 'unix' | 'websocket' | 'http';
    host?: string;
    discoveryUrl?: string;
  };

  /** Process scaling options */
  scaling?: {
    min?: number;
    max?: number;
    strategy?: 'cpu' | 'memory' | 'custom';
    metrics?: IScalingMetrics;
  };

  /** Health check configuration */
  health?: {
    enabled?: boolean;
    interval?: number;
    timeout?: number;
    retries?: number;
  };

  /** Startup timeout in milliseconds. How long to wait for the worker to send 'ready'. @default 30000 */
  startupTimeout?: number;

  /** Memory management */
  memory?: {
    limit?: string;
    alert?: string;
    shared?: boolean;
    gc?: {
      interval?: number;
      aggressive?: boolean;
    };
  };

  /** Security options */
  security?: {
    isolation?: 'none' | 'vm' | 'container';
    sandbox?: ISandboxOptions;
    permissions?: IPermissions;
  };

  /** Observability configuration */
  observability?: {
    metrics?: boolean | IMetricsOptions;
    tracing?: boolean | ITracingOptions;
    logs?: boolean | ILoggingOptions;
  };

  /** Clustering options */
  cluster?: boolean | IClusterOptions;

  /** Multi-tenancy support */
  multiTenant?: boolean | IMultiTenantOptions;

  /** Service mesh features */
  mesh?: IServiceMeshOptions;

  /** Geographic distribution */
  geo?: IGeoOptions;

  /** Cost optimization */
  cost?: ICostOptions;

  /** Self-healing configuration */
  selfHealing?: ISelfHealingOptions;

  /** Debug options */
  debug?: IDebugOptions;

  /** Additional Node.js CLI flags passed to forked child process (e.g. ['--import', 'tsx/esm']) */
  execArgv?: string[];
}

/**
 * Process metadata stored in decorators
 */
export interface IProcessMetadata extends IProcessOptions {
  target: any;
  isProcess: true;
  methods?: Map<string, IProcessMethodMetadata>;
}

/**
 * Method-level metadata for process methods
 */
export interface IProcessMethodMetadata {
  name: string;
  descriptor: PropertyDescriptor;
  public?: boolean;
  rateLimit?: IRateLimitOptions;
  cache?: ICacheOptions;
  validate?: IValidationOptions;
  trace?: boolean;
  metrics?: boolean;
}

/**
 * Process instance information
 */
export interface IProcessInfo {
  id: string;
  name: string;
  pid?: number;
  status: ProcessStatus;
  startTime: number;
  endTime?: number;
  restartCount: number;
  metrics?: IProcessMetrics;
  health?: IHealthStatus;
  errors?: Error[];
}

/**
 * Process status enumeration
 */
export enum ProcessStatus {
  PENDING = 'pending',
  STARTING = 'starting',
  RUNNING = 'running',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  FAILED = 'failed',
  CRASHED = 'crashed',
}

// ============================================================================
// Service Proxy Types
// ============================================================================

/**
 * Type-safe service proxy that converts all methods to async
 */
export type ServiceProxy<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : T[K] extends AsyncIterable<infer U>
      ? AsyncIterable<U>
      : never;
} & IServiceProxyControl;

/**
 * Service proxy control methods
 */
export interface IServiceProxyControl {
  __processId: string;
  __destroy(): Promise<void>;
  __getMetrics(): Promise<IProcessMetrics>;
  __getHealth(): Promise<IHealthStatus>;
}

// ============================================================================
// Process Pool Types
// ============================================================================

/**
 * Process pool configuration
 */
export interface IProcessPoolOptions {
  size?: number | 'auto';
  strategy?: PoolStrategy;
  metrics?: boolean;
  recycleAfter?: number;
  maxLifetime?: number;
  idleTimeout?: number;
  warmup?: boolean;
  maxQueueSize?: number;
  requestTimeout?: number;
  replaceUnhealthy?: boolean;
  maxConcurrency?: number;

  /**
   * Static spawn options applied to every worker in the pool.
   * Merged into each pm.spawn() call. Use this for shared config
   * like health checks, observability, and fixed dependencies.
   */
  spawnOptions?: Partial<IProcessOptions>;

  /**
   * Factory function for per-worker spawn options.
   * Called with the worker's sequential index (0, 1, 2, ...).
   * Return value is merged with spawnOptions (factory takes precedence).
   *
   * Use this when each worker needs unique configuration, e.g.:
   * - Different port offsets for HTTP server instances
   * - Per-worker dependencies
   * - Unique names
   *
   * @example
   * ```typescript
   * const pool = await pm.pool('./bootstrap-process.js', {
   *   size: 3,
   *   spawnOptionsFactory: (index) => ({
   *     name: `api-server-${index}`,
   *     dependencies: { bootstrapPath: '/path/to/bootstrap', portOffset: index },
   *   }),
   * });
   * ```
   */
  spawnOptionsFactory?: (workerIndex: number) => Partial<IProcessOptions>;

  /**
   * Memory limit per worker (e.g., '512MB', '1GB', or bytes as number).
   * Workers exceeding this limit will be recycled.
   * @default '512MB'
   */
  memoryLimit?: string | number;

  /**
   * Memory warning threshold as a ratio (0-1) of memoryLimit.
   * Workers exceeding this threshold will be deprioritized in load balancing.
   * @default 0.8
   */
  memoryWarningThreshold?: number;

  /**
   * Heartbeat configuration for fast unresponsive worker detection.
   */
  heartbeat?: {
    /** Enable heartbeat monitoring @default true */
    enabled?: boolean;
    /** Heartbeat interval in ms @default 10000 */
    interval?: number;
    /** Timeout for heartbeat response in ms @default 5000 */
    timeout?: number;
    /** Number of missed heartbeats before marking unhealthy @default 3 */
    maxMissed?: number;
  };

  healthCheck?: {
    enabled?: boolean;
    interval?: number;
    unhealthyThreshold?: number;
  };
  autoScale?: {
    enabled?: boolean;
    min?: number;
    max?: number;
    cpuThreshold?: number;
    targetCPU?: number;
    targetMemory?: number;
    queueThreshold?: number;
    checkInterval?: number;
    scaleDownDelay?: number;
    scaleUpThreshold?: number;
    scaleDownThreshold?: number;
    cooldownPeriod?: number;
  };
  circuitBreaker?: {
    enabled?: boolean;
    threshold?: number;
    timeout?: number;
    halfOpenRequests?: number;
  };
}

/**
 * Pool load balancing strategies
 */
export enum PoolStrategy {
  ROUND_ROBIN = 'round-robin',
  LEAST_LOADED = 'least-loaded',
  LEAST_CONNECTIONS = 'least-connections',
  WEIGHTED_ROUND_ROBIN = 'weighted-round-robin',
  LEAST_RESPONSE_TIME = 'least-response-time',
  IP_HASH = 'ip-hash',
  RANDOM = 'random',
  WEIGHTED = 'weighted',
  ADAPTIVE = 'adaptive',
  CONSISTENT_HASH = 'consistent-hash',
  LATENCY = 'latency',
  /**
   * Power of Two Random Choices (P2C) - O(1) selection with excellent load distribution.
   * Picks 2 random workers and selects the one with lower load.
   * Used by NGINX, HAProxy, and Envoy. Recommended for high-throughput pools.
   */
  POWER_OF_TWO = 'power-of-two',
}

/**
 * Process pool interface
 *
 * Combines ServiceProxy<T> with pool management methods to provide type-safe
 * dynamic method proxying. This allows calling worker methods directly on the
 * pool (e.g., pool.add(1, 2)) while maintaining full type safety through
 * TypeScript's mapped types.
 *
 * Note: We use a type alias with intersection (&) instead of interface extends
 * because ServiceProxy<T> is a mapped type, which cannot be extended by interfaces.
 */
export type IProcessPool<T> = ServiceProxy<T> & {
  size: number;
  active: number;
  pending: number;
  metrics: IPoolMetrics;
  scale(size: number): Promise<void>;
  drain(): Promise<void>;
  destroy(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): void;
  off(event: string, listener: (...args: any[]) => void): void;
};

// ============================================================================
// Supervisor Types
// ============================================================================

/**
 * Supervisor configuration
 */
export interface ISupervisorOptions {
  strategy?: SupervisionStrategy;
  maxRestarts?: number;
  window?: number;
  backoff?: IBackoffOptions;
}

/**
 * Supervision strategies
 */
export enum SupervisionStrategy {
  ONE_FOR_ONE = 'one-for-one',
  ONE_FOR_ALL = 'one-for-all',
  REST_FOR_ONE = 'rest-for-one',
  SIMPLE_ONE_FOR_ONE = 'simple-one-for-one',
}

/**
 * Supervisor child definition
 */
export interface ISupervisorChild {
  name: string;
  processClass: any;
  options?: IProcessOptions;
  critical?: boolean;
  pool?: IProcessPoolOptions;
  optional?: boolean;
  propertyKey?: string; // Property key for runtime resolution
}

/**
 * Config-based supervisor creation — no decorators needed.
 *
 * Use with `pm.supervisor(config)` for programmatic supervision trees.
 *
 * @example
 * ```typescript
 * const supervisor = await pm.supervisor({
 *   strategy: SupervisionStrategy.ONE_FOR_ONE,
 *   maxRestarts: 5,
 *   window: 60_000,
 *   children: [
 *     {
 *       name: 'api',
 *       process: './api-process.js',
 *       spawnOptions: { dependencies: { port: 3001 }, health: { enabled: true } },
 *       critical: true,
 *     },
 *     {
 *       name: 'workers',
 *       process: './worker-process.js',
 *       poolOptions: { size: 4, strategy: PoolStrategy.POWER_OF_TWO },
 *     },
 *   ],
 * });
 * ```
 */
export interface ISupervisorConfig {
  strategy?: SupervisionStrategy;
  maxRestarts?: number;
  window?: number;
  backoff?: IBackoffOptions;
  children: ISupervisorChildConfig[];
  /** Custom crash handler — overrides default restart logic */
  onChildCrash?: (child: ISupervisorChild, error: Error) => Promise<RestartDecision>;
}

/**
 * Config-based child definition.
 */
export interface ISupervisorChildConfig {
  name: string;
  /** Process file path or class constructor */
  process: string | (new (...args: any[]) => any);
  /** Spawn options (dependencies, health, observability, etc.) */
  spawnOptions?: Partial<IProcessOptions>;
  /** If set, child is created as a pool */
  poolOptions?: IProcessPoolOptions;
  critical?: boolean;
  optional?: boolean;
}

/**
 * Restart decision enumeration
 */
export enum RestartDecision {
  RESTART = 'restart',
  IGNORE = 'ignore',
  ESCALATE = 'escalate',
  SHUTDOWN = 'shutdown',
}

// ============================================================================
// Workflow Types
// ============================================================================

/**
 * Workflow stage configuration
 */
export interface IWorkflowStage {
  name: string;
  handler: (...args: any[]) => Promise<any>;
  parallel?: boolean;
  dependsOn?: string | string[];
  timeout?: number;
  retries?: number;
}

/**
 * Workflow execution context
 */
export interface IWorkflowContext {
  id: string;
  stages: Map<string, IStageResult>;
  state: any;
  metadata: any;
}

/**
 * Stage execution result
 */
export interface IStageResult {
  stage: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: Error;
  startTime?: number;
  endTime?: number;
}

// ============================================================================
// Event & Message Types
// ============================================================================

/**
 * Process event types
 */
export interface IProcessEvents {
  'process:spawn': (info: IProcessInfo) => void;
  'process:ready': (info: IProcessInfo) => void;
  'process:crash': (info: IProcessInfo, error: Error) => void;
  'process:restart': (info: IProcessInfo, attempt: number) => void;
  'process:stop': (info: IProcessInfo) => void;
  'pool:scale': (pool: string, oldSize: number, newSize: number) => void;
  'health:change': (processId: string, health: IHealthStatus) => void;
}

// ============================================================================
// Metrics & Monitoring Types
// ============================================================================

/**
 * Process metrics
 */
export interface IProcessMetrics {
  cpu: number;
  memory: number;
  requests?: number;
  errors?: number;
  latency?: ILatencyMetrics;
  custom?: Record<string, any>;
}

/**
 * Pool metrics
 */
export interface IPoolMetrics extends IProcessMetrics {
  queueSize: number;
  activeWorkers: number;
  totalWorkers: number;
  idleWorkers?: number;
  healthyWorkers?: number;
  unhealthyWorkers?: number;
  totalRequests: number;
  successfulRequests?: number;
  failedRequests?: number;
  totalErrors?: number;
  avgResponseTime: number;
  errorRate?: number;
  throughput?: number;
  saturation?: number;
}

/**
 * Latency metrics
 */
export interface ILatencyMetrics {
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  mean: number;
}

/**
 * Health status
 */
export interface IHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: IHealthCheck[];
  timestamp: number;
}

/**
 * Individual health check result
 */
export interface IHealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message?: string;
  details?: any;
}

// ============================================================================
// Advanced Feature Types
// ============================================================================

/**
 * Scaling metrics configuration
 */
export interface IScalingMetrics {
  cpu?: { target: number };
  memory?: { target: number };
  queueSize?: { target: number };
  responseTime?: { target: number };
  custom?: (metrics: IProcessMetrics) => boolean;
}

/**
 * Sandbox options for process isolation
 */
export interface ISandboxOptions {
  allowedModules?: string[];
  timeout?: number;
  memory?: string;
}

/**
 * Process permissions
 */
export interface IPermissions {
  network?: boolean;
  filesystem?: 'none' | 'read-only' | 'read-write';
  env?: boolean;
  spawn?: boolean;
}

/**
 * Metrics export options
 */
export interface IMetricsOptions {
  enabled?: boolean;
  export?: 'prometheus' | 'statsd' | 'custom';
  interval?: number;
  labels?: Record<string, string>;
}

/**
 * Tracing configuration
 */
export interface ITracingOptions {
  enabled?: boolean;
  sampler?: number;
  propagator?: 'w3c' | 'jaeger' | 'zipkin';
  exporter?: string;
}

/**
 * Logging configuration
 */
export interface ILoggingOptions {
  enabled?: boolean;
  level?: string;
  format?: 'json' | 'text';
  output?: 'console' | 'file' | 'remote';
}

/**
 * Cluster configuration
 */
export interface IClusterOptions {
  nodes?: number;
  replication?: number;
  sharding?: IShardingOptions;
}

/**
 * Sharding configuration
 */
export interface IShardingOptions {
  strategy?: 'consistent-hash' | 'range' | 'custom';
  replicas?: number;
}

/**
 * Multi-tenancy configuration
 */
export interface IMultiTenantOptions {
  isolation?: 'strict' | 'shared';
  dataPartitioning?: boolean;
}

/**
 * Service mesh configuration
 */
export interface IServiceMeshOptions {
  tracing?: boolean;
  metrics?: boolean;
  mtls?: boolean;
  rateLimit?: IRateLimitOptions;
  circuitBreaker?: ICircuitBreakerOptions;
  retry?: IRetryOptions;
  timeout?: number;
  bulkhead?: IBulkheadOptions;
}

/**
 * Rate limiting options
 */
export interface IRateLimitOptions {
  rps?: number;
  burst?: number;
  strategy?: 'token-bucket' | 'sliding-window' | 'fixed-window';
  key?: string;
}

/**
 * Circuit breaker configuration
 */
export interface ICircuitBreakerOptions {
  threshold?: number;
  timeout?: number;
  fallback?: string;
}

/**
 * Retry configuration
 */
export interface IRetryOptions {
  attempts?: number;
  backoff?: 'exponential' | 'linear' | 'fixed';
  maxDelay?: number;
}

/**
 * Bulkhead configuration
 */
export interface IBulkheadOptions {
  maxConcurrent?: number;
  maxQueue?: number;
}

/**
 * Geographic distribution options
 */
export interface IGeoOptions {
  regions?: string[] | 'all';
  replication?: 'active-active' | 'active-passive';
  consistency?: 'strong' | 'eventual';
  conflictResolution?: 'lww' | 'crdt' | 'custom';
  cdn?: boolean;
}

/**
 * Cost optimization options
 */
export interface ICostOptions {
  budget?: { monthly?: number; alert?: number };
  optimization?: ICostOptimizationOptions;
}

/**
 * Cost optimization strategies
 */
export interface ICostOptimizationOptions {
  spotInstances?: boolean;
  autoScaleDown?: 'conservative' | 'balanced' | 'aggressive';
  idleShutdown?: string;
  serverless?: boolean;
}

/**
 * Self-healing configuration
 */
export interface ISelfHealingOptions {
  enabled?: boolean;
  ml?: boolean;
  playbooks?: string[];
  actions?: ISelfHealAction[];
}

/**
 * Self-healing action
 */
export interface ISelfHealAction {
  symptoms: string[];
  action: 'restart' | 'scale' | 'migrate' | 'custom';
  cooldown?: string;
  handler?: () => Promise<void>;
}

/**
 * Debug configuration
 */
export interface IDebugOptions {
  recordState?: boolean;
  maxSnapshots?: number;
  breakpoints?: boolean;
  profiling?: boolean;
}

/**
 * Cache configuration
 */
export interface ICacheOptions {
  ttl?: number;
  key?: string | ((args: any[]) => string);
  condition?: (result: any) => boolean;
}

/**
 * Validation options
 */
export interface IValidationOptions {
  schema?: any;
  validator?: (value: any) => boolean | Promise<boolean>;
}

/**
 * Backoff configuration
 */
export interface IBackoffOptions {
  type?: 'exponential' | 'linear' | 'fixed';
  initial?: number;
  max?: number;
  factor?: number;
}

// ============================================================================
// Process Manager Interface
// ============================================================================

/**
 * Main Process Manager interface
 */
export interface IProcessManager extends EventEmitter {
  /** Spawn a new process as a Netron service */
  spawn<T>(
    processPathOrClass: string | (new (...args: any[]) => T),
    options?: IProcessOptions
  ): Promise<ServiceProxy<T>>;

  /** Create a process pool */
  pool<T>(
    processPathOrClass: string | (new (...args: any[]) => T),
    options?: IProcessPoolOptions
  ): Promise<IProcessPool<T>>;

  /** Discover a service by name */
  discover<T>(serviceName: string): Promise<ServiceProxy<T> | null>;

  /** Create a workflow */
  workflow<T>(WorkflowPathOrClass: string | (new () => T)): Promise<T>;

  /** Create a supervisor tree (decorator-based or config-based) — creates and starts */
  supervisor(classOrConfig: (new () => any) | ISupervisorConfig, options?: ISupervisorOptions): Promise<any>;

  /** Create a supervisor without starting it — allows wiring events before start() */
  createSupervisor(classOrConfig: (new () => any) | ISupervisorConfig, options?: ISupervisorOptions): any;

  /** Get process information */
  getProcess(processId: string): IProcessInfo | undefined;

  /** List all processes */
  listProcesses(): IProcessInfo[];

  /** Kill a process */
  kill(processId: string, signal?: string): Promise<boolean>;

  /** Get metrics for a process */
  getMetrics(processId: string): Promise<IProcessMetrics | null>;

  /** Get health status */
  getHealth(processId: string): Promise<IHealthStatus | null>;

  /** Get the worker handle for a spawned process by its ID */
  getWorkerHandle(processId: string): IWorkerHandle | undefined;

  /** Shutdown all processes */
  shutdown(options?: { timeout?: number; force?: boolean }): Promise<void>;
}

// ============================================================================
// Module Configuration
// ============================================================================

/**
 * Process spawner interface
 */
export interface IProcessSpawner {
  spawn<T>(processPathOrClass: string | (new (...args: any[]) => T), options?: ISpawnOptions): Promise<IWorkerHandle>;
  cleanup?(): Promise<void>;
}

/**
 * Worker handle for managing spawned processes
 */
export interface IWorkerHandle {
  id: string;
  transportUrl: string;
  serviceName: string;
  serviceVersion: string;
  /** OS process ID of the child (undefined for worker threads) */
  pid?: number;
  terminate(): Promise<void>;
  isAlive(): boolean;
  send?(message: any): Promise<void>;
  onMessage?(handler: (data: any) => void): void;
  onLog?(handler: (line: string, stream: 'stdout' | 'stderr') => void): void;
  status?: ProcessStatus;
  proxy?: any;
  worker?: any;
  netronClient?: any;
}

/**
 * Spawn options
 */
export interface ISpawnOptions {
  processId?: string;
  name?: string;
  version?: string;
  config?: any;
  dependencies?: Record<string, any>;
  /** Environment variables to inject into the child process */
  env?: Record<string, string>;
  discovery?: {
    enabled?: boolean;
  };
  transport?: 'tcp' | 'unix' | 'ws';
  host?: string;
  isolation?: 'none' | 'vm' | 'container';
  /** Additional Node.js CLI flags passed to forked child process (e.g. ['--import', 'tsx/esm']) */
  execArgv?: string[];

  /** Startup timeout in milliseconds. @default 30000 */
  startupTimeout?: number;
}

/**
 * Process Manager module configuration
 *
 * Focuses on process orchestration and infrastructure concerns.
 * Business logic (discovery, redis, etc.) should be handled at the process level.
 */
export interface IProcessManagerConfig {
  /**
   * Process isolation strategy
   * - 'none': In-process (for testing)
   * - 'worker': Worker threads (default, fast)
   * - 'child': Child processes (more isolation)
   */
  isolation?: 'none' | 'worker' | 'child';

  /**
   * Inter-process communication transport
   * - 'unix': Unix sockets (fastest for local, default)
   * - 'tcp': TCP sockets (network capable)
   * - 'ws': WebSocket (most compatible)
   */
  transport?: 'unix' | 'tcp' | 'ws';

  /** Default process restart policy */
  restartPolicy?: IRestartPolicy;

  /** Default resource limits */
  resources?: {
    maxMemory?: string;
    maxCpu?: number;
    timeout?: number;
  };

  /** Monitoring and observability */
  monitoring?: {
    healthCheck?: boolean | { interval?: number; timeout?: number };
    metrics?: boolean;
    tracing?: boolean;
  };

  /** Testing configuration */
  testing?: {
    useMockSpawner?: boolean;
  };

  /**
   * Register process signal handlers (SIGINT, SIGTERM, etc.).
   * Default: false. PM is a library component — the top-level app
   * should own signal handling. Set to true only when PM is the
   * outermost lifecycle manager.
   */
  handleSignals?: boolean;

  /** Advanced options */
  advanced?: {
    tempDir?: string;
    gracefulShutdownTimeout?: number;
  };
}

/**
 * Restart policy configuration
 */
export interface IRestartPolicy {
  enabled?: boolean;
  maxRestarts?: number;
  window?: number;
  delay?: number;
  backoff?: IBackoffOptions;
}

/**
 * Process Manager module interface
 */
export interface IProcessManagerModule extends IModule {
  getManager(): IProcessManager;
}
