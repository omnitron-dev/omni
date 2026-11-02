import { describe, expect, it, vi } from 'vitest';
import { registerDaemonJobs } from '../../src/daemon/daemon-scheduler.js';

function sampler(initiallyPaused = false) {
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
    metricsService: { recordBatch, flush } as never,
    authService: null, alertService: null, fleetService: null, infraService: null, logManager: {} as never,
    metricsInterval: 100, healthCheckInterval: 100, metricsInitiallyPaused: initiallyPaused, diagnostics,
  });
  return { control, tick: jobs.get('metrics-collection')!, drainChildSamples, recordBatch, flush, diagnostics };
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
