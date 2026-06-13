import { createNullLogger, type ILogger } from '@omnitron-dev/titan/types';
/**
 * Notifications Module for Titan Framework
 *
 * Provides notification system integration with Nexus DI and Application lifecycle.
 * Supports:
 * - Dependency injection of NotificationsService and NotificationTransport
 * - Configuration via forRoot/forRootAsync patterns
 * - Decorator-based notification handler registration
 * - Optional rate limiting, preference management, and channel routing
 * - Health monitoring
 * - Worker mode for consuming notification events from Rotif
 */

import { DynamicModule, Provider, ProviderDefinition, InjectionToken, Scope } from '@omnitron-dev/titan/nexus';
import { Module } from '@omnitron-dev/titan/decorators';
import { NotificationManager } from './rotif/rotif.js';
import { NotificationsService } from './notifications.service.js';
import { RotifTransport } from './transport/rotif.transport.js';
import { NotificationsHealthIndicator } from './notifications.health.js';
import { NotificationsEventEmitter } from './notifications.events.js';
import { getNotificationHandlers, type NotificationHandlerMetadata } from './notifications.decorators.js';
import { ChannelRegistry } from './channel/channel-registry.js';
import { InAppChannel } from './channel/channels/inapp.channel.js';
import { WebhookChannel } from './channel/channels/webhook.channel.js';
import { TemplateEngine, DEFAULT_TEMPLATES } from './template-engine.js';
import { RedisRateLimiter } from './redis-rate-limiter.js';
import { RedisPreferenceStore } from './redis-preference-store.js';
import {
  NOTIFICATIONS_TRANSPORT,
  NOTIFICATIONS_SERVICE,
  NOTIFICATIONS_RATE_LIMITER,
  NOTIFICATIONS_PREFERENCE_STORE,
  NOTIFICATIONS_CHANNEL_ROUTER,
  NOTIFICATIONS_MODULE_OPTIONS,
  NOTIFICATIONS_HEALTH,
  NOTIFICATIONS_CHANNEL_REGISTRY,
  NOTIFICATIONS_EVENT_EMITTER,
  NOTIFICATIONS_TEMPLATE_ENGINE,
  NOTIFICATIONS_REDIS_RATE_LIMITER,
  NOTIFICATIONS_REDIS_PREFERENCE_STORE,
} from './notifications.tokens.js';
import { NotificationWorkerService } from './worker/notification-worker.js';
import {
  NOTIFICATION_TARGET_RESOLVER,
  NOTIFICATION_PERSISTER,
  NOTIFICATION_REALTIME_SIGNALER,
} from './worker/worker.tokens.js';
import type {
  INotificationTargetResolver,
  INotificationPersister,
  INotificationRealtimeSignaler,
} from './worker/worker.interfaces.js';
import type { NotificationWorkerOptions } from './worker/notification-worker.js';
import type {
  NotificationsModuleOptions,
  NotificationsModuleAsyncOptions,
  NotificationsOptionsFactory,
} from './notifications.types.js';
import type { MessagingTransport, IncomingNotification } from './transport/transport.interface.js';
import type { RedisOptions, Redis } from 'ioredis';
// NT-4: the app's managed Redis client (titan-redis already a peerDep). Injected
// OPTIONALLY so notifications boots fine without titan-redis; used as the default
// Redis when no explicit options.redis is supplied (Invariant #3 — prefer DI over
// a raw new Redis()).
import { getRedisClientToken, type IRedisClient } from '@omnitron-dev/titan-redis';

/**
 * NT-4: resolve the Redis client for a notifications sub-service (rate-limiter /
 * preference-store). An explicit `options.redis` wins (a dedicated connection,
 * back-compat); otherwise fall back to the app's MANAGED titan-redis client
 * (injected optionally) so the module stops bypassing DI / defaulting to db 0.
 * Returns null when neither is available — the sub-service is then simply not
 * provided (a `null` provider, exactly as the forRootAsync path already did).
 *
 * The managed client is a real ioredis `Redis` under the `IRedisClient` type
 * (RedisManager.getClient returns `client as unknown as IRedisClient`), so the
 * cast is runtime-safe.
 */
