/**
 * Regression tests for T#74 — registry vs storage drift.
 *
 * Pre-T#74 the metrics-bridge wrote ~20 `omnitron_*` metrics
 * (per-app CPU/memory gauges, restart counters, esbuild
 * histograms, etc.) directly via `metrics.getRegistry().gauge(...)`
 * etc. These appeared in the Prometheus exposition (`/metrics`)
 * but were INVISIBLE to the storage layer — every dashboard
 * query for them via `querySeries()` returned empty.
 *
 * Symmetrically, `metrics.record(sample)` wrote to BOTH registry
 * and storage but routed by previously-registered TYPE
 * (defaulting to gauge), so calling `record()` for a counter
 * recorded the wrong shape in the registry.
 *
 * Fix: new `recordTyped(type, name, labels, value)` entry point on
 * `MetricsService`. The bridge now goes through this single
 * source of truth; every emit lands in BOTH the registry (with
 * correct type-aware semantics) and the storage buffer.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetricsService } from '../src/metrics.service.js';
import { MemoryMetricsStorage, DAEMON_APP_LABEL } from '../src/index.js';

const noopLogger: any = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  child: () => noopLogger,
};

describe('MetricsService.recordTyped — T#74 drift dedup', () => {
  let svc: MetricsService;
  let storage: MemoryMetricsStorage;

  beforeEach(() => {
    storage = new MemoryMetricsStorage();
    svc = new MetricsService({} as any, storage, noopLogger);
  });

  it('counter — writes appear in BOTH the Prometheus registry and the storage layer', async () => {
    svc.recordTyped('counter', 'omnitron_app_restarts_total', { app: 'main' }, 1);
    svc.recordTyped('counter', 'omnitron_app_restarts_total', { app: 'main' }, 1);
    svc.recordTyped('counter', 'omnitron_app_restarts_total', { app: 'main' }, 1);
    await svc.flush();

    // Prometheus registry: cumulative counter = 3.
    const prom = await svc.getPrometheusText();
    expect(prom).toMatch(/omnitron_app_restarts_total\{[^}]*app="main"[^}]*\} 3/);

    // Storage: three samples landed.
    const series = await svc.querySeries({ names: ['omnitron_app_restarts_total'], apps: ['main'] });
    expect(series).toHaveLength(1);
    expect(series[0]!.points.length).toBe(3);
  });

  it('gauge — last-write-wins in registry, append-only in storage', async () => {
    svc.recordTyped('gauge', 'omnitron_app_cpu_percent', { app: 'main' }, 12);
    svc.recordTyped('gauge', 'omnitron_app_cpu_percent', { app: 'main' }, 47);
    svc.recordTyped('gauge', 'omnitron_app_cpu_percent', { app: 'main' }, 33);
    await svc.flush();

    // Prometheus registry: gauge is last-write-wins.
    const prom = await svc.getPrometheusText();
    expect(prom).toMatch(/omnitron_app_cpu_percent\{[^}]*app="main"[^}]*\} 33/);

    // Storage: every sample retained — querySeries returns 3 points.
    const series = await svc.querySeries({ names: ['omnitron_app_cpu_percent'], apps: ['main'] });
    expect(series[0]!.points.map((p) => p.value)).toEqual([12, 47, 33]);
  });

  it('histogram — observations appear in both _bucket exposition and storage', async () => {
    svc.recordTyped('histogram', 'omnitron_esbuild_duration_seconds', { app: 'main' }, 0.05);
    svc.recordTyped('histogram', 'omnitron_esbuild_duration_seconds', { app: 'main' }, 0.7);
    svc.recordTyped('histogram', 'omnitron_esbuild_duration_seconds', { app: 'main' }, 3.0);
    await svc.flush();

    const prom = await svc.getPrometheusText();
    expect(prom).toMatch(/omnitron_esbuild_duration_seconds_bucket\{[^}]*le="[+\d.]+"[^}]*\} \d+/);
    expect(prom).toMatch(/omnitron_esbuild_duration_seconds_count\{[^}]*\} 3/);

    const series = await svc.querySeries({ names: ['omnitron_esbuild_duration_seconds'], apps: ['main'] });
    expect(series[0]!.points.length).toBe(3);
  });

  it('reproduces the original drift symptom when bypassing recordTyped (control)', async () => {
    // Direct registry write — the OLD broken path. Prom shows the
    // value but storage knows nothing about it.
    svc.getRegistry().gauge('legacy_drift_gauge', { app: 'main' }, 99);

    const prom = await svc.getPrometheusText();
    expect(prom).toMatch(/legacy_drift_gauge\{[^}]*\} 99/);

    const series = await svc.querySeries({ names: ['legacy_drift_gauge'] });
    expect(series).toEqual([]);
  });

  it('storage-only via record(sample) is honoured for daemon-scoped metrics', async () => {
    // Verify that callers that already used `record()` (storage-aware
    // path) keep working — recordTyped is additive, not a replacement.
    svc.record({
      name: 'rpc_requests_total',
      value: 1,
      timestamp: Date.now(),
      labels: {},
    });
    await svc.flush();

    const series = await svc.querySeries({ names: ['rpc_requests_total'] });
    expect(series).toHaveLength(1);
    expect(series[0]!.app).toBe(DAEMON_APP_LABEL); // T#63 daemon-scope normalisation
  });
});
