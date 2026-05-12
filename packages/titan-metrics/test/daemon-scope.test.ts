/**
 * Regression test for T#63 — daemon-scoped samples leaking into
 * per-app rollups via an empty `app` label.
 *
 * Pre-T#63, daemon-scoped collectors emitted samples with no
 * `app` label. The storage layer translated missing-or-empty to
 * `''` uniformly, and Grafana panels like `sum by (app) (...)`
 * grew a phantom group labelled `app=""` whose contents were
 * daemon-internal traffic mixed into app totals.
 *
 * Fix: normalise at `write()`. Missing/empty `app` is coerced to
 * a stable `__daemon__` sentinel. Callers wanting app-only
 * rollups filter that out explicitly.
 */

import { describe, it, expect } from 'vitest';
import { MemoryMetricsStorage, DAEMON_APP_LABEL } from '../src/index.js';
import type { MetricSample } from '../src/types.js';

function daemonSample(name: string, value: number, age = 1_000): MetricSample {
  return {
    name,
    value,
    timestamp: Date.now() - age,
    labels: {}, // no 'app' — historically the polluting case
  };
}

function appSample(name: string, app: string, value: number, age = 1_000): MetricSample {
  return { name, value, timestamp: Date.now() - age, labels: { app } };
}

describe('MetricsStorage — daemon-scope normalisation (T#63)', () => {
  it('coerces samples with no `app` label to the daemon sentinel', async () => {
    const s = new MemoryMetricsStorage();
    await s.write([daemonSample('rpc_requests_total', 5), appSample('rpc_requests_total', 'main', 10)]);

    const snap = await s.getLatest();
    // Both `main` and `__daemon__` appear, neither under `''`.
    expect(Object.keys(snap.apps).sort()).toEqual([DAEMON_APP_LABEL, 'main'].sort());
    expect(snap.apps['']).toBeUndefined();
  });

  it('coerces samples whose `app` label is the empty string', async () => {
    const s = new MemoryMetricsStorage();
    const explicitlyEmpty: MetricSample = {
      name: 'rpc_requests_total',
      value: 3,
      timestamp: Date.now() - 1_000,
      labels: { app: '' },
    };
    await s.write([explicitlyEmpty]);

    const snap = await s.getLatest();
    expect(Object.keys(snap.apps)).toEqual([DAEMON_APP_LABEL]);
  });

  it("filtering by app='__daemon__' returns only daemon samples", async () => {
    const s = new MemoryMetricsStorage();
    await s.write([
      daemonSample('rpc_requests_total', 5),
      appSample('rpc_requests_total', 'main', 10),
      appSample('rpc_requests_total', 'storage', 7),
    ]);

    const series = await s.query({ apps: [DAEMON_APP_LABEL] });
    // Exactly one series, only daemon's contribution.
    expect(series).toHaveLength(1);
    expect(series[0]!.app).toBe(DAEMON_APP_LABEL);
    expect(series[0]!.points.map((p) => p.value)).toEqual([5]);
  });

  it("evictApp('__daemon__') drops only daemon samples", async () => {
    const s = new MemoryMetricsStorage();
    await s.write([
      daemonSample('rpc_requests_total', 5),
      appSample('rpc_requests_total', 'main', 10),
    ]);

    await s.evictApp(DAEMON_APP_LABEL);
    const snap = await s.getLatest();
    expect(Object.keys(snap.apps)).toEqual(['main']);
  });

  it('app-only queries do not accidentally include daemon traffic', async () => {
    const s = new MemoryMetricsStorage();
    await s.write([
      daemonSample('rpc_requests_total', 100),
      appSample('rpc_requests_total', 'main', 1),
    ]);

    const series = await s.query({ apps: ['main'] });
    expect(series).toHaveLength(1);
    expect(series[0]!.app).toBe('main');
    // The value comes from the app sample, NOT the daemon's 100.
    expect(series[0]!.points.map((p) => p.value)).toEqual([1]);
  });
});
