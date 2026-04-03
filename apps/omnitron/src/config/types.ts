/**
 * Omnitron Configuration Types
 *
 * Declarative configuration for Titan application supervision.
 */

import type { IRestartPolicy, IBackoffOptions } from '@omnitron-dev/titan-pm';

// ============================================================================
// App Definition (per-app declarative config)
// ============================================================================

export interface IAppDefinition {
  name: string;
  version: string;

  /**
   * Process topology — REQUIRED. Every app declares its processes explicitly.
   * Each process is a Titan @Module running in its own OS process.
   */
  processes: IProcessEntry[];

  /**
   * Infrastructure dependencies — declares what this app needs.
   * Omnitron reads these declarations and:
   * 1. Provisions required infrastructure (Docker/bare-metal)
   * 2. Resolves connection parameters (host/port/credentials)
   * 3. Injects resolved config into the app at startup
   *
   * The app never hardcodes infrastructure addresses — omnitron handles all resolution
   * based on the active environment (dev/test/prod).
   */
  requires?: IAppRequirements;

  /** App-level auth config — inherited by processes that don't specify their own */
  auth?: {
    manager?: any;
    jwt?: { enabled: boolean; tokenCacheTtl?: number };
    rls?: (authCtx: any) => any;
    invocationWrapper?: (meta: Map<string, unknown>, fn: () => Promise<unknown>) => Promise<unknown>;
  };

  config?: {
    sources?: Array<string | { type: 'file' | 'env'; path?: string; prefix?: string; optional?: boolean }>;
    envPrefix?: string;
  };

  shutdown?: {
    timeout?: number;
    priority?: number;
    drainConnections?: boolean;
  };

  /** App-level lifecycle hooks — inherited by processes that don't specify their own */
  hooks?: {
    beforeCreate?: () => Promise<void>;
    afterCreate?: (app: any) => Promise<void>;
    beforeStart?: (app: any) => Promise<void>;
    afterStart?: (app: any) => Promise<void>;
    beforeStop?: (app: any) => Promise<void>;
    afterStop?: () => Promise<void>;
    onHealthCheck?: () => Promise<{ status: 'healthy' | 'degraded' | 'unhealthy' }>;
  };

  /** Infrastructure config read from app's config/default.json omnitron section */
  omnitronConfig?: OmnitronAppConfig;

  env?: Record<string, string>;
  cwd?: string;

  /**
   * Development mode overrides — applied when running via `omnitron dev`.
   * Allows apps to customize their behavior in dev mode without
   * affecting production configuration.
   *
   * Note: file watching is configured at the ecosystem level (omnitron.config.ts)
   * via `IEcosystemAppEntry.watch`, not here — watching is an orchestrator concern.
   */
  dev?: {
    /** Override HTTP port in dev mode */
    port?: number;
    /** Override log level in dev mode (default: 'debug') */
    logLevel?: string;
    /** Enable source maps (default: true in dev) */
    sourceMaps?: boolean;
    /** Additional env vars for dev mode */
    env?: Record<string, string>;
  };

  observability?: {
    metrics?: boolean | { export?: 'prometheus' | 'statsd'; interval?: number };
    tracing?: boolean | { sampler?: number; propagator?: 'w3c' | 'jaeger' };
    logging?: {
      level?: string;
      /** Per-app max log file size before rotation (e.g., '100mb'). Overrides global default. */
      maxSize?: string;
      /** Per-app max number of rotated log files to keep. Overrides global default. */
      maxFiles?: number;
      /** Per-app gzip compression for rotated logs. Overrides global default. */
      compress?: boolean;
    };
  };

}

// =============================================================================
// Declarative App Infrastructure Config (new)
// =============================================================================

/**
 * Declarative infrastructure needs — declared in app's config/default.json
 * under the "omnitron" key. Omnitron reads this, provisions infrastructure,
 * and injects standardized env vars (DATABASE_URL, REDIS_URL, etc.).
 */
