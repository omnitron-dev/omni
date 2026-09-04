/**
 * Scheduler Executor Comprehensive Tests
 * Tests job execution, retry logic, timeout, concurrency, and queueing
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SchedulerExecutor } from '../src/scheduler.executor.js';
import { SCHEDULER_EVENTS } from '../src/scheduler.constants.js';
import { JobStatus, SchedulerJobType } from '../src/scheduler.interfaces.js';
import type {
  ISchedulerConfig,
  IScheduledJob,
  IJobListener,
} from '../src/scheduler.interfaces.js';

describe('Scheduler Executor', () => {
  let executor: SchedulerExecutor;

  const config: ISchedulerConfig = {
    maxConcurrent: 3,
    queueSize: 10,
    shutdownTimeout: 5000,
    retry: {
      maxAttempts: 3,
      delay: 100,
      backoff: 2,
    },
  };

  const createMockJob = (name: string, handler: any, options: any = {}): IScheduledJob => ({
    id: `job-${name}`,
    name,
    type: SchedulerJobType.TIMEOUT,
    status: JobStatus.PENDING,
    target: { [name]: handler },
    method: name,
    options,
    pattern: 1000,
    executionCount: 0,
    failureCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    isRunning: false,
  });

  beforeEach(() => {
    executor = new SchedulerExecutor(config);
  });

  describe('Basic Execution', () => {
    it('should execute a job successfully', async () => {
      const handler = vi.fn(() => 'test result');
      const job = createMockJob('testJob', handler);

      const result = await executor.executeJob(job);

      expect(result.status).toBe('success');
      expect(result.result).toBe('test result');
      expect(result.jobId).toBe(job.id);
      expect(handler).toHaveBeenCalled();
    });

    it('should execute async job successfully', async () => {
      const handler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'async result';
      });
      const job = createMockJob('asyncJob', handler);

      const result = await executor.executeJob(job);

      expect(result.status).toBe('success');
      expect(result.result).toBe('async result');
      expect(result.duration).toBeGreaterThanOrEqual(50);
    });

    it('should pass execution context to handler', async () => {
      let receivedContext: any;
      const handler = vi.fn((context) => {
        receivedContext = context;
      });
      const job = createMockJob('contextJob', handler);

      await executor.executeJob(job);

      expect(receivedContext).toBeDefined();
      expect(receivedContext.jobId).toBe(job.id);
      expect(receivedContext.jobName).toBe(job.name);
      expect(receivedContext.executionId).toBeDefined();
      expect(receivedContext.timestamp).toBeInstanceOf(Date);
      expect(receivedContext.attempt).toBe(1);
    });

    it('should include metadata in execution context', async () => {
      let receivedContext: any;
      const handler = vi.fn((context) => {
        receivedContext = context;
      });
      const job = createMockJob('metadataJob', handler, {
        metadata: { key: 'value', flag: true },
      });

      await executor.executeJob(job);

      expect(receivedContext.metadata).toEqual({
        key: 'value',
        flag: true,
      });
    });

    it('should measure execution duration', async () => {
      const handler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      const job = createMockJob('durationJob', handler);

      const result = await executor.executeJob(job);

      expect(result.duration).toBeGreaterThanOrEqual(100);
      expect(result.duration).toBeLessThan(200);
    });
  });

  describe('Error Handling', () => {
    it('should handle synchronous errors', async () => {
      const error = new Error('Sync error');
      const handler = vi.fn(() => {
        throw error;
      });
      const job = createMockJob('errorJob', handler, { retry: undefined });

      const result = await executor.executeJob(job);

      expect(result.status).toBe('failure');
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Sync error');
    });

    it('should handle asynchronous errors', async () => {
      const handler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error('Async error');
      });
      const job = createMockJob('asyncErrorJob', handler, { retry: undefined });

      const result = await executor.executeJob(job);

      expect(result.status).toBe('failure');
      expect(result.error?.message).toBe('Async error');
    });

    it('should call onError handler on failure', async () => {
      const onError = vi.fn();
      const handler = vi.fn(() => {
        throw new Error('Test error');
      });
      const job = createMockJob('onErrorJob', handler, { onError, retry: undefined });

      await executor.executeJob(job);

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should not throw if onError handler fails', async () => {
      const onError = vi.fn(() => {
        throw new Error('onError failed');
      });
      const handler = vi.fn(() => {
        throw new Error('Test error');
      });
      const job = createMockJob('onErrorFailJob', handler, { onError, retry: undefined });

      await expect(executor.executeJob(job)).resolves.toBeDefined();
    });

    // Regression for the silent-swallow bug: pre-fix when an
    // onError handler itself threw, the catch block did nothing
    // (`catch { /* Error in job error handler */ }`). The
    // secondary failure vanished and the only diagnostic was a
    // commented-out wish. The fix routes handler failures through
    // the `scheduler:error` event so subscribers see both the
    // original error and the handler error with full context.
    it('should emit scheduler:error with originalError + handlerError when onError throws', async () => {
      const originalError = new Error('original failure');
      const handlerError = new Error('handler failure');
      const onError = vi.fn(() => {
        throw handlerError;
      });
      const handler = vi.fn(() => {
        throw originalError;
      });
      const job = createMockJob('onErrorEmitJob', handler, { onError, retry: undefined });

      const seen: any[] = [];
      executor.on('scheduler:error', (payload: any) => {
        seen.push(payload);
      });

      await executor.executeJob(job);

      expect(seen).toHaveLength(1);
      expect(seen[0].scope).toBe('onError-handler');
      expect(seen[0].jobName).toBe('onErrorEmitJob');
      expect(seen[0].originalError).toBe(originalError);
      expect(seen[0].handlerError).toBe(handlerError);
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed jobs', async () => {
      let attempts = 0;
      const handler = vi.fn(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Retry test');
        }
        return 'success after retries';
      });
      const job = createMockJob('retryJob', handler, {
        retry: { maxAttempts: 3, delay: 50 },
      });

      const result = await executor.executeJob(job);

      expect(result.status).toBe('success');
      expect(result.result).toBe('success after retries');
      expect(handler).toHaveBeenCalledTimes(3);
      expect(result.attempt).toBe(3);
    });

    it('should respect maxAttempts', async () => {
      const handler = vi.fn(() => {
        throw new Error('Always fails');
      });
      const job = createMockJob('maxAttemptsJob', handler, {
        retry: { maxAttempts: 3, delay: 10 },
      });

      const result = await executor.executeJob(job);

      expect(result.status).toBe('failure');
      expect(handler).toHaveBeenCalledTimes(3);
    });

    it('should apply exponential backoff', async () => {
      const delays: number[] = [];
      let calls = 0;
      let lastTime = Date.now();

      const handler = vi.fn(() => {
        const now = Date.now();
        // Guarded on the CALL COUNT, not on `delays.length`. The old guard was
        // `if (delays.length > 0)` — the array starts empty, so it never fired
        // and `delays` stayed empty forever. The backoff assertion could not
        // pass, and the maxDelay one passed vacuously on an empty array.
        if (calls > 0) {
          delays.push(now - lastTime);
        }
        calls++;
        lastTime = now;
        throw new Error('Backoff test');
      });

      const job = createMockJob('backoffJob', handler, {
        retry: { maxAttempts: 4, delay: 50, backoff: 2 },
      });

      await executor.executeJob(job);

      expect(delays.length).toBe(3);
      // Each delay should be roughly double the previous
      expect(delays[1]).toBeGreaterThan(delays[0] * 1.5);
      expect(delays[2]).toBeGreaterThan(delays[1] * 1.5);
    });

    it('should respect maxDelay', async () => {
      const delays: number[] = [];
      let calls = 0;
      let lastTime = Date.now();

      const handler = vi.fn(() => {
        const now = Date.now();
        // Guarded on the CALL COUNT, not on `delays.length`. The old guard was
        // `if (delays.length > 0)` — the array starts empty, so it never fired
        // and `delays` stayed empty forever. The backoff assertion could not
        // pass, and the maxDelay one passed vacuously on an empty array.
        if (calls > 0) {
          delays.push(now - lastTime);
        }
        calls++;
        lastTime = now;
        throw new Error('Max delay test');
      });

      const job = createMockJob('maxDelayJob', handler, {
        retry: { maxAttempts: 5, delay: 100, backoff: 10, maxDelay: 200 },
      });

      await executor.executeJob(job);

      // All delays should be capped at maxDelay
      expect(delays.length).toBeGreaterThan(0);
      expect(delays.every((d) => d < 300)).toBe(true);
    });

    it('should use retryIf condition', async () => {
      let attempts = 0;
      const handler = vi.fn(() => {
        attempts++;
        const error: any = new Error('Conditional retry');
        error.code = attempts === 1 ? 'RETRYABLE' : 'NOT_RETRYABLE';
        throw error;
      });

      const job = createMockJob('retryIfJob', handler, {
        retry: {
          maxAttempts: 5,
          delay: 10,
          retryIf: (error: any) => error.code === 'RETRYABLE',
        },
      });

      const result = await executor.executeJob(job);

      expect(result.status).toBe('failure');
      expect(handler).toHaveBeenCalledTimes(2); // First attempt + one retry
    });

    it('should use global retry config if job retry not specified', async () => {
      let attempts = 0;
      const handler = vi.fn(() => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Global retry test');
        }
        return 'success';
      });
      const job = createMockJob('globalRetryJob', handler);

      const result = await executor.executeJob(job);

      expect(result.status).toBe('success');
      expect(handler.mock.calls.length).toBeGreaterThan(1);
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout long-running jobs', async () => {
      const handler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return 'should not reach here';
      });
      const job = createMockJob('timeoutJob', handler, {
        timeout: 100,
        retry: undefined,
      });

      const result = await executor.executeJob(job);

      expect(result.status).toBe('failure');
      expect(result.error?.message).toContain('timed out');
    });

    it('should use global timeout if job timeout not specified', async () => {
      const globalTimeoutExecutor = new SchedulerExecutor({
        ...config,
        shutdownTimeout: 100,
      });

      const handler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
      });
      const job = createMockJob('globalTimeoutJob', handler, { retry: undefined });

      const result = await globalTimeoutExecutor.executeJob(job);

      expect(result.status).toBe('failure');
      // The executor reports "... timed out after 100ms"; the assertion was
      // still looking for the noun.
      expect(result.error?.message).toContain('timed out');
      expect(result.error?.message).toContain('100ms');
    });

    it('should not timeout fast jobs', async () => {
      const handler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'completed';
      });
      const job = createMockJob('fastJob', handler, { timeout: 200 });

      const result = await executor.executeJob(job);

      expect(result.status).toBe('success');
      expect(result.result).toBe('completed');
    });
  });

  describe('Concurrency Control', () => {
    it('should respect maxConcurrent limit', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      const handler = vi.fn(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 100));
        concurrent--;
      });

      const jobs = Array.from({ length: 10 }, (_, i) => createMockJob(`concurrentJob${i}`, handler));

      await Promise.all(jobs.map((job) => executor.executeJob(job)));

      expect(maxConcurrent).toBeLessThanOrEqual(config.maxConcurrent!);
    });

    it('should queue jobs when at max concurrency', async () => {
      const executionOrder: number[] = [];

      const createHandler = (id: number) =>
        vi.fn(async () => {
          executionOrder.push(id);
          await new Promise((resolve) => setTimeout(resolve, 50));
        });

      const jobs = Array.from({ length: 6 }, (_, i) => createMockJob(`queueJob${i}`, createHandler(i)));

      await Promise.all(jobs.map((job) => executor.executeJob(job)));

      expect(executionOrder).toHaveLength(6);
      expect(executor.getQueuedJobCount()).toBe(0);
    });

    it('should track running job count', async () => {
      const handler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      const job = createMockJob('trackingJob', handler);

      const promise = executor.executeJob(job);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(executor.getRunningJobCount()).toBeGreaterThan(0);

      await promise;

      expect(executor.getRunningJobCount()).toBe(0);
    });

    it('should prevent overlap when configured (SC-4)', async () => {
      // SC-4: the executor now owns an atomic check-and-set gate, so this no
      // longer needs the old `job.isRunning = true` hack between the two calls.
      let executions = 0;
      const handler = vi.fn(async () => {
        executions++;
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      const job = createMockJob('noOverlapJob', handler, { preventOverlap: true });

      const promise1 = executor.executeJob(job); // acquires the lock
      const promise2 = executor.executeJob(job); // concurrent → cancelled

      expect((await promise2).status).toBe('cancelled');
      await promise1;
      expect(executions).toBe(1);

      // Lock released — a later run executes again.
      expect((await executor.executeJob(job)).status).toBe('success');
      expect(executions).toBe(2);
    });

    it('does NOT cancel the retry of a failing preventOverlap job (SC-4)', async () => {
      let attempts = 0;
      const handler = vi.fn(async () => {
        attempts++;
        if (attempts < 2) throw new Error('transient');
        return 'recovered';
      });
      const job = createMockJob('retryOverlapJob', handler, {
        preventOverlap: true,
        retry: { maxAttempts: 3, delay: 1 },
      });

      // attempt-2 is a retry of attempt-1, which still holds the lock — it must
      // bypass the gate, not self-cancel.
      const result = await executor.executeJob(job);
      expect(result.status).toBe('success');
      expect(attempts).toBe(2);
    });
  });

  describe('Job Cancellation', () => {
    // Cancellation is COOPERATIVE. JavaScript cannot preempt a running handler,
    // so all the executor can do is abort the AbortSignal it hands the job.
    // These tests used to run a handler that ignored the signal and then assert
    // it ended in 'failure' — asserting preemption that no runtime provides,
    // which is presumably why they were skipped rather than fixed. They now
    // pin the contract that does exist: the signal fires, and a handler that
    // observes it ends as a failure.
    it('aborts the signal handed to a running job', async () => {
      let observedAbort = false;
      const handler = vi.fn(
        (context: any) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve('completed'), 500);
            context.signal?.addEventListener('abort', () => {
              observedAbort = true;
              clearTimeout(timer);
              reject(new Error('cancelled'));
            });
          })
      );

      const job = createMockJob('cancellableJob', handler);
      const promise = executor.executeJob(job);

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(executor.getRunningJobCount()).toBeGreaterThan(0);

      executor.cancelAllJobs();

      const result = await promise;
      expect(observedAbort).toBe(true);
      expect(result.status).toBe('failure');
    });

    it('reports failure immediately even if the handler ignores its signal', async () => {
      // The other half of the contract, stated explicitly so nobody re-adds the
      // impossible expectation. The executor stops WAITING on cancel and
      // reports failure right away; it cannot stop the handler's own work,
      // which keeps running in the background. Both halves matter: the caller
      // gets a prompt answer, and the job is not magically preempted.
      let handlerFinished = false;
      const handler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        handlerFinished = true;
        return 'finished anyway';
      });

      const job = createMockJob('uncooperativeJob', handler);
      const promise = executor.executeJob(job);

      await new Promise((resolve) => setTimeout(resolve, 50));
      executor.cancelAllJobs();

      const result = await promise;
      expect(result.status).toBe('failure');
      // Resolved well before the handler's own 200ms timer.
      expect(handlerFinished).toBe(false);
      expect(executor.getRunningJobCount()).toBe(0);
    });

    it('should cancel all running jobs', async () => {
      let aborted = 0;
      const handler = vi.fn(
        (context: any) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve('completed'), 500);
            context.signal?.addEventListener('abort', () => {
              aborted++;
              clearTimeout(timer);
              reject(new Error('cancelled'));
            });
          })
      );

      // maxConcurrent is 3 in this suite's config, so three jobs all run.
      const jobs = Array.from({ length: 3 }, (_, i) => createMockJob(`cancelJob${i}`, handler));

      const promises = jobs.map((job) => executor.executeJob(job));

      await new Promise((resolve) => setTimeout(resolve, 50));
      executor.cancelAllJobs();

      const results = await Promise.all(promises);

      expect(aborted).toBe(3);
      expect(results.every((r) => r.status === 'failure')).toBe(true);
      expect(executor.getRunningJobCount()).toBe(0);
    });

    it('should clear job queue', async () => {
      const handler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      // Fill up concurrent slots
      const jobs = Array.from({ length: 5 }, (_, i) => createMockJob(`queueClearJob${i}`, handler));

      jobs.forEach((job) => executor.executeJob(job));

      await new Promise((resolve) => setTimeout(resolve, 50));

      const _queuedBefore = executor.getQueuedJobCount();
      executor.clearQueue();
      const queuedAfter = executor.getQueuedJobCount();

      expect(queuedAfter).toBe(0);

      executor.cancelAllJobs();
    });
  });

  describe('Job Listeners', () => {
    it('should notify listeners on job start', async () => {
      const listener: IJobListener = {
        onJobStart: vi.fn(),
      };

      const executorWithListener = new SchedulerExecutor(config, [listener]);

      const handler = vi.fn();
      const job = createMockJob('listenerStartJob', handler);

      await executorWithListener.executeJob(job);

      expect(listener.onJobStart).toHaveBeenCalledWith(
        job,
        expect.objectContaining({
          jobId: job.id,
          jobName: job.name,
        })
      );
    });

    it('should notify listeners on job complete', async () => {
      const listener: IJobListener = {
        onJobComplete: vi.fn(),
      };

      const executorWithListener = new SchedulerExecutor(config, [listener]);

      const handler = vi.fn(() => 'result');
      const job = createMockJob('listenerCompleteJob', handler);

      await executorWithListener.executeJob(job);

      expect(listener.onJobComplete).toHaveBeenCalledWith(
        job,
        expect.objectContaining({
          status: 'success',
          result: 'result',
        })
      );
    });

    it('should notify listeners on job error', async () => {
      const listener: IJobListener = {
        onJobError: vi.fn(),
      };

      const executorWithListener = new SchedulerExecutor(config, [listener]);

      const error = new Error('Test error');
      const handler = vi.fn(() => {
        throw error;
      });
      const job = createMockJob('listenerErrorJob', handler, { retry: undefined });

      await executorWithListener.executeJob(job);

      expect(listener.onJobError).toHaveBeenCalledWith(job, error, expect.any(Object));
    });

    it('should notify listeners on retry', async () => {
      const listener: IJobListener = {
        onJobRetry: vi.fn(),
      };

      const executorWithListener = new SchedulerExecutor(config, [listener]);

      let attempts = 0;
      const handler = vi.fn(() => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Retry test');
        }
        return 'success';
      });
      const job = createMockJob('listenerRetryJob', handler, {
        retry: { maxAttempts: 3, delay: 10 },
      });

      await executorWithListener.executeJob(job);

      expect(listener.onJobRetry).toHaveBeenCalled();
    });

    it('should handle listener errors gracefully', async () => {
      const listener: IJobListener = {
        onJobStart: vi.fn(() => {
          throw new Error('Listener error');
        }),
        onJobComplete: vi.fn(() => {
          throw new Error('Listener error');
        }),
      };

      const executorWithListener = new SchedulerExecutor(config, [listener]);

      const handler = vi.fn(() => 'result');
      const job = createMockJob('listenerErrorHandlingJob', handler);

      // Should not throw despite listener errors
      const result = await executorWithListener.executeJob(job);

      expect(result.status).toBe('success');
    });
  });

  describe('Event Emission', () => {
    it('should emit JOB_STARTED event', async () => {
      const eventHandler = vi.fn();
      executor.on(SCHEDULER_EVENTS.JOB_STARTED, eventHandler);

      const handler = vi.fn();
      const job = createMockJob('eventStartJob', handler);

      await executor.executeJob(job);

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          job,
          context: expect.any(Object),
        })
      );
    });

    it('should emit JOB_COMPLETED event', async () => {
      const eventHandler = vi.fn();
      executor.on(SCHEDULER_EVENTS.JOB_COMPLETED, eventHandler);

      const handler = vi.fn(() => 'result');
      const job = createMockJob('eventCompleteJob', handler);

      await executor.executeJob(job);

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          job,
          result: expect.objectContaining({
            status: 'success',
          }),
        })
      );
    });

    it('should emit JOB_FAILED event on error', async () => {
      const eventHandler = vi.fn();
      executor.on(SCHEDULER_EVENTS.JOB_FAILED, eventHandler);

      const handler = vi.fn(() => {
        throw new Error('Test error');
      });
      const job = createMockJob('eventFailJob', handler, { retry: undefined });

      await executor.executeJob(job);

      expect(eventHandler).toHaveBeenCalled();
    });

    it('should allow unsubscribing from events', async () => {
      const eventHandler = vi.fn();
      executor.on(SCHEDULER_EVENTS.JOB_STARTED, eventHandler);
      executor.off(SCHEDULER_EVENTS.JOB_STARTED, eventHandler);

      const handler = vi.fn();
      const job = createMockJob('eventUnsubJob', handler);

      await executor.executeJob(job);

      expect(eventHandler).not.toHaveBeenCalled();
    });
  });

  describe('Disabled Jobs', () => {
    it('should not execute disabled jobs', async () => {
      const handler = vi.fn();
      const job = createMockJob('disabledJob', handler, { disabled: true });

      const result = await executor.executeJob(job);

      expect(result.status).toBe('cancelled');
      expect(handler).not.toHaveBeenCalled();
    });

    it('should return cancelled result for disabled jobs', async () => {
      const handler = vi.fn();
      const job = createMockJob('disabledResultJob', handler, { disabled: true });

      const result = await executor.executeJob(job);

      expect(result.status).toBe('cancelled');
      expect(result.error).toBeUndefined();
      expect(result.result).toBeUndefined();
    });
  });

  describe('Success Handlers', () => {
    it('should call onSuccess handler', async () => {
      const onSuccess = vi.fn();
      const handler = vi.fn(() => 'success result');
      const job = createMockJob('successHandlerJob', handler, { onSuccess });

      await executor.executeJob(job);

      expect(onSuccess).toHaveBeenCalledWith('success result');
    });

    it('should not throw if onSuccess handler fails', async () => {
      const onSuccess = vi.fn(() => {
        throw new Error('onSuccess failed');
      });
      const handler = vi.fn(() => 'result');
      const job = createMockJob('successFailJob', handler, { onSuccess });

      const result = await executor.executeJob(job);

      expect(result.status).toBe('success');
    });
  });
});
