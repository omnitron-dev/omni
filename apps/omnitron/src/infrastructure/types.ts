/**
 * Infrastructure Types — Declarative infrastructure definitions
 *
 * These types describe the desired state of infrastructure services
 * (PostgreSQL, Redis, MinIO, etc.) that Omnitron provisions and manages
 * via Docker containers. They form the infrastructure section of
 * omnitron.config.ts.
 */

// =============================================================================
// Service Definitions
// =============================================================================

export interface PostgresServiceConfig {
  image?: string; // Default: 'postgres:17-alpine'
  port?: number; // Default: 5432
  databases: Record<string, PostgresDatabaseConfig>;
  user?: string; // Default: 'postgres'
  password?: string | SecretRef;
  config?: {
    maxConnections?: number; // Default: 200
    sharedBuffers?: string; // Default: '256MB'
    effectiveCacheSize?: string;
    workMem?: string;
    maintenanceWorkMem?: string;
    logMinDurationStatement?: number; // ms, -1 to disable
  };
  resources?: ResourceLimits;
}

export interface PostgresDatabaseConfig {
  /** Override user/password for this specific database */
  user?: string;
  password?: string | SecretRef;
  /** Run migrations on startup */
  migrate?: boolean;
  /** Migration directory relative to app root */
  migrationDir?: string;
}

export interface RedisServiceConfig {
  image?: string; // Default: 'redis:latest'
  port?: number; // Default: 6379
  password?: string | SecretRef;
  config?: {
    maxmemory?: string; // Default: '2gb'
    maxmemoryPolicy?: string; // Default: 'noeviction'
    appendonly?: boolean; // Default: true
  };
  /** Named DB allocations: { main: 0, storage: 1, messaging: 2 } */
  databases?: Record<string, number>;
  resources?: ResourceLimits;
}

export interface MinioServiceConfig {
  image?: string; // Default: 'minio/minio'
  ports?: { api?: number; console?: number }; // Default: 9000, 9001
  accessKey?: string;
  secretKey?: string | SecretRef;
  buckets?: string[];
  resources?: ResourceLimits;
}

export interface GatewayServiceConfig {
  image?: string; // Default: 'openresty/openresty:alpine'
  port?: number; // Default: 8080
  /** Path to gateway config directory (relative to project root), containing nginx.conf, lua/, maintenance.html */
  configDir?: string; // Default: 'infra/nginx'
  /** Redis DB index for gateway state — auto-allocated by omnitron (set internally, NOT in user config) */
  redisDb?: number;
  /** Auto-generated from app transport definitions if not specified */
  customConfig?: string;
  resources?: ResourceLimits;
}

export interface TorServiceConfig {
  image?: string; // Default: 'goldy/tor-hidden-service'
  /** Map of virtual port → target host:port */
  hiddenServicePorts?: Record<number, string>;
  resources?: ResourceLimits;
}

export interface GenericContainerConfig {
  image: string;
  ports?: Record<string, number>; // name → hostPort
  environment?: Record<string, string>;
  volumes?: string[];
  command?: string[];
  healthCheck?: ContainerHealthCheck;
  resources?: ResourceLimits;
  dependsOn?: string[];
}

// =============================================================================
// Infrastructure Definition (top-level config section)
// =============================================================================

export interface InfrastructureConfig {
  /**
   * Unified services map — the canonical way to declare infrastructure.
   * Each key is a logical service name. Values are either:
   * - IServiceRequirement (full custom definition)
   * - IPresetServiceConfig (shorthand referencing a registered preset)
   *
   * Example:
   * ```typescript
   * services: {
   *   db: { preset: 'postgres', config: { databases: { main: {}, storage: {} } } },
   *   cache: { preset: 'redis' },
   *   storage: { preset: 'minio', config: { buckets: ['uploads'] } },
   *   gateway: { preset: 'openresty', config: { configDir: './infra/nginx' } },
   * }
   * ```
   */
  services?: Record<string, IServiceRequirement | import('./presets/types.js').IPresetServiceConfig>;

  // Legacy fields — kept for backward compatibility during transition
  postgres?: PostgresServiceConfig;
  redis?: RedisServiceConfig;
  minio?: MinioServiceConfig;
  gateway?: GatewayServiceConfig;
  tor?: TorServiceConfig;
  containers?: Record<string, GenericContainerConfig>;
}

// =============================================================================
// Container State (runtime)
// =============================================================================

export type ContainerStatus = 'not_found' | 'created' | 'running' | 'paused' | 'restarting' | 'exited' | 'dead';

export interface ContainerState {
  name: string;
  image: string;
  status: ContainerStatus;
  containerId?: string | undefined;
  ports?: Record<string, number> | undefined;
  health?: 'healthy' | 'unhealthy' | 'starting' | 'none' | undefined;
  startedAt?: string | undefined;
  error?: string | undefined;
}

