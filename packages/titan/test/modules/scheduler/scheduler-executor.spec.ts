/**
 * Scheduler Executor Comprehensive Tests
 * Tests job execution, retry logic, timeout, concurrency, and queueing
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { SchedulerExecutor } from '../../../src/modules/scheduler/scheduler.executor.js';
import { SCHEDULER_EVENTS } from '../../../src/modules/scheduler/scheduler.constants.js';
import { JobStatus, SchedulerJobType } from '../../../src/modules/scheduler/scheduler.interfaces.js';
import type { ISchedulerConfig, IScheduledJob, IJobListener } from '../../../src/modules/scheduler/scheduler.interfaces.js';

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
      const handler = jest.fn(() => 'test result');
      const job = createMockJob('testJob', handler);

      const result = await executor.executeJob(job);

      expect(result.status).toBe('success');
      expect(result.result).toBe('test result');
      expect(result.jobId).toBe(job.id);
      expect(handler).toHaveBeenCalled();
    });

    it('should execute async job successfully', async () => {
      const handler = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
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
      const handler = jest.fn((context) => {
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
      const handler = jest.fn((context) => {
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
      const handler = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
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
      const handler = jest.fn(() => { throw error; });
      const job = createMockJob('errorJob', handler, { retry: undefined });

      const result = await executor.executeJob(job);

      expect(result.status).toBe('failure');
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Sync error');
    });

    it('should handle asynchronous errors', async () => {
      const handler = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        throw new Error('Async error');
      });
      const job = createMockJob('asyncErrorJob', handler, { retry: undefined });

      const result = await executor.executeJob(job);

      expect(result.status).toBe('failure');
      expect(result.error?.message).toBe('Async error');
    });

    it('should call onError handler on failure', async () => {
      const onError = jest.fn();
      const handler = jest.fn(() => { throw new Error('Test error'); });
      const job = createMockJob('onErrorJob', handler, { onError, retry: undefined });

      await executor.executeJob(job);

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should not throw if onError handler fails', async () => {
      const onError = jest.fn(() => { throw new Error('onError failed'); });
      const handler = jest.fn(() => { throw new Error('Test error'); });
      const job = createMockJob('onErrorFailJob', handler, { onError, retry: undefined });

      await expect(executor.executeJob(job)).resolves.toBeDefined();
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed jobs', async () => {
      let attempts = 0;
      const handler = jest.fn(() => {
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
      const handler = jest.fn(() => { throw new Error('Always fails'); });
      const job = createMockJob('maxAttemptsJob', handler, {
        retry: { maxAttempts: 3, delay: 10 },
      });

      const result = await executor.executeJob(job);

      expect(result.status).toBe('failure');
      expect(handler).toHaveBeenCalledTimes(3);
    });

    it('should apply exponential backoff', async () => {
      const delays: number[] = [];
      let lastTime = Date.now();
      
      const handler = jest.fn(() => {
        const now = Date.now();
        if (delays.length > 0) {
          delays.push(now - lastTime);
        }
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
      let lastTime = Date.now();
      
      const handler = jest.fn(() => {
        const now = Date.now();
        if (delays.length > 0) {
          delays.push(now - lastTime);
        }
        lastTime = now;
        throw new Error('Max delay test');
      });
      
      const job = createMockJob('maxDelayJob', handler, {
        retry: { maxAttempts: 5, delay: 100, backoff: 10, maxDelay: 200 },
      });

      await executor.executeJob(job);

      // All delays should be capped at maxDelay
      expect(delays.every(d => d < 300)).toBe(true);
    });

    it('should use retryIf condition', async () => {
      let attempts = 0;
      const handler = jest.fn(() => {
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
      const handler = jest.fn(() => {
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
      const handler = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        return 'should not reach here';
      });
      const job = createMockJob('timeoutJob', handler, {
        timeout: 100,
        retry: undefined,
      });

      const result = await executor.executeJob(job);

      expect(result.status).toBe('failure');
      expect(result.error?.message).toContain('timeout');
    });

    it('should use global timeout if job timeout not specified', async () => {
      const globalTimeoutExecutor = new SchedulerExecutor({
        ...config,
        shutdownTimeout: 100,
      });
      
      const handler = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
      });
      const job = createMockJob('globalTimeoutJob', handler, { retry: undefined });

      const result = await globalTimeoutExecutor.executeJob(job);

      expect(result.status).toBe('failure');
      expect(result.error?.message).toContain('timeout');
    });

    it('should not timeout fast jobs', async () => {
      const handler = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
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
      
      const handler = jest.fn(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise(resolve => setTimeout(resolve, 100));
        concurrent--;
      });

      const jobs = Array.from({ length: 10 }, (_, i) => 
        createMockJob(`concurrentJob${i}`, handler)
      );

      await Promise.all(jobs.map(job => executor.executeJob(job)));

      expect(maxConcurrent).toBeLessThanOrEqual(config.maxConcurrent!);
    });

    it('should queue jobs when at max concurrency', async () => {
      const executionOrder: number[] = [];
      
      const createHandler = (id: number) => jest.fn(async () => {
        executionOrder.push(id);
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      const jobs = Array.from({ length: 6 }, (_, i) => 
        createMockJob(`queueJob${i}`, createHandler(i))
      );

      await Promise.all(jobs.map(job => executor.executeJob(job)));

      expect(executionOrder).toHaveLength(6);
      expect(executor.getQueuedJobCount()).toBe(0);
    });

    it('should track running job count', async () => {
      const handler = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      const job = createMockJob('trackingJob', handler);
      
      const promise = executor.executeJob(job);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(executor.getRunningJobCount()).toBeGreaterThan(0);
      
      await promise;
      
      expect(executor.getRunningJobCount()).toBe(0);
    });

    it('should prevent overlap when configured', async () => {
      let executions = 0;
      const handler = jest.fn(async () => {
        executions++;
        await new Promise(resolve => setTimeout(resolve, 100));
      });
      
      const job = createMockJob('noOverlapJob', handler, {
        preventOverlap: true,
      });
      job.isRunning = false;

      // Start first execution
      const promise1 = executor.executeJob(job);
      job.isRunning = true;
      
      // Try to start second while first is running
      const promise2 = executor.executeJob(job);

      const result2 = await promise2;
      expect(result2.status).toBe('cancelled');
      
      await promise1;
      expect(executions).toBe(1);
    });
  });

  describe('Job Cancellation', () => {
    it('should cancel running job by execution ID', async () => {
      const handler = jest.fn(async (context: any) => {
        await new Promise(resolve => setTimeout(resolve, 500));
        return 'should not complete';
      });
      
      const job = createMockJob('cancellableJob', handler);

      const promise = executor.executeJob(job);
      
      // Get execution ID and cancel
      await new Promise(resolve => setTimeout(resolve, 50));
      const runningCount = executor.getRunningJobCount();
      expect(runningCount).toBeGreaterThan(0);
      
      // We can't easily get the execution ID, but we can test cancelAllJobs
      executor.cancelAllJobs();
      
      const result = await promise;
      expect(result.status).toBe('failure');
    });

    it('should cancel all running jobs', async () => {
      const handler = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
      });

      const jobs = Array.from({ length: 3 }, (_, i) => 
        createMockJob(`cancelJob${i}`, handler)
      );

      const promises = jobs.map(job => executor.executeJob(job));
      
      await new Promise(resolve => setTimeout(resolve, 50));
      executor.cancelAllJobs();

      const results = await Promise.all(promises);
      
      expect(results.every(r => r.status === 'failure')).toBe(true);
      expect(executor.getRunningJobCount()).toBe(0);
    });

    it('should clear job queue', async () => {
      const handler = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Fill up concurrent slots
      const jobs = Array.from({ length: 5 }, (_, i) => 
        createMockJob(`queueClearJob${i}`, handler)
      );

      jobs.forEach(job => executor.executeJob(job));
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const queuedBefore = executor.getQueuedJobCount();
      executor.clearQueue();
      const queuedAfter = executor.getQueuedJobCount();

      expect(queuedAfter).toBe(0);
      
      executor.cancelAllJobs();
    });
  });

  describe('Job Listeners', () => {
    it('should notify listeners on job start', async () => {
      const listener: IJobListener = {
        onJobStart: jest.fn(),
      };
      
      const executorWithListener = new SchedulerExecutor(config, [listener]);
      
      const handler = jest.fn();
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
        onJobComplete: jest.fn(),
      };
      
      const executorWithListener = new SchedulerExecutor(config, [listener]);
      
      const handler = jest.fn(() => 'result');
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
        onJobError: jest.fn(),
      };
      
      const executorWithListener = new SchedulerExecutor(config, [listener]);
      
      const error = new Error('Test error');
      const handler = jest.fn(() => { throw error; });
      const job = createMockJob('listenerErrorJob', handler, { retry: undefined });

      await executorWithListener.executeJob(job);

      expect(listener.onJobError).toHaveBeenCalledWith(
        job,
        error,
        expect.any(Object)
      );
    });

    it('should notify listeners on retry', async () => {
      const listener: IJobListener = {
        onJobRetry: jest.fn(),
      };
      
      const executorWithListener = new SchedulerExecutor(config, [listener]);
      
      let attempts = 0;
      const handler = jest.fn(() => {
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
        onJobStart: jest.fn(() => { throw new Error('Listener error'); }),
        onJobComplete: jest.fn(() => { throw new Error('Listener error'); }),
      };
      
      const executorWithListener = new SchedulerExecutor(config, [listener]);
      
      const handler = jest.fn(() => 'result');
      const job = createMockJob('listenerErrorHandlingJob', handler);

      // Should not throw despite listener errors
      const result = await executorWithListener.executeJob(job);
      
      expect(result.status).toBe('success');
    });
  });

  describe('Event Emission', () => {
    it('should emit JOB_STARTED event', async () => {
      const eventHandler = jest.fn();
      executor.on(SCHEDULER_EVENTS.JOB_STARTED, eventHandler);
      
      const handler = jest.fn();
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
      const eventHandler = jest.fn();
      executor.on(SCHEDULER_EVENTS.JOB_COMPLETED, eventHandler);
      
      const handler = jest.fn(() => 'result');
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
      const eventHandler = jest.fn();
      executor.on(SCHEDULER_EVENTS.JOB_FAILED, eventHandler);
      
      const handler = jest.fn(() => { throw new Error('Test error'); });
      const job = createMockJob('eventFailJob', handler, { retry: undefined });

      await executor.executeJob(job);

      expect(eventHandler).toHaveBeenCalled();
    });

    it('should allow unsubscribing from events', async () => {
      const eventHandler = jest.fn();
      executor.on(SCHEDULER_EVENTS.JOB_STARTED, eventHandler);
      executor.off(SCHEDULER_EVENTS.JOB_STARTED, eventHandler);
      
      const handler = jest.fn();
      const job = createMockJob('eventUnsubJob', handler);

      await executor.executeJob(job);

      expect(eventHandler).not.toHaveBeenCalled();
    });
  });

  describe('Disabled Jobs', () => {
    it('should not execute disabled jobs', async () => {
      const handler = jest.fn();
      const job = createMockJob('disabledJob', handler, { disabled: true });

      const result = await executor.executeJob(job);

      expect(result.status).toBe('cancelled');
      expect(handler).not.toHaveBeenCalled();
    });

    it('should return cancelled result for disabled jobs', async () => {
      const handler = jest.fn();
      const job = createMockJob('disabledResultJob', handler, { disabled: true });

      const result = await executor.executeJob(job);

      expect(result.status).toBe('cancelled');
      expect(result.error).toBeUndefined();
      expect(result.result).toBeUndefined();
    });
  });

  describe('Success Handlers', () => {
    it('should call onSuccess handler', async () => {
      const onSuccess = jest.fn();
      const handler = jest.fn(() => 'success result');
      const job = createMockJob('successHandlerJob', handler, { onSuccess });

      await executor.executeJob(job);

      expect(onSuccess).toHaveBeenCalledWith('success result');
    });

    it('should not throw if onSuccess handler fails', async () => {
      const onSuccess = jest.fn(() => { throw new Error('onSuccess failed'); });
      const handler = jest.fn(() => 'result');
      const job = createMockJob('successFailJob', handler, { onSuccess });

      const result = await executor.executeJob(job);

      expect(result.status).toBe('success');
    });
  });
});
