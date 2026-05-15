import { Injectable, Inject, Optional } from '@omnitron-dev/titan/decorators';
import { SCHEDULER_SERVICE_TOKEN, SCHEDULER_METRICS_TOKEN } from './scheduler.constants.js';
import { JobStatus } from './scheduler.interfaces.js';
import type { SchedulerService } from './scheduler.service.js';
import type { SchedulerMetricsService } from './scheduler.metrics.js';

export interface SchedulerHealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  details?: Record<string, unknown>;
}

export interface SchedulerHealthThresholds {
  /** Max tolerable failure rate (0-1, default: 0.1 = 10%) */
  maxFailureRate?: number;
  /** Max tolerable average execution time in ms (default: 5000) */
  maxAvgExecutionTimeMs?: number;
  /** Failure count that triggers unhealthy (default: 5) */
  criticalFailureCount?: number;
}

const DEFAULT_THRESHOLDS: Required<SchedulerHealthThresholds> = {
  maxFailureRate: 0.1,
  maxAvgExecutionTimeMs: 5000,
  criticalFailureCount: 5,
};

@Injectable()
export class SchedulerHealthIndicator {
  readonly name = 'scheduler';

  private readonly thresholds: Required<SchedulerHealthThresholds>;

  constructor(
    @Inject(SCHEDULER_SERVICE_TOKEN) private readonly schedulerService: SchedulerService,
    @Optional() @Inject(SCHEDULER_METRICS_TOKEN) private readonly metricsService?: SchedulerMetricsService,
    thresholds: SchedulerHealthThresholds = {}
  ) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  async check(): Promise<SchedulerHealthCheckResult> {
    try {
      const issues: string[] = [];
      const warnings: string[] = [];

      // Scheduler must be started. Reach the state through the
      // public `isRunning()` accessor; pre-fix this poked at the
      // private `isStarted` field via `as any`, which broke as
      // soon as someone renamed the field and which TypeScript
      // could not catch.
      if (!this.schedulerService.isRunning()) {
        return {
          status: 'unhealthy',
          message: 'Scheduler is not started',
          details: { isStarted: false },
        };
      }

      let details: Record<string, unknown> = { isStarted: true };

      if (this.metricsService) {
        const metrics = this.metricsService.getMetrics();
        const failureRate =
          metrics.totalExecutions > 0 ? metrics.failedExecutions / metrics.totalExecutions : 0;
        const successRate = this.metricsService.getSuccessRate();

        details = {
          ...details,
          totalJobs: metrics.totalJobs,
          activeJobs: metrics.activeJobs,
          queueSize: metrics.queueSize,
          totalExecutions: metrics.totalExecutions,
          successfulExecutions: metrics.successfulExecutions,
          failedExecutions: metrics.failedExecutions,
          failureRate,
          successRate,
          avgExecutionTimeMs: metrics.avgExecutionTime,
          uptimeSeconds: metrics.uptime,
          jobsByStatus: metrics.jobsByStatus,
          thresholds: this.thresholds,
        };

        if (metrics.failedExecutions >= this.thresholds.criticalFailureCount) {
          if (failureRate > this.thresholds.maxFailureRate * 2) {
            issues.push(
              `Critical failure rate: ${(failureRate * 100).toFixed(1)}% over ${metrics.totalExecutions} executions`
            );
          } else {
            warnings.push(
              `Elevated failure rate: ${(failureRate * 100).toFixed(1)}% (${metrics.failedExecutions} failures)`
            );
          }
        }

        if (metrics.avgExecutionTime > this.thresholds.maxAvgExecutionTimeMs) {
          const msg = `High avg execution time: ${metrics.avgExecutionTime.toFixed(0)}ms (threshold: ${this.thresholds.maxAvgExecutionTimeMs}ms)`;
          if (metrics.avgExecutionTime > this.thresholds.maxAvgExecutionTimeMs * 3) {
            issues.push(msg);
          } else {
            warnings.push(msg);
          }
        }

        const runningCount = metrics.jobsByStatus[JobStatus.RUNNING] ?? 0;
        if (runningCount > 0 && metrics.totalJobs > 0) {
          details['runningJobRatio'] = runningCount / metrics.totalJobs;
        }

        const topFailing = this.metricsService.getTopFailingJobs(3);
        if (topFailing.length > 0) {
          details['topFailingJobs'] = topFailing;
        }
      }

      let status: SchedulerHealthCheckResult['status'];
      let message: string;

      if (issues.length > 0) {
        status = 'unhealthy';
        message = issues.join('; ');
      } else if (warnings.length > 0) {
        status = 'degraded';
        message = warnings.join('; ');
      } else {
        const totalJobs = (details['totalJobs'] as number | undefined) ?? 0;
        status = 'healthy';
        message = `Scheduler operating normally. ${totalJobs} registered job(s)`;
      }

      return { status, message, details };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Scheduler health check failed: ${error instanceof Error ? error.message : String(error)}`,
        details: { error: String(error) },
      };
    }
  }

  async isHealthy(): Promise<boolean> {
    const result = await this.check();
    return result.status === 'healthy';
  }
}
