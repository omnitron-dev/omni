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
| Language | TypeScript 5.9, ESM-first |
| Runtime | Node.js >= 22 |
| Monorepo | pnpm workspaces + Turborepo |
| Backend | Titan framework, Netron RPC, Kysely, Redis |
| Frontend | React 19, Vite, MUI v9, Zustand v5 |
| Serialization | MessagePack (binary), JSON (HTTP fallback) |
| Testing | Vitest, Jest |

## Getting Started

### Prerequisites

- Node.js >= 22
- pnpm 12.16.1 (pinned in `packageManager`)
- Redis (for cache, locks, discovery, rate-limiting)
- PostgreSQL (for persistence)

### Install

```bash
pnpm install
```

### Build

```bash
pnpm build
```

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

## Publishing Omnitron

Run `pnpm release --list` to see the public packages in dependency order.
`pnpm release <version> --dry-run` checks the version, current commit and
worktree. Choose the version before preparing a release.

From a clean `main`, run the following operations in order. Replace
`<version>` with the same exact version throughout.

```sh
pnpm release <version> --prepare
pnpm release <version> --push
pnpm release <version> --publish
pnpm release <version> --github
```

Preparation builds a separate checkout and creates a local annotated tag.
Review the package inventory, SHA-512 digests and release notes in
`.release-artifacts/<version>/<commit>/` before pushing. The push updates
the selected branch and tag atomically. Publication verifies the remote
tag and checks the sealed SHA-512 digests against npm metadata. For an interrupted
publication, keep the archives, return to the same clean commit and run
`pnpm release <version> --resume`. The GitHub release can be completed
separately after all npm packages are confirmed.