async function resolveNotificationsRedis(
  redisOpt: NotificationsModuleOptions['redis'],
  managed: IRedisClient | undefined
): Promise<Redis | null> {
  if (redisOpt) {
    const { Redis } = await import('ioredis');
    return typeof redisOpt === 'string' ? new Redis(redisOpt) : new Redis(redisOpt as RedisOptions);
  }
  return managed ? (managed as unknown as Redis) : null;
}

/**
 * NT-4: derive ioredis connection options from the app's managed titan-redis
 * client so Rotif can open its OWN dedicated sockets (main + DLQ + pub/sub
 * subscriber) against the same server. We hand Rotif options rather than the
 * managed client itself because Rotif must own physically separate connections —
 * a socket in subscriber mode cannot run normal commands, and the blocking
 * XREADGROUP loop would otherwise stall the shared client. This mirrors
 * ioredis' own `duplicate()`, which clones from `client.options`.
 */
function redisOptionsFromManaged(managed: IRedisClient): RedisOptions {
  return { ...((managed as unknown as Redis).options as RedisOptions) };
}

/**
 * Options for configuring the notification worker module.
 *
 * App-level code provides implementations of the three worker interfaces
 * either as class references (resolved via DI) or as injection tokens.
 */
export interface NotificationsWorkerModuleOptions {
  /** Implementation of INotificationTargetResolver (class or token) */
  targetResolver: InjectionToken<INotificationTargetResolver>;
  /** Implementation of INotificationPersister (class or token) */
  persister: InjectionToken<INotificationPersister>;
  /** Implementation of INotificationRealtimeSignaler (class or token) */
  realtimeSignaler: InjectionToken<INotificationRealtimeSignaler>;
  /** Worker tuning options */
  workerOptions?: NotificationWorkerOptions;
  /** Make the module global */
  isGlobal?: boolean;
}

/**
 * Notifications Module - Notification system integration for Titan Framework
 *
 * @example
 * ```typescript
 * // Simple configuration with Rotif transport
 * @Module({
 *   imports: [
 *     NotificationsModule.forRoot({
 *       redis: { host: 'localhost', port: 6379 },
 *       transport: {
 *         rotif: {
 *           maxRetries: 5,
 *           deduplicationTTL: 3600,
 *         },
 *       },
 *     }),
 *   ],
 * })
 * class AppModule {}
 *
 * // With custom transport
 * @Module({
 *   imports: [
 *     NotificationsModule.forRoot({
 *       transport: {
 *         useTransport: new CustomTransport(),
 *       },
 *     }),
 *   ],
 * })
 * class AppModule {}
 *
 * // Async configuration with ConfigService
 * @Module({
 *   imports: [
 *     NotificationsModule.forRootAsync({
 *       useFactory: (config: ConfigService) => ({
 *         redis: config.get('redis'),
 *         transport: {
 *           rotif: {
 *             maxRetries: config.get('neonotif.maxRetries'),
 *           },
 *         },
 *         rateLimiter: new RedisRateLimiter(config.get('redis')),
 *       }),
 *       inject: [ConfigService],
 *     }),
 *   ],
 * })
 * class AppModule {}
 * ```
 */
@Module()
export class NotificationsModule {
  name = 'NotificationsModule';

  private static activeSubscriptions: Map<string, any> = new Map();
  private static handlerInstances: WeakMap<any, any[]> = new WeakMap();
  private static logger: ILogger = createNullLogger();

  /**
   * Creates a MessagingTransport instance from options.
   * @param options - Module configuration options
   * @returns MessagingTransport instance
   * @private
   */
  private static async createTransport(
    options: NotificationsModuleOptions,
    managed?: IRedisClient
  ): Promise<MessagingTransport> {
    // Use custom transport if provided
    if (options.transport?.useTransport) {
      return options.transport.useTransport;
    }

    // Create default Rotif transport. NT-4: an explicit `options.redis` wins
    // (dedicated connection, back-compat); otherwise derive connection options
    // from the app's managed titan-redis client so Rotif's own sockets land on
    // the same server/db instead of silently defaulting to localhost:6379/db0.
    // The localhost fallback only applies when neither is available, preserving
    // the prior zero-config behaviour.
    const redis: RedisOptions | string =
      options.redis ?? (managed ? redisOptionsFromManaged(managed) : { host: 'localhost', port: 6379 });
    const rotifOptions = options.transport?.rotif || {};

    const manager = new NotificationManager({
      redis: redis as RedisOptions,
      maxRetries: rotifOptions.maxRetries,
      retryDelay: rotifOptions.retryDelay,
      deduplicationTTL: rotifOptions.deduplicationTTL,
      maxStreamLength: rotifOptions.maxStreamLength,
      disableDelayed: rotifOptions.disableDelayed,
    });

    await manager.waitUntilReady();

    return new RotifTransport(manager);
  }

