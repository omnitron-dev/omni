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
    /** Unset means postgres decides — better than a number picked without
     * knowing the machine. Same for the three below. */
    effectiveCacheSize?: string;
    workMem?: string;
    maintenanceWorkMem?: string;
    logMinDurationStatement?: number; // ms, default 1000, -1 to disable
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
  /**
   * PostgreSQL extensions to create in this database, e.g. `['postgis']`.
   *
   * `CREATE EXTENSION IF NOT EXISTS` runs after the database is created. The
   * extension must be present in the image: the stock `postgres:17-alpine`
   * carries the contrib set (uuid-ossp, pg_trgm, hstore, …) but not postgis,
   * so a service needing that also needs an `image` override — the
   * provisioner says which extension failed and why rather than leaving the
   * app to fail on its first query.
   */
  extensions?: string[];
}

export interface RedisServiceConfig {
  image?: string; // Default: 'redis:latest'
  port?: number; // Default: 6379
  password?: string | SecretRef;
  config?: {
    /**
     * Memory ceiling, e.g. '2gb'. No default — unset means redis has none,
     * which is what it had regardless of this field until the preset started
     * reading it. An eviction policy without a ceiling never evicts.
     */
    maxmemory?: string;
    /** Default: 'allkeys-lru'. Documented as 'noeviction' while the preset
     * hardcoded 'allkeys-lru' — the two say the opposite thing about what
     * happens when memory fills. */
    maxmemoryPolicy?: string;
    appendonly?: boolean; // Default: true
  };
  /** Named DB allocations: { main: 0, storage: 1, messaging: 2 } */
  databases?: Record<string, number>;
  resources?: ResourceLimits;
}

export interface MinioServiceConfig {
  image?: string; // Default: the minio preset's pinned quay.io image
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
  /**
   * A built frontend for the gateway to serve at `/`, relative to the project
   * root — `apps/portal/dist`.
   *
   * The gateway's nginx.conf serves `/` two ways: with `PORTAL_DEV_UPSTREAM`
   * set it reverse-proxies to a Vite dev server, and without it serves a
   * static build from `/var/www/portal`. On a laptop the first applies. On a
   * node there is no Vite, so the second does — and nothing put anything at
   * that path: measured on the test server, a gateway with four mounts, none
   * of them the portal, answering the onion with 504 because the directory it
   * serves from does not exist.
   *
   * Declared rather than assumed, because which build a stack serves is the
   * stack's decision — a test node and a production node may serve different
   * ones, and neither is guessable from the gateway's own config.
   */
  staticDir?: string;
  /**
   * Environment for building `staticDir`, when the deployment finds it stale.
   *
   * A frontend build can refuse to guess. The daos portal does exactly that:
   *
   *     VITE_AUTH_TRANSPORT must be set explicitly for a production build.
   *       cookie — HttpOnly cookies, nothing in browser storage …
   *
   * — and it is right to, because the choice is compiled into the bundle and
   * a wrong guess is an auth mode nobody asked for. A `.env.development`
   * answers it for `vite dev` and there is no production counterpart, so the
   * deployment has to say. The stack is where it belongs: which build a node
   * serves is the stack's decision, and so is how that build is made.
   */
  staticEnv?: Record<string, string>;
  /** Redis DB index for gateway state — auto-allocated by omnitron (set internally, NOT in user config) */
  redisDb?: number;
  /** Auto-generated from app transport definitions if not specified */
  customConfig?: string;
  /** Extra environment variables passed to the gateway container (merged over the preset defaults). */
  env?: Record<string, string>;
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
  /** Published ports as `"80/tcp" -> 9800`. Absent when nothing is published. */
  ports?: Record<string, number> | undefined;
  health?: 'healthy' | 'unhealthy' | 'starting' | 'none' | undefined;
  startedAt?: string | undefined;
  error?: string | undefined;
  /** Desired-spec fingerprint from the omnitron.spec-hash label (config-drift detection). */
  specHash?: string | undefined;
  /**
   * Which declared service this container IS, from the `omnitron.service`
   * label — `postgres`, `redis`, `omnitron-pg`.
   *
   * The NAME carries a project-and-environment prefix (`daos-test-postgres`),
   * so it answers "which deployment" and not "which service". Anything that
   * needs the second must read this: guessing the name works only on a host
   * whose prefix happens to match the guess.
   */
  service?: string | undefined;
  /**
   * Which deployment this container belongs to, from the `omnitron.project`
   * and `omnitron.stack` labels.
   *
   * Written by `stackLabels()` at creation and therefore the container's own
   * account of itself — as against the NAME, which only happens to start
   * with the same words. A sweep that decides what to remove has to read
   * this, because a daemon's idea of which stacks exist can be empty for
   * reasons that have nothing to do with the container.
   */
  project?: string | undefined;
  stack?: string | undefined;
  /**
   * The app this container was provisioned for, from the `omnitron.app`
   * label — an app's `requires.custom` service (`bitcoin` for paysys).
   * Absent for a service the stack provisions for all its apps: postgres,
   * redis, the gateway. The one declared edge between a container and an
   * app; anything drawn beyond it is a guess.
   */
  app?: string | undefined;
  /** False when a 'running' container is detached from all networks (OrbStack/dockerd restart artifact). */
  networkAttached?: boolean | undefined;
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
  /**
   * A directory of this project the service's container bind-mounts from —
   * scripts, templates. Shipped to every node that runs the service, where
   * the container mounts the node's copy instead of a path that exists only
   * on the master (`infrastructure/shipped-config.ts`). Relative to the
   * project root, or absolute.
   */
  configDir?: string;

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

