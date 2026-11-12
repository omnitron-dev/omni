# Omni

**Fullstack Type-Safe RPC Framework**

Omni is a monorepo powering the entire stack — from backend application framework and process management to browser RPC clients and React UI components. Every layer shares TypeScript interfaces, so service contracts defined on the backend are enforced at compile time on the frontend.

## Architecture

```
omni/
├── apps/
│   └── omnitron/            # CLI supervisor & application host
│       └── webapp/          # Admin console (Vite + React)
│
├── packages/
│   ├── titan               # Backend framework — DI, Netron RPC, decorators, validation
│   ├── titan-auth          # JWT authentication module
│   ├── titan-cache         # Multi-tier caching (LRU, LFU, TTL)
│   ├── titan-database      # Kysely ORM, migrations, RLS, multi-dialect
│   ├── titan-discovery     # Redis-backed service discovery
│   ├── titan-events        # Event bus with decorators and scheduling
│   ├── titan-health        # Extensible health checks
│   ├── titan-lock          # Redis-backed distributed locks
│   ├── titan-metrics       # Counters, gauges, histograms, time-series
│   ├── titan-notifications # Multi-channel delivery, Rotif messaging, DLQ
│   ├── titan-pm            # Process supervisor, pools, workers
│   ├── titan-ratelimit     # Redis-backed rate limiting
│   ├── titan-redis         # Connection management, clustering, health
│   ├── titan-scheduler     # Cron, interval, timeout jobs with persistence
│   ├── titan-telemetry-relay # Store-and-forward telemetry pipeline
│   │
│   ├── netron-browser      # Browser RPC client (HTTP + WebSocket)
│   ├── netron-react        # React hooks & providers for Netron RPC
│   ├── prism               # Design system constructor (MUI v9)
│   │
│   ├── common              # Shared utilities, type predicates, promises
│   ├── cuid                # Collision-resistant unique IDs
│   ├── eventemitter        # Async event emitter (parallel, serial, reduce)
│   ├── kb                  # Knowledge base — code intelligence & semantic search
│   ├── msgpack             # Extensible MessagePack serializer
│   └── testing             # Cross-runtime testing utilities
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript, ESM-first |
| Omnitron CLI and daemon | Node.js 22.14+ on 22.x, or 23.6+ (Node-API 10 for SQLite) |
| Monorepo | pnpm workspaces + Turborepo |
| Backend | Titan framework, Netron RPC, Kysely, Redis |
| Frontend | React 19, Vite, MUI v9, Zustand v5 |
| Serialization | MessagePack (binary), JSON (HTTP fallback) |
| Testing | Vitest, Jest |

## Getting Started

### Prerequisites

- Node.js 22.22.2+ (22.x), 24.15+ (24.x), or 26+ for the full development toolchain
- pnpm 12.16.1 (pinned in `packageManager`)
- Redis (for cache, locks, discovery, rate-limiting)
- PostgreSQL (for persistence)

### Install

```bash
pnpm install
```

The workspace uses pnpm's hoisted layout to publish standard bundled dependency
archives for the KB extraction toolchain. Its versions remain fixed by
`pnpm-lock.yaml`; consumers can use their own package manager and installation
layout. Run `pnpm install --frozen-lockfile` after a workspace layout change
before running build or test commands.

### Build

```bash
pnpm build
```

Package builds use the workspace TypeScript compiler installed from the
lockfile. To reproduce an older SDK, use the toolchain its source revision
requires. Revisions that call `npx` need the npm CLI from the corresponding
Node.js distribution on the builder's `PATH`.

### Development

```bash
pnpm dev
```

### Test

```bash
pnpm test
```

### Lint & Format

```bash
pnpm lint:fix
pnpm fm:fix
```

## License

MIT

## Publishing and updating Omnitron

The project recipes run inside the pinned Xec CLI and use its release API and
Pipeline. Install dependencies with `pnpm install --frozen-lockfile`, then use a
clean `main` checkout:

```sh
pnpm exec xec release <version> --dry-run
pnpm exec xec release <version> --prepare --previous <full-previous-backend-commit> --push-source
pnpm exec xec release <version> --finish
```

Preparation builds and verifies immutable archives, compares two clean builds,
observes CI and qualifies native transition/rollback on each configured Node.
The release policy is in `.xec/release-policy.mjs`. `--push-source` publishes
only the reviewed source branch for CI; omit it when another system handles Git.
Publication rechecks exact evidence and hashes without rebuilding or retesting.
The runtime producer must be a standalone Node distribution on macOS or Linux
(for example, select it explicitly with `nvm exec 24.13.0 pnpm exec xec release ...`).
Shared Node/dependency builds, system ICU and external built-in modules are refused;
Homebrew's dynamically linked Node is not a supported runtime producer. Before
sealing, the freezer checks the copied interpreter's exact bytes and identity,
starts it from another directory with an empty environment, and rejects loaded
native objects outside OS library directories. This supports standalone builds;
it does not certify arbitrary custom linker settings or dependencies loaded later.
Read-only status and publication use the selected build's recorded producer Node,
even when the publishing CLI runs on another supported Node. The current policy,
release identity, runtime manifest and archive digests must still match exactly;
read-only verification never builds, dispatches jobs or writes qualification state.
The prepared public archive set must also match the independently reproduced SDK
in package identity, complete file contents and executable bits. The existing
archive inspector normalizes only dependency-map key order and verified `gitHead`
metadata; qualification does not replace differing archives.

`pnpm check:reproducibility` uses that same two-build check. On failure it prints
the retained diagnostic directory: both SDK file inventories, a bounded difference
report and up to 256 MiB of affected public npm archives. Set `--diagnostics <new-directory>`
to choose its location. Successful checks remove diagnostics; failed checks never
produce a qualification completion receipt. CI retains the failure evidence for 14 days.

Resume qualification with `xec release <version> --qualify --previous <commit>`.
Repeat `--finish` to reconcile interrupted npm uploads from the same archives.
Use `--status` to inspect current qualification and `--list` for package inventory.
State remains in `.release-artifacts/`; no personal launcher or temporary shell
script is required. `pnpm release` invokes the same Xec command.

Native qualification retains the tested Linux runtimes for deployment.
After publication, prepare an update through the daemon's existing lifecycle:

```sh
pnpm exec xec update plan <candidate-commit> --node test-controller --node production-controller
pnpm exec xec update apply <reviewed-plan-id>
pnpm exec xec update status <plan-id>
```

Planning never activates a backend. Roles, runtime pins, locks and rollback remain
owned by Omnitron. Use `reconcile <plan-id>` after an uncertain response.
Local supervised backends use `xec update local-check <dist>` followed by the
explicit `local-apply <dist>`; owner transitions are separate reviewed operations.
See the [release guide](https://omnitron.dev/docs/community/contributing#release-process)
for qualification, recovery and credentials.
