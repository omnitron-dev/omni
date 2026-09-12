/**
 * One message that can never succeed would have stopped the stream being
 * trimmed at all.
 *
 * A processing failure does not ACK — the message returns through XAUTOCLAIM
 * after the idle threshold. That is right for a TRANSIENT fault, which is what
 * these mostly are: measured on a real stand, 141 failures in five
 * instantaneous bursts, every one `Database connection with id default not
 * found` around a restart, and all recovered (1 pending afterwards).
 *
 * It is wrong forever. `trimDeliveredEvents` clamps its cutoff to the OLDEST
 * PENDING id, because trimming past something still owed would delete a
 * notification nobody has received. So a message that always fails stays
 * pending, the trim floor never advances, and the stream grows without bound —
 * the exact condition the janitor was added to stop (45,603 entries, 73 days,
 * 22.8 MB on a measured deployment).
 *
 * The two pieces are each correct and together they deadlock. The cap is what
 * breaks it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { NotificationWorkerService } from '../src/worker/notification-worker.js';

/** A worker with the collaborators it needs to reach `handleMessage`. */
function workerWith(opts: { maxDeliveries?: number } = {}) {
  const acked: string[] = [];
  const logged: Array<{ msg: string; deliveries?: number }> = [];
  const svc = Object.create(NotificationWorkerService.prototype) as Record<string, never>;

  let deliveries = 1;
  const redis = {
    xack: vi.fn(async (_k: string, _g: string, id: string) => {
      acked.push(id);
      return 1;
    }),
    xpending: vi.fn(async () => [['1-0', 'c', 10, deliveries]]),
  };

  // `logger` is a getter on the class — assignment silently fails, so it needs
  // defineProperty. The first version of this harness died on exactly that.
  const setLogger = (l: unknown) =>
    Object.defineProperty(svc, 'logger', { value: l, configurable: true });
  setLogger({
    error: (o: Record<string, unknown>, m: string) => logged.push({ msg: m, deliveries: o['deliveries'] as number }),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  });
  Object.assign(svc, {
    redis,
    streamKey: 'rotif:stream:notify',
    groupName: 'notification-worker',
    maxDeliveries: opts.maxDeliveries ?? 20,
    parseFields: () => ({ channel: 'notify', type: 'fraudAlert', payload: {} }),
    processEvent: vi.fn(async () => {
      throw new Error('Database connection with id default not found');
    }),
    ack: async (id: string) => {
      await redis.xack('k', 'g', id);
    },
  });

  return { svc, acked, logged, redis, setLogger, setDeliveries: (n: number) => (deliveries = n) };
}

describe('a message that keeps failing', () => {
  let w: ReturnType<typeof workerWith>;
  beforeEach(() => {
    w = workerWith({ maxDeliveries: 5 });
  });

  it('stays pending while it is still worth retrying', async () => {
    w.setDeliveries(3);
    await (w.svc as never as { handleMessage: (id: string, f: string[]) => Promise<void> }).handleMessage('1-0', []);

    expect(w.acked, 'a transient failure must not be dropped').toEqual([]);
    expect(w.logged.at(-1)?.msg).toMatch(/Failed to process/);
    expect(w.logged.at(-1)?.deliveries).toBe(3);
  });

  it('is given up on once it has had its attempts', async () => {
    w.setDeliveries(5);
    await (w.svc as never as { handleMessage: (id: string, f: string[]) => Promise<void> }).handleMessage('1-0', []);

    expect(w.acked, 'the poison message still holds the trim floor').toEqual(['1-0']);
    expect(w.logged.at(-1)?.msg).toMatch(/Giving up/);
  });

  it('says so loudly, and carries the event with it', async () => {
    // Dropping a notification is a real loss. The line has to be enough to
    // reconstruct what was lost.
    const seen: Array<Record<string, unknown>> = [];
    w.setLogger({ error: (o: Record<string, unknown>) => seen.push(o), warn: vi.fn(), info: vi.fn(), debug: vi.fn() });
    w.setDeliveries(99);

    await (w.svc as never as { handleMessage: (id: string, f: string[]) => Promise<void> }).handleMessage('1-0', []);

    expect(seen.at(-1)).toHaveProperty('event');
    expect(seen.at(-1)).toHaveProperty('messageId', '1-0');
    expect(seen.at(-1)).toHaveProperty('deliveries', 99);
  });

  it('keeps the message when the count cannot be read', async () => {
    // An unreadable count must not cause a drop — the fallback is 0, which
    // keeps it pending.
    w.redis.xpending.mockRejectedValueOnce(new Error('redis down'));
    await (w.svc as never as { handleMessage: (id: string, f: string[]) => Promise<void> }).handleMessage('1-0', []);

    expect(w.acked).toEqual([]);
  });
});
