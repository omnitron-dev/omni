/**
 * Tests for Notifications Decorators
 */
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import {
  OnNotification,
  getNotificationHandlers,
  hasNotificationHandlers,
  type NotificationHandlerMetadata,
} from '../../../src/modules/notifications/notifications.decorators.js';
import type { IncomingNotification } from '../../../src/modules/notifications/transport/transport.interface.js';

describe('Notifications Decorators', () => {
  describe('@OnNotification', () => {
    it('should store handler metadata on class', () => {
      class TestHandler {
        @OnNotification('test.*')
        async handleTest(_notification: IncomingNotification) {
          // Handler implementation
        }
      }

      const handlers = getNotificationHandlers(TestHandler);
      expect(handlers).toHaveLength(1);
      expect(handlers[0]).toBeDefined();
      expect(handlers[0]!.pattern).toBe('test.*');
      expect(handlers[0]!.methodName).toBe('handleTest');
    });

    it('should support pattern parameter', () => {
      class PatternHandler {
        @OnNotification('user.created')
        async handleUserCreated(_notification: IncomingNotification) {}

        @OnNotification('order.*')
        async handleOrderEvents(_notification: IncomingNotification) {}

        @OnNotification('notification.*.urgent')
        async handleUrgentNotifications(_notification: IncomingNotification) {}
      }

      const handlers = getNotificationHandlers(PatternHandler);
      expect(handlers).toHaveLength(3);

      const patterns = handlers.map((h) => h.pattern);
      expect(patterns).toContain('user.created');
      expect(patterns).toContain('order.*');
      expect(patterns).toContain('notification.*.urgent');
    });

    it('should support all options', () => {
      class OptionsHandler {
        @OnNotification('test.event', {
          groupName: 'test-group',
          consumerName: 'consumer-1',
          startFrom: '0',
          maxRetries: 5,
          retryDelay: 1000,
          autoAck: false,
          prefetchCount: 10,
          exactlyOnce: true,
        })
        async handleWithOptions(_notification: IncomingNotification) {}
      }

      const handlers = getNotificationHandlers(OptionsHandler);
      expect(handlers).toHaveLength(1);

      const handler = handlers[0]!;
      expect(handler.options).toBeDefined();
      expect(handler.options.groupName).toBe('test-group');
      expect(handler.options.consumerName).toBe('consumer-1');
      expect(handler.options.startFrom).toBe('0');
      expect(handler.options.maxRetries).toBe(5);
      expect(handler.options.retryDelay).toBe(1000);
      expect(handler.options.autoAck).toBe(false);
      expect(handler.options.prefetchCount).toBe(10);
      expect(handler.options.exactlyOnce).toBe(true);
    });

    it('should support custom retry delay function', () => {
      const customRetryDelay = (attempt: number) => attempt * 1000;

      class RetryHandler {
        @OnNotification('test.event', {
          maxRetries: 3,
          retryDelay: customRetryDelay,
        })
        async handleWithCustomRetry(_notification: IncomingNotification) {}
      }

      const handlers = getNotificationHandlers(RetryHandler);
      const handler = handlers[0]!;

      expect(handler.options.retryDelay).toBe(customRetryDelay);
      expect(typeof handler.options.retryDelay).toBe('function');

      // Test the function
      if (typeof handler.options.retryDelay === 'function') {
        expect(handler.options.retryDelay(1)).toBe(1000);
        expect(handler.options.retryDelay(2)).toBe(2000);
        expect(handler.options.retryDelay(3)).toBe(3000);
      }
    });

    it('should support retry strategy configuration', () => {
      class StrategyHandler {
        @OnNotification('test.event', {
          retryStrategy: {
            type: 'exponential',
            initialDelay: 1000,
            maxDelay: 60000,
            factor: 2,
          },
        })
        async handleWithStrategy(_notification: IncomingNotification) {}
      }

      const handlers = getNotificationHandlers(StrategyHandler);
      const handler = handlers[0]!;

      expect(handler.options.retryStrategy).toBeDefined();
      expect(handler.options.retryStrategy?.type).toBe('exponential');
      expect(handler.options.retryStrategy?.initialDelay).toBe(1000);
      expect(handler.options.retryStrategy?.maxDelay).toBe(60000);
      expect(handler.options.retryStrategy?.factor).toBe(2);
    });

    it('should support multiple decorators on same class', () => {
      class MultiHandler {
        @OnNotification('user.created')
        async handleUserCreated(_notification: IncomingNotification) {}

        @OnNotification('user.updated')
        async handleUserUpdated(_notification: IncomingNotification) {}

        @OnNotification('user.deleted')
        async handleUserDeleted(_notification: IncomingNotification) {}

        @OnNotification('user.*', { groupName: 'user-handlers' })
        async handleAllUserEvents(_notification: IncomingNotification) {}
      }

      const handlers = getNotificationHandlers(MultiHandler);
      expect(handlers).toHaveLength(4);

      const methodNames = handlers.map((h) => h.methodName);
      expect(methodNames).toContain('handleUserCreated');
      expect(methodNames).toContain('handleUserUpdated');
      expect(methodNames).toContain('handleUserDeleted');
      expect(methodNames).toContain('handleAllUserEvents');
    });

    it('should preserve metadata across multiple decorator applications', () => {
      class OrderedHandler {
        @OnNotification('first.event')
        async handleFirst(_notification: IncomingNotification) {}

        @OnNotification('second.event')
        async handleSecond(_notification: IncomingNotification) {}

        @OnNotification('third.event')
        async handleThird(_notification: IncomingNotification) {}
      }

      const handlers = getNotificationHandlers(OrderedHandler);
      expect(handlers).toHaveLength(3);

      // Verify order is preserved
      expect(handlers[0]!.methodName).toBe('handleFirst');
      expect(handlers[1]!.methodName).toBe('handleSecond');
      expect(handlers[2]!.methodName).toBe('handleThird');
    });

    it('should handle empty options parameter', () => {
      class DefaultOptionsHandler {
        @OnNotification('test.event')
        async handleWithDefaults(_notification: IncomingNotification) {}
      }

      const handlers = getNotificationHandlers(DefaultOptionsHandler);
      expect(handlers).toHaveLength(1);
      expect(handlers[0]!.options).toBeDefined();
      expect(handlers[0]!.options).toEqual({});
    });

    it('should handle symbol property keys', () => {
      const symbolKey = Symbol('handler');

      class SymbolHandler {
        @OnNotification('test.event')
        async [symbolKey](_notification: IncomingNotification) {}
      }

      const handlers = getNotificationHandlers(SymbolHandler);
      expect(handlers).toHaveLength(1);
      expect(handlers[0]!.methodName).toBe(symbolKey.toString());
    });
  });

  describe('getNotificationHandlers', () => {
    it('should return all handlers from decorated class', () => {
      class TestHandler {
        @OnNotification('event1')
        async handleEvent1(_notification: IncomingNotification) {}

        @OnNotification('event2')
        async handleEvent2(_notification: IncomingNotification) {}
      }

      const handlers = getNotificationHandlers(TestHandler);
      expect(handlers).toHaveLength(2);
      expect(Array.isArray(handlers)).toBe(true);
    });

    it('should return empty array for undecorated class', () => {
      class UndecoratedHandler {
        async handleEvent(_notification: IncomingNotification) {}
      }

      const handlers = getNotificationHandlers(UndecoratedHandler);
      expect(handlers).toEqual([]);
      expect(handlers).toHaveLength(0);
    });

    it('should return empty array for class with no handlers', () => {
      class NoHandlers {
        someMethod() {
          return 'hello';
        }
      }

      const handlers = getNotificationHandlers(NoHandlers);
      expect(handlers).toEqual([]);
    });

    it('should return handlers with correct metadata structure', () => {
      class StructuredHandler {
        @OnNotification('test.pattern', {
          groupName: 'test-group',
          maxRetries: 3,
        })
        async handleTest(_notification: IncomingNotification) {}
      }

      const handlers = getNotificationHandlers(StructuredHandler);
      const handler = handlers[0]!;

      expect(handler).toHaveProperty('pattern');
      expect(handler).toHaveProperty('methodName');
      expect(handler).toHaveProperty('options');

      expect(typeof handler.pattern).toBe('string');
      expect(typeof handler.methodName).toBe('string');
      expect(typeof handler.options).toBe('object');
    });

    it('should work with inheritance', () => {
      class BaseHandler {
        @OnNotification('base.event')
        async handleBase(_notification: IncomingNotification) {}
      }

      class DerivedHandler extends BaseHandler {
        @OnNotification('derived.event')
        async handleDerived(_notification: IncomingNotification) {}
      }

      const baseHandlers = getNotificationHandlers(BaseHandler);
      const derivedHandlers = getNotificationHandlers(DerivedHandler);

      // Due to reflect-metadata implementation, both base and derived inherit metadata
      // BaseHandler should have only its own handler
      expect(baseHandlers.some((h) => h.methodName === 'handleBase')).toBe(true);

      // DerivedHandler inherits from base, so it has both handlers
      expect(derivedHandlers.some((h) => h.methodName === 'handleBase')).toBe(true);
      expect(derivedHandlers.some((h) => h.methodName === 'handleDerived')).toBe(true);
    });
  });

  describe('hasNotificationHandlers', () => {
    it('should return true for decorated class', () => {
      class DecoratedHandler {
        @OnNotification('test.event')
        async handleTest(_notification: IncomingNotification) {}
      }

      expect(hasNotificationHandlers(DecoratedHandler)).toBe(true);
    });

    it('should return false for undecorated class', () => {
      class UndecoratedHandler {
        async handleEvent(_notification: IncomingNotification) {}
      }

      expect(hasNotificationHandlers(UndecoratedHandler)).toBe(false);
    });

    it('should return false for empty class', () => {
      class EmptyHandler {}

      expect(hasNotificationHandlers(EmptyHandler)).toBe(false);
    });

    it('should return true even with single handler', () => {
      class SingleHandler {
        @OnNotification('single.event')
        async handleSingle(_notification: IncomingNotification) {}
      }

      expect(hasNotificationHandlers(SingleHandler)).toBe(true);
    });

    it('should return true for multiple handlers', () => {
      class MultipleHandlers {
        @OnNotification('event1')
        async handle1(_notification: IncomingNotification) {}

        @OnNotification('event2')
        async handle2(_notification: IncomingNotification) {}

        @OnNotification('event3')
        async handle3(_notification: IncomingNotification) {}
      }

      expect(hasNotificationHandlers(MultipleHandlers)).toBe(true);
    });

    it('should work correctly after dynamic handler addition', () => {
      class DynamicHandler {}

      expect(hasNotificationHandlers(DynamicHandler)).toBe(false);

      // Dynamically add decorator
      OnNotification('dynamic.event')(
        DynamicHandler.prototype,
        'handleDynamic',
        Object.getOwnPropertyDescriptor(DynamicHandler.prototype, 'handleDynamic') || {
          value: async () => {},
          writable: true,
          configurable: true,
          enumerable: false,
        }
      );

      expect(hasNotificationHandlers(DynamicHandler)).toBe(true);
    });
  });

  describe('Integration', () => {
    it('should work with realistic handler class', () => {
      class NotificationHandler {
        private processedCount = 0;

        @OnNotification('user.registered', {
          groupName: 'user-handlers',
          maxRetries: 3,
          retryDelay: 1000,
        })
        async handleUserRegistered(notification: IncomingNotification) {
          this.processedCount++;
          await notification.ack();
        }

        @OnNotification('order.*', {
          groupName: 'order-handlers',
          maxRetries: 5,
          retryDelay: 2000,
          exactlyOnce: true,
        })
        async handleOrderEvents(notification: IncomingNotification) {
          this.processedCount++;
          await notification.ack();
        }

        @OnNotification('notification.*.critical', {
          groupName: 'critical-handlers',
          maxRetries: 10,
          prefetchCount: 1,
        })
        async handleCriticalNotifications(notification: IncomingNotification) {
          this.processedCount++;
          await notification.ack();
        }

        getProcessedCount(): number {
          return this.processedCount;
        }
      }

      const handlers = getNotificationHandlers(NotificationHandler);
      expect(handlers).toHaveLength(3);
      expect(hasNotificationHandlers(NotificationHandler)).toBe(true);

      // Verify each handler configuration
      const userHandler = handlers.find((h) => h.pattern === 'user.registered');
      expect(userHandler).toBeDefined();
      expect(userHandler!.options.groupName).toBe('user-handlers');
      expect(userHandler!.options.maxRetries).toBe(3);

      const orderHandler = handlers.find((h) => h.pattern === 'order.*');
      expect(orderHandler).toBeDefined();
      expect(orderHandler!.options.exactlyOnce).toBe(true);

      const criticalHandler = handlers.find((h) => h.pattern === 'notification.*.critical');
      expect(criticalHandler).toBeDefined();
      expect(criticalHandler!.options.maxRetries).toBe(10);
    });

    it('should handle complex patterns correctly', () => {
      class ComplexPatternHandler {
        @OnNotification('*')
        async handleAll(_notification: IncomingNotification) {}

        @OnNotification('user.*')
        async handleUserEvents(_notification: IncomingNotification) {}

        @OnNotification('user.*.action')
        async handleUserActions(_notification: IncomingNotification) {}

        @OnNotification('system.*.*.error')
        async handleSystemErrors(_notification: IncomingNotification) {}
      }

      const handlers = getNotificationHandlers(ComplexPatternHandler);
      expect(handlers).toHaveLength(4);

      const patterns = handlers.map((h) => h.pattern);
      expect(patterns).toContain('*');
      expect(patterns).toContain('user.*');
      expect(patterns).toContain('user.*.action');
      expect(patterns).toContain('system.*.*.error');
    });

    it('should maintain type safety for metadata', () => {
      class TypeSafeHandler {
        @OnNotification('typed.event', {
          groupName: 'type-group',
          consumerName: 'consumer',
          startFrom: '$',
          maxRetries: 5,
          autoAck: true,
          prefetchCount: 100,
        })
        async handleTyped(_notification: IncomingNotification) {}
      }

      const handlers = getNotificationHandlers(TypeSafeHandler);
      const metadata: NotificationHandlerMetadata = handlers[0]!;

      // Type assertions to verify structure
      expect(typeof metadata.pattern).toBe('string');
      expect(typeof metadata.methodName).toBe('string');
      expect(typeof metadata.options).toBe('object');

      // Verify option types
      if (metadata.options.groupName) {
        expect(typeof metadata.options.groupName).toBe('string');
      }
      if (metadata.options.maxRetries) {
        expect(typeof metadata.options.maxRetries).toBe('number');
      }
      if (metadata.options.autoAck !== undefined) {
        expect(typeof metadata.options.autoAck).toBe('boolean');
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle methods with same name in different classes', () => {
      class Handler1 {
        @OnNotification('handler1.event')
        async handleEvent(_notification: IncomingNotification) {}
      }

      class Handler2 {
        @OnNotification('handler2.event')
        async handleEvent(_notification: IncomingNotification) {}
      }

      const handlers1 = getNotificationHandlers(Handler1);
      const handlers2 = getNotificationHandlers(Handler2);

      expect(handlers1).toHaveLength(1);
      expect(handlers2).toHaveLength(1);
      expect(handlers1[0]!.pattern).toBe('handler1.event');
      expect(handlers2[0]!.pattern).toBe('handler2.event');
    });

    it('should handle async and sync methods equally', () => {
      class MixedHandler {
        @OnNotification('async.event')
        async handleAsync(_notification: IncomingNotification) {}

        @OnNotification('sync.event')
        handleSync(_notification: IncomingNotification) {
          // Sync method
        }
      }

      const handlers = getNotificationHandlers(MixedHandler);
      expect(handlers).toHaveLength(2);

      const asyncHandler = handlers.find((h) => h.pattern === 'async.event');
      const syncHandler = handlers.find((h) => h.pattern === 'sync.event');

      expect(asyncHandler).toBeDefined();
      expect(syncHandler).toBeDefined();
    });

    it('should handle very long pattern strings', () => {
      const longPattern = 'very.long.pattern.with.many.segments.for.testing.purposes.and.ensuring.it.works.correctly';

      class LongPatternHandler {
        @OnNotification(longPattern)
        async handleLong(_notification: IncomingNotification) {}
      }

      const handlers = getNotificationHandlers(LongPatternHandler);
      expect(handlers[0]!.pattern).toBe(longPattern);
    });

    it('should handle special characters in patterns', () => {
      class SpecialCharHandler {
        @OnNotification('event:with:colons')
        async handleColons(_notification: IncomingNotification) {}

        @OnNotification('event-with-dashes')
        async handleDashes(_notification: IncomingNotification) {}

        @OnNotification('event_with_underscores')
        async handleUnderscores(_notification: IncomingNotification) {}
      }

      const handlers = getNotificationHandlers(SpecialCharHandler);
      expect(handlers).toHaveLength(3);

      const patterns = handlers.map((h) => h.pattern);
      expect(patterns).toContain('event:with:colons');
      expect(patterns).toContain('event-with-dashes');
      expect(patterns).toContain('event_with_underscores');
    });
  });
});
