/**
 * The sync buffer's bound ran only on a cycle that had already drained it.
 *
 * `SyncService` guarantees, in its own header: "Bounded buffer — oldest
 * entries evicted when maxBufferSize reached". The eviction is written, it
 * measures real bytes, it drops delivered rows before undelivered ones and
 * says so at warning level when it has to drop something the master never
 * received.
 *
 * It was the last statement inside `syncCycle`'s `try`. So it ran when a full
 * cycle succeeded — which is when the buffer is being emptied anyway — and on
 * no other path. All three ways a buffer actually grows skipped it:
 *
 *   - a slave with no master connection returns at `if (!this.masterInvoke)`,
 *     two lines in;
 *   - a push to an unreachable master throws, and control leaves via `catch`;
 *   - and the backoff that follows, saturating at five minutes, returns at
 *     `if (Date.now() < this.backoff.nextRetryAt)` for most ticks after that.
 *
 * A guarantee that holds only while it is not needed is the shape of failure
 * that never appears in a replication log: what fills is the disk, and what
 * breaks is everything else sharing it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SyncService } from '../../src/services/sync.service.js';

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silentLogger,
};

/** A slave whose buffer bound is observable and whose push can be made to fail. */
function slave(opts: { master?: boolean; pushFails?: boolean } = {}) {
  const svc = new SyncService({} as never, silentLogger, 'edge-1', 'slave', undefined as never);
  const bounds = vi.fn(async () => undefined);
  (svc as any).enforceBufferBounds = bounds;

  if (opts.master) {
    (svc as any).masterInvoke = async () => ({ accepted: [] });
    (svc as any).fetchPendingBatch = async () => {
      if (opts.pushFails) throw new Error('master is unreachable');
      return { nodeId: 'edge-1', batchId: 'b', entries: [], checksum: 'x' };
    };
  }

  return { svc, bounds, tick: () => (svc as any).syncTick() as Promise<void> };
}

beforeEach(() => vi.clearAllMocks());

describe('the buffer bound runs when the buffer is growing', () => {
  it('runs with no master connection at all', async () => {
    // The case the bound exists for: nothing to push to, so nothing drains,
    // so the WAL only grows. `syncCycle` returns before its `try` here.
    const { bounds, tick } = slave({ master: false });

    await tick();

    expect(bounds).toHaveBeenCalledTimes(1);
  });

  it('runs when the push to the master throws', async () => {
    const { bounds, tick } = slave({ master: true, pushFails: true });

    await tick();

    expect(bounds).toHaveBeenCalledTimes(1);
  });

  it('keeps running on every tick while the backoff is waiting', async () => {
    // After a failure the cycle returns at the backoff guard, which saturates
    // at five minutes — so this is where a disconnected slave spends almost
    // all of its time, and where the bound was reached least often of all.
    const { svc, bounds, tick } = slave({ master: true, pushFails: true });

    await tick();
    expect((svc as any).backoff.nextRetryAt).toBeGreaterThan(Date.now());

    await tick();
    await tick();

    expect(bounds).toHaveBeenCalledTimes(3);
  });

  it('runs before the drain rather than after it', async () => {
    // Order matters on a slave that reconnects with a full buffer: bounding
    // first drops what is already past budget, so the push that follows is
    // not spending its batches shipping rows that are about to be evicted.
    const order: string[] = [];
    const { svc, tick } = slave({ master: true });
    (svc as any).enforceBufferBounds = async () => { order.push('bound'); };
    (svc as any).syncCycle = async () => { order.push('cycle'); };

    await tick();

    expect(order).toEqual(['bound', 'cycle']);
  });

  it('does nothing once the service is disposed', async () => {
    const { svc, bounds, tick } = slave({ master: false });
    (svc as any).disposed = true;

    await tick();

    expect(bounds).not.toHaveBeenCalled();
  });

  it('bounds exactly once on a cycle that succeeds', async () => {
    // The bound was left in the success path as well as hoisted, so it ran
    // twice per drained cycle — two full `pg_total_relation_size` scans where
    // one was asked for.
    const { bounds, tick } = slave({ master: true });

    await tick();

    expect(bounds).toHaveBeenCalledTimes(1);
  });
});
