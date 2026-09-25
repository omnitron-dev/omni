/**
 * A fire named after the tick before.
 *
 * In distributed mode a cron fire runs on whichever process takes its lock,
 * keyed by the fire's instant. The instant was `prev()` of the wall clock —
 * strictly BEFORE it — so a fire landing in its tick's own millisecond was
 * named after the previous tick, whose lock was still held (for `lockTTL`,
 * which for a 30-second job is the interval itself), and it was skipped. On
 * daos/test (2026-09-25) main's `home-snapshot-refresh` ran 43 of the 60
 * fires due in its first half hour, on one process with nobody to lose to.
 *
 * A fire the process did not run also left `nextExecution` naming it, so
 * every reader of that field — the attestation's «the scheduler is armed» —
 * saw a job node-cron was about to fire again as one that had died.
 *
 * And the next run was read in the host's timezone while node-cron fires in
 * the job's: `0 3 * * *` pinned to UTC on an MSK host was shown three hours
 * early.
 *
 * Held here, with node-cron replaced by a hand that fires each slot at a
 * chosen wall-clock time: a fire in its tick's own millisecond runs; a fire
 * another process ran moves this one's next run on; the next run is read in
 * the job's timezone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchedulerExecutor } from '../src/scheduler.executor.js';
import type { CronExpression, ISchedulerConfig, ISchedulerLockProvider } from '../src/scheduler.interfaces.js';
import { SchedulerRegistry } from '../src/scheduler.registry.js';
import { SchedulerService } from '../src/scheduler.service.js';

type Fire = (context: { date: Date }) => Promise<void>;

const { tasks } = vi.hoisted(() => ({ tasks: [] as Array<{ fire: Fire; options: unknown }> }));

vi.mock('node-cron', async (importOriginal) => {
  const real = await importOriginal<typeof import('node-cron')>();
  return {
    ...real,
    schedule: (_pattern: string, fire: Fire, options: unknown) => {
      tasks.push({ fire, options });
      return { start: () => undefined, stop: () => undefined, destroy: () => undefined };
    },
  };
});

/** SET NX PX in a Map: two services sharing one behave like two nodes sharing one Redis. */
class SharedMemoryLock implements ISchedulerLockProvider {
  private readonly locks = new Map<string, number>();
  async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    const held = this.locks.get(key);
    if (held !== undefined && held > Date.now()) return null;
    this.locks.set(key, Date.now() + ttlMs);
    return key;
  }
  async releaseLock(key: string): Promise<boolean> {
    return this.locks.delete(key);
  }
}

const node = (lock?: SharedMemoryLock, extra: Partial<ISchedulerConfig> = {}) => {
  const config: ISchedulerConfig = {
    enabled: true,
    maxConcurrent: 5,
    queueSize: 100,
    shutdownTimeout: 5000,
    ...(lock && { distributed: { enabled: true, lockTTL: 30_000 } }),
    ...extra,
  };
  const registry = new SchedulerRegistry(config);
  const svc = new SchedulerService(
    registry,
    new SchedulerExecutor(config),
    config,
    undefined,
    undefined,
    undefined,
    lock
  );
  return { svc, registry };
};

const EVERY_30_SECONDS = '*/30 * * * * *' as unknown as CronExpression;
const T = Date.parse('2026-09-25T09:01:00.000Z');

describe('a cron fire and the lock that decides who runs it', () => {
  afterEach(() => {
    vi.useRealTimers();
    tasks.length = 0;
  });

  it("a fire in its tick's own millisecond runs — it is not named after the tick before", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T - 10_000);
    const { svc } = node(new SharedMemoryLock());
    let runs = 0;
    svc.addCronJob('home-snapshot-refresh', EVERY_30_SECONDS, () => {
      runs++;
    });
    await svc.onStart();
    const { fire } = tasks.at(-1)!;

    vi.setSystemTime(T + 2); // node-cron usually lands a millisecond or two late…
    await fire({ date: new Date(T) });
    vi.setSystemTime(T + 30_000); // …and sometimes in the tick's own millisecond
    await fire({ date: new Date(T + 30_000) });

    expect(runs).toBe(2);
    await svc.onStop();
  });

  it("a fire another process ran still moves this one's next run on", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T - 10_000);
    const lock = new SharedMemoryLock();
    const a = node(lock);
    const b = node(lock);
    let runs = 0;
    for (const n of [a, b]) {
      n.svc.addCronJob('home-snapshot-refresh', EVERY_30_SECONDS, () => {
        runs++;
      });
      await n.svc.onStart();
    }
    const [fireA, fireB] = tasks.slice(-2).map((t) => t.fire);

    vi.setSystemTime(T + 3);
    await fireA!({ date: new Date(T) });
    await fireB!({ date: new Date(T) });

    expect(runs).toBe(1); // exactly once across the two
    for (const n of [a, b]) {
      expect(n.registry.getJob('home-snapshot-refresh')?.nextExecution?.getTime()).toBe(T + 30_000);
      await n.svc.onStop();
    }
  });

  it('the next run is read in the timezone the job fires in', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-09-25T09:00:00.000Z'));
    const { svc, registry } = node(undefined, { timezone: 'Asia/Tokyo' });
    svc.addCronJob('nightly', '0 3 * * *' as unknown as CronExpression, () => undefined);
    await svc.onStart();

    expect(tasks.at(-1)!.options).toMatchObject({ timezone: 'Asia/Tokyo' }); // node-cron fires at 03:00 in Tokyo
    expect(registry.getJob('nightly')?.nextExecution?.toISOString()).toBe('2026-09-25T18:00:00.000Z');
    await svc.onStop();
  });
});
