/**
 * Tests for EventSchedulerService
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import 'reflect-metadata';
import { EventSchedulerService } from '../src/event-scheduler.service';

describe('EventSchedulerService', () => {
  let schedulerService: EventSchedulerService;
  let mockEmitter: any;

  beforeEach(() => {
    // Create a more functional mock emitter that actually connects on/emit
    const eventHandlers = new Map<string, Array<Function>>();

    mockEmitter = {
      emit: vi.fn((event: string, data: any) => {
        const handlers = eventHandlers.get(event) || [];
        handlers.forEach((handler) => handler(data));
        return true;
      }),
      on: vi.fn((event: string, handler: Function) => {
        if (!eventHandlers.has(event)) {
          eventHandlers.set(event, []);
        }
        eventHandlers.get(event)!.push(handler);
      }),
      off: vi.fn((event: string, handler: Function) => {
        const handlers = eventHandlers.get(event);
        if (handlers) {
          const index = handlers.indexOf(handler);
          if (index !== -1) {
            handlers.splice(index, 1);
          }
        }
      }),
      once: vi.fn(),
      removeAllListeners: vi.fn(),
      listeners: vi.fn().mockReturnValue([]),
      eventNames: vi.fn().mockReturnValue([]),
    };

    schedulerService = new EventSchedulerService(mockEmitter);
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (schedulerService && typeof schedulerService.onDestroy === 'function') {
      schedulerService.onDestroy();
    }
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('should schedule delayed events', () => {
    const handler = vi.fn();
    schedulerService.onScheduledEvent('delayed.event', handler);

    schedulerService.scheduleEvent('delayed.event', { data: 'test' }, 1000);

    expect(handler).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(handler).toHaveBeenCalledWith({ data: 'test' });
  });

  it('should schedule recurring events', () => {
    const handler = vi.fn();
    schedulerService.onScheduledEvent('recurring.event', handler);

    const jobId = schedulerService.scheduleRecurring('recurring.event', { data: 'test' }, 1000);

    vi.advanceTimersByTime(3500);
    expect(handler).toHaveBeenCalledTimes(3);

    schedulerService.cancelJob(jobId);
    vi.advanceTimersByTime(2000);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('should schedule cron-based events', () => {
    const handler = vi.fn();
    schedulerService.onScheduledEvent('cron.event', handler);

    // Every minute
    schedulerService.scheduleCron('cron.event', { data: 'test' }, '* * * * *');

    // Simulate 3 minutes passing
    vi.advanceTimersByTime(3 * 60 * 1000);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('should cancel scheduled jobs', () => {
    const handler = vi.fn();
    schedulerService.onScheduledEvent('cancel.event', handler);

    const jobId = schedulerService.scheduleEvent('cancel.event', { data: 'test' }, 1000);
    schedulerService.cancelJob(jobId);

    vi.advanceTimersByTime(2000);
    expect(handler).not.toHaveBeenCalled();
  });

  it('should list active jobs', () => {
    const job1 = schedulerService.scheduleEvent('job1', {}, 1000);
    const job2 = schedulerService.scheduleEvent('job2', {}, 2000);

    const jobs = schedulerService.getActiveJobs();
    expect(jobs).toContain(job1);
    expect(jobs).toContain(job2);

    schedulerService.cancelJob(job1);
    const updatedJobs = schedulerService.getActiveJobs();
    expect(updatedJobs).not.toContain(job1);
    expect(updatedJobs).toContain(job2);
  });
});