export interface OmnitronAppConfig {
  /** PostgreSQL database. true = shared instance, object = extended config. */
  database?: boolean | {
    dialect?: 'postgres' | 'mysql' | 'sqlite';
    pool?: { min?: number; max?: number };
    extensions?: string[];
    dedicated?: boolean;
  };

  /** Redis. true = shared instance with auto-assigned DB index. */
  redis?: boolean | {
    prefix?: string;
    dedicated?: boolean;
  };

  /** S3-compatible object storage. */
  s3?: boolean | {
    bucket?: string;
    quota?: string;
  };

  /** Titan service modules and cross-app dependencies. */
  services?: {
    discovery?: boolean;
    notifications?: boolean;
    /** Cross-app: read priceverse price data from its Redis DB */
    priceverse?: boolean;
  };

  /**
   * Custom infrastructure services this app requires.
   *
   * Each key is a logical service name (e.g., 'bitcoin', 'monero-daemon').
   * Omnitron provisions these services (Docker for dev/test, bare-metal for prod)
   * and injects resolved connection parameters as env vars.
   *
   * @example
   * infrastructure: {
   *   bitcoin: {
   *     type: 'daemon',
   *     networkMode: 'regtest',
   *     ports: { rpc: 18443 },
   *     env: { BITCOIN_RPC_URL: 'http://${host}:${port:rpc}' },
   *     docker: { image: 'lncm/bitcoind:v28.0' }
   *   }
   * }
   */
  infrastructure?: Record<string, import('../infrastructure/types.js').IServiceRequirement>;
}

// Zod schema factory exported from ./index.ts (not here — export type * skips runtime values)

// =============================================================================
// App Infrastructure Requirements (deprecated)
// =============================================================================

/**
 * @deprecated Use OmnitronAppConfig in config/default.json instead.
 */
export interface IAppRequirements {
  /** PostgreSQL database */
  postgres?: {
    database: string;
    pool?: { min?: number; max?: number };
    extensions?: string[];
    migrations?: string; // Relative path to migrations directory
  };
  /** Redis connection */
  redis?: {
    db?: number; // Preferred DB index (omnitron allocates if not specified)
    prefix?: string;
    purpose?: Array<'sessions' | 'cache' | 'ratelimit' | 'notifications' | 'realtime' | 'discovery' | 'streams'>;
  };
  /** S3-compatible object storage */
  s3?: {
    buckets?: string[];
    maxFileSize?: string;
  };
  /** Titan Discovery service (requires Redis) */
  discovery?: boolean;
  /** Titan Notifications (requires Redis) */
  notifications?: boolean;
  /** Custom infrastructure services */
  custom?: Record<string, { image: string; port?: number; env?: Record<string, string> }>;
}

/** Resolved infrastructure config injected into an app at startup */
export interface IResolvedAppConfig {
  database?: { dialect: string; host: string; port: number; database: string; user: string; password: string; pool?: { min: number; max: number } | undefined; ssl?: boolean | undefined } | undefined;
  redis?: { host: string; port: number; db: number; password?: string | undefined; prefix?: string | undefined } | undefined;
  s3?: { endpoint: string; accessKey: string; secretKey: string; bucket: string; forcePathStyle: boolean } | undefined;
  auth?: { jwtSecret: string; algorithm: string } | undefined;
  [key: string]: unknown;
}

// =============================================================================
// Stacks (replaces Environments — unified deployment targets)
// =============================================================================

export type StackName = 'dev' | 'test' | 'staging' | 'prod' | string;

/**
 * Stack configuration — defines WHERE and HOW apps run.
 *
 * Stack types:
 * - `local`: Runs on this machine via PM child processes. Daemon directly supervises.
 * - `remote`: Runs on SSH-accessible server. Daemon deploys and monitors via SSH + follower daemon.
 *   The remote machine runs its own slave omnitron daemon that collects metrics locally
 *   and syncs to master when connectivity is available.
 * - `cluster`: Runs on multiple nodes. Each node runs a slave omnitron daemon.
 *   Slaves are fully autonomous — they collect all metrics, logs, and events locally.
 *   When connection to master is available, accumulated data syncs to master's PostgreSQL.
 */
