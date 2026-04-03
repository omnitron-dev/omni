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

## License

MIT
