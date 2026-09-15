/**
 * Three defects stacked on one guarantee, each hidden by the one before it.
 *
 * "Bounded buffer — oldest entries evicted when maxBufferSize reached" is
 * guarantee 5 in `sync.service.ts`. Getting it to be true took three fixes,
 * and each was only visible once the previous one landed on a real node:
 *
 *   1. the bound ran at the end of a SUCCESSFUL sync cycle — the one case
 *      where the buffer is draining and needs no bound;
 *   2. with that fixed, it could not bind its own cutoff: `Date` is not a
 *      thing better-sqlite3 accepts, and a slave's storage is SQLite;
 *   3. with THAT fixed, it could not measure: the size came from
 *      `pg_total_relation_size`, a Postgres function, asked about a table
 *      that exists only where the database is SQLite.
 *
 * Observed on the provisioned node, thirty seconds apart, on the build that
 * carried fix 2:
 *
 *     05:58:48  Sync buffer retention pass failed
 *       error: "no such function: pg_total_relation_size"
 *
 * Nothing in the suite caught any of the three, because every test of this
 * service ran against a hand-written stand-in for the database. A fake is
 * kinder than a driver: it accepts a `Date`, and it has every function you
 * name. These tests run the real service against the real engine the slave
 * actually has.
 */

import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';

import { SyncService } from '../../src/services/sync.service.js';
import { withDateBinding, toIsoUtc } from '../../src/database/sqlite-date-binding.js';

const warnings: string[] = [];
const logger: any = {
  info: () => {}, debug: () => {}, trace: () => {}, fatal: () => {}, error: () => {},
  warn: (o: unknown, m?: string) => warnings.push(typeof o === 'string' ? o : `${m} :: ${JSON.stringify(o)}`),
  child: () => logger,
};

/**
 * The slave's own DDL, in shape: TEXT columns, no date type.
 *
 * `legacy` is the default a node provisioned before today still has, and
 * still will: the table is created with CREATE TABLE IF NOT EXISTS, so
 * changing the default in source changes nothing for a slave that already
 * ran once. Every running node is the legacy case.
 */
