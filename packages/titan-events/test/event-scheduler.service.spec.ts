/**
 * Tests for EventSchedulerService
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import 'reflect-metadata';
import { EventSchedulerService } from '../src/event-scheduler.service';

// EV-1: mock node-cron so we can verify the cron EXPRESSION that gets scheduled
// and simulate fires deterministically (real node-cron's timing isn't driven by
// vitest fake timers, unlike the old parseCronInterval→setInterval fake-cron).
const { cronState } = vi.hoisted(() => ({
  cronState: { tasks: [] as Array<{ expr: string; fn: () => void; started: boolean; stopped: boolean }> },
}));
vi.mock('node-cron', () => ({
  validate: (expr: string) => typeof expr === 'string' && expr.trim().split(/\s+/).length >= 5,
  schedule: (expr: string, fn: () => void) => {
    const task = {
      expr,
      fn,
      started: false,
      stopped: false,
      start() {
        this.started = true;
      },
      stop() {
        this.stopped = true;
      },
    };
    cronState.tasks.push(task);
    return task;
  },
}));

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
    cronState.tasks.length = 0;
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

  it('should schedule recurring events as a real node-cron task', () => {
    const handler = vi.fn();
    schedulerService.onScheduledEvent('recurring.event', handler);

    const jobId = schedulerService.scheduleRecurring('recurring.event', { data: 'test' }, 1000);

    // scheduleRecurring converts the interval to a cron expr scheduled via node-cron.
    expect(cronState.tasks).toHaveLength(1);
    expect(cronState.tasks[0]!.started).toBe(true);

    // Simulate three cron fires → the handler receives the event each time.
    cronState.tasks[0]!.fn();
    cronState.tasks[0]!.fn();
    cronState.tasks[0]!.fn();
    expect(handler).toHaveBeenCalledTimes(3);

    // cancel stops the underlying cron task.
    schedulerService.cancelJob(jobId);
    expect(cronState.tasks[0]!.stopped).toBe(true);
  });

  it('should schedule cron-based events with the real cron expression', () => {
    const handler = vi.fn();
    schedulerService.onScheduledEvent('cron.event', handler);

    schedulerService.scheduleCron('cron.event', { data: 'test' }, '* * * * *');

    // Scheduled with the REAL cron expression (not a fixed-interval approximation).
    expect(cronState.tasks).toHaveLength(1);
    expect(cronState.tasks[0]!.expr).toBe('* * * * *');

    cronState.tasks[0]!.fn();
    cronState.tasks[0]!.fn();
    cronState.tasks[0]!.fn();
    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler).toHaveBeenCalledWith({ data: 'test' });
  });

  it('rejects an invalid cron expression', () => {
    expect(() => schedulerService.scheduleCron('bad.event', {}, 'not-a-cron')).toThrow();
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
