---
module: omnitron
title: "Configuration System"
tags: [config, ecosystem, apps, infrastructure, environments]
summary: "Configuration system: omnitron.config.ts format, IEcosystemConfig structure, IAppDefinition with processes and requirements, infrastructure declarations, stacks, and daemon config."
depends_on: [architecture]
---

# Configuration System

## Two Configuration Layers

Omnitron has two distinct configuration layers:

1. **Project config** (`omnitron.config.ts`): Declares apps, infrastructure, stacks, supervision. Lives in the project monorepo root. Uses `defineEcosystem()`.
2. **Daemon config** (`IDaemonConfig`): Internal daemon operational settings -- ports, paths, role. Not user-facing. Managed by the daemon itself with defaults in `src/config/defaults.ts`.

## omnitron.config.ts Format

The project config file uses `defineEcosystem()` which applies defaults and returns a complete `IEcosystemConfig`:

```typescript
// omnitron.config.ts
import { defineEcosystem } from '@omnitron-dev/omnitron';

export default defineEcosystem({
  project: 'omni',
  apps: [
    {
      name: 'main',
      bootstrap: 'apps/main/src/bootstrap.ts',
      critical: true,
      dependsOn: [],
    },
    {
      name: 'storage',
      bootstrap: 'apps/storage/src/bootstrap.ts',
      dependsOn: ['main'],
      startupTimeout: 60_000,
    },
    {
      name: 'messaging',
      bootstrap: 'apps/messaging/src/bootstrap.ts',
      dependsOn: ['main'],
    },
  ],

  stacks: {
    dev: { type: 'local', watch: true },
    staging: {
      type: 'remote',
      nodes: [{ host: '10.0.1.5', role: 'app', ssh: { user: 'deploy' } }],
    },
    prod: {
      type: 'cluster',
      nodes: [
        { host: '10.0.1.10', role: 'master' },
        { host: '10.0.1.11', role: 'app' },
        { host: '10.0.1.12', role: 'app' },
      ],
    },
  },

  infrastructure: {
    postgres: { port: 5480, databases: ['main', 'storage', 'messaging'] },
    redis: { port: 6379 },
    minio: { port: 9000 },
  },

  supervision: {
    strategy: 'one_for_one',
    maxRestarts: 5,
    window: 60_000,
    backoff: { type: 'exponential', initial: 1_000, max: 30_000, factor: 2 },
  },

  monitoring: {
    healthCheck: { interval: 15_000, timeout: 5_000 },
    metrics: { interval: 5_000, retention: 3600 },
  },

  logging: {
    level: 'info',
    maxSize: '50mb',
    maxFiles: 10,
    compress: true,
  },
});
```

### defineEcosystem()

`src/config/define-ecosystem.ts` merges user config with `DEFAULT_ECOSYSTEM`:

```typescript
export function defineEcosystem(
  config: Partial<IEcosystemConfig> & Pick<IEcosystemConfig, 'apps'>
): IEcosystemConfig {
  return {
    ...DEFAULT_ECOSYSTEM,
    ...config,
    supervision: { ...DEFAULT_ECOSYSTEM.supervision, ...config.supervision, ... },
    monitoring: { ...DEFAULT_ECOSYSTEM.monitoring, ...config.monitoring },
    logging: { ...DEFAULT_ECOSYSTEM.logging, ...config.logging },
  };
}
```

Only `apps` is required. Everything else has sensible defaults.

## IEcosystemConfig Structure

```typescript
interface IEcosystemConfig {
  project?: string;                           // Display name
  apps: IEcosystemAppEntry[];                 // App declarations
  stacks?: Record<StackName, IStackConfig>;   // Deployment targets
  infrastructure?: InfrastructureConfig;       // Docker services
  gateway?: { port, configDir, image };       // API gateway (OpenResty)
  supervision: { strategy, maxRestarts, window, backoff };
  monitoring: { healthCheck: { interval, timeout }, metrics: { interval, retention } };
  logging: { level, maxSize, maxFiles, compress };
}
```

## IEcosystemAppEntry

Each app in the `apps` array:

```typescript
interface IEcosystemAppEntry {
  name: string;               // Unique identifier
  bootstrap?: string;         // Path to bootstrap.ts (bootstrap mode)
  script?: string;            // Path to main.ts (classic mode)
  enabled?: boolean;          // Skip during startAll (default: true)
  critical?: boolean;         // Daemon shuts down on crash (default: false)
  dependsOn?: string[];       // Start after these apps are healthy
  instances?: number;         // Override instance count
  env?: Record<string, string>;  // Per-app env vars
  restartPolicy?: IRestartPolicy;
  startupTimeout?: number;    // Override startup timeout (ms)
  watch?: string | IWatchConfig | false;  // Dev mode file watching
}
```

## IAppDefinition (Bootstrap Config)

When `bootstrap` mode is used, the app's `bootstrap.ts` exports `defineSystem()` returning an `IAppDefinition`:

```typescript
// apps/main/src/bootstrap.ts
import { defineSystem } from '@omnitron-dev/omnitron';

export default defineSystem({
  name: 'main',
  version: '1.0.0',

  processes: [
    {
      name: 'api',
      module: './modules/api.module.ts',
      critical: true,
      transports: {
        http: { port: 3001, cors: true },
        websocket: { port: 3001 },
      },
      topology: { expose: true },
    },
    {
      name: 'worker',
      module: './modules/worker.module.ts',
      instances: 2,
      topology: { expose: true },
    },
  ],

  requires: {
    postgres: { database: 'main', pool: { min: 2, max: 10 } },
    redis: { db: 0, purpose: ['cache', 'sessions'] },
  },

  auth: {
    jwt: { enabled: true },
  },

  config: {
    sources: [{ type: 'env', prefix: 'MAIN_' }],
  },

  shutdown: {
    timeout: 10_000,
    drainConnections: true,
  },

  hooks: {
    afterStart: async (app) => { /* seed data, etc. */ },
  },

  dev: {
    port: 3001,
    logLevel: 'debug',
    sourceMaps: true,
  },

  observability: {
    metrics: true,
    logging: { level: 'info', maxSize: '100mb', maxFiles: 5 },
  },
});
```

### IProcessEntry

Each process within an app:

```typescript
interface IProcessEntry {
  name: string;               // Unique within the app (e.g., 'api', 'worker')
  module: string;             // Path to @Module file (relative to bootstrap.ts)
  critical?: boolean;         // App unhealthy when this process is down
  instances?: number;         // >1 creates a PM pool with load balancing
  topology?: {
    expose?: boolean;         // Auto-expose @Service on daemon Netron
    access?: string[];        // Inject Netron proxies for these services
  };
  transports?: {
    http?: IHttpTransportConfig;
    websocket?: IWebSocketTransportConfig;
  };
  auth?: IAppDefinition['auth'] | false;
  health?: { enabled, interval, timeout, retries };
  startupTimeout?: number;
  scaling?: { strategy, maxInstances, targetCPU, targetMemory, queueThreshold };
  restartPolicy?: IRestartPolicy;
  env?: Record<string, string>;
  hooks?: { beforeCreate, afterCreate, beforeStart, afterStart, beforeStop, afterStop };
  observability?: { metrics, logging: { level } };
}
```

A process's role is determined by its declarations:
- Has `transports`? -- Listens on network ports
- Has `topology.expose`? -- Registers services on daemon Netron
- Has `topology.access`? -- Gets proxy injections for sibling services
- Has `instances > 1`? -- Runs as a PM pool with load balancing
- Has `critical`? -- App is unhealthy when this process is down

## Infrastructure Declarations

### Ecosystem-Level (omnitron.config.ts)

Shared infrastructure provisioned by Docker:

```typescript
infrastructure: {
  postgres: { port: 5480, databases: ['main', 'storage', 'messaging'] },
  redis: { port: 6379 },
  minio: { port: 9000, consolePort: 9001 },
  containers: {
    bitcoin: { image: 'lncm/bitcoind:v28.0', ports: { rpc: 18443 } },
  },
}
```

### App-Level (config/default.json)

Apps declare their infrastructure needs in `config/default.json` under the `omnitron` key:

```json
{
  "omnitron": {
    "database": true,
    "redis": { "prefix": "main:" },
    "s3": { "bucket": "uploads" },
    "services": { "discovery": true },
    "infrastructure": {
      "bitcoin": {
        "type": "daemon",
        "networkMode": "regtest",
        "ports": { "rpc": 18443 },
        "docker": { "image": "lncm/bitcoind:v28.0" }
      }
    }
  }
}
```

### Config Resolution Flow