export interface InfrastructureState {
  services: Record<string, ContainerState>;
  ready: boolean;
  lastReconciled?: string;
}

// =============================================================================
// Shared Types
// =============================================================================

export interface SecretRef {
  /** Secret key name in the secrets store */
  secret: string;
}

export interface ResourceLimits {
  memory?: string; // e.g., '2gb'
  memoryReservation?: string;
  cpus?: number;
  shmSize?: string;
}

export interface ContainerHealthCheck {
  test: string[];
  interval?: string; // Default: '5s'
  timeout?: string; // Default: '5s'
  retries?: number; // Default: 5
  startPeriod?: string;
}

// =============================================================================
// Unified Service Requirements (app-level infrastructure declarations)
// =============================================================================

/**
 * Declares what an app needs from an infrastructure service,
 * independent of how it is provisioned.
 *
 * Apps declare these in config/default.json under `omnitron.infrastructure`.
 * The active stack decides whether to provision via Docker, bare-metal, or
 * connect to an external service.
 */
export interface IServiceRequirement {
  /** Human-readable description. Shown in `omnitron status --infra`. */
  description?: string;

  /**
   * Service type category. Affects default provisioning behavior.
   * - 'database': Data persistence (gets volumes, backup policies)
   * - 'cache': Ephemeral data (may skip volumes)
   * - 'daemon': Long-running process (blockchain nodes, queue brokers)
   * - 'sidecar': Lightweight helper (proxies, adapters)
   * - 'tool': Run-once or periodic (migrations, seeders)
   */
  type?: 'database' | 'cache' | 'daemon' | 'gateway' | 'storage' | 'sidecar' | 'tool';

  /**
   * Named ports this service exposes.
   * Keys are logical names, values are the default port numbers.
   * The provisioner maps these to actual endpoints.
   */
  ports: Record<string, number>;

  /**
   * Environment variables to inject into the APP (not the service container).
   * Values can reference resolved service properties using templates:
   *   ${host}          — resolved hostname/IP
   *   ${port:rpc}      — resolved port for the named port 'rpc'
   *   ${secret:name}   — resolved secret value
   */
  env: Record<string, string>;

  /** Health check definition. */
  healthCheck?: IServiceHealthCheck;

  /**
   * Services this service depends on (by logical name).
   * Provisioner ensures dependencies start first and are healthy.
   */
  dependsOn?: string[];

  /**
   * Secrets this service needs. Keys are logical names.
   * Referenced in env templates as ${secret:keyName}.
   * Values: literal strings (dev) or SecretRef (prod).
   */
  secrets?: Record<string, string | SecretRef>;

  /**
   * Docker provisioning — used for dev/test stacks.
   * If omitted, service must be provisioned externally.
   */
  docker?: IDockerServiceConfig;

  /** Bare-metal provisioning hints — used for prod stacks. */
  bareMetal?: IBareMetalServiceConfig;

  /** Version constraint (semver range). */
  version?: string;

  /**
   * Network mode — domain-specific, interpreted by the service.
   * Selects the matching variant from docker/bareMetal configs.
   * @example 'regtest' | 'testnet' | 'mainnet' | 'stagenet'
   */
  networkMode?: string;

  /** If true, app will not start until this service is healthy. Default: true. */
  critical?: boolean;

  /** Startup timeout in ms. Default: 120_000. */
  startupTimeout?: number;

  /** @internal Preset name that generated this requirement (set by PresetRegistry.expand) */
  _preset?: string;

  /** @internal User config passed to preset (for postProvision hooks) */
  _presetConfig?: Record<string, unknown>;
}

/**
 * Docker-specific provisioning for a custom service.
 */
export interface IDockerServiceConfig {
  /** Docker image. Required unless `build` is specified. */
  image?: string;

  /** Build context for building from Dockerfile. Paths relative to app root. */
  build?: {
    context: string;
    dockerfile?: string;
    args?: Record<string, string>;
    /** Pre-built image tag. If exists, skip build. */
    tag?: string;
  };

  /**
   * Host port overrides. Keys match port names in IServiceRequirement.ports.
   * If not specified, host ports = container ports.
   */
  portMappings?: Record<string, number>;

  /** Bind host side of port mappings. Default: '127.0.0.1'. */
  bindHost?: string;

  /** Container environment variables (for the SERVICE, not the app). */
  environment?: Record<string, string>;

  /**
   * Named volumes. Auto-prefixed with stack container prefix.
   * String value = mount path. Object = full mount spec.
   */
  volumes?: Record<string, string | IVolumeMount>;

  /** Container command override. */
  command?: string[];

  /** Container entrypoint override. */
  entrypoint?: string[];

  /** Container user. */
  user?: string;

  /** Docker health check (overrides IServiceRequirement.healthCheck). */
  healthCheck?: ContainerHealthCheck;

  /** Resource limits. */
  resources?: ResourceLimits;

