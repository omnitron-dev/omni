/**
 * A breakdown beside a total it did not add up to.
 *
 * The console's log page printed «Showing 100 of 48 991» — the rows its
 * filter matched, an hour by default — and beside it «debug: 762 291 · info:
 * 8 215 811 · warn: 138 116 · error: 42 650 · fatal: 1»: `getLogStats`, the
 * whole table's levels, 9 159 730 rows since 09-09, filtered by nothing. The
 * hour held 149 errors. Choosing ERROR still showed all five levels.
 *
 * `queryLogs` now counts its rows by level, and the total is their sum: one
 * query over one definition of which rows, so the two cannot part. Run on
 * both engines a daemon keeps logs in — SQLite on a slave, Postgres on the
 * master — because the claim is about the SQL each of them runs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, sql } from 'kysely';

import { LogCollectorService } from '../../src/services/log-collector.service.js';
import { withDateBinding } from '../../src/database/sqlite-date-binding.js';
import { setEnvOverride, resetEnvCache } from '../../src/shared/env-config.js';
import { requiresTestPostgres } from './requires-test-postgres.js';

const TEST_PG_URL = process.env['TEST_DATABASE_URL'] ?? 'postgresql://test:test@localhost:15432/test';
const testPg = await requiresTestPostgres(TEST_PG_URL);
const SCHEMA = `court_breakdown_${process.pid}`;

const MAIN = 'court/dev/main';
const PAYSYS = 'court/dev/paysys';
const NOW = Date.now();
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const HOUR_AGO = minutesAgo(60);

/**
 * Within the hour: seven lines of main — `medium` is what a writer's own
 * `level` field leaves in the record — and two of paysys. Before it: four
 * errors of main, which an hour's breakdown must not count.
 */
const ROWS: Array<[app: string, level: string, minutesAgo: number]> = [
  [MAIN, 'info', 5],
  [MAIN, 'info', 6],
  [MAIN, 'info', 7],
  [MAIN, 'error', 8],
  [MAIN, 'error', 9],
  [MAIN, 'medium', 10],
  [MAIN, 'debug', 11],
  [PAYSYS, 'warn', 12],
  [PAYSYS, 'warn', 13],
  [MAIN, 'error', 120],
  [MAIN, 'error', 121],
  [MAIN, 'error', 122],
  [MAIN, 'error', 123],
];

const asMap = (byLevel: Array<{ level: string; count: number }>) =>
  Object.fromEntries(byLevel.map(({ level, count }) => [level, count]));

function courtOf(engine: () => LogCollectorService) {
  it("counts the filter's rows by level, and the total is their sum", async () => {
    const result = await engine().queryLogs({ app: MAIN, from: HOUR_AGO });

    expect(asMap(result.byLevel)).toEqual({ info: 3, error: 2, medium: 1, debug: 1 });
    expect(result.total).toBe(7);
    expect(result.entries).toHaveLength(7);
  });

  it('breaks down only the levels the filter chose', async () => {
    const result = await engine().queryLogs({ from: HOUR_AGO, level: ['error'] });

    expect(result.byLevel).toEqual([{ level: 'error', count: 2 }]);
    expect(result.total).toBe(2);
  });

  it('counts every row when nothing narrows them', async () => {
    const result = await engine().queryLogs({});

    expect(asMap(result.byLevel)).toEqual({ info: 3, error: 6, medium: 1, debug: 1, warn: 2 });
    expect(result.total).toBe(13);
  });

  it('pages the same total it breaks down', async () => {
    const result = await engine().queryLogs({ app: MAIN, from: HOUR_AGO, limit: 2 });

    expect(result.entries).toHaveLength(2);
    expect(result.total).toBe(7);
    expect(result.hasMore).toBe(true);
  });
}

describe('on a slave (SQLite)', () => {
  let collector: LogCollectorService;

  beforeAll(() => {
    // The slave's `logs` DDL, in shape: TEXT columns, timestamps as ISO text;
    // and its driver, which binds a `Date` as that text (`slave-storage`).
    const database = new Database(':memory:');
    database.exec(`
      CREATE TABLE logs (
        id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, nodeId TEXT,
        app TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'info',
        message TEXT NOT NULL DEFAULT '', labels TEXT, traceId TEXT,
        spanId TEXT, metadata TEXT
      )
    `);
    const insert = database.prepare('INSERT INTO logs (id, timestamp, app, level, message) VALUES (?,?,?,?,?)');
    ROWS.forEach(([app, level, ago], i) => insert.run(`l${i}`, minutesAgo(ago), app, level, `line ${i}`));
    const db = new Kysely<any>({ dialect: new SqliteDialect({ database: withDateBinding(database) }) });
    collector = new LogCollectorService(db, undefined as never);
  });

  courtOf(() => collector);
});

describe.skipIf(!testPg.ok)('on the master (Postgres)', () => {
  let db: Kysely<any>;
  let collector: LogCollectorService;

  beforeAll(async () => {
    resetEnvCache();
    setEnvOverride({ OMNITRON_DATABASE_URL: TEST_PG_URL });
    const { createOmnitronDb } = await import('../../src/database/connection.js');
    db = await createOmnitronDb<any>({ max: 1, options: `-c search_path=${SCHEMA}` });
    await sql.raw(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}`).execute(db);
    const { OMNITRON_MIGRATIONS } = await import('../../src/database/migrations/index.js');
    for (const migration of OMNITRON_MIGRATIONS) await migration.up(db);

    for (const [app, level, ago] of ROWS) {
      await sql`
        INSERT INTO logs (id, timestamp, app, level, message)
        VALUES (gen_random_uuid(), ${minutesAgo(ago)}::timestamptz, ${app}, ${level}, 'line')
      `.execute(db);
    }
    collector = new LogCollectorService(db as never, undefined as never);
  });

  afterAll(async () => {
    if (db) {
      await sql.raw(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).execute(db);
      await db.destroy();
    }
    resetEnvCache();
  });

  courtOf(() => collector);
});