  /**
   * Configure the Notifications module with static options.
   *
   * @param options - Module configuration options
   * @returns Dynamic module configuration
   */
  static forRoot(options: NotificationsModuleOptions = {}): DynamicModule {
    const providers: Array<[InjectionToken<any>, ProviderDefinition<any>] | Provider<any>> = [
      // Options provider
      [
        NOTIFICATIONS_MODULE_OPTIONS,
        {
          useValue: options,
        },
      ],

      // Transport provider. NT-4: optionally inject the managed titan-redis
      // client so Rotif's dedicated connections derive from it when no explicit
      // options.redis is given.
      [
        NOTIFICATIONS_TRANSPORT,
        {
          useFactory: async (managed?: IRedisClient) => this.createTransport(options, managed),
          inject: [{ token: getRedisClientToken(), optional: true }],
          scope: Scope.Singleton,
        },
      ],

      // NotificationsService provider
      NotificationsService,

      // Also bind to NOTIFICATIONS_SERVICE token
      [
        NOTIFICATIONS_SERVICE,
        {
          useToken: NotificationsService,
        },
      ],

      // Health indicator provider
      [
        NOTIFICATIONS_HEALTH,
        {
          useFactory: async (transport: MessagingTransport) => new NotificationsHealthIndicator(transport),
          inject: [NOTIFICATIONS_TRANSPORT],
          scope: Scope.Singleton,
        },
      ],

      // Event emitter provider
      NotificationsEventEmitter,
      [
        NOTIFICATIONS_EVENT_EMITTER,
        {
          useToken: NotificationsEventEmitter,
        },
      ],
    ];

    // Add optional feature providers
    if (options.rateLimiter) {
      providers.push([
        NOTIFICATIONS_RATE_LIMITER,
        {
          useValue: options.rateLimiter,
        },
      ]);
    }

    if (options.preferenceStore) {
      providers.push([
        NOTIFICATIONS_PREFERENCE_STORE,
        {
          useValue: options.preferenceStore,
        },
      ]);
    }

    if (options.channelRouter) {
      providers.push([
        NOTIFICATIONS_CHANNEL_ROUTER,
        {
          useValue: options.channelRouter,
        },
      ]);
    }

    // Add ChannelRegistry provider
    providers.push([
      NOTIFICATIONS_CHANNEL_REGISTRY,
      {
        useFactory: async () => {
          const registry = new ChannelRegistry();

          // Register pre-configured channels
          if (options.channels) {
            for (const channel of options.channels) {
              registry.register(channel);
            }
          }

          // Auto-register InApp channel if enabled and redis configured
          if (options.enableInApp !== false && options.redis) {
            const inAppChannel = new InAppChannel();
            if (options.inAppConfig) {
              inAppChannel.configure(options.inAppConfig);
            }
            registry.register(inAppChannel);
          }

          // Auto-register Webhook channel if enabled
          if (options.enableWebhook !== false) {
            const webhookChannel = new WebhookChannel(options.webhookConfig);
            registry.register(webhookChannel);
          }

          // Initialize all channels
          await registry.initializeAll();

          return registry;
        },
        scope: Scope.Singleton,
      },
    ]);

    const exports: InjectionToken<any>[] = [
      NOTIFICATIONS_TRANSPORT,
      NOTIFICATIONS_SERVICE,
      NotificationsService,
      NOTIFICATIONS_HEALTH,
      NOTIFICATIONS_MODULE_OPTIONS,
      NOTIFICATIONS_CHANNEL_REGISTRY,
      NOTIFICATIONS_EVENT_EMITTER,
      NotificationsEventEmitter,
    ];

    // Template Engine provider (if enabled)
    if (options.templates?.enabled !== false) {
      providers.push([
        NOTIFICATIONS_TEMPLATE_ENGINE,
        {
          useFactory: async () => {
            const engine = new TemplateEngine(options.templates);
            // Register default templates
            for (const template of DEFAULT_TEMPLATES) {
              engine.register(template);
            }
            return engine;
          },
          scope: Scope.Singleton,
        },
      ]);
      exports.push(NOTIFICATIONS_TEMPLATE_ENGINE);
    }

    // Built-in Redis Rate Limiter (if no custom provided). NT-4: register
    // whenever no custom limiter is supplied — the factory uses options.redis
    // when set, else the app's managed Redis client, else resolves to null
    // (the service @Optional-injects NOTIFICATIONS_RATE_LIMITER).
    if (!options.rateLimiter) {
      providers.push([
        NOTIFICATIONS_REDIS_RATE_LIMITER,
        {
          useFactory: async (managed?: IRedisClient) => {
            const redisClient = await resolveNotificationsRedis(options.redis, managed);
            return redisClient ? new RedisRateLimiter(redisClient, options.rateLimiterConfig) : null;
          },
          inject: [{ token: getRedisClientToken(), optional: true }],
          scope: Scope.Singleton,
        },
      ]);
      // Also register as IRateLimiter
      providers.push([
        NOTIFICATIONS_RATE_LIMITER,
        {
          useToken: NOTIFICATIONS_REDIS_RATE_LIMITER,
        },
      ]);
      exports.push(NOTIFICATIONS_REDIS_RATE_LIMITER);
      exports.push(NOTIFICATIONS_RATE_LIMITER);
    }

    // Built-in Redis Preference Store (if no custom provided). NT-4: managed
    // client default + explicit options.redis override; null when neither
    // (the service @Optional-injects NOTIFICATIONS_PREFERENCE_STORE).
    if (!options.preferenceStore) {
      providers.push([
        NOTIFICATIONS_REDIS_PREFERENCE_STORE,
        {
          useFactory: async (managed?: IRedisClient) => {
            const redisClient = await resolveNotificationsRedis(options.redis, managed);
            return redisClient ? new RedisPreferenceStore(redisClient, options.preferenceStoreConfig) : null;
          },
          inject: [{ token: getRedisClientToken(), optional: true }],
          scope: Scope.Singleton,
        },
      ]);
      // Also register as IPreferenceStore
      providers.push([
        NOTIFICATIONS_PREFERENCE_STORE,
        {
          useToken: NOTIFICATIONS_REDIS_PREFERENCE_STORE,
        },
      ]);
      exports.push(NOTIFICATIONS_REDIS_PREFERENCE_STORE);
      exports.push(NOTIFICATIONS_PREFERENCE_STORE);
    }

    // Export optional features if provided
    if (options.rateLimiter) {
      exports.push(NOTIFICATIONS_RATE_LIMITER);
    }
    if (options.preferenceStore) {
      exports.push(NOTIFICATIONS_PREFERENCE_STORE);
    }
    if (options.channelRouter) {
      exports.push(NOTIFICATIONS_CHANNEL_ROUTER);
    }

    const result: DynamicModule = {
      module: NotificationsModule,
      providers,
      exports,
    };

    if (options.isGlobal) {
      result.global = true;
    }

    return result;
  }

