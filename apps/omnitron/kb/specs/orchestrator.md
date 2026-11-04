---
module: omnitron
title: "Orchestrator Service"
tags: [orchestrator, processes, topology, bootstrap, routing, file-watcher]
summary: "OrchestratorService: app handles, bootstrap loading, topology launch, service routing, dependency resolution, dev mode file watching, and scaling."
depends_on: [architecture, daemon-lifecycle, config-system]
---

# Orchestrator Service

## Role

`OrchestratorService` (`src/orchestrator/orchestrator.service.ts`) is the core app lifecycle manager. It sits between the daemon and the ProcessManager (PM) module, translating app definitions into supervised child processes.

It is registered as a singleton via `ORCHESTRATOR_TOKEN` and injected with:
- `ILogger` -- Structured logging
- `ProcessManager` -- Titan PM for process supervision
- `StateStore` -- JSON state persistence

```typescript
export class OrchestratorService extends EventEmitter {
  private readonly handles = new Map<string, AppHandle>();
  private config: IEcosystemConfig | null = null;
  devMode = false;

  constructor(
    private readonly logger: ILogger,
    private readonly pm: ProcessManager,
    private readonly stateStore: StateStore,
  ) { ... }
}
```

## App Handles

Each managed app gets an `AppHandle` (from `src/orchestrator/app-handle.ts`):

```typescript
class AppHandle {
  entry: IEcosystemAppEntry;
  mode: 'classic' | 'bootstrap';
  status: AppStatus;           // stopped | starting | online | stopping | errored | crashed
  pid: number | null;
  supervisor: ProcessSupervisor | null;
  childProcess: ChildProcess | null;
  serviceRouter: ServiceRouter | null;  // For topology service exposure
  startedAt: number;
  restarts: number;
  port: number | null;
}
```

Handles are stored in `this.handles` keyed by app name. They track the full lifecycle state and hold references to the supervisor and child processes.

## Startup Flow

### startAll()

Called by the daemon after infrastructure is ready:

```typescript
async startAll(config: IEcosystemConfig): Promise<void> {
  this.config = config;

  // resolveStartupOrder returns batches respecting dependsOn
  for (const batch of resolveStartupOrder(config.apps)) {
    const enabled = batch.filter(e => e.enabled !== false);
    await Promise.all(enabled.map(e => this.startApp(e, config)));
  }

  this.startMetricsPolling(config.monitoring.metrics.interval);
  this.persistState();
}
```

`resolveStartupOrder()` (from `src/orchestrator/dependency-resolver.ts`) performs topological sort on `dependsOn` to produce ordered batches. Apps within the same batch start in parallel.

### startApp()

```typescript
async startApp(entry: IEcosystemAppEntry, config?: IEcosystemConfig): Promise<AppHandle> {
  const mode = entry.bootstrap ? 'bootstrap' : 'classic';
  const handle = new AppHandle(entry, mode);
  this.handles.set(entry.name, handle);

  if (mode === 'classic') {
    await this.launchClassicMode(entry, handle, cfg);
  } else {
    await this.launchBootstrapMode(entry, handle, cfg);
  }
}
```

## Bootstrap Loading

When an app uses bootstrap mode, the orchestrator loads its `bootstrap.ts` to discover the `IAppDefinition`:

```typescript
// In launchBootstrapMode():
const bootstrapAbsPath = path.resolve(this.cwd, entry.bootstrap!);
const definition = await loadBootstrapConfig(bootstrapAbsPath, { devMode: this.devMode });
const topology = definition.processes;
```

`loadBootstrapConfig()` (from `src/orchestrator/bootstrap-loader.ts`) dynamically imports the bootstrap module and extracts the `IAppDefinition`. In dev mode, it may use esbuild-bundled paths.

The loader also reads `config/default.json` from the app directory for `omnitronConfig` (infrastructure declarations):

```typescript
if (definition && !definition.omnitronConfig) {
  const configPath = path.join(appRoot, 'config', 'default.json');
  const json = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  if (json.omnitron) {
    definition.omnitronConfig = json.omnitron;
  }
}
```

### Infrastructure Config Resolution

Before launching, resolved infrastructure config is injected as env vars:

```typescript
const { resolveStack, resolvedConfigToEnv } = await import('../project/config-resolver.js');
const resolved = resolveStack(config, projectName, stackName, stackConfig, definitions);
const envVars = resolvedConfigToEnv(appConfig, entry.name, stackName);
entry.env = { ...entry.env, ...envVars };
```

This gives child processes `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, etc.

## Topology Launch

When an app declares `processes` in its definition, the orchestrator launches each process as a separate child:

### Single-Process Mode

When no topology is declared, a single child is spawned:

```typescript
if (topology && topology.length > 0) {
  await this.launchTopology(entry, handle, config, bootstrapPath, topology, buildResult);
} else {
  await this.launchSingleProcess(entry, handle, config, bootstrapPath, buildResult);
}
```

### Multi-Process Topology

`launchTopology()` creates an `ApplicationTopology` only when a process declares
`topology.expose` or `topology.access`. The application handle owns this context
before any provider starts. Each launch has a separate native Netron instance and
Unix listener in a private directory; the execution owner's management socket is
never used for sibling service lookup.

Pool providers are discovered first, followed by supervisor children. Both use
one bounded discovery contract. Providers publish stable proxies through
`ServiceRouter`; a pool delegates to PM's dispatch and a singleton resolves its
current child on each call. A duplicate service name/version within one application
is an error, including a second registration by the same provider. No router takes
over another registration.

```
execution owner
  +-- management Netron: OmnitronExecution
  +-- application A / launch 1: private Netron
  |     +-- ServiceA -> pool workers
  |     +-- ServiceB -> singleton
  +-- application B / launch 1: private Netron
        +-- ServiceA -> independent pool workers
        +-- ServiceB -> independent singleton
