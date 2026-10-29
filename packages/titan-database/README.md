# @omnitron-dev/titan-database

> Database module for the Titan framework — Kysely, migrations, RLS, multi-dialect

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add @omnitron-dev/titan-database
```

## Overview

Provides database connectivity for Titan applications using Kysely as the query builder. Supports PostgreSQL and SQLite dialects, declarative migrations, and row-level security (RLS) via `AsyncLocalStorage` context propagation.

### Key Features

- Kysely-based typed query builder
- Declarative migration system
- Row-level security (RLS) with async context
- Multi-dialect support (PostgreSQL, SQLite)
- Connection pooling and health checks

## Architecture and migrations

Kysera owns query extensions, repositories, savepoints, retry policies and the
migration engine. Titan adds connection lifecycle, DI and transaction context.
Nested transactions reuse Kysera DAL savepoints; a different database receives
its own transaction. This does not provide distributed atomicity.

Use `@omnitron-dev/titan-database/migration` for standalone runners and
`@omnitron-dev/omnitron/migration` in Omnitron applications. Schema changes run
explicitly; migration decorator metadata does not execute at DI startup.

`createHardenedRunner` preserves legacy history, lock identity and checksums.
The shared engine commits each body and history atomically, supports explicit
whole-batch transactions, and keeps inspection read-only. Preserve the journal
and checksum format when moving an existing deployment. SQL definitions can use
`defineSqlMigration`; arbitrary callbacks need a stable explicit checksum.

## License

MIT
