---
module: omnitron
title: "Omnitron Architecture"
tags: [architecture, daemon, netron, transports, master-slave, state]
summary: "Overall omnitron architecture: daemon-client model, DaemonModule composition, four Netron transports, master/slave roles, state persistence, and DI token layout."
depends_on: []
---

# Omnitron Architecture

## Overview

Omnitron is a production-grade Titan application supervisor. It runs as a long-lived **daemon process** that manages child application processes. The CLI is a stateless client that communicates with the daemon over Unix sockets via Netron RPC.

The daemon itself is a full Titan Application created via `Application.create(DaemonModule)`. It uses Nexus DI for dependency injection, Netron for RPC, and the ProcessManager module for child process supervision.

## Daemon-Client Architecture

```
CLI (omnitron ls)          Daemon (OmnitronDaemon)
     |                          |
     | Unix socket RPC          |
     +--- DaemonClient -------> DaemonRpcService
                                |
                                +-- OrchestratorService
                                +-- LogManager
                                +-- StateStore
                                +-- InfrastructureService
                                +-- ... (20+ services)
```

**CLI** (`src/cli/omnitron.ts`): Stateless commander.js process. Every command lazy-imports its handler, creates a `DaemonClient`, calls RPC methods, and exits. No state survives between CLI invocations.

**DaemonClient** (`src/daemon/daemon-client.ts`): Netron RPC client that connects to the daemon's Unix socket. Implements `IDaemonService` directly -- methods like `list()`, `status()`, `stopApp()` delegate to a Netron proxy:

```typescript
// Client creation and usage
const client = createDaemonClient();
const apps = await client.list();          // IDaemonService method
const status = await client.status();      // IDaemonService method

// Access other services via typed proxy
const project = await client.service<IProjectRpcService>('OmnitronProject');
const stacks = await project.listStacks({ project: 'omni' });
```

Connection is lazy -- `ensureConnected()` opens the Unix socket on first call:

