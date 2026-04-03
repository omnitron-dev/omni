/**
 * DaemonScheduler — Periodic daemon tasks via titan-scheduler
 *
 * Jobs:
 *   - Session cleanup (5 min) — master only
 *   - Metrics collection (configurable, default 5s) — uses titan-metrics
 *   - Alert evaluation (30s) — master only
 *   - Fleet heartbeat sweep (30s) — master only
 *   - Log rotation check (60s)
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
    metricsInterval: number;
    healthCheckInterval: number;
  }
): void {
  const { logger, orchestrator, authService, metricsService, alertService, fleetService, logManager } = deps;
  const jobs: string[] = [];

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
  }

  // Fleet heartbeat sweep (master only — requires PG)
  if (fleetService) {
    scheduler.addInterval('fleet-heartbeat', deps.healthCheckInterval, async () => {
      try {
        await fleetService.heartbeat(fleetService.selfNodeId ?? 'self');
      } catch {
        // Non-critical
      }
    });
    jobs.push('fleet-heartbeat');
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

  logger.info({ jobs }, 'Daemon scheduler jobs registered');
}
