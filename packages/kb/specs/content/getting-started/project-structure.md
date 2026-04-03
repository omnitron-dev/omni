---
module: getting-started
title: "Project Structure"
tags: [structure, monorepo, packages, apps]
summary: "Layout and organization of the Omnitron monorepo"
---

## Monorepo Layout

```
omni/
├── packages/              # Reusable libraries
│   ├── titan/             # Core framework (DI, RPC, decorators, validation)
│   ├── titan-auth/        # JWT authentication module
│   ├── titan-cache/       # Multi-tier caching
│   ├── titan-database/    # DB abstraction (Kysely ORM)
│   ├── titan-discovery/   # Service discovery (Redis)
│   ├── titan-events/      # Event bus + scheduling
│   ├── titan-health/      # Health check indicators
│   ├── titan-lock/        # Distributed locking
│   ├── titan-metrics/     # Prometheus-style metrics
│   ├── titan-notifications/ # Multi-channel notifications
│   ├── titan-pm/          # Process management + supervision
│   ├── titan-ratelimit/   # Rate limiting algorithms
│   ├── titan-redis/       # Redis service + decorators
│   ├── titan-scheduler/   # Cron + interval + timeout jobs
│   ├── titan-telemetry-relay/ # Telemetry buffering
│   ├── common/            # Essential utilities
│   ├── cuid/              # Collision-resistant IDs
│   ├── eventemitter/      # Universal event emitter
│   ├── msgpack/           # MessagePack serialization
│   ├── netron-browser/    # Browser RPC client
│   ├── netron-react/      # React hooks for Netron
│   ├── prism/             # Design system (MUI-based)
│   ├── testing/           # Cross-runtime test utilities
│   └── kb/                # Knowledge base framework
├── apps/                  # Deployable applications
│   ├── omnitron/          # Application supervisor + CLI
│   ├── main/              # Main backend (auth, users)
│   ├── storage/           # Object storage service
│   ├── messaging/         # Real-time messaging
│   ├── priceverse/        # Price data service
│   ├── paysys/            # Payment system
│   ├── portal/            # Frontend portal
│   └── portal-seed/       # Portal template
├── turbo.json             # Turbo task orchestration
├── pnpm-workspace.yaml    # Workspace definition
└── omnitron.config.ts     # Ecosystem configuration
```

## Package Conventions
- All packages are ESM (`"type": "module"`)
- Build tool: `tsc` (TypeScript compiler)
- Internal deps: `workspace:*` protocol
- Optional deps: `peerDependencies` + `peerDependenciesMeta`
- Tests: Vitest (Node), Bun test (Bun), Deno test (Deno)

## Dependency Flow
```
common → eventemitter → msgpack → titan (core)
                                    ↓
                              titan-* modules
                                    ↓
                            apps (omnitron, main, etc.)
```
