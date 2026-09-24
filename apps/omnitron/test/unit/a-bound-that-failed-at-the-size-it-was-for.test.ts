/**
 * A bound that failed at the size it was for.
 *
 * Guarantee 5 — the buffer is bounded, oldest entries evicted — took three
 * fixes to become true (see `a-bound-that-could-not-measure.test.ts`). The
 * fourth defect was in the eviction itself. It read the ids to drop into
 * memory and deleted them with `WHERE id IN (…)`: one bound parameter per
 * row. SQLite takes at most 32 766 (better-sqlite3 13.0.3 / SQLite 3.53.4,
 * measured: 32 767 answers «too many SQL variables»). So the pass worked for
 * a small overflow and refused exactly the large one — and a large overflow
 * is the only kind a buffer produces when its master has stopped pulling,
 * which is the one situation the bound exists for.
 *
 * Measured on the test node 37.27.130.185, 2026-09-22: 558 passes in a row,
 * one every 30 s from 13:03 to 17:42 UTC,
 *
 *     WARN  Sync buffer retention pass failed   error: "too many SQL variables"
 *
 * against a buffer of 4 019 288 rows and 555 395 528 payload bytes with a
 * budget of 524 288 000 — an overflow of about 600 000 rows. The bound bounded
 * nothing. What kept the table from growing without limit was the routine
 * delete of rows delivered more than 24 hours ago, and that stops helping the
 * moment the master stops pulling.
 *
 * The same query also said «oldest first, delivered before undelivered» and
 * ordered `syncedAt DESC, createdAt ASC`: newest-DELIVERED first on SQLite,
 * and on Postgres — where DESC puts NULLs first — undelivered first.
 *
 * Run against the slave's real storage: `SlaveStorageService` creates the
 * table the node has, and better-sqlite3 is the engine that refused.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';

import { SyncService } from '../../src/services/sync.service.js';
import { SlaveStorageService } from '../../src/services/slave-storage.service.js';

const warnings: string[] = [];
const infos: string[] = [];
const logger: any = {
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  error: () => {},
  info: (o: unknown, m?: string) => infos.push(`${m} :: ${JSON.stringify(o)}`),
  warn: (o: unknown, m?: string) => warnings.push(`${m} :: ${JSON.stringify(o)}`),
  child: () => logger,
};

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  warnings.length = 0;
  infos.length = 0;
  for (const undo of cleanup.splice(0)) await undo();
});

/** A slave's storage, as the daemon opens it, in a file of its own. */
async function slaveStorage(): Promise<Kysely<any>> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-slave-'));
  const storage = new SlaveStorageService(createNullLogger(), path.join(dir, 'slave.db'));
  cleanup.push(async () => {
    await storage.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return (await storage.getDb()) as Kysely<any>;
}

interface Row {
  payload: string;
  createdAt: string;
  syncedAt: string | null;
}

/** Rows in the shapes the node writes them, in statements SQLite accepts. */
async function insert(db: Kysely<any>, rows: Row[]): Promise<void> {
  await db.transaction().execute(async (trx) => {
    for (let i = 0; i < rows.length; i += 5_000) {
      await trx
        .insertInto('sync_buffer')
        .values(rows.slice(i, i + 5_000).map((r) => ({ category: 'logs', ...r })))
        .execute();
    }
  });
}

/**
 * Seconds from a base thirteen hours ago — recent, whatever day the court runs.
 *
 * This was `Date.UTC(2026, 8, 22, 12, 0, 0)`, and the routine retention pass
 * that runs BEFORE the eviction deletes delivered entries older than a day
 * (`SYNCED_RETENTION_MS`). From 2026-09-23 23:06:40 UTC every delivered
 * fixture here was older than that, the routine pass removed all 40 000 of
 * them before the eviction this court exists for was reached, and it failed
 * with «expected 0 to be greater than 0» — a court pinned to a date is a
 * court that expires. The ordering court below passed through the same hole
 * for the wrong reason. Thirteen hours back and 40 000 seconds forward stays
 * inside the day, so the routine pass takes nothing and the eviction is what
 * is measured.
 */
const BASE = Date.now() - 13 * 60 * 60 * 1000;
const at = (second: number) => new Date(BASE + second * 1000).toISOString();

function slave(db: Kysely<any>, maxBufferSize: number) {
  return new SyncService(db as never, logger, 'daos-cpp-9700', 'slave', { maxBufferSize } as never);
}

const bound = (svc: SyncService) =>
  (svc as unknown as { enforceBufferBounds(): Promise<void> }).enforceBufferBounds();

async function remaining(db: Kysely<any>) {
  const row = await sql<{ rows: number; bytes: number }>`
    SELECT count(*) AS rows, coalesce(sum(octet_length(payload)), 0) AS bytes FROM sync_buffer
  `.execute(db);
  return { rows: Number(row.rows[0]!.rows), bytes: Number(row.rows[0]!.bytes) };
}

describe('a bound that failed at the size it was for', () => {
  it('gets back under budget when the overflow is more rows than one statement can name', async () => {
    const db = await slaveStorage();
    // 40 000 delivered rows of ~16 bytes against a 4 KB budget: the plan
    // targets 90% of it, so ~39 800 rows have to go — past 32 766.
    await insert(
      db,
      Array.from({ length: 40_000 }, (_, i) => ({
        payload: JSON.stringify({ n: 100_000 + i }),
        createdAt: at(i),
        syncedAt: at(i + 1),
      })),
    );
    const budget = 4 * 1024;

    await bound(slave(db, budget));

    expect(warnings.filter((w) => w.includes('retention pass failed')), 'the pass itself').toEqual([]);
    const after = await remaining(db);
    expect(after.bytes, 'payload bytes left against the budget').toBeLessThanOrEqual(budget);
    expect(after.rows).toBeGreaterThan(0);
  });

  it('drops what the master already has before what it has not, oldest first', async () => {
    const db = await slaveStorage();
    // Twenty entries the master has — the older half created first and
    // delivered first, as a working pipeline does — then twenty it has not.
    const delivered = Array.from({ length: 20 }, (_, i) => ({
      payload: JSON.stringify({ kind: 'delivered', n: i, pad: 'x'.repeat(40) }),
      createdAt: at(i),
      syncedAt: at(100 + i),
    }));
    const undelivered = Array.from({ length: 20 }, (_, i) => ({
      payload: JSON.stringify({ kind: 'pending', n: i, pad: 'x'.repeat(40) }),
      createdAt: at(200 + i),
      syncedAt: null,
    }));
    await insert(db, [...delivered, ...undelivered]);
    const before = await remaining(db);
    // Room for about three quarters of it: some rows must go, fewer than the
    // delivered half.
    const budget = Math.floor((before.bytes * 0.75) / 0.9);

    await bound(slave(db, budget));

    const left = await db.selectFrom('sync_buffer').select(['payload', 'syncedAt']).orderBy('id').execute();
    const kept = left.map((r) => JSON.parse(String(r.payload)) as { kind: string; n: number });

    expect(kept.filter((k) => k.kind === 'pending'), 'undelivered data, while delivered data remains').toHaveLength(20);
    const deliveredKept = kept.filter((k) => k.kind === 'delivered').map((k) => k.n);
    expect(deliveredKept.length).toBeLessThan(20);
    // Oldest first: what survives of the delivered half is its NEWEST end.
    expect(deliveredKept).toEqual(Array.from({ length: deliveredKept.length }, (_, i) => 20 - deliveredKept.length + i));
    // Nothing the master lacked was dropped, so this is not a warning.
    expect(warnings.filter((w) => w.includes('never received'))).toEqual([]);
  });

  it('drops undelivered entries oldest first when nothing else is left, and says so', async () => {
    const db = await slaveStorage();
    await insert(
      db,
      Array.from({ length: 30 }, (_, i) => ({
        payload: JSON.stringify({ n: i, pad: 'y'.repeat(40) }),
        createdAt: at(i),
        syncedAt: null,
      })),
    );
    const before = await remaining(db);
    const budget = Math.floor((before.bytes * 0.5) / 0.9);

    await bound(slave(db, budget));

    const kept = (await db.selectFrom('sync_buffer').select('payload').orderBy('id').execute()).map(
      (r) => (JSON.parse(String(r.payload)) as { n: number }).n,
    );
    expect(kept.length).toBeLessThan(30);
    expect(kept, 'the newest data is what a master that comes back still gets').toEqual(
      Array.from({ length: kept.length }, (_, i) => 30 - kept.length + i),
    );
    const said = warnings.filter((w) => w.includes('never received'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(`"dropped":${30 - kept.length}`);
  });
});
