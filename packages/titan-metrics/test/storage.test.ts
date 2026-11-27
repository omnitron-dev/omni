/**
 * Regression coverage for the snapshot pipeline:
 *  - Staleness filter — apps without a fresh `app_status` heartbeat
 *    must NOT appear in `getLatest({ staleAfterMs })`.
 *  - Explicit eviction — `evictApp(name)` must drop every sample for
 *    that app from the ring and not surface in subsequent snapshots.
 *
 * Both are critical for the dashboard's "Applications" KPI: before this
 * fix, ghost entries from previously-known apps inflated the offline
 * count for the lifetime of the daemon process.
 */

import { describe, it, expect } from 'vitest';
import { MemoryMetricsStorage } from '../src/storage.js';
import type { MetricSample } from '../src/types.js';

// All timestamps are computed relative to Date.now() at test time —
// `getLatest` uses Date.now() internally for the staleness cutoff, so
// hard-coded epochs would always read as "stale" by the time the test runs.
function statusSample(app: string, status: 'online' | 'offline', ageMs: number): MetricSample {
  return {
    name: 'app_status',
    value: status === 'online' ? 1 : 0,
    timestamp: Date.now() - ageMs,
    labels: { app },
  };
}

function cpuSample(app: string, cpu: number, ageMs: number): MetricSample {
  return { name: 'cpu_percent', value: cpu, timestamp: Date.now() - ageMs, labels: { app } };
}

describe('MemoryMetricsStorage.getLatest staleness filter', () => {
  it('drops apps whose app_status sample is older than the staleness window', async () => {
    const s = new MemoryMetricsStorage();
    await s.write([
      statusSample('alive', 'online', 1_000),
      cpuSample('alive', 25, 1_000),
      // Ghost: status sample from 60s ago — should be evicted with a 30s window.
      statusSample('ghost', 'offline', 60_000),
      cpuSample('ghost', 0, 60_000),
    ]);

    const snap = await s.getLatest(undefined, { staleAfterMs: 30_000 });

    expect(Object.keys(snap.apps)).toEqual(['alive']);
    expect(snap.totals.apps).toBe(1);
    expect(snap.totals.onlineApps).toBe(1);
  });

  it('keeps apps that have no app_status sample at all (custom collectors)', async () => {
    const s = new MemoryMetricsStorage();
    await s.write([cpuSample('custom-only', 12, 60_000)]);

    const snap = await s.getLatest(undefined, { staleAfterMs: 30_000 });

    // No app_status sample → can't prove the app is stale → keep it.
    expect(Object.keys(snap.apps)).toEqual(['custom-only']);
  });

  it('legacy callers without opts see the unfiltered ring (back-compat)', async () => {
    const s = new MemoryMetricsStorage();
    await s.write([
      statusSample('alive', 'online', 1_000),
      statusSample('ghost', 'offline', 60_000),
    ]);

    const snap = await s.getLatest();
    expect(Object.keys(snap.apps).sort()).toEqual(['alive', 'ghost']);
  });
});

describe('MemoryMetricsStorage.evictApp', () => {
  it('keeps the newest observation when a mesh peer delivers older samples later', async () => {
    const store = new MemoryMetricsStorage(5);
    await store.write([statusSample('api', 'online', 100), cpuSample('api', 25, 100)]);
    await store.write([statusSample('api', 'offline', 90_000), cpuSample('api', 99, 90_000)]);
    const snapshot = await store.getLatest(undefined, { staleAfterMs: 30_000 });
    expect(snapshot.apps.api).toMatchObject({ status: 'online', cpu: 25 });
  });

  it('applies retention throughout a wrapped ring and reuses the released capacity', async () => {
    const store = new MemoryMetricsStorage(4);
    await store.write([0, 1, 2, 3, 4, 5].map(index =>
      cpuSample('api', index, index % 2 === 0 ? 90_000 : 1000)));
    await store.cleanup(30_000);
    const values = async () => (await store.query({})).flatMap(series => series.points.map(point => point.value)).sort((a, b) => a - b);
    expect(await values()).toEqual([3, 5]);
    await store.write([cpuSample('api', 6, 500), cpuSample('api', 7, 400), cpuSample('api', 8, 300)]);
    expect(await values()).toEqual([5, 6, 7, 8]);
    await store.evictApp('api');
    expect(await values()).toEqual([]);
    await store.write([cpuSample('api', 9, 200)]);
    expect(await values()).toEqual([9]);
  });

  it('drops every sample for the named app from the ring', async () => {
    const s = new MemoryMetricsStorage();
    await s.write([
      statusSample('keep', 'online', 0),
      cpuSample('keep', 10, 0),
      statusSample('gone', 'online', 0),
      cpuSample('gone', 99, 0),
    ]);

    await s.evictApp('gone');

    const snap = await s.getLatest();
    expect(Object.keys(snap.apps)).toEqual(['keep']);
    // Totals shouldn't reflect the evicted app's CPU.
    expect(snap.totals.cpu).toBe(10);
  });

  it('is idempotent and tolerates unknown app names', async () => {
    const s = new MemoryMetricsStorage();
    await s.write([statusSample('alive', 'online', 0)]);
    await s.evictApp('does-not-exist');
    await s.evictApp('does-not-exist');

    const snap = await s.getLatest();
    expect(Object.keys(snap.apps)).toEqual(['alive']);
  });
});
