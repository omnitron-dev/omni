/**
 * PeriodicProbe (HEARTBEAT-UNIFY) — the shared periodic-loop scaffolding.
 *
 * Locks the behaviour the netron health loops rely on: interval ticking, the
 * T#50 re-entrancy guard (drop overlapping ticks while an async task runs),
 * run-immediately, sync/async error routing, and stop/idempotency.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PeriodicProbe } from '../../src/utils/periodic-probe.js';

describe('PeriodicProbe', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs the task once per interval', async () => {
    const task = vi.fn(async () => {});
    const probe = new PeriodicProbe({ intervalMs: 100, task });

    probe.start();
    expect(task).toHaveBeenCalledTimes(0); // no immediate run by default
    await vi.advanceTimersByTimeAsync(100);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(task).toHaveBeenCalledTimes(3);
    probe.stop();
  });

  it('drops overlapping ticks while a slow async task is still running (T#50 guard)', async () => {
    let release!: () => void;
    const task = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const probe = new PeriodicProbe({ intervalMs: 100, task });

    probe.start();
    await vi.advanceTimersByTimeAsync(100); // tick 1 → task running, not yet resolved
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300); // 3 more ticks, all dropped (still running)
    expect(task).toHaveBeenCalledTimes(1);

    release(); // task 1 completes → guard released
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100); // next tick runs
    expect(task).toHaveBeenCalledTimes(2);
    probe.stop();
  });

  it('honours preventOverlap:false (no guard)', async () => {
    let n = 0;
    const task = vi.fn(() => new Promise<void>(() => { n++; })); // never resolves
    const probe = new PeriodicProbe({ intervalMs: 100, task, preventOverlap: false });
    probe.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(task).toHaveBeenCalledTimes(3); // every tick fires despite prior not resolving
    expect(n).toBe(3);
    probe.stop();
  });

  it('runs immediately when configured', async () => {
    const task = vi.fn(async () => {});
    const probe = new PeriodicProbe({ intervalMs: 100, task, runImmediately: true });
    probe.start();
    expect(task).toHaveBeenCalledTimes(1); // before any interval
    await vi.advanceTimersByTimeAsync(100);
    expect(task).toHaveBeenCalledTimes(2);
    probe.stop();
  });

  it('routes synchronous throws and async rejections to onError', async () => {
    const onError = vi.fn();
    const syncProbe = new PeriodicProbe({
      intervalMs: 100,
      task: () => {
        throw new Error('sync boom');
      },
      onError,
    });
    syncProbe.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'sync boom' }));
    syncProbe.stop();

    const asyncProbe = new PeriodicProbe({
      intervalMs: 100,
      task: async () => {
        throw new Error('async boom');
      },
      onError,
    });
    asyncProbe.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'async boom' }));
    asyncProbe.stop();
  });

  it('stop() halts ticking and is idempotent; start() is idempotent', async () => {
    const task = vi.fn(async () => {});
    const probe = new PeriodicProbe({ intervalMs: 100, task });
    probe.start();
    probe.start(); // idempotent — does not create a second interval
    await vi.advanceTimersByTimeAsync(100);
    expect(task).toHaveBeenCalledTimes(1);
    expect(probe.isActive).toBe(true);

    probe.stop();
    expect(probe.isActive).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(task).toHaveBeenCalledTimes(1); // no more ticks
    probe.stop(); // idempotent
  });
});
