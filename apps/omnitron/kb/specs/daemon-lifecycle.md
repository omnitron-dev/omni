---
module: omnitron
title: "Daemon Lifecycle"
tags: [daemon, lifecycle, startup, shutdown, processes, logging]
summary: "How the daemon starts, discovers apps, manages child processes through their lifecycle, handles graceful shutdown, and captures logs."
depends_on: [architecture]
---

# Daemon Lifecycle

## Startup Sequence

When `omnitron up` is executed, the daemon goes through a precise 13-step startup sequence defined in `OmnitronDaemon.start()` (`src/daemon/daemon.ts`):

```
omnitron up
  |
  v
1. PID check (prevent duplicate daemons)
2. Create Titan Application (Application.create(DaemonModule))
3. Register four Netron transports (Unix, TCP, HTTP, WebSocket)
4. Resolve and expose RPC services via Netron
5. Start Application (boots DI, starts Netron, opens transport servers)
6. Wire log persistence (file streams + LogCollector)
7. Check crash recovery (from state.json)
8. Provision infrastructure (Docker containers from ecosystem config)
9. Register health indicators (Docker + app health)
10. Start file watcher (dev mode -- watches source files for restart)
11. Wire daemon Netron to orchestrator (for topology service routing)
12. Start managed apps (via OrchestratorService)
13. Start background tasks (scheduled jobs, telemetry, leader election)
14. Wire event broadcasting (orchestrator events -> WebSocket push)
15. Register shutdown tasks (SIGTERM/SIGINT handlers)
16. Broadcast daemon.started event
```

### Step 1: PID Check

```typescript
this.pidManager = new PidManager(pidFile);
if (this.pidManager.isRunning()) {
  throw new Error(`Omnitron daemon already running (PID: ${existingPid})`);
}
this.pidManager.write();
```

PID file at `~/.omnitron/daemon.pid` prevents duplicate daemon instances.

### Step 2: Create Titan Application

```typescript
const DaemonModule = createDaemonModule(config, this.dc);
this.app = await Application.create(DaemonModule, {
  name: 'omnitron',
  version: CLI_VERSION,
});
```

`createDaemonModule()` dynamically creates a `@Module` class with all imports (ConfigModule, LoggerModule, ProcessManagerModule, etc.) and providers (Orchestrator, LogManager, StateStore, etc.). See `architecture.md` for the full provider list.

### Steps 3-4: Transports and RPC Services

The daemon registers four transport servers and exposes multiple RPC services on them:

- `DaemonRpcService` -- Core daemon operations (list, status, start/stop apps)
- `LogsRpcService` -- Structured log queries
- `MetricsRpcService` -- Metrics collection and query
- `HealthCheckRpcService` -- Composable health probes
- `SecretsRpcService` -- Encrypted secrets management
- `KubernetesRpcService` -- K8s operations
- `BackupRpcService` -- Database backup/restore
- `InfrastructureRpcService` -- Infrastructure state reporting
- `ProjectRpcService` -- Project + stack management
- `AuthRpcService` -- Authentication (master only)
- `SystemInfoRpcService` -- System information queries
- `EventBroadcasterRpcService` -- WebSocket event subscription
- `SyncRpcService` -- Slave-to-master data sync

### Step 5: Application Start

```typescript
await this.app.start();
```

Titan's `Application.start()` boots the DI container, resolves all providers, starts Netron, and opens all registered transport servers. After this, the daemon is accepting connections.

### Step 8: Infrastructure Provisioning

```typescript
await this.startInfrastructure(config, options, logger);
```

The `InfrastructureService` provisions Docker containers declared in `omnitron.config.ts` (PostgreSQL, Redis, MinIO, etc.). The `InfrastructureGate` signals readiness when all services are healthy. Apps that declare `requires` wait for this gate before starting.

Can be skipped with `omnitron up --no-infra`.

### Step 12: Start Managed Apps

```typescript
await this.startApps(config, logger);
```

Delegates to `OrchestratorService.startAll()` which resolves dependency order and starts apps in batches.

## App Discovery

Apps are declared in `omnitron.config.ts` via `defineEcosystem()`:

```typescript
// omnitron.config.ts
import { defineEcosystem } from '@omnitron-dev/omnitron';

export default defineEcosystem({
  project: 'omni',
  apps: [
    { name: 'main', bootstrap: 'apps/main/src/bootstrap.ts', critical: true },
    { name: 'storage', bootstrap: 'apps/storage/src/bootstrap.ts', dependsOn: ['main'] },
    { name: 'messaging', bootstrap: 'apps/messaging/src/bootstrap.ts' },
  ],
  infrastructure: { ... },
  supervision: { ... },
});
```

Each `IEcosystemAppEntry` has:
- `name` -- App identifier
- `bootstrap` -- Path to bootstrap.ts (bootstrap mode) or `script` (classic mode)
- `enabled` -- Set to `false` to skip (default: `true`)
- `critical` -- If true, daemon shuts down when this app crashes beyond maxRestarts
- `dependsOn` -- Start after these apps are healthy
- `instances` -- Number of instances (default: 1)
- `startupTimeout` -- Override startup timeout (ms)
- `watch` -- File watching config for dev mode

## Child Process Lifecycle

### Two Launch Modes

**Bootstrap mode** (recommended): App exports `defineSystem()` from a `bootstrap.ts` file. The orchestrator loads the bootstrap config, discovers process topology, and spawns children via PM:

```
bootstrap.ts (defineSystem) -> loadBootstrapConfig()
  -> IAppDefinition { processes, requires, auth, config }
  -> Per-process: PM supervisor.spawn(bootstrap-process.js, { bootstrapPath, processName })
  -> fork-worker.js -> worker-runtime.js -> bootstrap-process.js
  -> Application.create(processModule) inside each child
```

