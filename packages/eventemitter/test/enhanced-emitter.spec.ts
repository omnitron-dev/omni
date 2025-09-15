import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { EnhancedEventEmitter } from '../src/enhanced-emitter';
import type { EventMetadata, EventInterceptor, ValidationSchema, ListenerFn } from '../src/types';

// Mock validation schema
class MockSchema implements ValidationSchema {
  constructor(private validator: (data: any) => boolean) { }

  validate(data: any) {
    const valid = this.validator(data);
    return {
      valid,
      errors: valid ? undefined : [{ path: 'root', message: 'Validation failed' }]
    };
  }
}

describe('EnhancedEventEmitter', () => {
  let emitter: EnhancedEventEmitter;

  beforeEach(() => {
    emitter = new EnhancedEventEmitter();
  });

  afterEach(() => {
    // Clean up after each test
    emitter.dispose();
    emitter.removeAllListeners();
  });

  describe('Basic Functionality', () => {
    it('should emit and listen to basic events', () => {
      const listener = jest.fn();
      emitter.on('test', listener);
      emitter.emitEnhanced('test', { data: 'test' });

      expect(listener).toHaveBeenCalledWith(
        { data: 'test' },
        expect.objectContaining({
          timestamp: expect.any(Number)
        })
      );
    });

    it('should work with once listeners', () => {
      const listener = jest.fn();
      emitter.once('test', listener);

      emitter.emitEnhanced('test', 'data1');
      emitter.emitEnhanced('test', 'data2');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith('data1', expect.any(Object));
    });
  });

  describe('Wildcard Events', () => {
    it('should match single wildcard patterns', () => {
      const listener = jest.fn();
      emitter.on('user.*', listener);

      emitter.emitEnhanced('user.created', { id: 1 });
      emitter.emitEnhanced('user.updated', { id: 2 });
      emitter.emitEnhanced('admin.created', { id: 3 });

      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('should match globstar patterns', () => {
      const listener = jest.fn();
      emitter.on('app.**', listener);

      emitter.emitEnhanced('app.user.created', { id: 1 });
      emitter.emitEnhanced('app.db.connection.error', { error: 'test' });
      emitter.emitEnhanced('other.event', { data: 'test' });

      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('should match multiple wildcard patterns', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      const listener3 = jest.fn();

      emitter.on('*.created', listener1);
      emitter.on('user.*', listener2);
      emitter.on('user.created', listener3);

      emitter.emitEnhanced('user.created', { id: 1 });

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
      expect(listener3).toHaveBeenCalledTimes(1);
    });

    it('should disable wildcard matching when configured', () => {
      const emitterNoWildcard = new EnhancedEventEmitter({ wildcard: false });
      const listener = jest.fn();

      emitterNoWildcard.on('user.*', listener);
      emitterNoWildcard.emitEnhanced('user.created', { id: 1 });

      expect(listener).not.toHaveBeenCalled();

      // But exact match should work
      emitterNoWildcard.emitEnhanced('user.*', { id: 2 });
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('Type-Safe Events', () => {
    interface TestEvents {
      'user.created': { id: number; name: string };
      'user.deleted': { id: number };
    }

    it('should provide type-safe emit and on', () => {
      const typedEmitter = new EnhancedEventEmitter<TestEvents>();
      const listener = jest.fn<ListenerFn<{ id: number; name: string }>>();

      typedEmitter.onTyped('user.created', listener);
      typedEmitter.emitTyped('user.created', { id: 1, name: 'John' });

      expect(listener).toHaveBeenCalledWith(
        { id: 1, name: 'John' },
        expect.any(Object)
      );
    });
  });

  describe('Event Metadata', () => {
    it('should include metadata in events', () => {
      const listener = jest.fn();
      emitter.on('test', listener);

      emitter.emitEnhanced('test', { data: 'test' }, {
        metadata: {
          source: 'test-source',
          userId: 'user123',
          correlationId: 'corr-123',
          tags: ['important', 'test']
        }
      });

      expect(listener).toHaveBeenCalledWith(
        { data: 'test' },
        expect.objectContaining({
          source: 'test-source',
          userId: 'user123',
          correlationId: 'corr-123',
          tags: ['important', 'test']
        })
      );
    });

    it('should generate event ID and timestamp automatically', () => {
      const listener = jest.fn();
      emitter.on('test', listener);

      emitter.emitEnhanced('test', 'data');

      expect(listener).toHaveBeenCalledWith(
        'data',
        expect.objectContaining({
          id: expect.stringMatching(/^\d+-[a-z0-9]+$/),
          timestamp: expect.any(Number)
        })
      );
    });
  });

  describe('Interceptors', () => {
    it('should apply global before interceptor', () => {
      const interceptor: EventInterceptor = {
        before: jest.fn((event, data: any) => ({ ...data, intercepted: true }))
      };

      const listener = jest.fn();
      emitter.addInterceptor(interceptor);
      emitter.on('test', listener);

      emitter.emitEnhanced('test', { original: true });

      expect(interceptor.before).toHaveBeenCalledWith(
        'test',
        { original: true },
        expect.any(Object)
      );

      expect(listener).toHaveBeenCalledWith(
        { original: true, intercepted: true },
        expect.any(Object)
      );
    });

    it('should apply event-specific interceptor', () => {
      const interceptor: EventInterceptor = {
        before: jest.fn((event, data: any) => ({ ...data, specific: true }))
      };

      const listener1 = jest.fn();
      const listener2 = jest.fn();

      emitter.addInterceptor('user.*', interceptor);
      emitter.on('user.created', listener1);
      emitter.on('post.created', listener2);

      emitter.emitEnhanced('user.created', { id: 1 });
      emitter.emitEnhanced('post.created', { id: 2 });

      expect(listener1).toHaveBeenCalledWith(
        { id: 1, specific: true },
        expect.any(Object)
      );

      expect(listener2).toHaveBeenCalledWith(
        { id: 2 }, // No modification
        expect.any(Object)
      );
    });

    it('should call after interceptor', () => {
      const interceptor: EventInterceptor = {
        after: jest.fn()
      };

      emitter.addInterceptor(interceptor);
      emitter.on('test', () => { });
      emitter.emitEnhanced('test', 'data');

      expect(interceptor.after).toHaveBeenCalledWith(
        'test',
        'data',
        expect.any(Object),
        undefined
      );
    });

    it('should call error interceptor on error', () => {
      const interceptor: EventInterceptor = {
        error: jest.fn()
      };

      emitter.addInterceptor(interceptor);
      emitter.on('test', () => {
        throw new Error('Test error');
      });

      expect(() => emitter.emitEnhanced('test', 'data')).toThrow('Test error');
      expect(interceptor.error).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ message: 'Test error' }),
        expect.any(Object)
      );
    });
  });

  describe('Event History', () => {
    beforeEach(() => {
      emitter.enableHistory({ maxSize: 10 });
    });

    it('should record event history', async () => {
      emitter.emitEnhanced('event1', { data: 1 });
      emitter.emitEnhanced('event2', { data: 2 });

      const history = await emitter.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({
        event: 'event1',
        data: { data: 1 }
      });
      expect(history[1]).toMatchObject({
        event: 'event2',
        data: { data: 2 }
      });
    });

    it('should filter history by event name', async () => {
      emitter.emitEnhanced('user.created', { id: 1 });
      emitter.emitEnhanced('user.updated', { id: 2 });
      emitter.emitEnhanced('post.created', { id: 3 });

      const history = await emitter.getHistory({ event: 'user' });
      expect(history).toHaveLength(2);
    });

    it('should replay events from history', async () => {
      const listener = jest.fn();

      emitter.emitEnhanced('test1', 'data1');
      emitter.emitEnhanced('test2', 'data2');

      emitter.on('test1', listener);
      emitter.on('test2', listener);

      await emitter.replay();

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenCalledWith('data1');
      expect(listener).toHaveBeenCalledWith('data2');
    });

    it('should export and import history', async () => {
      emitter.emitEnhanced('event1', 'data1');
      emitter.emitEnhanced('event2', 'data2');

      const exported = await emitter.exportHistory();
      expect(exported).toHaveLength(2);

      await emitter.clearHistory();
      const cleared = await emitter.getHistory();
      expect(cleared).toHaveLength(0);

      await emitter.importHistory(exported);
      const imported = await emitter.getHistory();
      expect(imported).toHaveLength(2);
    });
  });

  describe('Event Scheduling', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should schedule delayed event', () => {
      const listener = jest.fn();
      emitter.on('delayed', listener);

      emitter.schedule('delayed', { data: 'test' }, { delay: 1000 });

      expect(listener).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1000);

      expect(listener).toHaveBeenCalledWith(
        { data: 'test' },
        expect.any(Object)
      );
    });

    it('should cancel scheduled event', () => {
      const listener = jest.fn();
      emitter.on('cancelled', listener);

      const id = emitter.schedule('cancelled', 'data', { delay: 1000 });
      emitter.cancelSchedule(id);

      jest.advanceTimersByTime(1000);

      expect(listener).not.toHaveBeenCalled();
    });

    it('should list scheduled events', () => {
      emitter.schedule('event1', 'data1', { delay: 1000 });
      emitter.schedule('event2', 'data2', { delay: 2000 });

      const scheduled = emitter.getScheduledEvents();
      expect(scheduled).toHaveLength(2);
      expect(scheduled[0]).toMatchObject({
        event: 'event1',
        status: 'pending'
      });
    });
  });

  describe('Event Batching', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should batch events by size', () => {
      const batchListener = jest.fn();

      emitter.batch('metrics', { maxSize: 3 });
      emitter.on('metrics:batch', batchListener);

      emitter.emitEnhanced('metrics', { value: 1 });
      emitter.emitEnhanced('metrics', { value: 2 });
      expect(batchListener).not.toHaveBeenCalled();

      emitter.emitEnhanced('metrics', { value: 3 });
      expect(batchListener).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ data: { value: 1 } }),
          expect.objectContaining({ data: { value: 2 } }),
          expect.objectContaining({ data: { value: 3 } })
        ])
      );
    });

    it('should batch events by time', () => {
      const batchListener = jest.fn();

      emitter.batch('logs', { maxWait: 1000 });
      emitter.on('logs:batch', batchListener);

      emitter.emitEnhanced('logs', 'log1');
      emitter.emitEnhanced('logs', 'log2');

      expect(batchListener).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1000);

      expect(batchListener).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ data: 'log1' }),
          expect.objectContaining({ data: 'log2' })
        ])
      );
    });
  });

  describe('Event Validation', () => {
    it('should validate event data against schema', () => {
      const schema = new MockSchema((data: any) =>
        typeof data === 'object' && typeof data.id === 'number'
      );

      emitter.registerSchema('user.created', schema);

      const listener = jest.fn();
      emitter.on('user.created', listener);

      // Valid data
      emitter.emitEnhanced('user.created', { id: 1, name: 'John' });
      expect(listener).toHaveBeenCalled();

      // Invalid data
      listener.mockClear();
      expect(() =>
        emitter.emitEnhanced('user.created', { name: 'John' })
      ).toThrow('Validation failed');
      expect(listener).not.toHaveBeenCalled();
    });

    it('should skip validation when disabled', () => {
      const schema = new MockSchema(() => false);
      emitter.registerSchema('test', schema);

      const listener = jest.fn();
      emitter.on('test', listener);

      emitter.emitEnhanced('test', 'invalid', { validate: false });
      expect(listener).toHaveBeenCalled();
    });
  });

  describe('Metrics', () => {
    beforeEach(() => {
      emitter.enableMetrics({ slowThreshold: 50 });
    });

    it('should collect basic metrics', () => {
      emitter.on('test1', () => { });
      emitter.on('test2', () => { });

      emitter.emitEnhanced('test1', 'data');
      emitter.emitEnhanced('test1', 'data');
      emitter.emitEnhanced('test2', 'data');

      const metrics = emitter.getMetrics();
      expect(metrics.eventsEmitted).toBe(3);
      expect(metrics.eventCounts.get('test1')).toBe(2);
      expect(metrics.eventCounts.get('test2')).toBe(1);
    });

    it('should track failed events', () => {
      emitter.on('failing', () => {
        throw new Error('Failed');
      });

      try {
        emitter.emitEnhanced('failing', 'data');
      } catch { }

      const metrics = emitter.getMetrics();
      expect(metrics.eventsFailed).toBe(1);
      expect(metrics.errorCounts.get('failing')).toBe(1);
    });

    it('should export metrics in different formats', () => {
      emitter.emitEnhanced('test', 'data');

      const json = emitter.exportMetrics('json');
      expect(JSON.parse(json)).toMatchObject({
        metrics: {
          eventsEmitted: 1
        }
      });

      const prometheus = emitter.exportMetrics('prometheus');
      expect(prometheus).toContain('eventemitter_events_emitted_total 1');
    });

    it('should provide metrics summary', () => {
      emitter.emitEnhanced('test', 'data');

      const summary = emitter.getMetricsSummary();
      expect(summary).toContain('Total Events: 1');
      expect(summary).toContain('EventEmitter Metrics Summary');
    });
  });

  describe('Error Handling', () => {
    it('should call global error handler', () => {
      const errorHandler = jest.fn();
      emitter.onError(errorHandler);

      emitter.on('error-event', () => {
        throw new Error('Test error');
      });

      expect(() => emitter.emitEnhanced('error-event', 'data')).toThrow();
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Test error' }),
        'error-event',
        'data',
        expect.any(Object)
      );
    });

    it('should handle errors with error boundary', () => {
      const onError = jest.fn();
      const listener = jest.fn(() => {
        throw new Error('Boundary error');
      });

      emitter.onEnhanced('boundary-test', listener, {
        errorBoundary: true,
        onError
      });

      // Error should be caught and not thrown
      expect(() => {
        emitter.emitEnhanced('boundary-test', 'data');
      }).not.toThrow();

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Boundary error' }),
        'data',
        expect.any(Object)
      );
    });
  });

  describe('Throttling and Debouncing', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should throttle event emission', () => {
      const listener = jest.fn();

      emitter.throttle('throttled', 100);
      emitter.on('throttled', listener);

      // Emit multiple times quickly
      for (let i = 0; i < 5; i++) {
        emitter.emit('throttled', i);
      }

      // Only first should go through immediately
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(0);

      // Advance time
      jest.advanceTimersByTime(100);
      emitter.emit('throttled', 5);

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenCalledWith(5);
    });

    it('should debounce event emission', () => {
      const listener = jest.fn();

      emitter.debounce('debounced', 100);
      emitter.on('debounced', listener);

      // Emit multiple times quickly
      emitter.emit('debounced', 1);
      emitter.emit('debounced', 2);
      emitter.emit('debounced', 3);

      expect(listener).not.toHaveBeenCalled();

      // Wait for debounce
      jest.advanceTimersByTime(100);

      // Only last emission should go through
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(3);
    });
  });

  describe('Listener Options', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    afterEach(() => {
      jest.useFakeTimers();
    });

    it('should timeout long-running listeners', async () => {
      // Create fresh emitter for this test to avoid interference
      const localEmitter = new EnhancedEventEmitter();
      
      const listener = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      localEmitter.onEnhanced('timeout-test', listener, { timeout: 50 });

      await expect(async () => {
        await localEmitter.emitParallel('timeout-test', 'data');
      }).rejects.toThrow('Listener timeout');
      
      // Clean up
      localEmitter.dispose();
      localEmitter.removeAllListeners();
    });
  });

  describe('Cleanup', () => {
    it('should dispose all resources', () => {
      const listener = jest.fn();

      emitter.enableHistory();
      emitter.enableMetrics();
      emitter.schedule('scheduled', 'data', { delay: 1000 });
      emitter.on('test', listener);

      emitter.dispose();

      // Should not emit after disposal
      emitter.emit('test', 'data');
      expect(listener).not.toHaveBeenCalled();

      // Scheduled events should be cancelled
      expect(emitter.getScheduledEvents()).toHaveLength(0);
    });
  });
});