```typescript
private async ensureConnected(): Promise<void> {
  if (this.connected) return;
  this.peer = await this.netron.connect(`unix://${this.socketPath}`, false);
  this.proxy = await this.peer.queryInterface<IDaemonService>(DAEMON_SERVICE_ID);
  this.connected = true;
}
```

**Daemon** (`src/daemon/daemon.ts`): The `OmnitronDaemon` class. Not a DI service itself -- it orchestrates creation of the Titan Application, registers transports, resolves services from DI, and wires everything together.

## DaemonModule Composition

`createDaemonModule()` in `src/daemon/daemon.module.ts` dynamically creates a `@Module` class with the full DI graph. It takes `IEcosystemConfig` (project config) and `IDaemonConfig` (daemon operational config) as parameters.

### Imported Titan Modules

| Module | Purpose |
|--------|---------|
| `ConfigModule.forRoot()` | Environment variable sources (OMNITRON_ prefix) |
| `LoggerModule.forRoot()` | Pino structured logging with file destinations |
| `ProcessManagerModule.forRoot()` | Child process supervision (child isolation, Unix transport) |
| `TitanAuthModule.forRoot()` | JWT verification + caching (HS256) |
| `SchedulerModule.forRoot()` | Cron/interval task scheduling |
| `TitanMetricsModule.forRoot()` | Process, system, and RPC metrics collection |
| `TitanHealthModule.forRoot()` | Memory and event loop health indicators |

### DI Providers (Token-Based)

All providers use `Scope.Singleton` and are registered via DI tokens defined in `src/shared/tokens.ts`:

**Core providers (both master and slave):**
- `ECOSYSTEM_CONFIG_TOKEN` -- The loaded `IEcosystemConfig`
- `INFRASTRUCTURE_GATE_TOKEN` -- `InfrastructureGate` (apps wait for infra readiness)
- `STATE_STORE_TOKEN` -- `StateStore` (JSON file persistence at `~/.omnitron/state.json`)
- `ORCHESTRATOR_TOKEN` -- `OrchestratorService` (core app lifecycle management)
- `LOG_MANAGER_TOKEN` -- `LogManager` (log routing, rotation, per-app directories)
- `HEALTH_CHECK_SERVICE_TOKEN` -- `HealthCheckService` (composable HTTP/TCP probes)
- `KUBERNETES_SERVICE_TOKEN` -- `KubernetesService`
- `BACKUP_SERVICE_TOKEN` -- `BackupService`
- `SECRETS_SERVICE_TOKEN` -- `SecretsService` (encrypted file-based)
- `PROJECT_SERVICE_TOKEN` -- `ProjectService` (project + stack management)

**Master-only providers (require PostgreSQL):**
- `OMNITRON_DB_TOKEN` -- Kysely PostgreSQL connection (port 5480)
- `AUTH_SERVICE_TOKEN` -- `AuthService` (JWT + session management)
- `LOG_COLLECTOR_TOKEN` -- `LogCollectorService` (structured log storage in PG)
- `FLEET_SERVICE_TOKEN` -- `FleetService` (multi-node cluster management)
- `ALERT_SERVICE_TOKEN` -- `AlertService` (rule-based evaluation engine)
- `DEPLOY_SERVICE_TOKEN` -- `DeployService` (deployment strategies)
- `DISCOVERY_SERVICE_TOKEN` -- `DiscoveryService` (Docker + SSH auto-discovery)
- `PIPELINE_SERVICE_TOKEN` -- `PipelineService` (CI/CD pipeline execution)
- `TRACE_COLLECTOR_TOKEN` -- `TraceCollectorService`
- `TELEMETRY_RELAY_TOKEN` -- Telemetry relay (store-and-forward pipeline)

**Slave-only providers:**
- `SLAVE_STORAGE_TOKEN` -- `SlaveStorageService` (SQLite, no Docker/PG needed)
- `LOG_COLLECTOR_TOKEN` -- Same interface but backed by SQLite instead of PG

## Four Netron Transports

The daemon registers four transport servers, each serving a different communication path:

### 1. Unix Socket (Local CLI)
```typescript
this.app.netron.registerTransport('unix', () => new UnixSocketTransport());
this.app.netron.registerTransportServer('unix', {
  name: 'daemon-local',
  options: {
    path: dc.socketPath,  // ~/.omnitron/daemon.sock
    force: true,
    mode: 0o600,          // Owner-only access
  },
});
```
- **Path**: `~/.omnitron/daemon.sock`
- **Purpose**: CLI commands, local inter-process RPC
- **Security**: File permission 0o600 (owner-only)

### 2. TCP (Fleet Communication)
```typescript
this.app.netron.registerTransport('tcp', () => new TcpTransport());
this.app.netron.registerTransportServer('tcp', {
  name: 'daemon-fleet',
  options: { port: 9700, host: '0.0.0.0' },
});
```
- **Port**: 9700 (default)
- **Purpose**: Cross-server daemon-to-daemon communication (master <-> slave)

### 3. HTTP (Webapp API)
```typescript
this.app.netron.registerTransport('http', () => new HttpTransport());
this.app.netron.registerTransportServer('http', {
  name: 'daemon-http',
  options: {
    port: 9801,           // httpPort + 1 (internal, behind nginx)
    host: '0.0.0.0',
    cors: true,
    invocationWrapper: authContextWrapper,
  },
});
```
- **Port**: 9801 (internal; nginx proxies from public port 9800)
- **Purpose**: Omnitron Console webapp Netron RPC API
- **Auth**: JWT Bearer token validation via AuthenticationManager

### 4. WebSocket (Real-time Events)
```typescript
this.app.netron.registerTransport('websocket', () => new WebSocketTransport());
this.app.netron.registerTransportServer('websocket', {
  name: 'daemon-ws',
  options: { port: 9802, host: '0.0.0.0' },
});
```
- **Port**: 9802 (httpPort + 2)
- **Purpose**: Real-time event push to webapp clients (app lifecycle, infra, alerts)
- **Auth**: Same JWT Bearer validation

### Port Summary

| Transport | Default Port | Purpose |
|-----------|-------------|---------|
| Unix socket | ~/.omnitron/daemon.sock | CLI <-> daemon |
| TCP | 9700 | Fleet RPC |
| HTTP | 9801 (internal) | Webapp API (behind nginx on 9800) |
| WebSocket | 9802 | Real-time events |

## Master/Slave Mode

Determined by `IDaemonConfig.role`:

**Master (default)**:
- Full PostgreSQL database (`OMNITRON_DB_TOKEN`) for sessions, users, logs, alerts, fleet, traces
- Serves the Omnitron Console webapp
- Aggregates data from slave nodes
- Runs fleet management, discovery, alerting, deployment, pipelines
- Can operate standalone (single machine, no slaves)

**Slave**:
- SQLite storage (`SLAVE_STORAGE_TOKEN`) -- no Docker/PG dependency
- Fully autonomous app supervision -- never depends on master connectivity
- Buffers metrics, logs, events locally
- Syncs accumulated data to master when connectivity is available
- No fleet/alert/deploy/pipeline services

The role affects provider registration -- `daemon.module.ts` uses spread arrays:
```typescript
const isSlave = dc.role === 'slave';

