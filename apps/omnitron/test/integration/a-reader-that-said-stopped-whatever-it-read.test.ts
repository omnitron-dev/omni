/**
 * A reader that said «stopped» whatever it read.
 *
 * Until dea8ce80 the health checker read `pid` outside the `{ok, data}`
 * envelope of `omnitron status --json`, so every answer from a running
 * daemon was stored as `omnitronConnected = false` — silently until
 * 2026-09-14, then with «omnitron status reported no running daemon». On the
 * master, 2026-09-23: 7 637 rows with the words and 3 895 silent ones for the
 * test node, while that node's daemon delivered its apps' logs to the master
 * every day from 09-16. The console averaged them into «OMNITRON 6%».
 *
 * Migration 009 marks them not measured (NULL). The court runs it on a real
 * Postgres, in a schema of its own so no other suite's tables are touched,
 * and reads the result the way the console does: through `getUptimeBar`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, type Kysely } from 'kysely';

import { setEnvOverride, resetEnvCache } from '../../src/shared/env-config.js';
import { requiresTestPostgres } from './requires-test-postgres.js';

const TEST_PG_URL = process.env['TEST_DATABASE_URL'] ?? 'postgresql://test:test@localhost:15432/test';
const testPg = await requiresTestPostgres(TEST_PG_URL);

const SCHEMA = `court_reader_${process.pid}`;
const OLD_ANSWER = 'omnitron status reported no running daemon';
const DAY = 86_400_000;
/** Day 0 of the court: the checks sit on days 1–6 before it, one per day. */
const TODAY = Date.now();
const dayAgo = (n: number) => new Date(TODAY - n * DAY + 3_600_000).toISOString();

let db: Kysely<any>;

async function check(nodeId: string, daysAgo: number, connected: boolean, error: string | null, ssh = true) {
  await sql`
    INSERT INTO node_health_checks
      ("nodeId", "checkedAt", "checkDurationMs", "pingReachable", "sshConnected", "omnitronConnected", "omnitronError")
    VALUES (${nodeId}, ${dayAgo(daysAgo)}::timestamptz, 10, true, ${ssh}, ${connected}, ${error})
  `.execute(db);
}

describe.skipIf(!testPg.ok)('a reader that said «stopped» whatever it read', () => {
  beforeAll(async () => {
    resetEnvCache();
    setEnvOverride({ OMNITRON_DATABASE_URL: TEST_PG_URL });
    const { createOmnitronDb } = await import('../../src/database/connection.js');
    db = await createOmnitronDb<any>({ max: 1, options: `-c search_path=${SCHEMA}` });
    await sql.raw(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}`).execute(db);

    const { OMNITRON_MIGRATIONS } = await import('../../src/database/migrations/index.js');
    const upTo008 = OMNITRON_MIGRATIONS.slice(0, OMNITRON_MIGRATIONS.findIndex((m) => m.name.startsWith('009')));
    for (const migration of upTo008) await migration.up(db);

    // The test node: the old reader, silent and then with words, then the
    // corrected one read it connected, then — a day later — genuinely found
    // no daemon.
    await check('node-read-later', 6, false, null);
    await check('node-read-later', 5, false, OLD_ANSWER);
    await check('node-read-later', 4, false, OLD_ANSWER);
    await check('node-read-later', 3, false, 'SSH unavailable — omnitron state unknown', false);
    await check('node-read-later', 2, true, null);
    await check('node-read-later', 1, false, OLD_ANSWER);
    // A node never read connected: nothing proves its reader was the old one.
    await check('node-never-read', 5, false, OLD_ANSWER);

    await OMNITRON_MIGRATIONS.find((m) => m.name.startsWith('009'))!.up(db);
  });

  afterAll(async () => {
    if (db) {
      await sql.raw(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).execute(db);
      await db.destroy();
    }
    resetEnvCache();
  });

  const rows = async (nodeId: string) =>
    (
      await sql<{ connected: boolean | null; error: string | null }>`
        SELECT "omnitronConnected" AS connected, "omnitronError" AS error
          FROM node_health_checks WHERE "nodeId" = ${nodeId} ORDER BY "checkedAt"
      `.execute(db)
    ).rows;

  it('marks what the old reader said before the node was first read connected, and nothing else', async () => {
    expect(await rows('node-read-later')).toEqual([
      { connected: null, error: null },
      { connected: null, error: null },
      { connected: null, error: null },
      { connected: false, error: 'SSH unavailable — omnitron state unknown' },
      { connected: true, error: null },
      { connected: false, error: OLD_ANSWER },
    ]);
    expect(await rows('node-never-read')).toEqual([{ connected: false, error: OLD_ANSWER }]);
  });

  it('shows those days as not measured, not as 0%', async () => {
    const { NodeHealthRepository } = await import('../../src/services/node-health.repository.js');
    const bar = await new NodeHealthRepository(db).getUptimeBar('node-read-later', 7, DAY);
    const days = bar.filter((b) => b.checks > 0).map((b) => [b.omnitron, b.omnitronUnmeasured ?? null]);

    expect(days).toEqual([
      [-1, 'unread'],
      [-1, 'unread'],
      [-1, 'unread'],
      [-1, 'unreachable'],
      [1, null],
      [0, null],
    ]);
  });

  it('goes back to «false» and a required column — without the words, which carried nothing', async () => {
    const { OMNITRON_MIGRATIONS } = await import('../../src/database/migrations/index.js');
    await OMNITRON_MIGRATIONS.find((m) => m.name.startsWith('009'))!.down!(db);

    expect((await rows('node-read-later')).slice(0, 3)).toEqual([
      { connected: false, error: null },
      { connected: false, error: null },
      { connected: false, error: null },
    ]);
    const { rows: column } = await sql<{ is_nullable: string }>`
      SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = ${SCHEMA} AND table_name = 'node_health_checks' AND column_name = 'omnitronConnected'
    `.execute(db);
    expect(column).toEqual([{ is_nullable: 'NO' }]);
  });
});
