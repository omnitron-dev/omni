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
 *
 * A large part of this shape is aspirational and read by nothing. Eleven option
 * interfaces below — tracing, geo distribution, service mesh, sandboxing, cost
 * optimisation, sharding, multi-tenancy, self-healing, debugging, bulkheads and
 * validation — are referenced nowhere outside this file, and the members here
 * that point at them (`sandbox`, `cluster`, `mesh`, `multiTenant`,
 * `selfHealing`, `scaling`, `logs`, `permissions`, `discoveryUrl`, `shared`)
 * are equally inert.
 *
 * They are marked rather than deleted because they are exported API and cannot
 * be removed without breaking whoever imports them. What matters is that
 * setting any of them changes nothing, and until now nothing said so — a
 * consumer reading this file would reasonably size the package by its type
 * surface.
 *
 * What IS wired: name, version, transport/netron settings, health checks,
 * restart policy, resource limits, isolation strategy (manager-level) and the
 * pool options that `process-pool.ts` actually reads.
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

  // NONE OF THE SIX BELOW IS IMPLEMENTED. Each is read by nothing, and the
  // interfaces they point at are annotated individually — but a caller
  // configuring a process reads THIS list, where every entry looked as
  // supported as `restartPolicy` or `memoryLimit` above it. Spelled out here
  // so the absence is visible at the point of use rather than one navigation
  // away.

  /** Clustering options — NOT IMPLEMENTED; no clustering is performed. */
  cluster?: boolean | IClusterOptions;

  /** Multi-tenancy support — NOT IMPLEMENTED; no tenant isolation exists. */
  multiTenant?: boolean | IMultiTenantOptions;

  /** Service mesh features — NOT IMPLEMENTED; no mTLS, retry or bulkhead. */
  mesh?: IServiceMeshOptions;

  /** Geographic distribution — NOT IMPLEMENTED; regions are not considered. */
  geo?: IGeoOptions;

  /** Cost optimization — NOT IMPLEMENTED; no budget is tracked or enforced. */
  cost?: ICostOptions;

  /** Self-healing configuration — NOT IMPLEMENTED; see `restartPolicy` for the
   *  restart behaviour that does exist. */
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
  /**
   * Set by `@HealthCheck`. The worker runtime scans for this field to build
   * the list of methods `__getProcessHealth` calls.
   */
  healthCheck?: { method: string; interval?: number };
  /**
   * The four below are recorded by `@RateLimit`, `@Cache`, `@Validate`,
   * `@Trace` and `@Metric`, and NOT IMPLEMENTED: the worker runtime reads only
   * `public` and `healthCheck` from this object, so none of them changes how a
   * method behaves. The decorators are declarative markers today.
   */
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
  /**
   * Restarts observed by whoever supplies this record — absent when nobody is
   * counting, which is the usual case.
   *
   * NOT maintained by ProcessManager. The live counter belongs to
   * `ProcessSupervisor`: raised in `performRestart`, read with
   * `getRestartCount(name)`. It is keyed by process name, while the manager
   * keys by id, so the two cannot be reconciled by a lookup.
   *
   * This was previously a required field assigned `0` at registration and
   * incremented nowhere, so every reader of a manager-supplied record was told
   * a process had never restarted. Optional and absent is the honest shape: a
   * missing value is a question, `0` is an answer.
   */
  restartCount?: number;
  metrics?: IProcessMetrics;
  health?: IHealthStatus;
  errors?: Error[];
}

/**
 * Process status enumeration
 */
