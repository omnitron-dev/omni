/**
 * Scheduler Events Integration Test
 * Tests the scheduler event bus integration for lifecycle events
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SchedulerService } from '../../../src/modules/scheduler/scheduler.service.js';
import { SchedulerRegistry } from '../../../src/modules/scheduler/scheduler.registry.js';
import { SchedulerExecutor } from '../../../src/modules/scheduler/scheduler.executor.js';
import { SCHEDULER_EVENTS } from '../../../src/modules/scheduler/scheduler.constants.js';
import type { ISchedulerConfig } from '../../../src/modules/scheduler/scheduler.interfaces.js';

describe('Scheduler Events Integration', () => {
  let scheduler: SchedulerService;
  let registry: SchedulerRegistry;
  let executor: SchedulerExecutor;
  let eventListeners: Map<string, Function[]>;

  beforeEach(() => {
    // Create fresh instances
    const config: ISchedulerConfig = {
      enabled: true,
      maxConcurrent: 5,
      queueSize: 100,
      shutdownTimeout: 5000,
    };

    registry = new SchedulerRegistry(config);
    executor = new SchedulerExecutor(config);
    scheduler = new SchedulerService(registry, executor, config);

    // Track event listeners
    eventListeners = new Map();
  });

  afterEach(async () => {
    if (scheduler) {
      try {
        await scheduler.onStop();
      } catch (_err) {
        // Ignore errors during cleanup
      }
    }
  });

  describe('Scheduler Lifecycle Events', () => {
    it('should emit SCHEDULER_STARTED event when scheduler starts', async () => {
      const startedHandler = vi.fn();
      registry.on(SCHEDULER_EVENTS.SCHEDULER_STARTED, startedHandler);

      await scheduler.onStart();

      expect(startedHandler).toHaveBeenCalledTimes(1);
      expect(startedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(Date),
          jobCount: expect.any(Number),
        })
      );
    });

    it('should emit SCHEDULER_STOPPED event when scheduler stops', async () => {
      const stoppedHandler = vi.fn();
      registry.on(SCHEDULER_EVENTS.SCHEDULER_STOPPED, stoppedHandler);

      await scheduler.onStart();
      await scheduler.onStop();

      expect(stoppedHandler).toHaveBeenCalledTimes(1);
      expect(stoppedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(Date),
        })
      );
    });

    it('should emit both start and stop events in sequence', async () => {
      const events: string[] = [];

      registry.on(SCHEDULER_EVENTS.SCHEDULER_STARTED, () => {
        events.push('started');
      });

      registry.on(SCHEDULER_EVENTS.SCHEDULER_STOPPED, () => {
        events.push('stopped');
      });

      await scheduler.onStart();
      await scheduler.onStop();

      expect(events).toEqual(['started', 'stopped']);
    });

    it('should include job count in SCHEDULER_STARTED event', async () => {
      let jobCount: number | undefined;

      registry.on(SCHEDULER_EVENTS.SCHEDULER_STARTED, (data: any) => {
        jobCount = data.jobCount;
      });

      await scheduler.onStart();

      expect(jobCount).toBeDefined();
      expect(typeof jobCount).toBe('number');
      expect(jobCount).toBeGreaterThanOrEqual(0);
    });

    it('should allow multiple listeners on the same event', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      registry.on(SCHEDULER_EVENTS.SCHEDULER_STARTED, handler1);
      registry.on(SCHEDULER_EVENTS.SCHEDULER_STARTED, handler2);
      registry.on(SCHEDULER_EVENTS.SCHEDULER_STARTED, handler3);

      await scheduler.onStart();

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
      expect(handler3).toHaveBeenCalledTimes(1);
    });

    it('should allow unsubscribing from events', async () => {
      const handler = vi.fn();

      registry.on(SCHEDULER_EVENTS.SCHEDULER_STARTED, handler);
      registry.off(SCHEDULER_EVENTS.SCHEDULER_STARTED, handler);

      await scheduler.onStart();

      expect(handler).not.toHaveBeenCalled();
    });

    it('should emit events with valid timestamps', async () => {
      let startTimestamp: Date | undefined;
      let stopTimestamp: Date | undefined;

      registry.on(SCHEDULER_EVENTS.SCHEDULER_STARTED, (data: any) => {
        startTimestamp = data.timestamp;
      });

      registry.on(SCHEDULER_EVENTS.SCHEDULER_STOPPED, (data: any) => {
        stopTimestamp = data.timestamp;
      });

      await scheduler.onStart();
      await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay
      await scheduler.onStop();

      expect(startTimestamp).toBeInstanceOf(Date);
      expect(stopTimestamp).toBeInstanceOf(Date);
      expect(stopTimestamp!.getTime()).toBeGreaterThan(startTimestamp!.getTime());
    });
  });

  describe('Registry Event Methods', () => {
    it('should expose emit method on registry', () => {
      expect(registry.emit).toBeDefined();
      expect(typeof registry.emit).toBe('function');
    });

    it('should expose on method on registry', () => {
      expect(registry.on).toBeDefined();
      expect(typeof registry.on).toBe('function');
    });

    it('should expose off method on registry', () => {
      expect(registry.off).toBeDefined();
      expect(typeof registry.off).toBe('function');
    });

    it('should allow custom events to be emitted', () => {
      const handler = vi.fn();
      const customEvent = 'custom:event:test';
      const eventData = { foo: 'bar', timestamp: new Date() };

      registry.on(customEvent, handler);
      registry.emit(customEvent, eventData);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(eventData);
    });
  });
});
