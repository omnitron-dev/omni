/**
 * Rotif Module for Titan Framework
 *
 * Provides messaging system integration with Nexus DI and Application lifecycle.
 * Supports:
 * - Dependency injection of NotificationManager
 * - Configuration via forRoot/forRootAsync patterns
 * - Decorator-based message handler registration
 * - Proper lifecycle management (init/destroy)
 */

import {
  DynamicModule,
  Provider,
  ProviderDefinition,
  InjectionToken,
  Scope,
} from '../../nexus/index.js';
import { Module, Global } from '../../decorators/index.js';
import { NotificationManager } from '../../rotif/rotif.js';
import { getSubscriptions, type SubscriptionMetadata } from '../../rotif/decorators.js';
import type { RotifMessage, Subscription, ILogger } from '../../rotif/types.js';

import {
  ROTIF_MANAGER_TOKEN,
  ROTIF_MODULE_OPTIONS,
} from './rotif.tokens.js';
import type {
  RotifModuleOptions,
  RotifModuleAsyncOptions,
  RotifOptionsFactory,
  RotifHandlerMetadata,
} from './rotif.types.js';

/**
 * Rotif Module - Messaging system integration for Titan Framework
 *
 * @example
 * ```typescript
 * // Simple configuration
 * @Module({
 *   imports: [
 *     RotifModule.forRoot({
 *       redis: { host: 'localhost', port: 6379 },
 *       maxRetries: 5,
 *     }),
 *   ],
 * })
 * class AppModule {}
 *
 * // Async configuration with ConfigService
 * @Module({
 *   imports: [
 *     RotifModule.forRootAsync({
 *       useFactory: (config: ConfigService) => ({
 *         redis: config.get('redis'),
 *         maxRetries: config.get('rotif.maxRetries'),
 *       }),
 *       inject: [ConfigService],
 *     }),
 *   ],
 * })
 * class AppModule {}
 * ```
 */
@Module()
export class RotifModule {
  name = 'RotifModule';

  private static activeSubscriptions: Map<string, Subscription> = new Map();
  private static handlerInstances: WeakMap<any, RotifHandlerMetadata[]> = new WeakMap();

  /**
   * Creates a NotificationManager instance from options.
   * @param options - Module configuration options
   * @returns NotificationManager instance
   * @private
   */
  private static async createManager(options: RotifModuleOptions): Promise<NotificationManager> {
    const manager = new NotificationManager({
      redis: options.redis,
      logger: options.logger,
      disableDelayed: options.disableDelayed,
      checkDelayInterval: options.checkDelayInterval,
      maxRetries: options.maxRetries,
      maxStreamLength: options.maxStreamLength,
      minStreamId: options.minStreamId,
      blockInterval: options.blockInterval,
      deduplicationTTL: options.deduplicationTTL,
      scheduledBatchSize: options.scheduledBatchSize,
      retryDelay: options.retryDelay,
      retryStrategy: options.retryStrategy,
      localRoundRobin: options.localRoundRobin,
      disablePendingMessageRecovery: options.disablePendingMessageRecovery,
      pendingCheckInterval: options.pendingCheckInterval,
      pendingIdleThreshold: options.pendingIdleThreshold,
      groupNameFn: options.groupNameFn,
      consumerNameFn: options.consumerNameFn,
      generateDedupKey: options.generateDedupKey,
      dlqCleanup: options.dlqCleanup,
    });

    // Wait for initialization to complete
    await manager.waitUntilReady();

    return manager;
  }

  /**
   * Configure the Rotif module with static options.
   *
   * @param options - Module configuration options
   * @returns Dynamic module configuration
   */
  static forRoot(options: RotifModuleOptions): DynamicModule {
    const providers: Array<[InjectionToken<any>, ProviderDefinition<any>] | Provider<any>> = [
      // Options provider
      [
        ROTIF_MODULE_OPTIONS,
        {
          useValue: options,
        },
      ],

      // NotificationManager singleton with initialization
      [
        ROTIF_MANAGER_TOKEN,
        {
          useFactory: async () => this.createManager(options),
          scope: Scope.Singleton,
        },
      ],
    ];

    const exports: InjectionToken<any>[] = [ROTIF_MANAGER_TOKEN, ROTIF_MODULE_OPTIONS];

    const result: DynamicModule = {
      module: RotifModule,
      providers,
      exports,
    };

    if (options.isGlobal) {
      result.global = true;
    }

    return result;
  }