export const ProcessStatus = {
  PENDING: 'pending',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  FAILED: 'failed',
  CRASHED: 'crashed',
} as const;
export type ProcessStatus = (typeof ProcessStatus)[keyof typeof ProcessStatus];

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
  /** NOT IMPLEMENTED — nothing reads this; an idle worker is never retired
   *  for idleness alone. `recycleAfter` and `maxLifetime` are applied. */
  idleTimeout?: number;
  warmup?: boolean;
  maxQueueSize?: number;
  requestTimeout?: number;
  /** NOT IMPLEMENTED — nothing reads this. An unhealthy worker is handled by
   *  the health path regardless of what this is set to. */
  replaceUnhealthy?: boolean;
  /** NOT IMPLEMENTED — nothing reads this; there is no per-worker concurrency
   *  cap. `maxQueueSize` bounds the queue instead. */
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
    /**
     * NOT IMPLEMENTED — nothing reads this, despite the documented default.
     * The consecutive-failure count that does mark a worker unhealthy is
     * `healthCheck.unhealthyThreshold`.
     */
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
    /** NOT IMPLEMENTED — nothing reads this. The CPU figure the scaler
     *  compares against is `targetCPU`. */
    cpuThreshold?: number;
    targetCPU?: number;
    targetMemory?: number;
    queueThreshold?: number;
    checkInterval?: number;
    /** NOT IMPLEMENTED — nothing reads this. The wait between scaling actions
     *  is `cooldownPeriod`. */
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
export const PoolStrategy = {
  ROUND_ROBIN: 'round-robin',
  LEAST_LOADED: 'least-loaded',
  LEAST_CONNECTIONS: 'least-connections',
  WEIGHTED_ROUND_ROBIN: 'weighted-round-robin',
  LEAST_RESPONSE_TIME: 'least-response-time',
  IP_HASH: 'ip-hash',
  RANDOM: 'random',
  WEIGHTED: 'weighted',
  ADAPTIVE: 'adaptive',
  CONSISTENT_HASH: 'consistent-hash',
  LATENCY: 'latency',
  /**
   * Power of Two Random Choices (P2C) - O(1) selection with excellent load distribution.
   * Picks 2 random workers and selects the one with lower load.
   * Used by NGINX, HAProxy, and Envoy. Recommended for high-throughput pools.
   */
  POWER_OF_TWO: 'power-of-two',
} as const;
export type PoolStrategy = (typeof PoolStrategy)[keyof typeof PoolStrategy];

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
  /**
   * Return PM process ids of all workers in the pool. Surfaced so
   * external orchestrators can resolve workers to the parent's
   * `getWorkerHandle()` registry (e.g., to report PIDs / liveness
   * for pool-managed topology — supervisor knows nothing about
   * these workers).
   */
  getWorkerIds(): string[];
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
export const SupervisionStrategy = {
  ONE_FOR_ONE: 'one-for-one',
  ONE_FOR_ALL: 'one-for-all',
  REST_FOR_ONE: 'rest-for-one',
  SIMPLE_ONE_FOR_ONE: 'simple-one-for-one',
} as const;
export type SupervisionStrategy = (typeof SupervisionStrategy)[keyof typeof SupervisionStrategy];

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
  /**
   * Per-child shutdown deadline in milliseconds (T#61, OTP-style).
   *
   * When the supervisor stops this child, the SIGTERM → SIGKILL
   * ladder waits up to this many ms before escalating. Without
   * the override, the ladder uses the hardcoded 5s budget that
   * suits most workloads but is too generous for a tiny HTTP
   * server and too short for a database that needs to flush a
   * checkpoint. Two special markers:
   *
   *   - omitted / undefined → use the default 5s ladder
   *   - 0                   → immediate SIGKILL (OTP's `:brutal_kill`)
   */
  shutdownTimeout?: number;
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
  /**
   * Per-child shutdown deadline in milliseconds (T#61, OTP-style).
   * See {@link ISupervisorChild.shutdownTimeout} for semantics.
   */
  shutdownTimeout?: number;
}

/**
 * Restart decision enumeration
 */
export const RestartDecision = {
  RESTART: 'restart',
  IGNORE: 'ignore',
  ESCALATE: 'escalate',
  SHUTDOWN: 'shutdown',
} as const;
export type RestartDecision = (typeof RestartDecision)[keyof typeof RestartDecision];

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
  /**
   * Cumulative CPU time consumed since the process started, in SECONDS.
   *
   * Monotonically increasing, not a utilisation figure. The unit was
   * undocumented, and the auto-scaler read it as a percentage — so a worker
   * crossed a "70% CPU" threshold after 70 seconds of CPU time and never came
   * back under it. Use `cpuPercent` for a rate.
   */
  cpu: number;
  /**
   * Resident heap in BYTES (`process.memoryUsage().heapUsed`).
   *
   * Also read as a percentage by the auto-scaler, which made "memory above
   * 80%" true for any worker holding more than eighty bytes. Use
   * `memoryPercent` for a proportion.
   */
  memory: number;
  /** Resident set size in bytes, when the reporter provides it. */
  memoryRss?: number;
  /**
   * CPU utilisation over the interval between the last two samples, as a
   * percentage. Absent until a second sample exists, and absent from
   * reporters that do not track an interval — a consumer must treat "absent"
   * as "unknown", never as zero.
   */
  cpuPercent?: number;
  /**
   * Memory as a percentage of the configured per-worker limit. Absent when no
   * limit is known, with the same rule: absent means unknown.
   */
  memoryPercent?: number;
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
/**
 * NOT IMPLEMENTED — referenced nowhere outside this file.
 *
 * Worth singling out: `allowedModules` and the rest describe a sandbox that
 * does not exist, and a caller who believes a process is confined by it is
 * wrong in the direction that matters. `security.isolation: 'vm' | 'container'`
 * is the same promise from the other side and now warns at spawn time.
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
/**
 * NOT IMPLEMENTED — this interface is referenced nowhere outside this file.
 * See the note on `IProcessOptions` for the group it belongs to.
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
 *
 * NOT IMPLEMENTED — referenced nowhere outside this file.
 */
export interface IClusterOptions {
  nodes?: number;
  replication?: number;
  sharding?: IShardingOptions;
}

/**
 * Sharding configuration
 */
/** NOT IMPLEMENTED — referenced nowhere outside this file. */
export interface IShardingOptions {
  strategy?: 'consistent-hash' | 'range' | 'custom';
  replicas?: number;
}

/**
 * Multi-tenancy configuration
 */
