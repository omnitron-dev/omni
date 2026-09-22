/**
 * The backoff never engaged, because a refusal is not a throw.
 *
 *     } // end of the batch loop
 *     if (totalSynced > 0) logger.info(…, 'Sync cycle completed');
 *     // Reset backoff on success
 *     this.backoff = { attempt: 0, nextRetryAt: 0 };
 *
 * "Success" here means only that nothing threw. When the master is
 * unreachable the push throws, the `catch` runs, and the delay grows to five
 * minutes — that path works. But when the master ANSWERS and its answer is
 * "no" for every entry, nothing throws: `receiveBatch` returns an outcome
 * with `failed` full and `accepted` empty. The cycle then reaches the reset,
 * clears the backoff it never set, and the next tick offers the same entries
 * again.
 *
 * That is what happened on 2026-09-21 while OrbStack was down and the
 * master's own Postgres never came up. The RPC was fine; the ingest
 * transaction behind every entry was not. Measured in the daemon log:
 * entry ids 5574285–5575284 — exactly 1000 distinct entries — offered 94
 * times in 37 minutes, about one attempt every 24 seconds, 76 659 refusals
 * in total. The configured backoff (initial 5 s, factor 2, max 300 s) would
 * have turned those 94 attempts into roughly a dozen. It was never consulted.
 *
 * `sweepMadeProgress` already stops the loop INSIDE one cycle, so this is not
 * about the sweep looping: each of the 94 attempts was a separate, orderly
 * cycle that ended by declaring itself successful.
 *
 * A cycle that delivered nothing and was refused everything is a failed
 * cycle. It says so now, and waits.
 */

import { describe, it, expect, vi } from 'vitest';

import { SyncService } from '../../src/services/sync.service.js';

const silent: any = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
};
silent.child = () => silent;

const ENTRIES = Array.from({ length: 3 }, (_, i) => ({
  id: String(5574285 + i),
  category: 'metrics' as const,
  payload: {},
  createdAt: '2026-09-21T15:00:00Z',
}));

/**
 * A slave whose master answers. `pushBatch` is what the master said; the
 * database and the mark-as-synced write are stubbed, since what is under
 * test is how the CYCLE judges the answer.
 */
function slave(answer: () => Promise<unknown> | unknown) {
  const svc: any = new SyncService({} as never, silent, 'edge-1', 'slave', undefined as never);
  svc.masterInvoke = async () => ({});
  let served = false;
  svc.fetchPendingBatch = async () => {
    if (served) return { nodeId: 'edge-1', batchId: 'b', checksum: 's', entries: [] };
    served = true;
    return { nodeId: 'edge-1', batchId: 'b', checksum: 's', entries: ENTRIES };
  };
  svc.pushBatch = async () => answer();
  svc.markSynced = async () => undefined;
  svc.enforceBufferBounds = async () => undefined;
  return svc;
}

const refusedEverything = () => ({
  accepted: [],
  duplicates: [],
  discarded: [],
  failed: ENTRIES.map((e) => e.id),
});

describe('a cycle that delivered nothing and called it success', () => {
  it('waits before offering the same entries again', async () => {
    const svc = slave(refusedEverything);

    await svc.syncCycle();

    expect(svc.backoff.attempt, 'the refusal was not counted as a failure').toBeGreaterThan(0);
    expect(svc.backoff.nextRetryAt, 'so the next tick would offer them straight away').toBeGreaterThan(
      Date.now(),
    );
  });

  it('and says what the master answered', async () => {
    const svc = slave(refusedEverything);
    silent.warn.mockClear();

    await svc.syncCycle();

    const said = silent.warn.mock.calls.map(([, msg]: [unknown, string]) => String(msg)).join(' ');
    expect(said).toMatch(/retry|refus/i);
  });

  it('a cycle that delivered something is still a success', async () => {
    // Control: the ordinary case must not start backing off. Anything
    // delivered means the master is taking data.
    const svc = slave(() => ({
      accepted: [ENTRIES[0]!.id],
      duplicates: [],
      discarded: [],
      failed: [ENTRIES[1]!.id, ENTRIES[2]!.id],
    }));
    // A backoff already accumulated, but due: `syncCycle` returns at its
    // third line while `nextRetryAt` is still ahead, so a future value here
    // would test nothing.
    svc.backoff = { attempt: 4, nextRetryAt: Date.now() - 1_000 };

    await svc.syncCycle();

    expect(svc.backoff.attempt, 'progress clears the backoff').toBe(0);
    expect(svc.backoff.nextRetryAt).toBe(0);
  });

  it('an unreachable master still backs off, as it always did', async () => {
    // Control: the path that already worked keeps working.
    const svc = slave(() => {
      throw new Error('connect ECONNREFUSED 10.0.0.9:9700');
    });

    await svc.syncCycle();

    expect(svc.backoff.attempt).toBe(1);
    expect(svc.backoff.nextRetryAt).toBeGreaterThan(Date.now());
  });
});
