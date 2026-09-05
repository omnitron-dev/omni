/**
 * The push path, end to end over a stub database.
 *
 * `sync-policy.test.ts` pins the decisions; this pins that the service acts
 * on them. The defect was precisely a correct-looking decision never
 * consulted: `pushBatch` discarded the master's response and `markSynced`
 * marked the whole batch, so a partially-ingested batch left the rejected
 * entries flagged delivered on the slave and absent on the master.
 *
 * The stub records which ids reach `markSynced`. That is the only
 * observation that distinguishes the fix from the bug — both log a
 * successful sync cycle.
 */

import { describe, it, expect, vi } from 'vitest';

import { SyncService } from '../../src/services/sync.service.js';

const silentLogger: any = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
};

/**
 * Minimal Kysely stand-in: serves one page of pending rows, then nothing,
 * and records the ids passed to the `sync_buffer` update.
 */
function stubDb(pending: Array<{ id: string }>) {
  const markedSynced: string[] = [];
  let served = false;

  const db: any = {
    selectFrom: () => ({
      selectAll: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => ({
              execute: async () => {
                if (served) return [];
                served = true;
                return pending.map((r) => ({
                  id: r.id,
                  category: 'metrics',
                  payload: { name: 'cpu', value: 1 },
                  createdAt: new Date('2026-09-05T00:00:00Z'),
                  syncedAt: null,
                }));
              },
            }),
          }),
        }),
      }),
      select: () => ({
        orderBy: () => ({
          orderBy: () => ({ limit: () => ({ execute: async () => [] }) }),
        }),
      }),
    }),
    updateTable: () => ({
      set: () => ({
        where: (_col: string, _op: string, ids: string[]) => ({
          execute: async () => {
            markedSynced.push(...ids);
          },
        }),
      }),
    }),
    deleteFrom: () => ({
      where: () => ({ where: () => ({ execute: async () => {} }), execute: async () => {} }),
    }),
  };

  return { db, markedSynced };
}

/** Run one sync cycle against a master that answers with `response`. */
async function runCycle(pending: string[], response: unknown) {
  const { db, markedSynced } = stubDb(pending.map((id) => ({ id })));
  const service = new SyncService(db, silentLogger, 'node-1', 'slave', { interval: 60_000 });
  const invoke = vi.fn(async () => response);
  service.setMasterConnection(invoke as never);

  // `syncCycle` is the private the timer calls; exercising it directly is
  // the point — the timer adds nothing but delay.
  await (service as unknown as { syncCycle(): Promise<void> }).syncCycle();

  return { markedSynced, invoke };
}

describe('sync cycle — what gets marked delivered', () => {
  it('releases only the entries the master kept', async () => {
    const { markedSynced } = await runCycle(['a', 'b', 'c', 'd'], {
      accepted: 2,
      duplicates: 0,
      acceptedIds: ['a', 'b'],
      duplicateIds: [],
      failedIds: ['c', 'd'],
    });

    expect(markedSynced).toEqual(['a', 'b']);
  });

  it('counts a duplicate as delivered', async () => {
    const { markedSynced } = await runCycle(['a', 'b'], {
      accepted: 1,
      duplicates: 1,
      acceptedIds: ['a'],
      duplicateIds: ['b'],
      failedIds: [],
    });

    expect(markedSynced.sort()).toEqual(['a', 'b']);
  });

  it('releases nothing when the master rejected everything', async () => {
    const { markedSynced } = await runCycle(['a', 'b'], {
      accepted: 0,
      duplicates: 0,
      acceptedIds: [],
      duplicateIds: [],
      failedIds: ['a', 'b'],
    });

    expect(markedSynced).toEqual([]);
  });

  it('treats a master that cannot report ids as having taken the batch', async () => {
    // An older master answers `{accepted: n}` and nothing else. Reading that
    // as "all failed" would retry every batch forever against a peer that
    // has the data and cannot say so.
    const { markedSynced } = await runCycle(['a', 'b'], { accepted: 2 });
    expect(markedSynced.sort()).toEqual(['a', 'b']);
  });

  it('releases nothing when the push itself throws', async () => {
    const { db, markedSynced } = stubDb([{ id: 'a' }]);
    const service = new SyncService(db, silentLogger, 'node-1', 'slave', { interval: 60_000 });
    service.setMasterConnection((async () => {
      throw new Error('connection reset');
    }) as never);

    await (service as unknown as { syncCycle(): Promise<void> }).syncCycle();

    expect(markedSynced).toEqual([]);
  });

  it('does not push at all without a master connection', async () => {
    const { db, markedSynced } = stubDb([{ id: 'a' }]);
    const service = new SyncService(db, silentLogger, 'node-1', 'slave', { interval: 60_000 });

    await (service as unknown as { syncCycle(): Promise<void> }).syncCycle();

    expect(markedSynced).toEqual([]);
  });
});

describe('drainBuffer — the pull path', () => {
  it('hands entries over without releasing them', async () => {
    // It used to mark them synced before returning, and called that
    // idempotent. A response lost in transit then lost the data on both
    // sides, and the caller logged it at debug level.
    const { db, markedSynced } = stubDb([{ id: 'a' }, { id: 'b' }]);
    const service = new SyncService(db, silentLogger, 'node-1', 'slave', { interval: 60_000 });

    const batch = await service.drainBuffer(10);

    expect(batch.entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(markedSynced, 'nothing may be released before the master acknowledges').toEqual([]);
  });

  it('releases exactly what the master acknowledges', async () => {
    const { db, markedSynced } = stubDb([{ id: 'a' }, { id: 'b' }]);
    const service = new SyncService(db, silentLogger, 'node-1', 'slave', { interval: 60_000 });

    await service.drainBuffer(10);
    const result = await service.ackDrained(['a']);

    expect(result).toEqual({ released: 1 });
    expect(markedSynced).toEqual(['a']);
  });

  it('accepts an empty acknowledgement without touching the buffer', async () => {
    const { db, markedSynced } = stubDb([]);
    const service = new SyncService(db, silentLogger, 'node-1', 'slave', { interval: 60_000 });

    expect(await service.ackDrained([])).toEqual({ released: 0 });
    expect(markedSynced).toEqual([]);
  });
});
