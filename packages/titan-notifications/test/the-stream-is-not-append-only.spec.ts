/**
 * The notification stream was append-only, and its consumer list too.
 *
 * Measured on a running deployment, 2026-09-12:
 *
 *   XLEN  rotif:stream:notify              45,603
 *   XINFO GROUPS ... lag                   0        (every entry consumed)
 *   MEMORY USAGE                           22.8 MB
 *   oldest entry                           73 days old
 *   XINFO GROUPS ... consumers             429
 *   XINFO CONSUMERS ... idle (sampled)     1.6 days
 *
 * Nothing trimmed the stream — no `MAXLEN`, no `XTRIM`, anywhere in
 * titan-notifications or rotif — and nothing removed a consumer. The consumer
 * name is `worker-<pid>-<timestamp>`, so every restart registers a new one
 * forever.
 *
 * Neither loses data, which is why neither was noticed: delivery works, the
 * PEL drains, and the cost is Redis memory that only goes up.
 *
 * The two rules that make trimming safe are what these tests pin: never trim
 * past anything still pending, and never deregister a consumer that holds
 * pending messages.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { NotificationWorkerService } from '../src/worker/notification-worker.js';

type Call = { cmd: string; args: unknown[] };

function makeWorker(opts: {
  pending?: [number, string | null, string | null, unknown] | null;
  consumers?: unknown[][];
  options?: Record<string, unknown>;
}) {
  const calls: Call[] = [];
  const redis = {
    xpending: async (...args: unknown[]) => {
      calls.push({ cmd: 'xpending', args });
      return opts.pending ?? [0, null, null, null];
    },
    xtrim: async (...args: unknown[]) => {
      calls.push({ cmd: 'xtrim', args });
      return 0;
    },
    xinfo: async (...args: unknown[]) => {
      calls.push({ cmd: 'xinfo', args });
      return opts.consumers ?? [];
    },
    xgroup: async (...args: unknown[]) => {
      calls.push({ cmd: 'xgroup', args });
      return 1;
    },
  };
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  const worker = new NotificationWorkerService(
    {} as never,
    {} as never,
    {} as never,
    { logger } as never,
  );
  // The fields `start()` would set. Assigned directly so the test drives the
  // janitor without a Redis server or a consume loop.
  Object.assign(worker as unknown as Record<string, unknown>, {
    redis,
    streamKey: 'rotif:stream:notify',
    groupName: 'notification-worker',
    consumerName: 'worker-self',
    retentionMs: 24 * 60 * 60 * 1000,
    consumerIdleMs: 60 * 60 * 1000,
    ...(opts.options ?? {}),
  });
  return { worker: worker as unknown as { runJanitor(): Promise<void> }, calls };
}

const consumer = (name: string, pending: number, idle: number): unknown[] => [
  'name', name, 'pending', pending, 'idle', idle, 'inactive', idle,
];

describe('trimming the stream', () => {
  it('trims by age with MINID', async () => {
    const { worker, calls } = makeWorker({});
    await worker.runJanitor();

    const trim = calls.find((c) => c.cmd === 'xtrim');
    expect(trim, 'nothing trimmed the stream').toBeDefined();
    expect(trim!.args[1]).toBe('MINID');
    const cutoff = Number(String(trim!.args[3]).split('-')[0]);
    // Roughly 24h ago, not "now" and not zero.
    expect(Date.now() - cutoff).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(Date.now() - cutoff).toBeLessThan(25 * 60 * 60 * 1000);
  });

  it('never trims past a message still pending', async () => {
    // A failed message sits in the PEL waiting for XAUTOCLAIM. It is older
    // than the retention window, and deleting it would drop a notification
    // that is still owed to someone.
    const ancient = Date.now() - 40 * 24 * 60 * 60 * 1000;
    const { worker, calls } = makeWorker({ pending: [1, `${ancient}-0`, `${ancient}-5`, null] });

    await worker.runJanitor();

    const trim = calls.find((c) => c.cmd === 'xtrim')!;
    expect(Number(String(trim.args[3]).split('-')[0])).toBe(ancient);
  });

  it('does not trim at all when retention is disabled', async () => {
    const { worker, calls } = makeWorker({ options: { retentionMs: 0 } });
    await worker.runJanitor();
    expect(calls.some((c) => c.cmd === 'xtrim')).toBe(false);
  });
});

describe('removing idle consumers', () => {
  const hour = 60 * 60 * 1000;

  it('removes one that is idle and holds nothing', async () => {
    const { worker, calls } = makeWorker({
      consumers: [consumer('worker-1-old', 0, 3 * hour)],
    });
    await worker.runJanitor();

    const del = calls.filter((c) => c.cmd === 'xgroup');
    expect(del).toHaveLength(1);
    expect(del[0]!.args).toEqual(['DELCONSUMER', 'rotif:stream:notify', 'notification-worker', 'worker-1-old']);
  });

  it('never removes one holding pending messages, however idle', async () => {
    // Deleting the consumer deletes its PEL entries with it — the messages
    // would be gone, not redelivered.
    const { worker, calls } = makeWorker({
      consumers: [consumer('worker-2-stuck', 4, 30 * 24 * hour)],
    });
    await worker.runJanitor();
    expect(calls.some((c) => c.cmd === 'xgroup')).toBe(false);
  });

  it('never removes itself', async () => {
    const { worker, calls } = makeWorker({
      consumers: [consumer('worker-self', 0, 30 * 24 * hour)],
    });
    await worker.runJanitor();
    expect(calls.some((c) => c.cmd === 'xgroup')).toBe(false);
  });

  it('keeps one that has not been idle long enough', async () => {
    const { worker, calls } = makeWorker({
      consumers: [consumer('worker-3-recent', 0, 5 * 60 * 1000)],
    });
    await worker.runJanitor();
    expect(calls.some((c) => c.cmd === 'xgroup')).toBe(false);
  });

  it('survives a Redis failure without stopping delivery', async () => {
    // Housekeeping runs beside the consume loop; a hiccup here must not
    // propagate into it.
    const { worker } = makeWorker({});
    (worker as unknown as { redis: Record<string, unknown> }).redis['xinfo'] = async () => {
      throw new Error('CONNECTION BROKEN');
    };
    await expect(worker.runJanitor()).resolves.toBeUndefined();
  });
});