export interface IStackConfig {
  /** Stack deployment type */
  type: 'local' | 'remote' | 'cluster';
  /** Enable file watching (default: true for dev stacks, false for others) */
  watch?: boolean;
  /** Nodes for remote/cluster stacks */
  nodes?: IStackNode[];
  /** Infrastructure overrides for this stack */
  infrastructure?: Partial<import('../infrastructure/types.js').InfrastructureConfig>;
  /** Stack-specific settings */
  settings?: IStackSettings;
  /** Which apps to run in this stack ('all' or explicit list). Default: 'all' */
  apps?: string[] | 'all';
  /** Auto-allocated port range for this stack's services */
  portRange?: { start: number; end: number };

  /**
   * Per-service overrides for app-declared infrastructure.
   *
   * Keys: `{serviceName}` (global) or `{appName}/{serviceName}` (app-specific).
   * Values: override Docker config, point to external service, or disable.
   *
   * @example
   * serviceOverrides: {
   *   // All apps using 'bitcoin' connect to this bare-metal node:
   *   bitcoin: { external: { host: '10.0.1.5', ports: { rpc: 8332 } } },
   *   // Only paysys's monero uses a custom image:
   *   'paysys/monero-daemon': { docker: { image: 'custom-monerod:latest' } },
   * }
   */
  serviceOverrides?: Record<string, import('../infrastructure/types.js').IServiceOverride>;
}

/**
 * Stack node — a machine participating in a remote or cluster stack.
 *
 * Every node runs its own omnitron daemon (slave) that:
 * 1. Collects ALL metrics, logs, events locally (autonomous operation)
 * 2. Buffers data in local storage when master is unreachable
 * 3. Syncs accumulated data to master when connectivity is restored
 * 4. Continues normal app supervision regardless of master connectivity
 */
export interface IStackNode {
  /** Node hostname or IP */
  host: string;
  /** Omnitron daemon port on this node (default: 9700) */
  port?: number;
  /** Node role in the stack */
  role: 'app' | 'database' | 'cache' | 'gateway' | 'worker' | 'master';
  /** Which apps run on this node (default: all) */
  apps?: string[];
  /** SSH connection config for remote access */
  ssh?: ISSHConfig;
  /** Human-readable label */
  label?: string;
}

export interface ISSHConfig {
  user?: string;
  privateKey?: string;
  /** SSH port (default: 22) */
  port?: number;
}

export interface IStackSettings {
  /** Redis DB offset for this stack (stacks get non-overlapping DB ranges) */
  redisDbOffset?: number;
  /** Docker container name prefix (default: `${project}-${stack}`) */
  containerPrefix?: string;
  /** Custom environment variables injected into all apps in this stack */
  env?: Record<string, string>;
  /** Override log level for all apps in this stack */
  logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  /** Override infrastructure ports for this stack (avoids port conflicts between stacks) */
  portOffsets?: {
    /** Offset added to postgres port (default: 0 for first stack) */
    postgres?: number;
    /** Offset added to redis port (default: 0 for first stack) */
    redis?: number;
    /** Offset added to minio API port (default: 0 for first stack) */
    minio?: number;
  };
}

/**
 * Daemon role in the fleet topology.
 *
 * - `master` (default): Control plane. Manages projects, stacks, deploys.
 *   Aggregates data from slaves. Serves webapp. When running alone on a
 *   single machine — still master, just without slaves.
 * - `slave`: Runs on remote/cluster nodes. Fully autonomous — collects all
 *   metrics and operational data locally. Syncs to master when connectivity
 *   is available. Never depends on master for app supervision.
 */
export type DaemonRole = 'master' | 'slave';

/**
 * Sync configuration for slave→master data replication.
 *
 * Designed for ultra-reliable eventual consistency:
 * - Slaves buffer ALL data locally (SQLite WAL or local PG)
 * - Periodic sync attempts with exponential backoff on failure
 * - Idempotent sync batches (safe to retry)
 * - Conflict resolution: master timestamp wins for config, slave data is append-only
 */
