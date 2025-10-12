import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { EventScheduler } from '../src/scheduler';

describe('EventScheduler - Error Handling', () => {
  let scheduler: EventScheduler;

  beforeEach(() => {
    scheduler = new EventScheduler();
  });

  afterEach(() => {
    scheduler.cancelAll();
  });

  describe('Synchronous errors', () => {
    it('should handle synchronous errors in emit function', async () => {
      const errorEmitFn = jest.fn(() => {
        throw new Error('Sync error');
      });

      scheduler.schedule('sync-error', { data: 'test' }, { delay: 0 }, errorEmitFn);

      // Wait for execution
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(errorEmitFn).toHaveBeenCalled();
      expect(scheduler.getScheduledEvents()).toHaveLength(0);
    });

    it('should clean up after multiple synchronous errors', async () => {
      const errorEmitFn1 = jest.fn(() => {
        throw new Error('Error 1');
      });
      const errorEmitFn2 = jest.fn(() => {
        throw new Error('Error 2');
      });

      scheduler.schedule('error1', { data: 'test1' }, { delay: 0 }, errorEmitFn1);
      scheduler.schedule('error2', { data: 'test2' }, { delay: 0 }, errorEmitFn2);

      // Wait for execution
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(errorEmitFn1).toHaveBeenCalled();
      expect(errorEmitFn2).toHaveBeenCalled();
      expect(scheduler.getScheduledEvents()).toHaveLength(0);
    });
  });

  describe('Asynchronous errors', () => {
    it('should handle async errors in emit function', async () => {
      const asyncErrorEmitFn = jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error('Async error');
      });

      scheduler.schedule('async-error', { data: 'test' }, { delay: 0 }, asyncErrorEmitFn);

      // Wait for async execution to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(asyncErrorEmitFn).toHaveBeenCalled();
      expect(scheduler.getScheduledEvents()).toHaveLength(0);
    });

    it('should handle rejected promises', async () => {
      const rejectedEmitFn = jest.fn(() => Promise.reject(new Error('Rejected')));

      scheduler.schedule('rejected', { data: 'test' }, { delay: 0 }, rejectedEmitFn);

      // Wait for execution
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(rejectedEmitFn).toHaveBeenCalled();
      expect(scheduler.getScheduledEvents()).toHaveLength(0);
    });
  });

  describe('Error handling with retries', () => {
    it('should retry on error and eventually clean up', async () => {
      let attempts = 0;
      const retryEmitFn = jest.fn(async () => {
        attempts++;
        throw new Error(`Attempt ${attempts}`);
      });

      scheduler.schedule(
        'retry-error',
        { data: 'test' },
        {
          delay: 0,
          retry: {
            maxAttempts: 3,
            delay: 10,
            backoff: 'linear',
          },
        },
        retryEmitFn
      );

      // Wait for all retries to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(retryEmitFn).toHaveBeenCalledTimes(3);
      expect(scheduler.getScheduledEvents()).toHaveLength(0);
    });

    it('should succeed after retries and clean up', async () => {
      let attempts = 0;
      const eventualSuccessEmitFn = jest.fn(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Not yet');
        }
        // Success on second attempt
      });

      scheduler.schedule(
        'eventual-success',
        { data: 'test' },
        {
          delay: 0,
          retry: {
            maxAttempts: 3,
            delay: 10,
            backoff: 'linear',
          },
        },
        eventualSuccessEmitFn
      );

      // Wait for retries
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(eventualSuccessEmitFn).toHaveBeenCalledTimes(2);
      expect(scheduler.getScheduledEvents()).toHaveLength(0);
    });
  });

  describe('Event status tracking', () => {
    it('should track status correctly during execution', async () => {
      const slowEmitFn = jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      const id = scheduler.schedule('slow-event', { data: 'test' }, { delay: 0 }, slowEmitFn);

      // Check initial status
      let events = scheduler.getScheduledEvents();
      expect(events).toHaveLength(1);
      expect(events[0]?.status).toBe('pending');

      // Wait a bit and check status during execution
      await new Promise((resolve) => setTimeout(resolve, 10));
      events = scheduler.getScheduledEvents();
      if (events.length > 0) {
        expect(events[0]?.status).toBe('executing');
      }

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 30));
      events = scheduler.getScheduledEvents();
      expect(events).toHaveLength(0);
    });

    it('should handle cancelled events correctly', () => {
      const neverCalledEmitFn = jest.fn<(event: string, data: any) => void>();

      const id = scheduler.schedule('cancelled-event', { data: 'test' }, { delay: 1000 }, neverCalledEmitFn);

      // Cancel before execution
      const cancelled = scheduler.cancel(id);
      expect(cancelled).toBe(true);

      expect(scheduler.getScheduledEvents()).toHaveLength(0);
      expect(neverCalledEmitFn).not.toHaveBeenCalled();
    });
  });

  describe('Concurrent event handling', () => {
    it('should handle multiple concurrent events with mixed results', async () => {
      const successEmitFn = jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      const errorEmitFn = jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error('Concurrent error');
      });

      scheduler.schedule('success1', { data: 'test1' }, { delay: 0 }, successEmitFn);
      scheduler.schedule('error1', { data: 'test2' }, { delay: 0 }, errorEmitFn);
      scheduler.schedule('success2', { data: 'test3' }, { delay: 0 }, successEmitFn);
      scheduler.schedule('error2', { data: 'test4' }, { delay: 0 }, errorEmitFn);

      // Wait for all to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(successEmitFn).toHaveBeenCalledTimes(2);
      expect(errorEmitFn).toHaveBeenCalledTimes(2);
      expect(scheduler.getScheduledEvents()).toHaveLength(0);
    });
  });

  describe('Edge cases', () => {
    it('should handle emit function that returns undefined', async () => {
      const undefinedEmitFn = jest.fn<(event: string, data: any) => void>(() => undefined);

      scheduler.schedule('undefined-return', { data: 'test' }, { delay: 0 }, undefinedEmitFn);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(undefinedEmitFn).toHaveBeenCalled();
      expect(scheduler.getScheduledEvents()).toHaveLength(0);
    });

    it('should handle emit function that returns a value', async () => {
      const valueEmitFn = jest.fn<(event: string, data: any) => void>(() => {
        // Return value is ignored, but function executes
      });

      scheduler.schedule('value-return', { data: 'test' }, { delay: 0 }, valueEmitFn);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(valueEmitFn).toHaveBeenCalled();
      expect(scheduler.getScheduledEvents()).toHaveLength(0);
    });

    it('should handle very long-running emit functions', async () => {
      const longRunningEmitFn = jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      scheduler.schedule('long-running', { data: 'test' }, { delay: 0 }, longRunningEmitFn);

      // Check that event is in executing state
      await new Promise((resolve) => setTimeout(resolve, 50));
      let events = scheduler.getScheduledEvents();
      if (events.length > 0) {
        expect(events[0]?.status).toBe('executing');
      }

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 100));
      events = scheduler.getScheduledEvents();
      expect(events).toHaveLength(0);
    });
  });
});
