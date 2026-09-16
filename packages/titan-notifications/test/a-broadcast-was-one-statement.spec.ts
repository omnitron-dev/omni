/**
 * A broadcast built one array, one insert and one signal, all the size of the
 * platform.
 *
 * `processEvent` resolved every target user, mapped the whole set to
 * notification records, handed them to `persistBatch` in one call and
 * signalled them in one more. For a targeted notification that is right —
 * the audience is one user, or a handful the caller named. A BROADCAST wears
 * the same signature and means every active account.
 *
 * Postgres binds a parameter per value, so a bulk insert of a record with
 * around twenty columns runs out at roughly three thousand rows of the
 * 65 535 the wire protocol allows. Past that the fan-out does not slow down,
 * it fails — and the failure arrives as one rejected statement for the whole
 * audience rather than as a partial delivery.
 *
 * Two things are pinned here: the worker cuts whatever it is given into
 * batches, and it PREFERS a resolver that can page its own user table, so
 * the id array is bounded as well as the writes.
 */
import { describe, it, expect } from 'vitest';

import { NotificationWorkerService } from '../src/worker/notification-worker.js';
import type { NotificationEvent } from '../src/publisher.js';

const EVENT = {
  channel: 'notify.test',
  type: 'system_alert',
  category: 'system',
  title: 't',
  body: 'b',
  broadcast: true,
} as unknown as NotificationEvent;

interface Harness {
  run(event?: NotificationEvent): Promise<void>;
  persisted: number[];
  /** `[method, count]` per call — `signal` for one, `signalBatch` for many. */
  signalled: Array<[string, number]>;
  batchSizesAsked: number[];
}

function makeWorker(resolver: Record<string, unknown>): Harness {
  const persisted: number[] = [];
  const signalled: Array<[string, number]> = [];
  const batchSizesAsked: number[] = [];

  const persister = {
    persistBatch: async (records: unknown[]) => {
      persisted.push(records.length);
      return records.map((_, i) => ({ id: `n${i}`, userId: 'u' }));
    },
  };
  const signaler = {
    signal: async () => {
      signalled.push(['signal', 1]);
    },
    signalBatch: async (ids: string[]) => {
      signalled.push(['signalBatch', ids.length]);
    },
  };
  const logger = { debug() {}, info() {}, warn() {}, error() {} };

  const wrapped = {
    ...resolver,
    ...(resolver['resolveUserBatches']
      ? {
          resolveUserBatches: (event: NotificationEvent, size: number) => {
            batchSizesAsked.push(size);
            return (resolver['resolveUserBatches'] as (e: NotificationEvent, n: number) => AsyncIterable<string[]>)(
              event,
              size,
            );
          },
        }
      : {}),
  };

  const worker = new NotificationWorkerService(
    wrapped as never,
    persister as never,
    signaler as never,
    { logger } as never,
  );

  return {
    run: (event = EVENT) =>
      (worker as unknown as { processEvent(e: NotificationEvent): Promise<void> }).processEvent(event),
    persisted,
    signalled,
    batchSizesAsked,
  };
}

const ids = (n: number, prefix = 'u'): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(6, '0')}`);

describe('an array resolver is cut up rather than sent whole', () => {
  it('splits 1 200 recipients into bounded statements', async () => {
    const h = makeWorker({ resolveUsers: async () => ids(1_200) });

    await h.run();

    expect(h.persisted.length).toBeGreaterThan(1);
    expect(Math.max(...h.persisted)).toBeLessThanOrEqual(500);
    expect(h.persisted.reduce((a, b) => a + b, 0)).toBe(1_200);
    // Every recipient is signalled too, in the same pieces.
    expect(h.signalled.reduce((a, [, n]) => a + n, 0)).toBe(1_200);
  });

  it('leaves a small audience as one statement', async () => {
    const h = makeWorker({ resolveUsers: async () => ids(3) });

    await h.run();

    expect(h.persisted).toEqual([3]);
  });

  it('signals a single recipient through `signal`, not `signalBatch`', async () => {
    const h = makeWorker({ resolveUsers: async () => ids(1) });

    await h.run();

    expect(h.persisted).toEqual([1]);
    // Which method, not just how many ids — `signalBatch([one])` carries the
    // same count and is a different call.
    expect(h.signalled).toEqual([['signal', 1]]);
  });

  it('does nothing at all for an empty audience', async () => {
    const h = makeWorker({ resolveUsers: async () => [] });

    await h.run();

    expect(h.persisted).toEqual([]);
    expect(h.signalled).toEqual([]);
  });
});

describe('a paging resolver is preferred, so the id array is bounded too', () => {
  it('walks the resolver instead of asking for everything', async () => {
    let asked = 0;
    const h = makeWorker({
      resolveUsers: async () => {
        throw new Error('resolveUsers must not be called when the resolver can page');
      },
      async *resolveUserBatches(_e: NotificationEvent, size: number) {
        for (let page = 0; page < 3; page += 1) {
          asked += 1;
          yield ids(size, `p${page}-`);
        }
      },
    });

    await h.run();

    expect(asked).toBe(3);
    expect(h.batchSizesAsked).toEqual([500]);
    expect(h.persisted).toEqual([500, 500, 500]);
  });

  it('re-cuts a resolver that yields more than it was asked for', async () => {
    // The batch size is a request, not a guarantee. A resolver that answers
    // with more must not put more into one statement.
    const h = makeWorker({
      resolveUsers: async () => [],
      async *resolveUserBatches() {
        yield ids(1_100);
      },
    });

    await h.run();

    expect(Math.max(...h.persisted)).toBeLessThanOrEqual(500);
    expect(h.persisted.reduce((a, b) => a + b, 0)).toBe(1_100);
  });

  it('skips an empty page without ending the walk', async () => {
    const h = makeWorker({
      resolveUsers: async () => [],
      async *resolveUserBatches() {
        yield ids(2, 'a');
        yield [];
        yield ids(3, 'b');
      },
    });

    await h.run();

    expect(h.persisted).toEqual([2, 3]);
  });
});