// Master-only providers
...(!isSlave ? [[AUTH_SERVICE_TOKEN, { useFactory: ... }]] : []),

// Slave-only providers
...(isSlave ? [[SLAVE_STORAGE_TOKEN, { useFactory: ... }]] : []),
```

## State Persistence

`StateStore` (`src/daemon/state-store.ts`) persists app state to `~/.omnitron/state.json`:

```typescript
interface PersistedState {
  version: string;
  updatedAt: number;
  apps: PersistedAppState[];
}

interface PersistedAppState {
  name: string;
  pid: number | null;
  status: AppStatus;      // 'stopped' | 'starting' | 'online' | 'stopping' | 'errored' | 'crashed'
  mode: 'classic' | 'bootstrap';
  startedAt: number;
  restarts: number;
  port: number | null;
}
```

State is persisted on every app lifecycle change (start, stop, error, restart). On daemon restart, state is loaded for crash recovery.

## Domain Events

Typed events in `src/shared/events.ts` are broadcast across daemon services and pushed to webapp clients via WebSocket:

| Category | Events |
|----------|--------|
| App lifecycle | `app.started`, `app.stopped`, `app.crashed`, `app.restarting`, `app.scaled`, `app.health_changed` |
| Infrastructure | `infra.ready`, `infra.degraded`, `infra.failed`, `infra.service_up/down/restarted` |
| Alerts | `alert.fired`, `alert.resolved`, `alert.acknowledged` |
| Metrics | `metrics.collected` |
| Projects | `project.added`, `project.removed`, `project.config_reloaded` |
| Stacks | `stack.starting/started/stopping/stopped/error`, `stack.infra_ready`, `stack.sync_completed/failed`, `stack.deploy_progress`, `stack.node_connected/disconnected` |
| Nodes | `node.status_updated`, `node.went_online/offline/degraded`, `node.check_completed` |
| Daemon | `daemon.started`, `daemon.stopping`, `daemon.config_reloaded` |

Events are wrapped in a `DaemonEvent<T>` envelope with channel, timestamp, and typed data.

## Public API

The package exports only configuration helpers (`src/index.ts`):

```typescript
export { defineSystem } from './config/define-system.js';
export { defineEcosystem } from './config/define-ecosystem.js';
export type { IAppDefinition, IProcessEntry, IEcosystemConfig, ... } from './config/types.js';
```

These are used by `omnitron.config.ts` (ecosystem) and app `bootstrap.ts` (app definition) files.

## Key File Paths

| File | Purpose |
|------|---------|
| `src/daemon/daemon.ts` | OmnitronDaemon class (bootstrap, transports, wiring) |
| `src/daemon/daemon.module.ts` | DaemonModule (DI composition) |
| `src/daemon/daemon-client.ts` | DaemonClient (CLI RPC client) |
| `src/daemon/daemon.rpc-service.ts` | DaemonRpcService (Netron service) |
| `src/daemon/state-store.ts` | StateStore (JSON persistence) |
| `src/daemon/pid-manager.ts` | PID file management |
| `src/config/types.ts` | All TypeScript interfaces |
| `src/config/defaults.ts` | Default configurations |
| `src/config/define-ecosystem.ts` | defineEcosystem() helper |
| `src/shared/tokens.ts` | All DI tokens |
| `src/shared/events.ts` | All domain event types |
| `src/index.ts` | Public package API |

## Runtime Paths

| Path | Purpose |
|------|---------|
| `~/.omnitron/` | Omnitron home directory |
| `~/.omnitron/daemon.sock` | Unix socket for CLI communication |
| `~/.omnitron/daemon.pid` | PID file (prevents duplicate daemons) |
| `~/.omnitron/state.json` | Persisted app state |
| `~/.omnitron/logs/` | Log directory |
| `~/.omnitron/logs/omnitron.log` | Daemon all-level log |
| `~/.omnitron/logs/omnitron.error.log` | Daemon error+fatal only |
| `~/.omnitron/secrets.enc` | Encrypted secrets file |
