/**
 * Scheduler Metrics
 *
 * Collects and provides scheduler metrics
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import { Inject, Optional, Injectable } from '../../nexus/index.js';

import {
  SCHEDULER_EVENTS,
  SCHEDULER_CONFIG_TOKEN,
  SCHEDULER_REGISTRY_TOKEN,
  SCHEDULER_EXECUTOR_TOKEN
} from './scheduler.constants.js';
import {
  JobStatus,
  SchedulerJobType,
  type ISchedulerConfig,
  type ISchedulerMetrics,
  type IJobExecutionResult
} from './scheduler.interfaces.js';

import type { SchedulerRegistry } from './scheduler.registry.js';
import type { SchedulerExecutor } from './scheduler.executor.js';

/**
 * Metrics collection service
 */
@Injectable()
export class SchedulerMetricsService {
  private startTime: Date = new Date();
  private totalExecutions = 0;
  private successfulExecutions = 0;
  private failedExecutions = 0;
  private executionTimes: number[] = [];
  private metricsInterval?: any;
  private eventEmitter = new EventEmitter();
  private lastMetricsUpdate: Date = new Date();

  constructor(
    @Optional() @Inject(SCHEDULER_CONFIG_TOKEN) private readonly config?: ISchedulerConfig,
    @Optional() @Inject(SCHEDULER_REGISTRY_TOKEN) private readonly registry?: SchedulerRegistry,
    @Optional() @Inject(SCHEDULER_EXECUTOR_TOKEN) private readonly executor?: SchedulerExecutor
  ) {
    this.setupMetricsCollection();
  }

  /**
   * Setup metrics collection
   */
  private setupMetricsCollection(): void {
    if (!this.config?.metrics?.enabled) {
      return;
    }

    // Subscribe to scheduler events
    if (this.executor) {
      this.executor.on(SCHEDULER_EVENTS.JOB_COMPLETED, ({ result }: { result: IJobExecutionResult }) => {
        this.recordExecution(result);
      });

      this.executor.on(SCHEDULER_EVENTS.JOB_FAILED, ({ error }: { error: Error }) => {
        this.recordFailure();
      });
    }

    // Setup periodic metrics update
    const interval = this.config.metrics.interval || 60000;
    this.metricsInterval = setInterval(() => {
      this.updateMetrics();
    }, interval);
  }

  /**
   * Record job execution
   */
  private recordExecution(result: IJobExecutionResult): void {
    this.totalExecutions++;

    if (result.status === 'success') {
      this.successfulExecutions++;
    } else if (result.status === 'failure') {
      this.failedExecutions++;
    }

    // Record execution time
    if (result.duration) {
      this.executionTimes.push(result.duration);
      // Keep only last 1000 execution times
      if (this.executionTimes.length > 1000) {
        this.executionTimes.shift();
      }
    }
  }

  /**
   * Record job failure
   */
  private recordFailure(): void {
    this.failedExecutions++;
    this.totalExecutions++;
  }

  /**
   * Update metrics
   */
  private updateMetrics(): void {
    const metrics = this.getMetrics();
    this.lastMetricsUpdate = new Date();
    this.eventEmitter.emit(SCHEDULER_EVENTS.METRICS_UPDATED, metrics);
  }

  /**
   * Get current metrics
   */
  getMetrics(): ISchedulerMetrics {
    const jobsByStatus: Record<JobStatus, number> = {
      [JobStatus.PENDING]: 0,
      [JobStatus.RUNNING]: 0,
      [JobStatus.COMPLETED]: 0,
      [JobStatus.FAILED]: 0,
      [JobStatus.CANCELLED]: 0,
      [JobStatus.PAUSED]: 0,
      [JobStatus.RETRYING]: 0
    };

    const jobsByType: Record<SchedulerJobType, number> = {
      [SchedulerJobType.CRON]: 0,
      [SchedulerJobType.INTERVAL]: 0,
      [SchedulerJobType.TIMEOUT]: 0,
      [SchedulerJobType.DELAYED]: 0,
      [SchedulerJobType.RECURRING]: 0
    };

    // Count jobs by status and type
    if (this.registry) {
      for (const status of Object.values(JobStatus)) {
        jobsByStatus[status] = this.registry.getJobCountByStatus(status);
      }

      for (const type of Object.values(SchedulerJobType)) {
        jobsByType[type] = this.registry.getJobCountByType(type);
      }
    }

    // Calculate average execution time
    const avgExecutionTime = this.executionTimes.length > 0
      ? this.executionTimes.reduce((a, b) => a + b, 0) / this.executionTimes.length
      : 0;

    // Calculate uptime
    const uptime = Math.floor((Date.now() - this.startTime.getTime()) / 1000);

    // Get memory usage if enabled
    let memoryUsage;
    if (this.config?.metrics?.includeDetails) {
      const mem = process.memoryUsage();
      memoryUsage = {
        rss: mem.rss,
        heapTotal: mem.heapTotal,
        heapUsed: mem.heapUsed
      };
    }

    return {
      totalJobs: this.registry?.getJobCount() || 0,
      activeJobs: this.executor?.getRunningJobCount() || 0,
      jobsByStatus,
      jobsByType,
      totalExecutions: this.totalExecutions,
      successfulExecutions: this.successfulExecutions,
      failedExecutions: this.failedExecutions,
      avgExecutionTime,
      queueSize: this.executor?.getQueuedJobCount() || 0,
      uptime,
      memoryUsage,
      timestamp: new Date()
    };
  }

