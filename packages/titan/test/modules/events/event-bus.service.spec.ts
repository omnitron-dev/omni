/**
 * Tests for EventBusService
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

import { EventBusService } from '../../../src/modules/events/event-bus.service';

describe('EventBusService', () => {
  let service: EventBusService;
  let mockLogger: any;
  let mockEmitter: any;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    // Create a mock emitter that matches the expected interface
    mockEmitter = {
      subscribe: jest.fn().mockReturnValue(jest.fn()), // Returns unsubscribe function
      emitParallel: jest.fn().mockResolvedValue([]),
      emitSequential: jest.fn().mockResolvedValue([]),
      off: jest.fn(),
      removeAllListeners: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
      listeners: jest.fn().mockReturnValue([]),
      listenerCount: jest.fn().mockReturnValue(0),
      eventNames: jest.fn().mockReturnValue([]),
    };

    service = new EventBusService(mockEmitter, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      await service.onInit();
      expect(mockLogger.info).toHaveBeenCalledWith('EventBusService initialized');
    });
  });

  describe('Event Emission', () => {
    it('should emit events', async () => {
      await service.onInit();
      const handler = jest.fn();

      service.on('test.event', handler);
      await service.emit('test.event', { data: 'test' });

      expect(handler).toHaveBeenCalledWith({ data: 'test' }, expect.any(Object));
    });

    it('should emit events with metadata', async () => {
      await service.onInit();
      const handler = jest.fn();

      service.on('test.event', handler);
      await service.emit('test.event', { data: 'test' }, { source: 'test' });

      expect(handler).toHaveBeenCalledWith(
        { data: 'test' },
        expect.objectContaining({
          timestamp: expect.any(Number),
          source: 'test',
        })
      );
    });

    it('should handle multiple listeners', async () => {
      await service.onInit();
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      service.on('test.event', handler1);
      service.on('test.event', handler2);
      await service.emit('test.event', { data: 'test' });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('Event Patterns', () => {
    it('should support wildcard patterns', async () => {
      await service.onInit();
      const handler = jest.fn();

      service.on('user.*', handler);
      await service.emit('user.created', { id: 1 });
      await service.emit('user.updated', { id: 2 });

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should support once listeners', async () => {
      await service.onInit();
      const handler = jest.fn();

      service.once('test.event', handler);
      await service.emit('test.event', { data: 1 });
      await service.emit('test.event', { data: 2 });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ data: 1 }, expect.any(Object));
    });
  });

  describe('Error Handling', () => {
    it('should handle listener errors', async () => {
      await service.onInit();
      const errorHandler = jest.fn();
      const normalHandler = jest.fn();

      service.on('test.event', () => {
        throw new Error('Handler error');
      });
      service.on('test.event', normalHandler);
      service.on('error', errorHandler);

      await service.emit('test.event', { data: 'test' });

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Handler error',
        })
      );
      expect(normalHandler).toHaveBeenCalled(); // Other handlers should still run
    });

    it('should handle async listener errors', async () => {
      await service.onInit();
      const errorHandler = jest.fn();

      service.on('test.event', async () => {
        throw new Error('Async handler error');
      });
      service.on('error', errorHandler);

      await service.emit('test.event', { data: 'test' });

      // Allow async error to propagate
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Async handler error',
        })
      );
    });
  });

  describe('Subscription Management', () => {
    it('should remove listeners', async () => {
      await service.onInit();
      const handler = jest.fn();

      service.on('test.event', handler);
      service.off('test.event', handler);
      await service.emit('test.event', { data: 'test' });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should remove all listeners for an event', async () => {
      await service.onInit();
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      service.on('test.event', handler1);
      service.on('test.event', handler2);
      service.off('test.event');
      await service.emit('test.event', { data: 'test' });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });

    it('should list all event names', async () => {
      await service.onInit();

      service.on('event1', jest.fn());
      service.on('event2', jest.fn());
      service.on('event3', jest.fn());

      const events = service.eventNames();
      expect(events).toContain('event1');
      expect(events).toContain('event2');
      expect(events).toContain('event3');
    });

    it('should count listeners', async () => {
      await service.onInit();

      service.on('test.event', jest.fn());
      service.on('test.event', jest.fn());
      service.on('test.event', jest.fn());

      const count = service.listenerCount('test.event');
      expect(count).toBe(3);
    });
  });

  describe('Parallel and Sequential Execution', () => {
    it('should emit events in parallel', async () => {
      await service.onInit();
      const results: number[] = [];

      service.on('test.event', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        results.push(1);
      });

      service.on('test.event', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        results.push(2);
      });

      const start = Date.now();
      await service.emitParallel('test.event', {});
      const duration = Date.now() - start;

      // Should complete in ~50ms (parallel), not ~60ms (sequential)
      expect(duration).toBeLessThan(60);
      expect(results).toEqual([2, 1]); // Faster one completes first
    });

    it('should emit events sequentially', async () => {
      await service.onInit();
      const results: number[] = [];

      service.on('test.event', async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        results.push(1);
      });

      service.on('test.event', async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        results.push(2);
      });

      const start = Date.now();
      await service.emitSequential('test.event', {});
      const duration = Date.now() - start;

      // Should complete in ~40ms (sequential)
      expect(duration).toBeGreaterThanOrEqual(40);
      expect(results).toEqual([1, 2]); // In order
    });
  });

  describe('Reduce Pattern', () => {
    it('should reduce event results', async () => {
      await service.onInit();

      service.on('calculate', (data: any) => data.value * 2);
      service.on('calculate', (data: any) => data.value * 3);
      service.on('calculate', (data: any) => data.value * 4);

      const result = await service.emitReduce('calculate', { value: 1 }, (acc, curr) => acc + curr, 0);

      expect(result).toBe(9); // 2 + 3 + 4
    });

    it('should handle empty reduce', async () => {
      await service.onInit();

      const result = await service.emitReduce('no.listeners', {}, (acc, curr) => acc + curr, 10);

      expect(result).toBe(10); // Initial value
    });
  });

  describe('Cleanup', () => {
    it('should destroy properly', async () => {
      await service.onInit();

      service.on('test.event', jest.fn());
      service.on('another.event', jest.fn());

      await service.onDestroy();

      expect(mockLogger.info).toHaveBeenCalledWith('EventBusService destroyed');
      expect(service.eventNames()).toEqual([]);
    });
  });

  describe('Health Check', () => {
    it('should report healthy status', async () => {
      await service.onInit();

      const health = await service.health();

      expect(health.status).toBe('healthy');
      expect(health.details).toEqual({
        eventCount: 0,
        listenerCount: 0,
      });
    });

    it('should include event stats in health', async () => {
      await service.onInit();

      service.on('event1', jest.fn());
      service.on('event1', jest.fn());
      service.on('event2', jest.fn());

      await service.emit('event1', {});
      await service.emit('event1', {});
      await service.emit('event2', {});

      const health = await service.health();

      expect(health.details.eventCount).toBe(2); // 2 unique events
      expect(health.details.listenerCount).toBe(3); // 3 total listeners
    });
  });

  describe('Integration', () => {
    it('should work with complex event flow', async () => {
      await service.onInit();
      const results: any[] = [];

      // Setup event chain
      service.on('user.created', async (data) => {
        results.push(`Created user: ${data.id}`);
        await service.emit('user.notify', { userId: data.id });
      });

      service.on('user.notify', async (data) => {
        results.push(`Notified user: ${data.userId}`);
        await service.emit('user.log', { action: 'notified', userId: data.userId });
      });

      service.on('user.log', (data) => {
        results.push(`Logged: ${data.action} for user ${data.userId}`);
      });

      // Trigger the chain
      await service.emit('user.created', { id: 123 });

      // Allow async events to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(results).toEqual(['Created user: 123', 'Notified user: 123', 'Logged: notified for user 123']);
    });
  });
});
