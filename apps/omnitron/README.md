# @omnitron-dev/omnitron

> Production-grade application supervisor and CLI

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Overview

Omnitron is the main entry point for running and managing Titan-based applications. It provides a CLI (`omnitron dev`, `omnitron logs`, etc.) and a process management pipeline that forks child processes, captures structured logs, and exposes both management and data plane Netron RPC interfaces.

Key responsibilities:

- Application lifecycle — start, stop, restart, health monitoring
- Process supervision with configurable startup timeouts and worker pools
- Structured logging with pino, per-app log files, and size-based rotation
- Dual Netron planes — Unix socket management + HTTP data plane per child
- Configuration via `omnitron.config.ts` at the monorepo root

## Usage

```bash
# Link globally
pnpm link:global

# Run in dev mode
omnitron dev

# View logs
omnitron logs
omnitron logs --level warn --grep "error"
omnitron logs --status
```

## Host-owned public ingress

See [host ingress setup, application publication and recovery](HOST-INGRESS.md) for independent multi-application HTTPS hosting through the native CLI and RPC API.

## Application migrations and diagnostics

`@omnitron-dev/omnitron/migration` provides migration definitions, the shared
Kysera-backed runner, PostgreSQL pool adapters and configuration helpers. It can
be imported without starting the daemon. Applications need no direct Kysera
installation. Use `omnitron migrate status`, `up --dry-run`, `up`, `verify` or
`down --steps 1` with `omnitron.migrations.ts`. `--daemon` explicitly selects the
daemon's own registry; status never applies changes.

`@omnitron-dev/omnitron/diagnostics` exposes the shared Titan finding contract,
redacted cause formatting and an adapter for the existing durable alert outbox.
CLI health, doctor and Console node details report unresolved runtime failures
with evidence and recovery guidance. The bounded health projection lives in the
daemon process; structured logs remain the persistent record.

Application output is captured from spawn through EOF with stable IDs, source
process/stream and capture timestamps. SQLite journals retain unfinished multiline
messages and unacknowledged delivery. Files use replayable append offsets; database
rows and node replication outbox entries commit atomically. Retries verify the
original identity and content. `omnitron logs --status` and Console Logs share the
same persistence verdict, including pending delivery, commit evidence and errors.
An older resident owner is explicitly reported as `legacy-owner`; updating only
the backend cannot replace its capture mechanism without an owner maintenance window.

## License

MIT