  /**
   * Get job-specific metrics
   */
  getJobMetrics(jobName: string): {
    executionCount: number;
    failureCount: number;
    avgExecutionTime: number;
    lastExecution?: Date;
    lastResult?: any;
    lastError?: Error;
  } | null {
    if (!this.registry) {
      return null;
    }

    const job = this.registry.getJob(jobName);
    if (!job) {
      return null;
    }

    return {
      executionCount: job.executionCount,
      failureCount: job.failureCount,
      avgExecutionTime: job.avgExecutionTime || 0,
      lastExecution: job.lastExecution,
      lastResult: job.lastResult,
      lastError: job.lastError
    };
  }

  /**
   * Get success rate
   */
  getSuccessRate(): number {
    if (this.totalExecutions === 0) {
      return 100;
    }
    return (this.successfulExecutions / this.totalExecutions) * 100;
  }

  /**
   * Get failure rate
   */
  getFailureRate(): number {
    if (this.totalExecutions === 0) {
      return 0;
    }
    return (this.failedExecutions / this.totalExecutions) * 100;
  }

  /**
   * Get top failing jobs
   */
  getTopFailingJobs(limit: number = 5): Array<{
    name: string;
    failureCount: number;
    failureRate: number;
  }> {
    if (!this.registry) {
      return [];
    }

    const jobs = this.registry.getAllJobs();
    const failingJobs = jobs
      .filter(job => job.failureCount > 0)
      .map(job => ({
        name: job.name,
        failureCount: job.failureCount,
        failureRate: job.executionCount > 0
          ? (job.failureCount / job.executionCount) * 100
          : 0
      }))
      .sort((a, b) => b.failureCount - a.failureCount)
      .slice(0, limit);

    return failingJobs;
  }

  /**
   * Get slowest jobs
   */
  getSlowestJobs(limit: number = 5): Array<{
    name: string;
    avgExecutionTime: number;
  }> {
    if (!this.registry) {
      return [];
    }

    const jobs = this.registry.getAllJobs();
    const slowestJobs = jobs
      .filter(job => job.avgExecutionTime && job.avgExecutionTime > 0)
      .map(job => ({
        name: job.name,
        avgExecutionTime: job.avgExecutionTime || 0
      }))
      .sort((a, b) => b.avgExecutionTime - a.avgExecutionTime)
      .slice(0, limit);

    return slowestJobs;
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.totalExecutions = 0;
    this.successfulExecutions = 0;
    this.failedExecutions = 0;
    this.executionTimes = [];
    this.startTime = new Date();
  }

  /**
   * Export metrics
   */
  exportMetrics(): {
    metrics: ISchedulerMetrics;
    details: {
      successRate: number;
      failureRate: number;
      topFailingJobs: Array<{ name: string; failureCount: number; failureRate: number }>;
      slowestJobs: Array<{ name: string; avgExecutionTime: number }>;
    };
  } {
    return {
      metrics: this.getMetrics(),
      details: {
        successRate: this.getSuccessRate(),
        failureRate: this.getFailureRate(),
        topFailingJobs: this.getTopFailingJobs(),
        slowestJobs: this.getSlowestJobs()
      }
    };
  }

  /**
   * Subscribe to metrics updates
   */
  onMetricsUpdate(handler: (metrics: ISchedulerMetrics) => void): void {
    this.eventEmitter.on(SCHEDULER_EVENTS.METRICS_UPDATED, handler);
  }

  /**
   * Destroy metrics service
   */
  destroy(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
  }
}