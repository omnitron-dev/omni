import { describe, expect, it, vi } from 'vitest';
import { withControlDeadline } from '../../src/daemon/private-control-client.js';
import { registerDaemonJobs } from '../../src/daemon/daemon-scheduler.js';

function sampler(initiallyPaused = false, evaluate?: (now: number, signal: AbortSignal) => Promise<void>) {
  const jobs = new Map<string, () => void | Promise<void>>();
  const drainChildSamples = vi.fn(async () => [{ app: 'worker', samples: [{ value: 1 }] }]);
  const recordBatch = vi.fn();
  const flush = vi.fn(async () => {});
  const diagnostics = { failure: vi.fn(), resolve: vi.fn() };
  const control = registerDaemonJobs({
    addInterval(name: string, _interval: number, run: () => void | Promise<void>) { jobs.set(name, run); },
  } as never, {
    logger: { info: vi.fn() } as never,
    orchestrator: { list: () => [], drainChildSamples } as never,
    metricsService: { recordBatch, flush, getStorageStatus: () => ({ pendingSamples: 7, writing: false }) } as never,
    authService: null, alertService: evaluate ? { evaluate } as never : null, fleetService: null, infraService: null, logManager: {} as never,
    metricsInterval: 100, healthCheckInterval: 100, metricsInitiallyPaused: initiallyPaused, diagnostics,
  });
  return { control, alerts: jobs.get('alert-evaluation'), tick: jobs.get('metrics-collection')!, drainChildSamples, recordBatch, flush, diagnostics };
}

describe('metric sampling across controller handoff', () => {
  it('waits for an accepted drain and its storage flush before transferring ownership', async () => {
    const { control, tick, drainChildSamples, recordBatch, flush } = sampler();
    let finish!: () => void;
    const inFlight = new Promise<void>(resolve => { finish = resolve; });
    drainChildSamples.mockImplementationOnce(async () => { await inFlight; return [{ app: 'worker', samples: [{ value: 7 }] }]; });
    const first = tick();
    expect(tick()).toBe(first);
    const paused = control.pauseAndFlush();
    expect(tick()).toBe(first);
    expect(flush).not.toHaveBeenCalled();
    finish();
    await paused;
    expect(drainChildSamples).toHaveBeenCalledTimes(1);
    expect(recordBatch).toHaveBeenCalledExactlyOnceWith([{ value: 7 }]);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.invocationCallOrder[0]).toBeGreaterThan(recordBatch.mock.invocationCallOrder[0]!);
    await tick();
    expect(drainChildSamples).toHaveBeenCalledTimes(1);
  });

  it('flushes accepted samples while an admitted alert is finishing and reports each blocker', async () => {
    const evaluation = Promise.withResolvers<void>();
    const write = Promise.withResolvers<void>();
    const evaluate = vi.fn((_now: number, _signal: AbortSignal) => evaluation.promise);
    const { control, alerts, flush } = sampler(false, evaluate);
    flush.mockImplementationOnce(() => write.promise);
    void alerts!();
    control.pause();
    expect(evaluate.mock.calls[0]![1].aborted).toBe(true);
    expect(alerts!()).toBeDefined();
    expect(evaluate).toHaveBeenCalledTimes(1);
    const paused = control.pauseAndFlush();
    await Promise.resolve();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(control.describeDrain()).toContain('alert evaluation or delivery');
    expect(control.describeDrain()).toContain('metric storage flush');
    expect(control.describeDrain()).toContain('pendingSamples=7');
    evaluation.resolve();
    await alerts!();
    expect(control.describeDrain()).not.toContain('alert evaluation or delivery');
    write.resolve();
    await paused;
    expect(control.describeDrain()).not.toContain('metric storage flush');
    await alerts!();
    expect(evaluate).toHaveBeenCalledTimes(1);
    control.resume();
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(evaluate.mock.calls[1]![1].aborted).toBe(false);
  });

  it('reads the blocker at expiry and leaves its successful completion to the incumbent', async () => {
    vi.useFakeTimers();
    try {
      const outstanding = Promise.withResolvers<void>();
      let blocker = 'sampling';
      const describe = vi.fn(() => blocker);
      const guarded = withControlDeadline(outstanding.promise, 30_000, describe);
      expect(describe).not.toHaveBeenCalled();
      blocker = 'alert delivery';
      const failure = expect(guarded).rejects.toThrow('alert delivery');
      await vi.advanceTimersByTimeAsync(30_000);
      await failure;
      outstanding.resolve();
      await outstanding.promise;
      expect(describe).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('admits the replacement only when ready and resumes the incumbent after a failed flush', async () => {
    const { control, tick, drainChildSamples, flush, diagnostics } = sampler(true);
    await tick();
    expect(drainChildSamples).not.toHaveBeenCalled();
    control.resume();
    await tick();
    flush.mockRejectedValueOnce(new Error('outbox unavailable'));
    await expect(control.pauseAndFlush()).rejects.toThrow('outbox unavailable');
    await tick();
    expect(drainChildSamples).toHaveBeenCalledTimes(1);
    control.resume();
    const failure = new Error('owner connection lost');
    drainChildSamples.mockRejectedValueOnce(failure);
    await tick();
    expect(diagnostics.failure).toHaveBeenCalledWith('runtime.job.child-metrics', expect.any(String), failure);
    await tick();
    expect(diagnostics.resolve).toHaveBeenCalledWith('runtime.job.child-metrics');
  });
});
