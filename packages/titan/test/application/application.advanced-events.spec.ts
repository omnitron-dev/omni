/**
 * Advanced Event System Tests for Titan Application
 *
 * Tests for complex event handling scenarios including:
 * - Event listener management
 * - Error handling in event handlers
 * - Wildcard event patterns
 * - Event emission during lifecycle transitions
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

import { Application } from '../../src/application.js';
import { ApplicationState, ApplicationEvent, IModule, IEventMeta } from '../../src/types.js';

describe('Application Advanced Event System', () => {
  let app: Application;

  afterEach(async () => {
    if (app) {
      try {
        if (app.state !== ApplicationState.Stopped) {
          await app.stop({ force: true });
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('Event Listener Management', () => {
    it('should prepend listener to beginning of listener list', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      const order: number[] = [];

      app.on('test:event', () => order.push(1));
      app.on('test:event', () => order.push(2));
      app.prependListener('test:event', () => order.push(0));

      app.emit('test:event', {});

      expect(order).toEqual([0, 1, 2]);
    });

    it('should remove specific handler with off', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      const handler1 = vi.fn();
      const handler2 = vi.fn();

      app.on('test:event', handler1);
      app.on('test:event', handler2);

      app.off('test:event', handler1);
      app.emit('test:event', {});

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should remove all handlers when off called without handler', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      const handler1 = vi.fn();
      const handler2 = vi.fn();

      app.on('test:event', handler1);
      app.on('test:event', handler2);

      app.off('test:event');
      app.emit('test:event', {});

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });

    it('should handle once listeners correctly', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      const handler = vi.fn();

      app.once('test:event', handler);

      app.emit('test:event', { first: true });
      app.emit('test:event', { second: true });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ first: true }, expect.any(Object));
    });

    it('should return correct listener count', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      expect(app.listenerCount('test:event')).toBe(0);

      app.on('test:event', () => {});
      app.on('test:event', () => {});
      app.on('test:event', () => {});

      expect(app.listenerCount('test:event')).toBe(3);

      app.off('test:event');

      expect(app.listenerCount('test:event')).toBe(0);
    });

    it('should remove all listeners for specific event', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      app.on('event1', () => {});
      app.on('event2', () => {});

      app.removeAllListeners('event1');

      expect(app.listenerCount('event1')).toBe(0);
      expect(app.listenerCount('event2')).toBe(1);
    });

    it('should remove all listeners when called without event', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      app.on('event1', () => {});
      app.on('event2', () => {});
      app.on('event3', () => {});

      app.removeAllListeners();

      expect(app.listenerCount('event1')).toBe(0);
      expect(app.listenerCount('event2')).toBe(0);
      expect(app.listenerCount('event3')).toBe(0);
    });
  });

  describe('Wildcard Event Handling', () => {
    it('should emit to wildcard listeners for all events', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      const wildcardEvents: string[] = [];

      app.on('*', (data, meta) => {
        if (meta && typeof meta.event === 'string') {
          wildcardEvents.push(meta.event);
        }
      });

      app.emit('event1', {});
      app.emit('event2', {});
      app.emit('event3', {});

      expect(wildcardEvents).toContain('event1');
      expect(wildcardEvents).toContain('event2');
      expect(wildcardEvents).toContain('event3');
    });

    it('should not emit wildcard to wildcard (avoid infinite loop)', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      let wildcardCallCount = 0;

      app.on('*', () => {
        wildcardCallCount++;
      });

      // Emit '*' directly - should only call once, not recurse
      app.emit('*', {});

      expect(wildcardCallCount).toBe(1);
    });

    it('should handle errors in wildcard handlers gracefully', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      let regularHandlerCalled = false;
      let errorEmitted = false;

      app.on('test:event', () => {
        regularHandlerCalled = true;
      });

      app.on('*', () => {
        throw new Error('Wildcard error');
      });

      app.on(ApplicationEvent.Error, () => {
        errorEmitted = true;
      });

      // Should not throw
      app.emit('test:event', {});

      expect(regularHandlerCalled).toBe(true);
      expect(errorEmitted).toBe(true);
    });
  });

  describe('Error Event Handling', () => {
    it('should call error handlers when error event emitted', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      const errorHandler = vi.fn();
      app.onError(errorHandler);

      const testError = new Error('Test error');
      app.emit('error', testError);

      expect(errorHandler).toHaveBeenCalledWith(testError);
    });

    it('should handle multiple error handlers', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      app.onError(handler1);
      app.onError(handler2);
      app.onError(handler3);

      app.emit('error', new Error('Test'));

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      expect(handler3).toHaveBeenCalled();
    });

    it('should continue calling error handlers even if one throws', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      const handler1 = vi.fn();
      const throwingHandler = vi.fn(() => {
        throw new Error('Handler error');
      });
      const handler2 = vi.fn();

      app.onError(handler1);
      app.onError(throwingHandler);
      app.onError(handler2);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      app.emit('error', new Error('Test'));

      expect(handler1).toHaveBeenCalled();
      expect(throwingHandler).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('Event Handler Errors', () => {
    it('should emit error event when handler throws', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      let errorReceived = false;

      app.on('test:event', () => {
        throw new Error('Handler error');
      });

      app.on(ApplicationEvent.Error, () => {
        errorReceived = true;
      });

      // Should not throw
      app.emit('test:event', {});

      expect(errorReceived).toBe(true);
    });

    it('should not emit error for error event to avoid recursion', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      let errorEmitCount = 0;

      app.on(ApplicationEvent.Error, () => {
        errorEmitCount++;
        throw new Error('Error in error handler');
      });

      // Emit error event
      app.emit(ApplicationEvent.Error, new Error('Test'));

      // Should only be called once, not recursively
      expect(errorEmitCount).toBe(1);
    });
  });

  describe('Event Metadata', () => {
    it('should include correct metadata in event handlers', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      let receivedMeta: IEventMeta | null = null;

      app.on('test:event', (data, meta) => {
        receivedMeta = meta;
      });

      const beforeEmit = Date.now();
      app.emit('test:event', { test: true });
      const afterEmit = Date.now();

      expect(receivedMeta).not.toBeNull();
      expect(receivedMeta!.event).toBe('test:event');
      expect(receivedMeta!.source).toBe('application');
      expect(receivedMeta!.timestamp).toBeGreaterThanOrEqual(beforeEmit);
      expect(receivedMeta!.timestamp).toBeLessThanOrEqual(afterEmit);
    });

    it('should include metadata in emitAsync handlers', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      let receivedMeta: IEventMeta | null = null;

      app.on('test:async', async (data, meta) => {
        receivedMeta = meta;
      });

      await app.emitAsync('test:async', {});

      expect(receivedMeta).not.toBeNull();
      expect(receivedMeta!.event).toBe('test:async');
    });
  });

  describe('Lifecycle Events', () => {
    it('should emit all lifecycle events during start', async () => {
      const events: string[] = [];

      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      app.on(ApplicationEvent.Starting, () => events.push('starting'));
      app.on(ApplicationEvent.Started, () => events.push('started'));

      await app.start();

      expect(events).toContain('starting');
      expect(events).toContain('started');
      expect(events.indexOf('starting')).toBeLessThan(events.indexOf('started'));
    });

    it('should emit all lifecycle events during stop', async () => {
      const events: string[] = [];

      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      await app.start();

      app.on(ApplicationEvent.Stopping, () => events.push('stopping'));
      app.on(ApplicationEvent.Stopped, () => events.push('stopped'));

      await app.stop();

      expect(events).toContain('stopping');
      expect(events).toContain('stopped');
      expect(events.indexOf('stopping')).toBeLessThan(events.indexOf('stopped'));
    });

    it('should emit module events during lifecycle', async () => {
      const events: string[] = [];

      class TestModule implements IModule {
        name = 'test-module';
      }

      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
        modules: [TestModule],
      });

      app.on(ApplicationEvent.ModuleRegistered, (data) => events.push(`registered:${data.module}`));
      app.on(ApplicationEvent.ModuleStarted, (data) => events.push(`started:${data.module}`));
      app.on(ApplicationEvent.ModuleStopped, (data) => events.push(`stopped:${data.module}`));

      await app.start();
      await app.stop();

      expect(events.some((e) => e.startsWith('started:'))).toBe(true);
      expect(events.some((e) => e.startsWith('stopped:'))).toBe(true);
    });
  });

  describe('Config Change Events', () => {
    it('should emit config change event on configure', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      let configChangeReceived = false;
      let receivedConfig: unknown = null;

      app.on(ApplicationEvent.ConfigChanged, (data) => {
        configChangeReceived = true;
        receivedConfig = data.config;
      });

      app.configure({
        newSetting: 'value',
        nested: { key: 'value' },
      });

      expect(configChangeReceived).toBe(true);
      expect(receivedConfig).toBeDefined();
    });

    it('should emit config change event on setConfig', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      let changeReceived = false;
      let receivedKey: string | null = null;

      app.on(ApplicationEvent.ConfigChanged, (data) => {
        changeReceived = true;
        receivedKey = data.key || null;
      });

      app.setConfig('deep.nested.key', 'value');

      expect(changeReceived).toBe(true);
      expect(receivedKey).toBe('deep.nested.key');
    });
  });
});
