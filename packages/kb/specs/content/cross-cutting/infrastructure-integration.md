---
module: cross-cutting
title: "Infrastructure Integration"
tags: [infrastructure, docker, postgres, redis, minio, omnitron]
summary: "How apps declare infrastructure requirements and how Omnitron provisions them"
---

# Infrastructure Integration

## Declaring Requirements in Bootstrap

Each app declares what infrastructure it needs in `omnitron.config.ts`:

```typescript
export default defineEcosystem({
  apps: [
    {
      name: 'main',
      bootstrap: './apps/main/src/bootstrap.ts',
      requires: {
        postgres: true,
        redis: true,
      },
    },
    {
      name: 'storage',
      bootstrap: './apps/storage/src/bootstrap.ts',
      requires: {
        postgres: true,
        redis: true,
        minio: true,  // S3-compatible storage
      },
    },
  ],
  infrastructure: {
    postgres: { port: 5432 },
    redis: { port: 6379 },
    minio: { port: 9000, console: 9001 },
  },
});
```

## Infrastructure Lifecycle

```
omnitron up
  │
  ├── 1. Read omnitron.config.ts
  ├── 2. Scan app requirements (requires: { postgres, redis, ... })
  ├── 3. Generate docker-compose.yml from requirements
  ├── 4. docker compose up -d
  ├── 5. Wait for health checks (pg_isready, redis PING)
  ├── 6. Run migrations (if configured)
  ├── 7. Start apps (fork with bootstrap.ts)
  └── 8. InfrastructureGate: apps wait until infra is ready
```

## Redis DB Index Assignment

| DB Index | App | Purpose |
|----------|-----|---------|
| 0 | Main | Default — auth sessions, cache |
| 1 | Storage | Bucket metadata, presigned URLs |
| 2 | Messaging | Pub/sub, room state |
| 3 | Priceverse | Price data cache |
| 4 | PaySys | Payment state, idempotency keys |

**Always explicitly set the DB index** in module config:
```typescript
TitanRedisModule.forRoot({
  host: process.env.REDIS_HOST,
  db: 2,  // Messaging
})
```

## PostgreSQL Per-App Databases

Each app gets its own database:
- `main` → database `omnitron_main`
- `storage` → database `omnitron_storage`
- `messaging` → database `omnitron_messaging`

**Never share databases between apps.** Cross-app communication goes through Netron RPC.

## Environment Variables

Omnitron injects infrastructure connection details as env vars:

| Variable | Source | Example |
|----------|--------|---------|
| `DB_HOST` | docker network | `localhost` |
| `DB_PORT` | infra config | `5432` |
| `DB_NAME` | app name-based | `omnitron_main` |
| `DB_USER` | infra config | `postgres` |
| `DB_PASSWORD` | secrets store | `...` |
| `REDIS_HOST` | docker network | `localhost` |
| `REDIS_PORT` | infra config | `6379` |
| `MINIO_ENDPOINT` | docker network | `localhost:9000` |

## CLI Management

```bash
omnitron infra up          # Provision all declared infrastructure
omnitron infra down        # Stop (--volumes to also remove data)
omnitron infra status      # Docker container health
omnitron infra psql [db]   # Open psql shell
omnitron infra redis-cli   # Open redis-cli
omnitron infra migrate     # Run all pending migrations
omnitron infra reset       # Drop and recreate (DESTRUCTIVE)
```