  /**
   * Extra `/etc/hosts` entries inside the container, in `host:ip` format.
   * Use `host.docker.internal:host-gateway` for cross-platform host access
   * (works on macOS, Windows and Linux ≥ 20.10).
   */
  extraHosts?: string[];

  /** Extra Docker labels. */
  labels?: Record<string, string>;

  /**
   * Variants keyed by networkMode. When IServiceRequirement.networkMode
   * matches a key, the variant is deep-merged over the base config. Its
   * `ports` are the ones the service listens on in that network, over
   * `IServiceRequirement.ports` (`bindService`).
   */
  variants?: Record<string, Partial<Omit<IDockerServiceConfig, 'variants'>> & { ports?: Record<string, number> }>;
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

  /**
   * How to ask the service on the node how it is — over
   * `IServiceRequirement.healthCheck`, which a container may have to answer
   * otherwise: paysys checks its Bitcoin container with `bitcoin-cli
   * -regtest`, the image carrying no HTTP client, and that says nothing of a
   * mainnet unit.
   */
  healthCheck?: IServiceHealthCheck;

  /**
   * The systemd unit, when the host has none to adopt.
   *
   * A package that ships its own unit needs nothing here — omnitron adopts
   * it, and `systemdUnit` alone says which. A binary installed from an
   * upstream tarball ships no unit, and the alternative to declaring one is
   * an `installCommand` that writes a service file as a side effect of
   * "installing", which is where hardening goes to be forgotten.
   *
   * Same `${...}` vocabulary as `configTemplate`. Written to
   * `/etc/systemd/system/${systemdUnit}.service` unless `unitFile` says
   * otherwise, and never over a unit omnitron did not write.
   */
  unitTemplate?: string;

  /** Where the unit goes. Default: `/etc/systemd/system/${systemdUnit}.service`. */
  unitFile?: string;

  /**
   * Variants keyed by networkMode. A variant's `ports` are the ones the
   * service listens on in that network, over `IServiceRequirement.ports`
   * (`bindService`).
   */
  variants?: Record<string, Partial<Omit<IBareMetalServiceConfig, 'variants'>> & { ports?: Record<string, number> }>;
}

/**
 * A chain the node already holds, taken over rather than synced again.
 *
 * The test node keeps mainnet Bitcoin — 149 GB, pruned — in a snap's home
 * (`/root/snap/bitcoin-core/common/.bitcoin`), run by a unit a person wrote
 * (`bitcoin.service`). Declared as a system service, its `dataDir` did not
 * exist, so a deployment would have created it empty and started the daemon
 * on it: the same chain synced a second time, for days, beside the first.
 *
 * A node's own history, so a stack's to say (`serviceOverrides.<name>.bareMetal`)
 * and never an application's.
 */
