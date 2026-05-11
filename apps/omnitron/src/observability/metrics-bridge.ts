/**
 * Omnitron metrics bridge — single point of contact between the daemon's
 * runtime hooks (orchestrator events, ProcessJanitor sweeps,
 * ResilientHandle resets, esbuild rebuilds) and the underlying
 * `IMetricsService` registry from `@omnitron-dev/titan-metrics`.
 *
 * Every issue we've debugged in production was diagnosed REACTIVELY
 * from log greps: postgres connection exhaustion (we found 207 leaked
 * fork-workers only after pg_stat_activity told us to look), esbuild
 * Go sidecar deaths (the build self-heal was silent until we wired up
 * a dedicated log line), RPC name mismatches (only surfaced when an app
 * couldn't talk to its dependency at runtime). The metrics this bridge
 * exposes are what we wished we'd had during each of those incidents.
 *
 * Design notes:
 *
 *  - Metrics live in the titan-metrics registry; this bridge is the
 *    DAO that types the writes. Callers don't touch the registry
 *    directly — they call `metrics.recordEsbuildBuild(...)` etc.
 *
 *  - Per-app gauges (`status`, `restart_total`, `uptime_seconds`) are
 *    refreshed on every Prometheus scrape via `refreshAppGauges()`.
 *    The HTTP server calls it before formatting text. This avoids
 *    wiring callbacks into every state mutation in the orchestrator.
 *
 *  - Event-driven counters/histograms (orphan kills, esbuild
 *    rebuilds, lifecycle phases) are recorded eagerly via the
 *    record* helpers, since events are sparse and we don't want to
 *    drop them between scrapes.
 */

import type { IMetricsService } from '@omnitron-dev/titan-metrics';
import type { ResetInfo } from '@omnitron-dev/titan/utils';
import type { JanitorSweepMetrics } from '../orchestrator/process-janitor.js';
import type { OrchestratorService } from '../orchestrator/orchestrator.service.js';
import type { AppStatus } from '../config/types.js';

// All known statuses; we emit one row per (app, status) so Grafana can
// pivot. Keeping the list explicit means a typo in OrchestratorService
// produces a dropped metric instead of a silent new label value.
const APP_STATUSES = [
  'stopped',
  'starting',
  'online',
  'stopping',
  'errored',
  'crashed',
] as const satisfies readonly AppStatus[];

export class MetricsBridge {
  private readonly metrics: IMetricsService;
  private readonly logger: { warn?: (...args: any[]) => void } | undefined;
  private orchestrator: OrchestratorService | null = null;
  private definitionsRegistered = false;

  constructor(metrics: IMetricsService, logger?: { warn?: (...args: any[]) => void }) {
    this.metrics = metrics;
    this.logger = logger;
    this.registerDefinitions();
  }

  /** Wire the orchestrator so per-app gauges can be refreshed at scrape time. */
  attachOrchestrator(orchestrator: OrchestratorService): void {
    this.orchestrator = orchestrator;
  }

