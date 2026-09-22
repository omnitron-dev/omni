/**
 * A ledger nothing pruned.
 *
 * `sync_ingested` is the master's record of which entries it has taken from
 * each node — what makes an entry offered twice be taken once. It was written
 * on every entry and pruned by nothing: on the master, 2026-09-22, 9 934 304
 * rows and 2.2 GB, growing by ~3.3 million a day per node, beside an index on
 * `ingestedAt` that its migration says is there «for pruning».
 *
 * A claim is needed only while its node may still offer the entry: the batch
 * in flight when a connection dropped between the claim and the ack. The
 * window (`LEDGER_WINDOW_DAYS`) has to outlast that, and what this pins is
 * the line itself — a pruner that cuts one second too young turns the
 * master's dedup into a replay taken as new.
 *
 * Against a real Postgres, in a database of its own: the pruning is one
 * statement over a composite key, which a stand-in would accept in any form.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';

import { SyncService, type SyncBatch } from '../../src/services/sync.service.js';
import { LEDGER_FIRST_PASS_DELAY_MS, LEDGER_INTERVAL_MS, LEDGER_WINDOW_DAYS } from '../../src/services/sync-policy.js';
import { planRetention } from '../../src/services/log-retention.js';
import type { OmnitronDatabase } from '../../src/database/schema.js';
import { requiresTestPostgres } from './requires-test-postgres.js';
import { databaseOfItsOwn, type OwnDatabase } from './a-database-of-its-own.js';

const TEST_PG_URL = process.env['TEST_DATABASE_URL'] ?? 'postgresql://test:test@localhost:15432/test';
const testPg = await requiresTestPostgres(TEST_PG_URL);

const NODE = '16f3dd5a-2727-49e5-90a2-d762b57073f6';
const HOUR = 60 * 60 * 1000;

let own: OwnDatabase | undefined;
let db: Kysely<OmnitronDatabase>;

beforeAll(async () => {
  if (!testPg.ok) return;
  own = await databaseOfItsOwn(TEST_PG_URL, `omnitron_sync_ledger_${process.pid}`);
  db = own.db;
});

afterAll(async () => {
  await own?.drop();
});

beforeEach(async () => {
  if (!testPg.ok) return;
  await sql`TRUNCATE sync_ingested, logs`.execute(db);
});

const infos: Array<{ msg: string; fields: Record<string, unknown> }> = [];
const logger: any = {
  ...createNullLogger(),
  info: (fields: Record<string, unknown>, msg: string) => infos.push({ msg, fields }),
  child: () => logger,
};

function master() {
  infos.length = 0;
  return new SyncService(db, logger, 'MacBook-Pro-9700', 'master', {});
}

/** A claim as the ingest path writes it, dated `ageMs` before `now`. */
async function claimed(entryId: string, ageMs: number, now: number) {
  await db
    .insertInto('sync_ingested')
    .values({ nodeId: NODE, entryId, ingestedAt: new Date(now - ageMs) } as never)
    .execute();
}

async function claims(): Promise<string[]> {
  const rows = await db.selectFrom('sync_ingested').select('entryId').orderBy('entryId').execute();
  return rows.map((r) => String(r.entryId));
}

function batch(id: string): SyncBatch {
  const entries = [{ id, category: 'logs' as const, payload: { app: 'main', message: `line ${id}` }, createdAt: new Date().toISOString() }];
  return {
    nodeId: NODE,
    batchId: `daos-cpp-9700-${id}`,
    checksum: createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
    entries,
  };
}

describe.skipIf(!testPg.ok)('a ledger nothing pruned', () => {
  it('forgets claims older than the window and keeps every younger one', async () => {
    const now = Date.now();
    const window = LEDGER_WINDOW_DAYS * 24 * HOUR;
    await claimed('old-far', window + 24 * HOUR, now);
    await claimed('old-just', window + 60_000, now);
    await claimed('young-just', window - 60_000, now);
    await claimed('young', HOUR, now);
    await claimed('now', 0, now);

    const removed = await master().pruneLedger(planRetention(LEDGER_WINDOW_DAYS, new Date(now)));

    expect(removed).toBe(2);
    expect(await claims()).toEqual(['now', 'young', 'young-just']);
  });

  it('keeps an entry offered again inside the window a duplicate', async () => {
    const svc = master();
    await svc.receiveBatch(batch('e1'));
    // Taken 23 hours ago, and offered again now — the node never got the ack.
    await sql`UPDATE sync_ingested SET "ingestedAt" = now() - interval '23 hours'`.execute(db);

    await svc.pruneLedger();
    const again = await svc.receiveBatch(batch('e1'));

    expect(again.duplicateIds, 'a replay inside the window').toEqual(['e1']);
    const logs = await sql<{ n: string }>`SELECT count(*) AS n FROM logs`.execute(db);
    expect(Number(logs.rows[0]!.n), 'stored once').toBe(1);
  });

  it('takes it as new outside the window — the price the window states', async () => {
    // Pinned so the price stays a decision: at most the one batch that was
    // in flight when a node vanished for longer than the window.
    const svc = master();
    await svc.receiveBatch(batch('e2'));
    await sql`UPDATE sync_ingested SET "ingestedAt" = now() - interval '25 hours'`.execute(db);

    await svc.pruneLedger();
    const again = await svc.receiveBatch(batch('e2'));

    expect(again.acceptedIds).toEqual(['e2']);
  });

  it('stops a pass at its ceiling, and the next pass finishes', async () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) await claimed(`old-${i}`, 30 * HOUR, now);
    const plan = { cutoff: new Date(now - 24 * HOUR), batchSize: 3, maxThisPass: 6 };

    const svc = master();
    expect(await svc.pruneLedger(plan)).toBe(6);
    expect(await claims()).toHaveLength(4);
    expect(await svc.pruneLedger(plan)).toBe(4);
    expect(await claims()).toEqual([]);
  });

  it('says what it removed and the oldest claim it kept', async () => {
    const now = Date.now();
    await claimed('old', 30 * HOUR, now);
    await claimed('kept', 5 * HOUR, now);

    const svc = master();
    await svc.pruneLedger(planRetention(LEDGER_WINDOW_DAYS, new Date(now)));

    const said = infos.find((i) => i.msg === 'Pruned sync ledger claims past the dedup window');
    expect(said, 'a line whenever something went').toBeDefined();
    expect(said!.fields['removed']).toBe(1);
    expect(Date.parse(String(said!.fields['oldestKept']))).toBeCloseTo(now - 5 * HOUR, -4);
  });
});

describe('the pruner is armed on a master', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a minute after start, then hourly, and not after stop', async () => {
    vi.useFakeTimers();
    const svc = new SyncService({} as never, createNullLogger(), 'MacBook-Pro-9700', 'master', {});
    const prune = vi.spyOn(svc, 'pruneLedger').mockResolvedValue(0);

    svc.start();
    expect(prune).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(LEDGER_FIRST_PASS_DELAY_MS);
    expect(prune).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(LEDGER_INTERVAL_MS);
    expect(prune).toHaveBeenCalledTimes(2);

    await svc.stop();
    await vi.advanceTimersByTimeAsync(LEDGER_INTERVAL_MS * 3);
    expect(prune, 'a stopped service prunes nothing').toHaveBeenCalledTimes(2);
  });
});
