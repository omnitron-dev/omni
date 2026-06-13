/**
 * MetricsBridge unit tests.
 *
 * The bridge is a thin DAO over `IMetricsService.getRegistry()`. We use
 * the real `MetricsRegistry` (in-memory, no I/O) and a stub IMetricsService
 * that delegates to it. That way we exercise:
 *   - definition pre-registration produces the expected HELP lines
 *   - event-driven recorders bump the right counters/histograms
 *   - refreshAppGauges() polls the orchestrator and updates per-app
 *     gauges to (1, 0) for the (matching, non-matching) status
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetricsRegistry } from '@omnitron-dev/titan-metrics';
import type { IMetricsService } from '@omnitron-dev/titan-metrics';
import { MetricsBridge } from '../../src/observability/metrics-bridge.js';
import type { ProcessInfoDto } from '../../src/config/types.js';
import type { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';

function makeMetricsService(registry: MetricsRegistry): IMetricsService {
  return {
    record: () => {},
    recordBatch: () => {},
    // T#74: the bridge writes via recordTyped — delegate to the registry
    // exactly as the real MetricsService does so samples reach toPrometheusText.
    recordTyped: (type, name, labels, value) => {
      if (type === 'counter') registry.counter(name, labels, value);
      else if (type === 'histogram') registry.histogram(name, labels, value);
      else registry.gauge(name, labels, value);
    },
    evictApp: async () => {},
    getSnapshot: async () => ({ apps: [] }) as never,
    querySeries: async () => [],
    getPrometheusText: async () => registry.toPrometheusText(),
    start: () => {},
    stop: async () => {},
    flush: async () => {},
    cleanup: async () => {},
    getRegistry: () => registry,
  };
}

function fakeOrchestrator(apps: ProcessInfoDto[]): OrchestratorService {
  return {
    list: () => apps,
  } as unknown as OrchestratorService;
}

describe('MetricsBridge', () => {
  let registry: MetricsRegistry;
  let metrics: IMetricsService;
  let bridge: MetricsBridge;

  beforeEach(() => {
    registry = new MetricsRegistry();
    metrics = makeMetricsService(registry);
    bridge = new MetricsBridge(metrics);
  });

  it('pre-registers all definitions on construction', () => {
    const text = registry.toPrometheusText();
    expect(text).toContain('# HELP omnitron_app_status');
    expect(text).toContain('# HELP omnitron_workers_orphans_killed_total');
    expect(text).toContain('# HELP resilient_handle_resets_total');
    expect(text).toContain('# HELP omnitron_esbuild_duration_seconds');
    expect(text).toContain('# HELP lifecycle_shutdown_phase_duration_seconds');
  });

  it('refreshAppGauges sets app status gauge to 1 only for the current status', () => {
    const orchestrator = fakeOrchestrator([
      makeApp('paysys', 'online', 5),
      makeApp('main', 'errored', 2),
    ]);
    bridge.attachOrchestrator(orchestrator);
    bridge.refreshAppGauges();

    const text = registry.toPrometheusText();
    expect(text).toMatch(/omnitron_app_status{app="paysys",status="online"} 1/);
    expect(text).toMatch(/omnitron_app_status{app="paysys",status="errored"} 0/);
    expect(text).toMatch(/omnitron_app_status{app="main",status="errored"} 1/);
    expect(text).toMatch(/omnitron_app_status{app="main",status="online"} 0/);
    expect(text).toMatch(/omnitron_app_restarts{app="paysys"} 5/);
    expect(text).toMatch(/omnitron_app_restarts{app="main"} 2/);
  });

  it('recordJanitorSweep gauges current orphan/owned counts and bumps the total', () => {
    bridge.recordJanitorSweep({
      scannedAt: new Date(),
      forkWorkersAlive: 12,
      ownedPids: 10,
      orphansFound: 2,
      orphansKilled: 2,
      killErrors: 0,
    });

    const text = registry.toPrometheusText();
    expect(text).toMatch(/omnitron_workers_alive 12/);
    expect(text).toMatch(/omnitron_workers_owned 10/);
    expect(text).toMatch(/omnitron_workers_orphans_killed_total 2/);
  });

  it('recordResilientHandleReset increments the per-name counter', () => {
    bridge.recordResilientHandleReset({
      name: 'esbuild',
      attempt: 1,
      lastError: new Error('service is no longer running'),
      at: new Date(),
    });
    bridge.recordResilientHandleReset({
      name: 'esbuild',
      attempt: 2,
      lastError: new Error('service is no longer running'),
      at: new Date(),
    });

    const text = registry.toPrometheusText();
    expect(text).toMatch(/resilient_handle_resets_total{name="esbuild"} 2/);
  });

  it('recordEsbuildBuild populates the duration histogram + outcome counter', () => {
    bridge.recordEsbuildBuild('paysys', 'build', 1500, true);
    bridge.recordEsbuildBuild('paysys', 'rebuild', 200, false);

    const text = registry.toPrometheusText();
    expect(text).toMatch(/omnitron_esbuild_duration_seconds_bucket{[^}]*app="paysys"/);
    expect(text).toMatch(
      /omnitron_esbuild_builds_total{[^}]*app="paysys",[^}]*kind="build",[^}]*outcome="success"/,
    );
    expect(text).toMatch(
      /omnitron_esbuild_builds_total{[^}]*app="paysys",[^}]*kind="rebuild",[^}]*outcome="failure"/,
    );
  });

  it('recordAppRestart bumps the per-reason counter and gauge', () => {
    bridge.recordAppRestart('paysys', 3, 'crash');
    bridge.recordAppRestart('paysys', 4, 'crash');

    const text = registry.toPrometheusText();
    expect(text).toMatch(
      /omnitron_app_restarts_total{app="paysys",reason="crash"} 2/,
    );
    expect(text).toMatch(/omnitron_app_restart_attempt{app="paysys"} 4/);
  });

  it('recordLifecyclePhase populates the duration histogram and the timeout counter', () => {
    bridge.recordLifecyclePhase('stop-runtime', 1200, 'finish');
    bridge.recordLifecyclePhase('dispose', 5000, 'timeout');

    const text = registry.toPrometheusText();
    expect(text).toMatch(/lifecycle_shutdown_phase_duration_seconds_count{phase="stop-runtime"} 1/);
    expect(text).toMatch(/lifecycle_shutdown_phase_timeouts_total{phase="dispose"} 1/);
  });

  it('swallows registry errors via the optional logger', () => {
    const warn = vi.fn();
    const stub = { warn };
    const broken = makeMetricsService(registry);
    const origGauge = registry.gauge.bind(registry);
    registry.gauge = ((..._args: unknown[]) => {
      throw new Error('boom');
    }) as typeof registry.gauge;
    const b = new MetricsBridge(broken, stub);

    expect(() => b.recordJanitorSweep({
      scannedAt: new Date(),
      forkWorkersAlive: 1,
      ownedPids: 1,
      orphansFound: 0,
      orphansKilled: 0,
      killErrors: 0,
    })).not.toThrow();
    expect(warn).toHaveBeenCalled();

    registry.gauge = origGauge;
  });
});

function makeApp(name: string, status: ProcessInfoDto['status'], restarts: number): ProcessInfoDto {
  return {
    name,
    pid: 1234,
    status,
    cpu: 0,
    memory: 0,
    uptime: 60,
    restarts,
  } as ProcessInfoDto;
}
