import { DynamicModule, Provider, ProviderDefinition, InjectionToken } from '../../nexus/index.js';
import { Module } from '../../decorators/index.js';
import { NotificationManager } from '../../rotif/rotif.js';
import { NotificationService } from './notifications.service.js';
import { ChannelManager } from './channel-manager.js';
import { PreferenceManager } from './preference-manager.js';
import { RateLimiter, RateLimitConfig } from './rate-limiter.js';
import { TemplateEngine } from './template-engine.js';
import { WorkflowEngine } from './workflow-engine.js';
import { NotificationAnalytics } from './analytics.js';
import { Redis } from 'ioredis';
import {
  NOTIFICATION_SERVICE,
  CHANNEL_MANAGER,
  PREFERENCE_MANAGER,
  RATE_LIMITER,
  TEMPLATE_ENGINE,
  WORKFLOW_ENGINE,
  ANALYTICS_SERVICE,
  ROTIF_MANAGER,
  NOTIFICATION_MODULE_OPTIONS
} from './constants.js';

export interface NotificationModuleOptions {
  redis?: {
    host?: string;
    port?: number;
    db?: number;
    password?: string;
  };
  rotif?: {
    defaultRetries?: number;
    retryDelay?: number | ((attempt: number) => number);
    deduplicationTTL?: number;
    maxStreamLength?: number;
    disableDelayed?: boolean;
  };
  channels?: {
    email?: {
      enabled?: boolean;
      provider?: string;
      config?: any;
    };
    sms?: {
      enabled?: boolean;
      provider?: string;
      config?: any;
    };
    push?: {
      enabled?: boolean;
      provider?: string;
      config?: any;
    };
    webhook?: {
      enabled?: boolean;
      timeout?: number;
      retries?: number;
    };
    inApp?: {
      enabled?: boolean;
      storage?: 'redis' | 'database';
      ttl?: number;
    };
  };
  rateLimit?: {
    enabled?: boolean;
    default?: RateLimitConfig;
    byChannel?: {
      [channel: string]: RateLimitConfig;
    };
  };
  templates?: {
    enabled?: boolean;
    path?: string;
    cache?: boolean;
    cacheTTL?: number;
  };
  workflows?: {
    enabled?: boolean;
    storage?: 'redis' | 'database';
    maxConcurrent?: number;
  };
  analytics?: {
    enabled?: boolean;
    storage?: 'redis' | 'timescale';
    retention?: number; // days
  };
  defaults?: {
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    ttl?: number;
    channels?: string[];
  };
  isGlobal?: boolean;
}

export interface NotificationOptionsFactory {
  createNotificationOptions(): Promise<NotificationModuleOptions> | NotificationModuleOptions;
}

export interface NotificationModuleAsyncOptions {
  useFactory?: (...args: any[]) => Promise<NotificationModuleOptions> | NotificationModuleOptions;
  inject?: InjectionToken<any>[];
  useExisting?: InjectionToken<NotificationOptionsFactory>;
  useClass?: new (...args: any[]) => NotificationOptionsFactory;
  imports?: any[];
  isGlobal?: boolean;
}

@Module({})
export class TitanNotificationsModule {
  name = 'TitanNotificationsModule';

  static forRoot(options: NotificationModuleOptions = {}): DynamicModule {
    const providers: Array<[InjectionToken<any>, ProviderDefinition<any>]> = [];

    // Store module options
    providers.push([NOTIFICATION_MODULE_OPTIONS, { useValue: options }]);

    // Create Redis client
    const redis = new Redis({
      host: options.redis?.host || 'localhost',
      port: options.redis?.port || 6379,
      db: options.redis?.db || 0,
      password: options.redis?.password
    });

    providers.push(['REDIS_CLIENT' as any, { useValue: redis }]);

    // Create Rotif manager
    providers.push([ROTIF_MANAGER, {
      useFactory: () => {
        const rotifConfig = {
          redis: options.redis || { host: 'localhost', port: 6379 },
          ...options.rotif
        };
        return new NotificationManager(rotifConfig);
      }
    }]);

    // Core services
    providers.push([CHANNEL_MANAGER, {
      useFactory: () => new ChannelManager()
    }]);

    providers.push([PREFERENCE_MANAGER, {
      useFactory: (redisClient: Redis) => new PreferenceManager(redisClient),
      inject: ['REDIS_CLIENT' as any]
    }]);

    providers.push([RATE_LIMITER, {
      useFactory: (redisClient: Redis) => {
        const rateLimitConfig = options.rateLimit?.default;
        return new RateLimiter(redisClient, rateLimitConfig);
      },
      inject: ['REDIS_CLIENT' as any]
    }]);

    // Template engine (optional)
    if (options.templates?.enabled !== false) {
      providers.push([TEMPLATE_ENGINE, {
        useFactory: (redisClient: Redis) => new TemplateEngine(redisClient, options.templates),
        inject: ['REDIS_CLIENT' as any]
      }]);
    }

    // Workflow engine (optional)
    if (options.workflows?.enabled !== false) {
      providers.push([WORKFLOW_ENGINE, {
        useFactory: (notificationService: NotificationService, redisClient: Redis) => new WorkflowEngine(notificationService, redisClient, options.workflows),
        inject: [NOTIFICATION_SERVICE, 'REDIS_CLIENT' as any]
      }]);
    }

    // Analytics (optional)
    if (options.analytics?.enabled !== false) {
      providers.push([ANALYTICS_SERVICE, {
        useFactory: (redisClient: Redis) => new NotificationAnalytics(redisClient, options.analytics),
        inject: ['REDIS_CLIENT' as any]
      }]);
    }

    // Main notification service
    providers.push([NOTIFICATION_SERVICE, {
      useFactory: (
        rotif: NotificationManager,
        channelManager: ChannelManager,
        preferenceManager: PreferenceManager,
        rateLimiter: RateLimiter
      ) => new NotificationService(rotif, channelManager, preferenceManager, rateLimiter),
      inject: [ROTIF_MANAGER, CHANNEL_MANAGER, PREFERENCE_MANAGER, RATE_LIMITER]
    }]);

    // Also register with class token for easier injection
    providers.push([NotificationService as any, {
      useFactory: (service: NotificationService) => service,
      inject: [NOTIFICATION_SERVICE]
    }]);

    // Exports
    const exports: InjectionToken<any>[] = [
      NOTIFICATION_SERVICE,
      NotificationService as any,
      CHANNEL_MANAGER,
      PREFERENCE_MANAGER,
      RATE_LIMITER,
      ROTIF_MANAGER
    ];

    if (options.templates?.enabled !== false) {
      exports.push(TEMPLATE_ENGINE);
    }

    if (options.workflows?.enabled !== false) {
      exports.push(WORKFLOW_ENGINE);
    }

    if (options.analytics?.enabled !== false) {
      exports.push(ANALYTICS_SERVICE);
    }

    return {
      module: TitanNotificationsModule,
      providers,
      exports,
      global: options.isGlobal
    };
  }

