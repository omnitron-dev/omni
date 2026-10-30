/**
 * End-to-end migration run against a real PostgreSQL.
 *
 * ## The bug this reproduces
 *
 * Both runtime migration paths destructured `Migrator` from the `kysely`
 * package root, where Kysely ≥0.28 no longer exports it. `Migrator` was
 * `undefined`, `new Migrator(...)` threw `TypeError`, and the surrounding
 * `catch` downgraded that to a warning — so the daemon booted against an
 * empty schema and only complained much later with an endless
 * `relation "alert_rules" does not exist` log storm. On the live dev
 * install the `omnitron` database contained zero tables.
 *
 * A unit test could not have caught this: the failure only exists when the
 * migration code actually executes against a database. So this test runs
 * the shared runner for real and asserts the schema afterwards.
 *
 * Requires the test infrastructure: `pnpm test:up` (postgres on :15432).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';

import { setEnvOverride, resetEnvCache } from '../../src/shared/env-config.js';
import { requiresTestPostgres } from './requires-test-postgres.js';

const TEST_PG_URL = process.env['TEST_DATABASE_URL'] ?? 'postgresql://test:test@localhost:15432/test';

// Asked once, at module scope: `describe.skipIf` needs the answer before the
// suite is declared, and a `beforeAll` runs too late to skip its own suite.
// An absent database is a different finding from a defect — see the helper.
const testPg = await requiresTestPostgres(TEST_PG_URL);

let db: Kysely<unknown>;

/** Tables the migrations are expected to leave. */
const EXPECTED_TABLES = [
  'nodes',
  'omnitron_users',
  'omnitron_sessions',
  'alert_rules',
  'pipelines',
  'traces',
  'metrics_samples',
];

/** Tables a later migration removes: 002 made `metrics_raw`, 010 drops it (no reader, no pruning). */
const DROPPED_TABLES = ['metrics_raw'];

