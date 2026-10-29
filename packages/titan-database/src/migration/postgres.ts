import { createHash } from 'node:crypto';
import { CompiledQuery, Kysely, PostgresDialect, type PostgresPool } from 'kysely';
import type { Migration } from '@kysera/migrations';

/** Minimal SQL interface for portable migration definitions using parameterized SQL. */
export interface MigrationSqlClient {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string, values?: readonly unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

/** Borrow an existing pool; destroying this Kysely view never closes the owner's pool. */
export function createPostgresMigrationDatabase(pool: PostgresPool): Kysely<unknown> {
  return new Kysely({ dialect: new PostgresDialect({ pool: {
    options: pool.options,
    connect: () => pool.connect(),
    end: async () => {},
  } }) });
}

/** Queries stay on the runner's pinned connection/transaction. */
export function migrationSqlClient<DB>(db: Kysely<DB>): MigrationSqlClient {
  return {
    async query<R extends Record<string, unknown>>(text: string, values: readonly unknown[] = []) {
      const result = await db.executeQuery<R>(CompiledQuery.raw(text, [...values]));
      return { rows: result.rows, rowCount: result.numAffectedRows === undefined ? result.rows.length : Number(result.numAffectedRows) };
    },
  };
}

/** Content-based integrity for SQL definitions, independent of transpilation or closures. */
export function defineSqlMigration(name: string, up: string, down?: string): Migration {
  return {
    name,
    checksum: createHash('sha256').update(JSON.stringify([up, down ?? null])).digest('hex'),
    up: async db => { await migrationSqlClient(db).query(up); },
    ...(down === undefined ? {} : { down: async (db: Kysely<unknown>) => { await migrationSqlClient(db).query(down); } }),
  };
}
