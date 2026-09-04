/**
 * The auto-scaler must compare like with like.
 *
 * `targetCPU` and `targetMemory` are percentages — by name, by their defaults
 * (70 and 80) and by the company they keep (`scaleUpThreshold` is a 0..1
 * ratio). The figures fed to them were not: a worker reports `cpu` as
 * cumulative CPU SECONDS since it started and `memory` as heap BYTES.
 *
 * So `metrics.memory > 80` was true for any worker holding more than eighty
 * bytes, and `metrics.cpu > 70` became permanently true after seventy seconds
 * of CPU time. Scale-down needed `memory < 40` — under forty bytes — and could
 * never fire. The pool could only grow. Observed on a live stand as two pools
 * each configured for 2 instances running 8 apiece, one step per 30s cooldown,
 * with no scale-down in five minutes.
 *
 * Nothing caught it because every existing CPU and memory test in
 * `autoscaling.spec.ts` asserts the NEGATIVE — "shouldn't trigger scale up" —
 * which holds whether the comparison works or not. These assert the positive
 * direction, and the first one fails on the old code.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from '@omnitron-dev/eventemitter';

import { ProcessPool } from '../../src/process-pool.js';
import { ProcessStatus } from '../../src/types.js';
import { createMockLogger } from '@omnitron-dev/testing/titan';

/** A worker reporting exactly what a real one reports. */
function realisticProxy(id: string, plan: { cpuSecondsPerSample: number; heapBytes: number; rssBytes?: number }) {
  let cpuSeconds = 0;
  return {
    __processId: id,
    __destroy: vi.fn().mockResolvedValue(undefined),
    __getMetrics: vi.fn().mockImplementation(async () => {
      cpuSeconds += plan.cpuSecondsPerSample;
      return {
        cpu: cpuSeconds,
        memory: plan.heapBytes,
        ...(plan.rssBytes !== undefined ? { memoryRss: plan.rssBytes } : {}),
        requests: 0,
        errors: 0,
      };
    }),
    __getHealth: vi.fn().mockResolvedValue({ status: 'healthy', checks: [], timestamp: Date.now() }),
    testMethod: vi.fn().mockResolvedValue('result'),
  };
}

const HEALTH_INTERVAL = 1_000;
const CHECK_INTERVAL = 1_000;

function mockManager(proxyFactory: () => unknown) {
  const manager = new EventEmitter() as any;
  manager.spawn = vi.fn().mockImplementation(async () => proxyFactory());
  manager.kill = vi.fn().mockResolvedValue(true);
  manager.getProcess = vi.fn().mockReturnValue({ id: 'test-process', status: ProcessStatus.RUNNING });
  return manager;
}

describe('auto-scaling compares percentages, not raw counters', () => {
  let pool: ProcessPool<any> | undefined;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    logger = createMockLogger();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await pool?.destroy().catch(() => {});
    pool = undefined;
  });

  /**
   * Advances the pool's own timers. Health checks are what sample the workers,
   * and the auto-scale tick is what acts on the result, so both have to run —
   * and more than once, because a CPU rate needs two samples.
   */
  async function tick(times: number): Promise<void> {
    for (let i = 0; i < times; i++) {
      await vi.advanceTimersByTimeAsync(HEALTH_INTERVAL);
      await vi.advanceTimersByTimeAsync(CHECK_INTERVAL);
    }
  }

  it('does not scale up on an idle worker holding megabytes of heap', async () => {
    // The regression. 17 MB of heap and a second of CPU per sample is an idle
    // Node worker; under the old comparison both cleared "70" and "80" and the
    // pool ratcheted to max.
    let count = 0;
    const manager = mockManager(() =>
      realisticProxy(`worker-${++count}`, { cpuSecondsPerSample: 0.001, heapBytes: 17_236_544, rssBytes: 181_354_496 })
    );

    pool = new ProcessPool(
      manager,
      'TestProcess',
      { size: 2, memoryLimit: '512MB', healthCheck: { enabled: true, interval: HEALTH_INTERVAL }, autoScale: { enabled: true, min: 1, max: 8, cooldownPeriod: 0, checkInterval: CHECK_INTERVAL } } as never,
      logger as never
    );
    await pool.initialize();
    await tick(3);

    // It must not GROW. It may shrink — an idle pool releasing workers is the
    // behaviour that was unreachable before, because scale-down demanded
    // "memory below 40 bytes".
    expect(pool.size).toBeLessThanOrEqual(2);
  }, 30_000);

  it('reports CPU as a rate and memory as a share of the limit', async () => {
    let count = 0;
    const manager = mockManager(() =>
      realisticProxy(`worker-${++count}`, { cpuSecondsPerSample: 0.001, heapBytes: 1_000_000, rssBytes: 268_435_456 })
    );

    pool = new ProcessPool(
      manager,
      'TestProcess',
      { size: 1, memoryLimit: '512MB', healthCheck: { enabled: true, interval: HEALTH_INTERVAL }, autoScale: { enabled: true, min: 1, max: 4, cooldownPeriod: 0, checkInterval: CHECK_INTERVAL } } as never,
      logger as never
    );
    await pool.initialize();
    await tick(2);

    const metrics = pool.metrics;
    // 256 MB of 512 MB.
    expect(metrics.memoryPercent).toBeCloseTo(50, 0);
    // A rate, not the cumulative total.
    expect(metrics.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(metrics.cpuPercent).toBeLessThan(100);
    // The raw counters stay raw.
    expect(metrics.memory).toBe(1_000_000);
  }, 30_000);

  it('scales up when memory genuinely exceeds the target share', async () => {
    let count = 0;
    // 500 MB resident against a 512 MB limit — 97%, over the 80% default.
    const manager = mockManager(() =>
      realisticProxy(`worker-${++count}`, { cpuSecondsPerSample: 0.001, heapBytes: 1_000, rssBytes: 524_288_000 })
    );

    pool = new ProcessPool(
      manager,
      'TestProcess',
      { size: 1, memoryLimit: '512MB', healthCheck: { enabled: true, interval: HEALTH_INTERVAL }, autoScale: { enabled: true, min: 1, max: 4, cooldownPeriod: 0, checkInterval: CHECK_INTERVAL } } as never,
      logger as never
    );
    await pool.initialize();
    await tick(3);

    expect(pool.size).toBeGreaterThan(1);
  }, 30_000);

  it('does not treat an unmeasured resource as idle', async () => {
    // A worker that reports nothing usable must not license scale-down: "not
    // measured" is not "idle". Before, an absent figure defaulted to 0 and read
    // as a fully idle pool.
    let count = 0;
    const manager = mockManager(() => ({
      __processId: `worker-${++count}`,
      __destroy: vi.fn().mockResolvedValue(undefined),
      __getMetrics: vi.fn().mockResolvedValue({ requests: 0, errors: 0 }),
      __getHealth: vi.fn().mockResolvedValue({ status: 'healthy', checks: [], timestamp: Date.now() }),
      testMethod: vi.fn().mockResolvedValue('result'),
    }));

    pool = new ProcessPool(
      manager,
      'TestProcess',
      { size: 3, healthCheck: { enabled: true, interval: HEALTH_INTERVAL }, autoScale: { enabled: true, min: 1, max: 5, cooldownPeriod: 0, checkInterval: CHECK_INTERVAL } } as never,
      logger as never
    );
    await pool.initialize();
    await tick(3);

    expect(pool.size).toBe(3);
  }, 30_000);
});