  static forRootAsync(options: NotificationModuleAsyncOptions): DynamicModule {
    const providers: Array<[InjectionToken<any>, ProviderDefinition<any>] | Provider<any>> = [];

    // Create async options provider
    if (options.useFactory) {
      providers.push([NOTIFICATION_MODULE_OPTIONS, {
        useFactory: options.useFactory,
        inject: options.inject || []
      }]);
    } else if (options.useExisting) {
      providers.push([NOTIFICATION_MODULE_OPTIONS, {
        useFactory: async (optionsFactory: NotificationOptionsFactory) =>
          optionsFactory.createNotificationOptions(),
        inject: [options.useExisting]
      }]);
    } else if (options.useClass) {
      providers.push([options.useClass as any, {
        useClass: options.useClass
      }]);

      providers.push([NOTIFICATION_MODULE_OPTIONS, {
        useFactory: async (optionsFactory: NotificationOptionsFactory) =>
          optionsFactory.createNotificationOptions(),
        inject: [options.useClass as any]
      }]);
    }

    // Create services using async options
    providers.push(['REDIS_CLIENT' as any, {
      useFactory: (moduleOptions: NotificationModuleOptions) => new Redis({
        host: moduleOptions.redis?.host || 'localhost',
        port: moduleOptions.redis?.port || 6379,
        db: moduleOptions.redis?.db || 0,
        password: moduleOptions.redis?.password
      }),
      inject: [NOTIFICATION_MODULE_OPTIONS]
    }]);

    // Create Rotif manager
    providers.push([ROTIF_MANAGER, {
      useFactory: (moduleOptions: NotificationModuleOptions) => {
        const rotifConfig = {
          redis: moduleOptions.redis || { host: 'localhost', port: 6379 },
          ...moduleOptions.rotif
        };
        return new NotificationManager(rotifConfig);
      },
      inject: [NOTIFICATION_MODULE_OPTIONS]
    }]);

    // Core services
    providers.push([CHANNEL_MANAGER, {
      useFactory: () => new ChannelManager()
    }]);

    providers.push([PREFERENCE_MANAGER, {
      useFactory: (redisClient: Redis) => new PreferenceManager(redisClient),
      inject: ['REDIS_CLIENT' as any]
    }]);

    providers.push([RATE_LIMITER, {
      useFactory: (redisClient: Redis, moduleOptions: NotificationModuleOptions) => {
        const rateLimitConfig = moduleOptions.rateLimit?.default;
        return new RateLimiter(redisClient, rateLimitConfig);
      },
      inject: ['REDIS_CLIENT' as any, NOTIFICATION_MODULE_OPTIONS]
    }]);

    // Main notification service
    providers.push([NOTIFICATION_SERVICE, {
      useFactory: (
        rotif: NotificationManager,
        channelManager: ChannelManager,
        preferenceManager: PreferenceManager,
        rateLimiter: RateLimiter
      ) => new NotificationService(rotif, channelManager, preferenceManager, rateLimiter),
      inject: [ROTIF_MANAGER, CHANNEL_MANAGER, PREFERENCE_MANAGER, RATE_LIMITER]
    }]);

    // Also register with class token
    providers.push([NotificationService as any, {
      useFactory: (service: NotificationService) => service,
      inject: [NOTIFICATION_SERVICE]
    }]);

    // Exports
    const exports: InjectionToken<any>[] = [
      NOTIFICATION_SERVICE,
      NotificationService as any,
      CHANNEL_MANAGER,
      PREFERENCE_MANAGER,
      RATE_LIMITER,
      ROTIF_MANAGER
    ];

    return {
      module: TitanNotificationsModule,
      imports: options.imports || [],
      providers,
      exports,
      global: options.isGlobal
    };
  }
}