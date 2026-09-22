/**
 * DaemonScheduler — Periodic daemon tasks via titan-scheduler
 *
 * Jobs:
 *   - Session cleanup (5 min) — master only
 *   - Metrics collection (configurable, default 5s) — uses titan-metrics
 *   - Alert evaluation (30s) — master only
 *   - Fleet heartbeat sweep (30s) — master only
 *   - Log rotation check (60s)
 *   - Metrics replication (configurable) — slave only
 */

import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { IMetricsService } from '@omnitron-dev/titan-metrics';
import type { OrchestratorService } from '../orchestrator/orchestrator.service.js';
import type { AuthService } from '../services/auth.service.js';
import type { AlertService } from '../services/alert.service.js';
import type { FleetService } from '../services/fleet.service.js';
import type { LogManager } from '../monitoring/log-manager.js';
import type { InfrastructureService } from '../infrastructure/infrastructure.service.js';
import type { SchedulerService } from '@omnitron-dev/titan-scheduler';
import type { SyncService } from '../services/sync.service.js';

export function registerDaemonJobs(
  scheduler: SchedulerService,
  deps: {
    logger: ILogger;
    orchestrator: OrchestratorService;
    authService: AuthService | null;
    metricsService: IMetricsService;
    alertService: AlertService | null;
    fleetService: FleetService | null;
    logManager: LogManager;
    infraService: InfrastructureService | null;
    /** Slave-side replication. Null on a master — there is no master to ship to. */
    syncService: SyncService | null;
    metricsInterval: number;
    healthCheckInterval: number;
  }
): void {
  const { logger, orchestrator, authService, metricsService, alertService, fleetService, logManager, syncService } = deps;
  const jobs: string[] = [];
  // Three of the five jobs below register only when an optional service is
  // present — all of them "master only, requires PG". The log line at the end
  // used to name what DID register, which tells a reader five without telling
  // them whether five is all of them. A job that never registers is a sweep
  // that never runs, and this platform has already paid for one of those going
  // unnoticed for four months.
  const skipped: Array<{ job: string; because: string }> = [];

  // Session cleanup — every 5 minutes (master only — requires PG)
  if (authService) {
    scheduler.addInterval('session-cleanup', 5 * 60 * 1000, async () => {
      try {
        const removed = await authService.cleanupExpiredSessions();
        if (removed > 0) logger.debug({ removed }, 'Cleaned up expired sessions');
      } catch (err) {
        logger.warn({ error: (err as Error).message }, 'Session cleanup failed');
      }
    });
    jobs.push('session-cleanup');
  } else {
    skipped.push({ job: 'session-cleanup', because: 'no auth service (master only — requires PG)' });
  }

  // Metrics collection — poll app state and record via titan-metrics
  scheduler.addInterval('metrics-collection', deps.metricsInterval, async () => {
    try {
      const appList = orchestrator.list();
      const now = Date.now();

      for (const app of appList) {
        const labels = { app: app.name };

        metricsService.record({ name: 'cpu_percent', value: app.cpu, timestamp: now, labels });
        metricsService.record({ name: 'memory_bytes', value: app.memory, timestamp: now, labels });
        metricsService.record({ name: 'app_status', value: app.status === 'online' ? 1 : 0, timestamp: now, labels });
        metricsService.record({ name: 'app_restarts', value: app.restarts, timestamp: now, labels });
        metricsService.record({ name: 'app_instances', value: app.instances, timestamp: now, labels });
      }

      // Drain rich MetricSample[] from child MetricsCollectors (push-via-pull)
      try {
        const childBatches = await orchestrator.drainChildSamples();
        for (const batch of childBatches) {
          metricsService.recordBatch(batch.samples);
        }
      } catch {
        // Children may not support __drainMetrics yet — silently skip
      }
    } catch {
      // Non-critical
    }
  });
  jobs.push('metrics-collection');

  // Alert evaluation (master only — requires PG)
  if (alertService) {
    scheduler.addInterval('alert-evaluation', deps.healthCheckInterval, async () => {
      try {
        await alertService.evaluate();
      } catch (err) {
        logger.warn({ error: (err as Error).message }, 'Alert evaluation failed');
      }
    });
    jobs.push('alert-evaluation');
  } else {
    skipped.push({ job: 'alert-evaluation', because: 'no alert service (master only — requires PG)' });
  }

  // Fleet heartbeat (master only — requires PG): keeps this daemon's own row
  // in `nodes` current.
  //
  // It sent `selfNodeId ?? 'self'`, and the id was never set on a default
  // master, so every interval ran `UPDATE nodes … WHERE id = 'self'` against a
  // uuid column and failed — 119 times in 30 minutes on 2026-09-22 — inside a
  // `catch` that said «non-critical» and nothing else. The job had never
  // written a row. A problem is said once at warn and quietly after, and a
  // heartbeat that succeeds clears it, so one that comes BACK is said again.
  if (fleetService) {
    let lastProblem: string | null = null;
    const problem = (msg: string, fields: Record<string, unknown>) => {
      const key = `${msg} ${String(fields['error'] ?? '')}`;
      if (lastProblem === key) {
        logger.debug(fields, msg);
        return;
      }
      lastProblem = key;
      logger.warn(fields, msg);
    };
    scheduler.addInterval('fleet-heartbeat', deps.healthCheckInterval, async () => {
      const nodeId = fleetService.selfNodeId;
      if (!nodeId) {
        problem('Fleet heartbeat has nothing to beat — this daemon has not registered itself', {});
        return;
      }
      try {
        const reached = await fleetService.heartbeat(nodeId);
        if (reached === 0) {
          problem("Fleet heartbeat reached no row — this daemon's registration is gone", { nodeId });
          return;
        }
        lastProblem = null;
      } catch (err) {
        problem('Fleet heartbeat failed', { nodeId, error: (err as Error).message });
      }
    });
    jobs.push('fleet-heartbeat');
  } else {
    skipped.push({ job: 'fleet-heartbeat', because: 'no fleet service (master only — requires PG)' });
  }

  // Log rotation check — every 60s
  scheduler.addInterval('log-rotation', 60_000, () => {
    try {
      logManager.checkRotation('omnitron');
    } catch {
      // Non-critical
    }
  });
  jobs.push('log-rotation');

  // Metrics replication — slave only.
  //
  // A slave records its metrics into the same titan-metrics storage a master
  // uses, and shipped **none** of them: `SyncService.buffer`/`bufferBatch`
  // had zero callers, so the whole replication path — WAL, backoff, the
  // master's dedup ledger — moved nothing. This is the producer it lacked.
  //
  // The samples are read back out of local storage rather than intercepted at
  // record time. That reuses one store instead of teeing every call site into
  // a second, and it means only samples that were actually PERSISTED locally
  // are replicated — the master cannot end up holding a reading this node
  // does not.
  //
  // The watermark, and what it does NOT promise. titan-metrics buffers
  // samples and flushes them on its own timer, so a sample stamped T becomes
  // queryable some time after T. Advancing the watermark to "now" would skip
  // everything still in that buffer. So the cutoff trails real time by
  // `REPLICATION_LAG_MS`, and the watermark never moves past it. A sample
  // that takes longer than the lag to become queryable is NOT replicated:
  // this is at-most-once past the lag, not exactly-once, and it is written
  // down because the alternative — re-reading an overlapping window — would
  // duplicate rows on the master, whose ledger keys on the buffer entry id
  // and not on (name, app, labels, timestamp).
  if (syncService) {
    const REPLICATION_LAG_MS = Math.max(3 * deps.metricsInterval, 30_000);
    let watermark = Date.now() - REPLICATION_LAG_MS;

    scheduler.addInterval('metrics-replication', Math.max(deps.metricsInterval, 10_000), async () => {
      const cutoff = Date.now() - REPLICATION_LAG_MS;
      if (cutoff <= watermark) return;

      try {
        const series = await metricsService.querySeries({ from: watermark, to: cutoff });
        const entries = series.flatMap((serie) =>
          serie.points
            .filter((point) => point.timestamp > watermark && point.timestamp <= cutoff)
            .map((point) => ({
              category: 'metrics' as const,
              payload: {
                name: serie.name,
                app: serie.app,
                labels: serie.labels,
                value: point.value,
                timestamp: point.timestamp,
              },
            })),
        );

        if (entries.length > 0) await syncService.bufferBatch(entries);
        // Advanced only after the batch is buffered. A throw leaves the
        // watermark where it was, so the next tick re-reads the same window
        // rather than stepping over it — the one case where re-reading is
        // right, because nothing was queued.
        watermark = cutoff;
        if (entries.length > 0) logger.debug({ count: entries.length }, 'Queued metric samples for the master');
      } catch (err) {
        logger.error(
          { error: (err as Error).message, since: new Date(watermark).toISOString() },
          'Metrics replication tick failed — samples since this point have not been queued',
        );
      }
    });
    jobs.push('metrics-replication');
  } else {
    skipped.push({ job: 'metrics-replication', because: 'master role — no master to replicate to' });
  }

  logger.info({ jobs }, 'Daemon scheduler jobs registered');
  if (skipped.length > 0) {
    logger.info({ skipped }, `${skipped.length} daemon job(s) not registered — their service is absent`);
  }
}