/** NOT IMPLEMENTED — referenced nowhere outside this file. */
export interface IMultiTenantOptions {
  isolation?: 'strict' | 'shared';
  dataPartitioning?: boolean;
}

/**
 * Service mesh configuration
 */
/** NOT IMPLEMENTED — referenced nowhere outside this file. */
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
/** NOT IMPLEMENTED — referenced nowhere outside this file. */
export interface IBulkheadOptions {
  maxConcurrent?: number;
  maxQueue?: number;
}

/**
 * Geographic distribution options
 */
/** NOT IMPLEMENTED — referenced nowhere outside this file. */
export interface IGeoOptions {
  regions?: string[] | 'all';
  replication?: 'active-active' | 'active-passive';
  consistency?: 'strong' | 'eventual';
  conflictResolution?: 'lww' | 'crdt' | 'custom';
  cdn?: boolean;
}

/**
 * Cost optimization options
 *
 * NOT IMPLEMENTED — referenced nowhere outside this file. No budget is tracked
 * and no alert is raised, whatever `budget.monthly` and `budget.alert` say.
 */
export interface ICostOptions {
  budget?: { monthly?: number; alert?: number };
  optimization?: ICostOptimizationOptions;
}

/**
 * Cost optimization strategies
 */
/** NOT IMPLEMENTED — referenced nowhere outside this file. */
export interface ICostOptimizationOptions {
  spotInstances?: boolean;
  autoScaleDown?: 'conservative' | 'balanced' | 'aggressive';
  idleShutdown?: string;
  serverless?: boolean;
}

/**
 * Self-healing configuration
 */
/** NOT IMPLEMENTED — referenced nowhere outside this file. */
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
/** NOT IMPLEMENTED — referenced nowhere outside this file. */
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
 * Information published on the `exit` event when a worker
 * terminates (intentionally OR unexpectedly). Supervisors branch
 * on `expected` to decide whether to restart.
 */
export interface IWorkerExitInfo {
  workerId: string;
  serviceName: string;
  /** Exit code (null when killed by a signal). */
  code: number | null;
  /** POSIX signal name when applicable (e.g., 'SIGKILL'). */
  signal: NodeJS.Signals | null;
  /**
   * `true` when termination came from a deliberate `terminate()`
   * call; `false` for crashes (OOM, segfault, uncaught throw,
   * external kill). Drives the supervisor's restart policy.
   */
  expected: boolean;
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
  /**
   * Subscribe to the underlying process's lifecycle exit. Fires
   * exactly once per physical termination — for both clean
   * shutdowns and crashes. Branch on `info.expected` in the
   * handler. Returns an unsubscribe function for symmetry with
   * other event APIs.
   */
  onExit?(handler: (info: IWorkerExitInfo) => void): () => void;
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
  /**
   * Spawn strategy — the same vocabulary as `IProcessManagerConfig.isolation`,
   * which this overrides for one process. Omit to use the manager's setting.
   *
   * This field used to be typed 'none' | 'vm' | 'container' — the SANDBOX
   * vocabulary — while the spawner compared it against 'worker' and used it to
   * gate the Netron management client. The two meanings met on the string
   * 'none', so asking for no sandbox silently selected the in-process strategy.
   * Sandboxing now travels in `sandbox` below. A 'vm' or 'container' value
   * arriving here from an untyped caller is still honoured as a sandbox
   * request, so the old runtime behaviour is unchanged.
   */
  isolation?: 'none' | 'worker' | 'child';
  /**
   * Requested sandbox. Neither 'vm' nor 'container' is implemented; both spawn
   * an ordinary child process and warn at spawn time. 'none' is the default
   * posture and deliberately says nothing about the spawn strategy.
   */
  sandbox?: 'none' | 'vm' | 'container';
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

  /**
   * Interval in ms between defensive PID-liveness sweeps. The
   * primary mechanism for detecting worker death is the
   * WorkerHandle `exit` event; this sweep is a backstop for the
   * (rare) cases where that event misfires. Default 30_000.
   * Set to 0 to disable the sweep entirely (not recommended in
   * production — leaves a single point of failure in the
   * supervision contract).
   */
  livenessSweepIntervalMs?: number;

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

  /**
   * Re-emit each child process log line through the parent logger.
   * Default: true.
   *
   * This is the right default for a consumer with no log pipeline of its
   * own — without it a child's output goes nowhere. It becomes duplication
   * the moment the consumer also subscribes to `WorkerHandle.onLog` and
   * routes lines itself, because both paths carry the SAME line: once under
   * the child's application name, and once more through the parent's logger
   * under the parent's name.
   *
   * The duplicate is not just storage. Any per-application count is then
   * wrong by a factor that depends on which component emitted the line, and
   * each individual number still looks plausible — which is why it survives.
   * Measured on a live omnitron log table: 42,958 rows under `omnitron`
   * against 36,160 under every other application combined, with
   * (timestamp, message) pairs matching across the two names.
   *
   * Set to false when you consume `onLog` yourself.
   */
  forwardChildLogs?: boolean;

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
