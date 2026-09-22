/**
 * A migrated omnitron database that belongs to one test file.
 *
 * `omnitron-migrations.test.ts` drops the shared test database's `public`
 * schema before each of its tests, and vitest runs files in parallel. A file
 * that needs the real tables to stay put therefore creates a database of its
 * own, runs the real migrations into it, and drops it afterwards.
 *
 * Requires the test infrastructure: `pnpm test:up` (postgres on :15432) —
 * see `requires-test-postgres.ts` for how a missing server is reported.
 */

import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';

import { migrateOmnitronDb } from '../../src/database/migration-runner.js';
import type { OmnitronDatabase } from '../../src/database/schema.js';

/**
 * A pool whose idle clients may be cut off without that being a test failure.
 * `DROP DATABASE … WITH (FORCE)` terminates whatever is still attached
 * (57P01), and a pg client with no 'error' listener turns that into an
 * unhandled error reported against whichever test ran last.
 */
function quietPool(connectionString: string, max: number): pg.Pool {
  const pool = new pg.Pool({ connectionString, max });
  pool.on('error', () => {});
  return pool;
}

export interface OwnDatabase {
  db: Kysely<OmnitronDatabase>;
  drop(): Promise<void>;
}

/**
 * @param url   the test server, as `requiresTestPostgres` was given it
 * @param name  the database to create — unique per file (use `process.pid`)
 * @param onStatement  every statement Kysely sends, for tests that count them
 */
export async function databaseOfItsOwn(
  url: string,
  name: string,
  onStatement?: (sqlText: string) => void,
): Promise<OwnDatabase> {
  const admin = new Kysely<unknown>({ dialect: new PostgresDialect({ pool: quietPool(url, 1) }) });
  await sql.raw(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).execute(admin);
  await sql.raw(`CREATE DATABASE ${name}`).execute(admin);

  const own = new URL(url);
  own.pathname = `/${name}`;
  const db = new Kysely<OmnitronDatabase>({
    dialect: new PostgresDialect({ pool: quietPool(own.toString(), 4) }),
    log: onStatement
      ? (event) => {
          if (event.level === 'query') onStatement(event.query.sql);
        }
      : undefined,
  });
  await migrateOmnitronDb(db as unknown as Kysely<unknown>);

  return {
    db,
    async drop() {
      await db.destroy();
      await sql.raw(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).execute(admin);
      await admin.destroy();
    },
  };
}
