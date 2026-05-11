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