  /**
   * Refresh per-app gauges. Called by the metrics HTTP server before it
   * formats text — keeps the gauges current without instrumenting every
   * status mutation in the orchestrator.
   */
  refreshAppGauges(): void {
    if (!this.orchestrator) return;
    const apps = this.orchestrator.list();
    for (const app of apps) {
      // One gauge series per (app, status) pair — value 1 if the app
      // is currently in that status, else 0. Lets Grafana plot
      // `omnitron_app_status{status="online"}` as a stacked bar.
      for (const status of APP_STATUSES) {
        this.gauge('omnitron_app_status', { app: app.name, status }, app.status === status ? 1 : 0);
      }
      this.gauge('omnitron_app_restarts', { app: app.name }, app.restarts ?? 0);
      this.gauge('omnitron_app_uptime_seconds', { app: app.name }, app.uptime ?? 0);
      if (typeof app.cpu === 'number') {
        this.gauge('omnitron_app_cpu_percent', { app: app.name }, app.cpu);
      }
      if (typeof app.memory === 'number') {
        this.gauge('omnitron_app_memory_bytes', { app: app.name }, app.memory);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Event-driven recorders
  // -------------------------------------------------------------------------

  /** Record a janitor sweep — gauges current orphan/owned counts + bumps total counter. */
  recordJanitorSweep(m: JanitorSweepMetrics): void {
    this.gauge('omnitron_workers_alive', {}, m.forkWorkersAlive);
    this.gauge('omnitron_workers_owned', {}, m.ownedPids);
    this.gauge('omnitron_workers_orphans_pending', {}, m.orphansFound - m.orphansKilled);
    if (m.orphansKilled > 0) {
      this.counter('omnitron_workers_orphans_killed_total', {}, m.orphansKilled);
    }
    if (m.killErrors > 0) {
      this.counter('omnitron_workers_orphan_kill_errors_total', {}, m.killErrors);
    }
  }

  /** Record a ResilientHandle reset — fires once per fatal-error reset across the daemon. */
  recordResilientHandleReset(info: ResetInfo): void {
    this.counter('resilient_handle_resets_total', { name: info.name }, 1);
  }

  /** Record an esbuild build (initial or rebuild). */
  recordEsbuildBuild(app: string, kind: 'build' | 'rebuild', durationMs: number, ok: boolean): void {
    this.histogram('omnitron_esbuild_duration_seconds', { app, kind }, durationMs / 1000);
    this.counter(
      'omnitron_esbuild_builds_total',
      { app, kind, outcome: ok ? 'success' : 'failure' },
      1,
    );
  }

  /** Record an app restart event. Called from orchestrator's `app:restart` listener. */
  recordAppRestart(app: string, attempt: number, reason: 'crash' | 'manual' | 'config'): void {
    this.counter('omnitron_app_restarts_total', { app, reason }, 1);
    this.gauge('omnitron_app_restart_attempt', { app }, attempt);
  }

  /** Record an app crash. */
  recordAppCrash(app: string): void {
    this.counter('omnitron_app_crashes_total', { app }, 1);
  }

  /** Record an app escalation (max restarts exceeded). */
  recordAppEscalated(app: string): void {
    this.counter('omnitron_app_escalations_total', { app }, 1);
  }

  /** Record a lifecycle controller phase event. */
  recordLifecyclePhase(phase: string, durationMs: number, kind: 'finish' | 'timeout'): void {
    this.histogram('lifecycle_shutdown_phase_duration_seconds', { phase }, durationMs / 1000);
    if (kind === 'timeout') {
      this.counter('lifecycle_shutdown_phase_timeouts_total', { phase }, 1);
    }
  }

  /**
   * Permanently drop every sample for a named app from both the in-memory
   * registry and the storage backend. Use when an app is definitively
   * removed (handle replaced under a different canonical name, app
   * un-registered) so it cannot linger as a "ghost offline" in subsequent
   * snapshots.
   *
   * Best-effort: swallowed errors so an eviction failure can never block
   * the orchestrator's primary lifecycle path.
   */
  evictApp(app: string): void {
    void this.metrics.evictApp(app).catch((err) => {
      this.logger?.warn?.({ app, error: (err as Error).message }, 'Failed to evict metrics for app');
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Pre-register every metric this bridge writes. The titan-metrics
   * registry would auto-register them with default help text on first
   * write, but we want stable, descriptive HELP lines and explicit
   * label sets in the Prometheus output.
   */
  private registerDefinitions(): void {
    if (this.definitionsRegistered) return;
    this.definitionsRegistered = true;
    const registry = this.metrics.getRegistry();

    registry.define({
      name: 'omnitron_app_status',
      type: 'gauge',
      help: '1 if the app is currently in the labelled status, else 0',
      labelNames: ['app', 'status'],
    });
    registry.define({
      name: 'omnitron_app_restarts',
      type: 'gauge',
      help: 'Current restart counter for the app (resets on full stop)',
      labelNames: ['app'],
    });
    registry.define({
      name: 'omnitron_app_uptime_seconds',
      type: 'gauge',
      help: 'Seconds since the app last entered the online state',
      labelNames: ['app'],
    });
    registry.define({
      name: 'omnitron_app_cpu_percent',
      type: 'gauge',
      help: 'Last sampled CPU percent for the app',
      labelNames: ['app'],
    });
    registry.define({
      name: 'omnitron_app_memory_bytes',
      type: 'gauge',
      help: 'Last sampled RSS memory for the app',
      labelNames: ['app'],
    });
    registry.define({
      name: 'omnitron_workers_alive',
      type: 'gauge',
      help: 'Total fork-worker processes the daemon can see in `ps`',
    });
    registry.define({
      name: 'omnitron_workers_owned',
      type: 'gauge',
      help: 'Fork-worker pids the daemon has registered as owned',
    });
    registry.define({
      name: 'omnitron_workers_orphans_pending',
      type: 'gauge',
      help: 'Orphan fork-worker pids found in the last sweep but not yet killed',
    });
    registry.define({
      name: 'omnitron_workers_orphans_killed_total',
      type: 'counter',
      help: 'Total fork-worker orphans the janitor has killed',
    });
    registry.define({
      name: 'omnitron_workers_orphan_kill_errors_total',
      type: 'counter',
      help: 'Total errors when the janitor tried to kill an orphan',
    });
    registry.define({
      name: 'resilient_handle_resets_total',
      type: 'counter',
      help: 'ResilientHandle reset count (cached external resource went unhealthy and was re-acquired)',
      labelNames: ['name'],
    });
    registry.define({
      name: 'omnitron_esbuild_duration_seconds',
      type: 'histogram',
      help: 'esbuild build/rebuild duration in seconds',
      labelNames: ['app', 'kind'],
    });
    registry.define({
      name: 'omnitron_esbuild_builds_total',
      type: 'counter',
      help: 'Total esbuild builds and rebuilds, partitioned by outcome',
      labelNames: ['app', 'kind', 'outcome'],
    });
    registry.define({
      name: 'omnitron_app_restarts_total',
      type: 'counter',
      help: 'Total app restarts, partitioned by reason',
      labelNames: ['app', 'reason'],
    });
    registry.define({
      name: 'omnitron_app_restart_attempt',
      type: 'gauge',
      help: 'Most recent restart attempt number for the app',
      labelNames: ['app'],
    });
    registry.define({
      name: 'omnitron_app_crashes_total',
      type: 'counter',
      help: 'Total times the app crashed (process exited with non-zero before going online)',
      labelNames: ['app'],
    });
    registry.define({
      name: 'omnitron_app_escalations_total',
      type: 'counter',
      help: 'Total times the supervisor escalated past max restarts',
      labelNames: ['app'],
    });
    registry.define({
      name: 'lifecycle_shutdown_phase_duration_seconds',
      type: 'histogram',
      help: 'LifecycleController shutdown phase duration in seconds',
      labelNames: ['phase'],
    });
    registry.define({
      name: 'lifecycle_shutdown_phase_timeouts_total',
      type: 'counter',
      help: 'Total LifecycleController phases that hit their timeout',
      labelNames: ['phase'],
    });
  }

  // Thin record helpers — wrap the registry methods so we can swallow
  // unexpected errors (e.g. if the registry was disposed during shutdown
  // mid-scrape) rather than crash the metrics pipeline.
  private gauge(name: string, labels: Record<string, string>, value: number): void {
    try {
      this.metrics.getRegistry().gauge(name, labels, value);
    } catch (err) {
      this.logger?.warn?.({ err, name }, 'metrics-bridge: gauge write failed');
    }
  }

  private counter(name: string, labels: Record<string, string>, delta: number): void {
    try {
      this.metrics.getRegistry().counter(name, labels, delta);
    } catch (err) {
      this.logger?.warn?.({ err, name }, 'metrics-bridge: counter write failed');
    }
  }

  private histogram(name: string, labels: Record<string, string>, value: number): void {
    try {
      this.metrics.getRegistry().histogram(name, labels, value);
    } catch (err) {
      this.logger?.warn?.({ err, name }, 'metrics-bridge: histogram write failed');
    }
  }
}
