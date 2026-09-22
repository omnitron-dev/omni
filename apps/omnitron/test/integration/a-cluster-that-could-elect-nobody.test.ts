/**
 * A cluster that could elect nobody.
 *
 * Peers find each other in the fleet table, and `isFleetMember` answers
 * «is this candidate — or this leader — one of us» by looking its id up
 * there. The rows are keyed by uuid. The daemon constructed its election as
 * `${hostname}-${port}` (daemon.ts), a name no row carries. So in a cluster
 * of two masters or more:
 *
 *   - every vote a node asked for was refused as coming from a stranger, and
 *     every heartbeat it sent as leader was ignored the same way;
 *   - its own `heartbeat` and `setRole` failed on the uuid column;
 *   - it counted itself among its peers — `n.id !== this.nodeId` never
 *     excludes a row whose id is not that name.
 *
 * Nobody could have been elected. The election now takes its name from its
 * row when it starts: the daemon registers itself first (`registerSelf`).
 * On a master with `cluster.enabled` off — this one — the election is never
 * constructed, and nothing here changes.
 *
 * Two masters sharing one fleet table on a real Postgres: the rows, their
 * ids and what an UPDATE reaches are the database's answers.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';

import { FleetService } from '../../src/services/fleet.service.js';
import { LeaderElection } from '../../src/cluster/leader-election.js';
import type { OmnitronDatabase } from '../../src/database/schema.js';
import { requiresTestPostgres } from './requires-test-postgres.js';
import { databaseOfItsOwn, type OwnDatabase } from './a-database-of-its-own.js';

const TEST_PG_URL = process.env['TEST_DATABASE_URL'] ?? 'postgresql://test:test@localhost:15432/test';
const testPg = await requiresTestPostgres(TEST_PG_URL);

let own: OwnDatabase | undefined;
let db: Kysely<OmnitronDatabase>;

beforeAll(async () => {
  if (!testPg.ok) return;
  own = await databaseOfItsOwn(TEST_PG_URL, `omnitron_cluster_names_${process.pid}`);
  db = own.db;
});

afterAll(async () => {
  await own?.drop();
});

beforeEach(async () => {
  if (!testPg.ok) return;
  await sql`TRUNCATE nodes CASCADE`.execute(db);
});

const elections: LeaderElection[] = [];

/** A master as the daemon brings one up: register itself, then the election, named as daemon.ts names it. */
async function master(hostname: string, port: number) {
  const fleet = new FleetService(db, { logger: createNullLogger() } as never, undefined);
  await fleet.registerSelf({ hostname, address: `10.0.0.${port - 9690}`, port, role: 'follower', metadata: { rpcPort: port + 100 } });
  const election = new LeaderElection(`${hostname}-${port}`, fleet as never, createNullLogger() as never);
  elections.push(election);
  await election.start();
  return { fleet, election, row: fleet.selfNodeId! };
}

describe.skipIf(!testPg.ok)('a cluster that could elect nobody', () => {
  afterEach(() => {
    for (const e of elections.splice(0)) e.stop();
  });

  it('is known to its peers by the name they can find it under', async () => {
    const a = await master('master-a', 9700);
    const b = await master('master-b', 9701);

    expect(a.election.getClusterState().nodeId, 'the row, not hostname-port').toBe(a.row);

    // B is asked for a vote by A, the way ClusterRpcService relays it.
    const vote = await b.election.onVoteRequest({ candidateId: a.election.getClusterState().nodeId, term: 1 });
    expect(vote.granted, 'a vote a peer would have refused as from a stranger').toBe(true);
  });

  it("beats its own row, and not a name the column cannot hold", async () => {
    const a = await master('master-a', 9700);
    await sql`UPDATE nodes SET "lastHeartbeat" = now() - interval '1 hour'`.execute(db);

    await (a.election as unknown as { sendHeartbeats(): Promise<void> }).sendHeartbeats();

    const row = await db.selectFrom('nodes').select('lastHeartbeat').where('id', '=', a.row).executeTakeFirstOrThrow();
    expect(Date.now() - new Date(row.lastHeartbeat as unknown as string).getTime()).toBeLessThan(60_000);
  });

  it('does not count itself among its peers', async () => {
    const a = await master('master-a', 9700);
    const b = await master('master-b', 9701);
    const called = vi
      .spyOn(a.election as unknown as { callPeerRpc(host: string, port: number): Promise<unknown> }, 'callPeerRpc')
      .mockResolvedValue(undefined);

    await (a.election as unknown as { sendHeartbeats(): Promise<void> }).sendHeartbeats();

    const peersCalled = called.mock.calls.map(([host, port]) => `${host}:${port}`);
    expect(peersCalled).toEqual([`10.0.0.11:${9701 + 100}`]);
    void b;
  });
});