**Classic mode** (legacy): Direct `child_process.fork()` of a script file with manual exit handling.

### Process Lifecycle States

```
stopped -> starting -> online -> stopping -> stopped
                    \-> errored
                    \-> crashed -> restarting -> starting -> ...
```

States are defined as `AppStatus`:
```typescript
type AppStatus = 'stopped' | 'starting' | 'online' | 'stopping' | 'errored' | 'crashed';
```

### Child Process Fork

For bootstrap mode, each process is forked with `--import tsx/esm` in `execArgv` to support TypeScript at runtime:

```typescript
// ProcessSpawner detects execArgv and forces child process mode (not worker threads)
// Worker threads do NOT support execArgv -- this is a critical constraint
```

The fork chain is:
1. **fork-worker.js** -- PM's generic fork entry point
2. **worker-runtime.js** -- PM runtime that receives config via IPC
3. **bootstrap-process.js** -- Omnitron-specific: imports the module, creates Titan Application

Each child process has **two Netron instances**:
- **Management plane**: IPC channel (`process.send`) for PM control messages (ready/error/shutdown)
- **Data plane**: Unix sockets for Netron RPC between parent and child (service calls, health, metrics)

### Process Topology

Apps can declare multiple processes in their `IAppDefinition.processes`:

```typescript
defineSystem({
  name: 'priceverse',
  processes: [
    { name: 'api', module: './api.module.ts', critical: true, transports: { http: { port: 3003 } } },
    { name: 'collector', module: './collector.module.ts', instances: 4, topology: { expose: true } },
    { name: 'aggregator', module: './aggregator.module.ts', topology: { access: ['collector'] } },
  ],
});
```

Topology startup order: providers (`topology.expose`) start before consumers (`topology.access`).

### Restart Policy

Configurable per-app or globally via supervision config:

```typescript
supervision: {
  strategy: 'one_for_one',  // or 'one_for_all', 'rest_for_one'
  maxRestarts: 5,
  window: 60_000,           // ms
  backoff: { type: 'exponential', initial: 1_000, max: 30_000, factor: 2 },
}
```

PM ProcessSupervisor handles crash detection and automatic restart with exponential backoff.

## Graceful Shutdown

Triggered by `omnitron down`, SIGTERM, or SIGINT. The daemon registers shutdown tasks with Titan's Application shutdown system (priority-ordered):

```
1. Broadcast daemon.stopping event
2. Stop file watcher
3. Stop all apps (reverse dependency order)
   - Per-app: SIGTERM with timeout, then SIGKILL
   - force=true: 3s timeout per app
   - force=false: 10s timeout per app
4. Stop infrastructure (Docker containers)
5. Shut down PM (ProcessManager.shutdown())
6. Close Netron transports
7. Clean up PID file
8. Exit process
```

The orchestrator stops apps in reverse dependency order:

```typescript
async stopAll(force = false): Promise<number> {
  for (const batch of resolveShutdownOrder(this.config.apps)) {
    await Promise.all(batch.map(entry => this.stopApp(entry.name, force, perAppTimeout)));
  }
  await this.pm.shutdown({ force, timeout: force ? 5_000 : 30_000 });
}
```

## Log Capture

Child processes are forked with `silent: true` -- their stdout/stderr is captured by the parent via `WorkerHandle`:

```
Child process (pino JSON output)
  -> stdout (captured by parent via readline)
  -> WorkerHandle.onStdout handler
  -> LogManager.appendToFile(appName, line)  -- writes to app.log + error.log
  -> Parent logger re-emits with correlation fields
```

### Log Destinations

The daemon's own logs go to three destinations simultaneously:
1. **stdout** (terminal when foreground)
2. **ReopenableFileStream** -> `~/.omnitron/logs/omnitron.log`
3. **ReopenableFileStream** -> `~/.omnitron/logs/omnitron.error.log` (error+fatal only)
4. **LogCollectorStream** -> `LogCollectorService` (for webapp /logs page)

`ReopenableFileStream` supports log rotation -- when LogManager rotates a log file, it calls `reopen()` which closes the old fd and opens a new one at the same path.

### App Log Layout

```
~/.omnitron/logs/omnitron.log              -- daemon all-level
~/.omnitron/logs/omnitron.error.log        -- daemon error+fatal
~/.omnitron/projects/{project}/{stack}/logs/{app}/app.log    -- project-scoped
~/.omnitron/projects/{project}/{stack}/logs/{app}/error.log  -- project-scoped errors
~/.omnitron/logs/{app}/app.log             -- standalone (no project)
~/.omnitron/logs/{app}/error.log           -- standalone errors
```

### Log Rotation

LogManager checks rotation every 60 seconds for daemon logs and on every write for app logs:

```typescript
interface LogRotationConfig {
  maxSize: string;    // e.g., '50mb'
  maxFiles: number;   // e.g., 10
  compress: boolean;  // gzip rotated files
}
```

Per-app overrides are supported via `observability.logging` in app definitions.

## Dev Mode

`omnitron dev` (or `omnitron up` from a project directory) enables:

1. **esbuild bundling**: Source .ts files are bundled via esbuild before forking children
2. **esbuild watch**: Incremental rebuilds on source changes trigger app restarts
3. **File watcher**: `FileWatcher` monitors app directories for changes
4. **Debug logging**: Log level typically set to 'debug'
5. **Source maps**: Enabled by default

The orchestrator's `devMode` flag controls this:
```typescript
orchestrator.devMode = true;  // Set during dev startup
```

## Crash Recovery

On startup, the daemon checks `state.json` for apps that were `online` when the daemon last ran:

```typescript
await this.checkCrashRecovery(logger);
```

If apps were running before an unexpected daemon termination, they can be automatically restarted.
