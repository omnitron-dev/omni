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

For a file-based SQL migration, export the three values returned by `defineSqlMigration` as named exports. Save this example as `001_create_notes.ts`.

```ts
import { defineSqlMigration } from '@omnitron-dev/titan-database/migration';

export const { up, down, checksum } = defineSqlMigration(
  '001_create_notes',
  'CREATE TABLE notes (id bigint PRIMARY KEY)',
  'DROP TABLE notes',
);
```

`loadMigrationFiles` takes the migration name from the filename. The named `checksum` binds both SQL statements to the recorded migration. Without it, the compatibility runner hashes the JavaScript functions, which can have identical source for different SQL. Preserve the recorded checksum of each applied migration and put subsequent SQL changes in a new file.

`requirePostgresSchema` from `@omnitron-dev/titan-database/readiness` checks a declared schema contract through an existing pool. It reads metadata without applying DDL or taking ownership of that pool. Its result covers the declared requirements, not every possible difference between database schemas.

## Documentation

[Public API](src/index.ts) · [Connection options](src/database.types.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