1. Omnitron reads `omnitron.config.ts` for ecosystem-level infrastructure
2. For each app, reads `config/default.json` for app-level `omnitronConfig`
3. `resolveStack()` merges both levels, applying stack overrides
4. `resolvedConfigToEnv()` converts resolved config to env vars (DATABASE_URL, REDIS_URL, etc.)
5. Env vars are injected into child processes at fork time

## Stacks

Stacks define deployment targets:

```typescript
interface IStackConfig {
  type: 'local' | 'remote' | 'cluster';
  watch?: boolean;          // File watching (default: true for dev)
  nodes?: IStackNode[];     // For remote/cluster types
  infrastructure?: Partial<InfrastructureConfig>;
  settings?: IStackSettings;
  apps?: string[] | 'all';  // Which apps to run (default: 'all')
  portRange?: { start, end };
  serviceOverrides?: Record<string, IServiceOverride>;
}
```

**Stack types:**
- `local` -- Runs on this machine via PM child processes
- `remote` -- Runs on SSH-accessible server with slave omnitron daemon
- `cluster` -- Multiple nodes, each running a slave daemon

### Stack Settings

```typescript
interface IStackSettings {
  redisDbOffset?: number;    // Non-overlapping DB ranges per stack
  containerPrefix?: string;  // Docker name prefix (default: ${project}-${stack})
  env?: Record<string, string>;  // Stack-wide env vars
  logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  portOffsets?: { postgres?, redis?, minio? };
}
```

## Daemon Config (IDaemonConfig)

Internal operational config, not from `omnitron.config.ts`:

```typescript
interface IDaemonConfig {
  socketPath: string;   // ~/.omnitron/daemon.sock
  port: number;         // 9700 (TCP fleet)
  host: string;         // 0.0.0.0
  httpPort: number;     // 9800 (webapp)
  pidFile: string;      // ~/.omnitron/daemon.pid
  stateFile: string;    // ~/.omnitron/state.json
  logDir: string;       // ~/.omnitron/logs
  role: 'master' | 'slave';
  master?: { host, port };     // Required when role = 'slave'
  sync?: ISyncConfig;          // Slave-to-master data sync
  cluster?: { enabled, discovery, peers, electionTimeout, heartbeatInterval };
  secrets?: { provider, path, passphrase };
  auth?: { jwtSecret };
  healthMonitor?: { intervalMs, concurrency, offlineTimeoutMs, ... };
}
```

### Defaults

From `src/config/defaults.ts`:

```typescript
const DEFAULT_DAEMON_CONFIG: IDaemonConfig = {
  socketPath: '~/.omnitron/daemon.sock',
  port: 9700,
  host: '0.0.0.0',
  httpPort: 9800,
  pidFile: '~/.omnitron/daemon.pid',
  stateFile: '~/.omnitron/state.json',
  logDir: '~/.omnitron/logs',
  role: 'master',
  cluster: { enabled: false, discovery: 'redis', ... },
  secrets: { provider: 'file', path: '~/.omnitron/secrets.enc' },
  healthMonitor: { intervalMs: 60_000, concurrency: 20, ... },
};

const DEFAULT_ECOSYSTEM = {
  supervision: { strategy: 'one_for_one', maxRestarts: 5, window: 60_000, backoff: { ... } },
  monitoring: { healthCheck: { interval: 15_000, timeout: 5_000 }, metrics: { interval: 5_000, retention: 3600 } },
  logging: { level: 'info', maxSize: '50mb', maxFiles: 10, compress: true },
};

const DEFAULT_PORTS = { main: 3001, storage: 3002, priceverse: 3003, paysys: 3004, messaging: 3005 };
```

## Environment Management

### Env Var Injection

Omnitron injects resolved infrastructure config as environment variables into child processes:

- `DATABASE_URL` -- PostgreSQL connection string
- `REDIS_URL` -- Redis connection string
- `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` -- S3 config
- `AUTH_JWT_SECRET`, `AUTH_ALGORITHM` -- Auth config
- `OMNITRON_STACK` -- Current stack name
- `OMNITRON_APP` -- App name

### Config Sources

Apps can declare additional config sources in their definition:

```typescript
config: {
  sources: [
    { type: 'env', prefix: 'MAIN_' },
    { type: 'file', path: './config/production.json', optional: true },
  ],
}
```

The daemon also reads env vars prefixed with `OMNITRON_` via ConfigModule.