export interface IBareMetalAdoption {
  /** Where the chain is now. Renamed to `dataDir` — on one filesystem, never copied — and given to `user`. */
  from: string;
  /** The unit that ran it, disabled before the move so it never starts on a directory that has gone. */
  replaces?: string;
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
    /**
     * `digest`/`basic` name the declaration's own credentials, which a stack
     * replaces with its own of the same name. `cookie` names the file a
     * daemon writes into its data directory while it runs — Bitcoin Core's
     * `.cookie`, `__cookie__:<64 hex>`, 0600, written beside `rpcauth` and
     * removed when it stops (measured on 31.0) — read on the node only.
     */
    auth?: { user: string; password: string; type?: 'digest' | 'basic' } | { type: 'cookie'; file: string };
    /**
     * The fields of the answer that say how far the service is — what
     * `infra inspect` prints of it, in this order; `--json` has them all.
     * monerod's `get_info` answers some fifty, and its network, height and
     * sync state are not among the first twelve.
     */
    report?: string[];
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

  /** Override bare-metal config — and, the node's own history, a chain to take over. */
  bareMetal?: Partial<IBareMetalServiceConfig> & { adopt?: IBareMetalAdoption };

  /**
   * How this stack runs the service: as a container (`docker`) or as a
   * system service on the node (`bareMetal`). `external` above says it runs
   * somewhere else entirely.
   *
   * A declaration may carry both blocks — paysys's bitcoin does: a container
   * for a laptop, a hardened systemd unit for a server — and nothing chose
   * between them: a node given the service made the container AND planned
   * the unit. Unsaid, a service with a docker block is a container, and one
   * with only a bare-metal block is a system service (`bindService`).
   */
  provisioning?: 'docker' | 'bareMetal';

  /**
   * The credentials this stack gives the service — vault references,
   * resolved by the master before anything leaves it.
   *
   * An application's own `secrets` are the ones for the network IT declares,
   * which is a laptop's (`omni_regtest_dev_password`, in git). A stack that
   * runs the service on another network must say its credentials here; the
   * application's are never used for it, and a template that needs one the
   * stack did not give is refused rather than filled.
   */
  secrets?: Record<string, string | SecretRef>;

  /** Ports this stack's network uses where they differ from the declaration's. */
  ports?: Record<string, number>;

  /**
   * Which network this service runs on IN THIS STACK.
   *
   * `networkMode` selects the variant of both the docker and bare-metal
   * blocks, and it was declared by the application and fixed there — so an
   * app that declares `regtest`, which is the right answer on a laptop, ran
   * regtest everywhere. A stack is exactly the scope that knows otherwise:
   * the same declaration is a throwaway chain in `dev` and a real one on a
   * server, and nothing else in the config can express the difference.
   *
   * It is a deliberate thing to write. A stack pointed at mainnet says so in
   * one place an operator reads before deploying, rather than in a variant
   * buried in an application's defaults.
   */
  networkMode?: string;

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
  /**
   * Published ports. `bindHost` restricts which interface Docker publishes
   * on — omitted means every interface, which is Docker's default and is
   * almost never what a control plane wants.
   */
  ports: Array<{ host: number; container: number; bindHost?: string }>;
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
  /**
   * The content of the files this container bind-mounts from its config
   * directory, as one digest — part of the spec hash, so a changed file
   * recreates the container.
   *
   * The mounts name PATHS, and a path does not change when its file does. A
   * gateway reads nginx.conf once, when its entrypoint renders it, so without
   * this a corrected template reached the node, was written over the old one,
   * and the running gateway went on serving the old one for as long as its
   * static bundle did not change.
   *
   * Absent for a container that mounts no config files, which leaves its
   * spec hash what it was before this field existed.
   */
  configDigest?: string | undefined;
  /**
   * Docker network this container joins. When unset, Docker assigns the
   * default `bridge` network — which is known to accumulate phantom
   * endpoints after dockerd restarts / host sleep on macOS, blocking
   * recreate with "endpoint with name X already exists in network bridge".
   * Managed containers should default to a named bridge (e.g.
   * `omni-dev_default`) to sidestep that class of failure.
   */
  network?: string | undefined;
}
