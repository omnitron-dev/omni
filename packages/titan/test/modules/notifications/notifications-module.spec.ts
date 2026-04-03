/**
 * Tests for NotificationsModule
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'reflect-metadata';
import { Container } from '../../../src/nexus/index.js';
import { NotificationsModule } from '../../../src/modules/notifications/notifications.module.js';
import { NotificationsService } from '../../../src/modules/notifications/notifications.service.js';
import {
  NOTIFICATIONS_SERVICE,
  NOTIFICATIONS_TRANSPORT,
  NOTIFICATIONS_HEALTH,
  NOTIFICATIONS_MODULE_OPTIONS,
  NOTIFICATIONS_RATE_LIMITER,
  NOTIFICATIONS_PREFERENCE_STORE,
  NOTIFICATIONS_CHANNEL_ROUTER,
} from '../../../src/modules/notifications/notifications.tokens.js';
import { OnNotification } from '../../../src/modules/notifications/notifications.decorators.js';
import type {
  MessagingTransport,
  IncomingNotification,
  NotificationSubscription,
  NotificationHandler,
  TransportPublishResult,
  TransportHealth,
  NotificationMessage,
} from '../../../src/modules/notifications/transport/transport.interface.js';
import type {
  NotificationsModuleOptions,
  NotificationsOptionsFactory,
  IRateLimiter,
  IPreferenceStore,
  IChannelRouter,
  NotificationRecipient,
  NotificationPayload,
} from '../../../src/modules/notifications/notifications.types.js';

/**
 * Mock Transport Implementation for Unit Tests
 */
class MockTransport implements MessagingTransport {
  readonly id = 'mock-transport';
  readonly type = 'mock';

  private subscriptions = new Map<string, NotificationHandler[]>();
  private publishedMessages: Array<{
    channel: string;
    message: NotificationMessage;
  }> = [];

  async publish(channel: string, message: NotificationMessage): Promise<TransportPublishResult> {
    this.publishedMessages.push({ channel, message });

    return {
      success: true,
      messageIds: [message.id || 'mock-id'],
      status: 'published',
      patternCount: 1,
      timestamp: Date.now(),
    };
  }

  async subscribe(pattern: string, handler: NotificationHandler): Promise<NotificationSubscription> {
    const handlers = this.subscriptions.get(pattern) || [];
    handlers.push(handler);
    this.subscriptions.set(pattern, handlers);

    const self = this; // Capture 'this' for use in subscription methods
    const subscription: NotificationSubscription = {
      id: `sub-${pattern}-${Date.now()}`,
      pattern,
      group: 'default',
      isPaused: false,
      async unsubscribe() {
        const handlers = self.subscriptions.get(pattern) || [];
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      },
      pause() {
        this.isPaused = true;
      },
      resume() {
        this.isPaused = false;
      },
      stats() {
        return {
          messages: 0,
          retries: 0,
          failures: 0,
        };
      },
    };

    return subscription;
  }

  use(_middleware: any): void {
    // Mock implementation
  }

  async healthCheck(): Promise<TransportHealth> {
    return {
      status: 'healthy',
      connected: true,
      timestamp: Date.now(),
    };
  }

  async shutdown(): Promise<void> {
    this.subscriptions.clear();
    this.publishedMessages = [];
  }

  async waitUntilReady(): Promise<void> {
    // Mock is always ready
  }

  getPublishedMessages() {
    return this.publishedMessages;
  }

  getSubscriptions() {
    return this.subscriptions;
  }

  async triggerHandler(pattern: string, notification: IncomingNotification) {
    const handlers = this.subscriptions.get(pattern) || [];
    for (const handler of handlers) {
      await handler(notification);
    }
  }
}

