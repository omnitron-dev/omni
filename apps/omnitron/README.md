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

The CLI and daemon require Node.js 22.14 or newer on 22.x, or Node.js 23.6
or newer. Their embedded SQLite storage uses Node-API 10.

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

## Building an application release

`omnitron release build <project> --for <stack>` uses the selected project
commit, its `pnpm-lock.yaml` and the stack's build environment. The Console
Build action runs the same builder. Declare `@omnitron-dev/omnitron` in a
workspace importer and commit the lockfile. Install all `@omnitron-dev/*`
dependencies from the same framework release.

For registry dependencies the builder downloads the exact public npm archives
and compares each SHA-512 digest with the lockfile. Each package must carry the
same full `gitHead`. Omnitron's own `dist/BUILD.json` must confirm that clean
commit. The manifest records the package names, versions and archive digests in
`omni.registry.packages`. Frozen installs can use a local store or registry
mirror. Independent archive verification requires access to
`registry.npmjs.org` on every build. Older packages without packed source
metadata, including Omnitron 0.3.1, require a linked source checkout.

The builder compares the installed framework with those archives and checks
the framework files again inside each application's staged dependency graph.
Admission checks the target execution owner's source commit. Installation
also checks the target Node executable, OS, architecture and dependency
graph against the application archive. The release details show Git branch
visibility separately. If GitHub cannot confirm the framework commit on
`main`, its visibility is unknown and a stack requiring `requireOnRemote`
will refuse admission.

Projects developing against a linked Omni checkout can keep their existing
relative layout. The builder clones that repository at its selected commit
and builds the linked packages. `--omni-commit` selects the checkout revision
in this mode. With registry dependencies it is an assertion and must be the
full commit recorded by the pinned archives. Mixing both framework sources
in a single release is rejected.

## Host-owned public ingress

See [host ingress setup, application publication and recovery](HOST-INGRESS.md) for independent multi-application HTTPS hosting through the native CLI and RPC API.

## Application migrations and diagnostics

`@omnitron-dev/omnitron/migration` provides migration definitions, the shared
Kysera-backed runner, PostgreSQL pool adapters and configuration helpers. It can
be imported without starting the daemon. Applications need no direct Kysera
installation. Use `omnitron migrate status`, `up --dry-run`, `up`, `verify` or
`down --steps 1` with `omnitron.migrations.ts`. `--daemon` explicitly selects the
daemon's own registry.

For projects that provide a package-level `migrate` script, run
`omnitron infra migrate --dry-run` in the ecosystem directory to review
the package paths and their dependency order. `omnitron infra migrate`
runs the plan once per package. Supply an application name to select one.
A failure identifies its application and halts the remaining scripts.
On an enrolled node, direct lifecycle and migration writes require a
recipient-fenced execution path.

## Standalone infrastructure

`omnitron infra up`, `down` and `reset --yes` operate on containers declared
by the current standalone ecosystem. Reset keeps their volumes. Projects with
named stacks use the stack lifecycle. In Console, a **Read only** chip on a
container explains which owner or operation controls its lifecycle. Its logs
remain available to authorized users.

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
