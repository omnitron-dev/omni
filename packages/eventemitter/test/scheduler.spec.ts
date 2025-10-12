import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { EventScheduler } from '../src/scheduler';
import type { ScheduleOptions } from '../src/types';

describe('EventScheduler', () => {
  let scheduler: EventScheduler;
  let emitFn: jest.Mock<(event: string, data: any) => void | Promise<void>>;

  beforeEach(() => {
    scheduler = new EventScheduler();
    emitFn = jest.fn<(event: string, data: any) => void | Promise<void>>();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('schedule', () => {
    it('should schedule event with delay', () => {
      const options: ScheduleOptions = { delay: 1000 };
      const id = scheduler.schedule('test', { data: 'test' }, options, emitFn);

      expect(id).toMatch(/^scheduled_\d+_\d+$/);
      expect(emitFn).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1000);
      expect(emitFn).toHaveBeenCalledWith('test', { data: 'test' });
    });

    it('should schedule event at specific time', () => {
      const futureTime = new Date(Date.now() + 2000);
      const options: ScheduleOptions = { at: futureTime };

      scheduler.schedule('test', { data: 'test' }, options, emitFn);

      jest.advanceTimersByTime(1999);
      expect(emitFn).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(emitFn).toHaveBeenCalledWith('test', { data: 'test' });
    });

    it('should execute immediately if no delay or time specified', () => {
      const options: ScheduleOptions = {};
      scheduler.schedule('test', { data: 'test' }, options, emitFn);

      jest.advanceTimersByTime(0);
      expect(emitFn).toHaveBeenCalledWith('test', { data: 'test' });
    });

    it('should handle past time as immediate execution', () => {
      const pastTime = new Date(Date.now() - 1000);
      const options: ScheduleOptions = { at: pastTime };

      scheduler.schedule('test', { data: 'test' }, options, emitFn);

      jest.advanceTimersByTime(0);
      expect(emitFn).toHaveBeenCalledWith('test', { data: 'test' });
    });

    it('should handle recurring events with cron', () => {
      const options: ScheduleOptions = { cron: '* * * * *' }; // Every minute
      scheduler.schedule('recurring', { data: 'test' }, options, emitFn);

      // Should execute every minute (60000ms)
      jest.advanceTimersByTime(60000);
      expect(emitFn).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(60000);
      expect(emitFn).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(60000);
      expect(emitFn).toHaveBeenCalledTimes(3);
    });

    it('should handle common cron patterns', () => {
      // Test every 5 minutes pattern
      const options: ScheduleOptions = { cron: '*/5 * * * *' };
      scheduler.schedule('every5min', { data: 'test' }, options, emitFn);

      jest.advanceTimersByTime(5 * 60000);
      expect(emitFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancel', () => {
    it('should cancel scheduled event', () => {
      const options: ScheduleOptions = { delay: 1000 };
      const id = scheduler.schedule('test', { data: 'test' }, options, emitFn);

      const cancelled = scheduler.cancel(id);
      expect(cancelled).toBe(true);

      jest.advanceTimersByTime(1000);
      expect(emitFn).not.toHaveBeenCalled();
    });

    it('should return false for non-existent event', () => {
      const cancelled = scheduler.cancel('non-existent');
      expect(cancelled).toBe(false);
    });

    it('should cancel recurring events', () => {
      const options: ScheduleOptions = { cron: '* * * * *' };
      const id = scheduler.schedule('recurring', { data: 'test' }, options, emitFn);

      jest.advanceTimersByTime(60000);
      expect(emitFn).toHaveBeenCalledTimes(1);

      scheduler.cancel(id);
      emitFn.mockClear();

      jest.advanceTimersByTime(60000);
      expect(emitFn).not.toHaveBeenCalled();
    });
  });

  describe('cancelAll', () => {
    it('should cancel all scheduled events', () => {
      scheduler.schedule('event1', { data: 1 }, { delay: 1000 }, emitFn);
      scheduler.schedule('event2', { data: 2 }, { delay: 2000 }, emitFn);
      scheduler.schedule('event3', { data: 3 }, { delay: 3000 }, emitFn);

      scheduler.cancelAll();

      jest.advanceTimersByTime(3000);
      expect(emitFn).not.toHaveBeenCalled();
    });

    it('should clear scheduled events list', () => {
      scheduler.schedule('event1', { data: 1 }, { delay: 1000 }, emitFn);
      scheduler.schedule('event2', { data: 2 }, { delay: 2000 }, emitFn);

      expect(scheduler.getScheduledEvents()).toHaveLength(2);

      scheduler.cancelAll();
      expect(scheduler.getScheduledEvents()).toHaveLength(0);
    });
  });

  describe('getScheduledEvents', () => {
    it('should return all scheduled events', () => {
      scheduler.schedule('event1', { data: 1 }, { delay: 1000 }, emitFn);
      scheduler.schedule('event2', { data: 2 }, { delay: 2000 }, emitFn);

      const events = scheduler.getScheduledEvents();
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        event: 'event1',
        data: { data: 1 },
        status: 'pending',
      });
      expect(events[1]).toMatchObject({
        event: 'event2',
        data: { data: 2 },
        status: 'pending',
      });
    });

    it('should update status when executing', async () => {
      const mockEmitFn = jest.fn<(event: string, data: any) => void>();
      scheduler.schedule('event1', { data: 1 }, { delay: 0 }, mockEmitFn);

      // Execute all timers
      jest.runAllTimers();

      // Wait a bit for async operations
      await Promise.resolve();

      // Event should be removed after execution
      const events = scheduler.getScheduledEvents();
      expect(events).toHaveLength(0);
      expect(mockEmitFn).toHaveBeenCalled();
    });
  });

  describe('getPendingEvents', () => {
    it('should return only pending events', () => {
      scheduler.schedule('event1', { data: 1 }, { delay: 1000 }, emitFn);
      scheduler.schedule('event2', { data: 2 }, { delay: 2000 }, emitFn);

      const pending = scheduler.getPendingEvents();
      expect(pending).toHaveLength(2);
      expect(pending.every((e) => e.status === 'pending')).toBe(true);
    });

    it('should not include cancelled events', () => {
      const id1 = scheduler.schedule('event1', { data: 1 }, { delay: 1000 }, emitFn);
      scheduler.schedule('event2', { data: 2 }, { delay: 2000 }, emitFn);

      scheduler.cancel(id1);

      const pending = scheduler.getPendingEvents();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.event).toBe('event2');
    });
  });

  describe('retry logic', () => {
    it('should retry failed executions with linear backoff', async () => {
      jest.useRealTimers(); // Use real timers for async operations

      let attempts = 0;
      const failingEmitFn = jest.fn<(event: string, data: any) => Promise<void>>(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Failed');
        }
      });

      const options: ScheduleOptions = {
        delay: 0,
        retry: {
          maxAttempts: 3,
          delay: 10,
          backoff: 'linear',
        },
      };

      scheduler.schedule('retry-test', { data: 'test' }, options, failingEmitFn);

      // Wait for retries to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(failingEmitFn).toHaveBeenCalledTimes(3);
      expect(attempts).toBe(3);
    });

    it('should retry with exponential backoff', async () => {
      jest.useRealTimers();

      let attempts = 0;
      const failingEmitFn = jest.fn<(event: string, data: any) => Promise<void>>(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Failed');
        }
      });

      const options: ScheduleOptions = {
        delay: 0,
        retry: {
          maxAttempts: 3,
          delay: 10,
          backoff: 'exponential',
          factor: 2,
        },
      };

      const startTime = Date.now();
      scheduler.schedule('retry-test', { data: 'test' }, options, failingEmitFn);

      // Wait for retries to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(failingEmitFn).toHaveBeenCalledTimes(3);

      // With exponential backoff: first attempt immediate, then 10ms, then 20ms
      const totalTime = Date.now() - startTime;
      expect(totalTime).toBeGreaterThanOrEqual(30);
    });

    it('should respect max delay in retry', async () => {
      jest.useRealTimers();

      let attempts = 0;
      const failingEmitFn = jest.fn<(event: string, data: any) => Promise<void>>(async () => {
        attempts++;
        if (attempts < 4) {
          throw new Error('Failed');
        }
      });

      const options: ScheduleOptions = {
        delay: 0,
        retry: {
          maxAttempts: 4,
          delay: 10,
          backoff: 'exponential',
          factor: 10,
          maxDelay: 50,
        },
      };

      const startTime = Date.now();
      scheduler.schedule('retry-test', { data: 'test' }, options, failingEmitFn);

      // Wait for retries to complete
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(failingEmitFn).toHaveBeenCalledTimes(4);

      // Delays should be capped at maxDelay
      // First attempt: immediate, then 10ms, then 50ms (capped from 100ms), then 50ms (capped from 1000ms)
      const totalTime = Date.now() - startTime;
      expect(totalTime).toBeLessThan(400); // Should be around 110ms + execution time, not 1110ms
    });

    it('should throw error after max attempts', async () => {
      jest.useRealTimers();

      const failingEmitFn = jest.fn<(event: string, data: any) => Promise<void>>(async () => {
        throw new Error('Always fails');
      });

      const options: ScheduleOptions = {
        delay: 0,
        retry: {
          maxAttempts: 2,
          delay: 10,
        },
      };

      scheduler.schedule('retry-test', { data: 'test' }, options, failingEmitFn);

      // Wait for retries to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(failingEmitFn).toHaveBeenCalledTimes(2);
    });

    it('should execute without retry if retry options not provided', async () => {
      jest.useRealTimers();

      const failingEmitFn = jest.fn<(event: string, data: any) => Promise<void>>(async () => {
        throw new Error('Fails once');
      });

      const options: ScheduleOptions = { delay: 0 };

      scheduler.schedule('no-retry', { data: 'test' }, options, failingEmitFn);

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(failingEmitFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('recurring events error handling', () => {
    it('should continue recurring even if individual execution fails', () => {
      let callCount = 0;
      const sometimesFailingFn = jest.fn<(event: string, data: any) => void>(() => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Failed on second call');
        }
      });

      // Mock console.error to suppress error output in tests
      const originalConsoleError = console.error;
      console.error = jest.fn();

      const options: ScheduleOptions = { cron: '* * * * *' };
      scheduler.schedule('recurring', { data: 'test' }, options, sometimesFailingFn);

      jest.advanceTimersByTime(60000);
      expect(sometimesFailingFn).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(60000);
      expect(sometimesFailingFn).toHaveBeenCalledTimes(2); // This one throws

      jest.advanceTimersByTime(60000);
      expect(sometimesFailingFn).toHaveBeenCalledTimes(3); // Should continue

      expect(console.error).toHaveBeenCalled();
      console.error = originalConsoleError;
    });
  });
});
