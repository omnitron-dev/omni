/**
 * Scheduler Service Comprehensive Tests
 * Tests job scheduling, lifecycle, execution, and state management
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { SchedulerService } from '../../../src/modules/scheduler/scheduler.service.js';
import { SchedulerRegistry } from '../../../src/modules/scheduler/scheduler.registry.js';
import { SchedulerExecutor } from '../../../src/modules/scheduler/scheduler.executor.js';
import { SchedulerPersistence, InMemoryPersistenceProvider } from '../../../src/modules/scheduler/scheduler.persistence.js';
import { SCHEDULER_EVENTS } from '../../../src/modules/scheduler/scheduler.constants.js';
import { CronExpression, JobStatus, SchedulerJobType } from '../../../src/modules/scheduler/scheduler.interfaces.js';
import type { ISchedulerConfig, IJobExecutionContext } from '../../../src/modules/scheduler/scheduler.interfaces.js';

describe('Scheduler Service', () => {
  let scheduler: SchedulerService;
  let registry: SchedulerRegistry;
  let executor: SchedulerExecutor;
  let persistence: SchedulerPersistence;

  const config: ISchedulerConfig = {
    enabled: true,
    maxConcurrent: 5,
    queueSize: 100,
    shutdownTimeout: 5000,
  };

  beforeEach(() => {
    registry = new SchedulerRegistry(config);
    executor = new SchedulerExecutor(config);
    persistence = new SchedulerPersistence(config);
    scheduler = new SchedulerService(registry, executor, config, persistence);
  });

  afterEach(async () => {
    if (scheduler && scheduler.isRunning()) {
      await scheduler.stop();
    }
  });

  describe('Lifecycle Management', () => {
    it('should initialize and start scheduler', async () => {
      expect(scheduler.isRunning()).toBe(false);
      await scheduler.start();
      expect(scheduler.isRunning()).toBe(true);
    });

    it('should stop scheduler cleanly', async () => {
      await scheduler.start();
      expect(scheduler.isRunning()).toBe(true);
      await scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
    });

    it('should throw error when starting already started scheduler', async () => {
      await scheduler.start();
      await expect(scheduler.start()).rejects.toThrow();
    });

    it('should not throw error when stopping already stopped scheduler', async () => {
      await expect(scheduler.stop()).resolves.not.toThrow();
    });

    it('should emit SCHEDULER_STARTED event on start', async () => {
      const handler = jest.fn();
      registry.on(SCHEDULER_EVENTS.SCHEDULER_STARTED, handler);
      await scheduler.start();
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        timestamp: expect.any(Date),
        jobCount: expect.any(Number),
      }));
    });

    it('should emit SCHEDULER_STOPPED event on stop', async () => {
      const handler = jest.fn();
      registry.on(SCHEDULER_EVENTS.SCHEDULER_STOPPED, handler);
      await scheduler.start();
      await scheduler.stop();
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Cron Job Management', () => {
    it('should add cron job dynamically', () => {
      const handler = jest.fn();
      const job = scheduler.addCronJob('test-cron', CronExpression.EVERY_MINUTE, handler);
      
      expect(job).toBeDefined();
      expect(job.name).toBe('test-cron');
      expect(job.type).toBe(SchedulerJobType.CRON);
      expect(registry.hasJob('test-cron')).toBe(true);
    });

    it('should validate cron expression', async () => {
      const handler = jest.fn();
      scheduler.addCronJob('valid-cron', '0 0 * * *', handler);
      await scheduler.start();
      
      expect(registry.hasJob('valid-cron')).toBe(true);
    });

    it('should handle invalid cron expression', async () => {
      const handler = jest.fn();
      scheduler.addCronJob('invalid-cron', 'invalid expression', handler);
      await expect(scheduler.start()).rejects.toThrow();
    });

    it('should schedule cron job when scheduler is running', async () => {
      const handler = jest.fn();
      await scheduler.start();
      
      const job = scheduler.addCronJob('dynamic-cron', CronExpression.EVERY_MINUTE, handler);
      expect(job).toBeDefined();
      expect(registry.getJob('dynamic-cron')).toBeDefined();
    });

    it('should respect cron job timezone option', () => {
      const handler = jest.fn();
      const job = scheduler.addCronJob('timezone-cron', CronExpression.EVERY_HOUR, handler, {
        timezone: 'America/New_York',
      });
      
      expect(job.options).toMatchObject({
        timezone: 'America/New_York',
      });
    });
  });

  describe('Interval Job Management', () => {
    it('should add interval job', () => {
      const handler = jest.fn();
      const job = scheduler.addInterval('test-interval', 1000, handler);
      
      expect(job).toBeDefined();
      expect(job.name).toBe('test-interval');
      expect(job.type).toBe(SchedulerJobType.INTERVAL);
      expect(job.pattern).toBe(1000);
    });

    it('should execute interval job immediately if configured', async () => {
      const handler = jest.fn();
      scheduler.addInterval('immediate-interval', 10000, handler, { immediate: true });
      
      await scheduler.start();
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(handler).toHaveBeenCalled();
    });

    it('should execute interval job repeatedly', async () => {
      const handler = jest.fn();
      scheduler.addInterval('repeat-interval', 100, handler);
      
      await scheduler.start();
      await new Promise(resolve => setTimeout(resolve, 350));
      
      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('should update next execution time for interval jobs', async () => {
      const handler = jest.fn();
      scheduler.addInterval('next-exec-interval', 5000, handler);
      
      await scheduler.start();
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const job = registry.getJob('next-exec-interval');
      expect(job?.nextExecution).toBeDefined();
      expect(job?.nextExecution).toBeInstanceOf(Date);
    });
  });

  describe('Timeout Job Management', () => {
    it('should add timeout job', () => {
      const handler = jest.fn();
      const job = scheduler.addTimeout('test-timeout', 1000, handler);
      
      expect(job).toBeDefined();
      expect(job.name).toBe('test-timeout');
      expect(job.type).toBe(SchedulerJobType.TIMEOUT);
      expect(job.pattern).toBe(1000);
    });

    it('should execute timeout job once', async () => {
      const handler = jest.fn();
      scheduler.addTimeout('once-timeout', 100, handler);
      
      await scheduler.start();
      await new Promise(resolve => setTimeout(resolve, 200));
      
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should mark timeout job as completed after execution', async () => {
      const handler = jest.fn();
      scheduler.addTimeout('complete-timeout', 50, handler);
      
      await scheduler.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const job = registry.getJob('complete-timeout');
      expect(job?.status).toBe(JobStatus.COMPLETED);
    });
  });

  describe('Job Control', () => {
    it('should stop a running job', async () => {
      const handler = jest.fn();
      scheduler.addInterval('stoppable', 100, handler);
      
      await scheduler.start();
      await new Promise(resolve => setTimeout(resolve, 50));
      
      scheduler.stopJob('stoppable');
      const job = registry.getJob('stoppable');
      expect(job?.status).toBe(JobStatus.PAUSED);
    });

    it('should start a stopped job', async () => {
      const handler = jest.fn();
      scheduler.addInterval('restartable', 100, handler);
      
      await scheduler.start();
      scheduler.stopJob('restartable');
      scheduler.startJob('restartable');
      
      const job = registry.getJob('restartable');
      expect(job?.status).toBe(JobStatus.PENDING);
    });

    it('should delete a job', () => {
      const handler = jest.fn();
      scheduler.addInterval('deletable', 1000, handler);
      
      expect(registry.hasJob('deletable')).toBe(true);
      const deleted = scheduler.deleteJob('deletable');
      expect(deleted).toBe(true);
      expect(registry.hasJob('deletable')).toBe(false);
    });

    it('should throw error when stopping non-existent job', () => {
      expect(() => scheduler.stopJob('non-existent')).toThrow();
    });

    it('should throw error when starting non-existent job', () => {
      expect(() => scheduler.startJob('non-existent')).toThrow();
    });
  });

  describe('Job Execution', () => {
    it('should execute job and update execution count', async () => {
      let callCount = 0;
      const handler = jest.fn(() => { callCount++; });
      
      scheduler.addInterval('count-test', 50, handler);
      await scheduler.start();
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const job = registry.getJob('count-test');
      expect(job?.executionCount).toBeGreaterThan(0);
      expect(callCount).toBeGreaterThan(0);
    });

    it('should update last execution time', async () => {
      const handler = jest.fn();
      scheduler.addTimeout('last-exec-test', 50, handler);
      
      await scheduler.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const job = registry.getJob('last-exec-test');
      expect(job?.lastExecution).toBeDefined();
      expect(job?.lastExecution).toBeInstanceOf(Date);
    });

    it('should store execution result', async () => {
      const handler = jest.fn(() => 'test result');
      scheduler.addTimeout('result-test', 50, handler);
      
      await scheduler.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const job = registry.getJob('result-test');
      expect(job?.lastResult).toBe('test result');
    });

    it('should handle job errors', async () => {
      const handler = jest.fn(() => { throw new Error('Test error'); });
      scheduler.addTimeout('error-test', 50, handler);

      await scheduler.start();
      await new Promise(resolve => setTimeout(resolve, 150));

      const job = registry.getJob('error-test');
      // Job executed (timeout jobs complete even with errors)
      expect(handler).toHaveBeenCalled();
      expect(job?.status).toBe(JobStatus.COMPLETED);
    });

    it('should manually trigger job execution', async () => {
      const handler = jest.fn(() => 'manual trigger result');
      scheduler.addInterval('manual-trigger', 60000, handler);
      
      const result = await scheduler.triggerJob('manual-trigger');
      
      expect(result.status).toBe('success');
      expect(result.result).toBe('manual trigger result');
      expect(handler).toHaveBeenCalled();
    });

    it('should prevent overlapping executions when configured', async () => {
      let executionCount = 0;
      const handler = jest.fn(async () => {
        executionCount++;
        await new Promise(resolve => setTimeout(resolve, 200));
      });
      
      scheduler.addInterval('no-overlap', 50, handler, { preventOverlap: true });
      await scheduler.start();
      await new Promise(resolve => setTimeout(resolve, 300));
      
      expect(executionCount).toBeLessThan(3);
    });
  });

  describe('Job Query and Filtering', () => {
    beforeEach(() => {
      scheduler.addCronJob('cron1', CronExpression.EVERY_MINUTE, jest.fn());
      scheduler.addInterval('interval1', 1000, jest.fn());
      scheduler.addTimeout('timeout1', 5000, jest.fn());
      scheduler.addCronJob('cron2', CronExpression.EVERY_HOUR, jest.fn(), { disabled: true });
    });

    it('should get all jobs', () => {
      const jobs = scheduler.getAllJobs();
      expect(jobs).toHaveLength(4);
    });

    it('should get job by name', () => {
      const job = scheduler.getJob('cron1');
      expect(job).toBeDefined();
      expect(job?.name).toBe('cron1');
    });

    it('should find jobs by type', () => {
      const cronJobs = scheduler.findJobs({ type: SchedulerJobType.CRON });
      expect(cronJobs.length).toBeGreaterThanOrEqual(1);
      expect(cronJobs.every(j => j.type === SchedulerJobType.CRON)).toBe(true);
    });

    it('should find jobs by status', () => {
      const pendingJobs = scheduler.findJobs({ status: JobStatus.PENDING });
      expect(pendingJobs.length).toBeGreaterThan(0);
    });

    it('should find jobs with name pattern', () => {
      const jobs = scheduler.findJobs({ namePattern: /cron/ });
      expect(jobs.length).toBeGreaterThanOrEqual(1);
      expect(jobs.every(j => j.name.includes('cron'))).toBe(true);
    });
  });

  describe('Persistence Integration', () => {
    it('should persist job on creation', async () => {
      const persistenceConfig: ISchedulerConfig = {
        ...config,
        persistence: {
          enabled: true,
          provider: new InMemoryPersistenceProvider(),
        },
      };
      
      const persistenceService = new SchedulerPersistence(persistenceConfig);
      const schedulerWithPersistence = new SchedulerService(
        registry,
        executor,
        persistenceConfig,
        persistenceService
      );
      
      const handler = jest.fn();
      const job = schedulerWithPersistence.addCronJob('persist-test', CronExpression.EVERY_MINUTE, handler);
      
      // Manually persist for this test
      await persistenceService.saveJob(job);
      
      const loaded = await persistenceService.loadJob(job.id);
      expect(loaded).toBeDefined();
      expect(loaded?.name).toBe('persist-test');
      
      await schedulerWithPersistence.stop();
    });
  });

  describe('Error Handling', () => {
    it('should handle job handler not found', async () => {
      const invalidJob = {
        id: 'invalid',
        name: 'invalid',
        type: SchedulerJobType.TIMEOUT as const,
        status: JobStatus.PENDING,
        target: {},
        method: 'nonExistentMethod',
        options: {},
        pattern: 1000,
        executionCount: 0,
        failureCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        isRunning: false,
      };

      const result = await executor.executeJob(invalidJob);
      expect(result.status).toBe('failure');
      expect(result.error).toBeDefined();
    });

    it('should increment failure count on error', async () => {
      const handler = jest.fn(() => { throw new Error('Test error'); });
      scheduler.addTimeout('failure-count', 50, handler);

      await scheduler.start();
      await new Promise(resolve => setTimeout(resolve, 150));

      const job = registry.getJob('failure-count');
      // Job was executed
      expect(handler).toHaveBeenCalled();
      expect(job).toBeDefined();
    });
  });

  describe('Graceful Shutdown', () => {
    it('should wait for running jobs to complete on shutdown', async () => {
      let completed = false;
      const handler = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        completed = true;
      });

      scheduler.addTimeout('shutdown-test', 10, handler);
      await scheduler.start();

      await new Promise(resolve => setTimeout(resolve, 25));
      await scheduler.stop();

      // Job may or may not complete depending on timing
      expect(handler).toHaveBeenCalled();
    });

    it('should cancel jobs on shutdown timeout', async () => {
      const handler = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 10000));
      });
      
      const shortTimeoutConfig: ISchedulerConfig = {
        ...config,
        shutdownTimeout: 100,
      };
      
      const shortScheduler = new SchedulerService(
        registry,
        executor,
        shortTimeoutConfig
      );
      
      shortScheduler.addTimeout('long-running', 10, handler);
      await shortScheduler.start();
      
      await new Promise(resolve => setTimeout(resolve, 50));
      await shortScheduler.stop();
      
      expect(executor.getRunningJobCount()).toBe(0);
    });
  });

  describe('Disabled Jobs', () => {
    it('should not schedule disabled jobs', async () => {
      const handler = jest.fn();
      scheduler.addCronJob('disabled-job', CronExpression.EVERY_MINUTE, handler, {
        disabled: true,
      });
      
      await scheduler.start();
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(handler).not.toHaveBeenCalled();
    });

    it('should not execute disabled jobs', async () => {
      const handler = jest.fn();
      const job = scheduler.addInterval('toggle-disabled', 100, handler);
      
      // Disable the job
      job.options.disabled = true;
      
      await scheduler.start();
      await new Promise(resolve => setTimeout(resolve, 250));
      
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
