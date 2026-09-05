/**
 * The declared flush and cleanup intervals must be the ones used.
 *
 * `IMetricsStorageConfig.flushInterval` ("Flush interval in ms (default: 5000)")
 * and `IMetricsRetentionConfig.cleanupInterval` ("Cleanup interval in ms
 * (default: 3600000 = 1h)") are documented options with documented defaults.
 * `start()` read the module constants directly, so a caller who set either got
 * the default and no sign that their value had been dropped — a deployment
 * asking for a tighter retention sweep silently kept the hourly one.
 *
 * The intervals are observed through the timers the service arms, which is
 * where they are actually applied.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { MetricsService } from '../src/metrics.service.js';
import type { IMetricsStorage } from '../src/types.js';

const storage: IMetricsStorage = {
  async write() { /* */ },
  async query() { return []; },
  async cleanup() { /* */ },
  async evictApp() { /* */ },
} as unknown as IMetricsStorage;

/** Intervals armed by `start()`, in arming order. */
function armedIntervals(run: () => void): number[] {
  const delays: number[] = [];
  const spy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((_fn: unknown, ms?: number) => {
    delays.push(ms ?? 0);
    return { unref() {} } as unknown as NodeJS.Timeout;
  }) as never);
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return delays;
}

describe('MetricsService interval options', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the documented defaults when nothing is configured', () => {
    const service = new MetricsService(
      { appName: 'test', collection: { enabled: false }, storage: { type: 'memory' } },
      storage
    );

    const delays = armedIntervals(() => void service.start());

    expect(delays).toContain(5_000); // flush
    expect(delays).toContain(3_600_000); // cleanup
  });

  it('uses a configured flush interval', () => {
    const service = new MetricsService(
      { appName: 'test', collection: { enabled: false }, storage: { type: 'memory', flushInterval: 250 } },
      storage
    );

    const delays = armedIntervals(() => void service.start());

    expect(delays).toContain(250);
    expect(delays).not.toContain(5_000);
  });

  it('uses a configured cleanup interval', () => {
    const service = new MetricsService(
      {
        appName: 'test',
        collection: { enabled: false },
        storage: { type: 'memory' },
        retention: { cleanupInterval: 60_000 },
      },
      storage
    );

    const delays = armedIntervals(() => void service.start());

    expect(delays).toContain(60_000);
    expect(delays).not.toContain(3_600_000);
  });
});
