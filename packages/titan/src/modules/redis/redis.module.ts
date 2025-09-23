/**
 * Redis Module for Titan Framework
 *
 * Provides Redis integration with connection pooling, clustering, and health checks
 */

import { Module, DynamicModule, Provider, ProviderDefinition, InjectionToken } from '../../nexus/index.js';
import { RedisManager } from './redis.manager.js';
import { RedisService } from './redis.service.js';
import { getClientNamespace } from './redis.utils.js';
import { RedisHealthIndicator } from './redis.health.js';
import {
  REDIS_MANAGER,
  getRedisClientToken,
  REDIS_MODULE_OPTIONS,
  REDIS_DEFAULT_NAMESPACE,
} from './redis.constants.js';
import {
  RedisModuleOptions,
  RedisClientOptions,
  RedisOptionsFactory,
  RedisModuleAsyncOptions,
} from './redis.types.js';

@Module({})
export class TitanRedisModule {
  static forRoot(options: RedisModuleOptions = {}): DynamicModule {
    // Create providers using correct Nexus format: [token, provider]
    const providers: Array<[InjectionToken<any>, ProviderDefinition<any>] | Provider<any>> = [
      // Manager singleton with initialization
      [REDIS_MANAGER, {
        useFactory: async () => {
          const manager = new RedisManager(options);
          await manager.init();
          return manager;
        },
      }],

      // Main services
      [RedisService, {
        useFactory: (manager: RedisManager) => new RedisService(manager),
        inject: [REDIS_MANAGER],
      }],

      [RedisHealthIndicator, {
        useFactory: (manager: RedisManager) => new RedisHealthIndicator(manager),
        inject: [REDIS_MANAGER],
      }],
    ];

    // Create client providers
    const clientProviders = this.createClientProviders(options);
    providers.push(...clientProviders);

    // Exports
    const exports: InjectionToken<any>[] = [
      REDIS_MANAGER,
      RedisService,
      RedisHealthIndicator,
      ...clientProviders.map(p => Array.isArray(p) ? p[0] : getRedisClientToken(REDIS_DEFAULT_NAMESPACE)),
    ];

    const result: DynamicModule = {
      module: TitanRedisModule,
      providers,
      exports,
    };

    if (options.isGlobal) {
      result.global = true;
    }

    return result;
  }

  static forRootAsync(options: RedisModuleAsyncOptions): DynamicModule {
    const providers: Array<[InjectionToken<any>, ProviderDefinition<any>] | Provider<any>> = [];

    // Create async options provider
    const asyncProviders = this.createAsyncProviders(options);
    providers.push(...asyncProviders);

    // Manager provider
    providers.push([REDIS_MANAGER, {
      useFactory: async (moduleOptions: RedisModuleOptions) => {
        const manager = new RedisManager(moduleOptions);
        await manager.init();
        return manager;
      },
      inject: [REDIS_MODULE_OPTIONS],
    }]);

    // Service providers
    providers.push([RedisService, {
      useFactory: (manager: RedisManager) => new RedisService(manager),
      inject: [REDIS_MANAGER],
    }]);

    providers.push([RedisHealthIndicator, {
      useFactory: (manager: RedisManager) => new RedisHealthIndicator(manager),
      inject: [REDIS_MANAGER],
    }]);

    // Dynamic client providers
    providers.push(['REDIS_CLIENT_PROVIDERS' as any, {
      useFactory: async (moduleOptions: RedisModuleOptions, manager: RedisManager) => this.createDynamicClientProviders(moduleOptions, manager),
      inject: [REDIS_MODULE_OPTIONS, REDIS_MANAGER],
    }]);

    const exports: InjectionToken<any>[] = [
      REDIS_MANAGER,
      RedisService,
      RedisHealthIndicator,
    ];

    const result: DynamicModule = {
      module: TitanRedisModule,
      imports: options.imports as any || [],
      providers,
      exports,
    };

    if (options.isGlobal) {
      result.global = true;
    }

    return result;
  }

  static forFeature(clients: string[] = []): DynamicModule {
    const providers: Array<[InjectionToken<any>, ProviderDefinition<any>]> = clients.map((namespace) => [
      getRedisClientToken(namespace),
      {
        useFactory: (manager: RedisManager) => manager.getClient(namespace),
        inject: [REDIS_MANAGER],
      }
    ]);

    return {
      module: TitanRedisModule,
      providers,
      exports: providers.map(p => p[0]),
    };
  }

  private static createClientProviders(
    options: RedisModuleOptions
  ): Array<[InjectionToken<any>, ProviderDefinition<any>]> {
    const configs: RedisClientOptions[] = [];

    if (options.config) {
      configs.push(options.config);
    }

    if (options.clients) {
      configs.push(...options.clients);
    }

    // Default client if none specified
    if (configs.length === 0) {
      configs.push({ namespace: REDIS_DEFAULT_NAMESPACE });
    }

    return configs.map((config) => {
      const namespace = getClientNamespace(config);
      return [
        getRedisClientToken(namespace),
        {
          useFactory: (manager: RedisManager) => manager.getClient(namespace),
          inject: [REDIS_MANAGER],
        }
      ];
    });
  }

  private static createDynamicClientProviders(
    options: RedisModuleOptions,
    manager: RedisManager
  ): Array<[InjectionToken<any>, ProviderDefinition<any>]> {
    const configs: RedisClientOptions[] = [];

    if (options.config) {
      configs.push(options.config);
    }

    if (options.clients) {
      configs.push(...options.clients);
    }

    if (configs.length === 0) {
      configs.push({ namespace: REDIS_DEFAULT_NAMESPACE });
    }

    return configs.map((config) => {
      const namespace = getClientNamespace(config);
      return [
        getRedisClientToken(namespace),
        {
          useFactory: () => manager.getClient(namespace),
        }
      ];
    });
  }

  private static createAsyncProviders(
    options: RedisModuleAsyncOptions
  ): Array<[InjectionToken<any>, ProviderDefinition<any>] | Provider<any>> {
    const providers: Array<[InjectionToken<any>, ProviderDefinition<any>] | Provider<any>> = [];

    if (options.useFactory) {
      providers.push([REDIS_MODULE_OPTIONS, {
        useFactory: async (...args: any[]) => Promise.resolve(options.useFactory!(...args)),
        inject: (options.inject || []) as any,
      }]);
    } else if (options.useExisting) {
      providers.push([REDIS_MODULE_OPTIONS, {
        useFactory: async (optionsFactory: RedisOptionsFactory) =>
          optionsFactory.createRedisOptions(),
        inject: [options.useExisting],
      }]);
    } else if (options.useClass) {
      providers.push([options.useClass as any, {
        useClass: options.useClass,
      }]);

      providers.push([REDIS_MODULE_OPTIONS, {
        useFactory: async (optionsFactory: RedisOptionsFactory) =>
          optionsFactory.createRedisOptions(),
        inject: [options.useClass as any],
      }]);
    } else {
      providers.push([REDIS_MODULE_OPTIONS, {
        useValue: {},
      }]);
    }

    return providers;
  }
}