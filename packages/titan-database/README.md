# @omnitron-dev/titan-database

Database connections, typed queries and explicit migrations for Titan applications. The module integrates Kysely and Kysera with Titan's dependency injection and lifecycle.

## Capabilities

- Named PostgreSQL, MySQL and SQLite connections.
- Typed query builders, repositories, transactions and optional RLS integration.
- Migration runners with locking and checksum validation.
- Read-only PostgreSQL schema readiness checks using an existing pool.

## Quick start

```sh
pnpm add @omnitron-dev/titan-database
```

```ts
import { TitanDatabaseModule } from '@omnitron-dev/titan-database';

export function database(connection: string) {
  return TitanDatabaseModule.forRoot({
    connection: { dialect: 'postgres', connection },
  });
}
```

Pass a PostgreSQL connection URL from application configuration and add the returned module to your Titan application. Resolve `DATABASE_MANAGER` to obtain the configured connections. Install the driver required by your chosen dialect; native SQLite drivers must match the Node runtime.

## Migrations and readiness

Apply migrations explicitly through `@omnitron-dev/titan-database/migration`. Creating the DI module does not create tables or run migrations. Use the runner's own transaction, retry and checksum options; the module's `transactionOptions` and `migrations` configuration groups are currently not applied.

`requirePostgresSchema` from `@omnitron-dev/titan-database/readiness` checks a declared schema contract through an existing pool. It reads metadata without applying DDL or taking ownership of that pool. Its result covers the declared requirements, not every possible difference between database schemas.

## Documentation

[Public API](src/index.ts) · [Connection options](src/database.types.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
