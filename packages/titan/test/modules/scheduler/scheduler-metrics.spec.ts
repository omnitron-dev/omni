/**
 * Scheduler Metrics Comprehensive Tests
 * Tests metrics collection, aggregation, and reporting
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { SchedulerMetricsService } from '../../../src/modules/scheduler/scheduler.metrics.js';
import { SchedulerRegistry } from '../../../src/modules/scheduler/scheduler.registry.js';
import { SchedulerExecutor } from '../../../src/modules/scheduler/scheduler.executor.js';
import { SCHEDULER_EVENTS } from '../../../src/modules/scheduler/scheduler.constants.js';
import { JobStatus, SchedulerJobType } from '../../../src/modules/scheduler/scheduler.interfaces.js';
import type { ISchedulerConfig, IScheduledJob, IJobExecutionResult } from '../../../src/modules/scheduler/scheduler.interfaces.js';

describe('Scheduler Metrics', () => {
  let metrics: SchedulerMetricsService;
  let registry: SchedulerRegistry;
  let executor: SchedulerExecutor;

  const config: ISchedulerConfig = {
    metrics: {
      enabled: true,
      interval: 60000,
      includeDetails: true,
    },
  };

  beforeEach(() => {
    registry = new SchedulerRegistry(config);
    executor = new SchedulerExecutor(config);
    metrics = new SchedulerMetricsService(config, registry, executor);
  });

  afterEach(() => {
    metrics.destroy();
  });

  describe('Metrics Collection', () => {
    it('should initialize with zero counters', () => {
      const currentMetrics = metrics.getMetrics();

      expect(currentMetrics.totalExecutions).toBe(0);
      expect(currentMetrics.successfulExecutions).toBe(0);
      expect(currentMetrics.failedExecutions).toBe(0);
    });

    it('should track total jobs from registry', () => {
      registry.registerJob('job1', SchedulerJobType.CRON, '* * * * *', {}, 'run', {});
      registry.registerJob('job2', SchedulerJobType.INTERVAL, 1000, {}, 'run', {});

      const currentMetrics = metrics.getMetrics();
      expect(currentMetrics.totalJobs).toBe(2);
    });

    it('should track jobs by status', () => {
      registry.registerJob('job1', SchedulerJobType.CRON, '* * * * *', {}, 'run', {});
      registry.registerJob('job2', SchedulerJobType.INTERVAL, 1000, {}, 'run', {});
      
      registry.updateJobStatus('job1', JobStatus.RUNNING);
      registry.updateJobStatus('job2', JobStatus.COMPLETED);

      const currentMetrics = metrics.getMetrics();
      expect(currentMetrics.jobsByStatus[JobStatus.RUNNING]).toBe(1);
      expect(currentMetrics.jobsByStatus[JobStatus.COMPLETED]).toBe(1);
      expect(currentMetrics.jobsByStatus[JobStatus.PENDING]).toBe(0);
    });

    it('should track jobs by type', () => {
      registry.registerJob('cron1', SchedulerJobType.CRON, '* * * * *', {}, 'run', {});
      registry.registerJob('cron2', SchedulerJobType.CRON, '0 0 * * *', {}, 'run', {});
      registry.registerJob('interval1', SchedulerJobType.INTERVAL, 1000, {}, 'run', {});

      const currentMetrics = metrics.getMetrics();
      expect(currentMetrics.jobsByType[SchedulerJobType.CRON]).toBe(2);
      expect(currentMetrics.jobsByType[SchedulerJobType.INTERVAL]).toBe(1);
      expect(currentMetrics.jobsByType[SchedulerJobType.TIMEOUT]).toBe(0);
    });

    it('should include timestamp in metrics', () => {
      const currentMetrics = metrics.getMetrics();
      expect(currentMetrics.timestamp).toBeInstanceOf(Date);
    });

    it('should calculate uptime', async () => {
      await new Promise(resolve => setTimeout(resolve, 1100));

      const currentMetrics = metrics.getMetrics();
      expect(currentMetrics.uptime).toBeGreaterThan(0);
    });

    it('should include memory usage when details enabled', () => {
      const currentMetrics = metrics.getMetrics();
      
      expect(currentMetrics.memoryUsage).toBeDefined();
      expect(currentMetrics.memoryUsage?.rss).toBeGreaterThan(0);
      expect(currentMetrics.memoryUsage?.heapTotal).toBeGreaterThan(0);
      expect(currentMetrics.memoryUsage?.heapUsed).toBeGreaterThan(0);
    });

    it('should not include memory usage when details disabled', () => {
      const configWithoutDetails: ISchedulerConfig = {
        metrics: { enabled: true, includeDetails: false },
      };
      const metricsWithoutDetails = new SchedulerMetricsService(configWithoutDetails);

      const currentMetrics = metricsWithoutDetails.getMetrics();
      expect(currentMetrics.memoryUsage).toBeUndefined();

      metricsWithoutDetails.destroy();
    });
  });

  describe('Execution Tracking', () => {
    it('should track successful executions', () => {
      const result: IJobExecutionResult = {
        jobId: 'job-1',
        executionId: 'exec-1',
        status: 'success',
        result: 'test',
        duration: 100,
        timestamp: new Date(),
      };

      executor.emit(SCHEDULER_EVENTS.JOB_COMPLETED, { result });

      const currentMetrics = metrics.getMetrics();
      expect(currentMetrics.successfulExecutions).toBe(1);
      expect(currentMetrics.totalExecutions).toBe(1);
    });

    it('should track failed executions', () => {
      const result: IJobExecutionResult = {
        jobId: 'job-1',
        executionId: 'exec-1',
        status: 'failure',
        error: new Error('Test error'),
        duration: 50,
        timestamp: new Date(),
      };

      executor.emit(SCHEDULER_EVENTS.JOB_COMPLETED, { result });

      const currentMetrics = metrics.getMetrics();
      expect(currentMetrics.failedExecutions).toBe(1);
      expect(currentMetrics.totalExecutions).toBe(1);
    });

    it('should track multiple executions', () => {
      for (let i = 0; i < 5; i++) {
        executor.emit(SCHEDULER_EVENTS.JOB_COMPLETED, {
          result: {
            jobId: `job-${i}`,
            executionId: `exec-${i}`,
            status: 'success',
            duration: 100,
            timestamp: new Date(),
          },
        });
      }

      const currentMetrics = metrics.getMetrics();
      expect(currentMetrics.totalExecutions).toBe(5);
      expect(currentMetrics.successfulExecutions).toBe(5);
    });

    it('should calculate average execution time', () => {
      const durations = [100, 200, 300];
      
      durations.forEach((duration, i) => {
        executor.emit(SCHEDULER_EVENTS.JOB_COMPLETED, {
          result: {
            jobId: `job-${i}`,
            executionId: `exec-${i}`,
            status: 'success',
            duration,
            timestamp: new Date(),
          },
        });
      });

      const currentMetrics = metrics.getMetrics();
      expect(currentMetrics.avgExecutionTime).toBe(200);
    });

    it('should limit execution time history to 1000 entries', () => {
      for (let i = 0; i < 1500; i++) {
        executor.emit(SCHEDULER_EVENTS.JOB_COMPLETED, {
          result: {
            jobId: `job-${i}`,
            executionId: `exec-${i}`,
            status: 'success',
            duration: 100,
            timestamp: new Date(),
          },
        });
      }

      const currentMetrics = metrics.getMetrics();
      expect(currentMetrics.totalExecutions).toBe(1500);
      // Average should still be calculated correctly from last 1000
      expect(currentMetrics.avgExecutionTime).toBe(100);
    });
  });

  describe('Success and Failure Rates', () => {
    it('should calculate 100% success rate with no failures', () => {
      for (let i = 0; i < 10; i++) {
        executor.emit(SCHEDULER_EVENTS.JOB_COMPLETED, {
          result: {
            jobId: `job-${i}`,
            executionId: `exec-${i}`,
            status: 'success',
            duration: 100,
            timestamp: new Date(),
          },
        });
      }

      expect(metrics.getSuccessRate()).toBe(100);
      expect(metrics.getFailureRate()).toBe(0);
    });

    it('should calculate correct success/failure rates', () => {
      // 7 successes
      for (let i = 0; i < 7; i++) {
        executor.emit(SCHEDULER_EVENTS.JOB_COMPLETED, {
          result: {
            jobId: `success-${i}`,
            executionId: `exec-${i}`,
            status: 'success',
            duration: 100,
            timestamp: new Date(),
          },
        });
      }

      // 3 failures
      for (let i = 0; i < 3; i++) {
        executor.emit(SCHEDULER_EVENTS.JOB_COMPLETED, {
          result: {
            jobId: `failure-${i}`,
            executionId: `exec-fail-${i}`,
            status: 'failure',
            error: new Error('Test'),
            duration: 50,
            timestamp: new Date(),
          },
        });
      }

      expect(metrics.getSuccessRate()).toBe(70);
      expect(metrics.getFailureRate()).toBe(30);
    });

    it('should return 100% success rate when no executions', () => {
      expect(metrics.getSuccessRate()).toBe(100);
      expect(metrics.getFailureRate()).toBe(0);
    });
  });

  describe('Job-Specific Metrics', () => {
    it('should get metrics for specific job', () => {
      const job: IScheduledJob = registry.registerJob(
        'test-job',
        SchedulerJobType.CRON,
        '* * * * *',
        {},
        'run',
        {}
      );

      registry.updateJobExecution('test-job', {
        lastExecution: new Date(),
        lastResult: 'success',
        executionTime: 150,
      });

      const jobMetrics = metrics.getJobMetrics('test-job');

      expect(jobMetrics).toBeDefined();
      expect(jobMetrics?.executionCount).toBe(1);
      expect(jobMetrics?.lastResult).toBe('success');
    });

    it('should return null for non-existent job', () => {
      const jobMetrics = metrics.getJobMetrics('non-existent');
      expect(jobMetrics).toBeNull();
    });

    it('should track job execution count', () => {
      registry.registerJob('tracked-job', SchedulerJobType.INTERVAL, 1000, {}, 'run', {});

      for (let i = 0; i < 5; i++) {
        registry.updateJobExecution('tracked-job', {
          lastExecution: new Date(),
        });
      }

      const jobMetrics = metrics.getJobMetrics('tracked-job');
      expect(jobMetrics?.executionCount).toBe(5);
    });

    it('should track job failure count', () => {
      registry.registerJob('failing-job', SchedulerJobType.CRON, '* * * * *', {}, 'run', {});

      for (let i = 0; i < 3; i++) {
        registry.updateJobExecution('failing-job', {
          lastError: new Error('Test error'),
        });
      }

      const jobMetrics = metrics.getJobMetrics('failing-job');
      expect(jobMetrics?.failureCount).toBe(3);
    });
  });

  describe('Top Failing Jobs', () => {
    beforeEach(() => {
      registry.registerJob('job1', SchedulerJobType.CRON, '* * * * *', {}, 'run', {});
      registry.registerJob('job2', SchedulerJobType.INTERVAL, 1000, {}, 'run', {});
      registry.registerJob('job3', SchedulerJobType.TIMEOUT, 5000, {}, 'run', {});

      // Job1: 5 executions, 2 failures
      for (let i = 0; i < 3; i++) {
        registry.updateJobExecution('job1', { lastExecution: new Date() });
      }
      for (let i = 0; i < 2; i++) {
        registry.updateJobExecution('job1', { lastError: new Error('Failure') });
      }

      // Job2: 10 executions, 5 failures
      for (let i = 0; i < 5; i++) {
        registry.updateJobExecution('job2', { lastExecution: new Date() });
      }
      for (let i = 0; i < 5; i++) {
        registry.updateJobExecution('job2', { lastError: new Error('Failure') });
      }

      // Job3: 2 executions, 1 failure
      registry.updateJobExecution('job3', { lastExecution: new Date() });
      registry.updateJobExecution('job3', { lastError: new Error('Failure') });
    });

    it('should get top failing jobs', () => {
      const topFailing = metrics.getTopFailingJobs(5);

      expect(topFailing).toHaveLength(3);
      expect(topFailing[0].name).toBe('job2');
      expect(topFailing[0].failureCount).toBe(5);
    });

    it('should calculate failure rates', () => {
      const topFailing = metrics.getTopFailingJobs();

      const job2 = topFailing.find(j => j.name === 'job2');
      expect(job2?.failureRate).toBe(50); // 5 failures out of 10 executions
    });

    it('should respect limit parameter', () => {
      const topFailing = metrics.getTopFailingJobs(2);
      expect(topFailing).toHaveLength(2);
    });

    it('should sort by failure count descending', () => {
      const topFailing = metrics.getTopFailingJobs();

      expect(topFailing[0].failureCount).toBeGreaterThanOrEqual(topFailing[1].failureCount);
      expect(topFailing[1].failureCount).toBeGreaterThanOrEqual(topFailing[2].failureCount);
    });
  });

  describe('Slowest Jobs', () => {
    beforeEach(() => {
      registry.registerJob('fast-job', SchedulerJobType.CRON, '* * * * *', {}, 'run', {});
      registry.registerJob('medium-job', SchedulerJobType.INTERVAL, 1000, {}, 'run', {});
      registry.registerJob('slow-job', SchedulerJobType.TIMEOUT, 5000, {}, 'run', {});

      registry.updateJobExecution('fast-job', {
        lastExecution: new Date(),
        executionTime: 50,
      });
      registry.updateJobExecution('medium-job', {
        lastExecution: new Date(),
        executionTime: 200,
      });
      registry.updateJobExecution('slow-job', {
        lastExecution: new Date(),
        executionTime: 500,
      });
    });

    it('should get slowest jobs', () => {
      const slowest = metrics.getSlowestJobs(5);

      expect(slowest).toHaveLength(3);
      expect(slowest[0].name).toBe('slow-job');
      expect(slowest[0].avgExecutionTime).toBe(500);
    });

    it('should respect limit parameter', () => {
      const slowest = metrics.getSlowestJobs(2);
      expect(slowest).toHaveLength(2);
    });

    it('should sort by execution time descending', () => {
      const slowest = metrics.getSlowestJobs();

      expect(slowest[0].avgExecutionTime).toBeGreaterThanOrEqual(slowest[1].avgExecutionTime);
      expect(slowest[1].avgExecutionTime).toBeGreaterThanOrEqual(slowest[2].avgExecutionTime);
    });

    it('should exclude jobs without execution time', () => {
      registry.registerJob('never-run', SchedulerJobType.CRON, '* * * * *', {}, 'run', {});

      const slowest = metrics.getSlowestJobs();
      
      expect(slowest.find(j => j.name === 'never-run')).toBeUndefined();
    });
  });

  describe('Metrics Export', () => {
    beforeEach(() => {
      registry.registerJob('job1', SchedulerJobType.CRON, '* * * * *', {}, 'run', {});
      
      executor.emit(SCHEDULER_EVENTS.JOB_COMPLETED, {
        result: {
          jobId: 'job1',
          executionId: 'exec-1',
          status: 'success',
          duration: 100,
          timestamp: new Date(),
        },
      });
    });

    it('should export complete metrics', () => {
      const exported = metrics.exportMetrics();

      expect(exported.metrics).toBeDefined();
      expect(exported.details).toBeDefined();
      expect(exported.details.successRate).toBeDefined();
      expect(exported.details.failureRate).toBeDefined();
      expect(exported.details.topFailingJobs).toBeDefined();
      expect(exported.details.slowestJobs).toBeDefined();
    });

    it('should include current metrics', () => {
      const exported = metrics.exportMetrics();

      expect(exported.metrics.totalJobs).toBeGreaterThan(0);
      expect(exported.metrics.totalExecutions).toBeGreaterThan(0);
    });

    it('should include analysis details', () => {
      const exported = metrics.exportMetrics();

      expect(exported.details.successRate).toBe(100);
      expect(exported.details.topFailingJobs).toBeInstanceOf(Array);
      expect(exported.details.slowestJobs).toBeInstanceOf(Array);
    });
  });

  describe('Metrics Reset', () => {
    it('should reset execution counters', () => {
      executor.emit(SCHEDULER_EVENTS.JOB_COMPLETED, {
        result: {
          jobId: 'job-1',
          executionId: 'exec-1',
          status: 'success',
          duration: 100,
          timestamp: new Date(),
        },
      });

      metrics.resetMetrics();

      const currentMetrics = metrics.getMetrics();
      expect(currentMetrics.totalExecutions).toBe(0);
      expect(currentMetrics.successfulExecutions).toBe(0);
      expect(currentMetrics.failedExecutions).toBe(0);
    });

    it('should reset execution time history', () => {
      executor.emit(SCHEDULER_EVENTS.JOB_COMPLETED, {
        result: {
          jobId: 'job-1',
          executionId: 'exec-1',
          status: 'success',
          duration: 100,
          timestamp: new Date(),
        },
      });

      metrics.resetMetrics();

      const currentMetrics = metrics.getMetrics();
      expect(currentMetrics.avgExecutionTime).toBe(0);
    });

    it('should reset start time', async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      
      metrics.resetMetrics();
      
      const currentMetrics = metrics.getMetrics();
      expect(currentMetrics.uptime).toBeLessThan(1);
    });
  });

  describe('Metrics Update Events', () => {
    it('should emit metrics update event', (done) => {
      const handler = jest.fn();
      metrics.onMetricsUpdate(handler);

      // Manually trigger update
      metrics['updateMetrics']();

      setTimeout(() => {
        expect(handler).toHaveBeenCalled();
        done();
      }, 100);
    });

    it('should include metrics in update event', (done) => {
      metrics.onMetricsUpdate((m) => {
        expect(m.timestamp).toBeInstanceOf(Date);
        expect(m.totalJobs).toBeDefined();
        done();
      });

      metrics['updateMetrics']();
    });
  });

  describe('Cleanup', () => {
    it('should clear update interval on destroy', () => {
      const metricsWithInterval = new SchedulerMetricsService(config);
      
      metricsWithInterval.destroy();
      
      // Metrics should no longer update
      expect(() => metricsWithInterval.destroy()).not.toThrow();
    });
  });
});
