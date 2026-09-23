/**
 * A check that could not read the answer, counted as an answer.
 *
 * The uptime strip counted every omnitron error with SSH up as «not
 * running»: a timeout, output that was not JSON, an exec that failed. None
 * of those says anything about the daemon. And it matched «not installed»
 * anywhere in the error, so a timeout — whose message echoes the command,
 * and the command contains «omnitron: command not found» — read as not
 * installed: 19 such rows on the master, 2026-09-15 → 09-22.
 *
 * Now a check measures omnitron only when it found it running or the node
 * said it was not (`omnitronFinding`, shared/node-check.ts), and the SQL
 * aggregate reads each row the same way. The court runs the aggregate on a
 * real Postgres, one day per form, and holds it to the shared reading.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, type Kysely } from 'kysely';

import { setEnvOverride, resetEnvCache } from '../../src/shared/env-config.js';
import { NOT_INSTALLED, NOT_RUNNING, omnitronFinding, type OmnitronFinding } from '../../src/shared/node-check.js';
import { requiresTestPostgres } from './requires-test-postgres.js';

const TEST_PG_URL = process.env['TEST_DATABASE_URL'] ?? 'postgresql://test:test@localhost:15432/test';
const testPg = await requiresTestPostgres(TEST_PG_URL);

const SCHEMA = `court_answer_${process.pid}`;
const DAY = 86_400_000;
const TODAY = Date.now();
const dayAgo = (n: number) => new Date(TODAY - n * DAY + 3_600_000).toISOString();

/** The checker's own words, as the master's history holds them. */
const TIMEOUT = `Command timed out after 15000ms: command -v omnitron >/dev/null 2>&1 || { echo "${NOT_INSTALLED}" >&2; exit 127; }; omnitron status --json`;

interface Row {
  daysAgo: number;
  ssh: boolean;
  connected: boolean;
  error: string | null;
}

/** One day per form, oldest first. */
const FORMS: Row[] = [
  { daysAgo: 7, ssh: true, connected: true, error: null },
  { daysAgo: 6, ssh: true, connected: false, error: NOT_RUNNING },
  { daysAgo: 5, ssh: true, connected: false, error: TIMEOUT },
  { daysAgo: 4, ssh: true, connected: false, error: 'omnitron status did not return JSON' },
  { daysAgo: 3, ssh: true, connected: false, error: "Adapter 'ssh' failed during 'execute': Unable to exec" },
  { daysAgo: 2, ssh: true, connected: false, error: NOT_INSTALLED },
  { daysAgo: 1, ssh: false, connected: false, error: 'SSH unavailable — omnitron state unknown' },
];

/** What a day of one check reads as on the strip, for each finding. */
const STRIP: Record<OmnitronFinding, [number, string | null]> = {
  running: [1, null],
  'not-running': [0, null],
  'not-installed': [-1, 'absent'],
  unreachable: [-1, 'unreachable'],
  unread: [-1, 'unread'],
};

let db: Kysely<any>;

async function insert(nodeId: string, row: Row) {
  await sql`
    INSERT INTO node_health_checks
      ("nodeId", "checkedAt", "checkDurationMs", "pingReachable", "sshConnected", "omnitronConnected", "omnitronError")
    VALUES (${nodeId}, ${dayAgo(row.daysAgo)}::timestamptz, 10, true, ${row.ssh}, ${row.connected}, ${row.error})
  `.execute(db);
}

describe.skipIf(!testPg.ok)('a check that could not read the answer, counted as an answer', () => {
  beforeAll(async () => {
    resetEnvCache();
    setEnvOverride({ OMNITRON_DATABASE_URL: TEST_PG_URL });
    const { createOmnitronDb } = await import('../../src/database/connection.js');
    db = await createOmnitronDb<any>({ max: 1, options: `-c search_path=${SCHEMA}` });
    await sql.raw(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}`).execute(db);
    const { OMNITRON_MIGRATIONS } = await import('../../src/database/migrations/index.js');
    for (const migration of OMNITRON_MIGRATIONS) await migration.up(db);

    for (const row of FORMS) await insert('node-forms', row);
    // A day of three answers and one timeout.
    for (let i = 0; i < 3; i++) await insert('node-mixed', { daysAgo: 1, ssh: true, connected: true, error: null });
    await insert('node-mixed', { daysAgo: 1, ssh: true, connected: false, error: TIMEOUT });
  });

  afterAll(async () => {
    if (db) {
      await sql.raw(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).execute(db);
      await db.destroy();
    }
    resetEnvCache();
  });

  const strip = async (nodeId: string) => {
    const { NodeHealthRepository } = await import('../../src/services/node-health.repository.js');
    const bar = await new NodeHealthRepository(db).getUptimeBar(nodeId, 8, DAY);
    return bar.filter((b) => b.checks > 0).map((b) => [b.omnitron, b.omnitronUnmeasured ?? null]);
  };

  // The three forms of an answer that could not be read, each its own case.
  it.each([
    ['a timeout — not «not installed», though its text says so', 5],
    ['output that was not JSON', 4],
    ['an exec that failed', 3],
  ])('does not count %s as «not running»', async (_what, daysAgo) => {
    const day = FORMS.findIndex((row) => row.daysAgo === daysAgo);
    expect((await strip('node-forms'))[day]).toEqual([-1, 'unread']);
  });

  it('counts «running» and «not running» as measurements, and names the rest', async () => {
    expect(await strip('node-forms')).toEqual([
      [1, null],
      [0, null],
      [-1, 'unread'],
      [-1, 'unread'],
      [-1, 'unread'],
      [-1, 'absent'],
      [-1, 'unreachable'],
    ]);
  });

  it('reads every row the way the console’s dot reads it', async () => {
    const expected = FORMS.map((row) =>
      STRIP[omnitronFinding({ sshConnected: row.ssh, omnitronConnected: row.connected, omnitronError: row.error })],
    );
    expect(await strip('node-forms')).toEqual(expected);
  });

  it('divides a day by what was measured, not by every check', async () => {
    expect(await strip('node-mixed')).toEqual([[1, null]]);
  });
});
