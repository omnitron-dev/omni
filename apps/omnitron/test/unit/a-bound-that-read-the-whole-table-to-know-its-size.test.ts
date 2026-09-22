/**
 * A bound that read the whole table to know its size.
 *
 * `enforceBufferBounds` runs every thirty seconds on every node, and asked
 * for the buffer's size with a pass over all of it — `sum(octet_length(
 * payload))` across every row, the delivered ones included, which the buffer
 * keeps for a day. On the test node, 2026-09-22: 4 019 288 rows, 395–399 ms a
 * pass, on the daemon's event loop, because better-sqlite3 is synchronous.
 * Every RPC the node answered could queue behind it, twice a minute.
 *
 * The figures are now one row, `sync_buffer_stats`, kept by the buffer's own
 * triggers and recounted when storage opens. A kept figure is only worth
 * keeping if it cannot drift, so the first check here is the drift: a long
 * pseudo-random run of every statement shape that writes the buffer —
 * inserts, the ack's update, the routine delete of old delivered rows, and
 * the eviction's DELETE by subquery — compared after EVERY step with a full
 * recount. One disagreement and the figure is worse than the pass it
 * replaced, because the bound would then act on a number nobody measured.
 *
 * Against the slave's real storage: `SlaveStorageService` creates the table,
 * the triggers and the row; better-sqlite3 runs them.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';

import { SyncService } from '../../src/services/sync.service.js';
import { SlaveStorageService } from '../../src/services/slave-storage.service.js';
import { withDateBinding } from '../../src/database/sqlite-date-binding.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const undo of cleanup.splice(0)) await undo();
});

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-slave-stats-'));
  cleanup.push(async () => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'slave.db');
}

async function open(file: string): Promise<{ storage: SlaveStorageService; db: Kysely<any> }> {
  const storage = new SlaveStorageService(createNullLogger(), file);
  const db = (await storage.getDb()) as Kysely<any>;
  cleanup.unshift(async () => storage.dispose());
  return { storage, db };
}

const slave = (db: Kysely<any>, maxBufferSize: number) =>
  new SyncService(db as never, createNullLogger(), 'daos-cpp-9700', 'slave', { maxBufferSize } as never);

const bound = (svc: SyncService) =>
  (svc as unknown as { enforceBufferBounds(): Promise<void> }).enforceBufferBounds();

const statsOf = (svc: SyncService) =>
  (svc as unknown as {
    bufferStats(): Promise<{ totalBytes: number; totalRows: number; syncedRows: number } | null>;
  }).bufferStats();

async function kept(db: Kysely<any>) {
  const r = await sql<{ totalBytes: number; totalRows: number; syncedRows: number }>`
    SELECT totalBytes, totalRows, syncedRows FROM sync_buffer_stats WHERE id = 1
  `.execute(db);
  return r.rows[0];
}

async function recount(db: Kysely<any>) {
  const r = await sql<{ totalBytes: number; totalRows: number; syncedRows: number }>`
    SELECT coalesce(sum(octet_length(payload)), 0) AS totalBytes, count(*) AS totalRows, count(syncedAt) AS syncedRows
    FROM sync_buffer
  `.execute(db);
  return r.rows[0];
}

/** mulberry32: the same «random» run every time, so a red is reproducible. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('a bound that read the whole table to know its size', () => {
  it('keeps its figures exact through every statement that writes the buffer', async () => {
    const { db } = await open(tempDbPath());
    const rand = prng(20260922);
    // One service that only runs the routine delete, one whose budget forces
    // the eviction — both write the same table.
    const roomy = slave(db, 1024 * 1024 * 1024);
    const tight = slave(db, 6 * 1024);

    const steps: string[] = [];
    for (let step = 0; step < 120; step++) {
      const roll = rand();
      if (roll < 0.45) {
        const n = 1 + Math.floor(rand() * 40);
        await roomy.bufferBatch(
          Array.from({ length: n }, (_, i) => ({
            category: 'logs' as const,
            // Two-byte characters in some: bytes and characters must not be confused.
            payload: { message: (rand() < 0.3 ? 'я' : 'x').repeat(1 + Math.floor(rand() * 200)), i },
          })),
        );
        steps.push(`insert ${n}`);
      } else if (roll < 0.7) {
        const pending = await db.selectFrom('sync_buffer').select('id').where('syncedAt', 'is', null).execute();
        const ids = pending.filter(() => rand() < 0.5).map((r) => String(r.id));
        await roomy.ackDrained(ids);
        steps.push(`ack ${ids.length}`);
      } else if (roll < 0.85) {
        // Age some delivered rows past the day the routine delete keeps them.
        await sql`
          UPDATE sync_buffer SET syncedAt = '2026-01-01T00:00:00.000Z'
          WHERE id IN (SELECT id FROM sync_buffer WHERE syncedAt IS NOT NULL ORDER BY random() LIMIT 5)
        `.execute(db);
        await bound(roomy);
        steps.push('routine delete');
      } else {
        await bound(tight);
        steps.push('eviction');
      }

      expect(await kept(db), `after step ${step} (${steps.slice(-3).join(', ')})`).toEqual(await recount(db));
    }

    // The run exercised every shape, not just the cheap ones.
    for (const shape of ['insert', 'ack', 'routine delete', 'eviction']) {
      expect(steps.some((s) => s.startsWith(shape)), shape).toBe(true);
    }
    expect((await recount(db))!.totalRows, 'the eviction actually removed rows').toBeLessThan(
      steps.filter((s) => s.startsWith('insert')).reduce((sum, s) => sum + Number(s.split(' ')[1]), 0),
    );
  });

  it('answers from the kept row, not from a pass over the table', async () => {
    const { db } = await open(tempDbPath());
    const svc = slave(db, 1024 * 1024);
    await svc.bufferBatch([{ category: 'logs', payload: { message: 'one' } }] as never);

    // A figure no pass over the table could produce: if this comes back,
    // the row is what was read.
    await sql`UPDATE sync_buffer_stats SET totalBytes = 987654321 WHERE id = 1`.execute(db);

    expect((await statsOf(svc))!.totalBytes).toBe(987654321);
  });

  it('recounts when storage opens, whatever wrote the table before', async () => {
    const file = tempDbPath();
    {
      const { storage, db } = await open(file);
      await slave(db, 1024 * 1024).bufferBatch(
        Array.from({ length: 25 }, (_, i) => ({ category: 'logs', payload: { i } })) as never,
      );
      // A writer without the triggers — an older daemon, a restore, a hand.
      await sql`DROP TRIGGER sync_buffer_stats_insert`.execute(db);
      await sql`INSERT INTO sync_buffer (category, payload) VALUES ('logs', '{"late":true}')`.execute(db);
      expect((await kept(db))!.totalRows).toBe(25);
      await storage.dispose();
    }

    const { db } = await open(file);
    expect(await kept(db)).toEqual(await recount(db));
    expect((await kept(db))!.totalRows).toBe(26);
  });

  it('falls back to the pass on a database that keeps no figures', async () => {
    // A buffer this service did not create: the table, and nothing beside it.
    const raw = new Database(':memory:');
    raw.exec(`CREATE TABLE sync_buffer (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL,
      payload TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT (datetime('now')), syncedAt TEXT)`);
    const db = new Kysely<any>({ dialect: new SqliteDialect({ database: withDateBinding(raw) }) });
    cleanup.push(async () => db.destroy());
    const svc = slave(db, 1024 * 1024);
    await svc.bufferBatch([{ category: 'logs', payload: { message: 'я'.repeat(10) } }] as never);

    const stats = await statsOf(svc);
    expect(stats!.totalRows).toBe(1);
    expect(stats!.totalBytes).toBeGreaterThan(20);
  });
});