export interface ISyncConfig {
  /** How often slave attempts to sync to master (ms). Default: 30_000 */
  interval?: number;
  /** Maximum batch size per sync operation. Default: 1000 */
  batchSize?: number;
  /** Backoff config for failed sync attempts */
  backoff?: { initial?: number; max?: number; factor?: number };
  /** Data categories to sync (default: all) */
  categories?: Array<'metrics' | 'logs' | 'events' | 'alerts' | 'traces' | 'state'>;
  /** Local buffer storage path (default: ~/.omnitron/sync-buffer/) */
  bufferPath?: string;
  /** Maximum local buffer size before oldest entries are evicted (bytes). Default: 500MB */
  maxBufferSize?: number;
}

// =============================================================================
// Seed Project
// =============================================================================

export interface ISeedProject {
  /** Project name (e.g., 'omni') */
  name: string;
  /** Absolute path to monorepo root containing omnitron.config.ts */
  path: string;
  /** Registered at */
  registeredAt: string;
  /** Stacks that are currently enabled (running or should auto-start) */
  enabledStacks?: string[];
}

export interface IProjectRegistry {
  projects: ISeedProject[];
}

// =============================================================================
// Process Entry — Unified process definition (new topology model)
// =============================================================================

/**
 * Unified process entry — every process in a topology is equal.
 * Each is a Titan @Module running in its own OS process.
 *
 * A process's role is determined by its declarations:
 * - Has `transports`? → It listens on network ports (HTTP, WS, TCP, Unix)
 * - Has `connects`? → It gets topology proxies for calling sibling processes
 * - Has `instances > 1`? → It runs as a PM pool with load balancing
 * - Has `critical`? → App is unhealthy when this process is down
 */
export interface IProcessEntry {
  /** Unique name within the app (e.g., 'api', 'collector', 'aggregator') */
  name: string;

  /**
   * Path to the @Module file (relative to bootstrap.ts).
   * Each process gets its own Application.create(module).
   * The child process imports ONLY this file — no bootstrap.ts reload.
   */
  module: string;

  /** If true, app is considered unhealthy when this process is down */
  critical?: boolean;

  /** Number of instances. >1 creates a PM pool with load balancing. Default: 1 */
  instances?: number;

  /**
   * Topology — controls this process's participation in cross-process
   * Netron service mesh. Without topology, the process runs isolated.
   *
   * - `expose: true` — omnitron auto-discovers @Service metadata from this process
   *   and registers a load-balanced proxy on daemon Netron (pool processes only).
   * - `access: [...]` — list of Netron service names this process needs.
   *   Bootstrap-process connects to daemon and injects Netron proxies into DI
   *   under `createToken('topology:{ServiceName}')`.
   *
   * Note: `access` is a DI convenience, not a security boundary. All processes
   * managed by omnitron share the daemon's Unix socket (mode 0o600, owner-only).
   * Process-level trust is assumed.
   *
   * @example
   * // Pool worker — allow omnitron to expose its @Service on daemon Netron:
   * topology: { expose: true }
   *
   * // Consumer — inject proxies to specific sibling services:
   * topology: { access: ['OhlcvAggregatorWorker'] }
   */
  topology?: {
    /** Auto-expose this process's @Service on daemon Netron (opt-in) */
    expose?: boolean;
    /** Netron service names to inject into DI as topology proxies */
    access?: string[];
  };

  /** Transport listeners for this process */
  transports?: {
    http?: IHttpTransportConfig;
    websocket?: IWebSocketTransportConfig;
  };

  /**
   * Auth config for this process's transports.
   * Inherits from app-level auth if not specified.
   * Set to false to explicitly disable auth.
   */
  auth?: IAppDefinition['auth'] | false;

  /** Health check config */
  health?: {
    enabled?: boolean;
    interval?: number;
    timeout?: number;
    retries?: number;
  };