async function listTables(handle: Kysely<unknown>): Promise<string[]> {
  const { sql } = await import('kysely');
  const result = await sql<{ tablename: string }>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `.execute(handle);
  return result.rows.map((r) => r.tablename).sort();
}

describe.skipIf(!testPg.ok)('Omnitron migrations (integration)', () => {
  beforeAll(async () => {
    resetEnvCache();
    setEnvOverride({ OMNITRON_DATABASE_URL: TEST_PG_URL });

    const { createOmnitronDb } = await import('../../src/database/connection.js');
    db = await createOmnitronDb<unknown>({ max: 2 });

    // Fail loudly rather than skipping: a silently-skipped migration test is
    // exactly the kind of fake coverage that let the original bug survive.
    try {
      const { sql } = await import('kysely');
      await sql`SELECT 1`.execute(db);
    } catch (err) {
      throw new Error(
        `Test PostgreSQL unreachable at ${TEST_PG_URL} — run \`pnpm test:up\` first. Cause: ${(err as Error).message}`
      );
    }
  });

  afterAll(async () => {
    if (db) await db.destroy();
    resetEnvCache();
  });

  beforeEach(async () => {
    const { sql } = await import('kysely');
    await sql`DROP SCHEMA public CASCADE`.execute(db);
    await sql`CREATE SCHEMA public`.execute(db);
  });

  it('creates the full schema from an empty database', async () => {
    const { migrateOmnitronDb } = await import('../../src/database/migration-runner.js');
    const { OMNITRON_MIGRATIONS } = await import('../../src/database/migrations/index.js');

    const outcome = await migrateOmnitronDb(db);

    expect(outcome.applied).toEqual(OMNITRON_MIGRATIONS.map((m) => m.name));

    const tables = await listTables(db);
    for (const table of EXPECTED_TABLES) {
      expect(tables, `expected table ${table}`).toContain(table);
    }
    for (const table of DROPPED_TABLES) {
      expect(tables, `table ${table} should have been dropped`).not.toContain(table);
    }
  });

  it('is idempotent — a second run applies nothing', async () => {
    const { migrateOmnitronDb } = await import('../../src/database/migration-runner.js');

    await migrateOmnitronDb(db);
    const second = await migrateOmnitronDb(db);

    expect(second.applied).toEqual([]);
  });

  it('persists new content checksums while preserving legacy names, timestamps and unknown integrity', async () => {
    const { createMigrationRunner, createMigrationHistory } = await import('../../src/migration/index.js');
    const { OMNITRON_MIGRATIONS } = await import('../../src/database/migrations/index.js');
    const { migrateOmnitronDb, createOmnitronMigrationRunner } = await import('../../src/database/migration-runner.js');
    const old = OMNITRON_MIGRATIONS.slice(0, -1);
    const history = createMigrationHistory();
    await createMigrationRunner(db, old, { history }).up();
    const before = await history.read(db);
    expect((await migrateOmnitronDb(db)).applied).toEqual(['015_persistent_metrics']);
    const after = await createOmnitronMigrationRunner(db).inspect();
    expect(after.executed.slice(0, -1)).toEqual(before);
    expect(after.executed.at(-1)?.checksum).toBe(OMNITRON_MIGRATIONS.at(-1)?.checksum);
    expect(after.executed.at(-1)?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(after.unknownChecksums).toEqual(old.map(m => m.name));
  });

  it('refuses unknown modern history under the migration lock without changing schema or history', async () => {
    const { migrateOmnitronDb, createOmnitronMigrationRunner } = await import('../../src/database/migration-runner.js');
    const { createMigrationHistory } = await import('../../src/migration/index.js');
    await migrateOmnitronDb(db);
    const history = createMigrationHistory();
    await history.insert(db, { name: '999_unreviewed_schema', checksum: 'f'.repeat(64), executedAt: new Date() });
    const before = await createOmnitronMigrationRunner(db).inspect();
    await expect(migrateOmnitronDb(db)).rejects.toThrow(/No matching schema expansion receipt|immutable installed runtime/);
    await expect(createOmnitronMigrationRunner(db).down(1)).rejects.toThrow(/No matching schema expansion receipt|immutable installed runtime/);
    expect(await createOmnitronMigrationRunner(db).inspect()).toEqual(before);
    expect(await listTables(db)).toContain('sync_ingested');
  });

  it('checks replacement readiness without creating history, applying or repairing migrations', async () => {
    const { assertOmnitronMigrationsCurrent, migrateOmnitronDb, createOmnitronMigrationRunner } = await import('../../src/database/migration-runner.js');
    await expect(assertOmnitronMigrationsCurrent(db)).rejects.toThrow('pending: 001_initial_schema');
    expect(await listTables(db)).not.toContain('migrations');
    await migrateOmnitronDb(db);
    await expect(assertOmnitronMigrationsCurrent(db)).resolves.toBeUndefined();
    await createOmnitronMigrationRunner(db).down(1);
    await expect(assertOmnitronMigrationsCurrent(db)).rejects.toThrow('pending: 015_persistent_metrics');
    expect((await createOmnitronMigrationRunner(db).inspect()).pending).toEqual(['015_persistent_metrics']);
    const { sql } = await import('kysely');
    const table = await sql<{ table: string | null }>`select to_regclass('public.metrics_samples')::text as table`.execute(db);
    expect(table.rows[0]?.table).toBeNull();
  });

  it('adopts a pre-existing Kysely migration history instead of re-applying it', async () => {
    // Reproduces the first boot after the switch to @kysera/migrations on an
    // installation migrated by the old Kysely `Migrator`: the schema is fully
    // present and `kysely_migration` holds the history, but the @kysera
    // bookkeeping table is empty. Without adoption the run fails with
    // `relation "nodes" already exists` — which is what the live daemon logged.
    const { migrateOmnitronDb } = await import('../../src/database/migration-runner.js');
    const { OMNITRON_MIGRATIONS } = await import('../../src/database/migrations/index.js');
    const { sql } = await import('kysely');

    // Build the schema, then rewrite history into the legacy shape.
    await migrateOmnitronDb(db);
    await sql`DROP TABLE migrations`.execute(db);
    await sql`
      CREATE TABLE kysely_migration (name varchar(255) PRIMARY KEY, timestamp varchar(255) NOT NULL)
    `.execute(db);
    for (const migration of OMNITRON_MIGRATIONS) {
      await sql`
        INSERT INTO kysely_migration (name, timestamp) VALUES (${migration.name}, ${'2026-03-22T19:39:38.304Z'})
      `.execute(db);
    }

    const outcome = await migrateOmnitronDb(db);

    expect(outcome.applied).toEqual([]);
    const tracked = await sql<{ name: string }>`SELECT name FROM migrations ORDER BY name`.execute(db);
    expect(tracked.rows.map((r) => r.name)).toEqual(OMNITRON_MIGRATIONS.map((m) => m.name));
    // The schema survived untouched.
    const tables = await listTables(db);
    expect(tables).toContain('alert_rules');
  });

  it('does not adopt legacy names the current build does not know', async () => {
    const { migrateOmnitronDb } = await import('../../src/database/migration-runner.js');
    const { sql } = await import('kysely');

    await sql`
      CREATE TABLE kysely_migration (name varchar(255) PRIMARY KEY, timestamp varchar(255) NOT NULL)
    `.execute(db);
    await sql`
      INSERT INTO kysely_migration (name, timestamp) VALUES ('999_from_the_future', ${'2026-03-22T19:39:38.304Z'})
    `.execute(db);

    // Nothing to adopt ⇒ every registered migration is still pending and runs.
    const outcome = await migrateOmnitronDb(db);

    expect(outcome.applied.length).toBeGreaterThan(0);
    const tracked = await sql<{ name: string }>`SELECT name FROM migrations`.execute(db);
    expect(tracked.rows.map((r) => r.name)).not.toContain('999_from_the_future');
  });

  it('does not resurrect a rolled-back legacy migration during adoption', async () => {
    const { migrateOmnitronDb, createOmnitronMigrationRunner } = await import('../../src/database/migration-runner.js');
    const { OMNITRON_MIGRATIONS } = await import('../../src/database/migrations/index.js');
    const { sql } = await import('kysely');
    await migrateOmnitronDb(db);
    await sql`create table kysely_migration (name varchar(255) primary key, timestamp varchar(255) not null)`.execute(db);
    for (const migration of OMNITRON_MIGRATIONS) {
      await sql`insert into kysely_migration values (${migration.name}, ${'2026-03-22T19:39:38.304Z'})`.execute(db);
    }
    await sql`delete from migrations`.execute(db);
    const runner = createOmnitronMigrationRunner(db);
    const before = await runner.inspect();
    expect(before.pending).toEqual([]);
    expect((await sql`select * from migrations`.execute(db)).rows).toEqual([]);
    await runner.down(1);
    const last = OMNITRON_MIGRATIONS.at(-1)!.name;
    expect((await runner.inspect()).pending).toEqual([last]);
    expect((await migrateOmnitronDb(db)).applied).toEqual([last]);
    expect((await migrateOmnitronDb(db)).applied).toEqual([]);
  });

  it('creates the tables whose absence produced the live log storm', async () => {
    const { migrateOmnitronDb } = await import('../../src/database/migration-runner.js');
    await migrateOmnitronDb(db);

    const tables = await listTables(db);
    // `Alert evaluation failed` / `Session cleanup failed` fired every few
    // seconds on the live daemon because these two never existed.
    expect(tables).toContain('alert_rules');
    expect(tables).toContain('omnitron_sessions');
  });
});
