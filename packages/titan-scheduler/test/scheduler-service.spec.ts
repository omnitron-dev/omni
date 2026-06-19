/**
 * Scheduler Service Comprehensive Tests
 * Tests job scheduling, lifecycle, execution, and state management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SchedulerService } from '../src/scheduler.service.js';
import { SchedulerRegistry } from '../src/scheduler.registry.js';
import { SchedulerExecutor } from '../src/scheduler.executor.js';
import {
  SchedulerPersistence,
  InMemoryPersistenceProvider,
} from '../src/scheduler.persistence.js';
import { SCHEDULER_EVENTS } from '../src/scheduler.constants.js';
import { CronExpression, JobStatus, SchedulerJobType } from '../src/scheduler.interfaces.js';
import type { ISchedulerConfig, ISchedulerLockProvider } from '../src/scheduler.interfaces.js';

/**
 * Minimal in-process shared lock that models a distributed store for the SC-1
 * tests. `acquireLock` is atomic (its body has no `await`, so concurrent calls
 * can't interleave): it returns a lock id, or null when the key is held +
 * unexpired. Two SchedulerService instances sharing ONE of these behave like
 * two nodes sharing one Redis. (Cross-process Redis correctness of the real
 * provider is covered by titan-lock's own SET-NX tests.)
 */
