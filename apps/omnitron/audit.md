# Omnitron — Audit & Status Tracker

**Full specification**: `SPECIFICATION.md`

## Architecture

Omnitron = self-contained fractal platform orchestration system.
- 76 backend TS files, 18 webapp TS/TSX files, 5 Titan module files
- Daemon IS a Titan Application managing other Titan Applications
- 3 Netron transports: Unix socket (CLI), TCP (fleet), HTTP:9800 (webapp + RPC)
- 7 RPC services: Daemon, Auth, Logs, Metrics, Alerts, Telemetry
- Own PostgreSQL (omnitron-pg) on port 5480 for logs, metrics, users, alerts, deployments
- Docker container management via @xec-sh/core DockerAdapter
- 30+ CLI commands

## RPC Services

| Service | Methods | Status |
|---------|---------|--------|
| OmnitronDaemon | 23 | ✅ Production |
| OmnitronAuth | 7 | ✅ JWT+scrypt, sessions, TOTP-ready |
| OmnitronLogs | 3 | ✅ Query/stats/stream from PG |
| OmnitronMetrics | 2 | ✅ Prometheus + snapshot |
| OmnitronAlerts | 7 | ✅ Rules CRUD + evaluation DSL |
| OmnitronTelemetry | 2 | ✅ Store-and-forward relay |

## CLI Commands (30+)

| Category | Commands |
|----------|----------|
| Lifecycle | `dev`, `start`, `stop`, `restart`, `reload` |
| Info | `list (ls)`, `status`, `config` |
| Monitoring | `logs`, `monit`, `health`, `metrics` |
| Scaling | `scale` |
| Diagnostics | `inspect`, `exec`, `env` |
| Deploy | `deploy -s rolling`, `rollback` |
| Infrastructure | `infra up/down/status/logs/psql/redis-cli/migrate/reset` |
| Fleet | `remote add/remove/list/status`, `fleet status/health/metrics` |
| Daemon | `daemon start/stop/ping/kill` |
| Scaffold | `init` |

## Resolved Issues (22 total)

| # | Issue | Status |
|---|-------|--------|
| 1 | Zero-downtime reload — honest TODO | ✅ |
| 2 | Rolling restart param removed | ✅ |
| 3 | State crash recovery | ✅ |
| 4 | Deploy/Rollback — Phase 3 | ⏳ |
| 5 | Classic mode logs | ✅ |
| 6 | Daemon RPC auth — Phase 4 | ⏳ |
| 7 | execSync → async execFile | ✅ |
| 8 | Broadcast ack waiter | ✅ |
| 9 | Config flag defaults | ✅ |
| 10 | tsx/esm module cache-bust | ✅ |
| 11 | tsx loader consistency | ✅ |
| 12 | Crash restart timer | ✅ |
| 13 | `omnitron dev` file watcher | ✅ |
| 14 | Log rotation stream reopen | ✅ |
| 15 | Bootstrap loader cache | ✅ |
| 16 | Child processes load dist/ | ✅ |
| P0-1 | Password hash bcrypt→scrypt | ✅ |
| P0-2 | Hardcoded JWT secret | ✅ |
| P0-4 | LIKE injection (escapeLike) | ✅ |
| P0-5 | Log collector shutdown data loss | ✅ |
| P1-8 | DaemonRpcService version suffix | ✅ |
| P1-9 | changePassword keeps current session | ✅ |

## Modules

### Backend (`apps/omnitron/src/`)
| Module | Files | Purpose |
|--------|-------|---------|
| `infrastructure/` | 6 | Docker container provisioning via xec DockerAdapter |
| `database/` | 3 | Kysely schema + migration (8 tables) |
| `services/` | 11 | Auth, Logs, Metrics, Alerts, Deploy, Telemetry + RPC |
| `execution/` | 2 | @xec-sh/core ExecutionEngine wrapper |
| `webapp/` | 1 | Static file server for SPA |
| `orchestrator/` | 7 | Process supervision + file watcher |
| `daemon/` | 6 | Titan app + transports + DI |
| `monitoring/` | 3 | LogManager, MetricsService, HealthService |
| `commands/` | 15 | CLI command handlers |

### Webapp (`apps/omnitron/webapp/src/`)
| Section | Files | Features |
|---------|-------|----------|
| Auth | 3 | JWT store, route guards, sign-in page |
| Layout | 1 | Console layout with 9-section sidebar |
| Pages | 7 | Dashboard, Apps (list+detail), Logs, Settings, Placeholder |
| Utils | 2 | Shared formatters + constants |
| Netron | 1 | Typed RPC client for daemon |
| Components | 1 | ErrorBoundary |

### Titan Module (`packages/titan/src/modules/telemetry-relay/`)
| File | Purpose |
|------|---------|
| types.ts | TelemetryEntry, Transport, Aggregator interfaces |
| telemetry-buffer.ts | Ring buffer with overflow, periodic flush |
| telemetry-wal.ts | Append-only WAL (NDJSON segments, rotation) |
| telemetry-relay.service.ts | Store-and-forward: buffer → WAL → transport |
| index.ts | Module exports |

## Dependencies
- `@xec-sh/core` ^0.9.0 — Docker/SSH/K8s adapters
- `@xec-sh/ops` ^0.9.0 — Deploy/Health/Pipeline/Discovery
- `@xec-sh/kit` ^0.9.0 — TUI rendering
- `jose` — JWT HS256
- `kysely` + `pg` — database
- `prom-client` — Prometheus metrics

## Phase Status

### Phase 1: Foundation ✅
- [x] Fix `omnitron dev` file watcher
- [x] Fix log rotation
- [x] Fix bootstrap-loader
- [x] Scaffold webapp
- [x] Serve webapp from daemon HTTP
- [x] Infrastructure provisioning (Docker)
- [x] Omnitron-pg database + schema + migration

### Phase 2: Observability ✅
- [x] OmnitronMetricsService (prom-client)
- [x] LogCollectorService (buffered → PG)
- [x] AlertService (rule evaluation DSL)
- [x] Metrics collection polling (5s)
- [x] Alert evaluation loop (15s)
- [x] Webapp: Dashboard, Apps, Logs, Settings pages
- [ ] Webapp: Alerts page
- [ ] Webapp: Metrics charts
- [ ] Log volume over time

### Phase 3: Remote Operations — In Progress
- [x] @xec-sh/core integrated (DockerAdapter for containers)
- [x] ExecutionService (local/SSH/Docker/K8s)
- [x] DeployService (all-at-once, rolling strategies)
- [x] TelemetryRelay Titan module (store-and-forward)
- [ ] Fleet management (node registry, health)
- [ ] Webapp: Nodes, Containers, Deployments pages
- [ ] @xec-sh/ops Deployer integration
- [ ] @xec-sh/ops Discovery integration

### Phase 4: Cluster — Not Started
- [ ] Leader election (Raft)
- [ ] Config replication
- [ ] Auth middleware for RPC
- [ ] Secrets management
- [ ] Gateway config generation

### Phase 5: Advanced — Not Started
- [ ] K8s adapter integration
- [ ] CI/CD pipeline execution
- [ ] Trace collector (OTLP)
- [ ] Backup/restore
- [ ] Custom dashboard builder
