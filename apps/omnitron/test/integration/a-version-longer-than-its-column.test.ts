/**
 * A version longer than its column.
 *
 * `node_health_checks."omnitronVersion"` was varchar(32), and a node running
 * a bundle built from a working tree reports `0.2.0+local.<sha>.<stamp>` — 37
 * characters. The health monitor writes each round as ONE insert with a row
 * per node, so from the first round in which such a node answered, every
 * round failed whole: on the master, 2026-09-22, no row for any node after
 * 12:15:55 UTC — the master's own included — while Postgres logged once a
 * minute «value too long for type character varying(32)». The console's
 * uptime bars had nothing to show.
 *
 * Two halves, both pinned: the column holds what a node says (migration
 * 008), and a row the table refuses costs that row and not the round — the
 * next column somebody sizes too tightly must not switch the whole fleet's
 * history off again.
 *
 * Against a real Postgres, migrated by the real migrations, in a database
 * of its own.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql, type Kysely } from 'kysely';

import { HealthMonitorService } from '../../src/workers/health-monitor.service.js';
import type { IHealthCheckResult } from '../../src/workers/types.js';
import type { OmnitronDatabase } from '../../src/database/schema.js';
import { requiresTestPostgres } from './requires-test-postgres.js';
import { databaseOfItsOwn, type OwnDatabase } from './a-database-of-its-own.js';

const TEST_PG_URL = process.env['TEST_DATABASE_URL'] ?? 'postgresql://test:test@localhost:15432/test';
const testPg = await requiresTestPostgres(TEST_PG_URL);

/** What the test node answered on 2026-09-22: 37 characters. */
const BUILD_STAMPED = '0.2.0+local.f5dec792c4a3.202609221401';

let own: OwnDatabase | undefined;
let db: Kysely<OmnitronDatabase>;

beforeAll(async () => {
  if (!testPg.ok) return;
  own = await databaseOfItsOwn(TEST_PG_URL, `omnitron_node_health_${process.pid}`);
  db = own.db;
});

afterAll(async () => {
  await own?.drop();
});

beforeEach(async () => {
  if (!testPg.ok) return;
  await sql`TRUNCATE node_health_checks`.execute(db);
});

const warnings: Array<{ fields: Record<string, unknown>; msg: string }> = [];

/** The worker, with the pool it would have opened replaced by this test's own. */
function worker(): HealthMonitorService {
  warnings.length = 0;
  const logger: any = {
    info: () => {},
    debug: () => {},
    error: () => {},
    warn: (fields: Record<string, unknown>, msg: string) => warnings.push({ fields, msg }),
    child: () => logger,
  };
  const svc = new HealthMonitorService({ logger } as never);
  (svc as unknown as { db: Kysely<OmnitronDatabase> }).db = db;
  return svc;
}

function result(nodeId: string, version: string | null): IHealthCheckResult {
  return {
    nodeId,
    checkedAt: new Date().toISOString(),
    checkDurationMs: 42,
    pingReachable: true,
    pingLatencyMs: 1.5,
    pingError: null,
    sshConnected: true,
    sshLatencyMs: 12,
    sshError: null,
    omnitronConnected: version !== null,
    omnitronVersion: version,
    omnitronPid: version ? 2504038 : null,
    omnitronUptime: version ? 13_000 : null,
    omnitronRole: version ? 'slave' : null,
    omnitronError: null,
    os: { platform: 'linux', arch: 'x64', hostname: 'daos-cpp', release: '6.8.0' },
  };
}

const persist = (svc: HealthMonitorService, results: IHealthCheckResult[]) =>
  (svc as unknown as { persistResults(r: IHealthCheckResult[]): Promise<void> }).persistResults(results);

async function stored(): Promise<Array<{ nodeId: string; omnitronVersion: string | null }>> {
  return (await db
    .selectFrom('node_health_checks')
    .select(['nodeId', 'omnitronVersion'])
    .orderBy('nodeId')
    .execute()) as Array<{ nodeId: string; omnitronVersion: string | null }>;
}

describe.skipIf(!testPg.ok)('a version longer than its column', () => {
  it('records a node that reports a build-stamped version, and the round beside it', async () => {
    await persist(worker(), [result('local', '0.2.0'), result('16f3dd5a-2727-49e5-90a2-d762b57073f6', BUILD_STAMPED)]);

    expect(await stored()).toEqual([
      { nodeId: '16f3dd5a-2727-49e5-90a2-d762b57073f6', omnitronVersion: BUILD_STAMPED },
      { nodeId: 'local', omnitronVersion: '0.2.0' },
    ]);
    expect(warnings).toEqual([]);
  });

  it('costs a row the table refuses that row, not the round, and names the node', async () => {
    // `nodeId` is varchar(64); this one is not — the next too-tight column,
    // whichever it turns out to be.
    const unfit = 'n'.repeat(80);

    await persist(worker(), [result('local', '0.2.0'), result(unfit, '0.2.0'), result('126457d0-e6d3-4366-92f4-b149b3b6864c', null)]);

    expect((await stored()).map((r) => r.nodeId)).toEqual(['126457d0-e6d3-4366-92f4-b149b3b6864c', 'local']);
    const said = warnings.find((w) => w.msg === 'Health check results refused for some nodes — the others were stored');
    expect(said, 'a refusal that is said').toBeDefined();
    expect(said!.fields['stored']).toBe(2);
    expect((said!.fields['refused'] as Array<{ nodeId: string }>).map((r) => r.nodeId)).toEqual([unfit]);
  });
});