  /** Startup timeout in ms. @default 30000 */
  startupTimeout?: number;

  /** Auto-scaling (when instances > 1) */
  scaling?: {
    strategy?: 'auto' | 'fixed';
    maxInstances?: number;
    targetCPU?: number;
    targetMemory?: number;
    queueThreshold?: number;
    cooldownPeriod?: number;
  };

  /** Process-specific restart policy */
  restartPolicy?: IRestartPolicy;

  /** Environment variables specific to this process */
  env?: Record<string, string>;

  /** Custom HTTP routes (only relevant if transports.http is set) */
  customRoutes?: Array<{
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    pattern: string;
    handler: (req: Request) => Promise<Response | null>;
  }>;

  /** Lifecycle hooks for this process */
  hooks?: {
    beforeCreate?: () => Promise<void>;
    afterCreate?: (app: any) => Promise<void>;
    beforeStart?: (app: any) => Promise<void>;
    afterStart?: (app: any) => Promise<void>;
    beforeStop?: (app: any) => Promise<void>;
    afterStop?: () => Promise<void>;
    onHealthCheck?: () => Promise<{ status: 'healthy' | 'degraded' | 'unhealthy' }>;
  };

  /** Observability config for this process */
  observability?: {
    metrics?: boolean;
    logging?: { level?: string };
  };

}

// =============================================================================
// Process Topology Entry (DEPRECATED — use IProcessEntry)
// =============================================================================

/**
 * @deprecated Use {@link IProcessEntry} instead. This interface is kept for backward
 * compatibility during migration and will be removed in a future release.
 *
 * Internal process topology entry — describes a single process within an app.
 */
export interface IProcessTopologyEntry {
  /** Unique process name within the app (e.g., 'http', 'aggregator', 'ws') */
  name: string;
  /** @deprecated Process type — no longer used in IProcessEntry. Role is determined by declarations. */
  type: 'server' | 'worker' | 'scheduler' | 'custom';
  /** Module class for this process (Titan @Module) */
  module?: any;
  /** @deprecated Script path — use module instead */
  script?: string;
  /** If true, app is considered unhealthy when this process is down */
  critical?: boolean;
  /** Start after these sibling processes are ready */
  dependsOn?: string[];
  /** Scaling: number of instances of this process */
  instances?: number;
  /** Process-specific restart policy */
  restartPolicy?: IRestartPolicy;
  /** @deprecated Use transports instead */
  transport?: IHttpTransportConfig | IWebSocketTransportConfig;
  /** @deprecated PM isolation mode — no longer configurable per-process */
  isolation?: 'worker' | 'child';
  /** @deprecated PM IPC transport — no longer configurable per-process */
  ipcTransport?: 'ipc' | 'tcp';
  /** Environment variables specific to this process */
  env?: Record<string, string>;
  /** Health check config */
  health?: {
    enabled?: boolean;
    interval?: number;
    timeout?: number;
    retries?: number;
  };

  /** Startup timeout in milliseconds. How long to wait for the process to become ready. @default 30000 */
  startupTimeout?: number;

  /** Auto-scaling configuration for worker pools */
  scaling?: {
    /** Scaling strategy: 'auto' for CPU/queue-based, 'fixed' for static pool size */
    strategy?: 'auto' | 'fixed';
    /** Maximum instances (auto-scale up limit) */
    maxInstances?: number;
  };
}

export interface IHttpTransportConfig {
  port: number;
  host?: string;
  cors?: boolean;
  requestTimeout?: number;
  keepAliveTimeout?: number;
  headersTimeout?: number;
  maxRequestSize?: string;
  appVersion?: string;
}

export interface IWebSocketTransportConfig {
  port: number;
  host?: string;
  path?: string;
  keepAlive?: { interval: number; timeout: number };
}

// ============================================================================
// Ecosystem Configuration (cluster-wide)
// ============================================================================

