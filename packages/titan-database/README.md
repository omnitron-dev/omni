# @omnitron-dev/titan-database

> Database module for the Titan framework — Kysely, migrations, RLS, multi-dialect

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add @omnitron-dev/titan-database
```

Install the driver for each database your application uses. For SQLite, install
`better-sqlite3@^13.0.3` and use Node.js 22.14+ on 22.x or 23.6+.
The native driver requires Node-API 10. PostgreSQL and MySQL can run without it.

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

## Read-only component readiness

`@omnitron-dev/titan-database/readiness` exports `requirePostgresSchema(pool, requirements)`.
It borrows an existing PostgreSQL pool, checks the component's declared table/column,
key, trigger and routine requirements in a read-only repeatable-read transaction,
and leaves the pool open. Importing the entry loads no driver, DI graph or migrator.
Omnitron applications can use the same API through `@omnitron-dev/omnitron/readiness`.

Declare only the objects the component consumes. Compatible additional tables,
nullable columns and columns with defaults are accepted; `insert: true` rejects
additional required inputs the component cannot supply. `defaultExpression` checks
an exact PostgreSQL `pg_get_expr` expression when the default's meaning matters;
`default` checks only its presence. `schema` selects an explicit schema, otherwise
the connection's `current_schema()` applies. These are PostgreSQL guarantees.

A mismatch throws `SchemaReadinessError` with code `database_schema_incompatible`,
the component name and individual violations. This does not apply migrations,
alter journals, prove every database invariant or replace query authorization.
The stack's declared migration phase owns schema changes; application startup
checks compatibility before accepting traffic. A later unrelated migration does
not require modifying an older component's migration registry.

## License

MIT