  /**
   * Configure the Notifications module with async options.
   * Supports useFactory, useClass, and useExisting patterns.
   *
   * @param options - Async module configuration options
   * @returns Dynamic module configuration
   */
  static forRootAsync(options: NotificationsModuleAsyncOptions): DynamicModule {
    const providers: Array<[InjectionToken<any>, ProviderDefinition<any>] | Provider<any>> = [];

    // Create async options provider
    const asyncProviders = this.createAsyncProviders(options);
    providers.push(...asyncProviders);

    // Transport provider with async options. NT-4: also optionally inject the
    // managed titan-redis client (see forRoot) so Rotif derives its dedicated
    // connections from it when no explicit options.redis is supplied.
    providers.push([
      NOTIFICATIONS_TRANSPORT,
      {
        useFactory: async (moduleOptions: NotificationsModuleOptions, managed?: IRedisClient) =>
          this.createTransport(moduleOptions, managed),
        inject: [NOTIFICATIONS_MODULE_OPTIONS, { token: getRedisClientToken(), optional: true }],
        scope: Scope.Singleton,
      },
    ]);

    // NotificationsService provider
    providers.push(NotificationsService);

    // Also bind to NOTIFICATIONS_SERVICE token
    providers.push([
      NOTIFICATIONS_SERVICE,
      {
        useToken: NotificationsService,
      },
    ]);

    // Health indicator provider
    providers.push([
      NOTIFICATIONS_HEALTH,
      {
        useFactory: async (transport: MessagingTransport) => new NotificationsHealthIndicator(transport),
        inject: [NOTIFICATIONS_TRANSPORT],
        scope: Scope.Singleton,
      },
    ]);

    // Event emitter provider
    providers.push(NotificationsEventEmitter);
    providers.push([
      NOTIFICATIONS_EVENT_EMITTER,
      {
        useToken: NotificationsEventEmitter,
      },
    ]);

    // Add ChannelRegistry provider
    providers.push([
      NOTIFICATIONS_CHANNEL_REGISTRY,
      {
        useFactory: async (moduleOptions: NotificationsModuleOptions) => {
          const registry = new ChannelRegistry();

          // Register pre-configured channels
          if (moduleOptions.channels) {
            for (const channel of moduleOptions.channels) {
              registry.register(channel);
            }
          }

          // Auto-register InApp channel if enabled and redis configured
          if (moduleOptions.enableInApp !== false && moduleOptions.redis) {
            const inAppChannel = new InAppChannel();
            if (moduleOptions.inAppConfig) {
              inAppChannel.configure(moduleOptions.inAppConfig);
            }
            registry.register(inAppChannel);
          }

          // Auto-register Webhook channel if enabled
          if (moduleOptions.enableWebhook !== false) {
            const webhookChannel = new WebhookChannel(moduleOptions.webhookConfig);
            registry.register(webhookChannel);
          }

          // Initialize all channels
          await registry.initializeAll();

          return registry;
        },
        inject: [NOTIFICATIONS_MODULE_OPTIONS],
        scope: Scope.Singleton,
      },
    ]);

    const exports: InjectionToken<any>[] = [
      NOTIFICATIONS_TRANSPORT,
      NOTIFICATIONS_SERVICE,
      NotificationsService,
      NOTIFICATIONS_HEALTH,
      NOTIFICATIONS_MODULE_OPTIONS,
      NOTIFICATIONS_CHANNEL_REGISTRY,
      NOTIFICATIONS_EVENT_EMITTER,
      NotificationsEventEmitter,
    ];

    // Template Engine provider (always check options at factory time)
    providers.push([
      NOTIFICATIONS_TEMPLATE_ENGINE,
      {
        useFactory: async (moduleOptions: NotificationsModuleOptions) => {
          if (moduleOptions.templates?.enabled === false) {
            return null;
          }
          const engine = new TemplateEngine(moduleOptions.templates);
          // Register default templates
          for (const template of DEFAULT_TEMPLATES) {
            engine.register(template);
          }
          return engine;
        },
        inject: [NOTIFICATIONS_MODULE_OPTIONS],
        scope: Scope.Singleton,
      },
    ]);
    exports.push(NOTIFICATIONS_TEMPLATE_ENGINE);

    // Built-in Redis Rate Limiter (if no custom provided)
    providers.push([
      NOTIFICATIONS_REDIS_RATE_LIMITER,
      {
        useFactory: async (moduleOptions: NotificationsModuleOptions, managed?: IRedisClient) => {
          if (moduleOptions.rateLimiter) return null;
          const redisClient = await resolveNotificationsRedis(moduleOptions.redis, managed); // NT-4
          return redisClient ? new RedisRateLimiter(redisClient, moduleOptions.rateLimiterConfig) : null;
        },
        inject: [NOTIFICATIONS_MODULE_OPTIONS, { token: getRedisClientToken(), optional: true }],
        scope: Scope.Singleton,
      },
    ]);
    exports.push(NOTIFICATIONS_REDIS_RATE_LIMITER);

    // Conditionally register as IRateLimiter
    providers.push([
      NOTIFICATIONS_RATE_LIMITER,
      {
        useFactory: async (moduleOptions: NotificationsModuleOptions, redisRateLimiter: RedisRateLimiter | null) => {
          if (moduleOptions.rateLimiter) {
            return moduleOptions.rateLimiter;
          }
          return redisRateLimiter;
        },
        inject: [NOTIFICATIONS_MODULE_OPTIONS, NOTIFICATIONS_REDIS_RATE_LIMITER],
      },
    ]);
    exports.push(NOTIFICATIONS_RATE_LIMITER);

    // Built-in Redis Preference Store (if no custom provided)
    providers.push([
      NOTIFICATIONS_REDIS_PREFERENCE_STORE,
      {
        useFactory: async (moduleOptions: NotificationsModuleOptions, managed?: IRedisClient) => {
          if (moduleOptions.preferenceStore) return null;
          const redisClient = await resolveNotificationsRedis(moduleOptions.redis, managed); // NT-4
          return redisClient ? new RedisPreferenceStore(redisClient, moduleOptions.preferenceStoreConfig) : null;
        },
        inject: [NOTIFICATIONS_MODULE_OPTIONS, { token: getRedisClientToken(), optional: true }],
        scope: Scope.Singleton,
      },
    ]);
    exports.push(NOTIFICATIONS_REDIS_PREFERENCE_STORE);

    // Conditionally register as IPreferenceStore
    providers.push([
      NOTIFICATIONS_PREFERENCE_STORE,
      {
        useFactory: async (
          moduleOptions: NotificationsModuleOptions,
          redisPreferenceStore: RedisPreferenceStore | null
        ) => {
          if (moduleOptions.preferenceStore) {
            return moduleOptions.preferenceStore;
          }
          return redisPreferenceStore;
        },
        inject: [NOTIFICATIONS_MODULE_OPTIONS, NOTIFICATIONS_REDIS_PREFERENCE_STORE],
      },
    ]);
    exports.push(NOTIFICATIONS_PREFERENCE_STORE);

    // Export channel router if provided
    providers.push([
      NOTIFICATIONS_CHANNEL_ROUTER,
      {
        useFactory: async (moduleOptions: NotificationsModuleOptions) => moduleOptions.channelRouter || null,
        inject: [NOTIFICATIONS_MODULE_OPTIONS],
      },
    ]);
    exports.push(NOTIFICATIONS_CHANNEL_ROUTER);

    const result: DynamicModule = {
      module: NotificationsModule,
      imports: options.imports || [],
      providers,
      exports,
    };

    if (options.isGlobal) {
      result.global = true;
    }

    return result;
  }

