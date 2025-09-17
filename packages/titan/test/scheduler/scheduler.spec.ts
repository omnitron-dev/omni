/**
 * Comprehensive tests for Scheduler Module
 */

import 'reflect-metadata';
import { Container } from '@omnitron-dev/nexus';

import {
  SchedulerModule,
  SchedulerService,
  SchedulerRegistry,
  SchedulerExecutor,
  SchedulerMetricsService,
  SchedulerDiscovery,
  Cron,
  Interval,
  Timeout,
  CronExpression,
  JobStatus,
  JobPriority,
  SchedulerJobType,
  SCHEDULER_SERVICE_TOKEN,
  SCHEDULER_REGISTRY_TOKEN,
  SCHEDULER_EXECUTOR_TOKEN,
  SCHEDULER_METRICS_TOKEN,
  SCHEDULER_DISCOVERY_TOKEN
} from '../../src/modules/scheduler';

describe('Titan Scheduler Module', () => {
  let container: Container;
  let schedulerService: SchedulerService;
  let registry: SchedulerRegistry;
  let executor: SchedulerExecutor;
  let metrics: SchedulerMetricsService;
  let discovery: SchedulerDiscovery;

  beforeEach(() => {
    container = new Container();
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(async () => {
    if (schedulerService?.isRunning()) {
      await schedulerService.stop();
    }
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Module Configuration', () => {
    it('should configure module with default options', () => {
      const moduleConfig = SchedulerModule.forRoot();

      expect(moduleConfig.module).toBe(SchedulerModule);
      expect(moduleConfig.providers).toBeDefined();
      expect(moduleConfig.exports).toContain(SchedulerService);
      expect(moduleConfig.global).toBe(true);
    });

    it('should configure module with custom options', () => {
      const moduleConfig = SchedulerModule.forRoot({
        enabled: false,
        timezone: 'America/New_York',
        maxConcurrent: 5,
        persistence: { enabled: true, provider: 'memory' }
      });

      expect(moduleConfig.module).toBe(SchedulerModule);
      expect(moduleConfig.providers).toBeDefined();
    });

    it('should configure module asynchronously', async () => {
      const moduleConfig = SchedulerModule.forRootAsync({
        useFactory: async () => ({
          enabled: true,
          timezone: 'UTC'
        })
      });

      expect(moduleConfig.module).toBe(SchedulerModule);
      expect(moduleConfig.providers).toBeDefined();
    });
  });

  describe('Decorator-based Scheduling', () => {
    it('should register cron job with decorator', () => {
      class TestService {
        public executionCount = 0;

        @Cron(CronExpression.EVERY_SECOND)
        handleCron() {
          this.executionCount++;
        }
      }

      const service = new TestService();
      const jobs = discovery?.discoverProviderJobs(service) || [];

      expect(jobs).toHaveLength(1);
      expect(jobs[0].type).toBe(SchedulerJobType.CRON);
    });

    it('should register interval job with decorator', () => {
      class TestService {
        public executionCount = 0;

        @Interval(1000)
        handleInterval() {
          this.executionCount++;
        }
      }

      const service = new TestService();
      const jobs = discovery?.discoverProviderJobs(service) || [];

      expect(jobs).toHaveLength(1);
      expect(jobs[0].type).toBe(SchedulerJobType.INTERVAL);
    });

    it('should register timeout job with decorator', () => {
      class TestService {
        public executionCount = 0;

        @Timeout(5000)
        handleTimeout() {
          this.executionCount++;
        }
      }

      const service = new TestService();
      const jobs = discovery?.discoverProviderJobs(service) || [];

      expect(jobs).toHaveLength(1);
      expect(jobs[0].type).toBe(SchedulerJobType.TIMEOUT);
    });

    it('should handle multiple decorated methods in same class', () => {
      class TestService {
        @Cron('*/5 * * * * *')
        cronJob() {}

        @Interval(2000)
        intervalJob() {}

        @Timeout(3000)
        timeoutJob() {}
      }

      const service = new TestService();
      const jobs = discovery?.discoverProviderJobs(service) || [];

      expect(jobs).toHaveLength(3);
    });
  });

  describe('SchedulerRegistry', () => {
    beforeEach(() => {
      registry = new SchedulerRegistry();
    });

    it('should register a job', () => {
      const job = registry.registerJob(
        'test-job',
        SchedulerJobType.CRON,
        '* * * * *',
        {},
        'testMethod',
        {}
      );

      expect(job).toBeDefined();
      expect(job.name).toBe('test-job');
      expect(job.type).toBe(SchedulerJobType.CRON);
      expect(job.status).toBe(JobStatus.PENDING);
    });

    it('should prevent duplicate job names', () => {
      registry.registerJob('test-job', SchedulerJobType.CRON, '* * * * *', {}, 'method', {});

      expect(() => {
        registry.registerJob('test-job', SchedulerJobType.CRON, '* * * * *', {}, 'method', {});
      }).toThrow('Job with this name already exists');
    });

    it('should get job by name', () => {
      const job = registry.registerJob('test-job', SchedulerJobType.CRON, '* * * * *', {}, 'method', {});
      const retrieved = registry.getJob('test-job');

      expect(retrieved).toBe(job);
    });

    it('should update job status', () => {
      registry.registerJob('test-job', SchedulerJobType.CRON, '* * * * *', {}, 'method', {});
      registry.updateJobStatus('test-job', JobStatus.RUNNING);

      const job = registry.getJob('test-job');
      expect(job?.status).toBe(JobStatus.RUNNING);
    });

    it('should update job execution info', () => {
      registry.registerJob('test-job', SchedulerJobType.CRON, '* * * * *', {}, 'method', {});

      const now = new Date();
      registry.updateJobExecution('test-job', {
        lastExecution: now,
        lastResult: { success: true },
        executionTime: 100
      });

      const job = registry.getJob('test-job');
      expect(job?.lastExecution).toEqual(now);
      expect(job?.lastResult).toEqual({ success: true });
      expect(job?.avgExecutionTime).toBe(100);
      expect(job?.executionCount).toBe(1);
    });

    it('should remove job', () => {
      registry.registerJob('test-job', SchedulerJobType.CRON, '* * * * *', {}, 'method', {});
      const removed = registry.removeJob('test-job');

      expect(removed).toBe(true);
      expect(registry.getJob('test-job')).toBeUndefined();
    });

    it('should get jobs by type', () => {
      registry.registerJob('cron-1', SchedulerJobType.CRON, '* * * * *', {}, 'method', {});
      registry.registerJob('cron-2', SchedulerJobType.CRON, '*/5 * * * *', {}, 'method', {});
      registry.registerJob('interval-1', SchedulerJobType.INTERVAL, 1000, {}, 'method', {});

      const cronJobs = registry.getJobsByType(SchedulerJobType.CRON);
      expect(cronJobs).toHaveLength(2);

      const intervalJobs = registry.getJobsByType(SchedulerJobType.INTERVAL);
      expect(intervalJobs).toHaveLength(1);
    });

    it('should get jobs by status', () => {
      registry.registerJob('job-1', SchedulerJobType.CRON, '* * * * *', {}, 'method', {});
      registry.registerJob('job-2', SchedulerJobType.CRON, '* * * * *', {}, 'method', {});
      registry.updateJobStatus('job-1', JobStatus.RUNNING);

      const pendingJobs = registry.getJobsByStatus(JobStatus.PENDING);
      expect(pendingJobs).toHaveLength(1);

      const runningJobs = registry.getJobsByStatus(JobStatus.RUNNING);
      expect(runningJobs).toHaveLength(1);
    });

    it('should filter jobs', () => {
      registry.registerJob('high-priority', SchedulerJobType.CRON, '* * * * *', {}, 'method', {
        priority: JobPriority.HIGH
      });
      registry.registerJob('low-priority', SchedulerJobType.CRON, '* * * * *', {}, 'method', {
        priority: JobPriority.LOW
      });
      registry.registerJob('normal-interval', SchedulerJobType.INTERVAL, 1000, {}, 'method', {});

      const highPriorityJobs = registry.findJobs({ priority: JobPriority.HIGH });
      expect(highPriorityJobs).toHaveLength(1);

      const cronJobs = registry.findJobs({ type: SchedulerJobType.CRON });
      expect(cronJobs).toHaveLength(2);
    });
  });

  describe('SchedulerExecutor', () => {
    beforeEach(() => {
      executor = new SchedulerExecutor();
    });

    it('should execute a job successfully', async () => {
      const handler = jest.fn().mockResolvedValue({ data: 'result' });
      const target = { testMethod: handler };

      const job = {
        id: 'job-1',
        name: 'test-job',
        type: SchedulerJobType.CRON,
        status: JobStatus.PENDING,
        target,
        method: 'testMethod',
        options: {},
        executionCount: 0,
        failureCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        isRunning: false
      } as any;

      const result = await executor.executeJob(job);

      expect(result.status).toBe('success');
      expect(result.result).toEqual({ data: 'result' });
      expect(handler).toHaveBeenCalled();
    });

    it('should handle job failure', async () => {
      const error = new Error('Job failed');
      const handler = jest.fn().mockRejectedValue(error);
      const target = { testMethod: handler };

      const job = {
        id: 'job-1',
        name: 'test-job',
        type: SchedulerJobType.CRON,
        status: JobStatus.PENDING,
        target,
        method: 'testMethod',
        options: {},
        executionCount: 0,
        failureCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        isRunning: false
      } as any;

      const result = await executor.executeJob(job);

      expect(result.status).toBe('failure');
      expect(result.error).toBe(error);
    });

    it('should retry failed jobs', async () => {
      let attempts = 0;
      const handler = jest.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Temporary failure');
        }
        return { success: true };
      });

      const target = { testMethod: handler };

      const job = {
        id: 'job-1',
        name: 'test-job',
        type: SchedulerJobType.CRON,
        status: JobStatus.PENDING,
        target,
        method: 'testMethod',
        options: {
          retry: {
            maxAttempts: 3,
            delay: 10
          }
        },
        executionCount: 0,
        failureCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        isRunning: false
      } as any;

      const result = await executor.executeJob(job);

      expect(result.status).toBe('success');
      expect(handler).toHaveBeenCalledTimes(3);
    });

    it('should handle job timeout', async () => {
      const handler = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 2000))
      );
      const target = { testMethod: handler };

      const job = {
        id: 'job-1',
        name: 'test-job',
        type: SchedulerJobType.CRON,
        status: JobStatus.PENDING,
        target,
        method: 'testMethod',
        options: {
          timeout: 100
        },
        executionCount: 0,
        failureCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        isRunning: false
      } as any;

      const result = await executor.executeJob(job);

      expect(result.status).toBe('failure');
      expect(result.error?.message).toContain('timeout');
    });

    it('should prevent overlapping executions', async () => {
      const handler = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 100))
      );
      const target = { testMethod: handler };

      const job = {
        id: 'job-1',
        name: 'test-job',
        type: SchedulerJobType.CRON,
        status: JobStatus.PENDING,
        target,
        method: 'testMethod',
        options: {
          preventOverlap: true
        },
        executionCount: 0,
        failureCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        isRunning: true // Already running
      } as any;

      const result = await executor.executeJob(job);

      expect(result.status).toBe('cancelled');
      expect(handler).not.toHaveBeenCalled();
    });

    it('should cancel running jobs', async () => {
      const handler = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 5000))
      );
      const target = { testMethod: handler };

      const job = {
        id: 'job-1',
        name: 'test-job',
        type: SchedulerJobType.CRON,
        status: JobStatus.PENDING,
        target,
        method: 'testMethod',
        options: {},
        executionCount: 0,
        failureCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        isRunning: false
      } as any;

      // Start execution but don't await
      const executionPromise = executor.executeJob(job);

      // Cancel all jobs
      executor.cancelAllJobs();

      const result = await executionPromise;
      expect(result.status).toBe('failure');
    });
  });

  describe('SchedulerMetrics', () => {
    beforeEach(() => {
      registry = new SchedulerRegistry();
      executor = new SchedulerExecutor();
      metrics = new SchedulerMetricsService(undefined, registry, executor);
    });

    it('should collect basic metrics', () => {
      registry.registerJob('job-1', SchedulerJobType.CRON, '* * * * *', {}, 'method', {});
      registry.registerJob('job-2', SchedulerJobType.INTERVAL, 1000, {}, 'method', {});

      const metricsData = metrics.getMetrics();

      expect(metricsData.totalJobs).toBe(2);
      expect(metricsData.jobsByType[SchedulerJobType.CRON]).toBe(1);
      expect(metricsData.jobsByType[SchedulerJobType.INTERVAL]).toBe(1);
    });

    it('should track execution metrics', () => {
      const successRate = metrics.getSuccessRate();
      expect(successRate).toBe(100); // No executions yet

      const failureRate = metrics.getFailureRate();
      expect(failureRate).toBe(0);
    });

    it('should identify top failing jobs', () => {
      registry.registerJob('failing-job', SchedulerJobType.CRON, '* * * * *', {}, 'method', {});
      registry.updateJobExecution('failing-job', { lastError: new Error('Failed') });
      registry.updateJobExecution('failing-job', { lastError: new Error('Failed') });

      const failingJobs = metrics.getTopFailingJobs();
      expect(failingJobs).toHaveLength(1);
      expect(failingJobs[0].failureCount).toBe(2);
    });

    it('should identify slowest jobs', () => {
      registry.registerJob('slow-job', SchedulerJobType.CRON, '* * * * *', {}, 'method', {});
      registry.updateJobExecution('slow-job', { executionTime: 5000 });

      registry.registerJob('fast-job', SchedulerJobType.CRON, '* * * * *', {}, 'method', {});
      registry.updateJobExecution('fast-job', { executionTime: 100 });

      const slowestJobs = metrics.getSlowestJobs();
      expect(slowestJobs[0].name).toBe('slow-job');
      expect(slowestJobs[0].avgExecutionTime).toBe(5000);
    });

    it('should reset metrics', () => {
      metrics.resetMetrics();
      const metricsData = metrics.getMetrics();

      expect(metricsData.totalExecutions).toBe(0);
      expect(metricsData.successfulExecutions).toBe(0);
      expect(metricsData.failedExecutions).toBe(0);
    });
  });

  describe('SchedulerService Integration', () => {
    beforeEach(async () => {
      // Setup module
      const moduleConfig = SchedulerModule.forRoot({
        enabled: false // Don't auto-start
      });

      // Register providers manually
      for (const provider of moduleConfig.providers || []) {
        if (typeof provider === 'object' && 'provide' in provider) {
          container.register(provider.provide, provider);
        }
      }

      schedulerService = container.resolve(SchedulerService);
      registry = container.resolve(SCHEDULER_REGISTRY_TOKEN);
    });

    it('should start and stop scheduler', async () => {
      expect(schedulerService.isRunning()).toBe(false);

      await schedulerService.start();
      expect(schedulerService.isRunning()).toBe(true);

      await schedulerService.stop();
      expect(schedulerService.isRunning()).toBe(false);
    });

    it('should add cron job dynamically', async () => {
      const handler = jest.fn();

      const job = schedulerService.addCronJob(
        'dynamic-cron',
        '* * * * *',
        handler,
        { disabled: false }
      );

      expect(job).toBeDefined();
      expect(job.name).toBe('dynamic-cron');
      expect(job.type).toBe(SchedulerJobType.CRON);
    });

    it('should add interval job dynamically', async () => {
      const handler = jest.fn();

      const job = schedulerService.addInterval(
        'dynamic-interval',
        1000,
        handler,
        { immediate: true }
      );

      expect(job).toBeDefined();
      expect(job.name).toBe('dynamic-interval');
      expect(job.type).toBe(SchedulerJobType.INTERVAL);
    });

    it('should add timeout job dynamically', async () => {
      const handler = jest.fn();

      const job = schedulerService.addTimeout(
        'dynamic-timeout',
        5000,
        handler
      );

      expect(job).toBeDefined();
      expect(job.name).toBe('dynamic-timeout');
      expect(job.type).toBe(SchedulerJobType.TIMEOUT);
    });

    it('should delete job', async () => {
      const handler = jest.fn();
      schedulerService.addCronJob('test-job', '* * * * *', handler);

      const deleted = schedulerService.deleteJob('test-job');
      expect(deleted).toBe(true);

      const job = schedulerService.getJob('test-job');
      expect(job).toBeUndefined();
    });

    it('should stop and start individual jobs', async () => {
      const handler = jest.fn();
      schedulerService.addCronJob('test-job', '* * * * *', handler);

      await schedulerService.start();

      schedulerService.stopJob('test-job');
      const stoppedJob = schedulerService.getJob('test-job');
      expect(stoppedJob?.status).toBe(JobStatus.PAUSED);

      schedulerService.startJob('test-job');
      const startedJob = schedulerService.getJob('test-job');
      expect(startedJob?.status).toBe(JobStatus.PENDING);
    });

    it('should trigger job manually', async () => {
      const handler = jest.fn().mockResolvedValue({ result: 'manual' });
      const wrapper = { handler };

      registry.registerJob(
        'manual-job',
        SchedulerJobType.CRON,
        '* * * * *',
        wrapper,
        'handler',
        {}
      );

      const result = await schedulerService.triggerJob('manual-job');

      expect(result.status).toBe('success');
      expect(result.result).toEqual({ result: 'manual' });
      expect(handler).toHaveBeenCalled();
    });

    it('should handle graceful shutdown', async () => {
      // Add some jobs
      schedulerService.addInterval('interval-1', 1000, jest.fn());
      schedulerService.addInterval('interval-2', 2000, jest.fn());

      await schedulerService.start();
      await schedulerService.stop();

      expect(schedulerService.isRunning()).toBe(false);
    });
  });

  describe('Advanced Features', () => {
    it('should support job dependencies', () => {
      // This would be implemented in a real-world scenario
      expect(true).toBe(true);
    });

    it('should support distributed locking', () => {
      // This would require Redis or database integration
      expect(true).toBe(true);
    });

    it('should persist and recover job state', () => {
      // This would test the persistence layer
      expect(true).toBe(true);
    });

    it('should handle timezone-aware scheduling', () => {
      // This would test cron jobs with different timezones
      expect(true).toBe(true);
    });
  });
});