  /** Restart policy. Default: 'unless-stopped'. */
  restart?: string;

  /** Shared memory size. */
  shmSize?: string;

  /** Docker network to join. */
  network?: string | IDockerNetworkConfig;

  /** Extra Docker labels. */
  labels?: Record<string, string>;

  /**
   * Variants keyed by networkMode. When IServiceRequirement.networkMode
   * matches a key, the variant is deep-merged over the base config.
   */
  variants?: Record<string, Partial<Omit<IDockerServiceConfig, 'variants'>>>;
}

export interface IVolumeMount {
  /** Host path (bind mount) or named volume name. */
  source: string;
  /** Container path. */
  target: string;
  /** Read-only mount. */
  readonly?: boolean;
}

export interface IDockerNetworkConfig {
  name: string;
  driver?: 'bridge' | 'host' | 'overlay';
  subnet?: string;
  gateway?: string;
  ipv4Address?: string;
}

/**
 * Bare-metal provisioning hints for production deployments.
 */
export interface IBareMetalServiceConfig {
  /** Package install command. */
  installCommand?: string;

  /** Systemd service name. */
  systemdUnit?: string;

  /** Config file path on target machine. */
  configFile?: string;

  /** Template for the config file (uses ${...} syntax). */
  configTemplate?: string;

  /** Data directory. Omnitron ensures it exists with correct permissions. */
  dataDir?: string;

  /** User to run the service as. */
  user?: string;

  /** Bind address for remote/cluster stacks. */
  bindAddress?: string;

  /** Validation command to check if service is installed. */
  validateCommand?: string;

  /** Variants keyed by networkMode. */
  variants?: Record<string, Partial<Omit<IBareMetalServiceConfig, 'variants'>>>;
}

/**
 * Health check definition — provisioner-agnostic.
 */
export interface IServiceHealthCheck {
  /**
   * Check type:
   * - 'http': HTTP GET, expect 2xx
   * - 'tcp': TCP connect to port
   * - 'command': Shell command, check exit code
   * - 'jsonrpc': JSON-RPC call (for blockchain daemons)
   */
  type: 'http' | 'tcp' | 'command' | 'jsonrpc';

  /**
   * For 'http': URL path. For 'tcp': port name.
   * For 'command': shell command. For 'jsonrpc': method name.
   */
  target: string;

  /** Interval between checks. Default: '30s'. */
  interval?: string;
  /** Timeout per check. Default: '10s'. */
  timeout?: string;
  /** Consecutive failures before unhealthy. Default: 5. */
  retries?: number;
  /** Grace period before first check. Default: '30s'. */
  startPeriod?: string;

  /** JSON-RPC specific config. */
  jsonrpc?: {
    port: string;
    method: string;
    /** URL path for JSON-RPC endpoint. Default '/json_rpc' (Monero). Set '' for root '/' (some daemons). */
    path?: string;
    auth?: { user: string; password: string; type?: 'digest' | 'basic' };
  };
}

/**
 * Stack-level service override. Lets a stack redirect an app-declared
 * service to an external provider or customize Docker config.
 */
export interface IServiceOverride {
  /** External service — skip provisioning, just connect. */
  external?: {
    host: string;
    ports: Record<string, number>;
    secrets?: Record<string, string | SecretRef>;
  };

  /** Override Docker config for this stack. Deep-merged over app declaration. */
  docker?: Partial<IDockerServiceConfig>;

  /** Override bare-metal config. */
  bareMetal?: Partial<IBareMetalServiceConfig>;

  /** Disable this service in this stack. */
  disabled?: boolean;
}

/**
 * Resolved address for a custom service — used by config resolver
 * to generate env vars from templates.
 */
export interface IResolvedServiceAddress {
  host: string;
  ports: Record<string, number>;
  secrets?: Record<string, string>;
}

// =============================================================================
// Reconciliation
// =============================================================================

export type ReconcileAction =
  | { type: 'create'; service: string; config: ResolvedContainer }
  | { type: 'start'; service: string; containerId: string }
  | { type: 'recreate'; service: string; config: ResolvedContainer; reason: string }
  | { type: 'remove'; service: string; containerId: string }
  | { type: 'noop'; service: string };

export interface ResolvedContainer {
  name: string;
  image: string;
  ports: Array<{ host: number; container: number }>;
  environment: Record<string, string>;
  volumes: Array<{ source: string; target: string; readonly?: boolean }>;
  command?: string[] | undefined;
  entrypoint?: string[] | undefined;
  /** If false, provisioning continues without waiting for this container to be healthy. */
  critical?: boolean;
  healthCheck?: ContainerHealthCheck | undefined;
  labels: Record<string, string>;
  restart: string;
  shmSize?: string | undefined;
  resources?: ResourceLimits | undefined;
  /** Extra /etc/hosts entries (e.g., 'host.docker.internal:host-gateway') */
  extraHosts?: string[] | undefined;
}