  /**
   * Configure the Notifications module for worker (consumer) mode.
   *
   * In this mode the module sets up the NotificationWorkerService with
   * app-provided implementations of the three worker interfaces:
   * - INotificationTargetResolver — resolves target user IDs from events
   * - INotificationPersister — persists notification records to the database
   * - INotificationRealtimeSignaler — signals real-time clients
   *
   * The app module must also provide a Redis client and call
   * `workerService.start(redis)` during application bootstrap.
   *
   * @example
   * ```typescript
   * @Module({
   *   imports: [
   *     NotificationsModule.forWorker({
   *       targetResolver: AppNotificationTargetResolver,
   *       persister: AppNotificationPersister,
   *       realtimeSignaler: AppNotificationRealtimeSignaler,
   *     }),
   *   ],
   *   providers: [
   *     AppNotificationTargetResolver,
   *     AppNotificationPersister,
   *     AppNotificationRealtimeSignaler,
   *   ],
   * })
   * class AppModule {}
   * ```
   */
  static forWorker(options: NotificationsWorkerModuleOptions): DynamicModule {
    const providers: Array<[InjectionToken<any>, ProviderDefinition<any>] | Provider<any>> = [];

    // Bind app-provided implementations to worker tokens
    providers.push([
      NOTIFICATION_TARGET_RESOLVER,
      {
        useToken: options.targetResolver,
      },
    ]);

    providers.push([
      NOTIFICATION_PERSISTER,
      {
        useToken: options.persister,
      },
    ]);

    providers.push([
      NOTIFICATION_REALTIME_SIGNALER,
      {
        useToken: options.realtimeSignaler,
      },
    ]);

    // Register the worker service itself
    providers.push(NotificationWorkerService);

    const exports: InjectionToken<any>[] = [
      NotificationWorkerService,
      NOTIFICATION_TARGET_RESOLVER,
      NOTIFICATION_PERSISTER,
      NOTIFICATION_REALTIME_SIGNALER,
    ];

    const result: DynamicModule = {
      module: NotificationsModule,
      providers,
      exports,
    };

    if (options.isGlobal) {
      result.global = true;
    }

    return result;
  }

