/**
 * A master that forgot its own row.
 *
 * The daemon registers itself in `nodes` at start (`registerNode`) and
 * dropped the id it got back; its heartbeat then had nothing to name and sent
 * the literal `'self'`, which a uuid column refuses. The row kept the
 * `lastHeartbeat` of the moment it was created — on the master, 2026-09-22,
 * 18:06:06 UTC, hours old while the daemon ran. See the job's side in
 * `test/daemon/a-heartbeat-for-a-row-called-self.spec.ts`.
 *
 * Against a real Postgres: the row, the uuid and the count of rows an UPDATE
 * reached are the database's answers, not a stand-in's.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';

import { FleetService } from '../../src/services/fleet.service.js';
import type { OmnitronDatabase } from '../../src/database/schema.js';
import { requiresTestPostgres } from './requires-test-postgres.js';
import { databaseOfItsOwn, type OwnDatabase } from './a-database-of-its-own.js';

const TEST_PG_URL = process.env['TEST_DATABASE_URL'] ?? 'postgresql://test:test@localhost:15432/test';
const testPg = await requiresTestPostgres(TEST_PG_URL);

let own: OwnDatabase | undefined;
let db: Kysely<OmnitronDatabase>;

beforeAll(async () => {
  if (!testPg.ok) return;
  own = await databaseOfItsOwn(TEST_PG_URL, `omnitron_fleet_self_${process.pid}`);
  db = own.db;
});

afterAll(async () => {
  await own?.drop();
});

beforeEach(async () => {
  if (!testPg.ok) return;
  await sql`TRUNCATE nodes CASCADE`.execute(db);
});

const fleet = () => new FleetService(db, { logger: createNullLogger() } as never, undefined);

const self = {
  hostname: 'MacBook-Pro-Taaliman.local',
  address: '127.0.0.1',
  port: 9700,
  role: 'leader' as const,
  metadata: { pid: 47939 },
};

describe.skipIf(!testPg.ok)('a master that forgot its own row', () => {
  it('knows which row is its own once it has registered itself', async () => {
    const svc = fleet();
    expect(svc.selfNodeId, 'nothing configured, nothing registered').toBeUndefined();

    const node = await svc.registerSelf(self);

    expect(svc.selfNodeId).toBe(node.id);
    expect(node.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('moves that row forward on every heartbeat', async () => {
    const svc = fleet();
    const node = await svc.registerSelf(self);
    await sql`UPDATE nodes SET "lastHeartbeat" = now() - interval '6 hours', status = 'offline'`.execute(db);

    const reached = await svc.heartbeat(svc.selfNodeId!);

    expect(reached).toBe(1);
    const row = await db.selectFrom('nodes').select(['lastHeartbeat', 'status']).where('id', '=', node.id).executeTakeFirstOrThrow();
    expect(Date.now() - new Date(row.lastHeartbeat as unknown as string).getTime()).toBeLessThan(60_000);
    expect(row.status).toBe('online');
  });

  it('answers a heartbeat for a row that is not there with nothing reached, not with success', async () => {
    expect(await fleet().heartbeat('40655c07-4824-46b8-b793-af9fce7a383e')).toBe(0);
  });

  it('keeps a configured id over the one it registered', async () => {
    const svc = new FleetService(db, { logger: createNullLogger() } as never, 'configured-node');
    await svc.registerSelf(self);
    expect(svc.selfNodeId).toBe('configured-node');
  });
});