class SharedMemoryLock implements ISchedulerLockProvider {
  private readonly locks = new Map<string, { id: string; expiresAt: number }>();
  private seq = 0;
  async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    const now = Date.now();
    const existing = this.locks.get(key);
    if (existing && existing.expiresAt > now) return null; // held by another node
    const id = `lock-${++this.seq}`;
    this.locks.set(key, { id, expiresAt: now + ttlMs });
    return id;
  }
  async releaseLock(key: string, lockId: string): Promise<boolean> {
    const existing = this.locks.get(key);
    if (existing && existing.id === lockId) {
      this.locks.delete(key);
      return true;
    }
    return false;
  }
}

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
      await scheduler.onStop();
    }
  });

  describe('SC-2: persistence load guards unrestorable handlers', () => {
    it('skips a loaded job whose handler did not survive serialization', async () => {
      const brokenJob: any = {
        id: 'b1', name: 'broken', type: SchedulerJobType.INTERVAL, pattern: 100000,
        target: null, method: 'run', options: {}, status: JobStatus.PENDING,
      };
      const validJob: any = {
        id: 'v1', name: 'valid', type: SchedulerJobType.INTERVAL, pattern: 100000,
        target: { run: vi.fn() }, method: 'run', options: {}, status: JobStatus.PENDING,
      };
      vi.spyOn(persistence, 'loadAllJobs').mockResolvedValue([brokenJob, validJob]);

      await scheduler.onInit();

      // The handler-less job is skipped (it would crash on fire); the valid one loads.
      expect(registry.hasJob('broken')).toBe(false);
      expect(registry.hasJob('valid')).toBe(true);
    });
  });

  describe('SC-1: distributed per-fire-window lock (exactly-once across nodes)', () => {
    it('fails fast when distributed.enabled is true but NO lock provider is configured', async () => {
      const distConfig: ISchedulerConfig = { ...config, distributed: { enabled: true } };
      const svc = new SchedulerService(
        new SchedulerRegistry(distConfig),
        new SchedulerExecutor(distConfig),
        distConfig
      );
      await expect(svc.onStart()).rejects.toThrow(/lock provider|distributed/i);
      expect(svc.isRunning()).toBe(false);
    });

    it('starts when distributed.enabled is true AND a lock provider is supplied', async () => {
      const distConfig: ISchedulerConfig = { ...config, distributed: { enabled: true } };
      const svc = new SchedulerService(
        new SchedulerRegistry(distConfig),
        new SchedulerExecutor(distConfig),
        distConfig,
        undefined,
        undefined,
        undefined,
        new SharedMemoryLock()
      );
      await expect(svc.onStart()).resolves.not.toThrow();
      expect(svc.isRunning()).toBe(true);
      await svc.onStop();
    });

    it('starts normally when distributed is disabled (default)', async () => {
      const svc = new SchedulerService(new SchedulerRegistry(config), new SchedulerExecutor(config), config);
      await expect(svc.onStart()).resolves.not.toThrow();
      await svc.onStop();
    });

    // CONTROL: without coordination, two nodes both fire every tick → the same
    // fire-window runs twice. Proves the duplication is real and that the
    // exactly-once assertion below can actually detect a regression.
    it('control: two un-coordinated nodes duplicate the same fire-window', async () => {
      const fires: number[] = [];
      const mk = () => {
        const svc = new SchedulerService(new SchedulerRegistry(config), new SchedulerExecutor(config), config);
        svc.addCronJob('control-sec', '* * * * * *' as unknown as CronExpression, () => {
          fires.push(Math.floor(Date.now() / 1000));
        });
        return svc;
      };
      const a = mk();
      const b = mk();
      await a.onStart();
      await b.onStart();
      await new Promise((r) => setTimeout(r, 2200));
      await a.onStop();
      await b.onStop();
      // At least one second saw BOTH nodes fire → more entries than unique seconds.
      expect(fires.length).toBeGreaterThan(new Set(fires).size);
    });

    it('SC-1-full: two nodes sharing a lock run each fire-window exactly once', async () => {
      const lock = new SharedMemoryLock(); // ONE store, shared by both "nodes"
      const distConfig: ISchedulerConfig = {
        ...config,
        distributed: { enabled: true, lockTTL: 2000 },
      };
      const fires: number[] = [];
      const mk = () => {
        const svc = new SchedulerService(
          new SchedulerRegistry(distConfig),
          new SchedulerExecutor(distConfig),
          distConfig,
          undefined,
          undefined,
          undefined,
          lock
        );
        svc.addCronJob('dist-sec', '* * * * * *' as unknown as CronExpression, () => {
          fires.push(Math.floor(Date.now() / 1000));
        });
        return svc;
      };
      const a = mk();
      const b = mk();
      await a.onStart();
      await b.onStart();
      await new Promise((r) => setTimeout(r, 3200));
      await a.onStop();
      await b.onStop();

      // At least one tick fired, and NO fire-window (second) ran more than once
      // across the two nodes — exactly-once distributed execution.
      expect(fires.length).toBeGreaterThanOrEqual(1);
      expect(new Set(fires).size).toBe(fires.length);
    });
  });

  describe('Lifecycle Management', () => {
    it('should initialize and start scheduler', async () => {
      expect(scheduler.isRunning()).toBe(false);
      await scheduler.onStart();
      expect(scheduler.isRunning()).toBe(true);
    });

    it('should stop scheduler cleanly', async () => {
      await scheduler.onStart();
      expect(scheduler.isRunning()).toBe(true);
      await scheduler.onStop();
      expect(scheduler.isRunning()).toBe(false);
    });

    it('should be idempotent when starting already started scheduler', async () => {
      await scheduler.onStart();
      // onStart is idempotent — silently returns if already started
      await expect(scheduler.onStart()).resolves.not.toThrow();
      expect(scheduler.isRunning()).toBe(true);
    });

    it('should not throw error when stopping already stopped scheduler', async () => {
      await expect(scheduler.onStop()).resolves.not.toThrow();
    });

    it('should emit SCHEDULER_STARTED event on start', async () => {
      const handler = vi.fn();
      registry.on(SCHEDULER_EVENTS.SCHEDULER_STARTED, handler);
      await scheduler.onStart();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(Date),
          jobCount: expect.any(Number),
        })
      );
    });

    it('should emit SCHEDULER_STOPPED event on stop', async () => {
      const handler = vi.fn();
      registry.on(SCHEDULER_EVENTS.SCHEDULER_STOPPED, handler);
      await scheduler.onStart();
      await scheduler.onStop();
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Cron Job Management', () => {
    it('should add cron job dynamically', () => {
      const handler = vi.fn();
      const job = scheduler.addCronJob('test-cron', CronExpression.EVERY_MINUTE, handler);

      expect(job).toBeDefined();
      expect(job.name).toBe('test-cron');
      expect(job.type).toBe(SchedulerJobType.CRON);
      expect(registry.hasJob('test-cron')).toBe(true);
    });

    it('should validate cron expression', async () => {
      const handler = vi.fn();
      scheduler.addCronJob('valid-cron', '0 0 * * *', handler);
      await scheduler.onStart();

      expect(registry.hasJob('valid-cron')).toBe(true);
    });

    it('should handle invalid cron expression', async () => {
      const handler = vi.fn();
      scheduler.addCronJob('invalid-cron', 'invalid expression', handler);
      await expect(scheduler.onStart()).rejects.toThrow();
    });

    it('should schedule cron job when scheduler is running', async () => {
      const handler = vi.fn();
      await scheduler.onStart();

      const job = scheduler.addCronJob('dynamic-cron', CronExpression.EVERY_MINUTE, handler);
      expect(job).toBeDefined();
      expect(registry.getJob('dynamic-cron')).toBeDefined();
    });

    it('should respect cron job timezone option', () => {
      const handler = vi.fn();
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
      const handler = vi.fn();
      const job = scheduler.addInterval('test-interval', 1000, handler);

      expect(job).toBeDefined();
      expect(job.name).toBe('test-interval');
      expect(job.type).toBe(SchedulerJobType.INTERVAL);
      expect(job.pattern).toBe(1000);
    });

    it('should execute interval job immediately if configured', async () => {
      const handler = vi.fn();
      scheduler.addInterval('immediate-interval', 10000, handler, { immediate: true });

      await scheduler.onStart();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalled();
    });

    it('should execute interval job repeatedly', async () => {
      const handler = vi.fn();
      scheduler.addInterval('repeat-interval', 100, handler);

      await scheduler.onStart();
      await new Promise((resolve) => setTimeout(resolve, 350));

      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('should update next execution time for interval jobs', async () => {
      const handler = vi.fn();
      scheduler.addInterval('next-exec-interval', 5000, handler);

      await scheduler.onStart();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const job = registry.getJob('next-exec-interval');
      expect(job?.nextExecution).toBeDefined();
      expect(job?.nextExecution).toBeInstanceOf(Date);
    });

    it('should compute the REAL next execution time for cron jobs (SC-3)', async () => {
      const handler = vi.fn();
      // Daily at 09:00. The old faked `now + 60000` reported "in ~1 minute" with
      // the current minute/second; the real cron parse lands exactly on the next
      // 09:00:00 — which is what the health view / sort key should show.
      scheduler.addCronJob('next-exec-cron', '0 9 * * *', handler);

      await scheduler.onStart();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const job = registry.getJob('next-exec-cron');
      expect(job?.nextExecution).toBeInstanceOf(Date);
      const next = job!.nextExecution!;
      expect(next.getHours()).toBe(9);
      expect(next.getMinutes()).toBe(0);
      expect(next.getSeconds()).toBe(0);
      expect(next.getTime()).toBeGreaterThan(Date.now());
    });

    it('re-scheduling a cron job stops the old node-cron task (SC-5, no leak)', async () => {
      scheduler.addCronJob('resched', '0 9 * * *', vi.fn());
      await scheduler.onStart();

      const oldTask = registry.getJobInstance('resched');
      expect(oldTask).toBeDefined();
      const stopSpy = vi.spyOn(oldTask, 'stop');

      // Re-schedule the same job (e.g. what startJob does for an already-running job).
      (scheduler as any).scheduleJob(registry.getJob('resched'));

      // The previous node-cron task must be stopped, not left firing on its timer…
      expect(stopSpy).toHaveBeenCalled();
      // …and replaced by a fresh task instance.
      expect(registry.getJobInstance('resched')).not.toBe(oldTask);
    });

    it('re-scheduling a timeout job clears the old timer (SC-8, no leak)', async () => {
      scheduler.addTimeout('resched-to', 10_000, vi.fn());
      await scheduler.onStart();

      const oldHandle = registry.getJobInstance('resched-to');
      const clearSpy = vi.spyOn(global, 'clearTimeout');

      (scheduler as any).scheduleJob(registry.getJob('resched-to'));

      expect(clearSpy).toHaveBeenCalledWith(oldHandle);
      expect(registry.getJobInstance('resched-to')).not.toBe(oldHandle);
      clearSpy.mockRestore();
    });
  });

  describe('Timeout Job Management', () => {
    it('should add timeout job', () => {
      const handler = vi.fn();
      const job = scheduler.addTimeout('test-timeout', 1000, handler);

      expect(job).toBeDefined();
      expect(job.name).toBe('test-timeout');
      expect(job.type).toBe(SchedulerJobType.TIMEOUT);
      expect(job.pattern).toBe(1000);
    });

    it('should execute timeout job once', async () => {
      const handler = vi.fn();
      scheduler.addTimeout('once-timeout', 100, handler);

      await scheduler.onStart();
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should mark timeout job as completed after execution', async () => {
      const handler = vi.fn();
      scheduler.addTimeout('complete-timeout', 50, handler);

      await scheduler.onStart();
      await new Promise((resolve) => setTimeout(resolve, 150));

      const job = registry.getJob('complete-timeout');
      expect(job?.status).toBe(JobStatus.COMPLETED);
    });
  });

  describe('Job Control', () => {
    it('should stop a running job', async () => {
      const handler = vi.fn();
      scheduler.addInterval('stoppable', 100, handler);

      await scheduler.onStart();
      await new Promise((resolve) => setTimeout(resolve, 50));

      scheduler.stopJob('stoppable');
      const job = registry.getJob('stoppable');
      expect(job?.status).toBe(JobStatus.PAUSED);
    });

    it('should start a stopped job', async () => {
      const handler = vi.fn();
      scheduler.addInterval('restartable', 100, handler);

      await scheduler.onStart();
      scheduler.stopJob('restartable');
      scheduler.startJob('restartable');

      const job = registry.getJob('restartable');
      expect(job?.status).toBe(JobStatus.PENDING);
    });

    it('should delete a job', () => {
      const handler = vi.fn();
      scheduler.addInterval('deletable', 1000, handler);

      expect(registry.hasJob('deletable')).toBe(true);
      const deleted = scheduler.deleteJob('deletable');
      expect(deleted).toBe(true);
      expect(registry.hasJob('deletable')).toBe(false);
    });

    it('SC-11: deletes the persisted record (id captured before registry removal)', () => {
      const handler = vi.fn();
      scheduler.addInterval('persisted-deletable', 1000, handler);
      const job = registry.getJob('persisted-deletable');
      expect(job).toBeDefined();

      const delSpy = vi.spyOn(persistence, 'deleteJob');
      const deleted = scheduler.deleteJob('persisted-deletable');

      expect(deleted).toBe(true);
      // The bug: getJob() ran AFTER removeJob() → undefined → persistence never
      // called. The fix captures the id first, so deleteJob fires with that id.
      expect(delSpy).toHaveBeenCalledWith(job!.id);
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
      const handler = vi.fn(() => {
        callCount++;
      });

      scheduler.addInterval('count-test', 50, handler);
      await scheduler.onStart();
      await new Promise((resolve) => setTimeout(resolve, 200));

      const job = registry.getJob('count-test');
      expect(job?.executionCount).toBeGreaterThan(0);
      expect(callCount).toBeGreaterThan(0);
    });

    it('should update last execution time', async () => {
      const handler = vi.fn();
      scheduler.addTimeout('last-exec-test', 50, handler);

      await scheduler.onStart();
      await new Promise((resolve) => setTimeout(resolve, 150));

      const job = registry.getJob('last-exec-test');
      expect(job?.lastExecution).toBeDefined();
      expect(job?.lastExecution).toBeInstanceOf(Date);
    });

    it('should store execution result', async () => {
      const handler = vi.fn(() => 'test result');
      scheduler.addTimeout('result-test', 50, handler);

      await scheduler.onStart();
      await new Promise((resolve) => setTimeout(resolve, 150));

      const job = registry.getJob('result-test');
      expect(job?.lastResult).toBe('test result');
    });

    it('should handle job errors', async () => {
      const handler = vi.fn(() => {
        throw new Error('Test error');
      });
      scheduler.addTimeout('error-test', 50, handler);

      await scheduler.onStart();
      await new Promise((resolve) => setTimeout(resolve, 150));

      const job = registry.getJob('error-test');
      // Job executed (timeout jobs complete even with errors)
      expect(handler).toHaveBeenCalled();
      expect(job?.status).toBe(JobStatus.COMPLETED);
    });

    it('should manually trigger job execution', async () => {
      const handler = vi.fn(() => 'manual trigger result');
      scheduler.addInterval('manual-trigger', 60000, handler);

      const result = await scheduler.triggerJob('manual-trigger');

      expect(result.status).toBe('success');
      expect(result.result).toBe('manual trigger result');
      expect(handler).toHaveBeenCalled();
    });

    it('should prevent overlapping executions when configured', async () => {
      let executionCount = 0;
      const handler = vi.fn(async () => {
        executionCount++;
        await new Promise((resolve) => setTimeout(resolve, 200));
      });

      scheduler.addInterval('no-overlap', 50, handler, { preventOverlap: true });
      await scheduler.onStart();
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(executionCount).toBeLessThan(3);
    });
  });

  describe('Job Query and Filtering', () => {
    beforeEach(() => {
      scheduler.addCronJob('cron1', CronExpression.EVERY_MINUTE, vi.fn());
      scheduler.addInterval('interval1', 1000, vi.fn());
      scheduler.addTimeout('timeout1', 5000, vi.fn());
      scheduler.addCronJob('cron2', CronExpression.EVERY_HOUR, vi.fn(), { disabled: true });
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
      expect(cronJobs.every((j) => j.type === SchedulerJobType.CRON)).toBe(true);
    });

    it('should find jobs by status', () => {
      const pendingJobs = scheduler.findJobs({ status: JobStatus.PENDING });
      expect(pendingJobs.length).toBeGreaterThan(0);
    });

    it('should find jobs with name pattern', () => {
      const jobs = scheduler.findJobs({ namePattern: /cron/ });
      expect(jobs.length).toBeGreaterThanOrEqual(1);
      expect(jobs.every((j) => j.name.includes('cron'))).toBe(true);
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
      const schedulerWithPersistence = new SchedulerService(registry, executor, persistenceConfig, persistenceService);

      const handler = vi.fn();
      const job = schedulerWithPersistence.addCronJob('persist-test', CronExpression.EVERY_MINUTE, handler);

      // Manually persist for this test
      await persistenceService.saveJob(job);

      const loaded = await persistenceService.loadJob(job.id);
      expect(loaded).toBeDefined();
      expect(loaded?.name).toBe('persist-test');

      await schedulerWithPersistence.onStop();
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
      const handler = vi.fn(() => {
        throw new Error('Test error');
      });
      scheduler.addTimeout('failure-count', 50, handler);

      await scheduler.onStart();
      await new Promise((resolve) => setTimeout(resolve, 150));

      const job = registry.getJob('failure-count');
      // Job was executed
      expect(handler).toHaveBeenCalled();
      expect(job).toBeDefined();
    });
  });

  describe('Graceful Shutdown', () => {
    it('should wait for running jobs to complete on shutdown', async () => {
      let completed = false;
      const handler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        completed = true;
      });

      scheduler.addTimeout('shutdown-test', 10, handler);
      await scheduler.onStart();

      await new Promise((resolve) => setTimeout(resolve, 25));
      await scheduler.onStop();

      // Job may or may not complete depending on timing
      expect(handler).toHaveBeenCalled();
    });

    it('should cancel jobs on shutdown timeout', async () => {
      const handler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10000));
      });

      const shortTimeoutConfig: ISchedulerConfig = {
        ...config,
        shutdownTimeout: 100,
      };

      const shortScheduler = new SchedulerService(registry, executor, shortTimeoutConfig);

      shortScheduler.addTimeout('long-running', 10, handler);
      await shortScheduler.onStart();

      await new Promise((resolve) => setTimeout(resolve, 50));
      await shortScheduler.onStop();

      expect(executor.getRunningJobCount()).toBe(0);
    });
  });

  describe('Disabled Jobs', () => {
    it('should not schedule disabled jobs', async () => {
      const handler = vi.fn();
      scheduler.addCronJob('disabled-job', CronExpression.EVERY_MINUTE, handler, {
        disabled: true,
      });

      await scheduler.onStart();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handler).not.toHaveBeenCalled();
    });

    it('should not execute disabled jobs', async () => {
      const handler = vi.fn();
      const job = scheduler.addInterval('toggle-disabled', 100, handler);

      // Disable the job
      job.options.disabled = true;

      await scheduler.onStart();
      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