  /**
   * Register notification handlers from a class decorated with @OnNotification.
   * This is used internally during module initialization.
   *
   * @param transport - The MessagingTransport instance
   * @param instance - The class instance containing decorated handlers
   * @returns Array of created subscriptions
   */
  static async registerHandlers(transport: MessagingTransport, instance: any): Promise<void> {
    const constructor = instance.constructor;
    const handlerMetadata: NotificationHandlerMetadata[] = getNotificationHandlers(constructor);

    if (handlerMetadata.length === 0) {
      return;
    }

    const subscriptions: any[] = [];

    for (const metadata of handlerMetadata) {
      const { pattern, methodName, options } = metadata;
      const handler = instance[methodName];

      if (typeof handler !== 'function') {
        this.logger?.warn(
          { methodName: String(methodName), className: constructor.name },
          'Handler method not found on class'
        );
        continue;
      }

      // Bind the handler to the instance
      const boundHandler = async (notification: IncomingNotification): Promise<void> => {
        await handler.call(instance, notification);
      };

      // Subscribe to the pattern
      const subscription = await transport.subscribe(pattern, boundHandler, options);
      subscriptions.push(subscription);

      // Track the subscription
      const subscriptionKey = `${constructor.name}:${String(methodName)}:${pattern}`;
      this.activeSubscriptions.set(subscriptionKey, subscription);
    }

    // Store handler metadata for the instance
    const handlers = handlerMetadata.map((meta, index) => ({
      instance,
      methodName: meta.methodName,
      pattern: meta.pattern,
      options: meta.options,
      subscription: subscriptions[index],
    }));

    this.handlerInstances.set(instance, handlers);
  }