export interface IEcosystemAppEntry {
  name: string;
  /** Bootstrap mode: app exports defineSystem() */
  bootstrap?: string;
  /** Classic mode: fork existing main.ts */
  script?: string;
  /** Set to false to skip this app during startAll (default: true) */
  enabled?: boolean;
  /** If true, daemon shuts down when this app crashes beyond maxRestarts */
  critical?: boolean;
  /** Start after these apps are healthy */
  dependsOn?: string[];
  /** Override instances for this app */
  instances?: number;
  /** Per-app environment variables */
  env?: Record<string, string>;
  /** Per-app restart policy override */
  restartPolicy?: IRestartPolicy;
  /** Startup timeout in ms (overrides global resources.timeout). Useful for apps with slow init (e.g. blockchain wallet connections) */
  startupTimeout?: number;
  /**
   * Watch configuration for dev mode (`omnitron dev`).
   *
   * - `string`: directory to watch (relative to cwd or absolute)
   * - `IWatchConfig`: full watch configuration
   * - `false`: disable watching for this app
   *
   * If not specified, auto-detected from bootstrap/script path
   * (walks up to nearest package.json).
   */
  watch?: string | IWatchConfig | false;
}

export interface IWatchConfig {
  /** Directory to watch (relative to cwd or absolute) */
  directory: string;
  /** Additional directories to watch */
  include?: string[];
  /** Glob patterns to ignore (added to defaults: node_modules, dist, .git, etc.) */
  ignore?: string[];
  /** Debounce interval in ms (default: 300) */
  debounce?: number;
}

// =============================================================================
// Daemon Config — Internal omnitron daemon configuration
// NOT part of project config (omnitron.config.ts). Managed by omnitron itself.
// =============================================================================

export interface IDaemonConfig {
  /** Unix socket path for local CLI ↔ daemon RPC (high-performance, secure) */
  socketPath: string;
  /** TCP port for remote omnitron ↔ omnitron fleet RPC */
  port: number;
  /** TCP host for remote fleet RPC (use '0.0.0.0' for remote access) */
  host: string;
  /** HTTP port for webapp portal ↔ daemon Netron RPC */
  httpPort: number;
  pidFile: string;
  stateFile: string;
  /** Base log directory — omnitron auto-creates per-project/per-app subdirectories */
  logDir: string;

  /**
   * Daemon role in the fleet topology.
   * - `master` (default): Control plane, aggregates data from slaves, serves webapp
   * - `slave`: Autonomous node on remote/cluster, syncs to master when available
   */
  role: DaemonRole;

  /** Master daemon address (required when role = 'slave'). */
  master?: { host: string; port: number };

  /** Sync configuration for slave→master data replication. */
  sync?: ISyncConfig;

  /**
   * Cluster configuration — enables multi-node operation with
   * leader election, config replication, and coordinated failover.
   */
  cluster?: {
    enabled: boolean;
    discovery: 'redis' | 'static';
    peers?: string[];
    electionTimeout?: { min: number; max: number };
    heartbeatInterval?: number;
  };

  /**
   * Encrypted secrets management — stores sensitive values
   * (API keys, DB passwords, signing keys) encrypted at rest.
   */
  secrets?: {
    provider: 'file' | 'env';
    path?: string;
    passphrase?: string;
  };

  /** Authentication for the Omnitron portal. */
  auth?: {
    jwtSecret?: string;
  };

  /** Health monitor worker configuration */
  healthMonitor?: {
    /** Check interval in ms (default: 30_000) */
    intervalMs?: number;
    /** Max concurrent node checks (default: 20) */
    concurrency?: number;
    /** Default offline timeout in ms (default: 90_000) */
    offlineTimeoutMs?: number;
    /** Whether to enable ICMP ping (default: true) */
    pingEnabled?: boolean;
    /** Ping timeout ms (default: 5_000) */
    pingTimeout?: number;
    /** SSH timeout ms (default: 10_000) */
    sshTimeout?: number;
    /** Omnitron check timeout ms (default: 15_000) */
    omnitronCheckTimeout?: number;
    /** Check history retention in days (default: 90) */
    retentionDays?: number;
    /** Uptime bar bucket interval in ms (default: 86_400_000 = 24h) */
    uptimeIntervalMs?: number;
  };
}

