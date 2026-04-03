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
│   ├── prism               # Design system constructor (MUI v7)
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
| Frontend | React 19, Vite, MUI v7, Zustand v5 |
| Serialization | MessagePack (binary), JSON (HTTP fallback) |
| Testing | Vitest, Jest |

## Getting Started

### Prerequisites

- Node.js >= 22
- pnpm >= 10
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