```

### Process Dependencies Injection

The existing bootstrap contract remains compatible with sealed application SDKs:

```typescript
{
  bootstrapPath: '/abs/path/to/bootstrap.ts',
  processName: 'api',
  // Historical wire key; the value now identifies this application's listener.
  __daemonSocketUrl: 'unix:///private/execution/topology/t-ABC123/rpc.sock',
  __topologyConnects: ['ServiceA', 'ServiceB'],
}
```

The child's own Netron connects to that listener and registers DI proxies under
`createToken('topology:ServiceA')`. Bare service names are local to this application
launch. Another project or stack cannot accidentally satisfy a sibling lookup;
intentional external services need their explicit Netron connection.

These contexts isolate routing, not operating-system principals. Socket directories
are owner-only (`0700`) and sockets are `0600`; workloads running as the same OS user
are not security sandboxes.

## App Lifecycle Operations

### stopApp()

An application stop closes its topology context and stops its supervisor and pools.
Every resource is attempted even if another fails. A failed listener/service/pool
cleanup remains attached to the handle for retry; the stop does not report success
while termination is unconfirmed. Unexpected files in the private topology directory
are retained rather than removed recursively.

A rejected startup also cleans up its own resources and records the original failure
in `lastExit`, which CLI and Console inspect through the same process DTO. Restarting
one application creates a fresh namespace without touching another application's
service definitions or processes. Backend handoff leaves all owner-held contexts
intact. The owner reports the semantic capability `applicationTopology@1`; activating
this implementation on an older owner requires an explicitly planned owner restart.

### stopAll()

Stops apps in reverse dependency order:

```typescript
async stopAll(force = false): Promise<number> {
  for (const batch of resolveShutdownOrder(this.config.apps)) {
    await Promise.all(batch.map(entry => this.stopApp(entry.name, force, perAppTimeout)));
  }
  await this.pm.shutdown({ force, timeout });
}
```

### restartApp()

Stops and re-starts an app. If in dev mode with esbuild, disposes the watch context and clears the build cache first so `launchBootstrapMode` rebuilds fresh.

### scaleApp()

Delegates to PM's `supervisor.scaleChild()` for pool processes.

## Dev Mode

When `orchestrator.devMode = true`:

### esbuild Pipeline

1. `BuildService` pre-bundles TypeScript entry points via esbuild
2. Each app gets a `BuildResult` with bundled module paths
3. `watchApp()` starts esbuild incremental watch mode
4. On source change: esbuild rebuilds -> triggers `restartApp()`

```typescript
if (definition && this.devMode) {
  const buildResult = await this.buildService.buildApp(entry.name, bootstrapAbsPath, definition);
  this.buildResults.set(entry.name, buildResult);

  await this.buildService.watchApp(entry.name, bootstrapAbsPath, definition, () => {
    this.restartApp(entry.name);  // Rebuild detected -> restart
  });
}
```

### File Watcher

`FileWatcher` (`src/orchestrator/file-watcher.ts`) monitors app source directories:

- Auto-detects watch directory from bootstrap/script path (walks up to nearest `package.json`)
- Configurable via `IWatchConfig` on each app entry
- Default ignore patterns: `node_modules`, `dist`, `.git`
- Debounce interval: 300ms (default)
- On change: triggers app restart

### Fallback to tsx

If esbuild fails, child processes fall back to `tsx` via `--import tsx/esm` in `execArgv`.

## Metrics Polling

The orchestrator periodically collects metrics from all running processes:

```typescript
private startMetricsPolling(interval: number): void {
  this.metricsTimer = setInterval(() => {
    for (const [name, handle] of this.handles) {
      if (handle.status === 'online') {
        // Collect CPU, memory, request counts from PM
      }
    }
  }, interval);
}
```

Metrics are stored in `TitanMetricsModule`'s in-memory store and accessible via `MetricsRpcService`.

## State Persistence

The orchestrator calls `persistState()` on every lifecycle change:

```typescript
private persistState(): void {
  const apps: PersistedAppState[] = [];
  for (const [name, handle] of this.handles) {
    apps.push({ name, pid: handle.pid, status: handle.status, ... });
  }
  this.stateStore.save({ version: CLI_VERSION, updatedAt: Date.now(), apps });
}
```

State is saved to `~/.omnitron/state.json` and used for crash recovery on daemon restart.

## Key Files

| File | Purpose |
|------|---------|
| `src/orchestrator/orchestrator.service.ts` | Core orchestration logic |
| `src/orchestrator/app-handle.ts` | AppHandle lifecycle state |
| `src/orchestrator/bootstrap-loader.ts` | Load IAppDefinition from bootstrap.ts |
| `src/orchestrator/dependency-resolver.ts` | Topological sort for startup/shutdown order |
| `src/orchestrator/service-router.ts` | Netron service proxy management |
| `src/orchestrator/classic-launcher.ts` | Legacy fork mode |
| `src/orchestrator/build-service.ts` | esbuild bundling for dev mode |
| `src/orchestrator/file-watcher.ts` | Source file change detection |
| `src/orchestrator/bootstrap-process.ts` | Child process entry point |
| `src/supervisor/restart-policy.ts` | Restart policy builder |