const open = (variant: 'current' | 'legacy' = 'current') => {
  const database = new Database(':memory:');
  const createdAt =
    variant === 'legacy' ? "datetime('now')" : "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  database.exec(`
    CREATE TABLE sync_buffer (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      payload TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (${createdAt}),
      syncedAt TEXT
    )
  `);
  return new Kysely<any>({ dialect: new SqliteDialect({ database: withDateBinding(database) }) });
};

const services: SyncService[] = [];
const slave = (db: Kysely<any>, maxBufferSize: number) => {
  const svc = new SyncService(db as never, logger, 'edge-7', 'slave', { maxBufferSize } as never);
  services.push(svc);
  return svc;
};

const bounds = (svc: SyncService) =>
  (svc as unknown as { enforceBufferBounds(): Promise<void> }).enforceBufferBounds();

afterEach(async () => {
  warnings.length = 0;
  for (const s of services.splice(0)) await s.dispose?.().catch(() => {});
});

describe('the retention pass, against the engine a slave actually has', () => {
  it('completes without a failure warning', async () => {
    const db = open();
    const svc = slave(db, 500 * 1024 * 1024);
    await svc.bufferBatch([
      { category: 'logs', payload: { message: 'one' } },
      { category: 'logs', payload: { message: 'two' } },
    ] as never);

    await bounds(svc);

    // This is the assertion the previous two fixes would each have failed,
    // with a different message and the same consequence.
    expect(warnings.filter((w) => w.includes('retention pass failed'))).toEqual([]);
  });

  it('evicts down to budget when the buffer is over it', async () => {
    const db = open();
    // 4 KB of payload against a 1 KB budget: the plan targets 90% of budget,
    // so most of it has to go.
    const svc = slave(db, 1024);
    await svc.bufferBatch(
      Array.from({ length: 8 }, (_, i) => ({ category: 'logs', payload: { message: 'x'.repeat(500), i } })) as never,
    );
    const before = await db.selectFrom('sync_buffer').select('id').execute();
    expect(before.length).toBe(8);

    await bounds(svc);

    const after = await db.selectFrom('sync_buffer').select('id').execute();
    expect(after.length).toBeLessThan(before.length);
    // Undelivered data was dropped — that is correct here and must be said.
    expect(warnings.some((w) => w.includes('never received'))).toBe(true);
  });

  it('leaves a buffer inside its budget alone', async () => {
    const db = open();
    const svc = slave(db, 500 * 1024 * 1024);
    await svc.bufferBatch(
      Array.from({ length: 5 }, (_, i) => ({ category: 'logs', payload: { i } })) as never,
    );

    await bounds(svc);

    expect((await db.selectFrom('sync_buffer').select('id').execute()).length).toBe(5);
  });

  it('measures BYTES, not characters', async () => {
    const db = open();
    // `length()` counts characters, and these payloads are two bytes each.
    // A buffer of Cyrillic log lines would measure at half its real size and
    // pass a budget it is over.
    const svc = slave(db, 1024);
    await svc.bufferBatch(
      Array.from({ length: 4 }, () => ({ category: 'logs', payload: { message: 'я'.repeat(400) } })) as never,
    );

    const stats = await (svc as unknown as {
      bufferStats(): Promise<{ totalBytes: number; totalRows: number } | null>;
    }).bufferStats();

    expect(stats).not.toBeNull();
    // 4 rows × 400 two-byte characters = 3200 bytes of message alone.
    expect(stats!.totalBytes).toBeGreaterThan(3200);
    expect(stats!.totalRows).toBe(4);
  });
});

describe('a timestamp that leaves the machine', () => {
  it('carries its zone, off a column that does not', async () => {
    // Legacy on purpose: this column holds "2026-09-15 06:01:37" on every
    // node now running, and that is the value that has to be repaired on the
    // way out.
    const db = open('legacy');
    const svc = slave(db, 500 * 1024 * 1024);
    await svc.bufferBatch([{ category: 'logs', payload: { message: 'one' } }] as never);

    const batch = await (svc as unknown as {
      fetchPendingBatch(limit?: number): Promise<{ entries: Array<{ createdAt: string }> }>;
    }).fetchPendingBatch();

    // The master inserts this into a `timestamptz`. Postgres resolves a
    // timestamp with no offset in the session's TimeZone, so an offset-less
    // value is correct only while the master happens to run in UTC —
    // measured at three hours of drift on Europe/Moscow.
    expect(batch.entries[0]!.createdAt).toMatch(/Z$/);
    expect(Math.abs(Date.parse(batch.entries[0]!.createdAt) - Date.now())).toBeLessThan(60_000);
  });

  it('is written stating its zone by new nodes', async () => {
    const db = open('current');
    const svc = slave(db, 500 * 1024 * 1024);
    await svc.bufferBatch([{ category: 'logs', payload: { message: 'one' } }] as never);

    const row = await db.selectFrom('sync_buffer').select('createdAt').executeTakeFirstOrThrow();

    // Not only readable by us: self-describing in the column, so the next
    // reader of this table does not have to know which writer put it there.
    expect(String(row.createdAt)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('toIsoUtc', () => {
  it("reads SQLite's own datetime('now') shape as UTC", () => {
    // `new Date('2026-09-15 06:01:37')` reads this as LOCAL time, which is
    // the same error moved into this process instead of into Postgres.
    expect(toIsoUtc('2026-09-15 06:01:37')).toBe('2026-09-15T06:01:37.000Z');
    expect(toIsoUtc('2026-09-15T06:01:37')).toBe('2026-09-15T06:01:37.000Z');
    expect(toIsoUtc('2026-09-15 06:01:37.123')).toBe('2026-09-15T06:01:37.123Z');
  });

  it('keeps an instant that already states its offset', () => {
    expect(toIsoUtc('2026-09-15T09:01:37+03:00')).toBe('2026-09-15T06:01:37.000Z');
    expect(toIsoUtc('2026-09-15T06:01:37.000Z')).toBe('2026-09-15T06:01:37.000Z');
  });

  it('passes a Date and an epoch through', () => {
    expect(toIsoUtc(new Date('2026-09-15T06:01:37.000Z'))).toBe('2026-09-15T06:01:37.000Z');
    expect(toIsoUtc(Date.parse('2026-09-15T06:01:37.000Z'))).toBe('2026-09-15T06:01:37.000Z');
  });

  it('returns what it cannot read, rather than inventing a time', () => {
    // A wrong timestamp outlives an obviously broken one, because only the
    // second gets looked at.
    expect(toIsoUtc('not a time')).toBe('not a time');
    expect(toIsoUtc('')).toBe('');
  });
});
