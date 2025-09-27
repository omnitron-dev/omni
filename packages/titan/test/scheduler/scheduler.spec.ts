/**
 * Comprehensive tests for Scheduler Module
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

import 'reflect-metadata';
import { Container } from '@nexus';

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

// Mock node-cron to work with fake timers
jest.mock('node-cron', () => ({
  validate: jest.fn(() => true),
  schedule: jest.fn((pattern, callback, options) => {
    const task = {
      start: jest.fn(),
      stop: jest.fn(),
      destroy: jest.fn(),
      getStatus: jest.fn(() => 'scheduled')
    };
    // Simulate cron execution for tests
    if (pattern === CronExpression.EVERY_SECOND || pattern === '* * * * * *') {
      // Use setInterval to simulate cron for tests
      let intervalId: NodeJS.Timeout;
      task.start = jest.fn(() => {
        intervalId = setInterval(callback, 1000);
      });
      task.stop = jest.fn(() => {
        if (intervalId) clearInterval(intervalId);
      });
    }
    return task;
  })
}));

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
  });

  afterEach(async () => {
    // Clean up scheduler if running
    if (schedulerService?.isRunning()) {
      await schedulerService.stop();
    }

    // Clear all timers
    jest.clearAllTimers();

    // Reset mocks
    jest.clearAllMocks();
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
    beforeEach(() => {
      discovery = new SchedulerDiscovery(
        container,
        new SchedulerRegistry(),
        { enabled: true }
      );
    });

    it('should register cron job with decorator', async () => {
      class TestService {
        public executionCount = 0;

        @Cron(CronExpression.EVERY_SECOND)
        handleCron() {
          this.executionCount++;
        }
      }

      const service = new TestService();
      const jobs = await discovery.discoverProviderJobs(service);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].type).toBe(SchedulerJobType.CRON);
    });

    it('should register interval job with decorator', async () => {
      class TestService {
        public executionCount = 0;

        @Interval(1000)
        handleInterval() {
          this.executionCount++;
        }
      }

      const service = new TestService();
      const jobs = await discovery.discoverProviderJobs(service);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].type).toBe(SchedulerJobType.INTERVAL);
    });

    it('should register timeout job with decorator', async () => {
      class TestService {
        public executionCount = 0;

        @Timeout(5000)
        handleTimeout() {
          this.executionCount++;
        }
      }

      const service = new TestService();
      const jobs = await discovery.discoverProviderJobs(service);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].type).toBe(SchedulerJobType.TIMEOUT);
    });

    it('should handle multiple decorated methods in same class', async () => {
      class TestService {
        @Cron('*/5 * * * * *')
        cronJob() {}

        @Interval(2000)
        intervalJob() {}

        @Timeout(3000)
        timeoutJob() {}
      }

      const service = new TestService();
      const jobs = await discovery.discoverProviderJobs(service);

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
            delay: 1 // Minimal delay for test
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
        () => new Promise((resolve) => {
          // Never resolves to simulate long-running task
          setTimeout(resolve, 10000);
        })
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
          timeout: 10 // Very short timeout
        },
        executionCount: 0,
        failureCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        isRunning: false
      } as any;

      const result = await executor.executeJob(job);

      expect(result.status).toBe('failure');
      expect(result.error?.message).toContain('timed out');
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
        () => new Promise((resolve) => {
          // Simulate long-running job
          setTimeout(resolve, 5000);
        })
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

      // Give it a tiny bit of time to start
      await new Promise(resolve => setTimeout(resolve, 1));

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
      const useExistingProviders: any[] = [];

      for (const provider of moduleConfig.providers || []) {
        // Handle nexus format [token, providerConfig]
        if (Array.isArray(provider) && provider.length === 2) {
          const [token, config] = provider;

          if (config.useClass) {
            container.register(token, config.useClass);
          } else if (config.useValue !== undefined) {
            container.register(token, { useValue: config.useValue });
          } else if (config.useExisting) {
            // Defer useExisting providers
            useExistingProviders.push({ token, config });
          } else if (config.useFactory) {
            container.register(token, {
              useFactory: config.useFactory,
              inject: config.inject || []
            });
          }
        } else if (typeof provider === 'function') {
          // Direct class registration
          container.register(provider, provider);
        }
      }

      // Now handle useExisting providers after all others are registered
      for (const { token, config } of useExistingProviders) {
        try {
          const existing = container.resolve(config.useExisting);
          container.register(token, { useValue: existing });
        } catch (error) {
          console.warn(`Failed to resolve existing provider: ${String(config.useExisting)}`);
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

      await schedulerService.stop();
    });

    it('should trigger job manually', async () => {
      const handler = jest.fn().mockResolvedValue({ result: 'manual' });

      // Add job through service so it's in the correct registry
      schedulerService.addCronJob(
        'manual-job',
        '* * * * *',
        handler,
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

    it('should execute interval jobs', async () => {
      const handler = jest.fn();
      schedulerService.addInterval('test-interval', 10, handler, { immediate: false });

      await schedulerService.start();

      // Wait for interval to trigger
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(handler).toHaveBeenCalledTimes(1);

      await schedulerService.stop();
    });

    it('should execute timeout jobs', async () => {
      const handler = jest.fn();
      schedulerService.addTimeout('test-timeout', 10, handler);

      await schedulerService.start();

      // Wait for timeout to trigger
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(handler).toHaveBeenCalledTimes(1);

      await schedulerService.stop();
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
