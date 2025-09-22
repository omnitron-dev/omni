/**
 * Application Event System Tests
 *
 * Tests for event emission, subscription, handling,
 * and event-driven communication patterns.
 */

import { Application, createApp } from '../../src/application.js';
import { ApplicationEvent, IApplication, IEventMeta } from '../../src/types.js';
import { SimpleModule } from '../fixtures/test-modules.js';
import { delay } from '@omnitron-dev/common';

describe('Application Event System', () => {
  let app: Application;

  beforeEach(() => {
    app = createApp({
      name: 'event-test',
      disableGracefulShutdown: true,
      disableCoreModules: true
    });
  });

  afterEach(async () => {
    if (app && app.state !== 'stopped') {
      await app.stop({ force: true });
    }
  });

  describe('Event Emission', () => {
    it('should emit and receive events', () => {
      const handler = jest.fn();
      app.on(ApplicationEvent.Custom, handler);

      const eventData = { type: 'test', value: 123 };
      app.emit(ApplicationEvent.Custom, eventData);

      expect(handler).toHaveBeenCalledWith(eventData, expect.objectContaining({
        event: ApplicationEvent.Custom,
        source: 'application',
        timestamp: expect.any(Number)
      }));
    });

    it('should emit events with metadata', () => {
      let receivedMeta: IEventMeta | undefined;

      app.on(ApplicationEvent.Custom, (data, meta) => {
        receivedMeta = meta;
      });

      app.emit(ApplicationEvent.Custom, { test: true });

      expect(receivedMeta).toBeDefined();
      expect(receivedMeta?.timestamp).toBeDefined();
      expect(receivedMeta?.source).toBe('application');
    });

    it('should support multiple event listeners', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const handler3 = jest.fn();

      app.on(ApplicationEvent.Custom, handler1);
      app.on(ApplicationEvent.Custom, handler2);
      app.on(ApplicationEvent.Custom, handler3);

      app.emit(ApplicationEvent.Custom, { data: 'test' });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      expect(handler3).toHaveBeenCalled();
    });

    it('should emit wildcard events', () => {
      const wildcardHandler = jest.fn();
      app.on('*', wildcardHandler);

      app.emit(ApplicationEvent.Started, {});
      app.emit(ApplicationEvent.Custom, { type: 'custom' });

      expect(wildcardHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe('Event Subscription', () => {
    it('should subscribe with once', () => {
      const handler = jest.fn();
      app.once(ApplicationEvent.Custom, handler);

      app.emit(ApplicationEvent.Custom, { first: true });
      app.emit(ApplicationEvent.Custom, { second: true });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ first: true }, expect.objectContaining({
        event: ApplicationEvent.Custom,
        source: 'application',
        timestamp: expect.any(Number)
      }));
    });

    it('should unsubscribe from events', () => {
      const handler = jest.fn();
      app.on(ApplicationEvent.Custom, handler);

      app.emit(ApplicationEvent.Custom, { first: true });
      expect(handler).toHaveBeenCalledTimes(1);

      app.off(ApplicationEvent.Custom, handler);
      app.emit(ApplicationEvent.Custom, { second: true });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should remove all listeners for an event', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      app.on(ApplicationEvent.Custom, handler1);
      app.on(ApplicationEvent.Custom, handler2);

      app.removeAllListeners(ApplicationEvent.Custom);
      app.emit(ApplicationEvent.Custom, {});

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });

    it('should get event listener count', () => {
      expect(app.listenerCount(ApplicationEvent.Custom)).toBe(0);

      const handler1 = jest.fn();
      const handler2 = jest.fn();

      app.on(ApplicationEvent.Custom, handler1);
      app.on(ApplicationEvent.Custom, handler2);

      expect(app.listenerCount(ApplicationEvent.Custom)).toBe(2);

      app.off(ApplicationEvent.Custom, handler1);
      expect(app.listenerCount(ApplicationEvent.Custom)).toBe(1);
    });
  });

  describe('Async Event Handling', () => {
    it('should handle async event listeners', async () => {
      const results: number[] = [];

      app.on(ApplicationEvent.Custom, async (data) => {
        await delay(10);
        results.push(1);
      });

      app.on(ApplicationEvent.Custom, async (data) => {
        await delay(5);
        results.push(2);
      });

      await app.emitAsync(ApplicationEvent.Custom, {});

      // Both handlers should have completed
      expect(results).toContain(1);
      expect(results).toContain(2);
    });

    it('should wait for all async handlers', async () => {
      let completed = false;

      app.on(ApplicationEvent.Custom, async () => {
        await delay(50);
        completed = true;
      });

      const promise = app.emitAsync(ApplicationEvent.Custom, {});
      expect(completed).toBe(false);

      await promise;
      expect(completed).toBe(true);
    });

    it('should handle async handler errors', async () => {
      const errorHandler = jest.fn();
      app.on('error', errorHandler);

      app.on(ApplicationEvent.Custom, async () => {
        throw new Error('Async handler error');
      });

      await app.emitAsync(ApplicationEvent.Custom, {});

      expect(errorHandler).toHaveBeenCalled();
      expect(errorHandler.mock.calls[0][0]).toMatchObject({
        error: expect.objectContaining({
          message: 'Async handler error'
        })
      });
    });
  });

  describe('Lifecycle Events', () => {
    it('should emit application lifecycle events', async () => {
      const events: string[] = [];

      app.on(ApplicationEvent.Starting, () => events.push('starting'));
      app.on(ApplicationEvent.Started, () => events.push('started'));
      app.on(ApplicationEvent.Stopping, () => events.push('stopping'));
      app.on(ApplicationEvent.Stopped, () => events.push('stopped'));

      await app.start();
      await app.stop();

      expect(events).toEqual([
        'starting',
        'started',
        'stopping',
        'stopped'
      ]);
    });

    it('should emit module lifecycle events', async () => {
      const events: any[] = [];

      app.on(ApplicationEvent.ModuleRegistered, (event) => {
        events.push({ type: 'registered', module: event.module });
      });

      app.on(ApplicationEvent.ModuleStarted, (event) => {
        events.push({ type: 'started', module: event.module });
      });

      const module = new SimpleModule();
      app.use(module);

      await app.start();

      expect(events).toContainEqual({
        type: 'registered',
        module: 'simple'
      });

      expect(events).toContainEqual({
        type: 'started',
        module: 'simple'
      });
    });

    it('should emit configuration change events', () => {
      const handler = jest.fn();
      app.on(ApplicationEvent.ConfigChanged, handler);

      app.setConfig('test.value', 123);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'test.value',
          value: 123
        }),
        expect.objectContaining({
          event: ApplicationEvent.ConfigChanged,
          source: 'application',
          timestamp: expect.any(Number)
        })
      );
    });
  });

  describe('Error Events', () => {
    it('should emit error events', () => {
      const errorHandler = jest.fn();
      app.on('error', errorHandler);

      const error = new Error('Test error');
      app.emit('error', { error });

      expect(errorHandler).toHaveBeenCalledWith({ error }, expect.objectContaining({
        event: 'error',
        source: 'application',
        timestamp: expect.any(Number)
      }));
    });

    it('should not throw on handler errors by default', () => {
      app.on(ApplicationEvent.Custom, () => {
        throw new Error('Handler error');
      });

      expect(() => app.emit(ApplicationEvent.Custom, {})).not.toThrow();
    });

    it('should catch and emit handler errors', () => {
      const errorHandler = jest.fn();
      app.on('error', errorHandler);

      app.on(ApplicationEvent.Custom, () => {
        throw new Error('Handler error');
      });

      app.emit(ApplicationEvent.Custom, {});

      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('Event Prioritization', () => {
    it('should execute handlers in registration order', () => {
      const order: number[] = [];

      app.on(ApplicationEvent.Custom, () => order.push(1));
      app.on(ApplicationEvent.Custom, () => order.push(2));
      app.on(ApplicationEvent.Custom, () => order.push(3));

      app.emit(ApplicationEvent.Custom, {});

      expect(order).toEqual([1, 2, 3]);
    });

    it('should prepend listeners when specified', () => {
      const order: number[] = [];

      app.on(ApplicationEvent.Custom, () => order.push(1));
      app.prependListener(ApplicationEvent.Custom, () => order.push(2));

      app.emit(ApplicationEvent.Custom, {});

      expect(order).toEqual([2, 1]);
    });
  });

  describe('Module Event Communication', () => {
    it('should allow modules to emit events', async () => {
      class EventEmittingModule extends SimpleModule {
        override async onStart(app: IApplication): Promise<void> {
          await super.onStart(app);
          app.emit(ApplicationEvent.Custom, {
            source: 'module',
            name: this.name
          });
        }
      }

      const handler = jest.fn();
      app.on(ApplicationEvent.Custom, handler);

      const module = new EventEmittingModule();
      app.use(module);

      await app.start();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'module',
          name: 'simple'
        }),
        expect.objectContaining({
          event: ApplicationEvent.Custom,
          source: 'application',
          timestamp: expect.any(Number)
        })
      );
    });

    it('should allow modules to subscribe to events', async () => {
      let moduleReceivedEvent = false;

      class EventListeningModule extends SimpleModule {
        override async onStart(app: IApplication): Promise<void> {
          await super.onStart(app);
          app.on(ApplicationEvent.Custom, () => {
            moduleReceivedEvent = true;
          });
        }
      }

      const module = new EventListeningModule();
      app.use(module);

      await app.start();
      app.emit(ApplicationEvent.Custom, {});

      expect(moduleReceivedEvent).toBe(true);
    });
  });

  describe('Event Filtering', () => {
    it('should filter events by type', () => {
      const customHandler = jest.fn();
      const startedHandler = jest.fn();

      app.on(ApplicationEvent.Custom, customHandler);
      app.on(ApplicationEvent.Started, startedHandler);

      app.emit(ApplicationEvent.Custom, { data: 'custom' });
      app.emit(ApplicationEvent.Started, { data: 'started' });

      expect(customHandler).toHaveBeenCalledTimes(1);
      expect(customHandler).toHaveBeenCalledWith({ data: 'custom' }, expect.any(Object));

      expect(startedHandler).toHaveBeenCalledTimes(1);
      expect(startedHandler).toHaveBeenCalledWith({ data: 'started' }, expect.any(Object));
    });

    it('should support namespaced events', () => {
      const handler = jest.fn();
      app.on('module:database:connected', handler);

      app.emit('module:database:connected', { host: 'localhost' });
      app.emit('module:cache:connected', { host: 'redis' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ host: 'localhost' }, expect.any(Object));
    });
  });

  describe('Event Performance', () => {
    it('should handle high-frequency events', () => {
      const handler = jest.fn();
      app.on(ApplicationEvent.Custom, handler);

      const startTime = Date.now();
      for (let i = 0; i < 10000; i++) {
        app.emit(ApplicationEvent.Custom, { index: i });
      }
      const duration = Date.now() - startTime;

      expect(handler).toHaveBeenCalledTimes(10000);
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should handle many listeners efficiently', () => {
      const handlers: jest.Mock[] = [];

      // Add 100 listeners
      for (let i = 0; i < 100; i++) {
        const handler = jest.fn();
        handlers.push(handler);
        app.on(ApplicationEvent.Custom, handler);
      }

      app.emit(ApplicationEvent.Custom, { test: true });

      handlers.forEach(handler => {
        expect(handler).toHaveBeenCalledWith({ test: true }, expect.objectContaining({
          event: ApplicationEvent.Custom,
          source: 'application',
          timestamp: expect.any(Number)
        }));
      });
    });
  });

  describe('Additional Edge Cases', () => {
    it('should handle rapid error emissions', () => {
      const errorCount = { count: 0 };

      app.on(ApplicationEvent.Error, () => {
        errorCount.count++;
      });

      // Emit many errors rapidly
      for (let i = 0; i < 100; i++) {
        app.emit(ApplicationEvent.Error, new Error(`Error ${i}`));
      }

      expect(errorCount.count).toBe(100);
    });

    it('should handle mixed sync and async handlers', async () => {
      const results: string[] = [];

      app.on(ApplicationEvent.Custom, () => {
        results.push('sync1');
      });

      app.on(ApplicationEvent.Custom, async () => {
        await delay(10);
        results.push('async1');
      });

      app.on(ApplicationEvent.Custom, () => {
        results.push('sync2');
      });

      app.emit(ApplicationEvent.Custom, 'test');

      // Sync handlers should execute immediately
      expect(results).toContain('sync1');
      expect(results).toContain('sync2');

      // Wait for async handler
      await delay(20);
      expect(results).toContain('async1');
    });

    it('should handle removing handler during emission', () => {
      const handler2 = jest.fn();

      const handler1 = () => {
        app.off(ApplicationEvent.Custom, handler2);
      };

      app.on(ApplicationEvent.Custom, handler1);
      app.on(ApplicationEvent.Custom, handler2);

      app.emit(ApplicationEvent.Custom, 'test');

      // handler2 should still be called this time (already in iteration)
      expect(handler2).toHaveBeenCalled();

      handler2.mockClear();
      app.emit(ApplicationEvent.Custom, 'test2');

      // handler2 should not be called second time
      expect(handler2).not.toHaveBeenCalled();
    });

    it('should handle adding handler during emission', () => {
      const newHandler = jest.fn();

      const handler1 = () => {
        app.on(ApplicationEvent.Custom, newHandler);
      };

      app.on(ApplicationEvent.Custom, handler1);

      app.emit(ApplicationEvent.Custom, 'test');

      // New handler should not be called during this emission
      expect(newHandler).not.toHaveBeenCalled();

      app.emit(ApplicationEvent.Custom, 'test2');

      // But should be called on next emission
      expect(newHandler).toHaveBeenCalled();
    });

    it('should handle empty event data', () => {
      const handler = jest.fn();

      app.on(ApplicationEvent.Custom, handler);

      app.emit(ApplicationEvent.Custom);
      app.emit(ApplicationEvent.Custom, undefined);
      app.emit(ApplicationEvent.Custom, null);
      app.emit(ApplicationEvent.Custom, '');

      expect(handler).toHaveBeenCalledTimes(4);
    });

    it('should handle recursive event emissions', () => {
      let depth = 0;
      const maxDepth = 3;

      const recursiveHandler = () => {
        depth++;
        if (depth < maxDepth) {
          app.emit(ApplicationEvent.Custom, depth);
        }
      };

      app.on(ApplicationEvent.Custom, recursiveHandler);

      app.emit(ApplicationEvent.Custom, 0);

      expect(depth).toBe(maxDepth);
    });
  });
});