  /**
   * Unregister all handlers for a given instance.
   *
   * @param instance - The class instance to unregister handlers for
   */
  static async unregisterHandlers(instance: any): Promise<void> {
    const handlers = this.handlerInstances.get(instance);

    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      if (handler.subscription) {
        await handler.subscription.unsubscribe();
      }

      const subscriptionKey = `${instance.constructor.name}:${String(handler.methodName)}:${handler.pattern}`;
      this.activeSubscriptions.delete(subscriptionKey);
    }

    this.handlerInstances.delete(instance);
  }

  /**
   * Get all active subscriptions.
   */
  static getActiveSubscriptions(): Map<string, any> {
    return new Map(this.activeSubscriptions);
  }

  /**
   * Create async providers based on the configuration options.
   */
  private static createAsyncProviders(
    options: NotificationsModuleAsyncOptions
  ): Array<[InjectionToken<any>, ProviderDefinition<any>] | Provider<any>> {
    const providers: Array<[InjectionToken<any>, ProviderDefinition<any>] | Provider<any>> = [];

    if (options.useFactory) {
      providers.push([
        NOTIFICATIONS_MODULE_OPTIONS,
        {
          useFactory: async (...args: any[]) => Promise.resolve(options.useFactory!(...args)),
          // options.inject is already typed as `any[]` so it satisfies
          // `InjectionToken<any>[]` structurally — no narrowing cast
          // needed beyond the original union.
          inject: options.inject || [],
        },
      ]);
    } else if (options.useExisting) {
      providers.push([
        NOTIFICATIONS_MODULE_OPTIONS,
        {
          useFactory: async (optionsFactory: NotificationsOptionsFactory) =>
            optionsFactory.createNotificationsOptions(),
          inject: [options.useExisting],
        },
      ]);
    } else if (options.useClass) {
      // The class itself doubles as its own injection token in
      // Titan's DI (same pattern as Nest). Use `InjectionToken<any>`
      // to widen safely without resorting to `as any`.
      const useClassToken = options.useClass as InjectionToken<any>;
      providers.push([
        useClassToken,
        {
          useClass: options.useClass,
        },
      ]);

      providers.push([
        NOTIFICATIONS_MODULE_OPTIONS,
        {
          useFactory: async (optionsFactory: NotificationsOptionsFactory) =>
            optionsFactory.createNotificationsOptions(),
          inject: [useClassToken],
        },
      ]);
    } else {
      // Default empty options
      providers.push([
        NOTIFICATIONS_MODULE_OPTIONS,
        {
          useValue: {} as NotificationsModuleOptions,
        },
      ]);
    }

    return providers;
  }
}