// =============================================================================
// Ecosystem Config — Project configuration (omnitron.config.ts)
// =============================================================================

export interface IEcosystemConfig {
  /** Project display name (shown in webapp, CLI) */
  project?: string;

  apps: IEcosystemAppEntry[];

  /**
   * Stack definitions — deployment targets that run simultaneously.
   * Each stack specifies WHERE apps run and HOW infrastructure is configured.
   */
  stacks?: Record<StackName, IStackConfig>;

  /**
   * Infrastructure services managed by Omnitron via Docker.
   * Replaces docker-compose.yml + .env files — everything declared here.
   * Omnitron provisions, monitors, and self-heals these services.
   */
  infrastructure?: import('../infrastructure/types.js').InfrastructureConfig;

  /**
   * API Gateway configuration (OpenResty + Lua).
   * Omnitron provisions a gateway container per stack, mounting configs from configDir.
   * Gateway handles: reverse proxy, maintenance mode (Redis), rate limiting, future PoW captcha.
   */
  gateway?: {
    port?: number;       // Default: 8080
    configDir?: string;  // Path to nginx configs (default: 'infra/nginx')
    image?: string;      // Default: 'openresty/openresty:alpine'
  };

  supervision: {
    strategy: 'one_for_one' | 'one_for_all' | 'rest_for_one';
    maxRestarts: number;
    window: number;
    backoff: IBackoffOptions;
  };

  monitoring: {
    healthCheck: { interval: number; timeout: number };
    metrics: { interval: number; retention: number };
  };

  logging: {
    level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
    maxSize: string;
    maxFiles: number;
    compress: boolean;
  };
}

// ============================================================================
// Runtime DTOs
// ============================================================================

export type AppStatus = 'stopped' | 'starting' | 'online' | 'stopping' | 'errored' | 'crashed';

export interface ProcessInfoDto {
  /** App name (e.g., 'main', 'storage') */
  name: string;
  /** Main PID (or null if stopped) */
  pid: number | null;
  status: AppStatus;
  cpu: number;
  memory: number;
  uptime: number;
  restarts: number;
  instances: number;
  port: number | null;
  mode: 'classic' | 'bootstrap';
  /** If true, daemon shuts down when this app crashes */
  critical: boolean;
  /** Sub-processes within this app (from process topology) */
  processes?: SubProcessInfoDto[];
}

export interface SubProcessInfoDto {
  /** Process name within the app (e.g., 'http', 'aggregator') */
  name: string;
  type: 'server' | 'worker' | 'scheduler' | 'custom';
  pid: number | null;
  status: AppStatus;
  cpu: number;
  memory: number;
  uptime: number;
  restarts: number;
}

export interface DaemonStatusDto {
  version: string;
  pid: number;
  uptime: number;
  apps: ProcessInfoDto[];
  totalCpu: number;
  totalMemory: number;
}

export interface AggregatedMetricsDto {
  timestamp: number;
  apps: Record<
    string,
    {
      cpu: number;
      memory: number;
      requests?: number;
      errors?: number;
      latency?: { p50: number; p95: number; p99: number; mean: number };
    }
  >;
  totals: {
    cpu: number;
    memory: number;
  };
}

export interface AggregatedHealthDto {
  timestamp: number;
  overall: 'healthy' | 'degraded' | 'unhealthy';
  apps: Record<
    string,
    {
      status: 'healthy' | 'degraded' | 'unhealthy';
      checks: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; message?: string }>;
    }
  >;
}

export interface LogEntryDto {
  timestamp: number;
  app: string;
  level: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface AppDiagnosticsDto {
  name: string;
  pid: number | null;
  status: AppStatus;
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    arrayBuffers: number;
    rss: number;
  };
  uptime: number;
  restarts: number;
  services: string[];
  config: Record<string, unknown>;
}