describe('NotificationsModule', () => {
  let mockTransport: MockTransport;

  beforeEach(() => {
    mockTransport = new MockTransport();
  });

  afterEach(async () => {
    await mockTransport.shutdown();
  });

  describe('forRoot', () => {
    it('should create DynamicModule with providers', () => {
      const module = NotificationsModule.forRoot({});

      expect(module).toBeDefined();
      expect(module.module).toBe(NotificationsModule);
      expect(module.providers).toBeDefined();
      expect(Array.isArray(module.providers)).toBe(true);
      expect(module.exports).toBeDefined();
      expect(Array.isArray(module.exports)).toBe(true);
    });

    it('should register all core providers', () => {
      const module = NotificationsModule.forRoot({});
      const providers = module.providers!;

      // Check for core provider tokens
      const providerTokens = providers.map((p) => {
        if (Array.isArray(p)) {
          return p[0];
        }
        return p;
      });

      expect(providerTokens).toContain(NOTIFICATIONS_MODULE_OPTIONS);
      expect(providerTokens).toContain(NOTIFICATIONS_TRANSPORT);
      expect(providerTokens).toContain(NotificationsService);
      expect(providerTokens).toContain(NOTIFICATIONS_SERVICE);
      expect(providerTokens).toContain(NOTIFICATIONS_HEALTH);
    });

    it('should export required tokens', () => {
      const module = NotificationsModule.forRoot({});
      const exports = module.exports!;

      expect(exports).toContain(NOTIFICATIONS_TRANSPORT);
      expect(exports).toContain(NOTIFICATIONS_SERVICE);
      expect(exports).toContain(NotificationsService);
      expect(exports).toContain(NOTIFICATIONS_HEALTH);
      expect(exports).toContain(NOTIFICATIONS_MODULE_OPTIONS);
    });

    it('should use custom transport when provided', () => {
      const customTransport = mockTransport;

      const module = NotificationsModule.forRoot({
        transport: {
          useTransport: customTransport,
        },
      });

      expect(module.providers).toBeDefined();
      // Find the transport provider
      const transportProvider = module.providers!.find((p) => {
        if (Array.isArray(p)) {
          return p[0] === NOTIFICATIONS_TRANSPORT;
        }
        return false;
      });

      expect(transportProvider).toBeDefined();
    });

    it('should register optional rate limiter when provided', () => {
      const mockRateLimiter: IRateLimiter = {
        checkLimit: vi.fn(),
        recordSent: vi.fn(),
      };

      const module = NotificationsModule.forRoot({
        rateLimiter: mockRateLimiter,
      });

      const providers = module.providers!;
      const providerTokens = providers.map((p) => (Array.isArray(p) ? p[0] : p));

      expect(providerTokens).toContain(NOTIFICATIONS_RATE_LIMITER);
      expect(module.exports).toContain(NOTIFICATIONS_RATE_LIMITER);
    });

    it('should register optional preference store when provided', () => {
      const mockPreferenceStore: IPreferenceStore = {
        getPreferences: vi.fn(),
        setPreferences: vi.fn(),
        updatePreferences: vi.fn(),
        deletePreferences: vi.fn(),
      };

      const module = NotificationsModule.forRoot({
        preferenceStore: mockPreferenceStore,
      });

      const providers = module.providers!;
      const providerTokens = providers.map((p) => (Array.isArray(p) ? p[0] : p));

      expect(providerTokens).toContain(NOTIFICATIONS_PREFERENCE_STORE);
      expect(module.exports).toContain(NOTIFICATIONS_PREFERENCE_STORE);
    });

    it('should register optional channel router when provided', () => {
      const mockChannelRouter: IChannelRouter = {
        route: vi.fn(),
      };

      const module = NotificationsModule.forRoot({
        channelRouter: mockChannelRouter,
      });

      const providers = module.providers!;
      const providerTokens = providers.map((p) => (Array.isArray(p) ? p[0] : p));

      expect(providerTokens).toContain(NOTIFICATIONS_CHANNEL_ROUTER);
      expect(module.exports).toContain(NOTIFICATIONS_CHANNEL_ROUTER);
    });

    it('should mark module as global when isGlobal is true', () => {
      const module = NotificationsModule.forRoot({
        isGlobal: true,
      });

      expect(module.global).toBe(true);
    });

    it('should not mark module as global by default', () => {
      const module = NotificationsModule.forRoot({});

      expect(module.global).toBeUndefined();
    });

    it('should accept Redis options', () => {
      const module = NotificationsModule.forRoot({
        redis: {
          host: 'localhost',
          port: 6379,
          password: 'secret',
        },
      });

      expect(module).toBeDefined();
      expect(module.providers).toBeDefined();
    });

    it('should accept Redis connection string', () => {
      const module = NotificationsModule.forRoot({
        redis: 'redis://localhost:6379',
      });

      expect(module).toBeDefined();
      expect(module.providers).toBeDefined();
    });

    it('should accept Rotif transport options', () => {
      const module = NotificationsModule.forRoot({
        transport: {
          rotif: {
            maxRetries: 5,
            retryDelay: 1000,
            deduplicationTTL: 3600,
            maxStreamLength: 10000,
            disableDelayed: false,
          },
        },
      });

      expect(module).toBeDefined();
      expect(module.providers).toBeDefined();
    });
  });

  describe('forRootAsync', () => {
    it('should create DynamicModule with async providers', () => {
      const module = NotificationsModule.forRootAsync({
        useFactory: () => ({}),
      });

      expect(module).toBeDefined();
      expect(module.module).toBe(NotificationsModule);
      expect(module.providers).toBeDefined();
      expect(module.exports).toBeDefined();
    });

    it('should support useFactory pattern', () => {
      const factoryFn = vi.fn().mockReturnValue({
        redis: { host: 'localhost', port: 6379 },
      });

      const module = NotificationsModule.forRootAsync({
        useFactory: factoryFn,
      });

      expect(module.providers).toBeDefined();

      // Find the options provider
      const optionsProvider = module.providers!.find((p) => {
        if (Array.isArray(p)) {
          return p[0] === NOTIFICATIONS_MODULE_OPTIONS;
        }
        return false;
      });

      expect(optionsProvider).toBeDefined();
    });

    it('should support inject dependencies with useFactory', () => {
      const CONFIG_SERVICE = Symbol('ConfigService');

      const factoryFn = vi.fn().mockReturnValue({
        redis: { host: 'localhost', port: 6379 },
      });

      const module = NotificationsModule.forRootAsync({
        useFactory: factoryFn,
        inject: [CONFIG_SERVICE],
      });

      expect(module.providers).toBeDefined();

      // Find the options provider and check inject
      const optionsProvider = module.providers!.find((p) => {
        if (Array.isArray(p) && p[0] === NOTIFICATIONS_MODULE_OPTIONS) {
          return true;
        }
        return false;
      }) as [any, any];

      expect(optionsProvider).toBeDefined();
      if (optionsProvider && Array.isArray(optionsProvider)) {
        const definition = optionsProvider[1];
        if ('inject' in definition) {
          expect(definition.inject).toContain(CONFIG_SERVICE);
        }
      }
    });

    it('should support useExisting pattern', () => {
      class OptionsFactory implements NotificationsOptionsFactory {
        createNotificationsOptions(): NotificationsModuleOptions {
          return {
            redis: { host: 'localhost', port: 6379 },
          };
        }
      }

      const module = NotificationsModule.forRootAsync({
        useExisting: OptionsFactory,
      });

      expect(module.providers).toBeDefined();

      const optionsProvider = module.providers!.find((p) => {
        if (Array.isArray(p)) {
          return p[0] === NOTIFICATIONS_MODULE_OPTIONS;
        }
        return false;
      });

      expect(optionsProvider).toBeDefined();
    });

    it('should support useClass pattern', () => {
      class OptionsFactory implements NotificationsOptionsFactory {
        createNotificationsOptions(): NotificationsModuleOptions {
          return {
            redis: { host: 'localhost', port: 6379 },
          };
        }
      }

      const module = NotificationsModule.forRootAsync({
        useClass: OptionsFactory,
      });

      expect(module.providers).toBeDefined();

      // Should have both the class provider and options provider
      const providers = module.providers!;
      const providerTokens = providers.map((p) => (Array.isArray(p) ? p[0] : p));

      expect(providerTokens).toContain(NOTIFICATIONS_MODULE_OPTIONS);
    });

    it('should support imports array', () => {
      const ConfigModule = { name: 'ConfigModule' };

      const module = NotificationsModule.forRootAsync({
        imports: [ConfigModule],
        useFactory: () => ({}),
      });

      expect(module.imports).toBeDefined();
      expect(module.imports).toContain(ConfigModule);
    });

    it('should mark module as global when isGlobal is true', () => {
      const module = NotificationsModule.forRootAsync({
        useFactory: () => ({}),
        isGlobal: true,
      });

      expect(module.global).toBe(true);
    });

    it('should handle async factory function', async () => {
      const asyncFactory = vi.fn().mockResolvedValue({
        redis: { host: 'localhost', port: 6379 },
      });

      const module = NotificationsModule.forRootAsync({
        useFactory: asyncFactory,
      });

      expect(module.providers).toBeDefined();
    });

    it('should handle empty options with default values', () => {
      const module = NotificationsModule.forRootAsync({});

      expect(module).toBeDefined();
      expect(module.providers).toBeDefined();
      expect(module.exports).toBeDefined();
    });
  });

  describe('Handler Registration', () => {
    let service: NotificationsService;

    beforeEach(async () => {
      service = new NotificationsService(mockTransport);
      await service.waitUntilReady();
    });

    afterEach(async () => {
      await service.destroy();
    });

    it('should register handlers from decorated class', async () => {
      class TestHandler {
        public handled = false;

        @OnNotification('test.event')
        async handleTest(_notification: IncomingNotification) {
          this.handled = true;
        }
      }

      const instance = new TestHandler();
      await NotificationsModule.registerHandlers(mockTransport, instance);

      const subscriptions = mockTransport.getSubscriptions();
      expect(subscriptions.has('test.event')).toBe(true);
      expect(subscriptions.get('test.event')?.length).toBe(1);
    });

    it('should register multiple handlers from same class', async () => {
      class MultiHandler {
        @OnNotification('event1')
        async handle1(_notification: IncomingNotification) {}

        @OnNotification('event2')
        async handle2(_notification: IncomingNotification) {}

        @OnNotification('event3')
        async handle3(_notification: IncomingNotification) {}
      }

      const instance = new MultiHandler();
      await NotificationsModule.registerHandlers(mockTransport, instance);

      const subscriptions = mockTransport.getSubscriptions();
      expect(subscriptions.has('event1')).toBe(true);
      expect(subscriptions.has('event2')).toBe(true);
      expect(subscriptions.has('event3')).toBe(true);
    });

    it('should not register handlers for undecorated class', async () => {
      class NoHandlers {
        async someMethod() {}
      }

      const instance = new NoHandlers();
      await NotificationsModule.registerHandlers(mockTransport, instance);

      const subscriptions = mockTransport.getSubscriptions();
      expect(subscriptions.size).toBe(0);
    });

    it('should bind handlers to correct instance', async () => {
      class InstanceHandler {
        public count = 0;

        @OnNotification('increment.event')
        async handleIncrement(_notification: IncomingNotification) {
          this.count++;
        }
      }

      const instance = new InstanceHandler();
      await NotificationsModule.registerHandlers(mockTransport, instance);

      // Trigger the handler
      const mockNotification: IncomingNotification = {
        id: 'test-1',
        channel: 'increment.event',
        payload: { type: 'test', data: {} },
        timestamp: Date.now(),
        attempt: 1,
        async ack() {},
      };

      await mockTransport.triggerHandler('increment.event', mockNotification);

      expect(instance.count).toBe(1);
    });

    it('should handle async handlers correctly', async () => {
      const executionOrder: number[] = [];

      class AsyncHandler {
        @OnNotification('async.event')
        async handleAsync(_notification: IncomingNotification) {
          executionOrder.push(1);
          await new Promise((resolve) => setTimeout(resolve, 10));
          executionOrder.push(2);
        }
      }

      const instance = new AsyncHandler();
      await NotificationsModule.registerHandlers(mockTransport, instance);

      const mockNotification: IncomingNotification = {
        id: 'test-1',
        channel: 'async.event',
        payload: { type: 'test', data: {} },
        timestamp: Date.now(),
        attempt: 1,
        async ack() {},
      };

      await mockTransport.triggerHandler('async.event', mockNotification);

      expect(executionOrder).toEqual([1, 2]);
    });

    it('should warn when handler method not found', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation();

      class BrokenHandler {
        // Method will be removed to simulate missing handler
      }

      // Manually add metadata for non-existent method
      Reflect.defineMetadata(
        'notifications:handlers',
        [{ pattern: 'test.event', methodName: 'nonExistent', options: {} }],
        BrokenHandler
      );

      const instance = new BrokenHandler();
      await NotificationsModule.registerHandlers(mockTransport, instance);

      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });
  });

  describe('Handler Unregistration', () => {
    it('should unregister all handlers for instance', async () => {
      // Clear any existing subscriptions first
      const existingKeys = Array.from(NotificationsModule.getActiveSubscriptions().keys());

      class TestHandler {
        @OnNotification('test1')
        async handle1(_notification: IncomingNotification) {}

        @OnNotification('test2')
        async handle2(_notification: IncomingNotification) {}
      }

      const instance = new TestHandler();
      await NotificationsModule.registerHandlers(mockTransport, instance);

      const subscriptionsBefore = mockTransport.getSubscriptions();
      expect(subscriptionsBefore.size).toBeGreaterThan(0);

      // Verify subscriptions were added
      const activeSubsBefore = NotificationsModule.getActiveSubscriptions();
      const instanceKeysBefore = Array.from(activeSubsBefore.keys()).filter(
        (key) => key.includes('TestHandler') && !existingKeys.includes(key)
      );
      expect(instanceKeysBefore.length).toBeGreaterThan(0);

      await NotificationsModule.unregisterHandlers(instance);

      // Verify cleanup - new TestHandler subscriptions should be removed
      const activeSubscriptionsAfter = NotificationsModule.getActiveSubscriptions();
      const instanceKeysAfter = Array.from(activeSubscriptionsAfter.keys()).filter(
        (key) => key.includes('TestHandler') && !existingKeys.includes(key)
      );
      expect(instanceKeysAfter).toHaveLength(0);
    });

    it('should handle unregistering instance with no handlers', async () => {
      class NoHandlers {}

      const instance = new NoHandlers();

      // Should not throw
      await expect(NotificationsModule.unregisterHandlers(instance)).resolves.not.toThrow();
    });

    it('should handle unregistering unknown instance', async () => {
      class UnknownHandler {}

      const instance = new UnknownHandler();

      // Should not throw
      await expect(NotificationsModule.unregisterHandlers(instance)).resolves.not.toThrow();
    });
  });

  describe('Active Subscriptions', () => {
    it('should track active subscriptions', async () => {
      class TrackedHandler {
        @OnNotification('tracked.event')
        async handleTracked(_notification: IncomingNotification) {}
      }

      const instance = new TrackedHandler();
      await NotificationsModule.registerHandlers(mockTransport, instance);

      const subscriptions = NotificationsModule.getActiveSubscriptions();
      expect(subscriptions.size).toBeGreaterThan(0);

      const keys = Array.from(subscriptions.keys());
      const trackedKey = keys.find((k) => k.includes('TrackedHandler') && k.includes('tracked.event'));
      expect(trackedKey).toBeDefined();
    });

    it('should return copy of subscriptions map', async () => {
      const subscriptions1 = NotificationsModule.getActiveSubscriptions();
      const subscriptions2 = NotificationsModule.getActiveSubscriptions();

      expect(subscriptions1).not.toBe(subscriptions2);
    });

    it('should update subscriptions after registration', async () => {
      const beforeCount = NotificationsModule.getActiveSubscriptions().size;

      class NewHandler {
        @OnNotification('new.event')
        async handleNew(_notification: IncomingNotification) {}
      }

      const instance = new NewHandler();
      await NotificationsModule.registerHandlers(mockTransport, instance);

      const afterCount = NotificationsModule.getActiveSubscriptions().size;
      expect(afterCount).toBeGreaterThan(beforeCount);
    });
  });

  describe('Integration', () => {
    it('should work with complete module setup', async () => {
      const container = new Container();

      const module = NotificationsModule.forRoot({
        transport: {
          useTransport: mockTransport,
        },
      });

      // Register providers manually for test
      for (const provider of module.providers!) {
        if (Array.isArray(provider)) {
          const [token, definition] = provider;
          container.register(token, definition);
        } else {
          container.register(provider, { useClass: provider });
        }
      }

      // Use resolveAsync for async providers
      const notificationsService = await container.resolveAsync(NotificationsService);
      expect(notificationsService).toBeDefined();
      expect(notificationsService).toBeInstanceOf(NotificationsService);

      const transport = await container.resolveAsync(NOTIFICATIONS_TRANSPORT);
      expect(transport).toBe(mockTransport);
    });

    it('should integrate with handler registration', async () => {
      class IntegrationHandler {
        public received: any[] = [];

        @OnNotification('integration.*')
        async handleIntegration(notification: IncomingNotification) {
          this.received.push(notification.payload);
          await notification.ack();
        }
      }

      const instance = new IntegrationHandler();
      await NotificationsModule.registerHandlers(mockTransport, instance);

      // Send notification
      const service = new NotificationsService(mockTransport);
      const recipient: NotificationRecipient = { id: 'user-1' };
      const payload: NotificationPayload = {
        type: 'info',
        title: 'Test',
        message: 'Integration test',
      };

      await service.send(recipient, payload);

      const published = mockTransport.getPublishedMessages();
      expect(published.length).toBeGreaterThan(0);
    });

    it('should handle module with all optional features', () => {
      const mockRateLimiter: IRateLimiter = {
        checkLimit: vi.fn(),
        recordSent: vi.fn(),
      };

      const mockPreferenceStore: IPreferenceStore = {
        getPreferences: vi.fn(),
        setPreferences: vi.fn(),
        updatePreferences: vi.fn(),
        deletePreferences: vi.fn(),
      };

      const mockChannelRouter: IChannelRouter = {
        route: vi.fn(),
      };

      const module = NotificationsModule.forRoot({
        transport: { useTransport: mockTransport },
        rateLimiter: mockRateLimiter,
        preferenceStore: mockPreferenceStore,
        channelRouter: mockChannelRouter,
        isGlobal: true,
      });

      expect(module.global).toBe(true);
      expect(module.exports).toContain(NOTIFICATIONS_RATE_LIMITER);
      expect(module.exports).toContain(NOTIFICATIONS_PREFERENCE_STORE);
      expect(module.exports).toContain(NOTIFICATIONS_CHANNEL_ROUTER);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty forRoot options', () => {
      const module = NotificationsModule.forRoot();

      expect(module).toBeDefined();
      expect(module.providers).toBeDefined();
      expect(module.exports).toBeDefined();
    });

    it('should handle multiple module instances', () => {
      const module1 = NotificationsModule.forRoot({});
      const module2 = NotificationsModule.forRoot({});

      expect(module1).not.toBe(module2);
      expect(module1.providers).not.toBe(module2.providers);
    });

    it('should handle registering same handler class multiple times', async () => {
      class RepeatedHandler {
        @OnNotification('repeated.event')
        async handleRepeated(_notification: IncomingNotification) {}
      }

      const instance1 = new RepeatedHandler();
      const instance2 = new RepeatedHandler();

      await NotificationsModule.registerHandlers(mockTransport, instance1);
      await NotificationsModule.registerHandlers(mockTransport, instance2);

      const subscriptions = mockTransport.getSubscriptions();
      expect(subscriptions.has('repeated.event')).toBe(true);
      expect(subscriptions.get('repeated.event')?.length).toBe(2);
    });

    it('should handle handler that throws error', async () => {
      class ErrorHandler {
        @OnNotification('error.event')
        async handleError(_notification: IncomingNotification) {
          throw new Error('Handler error');
        }
      }

      const instance = new ErrorHandler();
      await NotificationsModule.registerHandlers(mockTransport, instance);

      const mockNotification: IncomingNotification = {
        id: 'test-1',
        channel: 'error.event',
        payload: { type: 'test', data: {} },
        timestamp: Date.now(),
        attempt: 1,
        async ack() {},
      };

      await expect(mockTransport.triggerHandler('error.event', mockNotification)).rejects.toThrow('Handler error');
    });
  });
});