  /**
   * Configure the Rotif module with async options.
   * Supports useFactory, useClass, and useExisting patterns.
   *
   * @param options - Async module configuration options
   * @returns Dynamic module configuration
   */
  static forRootAsync(options: RotifModuleAsyncOptions): DynamicModule {
    const providers: Array<[InjectionToken<any>, ProviderDefinition<any>] | Provider<any>> = [];

    // Create async options provider
    const asyncProviders = this.createAsyncProviders(options);
    providers.push(...asyncProviders);

    // NotificationManager provider with async options
    providers.push([
      ROTIF_MANAGER_TOKEN,
      {
        useFactory: async (moduleOptions: RotifModuleOptions) => this.createManager(moduleOptions),
        inject: [ROTIF_MODULE_OPTIONS],
        scope: Scope.Singleton,
      },
    ]);

    const exports: InjectionToken<any>[] = [ROTIF_MANAGER_TOKEN, ROTIF_MODULE_OPTIONS];

    const result: DynamicModule = {
      module: RotifModule,
      imports: (options.imports as any) || [],
      providers,
      exports,
    };

    if (options.isGlobal) {
      result.global = true;
    }

    return result;
  }

  /**
   * Register message handlers from a class decorated with @Subscribe.
   * This is used internally during module initialization.
   *
   * @param manager - The NotificationManager instance
   * @param instance - The class instance containing decorated handlers
   * @param logger - Optional logger for warnings
   * @returns Array of created subscriptions
   */
  static async registerHandlers(
    manager: NotificationManager,
    instance: any,
    logger?: ILogger
  ): Promise<Subscription[]> {
    const constructor = instance.constructor;
    const subscriptionMetadata: SubscriptionMetadata[] = getSubscriptions(constructor);

    if (subscriptionMetadata.length === 0) {
      return [];
    }

    const subscriptions: Subscription[] = [];

    for (const metadata of subscriptionMetadata) {
      const { pattern, methodName, options } = metadata;
      const handler = instance[methodName];

      if (typeof handler !== 'function') {
        logger?.warn(
          { methodName, className: constructor.name },
          'Handler method not found on class'
        );
        continue;
      }

      // Bind the handler to the instance
      const boundHandler = async (msg: RotifMessage): Promise<void> => {
        await handler.call(instance, msg);
      };

      // Subscribe to the pattern
      const subscription = await manager.subscribe(pattern, boundHandler, options);
      subscriptions.push(subscription);

      // Track the subscription
      const subscriptionKey = `${constructor.name}:${methodName}:${pattern}`;
      this.activeSubscriptions.set(subscriptionKey, subscription);
    }

    // Store handler metadata for the instance
    const handlerMetadata: RotifHandlerMetadata[] = subscriptionMetadata.map((meta, index) => ({
      instance,
      methodName: meta.methodName,
      pattern: meta.pattern,
      options: meta.options,
      subscription: subscriptions[index],
    }));
    this.handlerInstances.set(instance, handlerMetadata);

    return subscriptions;
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

      const subscriptionKey = `${instance.constructor.name}:${handler.methodName}:${handler.pattern}`;
      this.activeSubscriptions.delete(subscriptionKey);
    }

    this.handlerInstances.delete(instance);
  }

  /**
   * Get all active subscriptions.
   */
  static getActiveSubscriptions(): Map<string, Subscription> {
    return new Map(this.activeSubscriptions);
  }

  /**
   * Create async providers based on the configuration options.
   */
  private static createAsyncProviders(
    options: RotifModuleAsyncOptions
  ): Array<[InjectionToken<any>, ProviderDefinition<any>] | Provider<any>> {
    const providers: Array<[InjectionToken<any>, ProviderDefinition<any>] | Provider<any>> = [];

    if (options.useFactory) {
      providers.push([
        ROTIF_MODULE_OPTIONS,
        {
          useFactory: async (...args: any[]) => Promise.resolve(options.useFactory!(...args)),
          inject: (options.inject || []) as any,
        },
      ]);
    } else if (options.useExisting) {
      providers.push([
        ROTIF_MODULE_OPTIONS,
        {
          useFactory: async (optionsFactory: RotifOptionsFactory) =>
            optionsFactory.createRotifOptions(),
          inject: [options.useExisting],
        },
      ]);
    } else if (options.useClass) {
      providers.push([
        options.useClass as any,
        {
          useClass: options.useClass,
        },
      ]);

      providers.push([
        ROTIF_MODULE_OPTIONS,
        {
          useFactory: async (optionsFactory: RotifOptionsFactory) =>
            optionsFactory.createRotifOptions(),
          inject: [options.useClass as any],
        },
      ]);
    } else {
      // Default empty options - will likely fail at runtime
      providers.push([
        ROTIF_MODULE_OPTIONS,
        {
          useValue: {} as RotifModuleOptions,
        },
      ]);
    }

    return providers;
  }
}

/**
 * Global Rotif Module - automatically registers globally.
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [
 *     GlobalRotifModule.forRoot({
 *       redis: { host: 'localhost', port: 6379 },
 *     }),
 *   ],
 * })
 * class AppModule {}
 * ```
 */
@Global()
@Module()
export class GlobalRotifModule extends RotifModule {
  override readonly name = 'GlobalRotifModule';

  static override forRoot(options: RotifModuleOptions): DynamicModule {
    return RotifModule.forRoot({ ...options, isGlobal: true });
  }

  static override forRootAsync(options: RotifModuleAsyncOptions): DynamicModule {
    return RotifModule.forRootAsync({ ...options, isGlobal: true });
  }
}
