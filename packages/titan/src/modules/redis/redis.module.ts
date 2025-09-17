export interface Provider<T = any> {
  provide: string | symbol | Type<T>;
  useClass?: Type<T>;
  useValue?: T;
  useFactory?: (...args: any[]) => T | Promise<T>;
  inject?: any[];
  scope?: 'DEFAULT' | 'REQUEST' | 'TRANSIENT';
}

export interface Type<T = any> extends Function {
  new (...args: any[]): T;
}

export interface DynamicModule {
  module: Type<any>;
  imports?: any[];
  controllers?: Type<any>[];
  providers?: Provider[];
  exports?: any[];
  global?: boolean;
}
import {
  RedisModuleOptions,
  RedisModuleAsyncOptions,
  RedisOptionsFactory,
  RedisClientOptions,
} from './redis.types.js';
import {
  REDIS_MODULE_OPTIONS,
  REDIS_MANAGER,
  getRedisToken,
  DEFAULT_REDIS_NAMESPACE,
} from './redis.constants.js';
import { RedisManager } from './redis.manager.js';
import { RedisService } from './redis.service.js';
import { RedisHealthIndicator } from './redis.health.js';
import { getClientNamespace } from './redis.utils.js';

export class TitanRedisModule {
  static forRoot(options: RedisModuleOptions = {}): DynamicModule {
    const redisManagerProvider: Provider = {
      provide: REDIS_MANAGER,
      useFactory: () => new RedisManager(options),
    };

    const redisServiceProvider: Provider = {
      provide: RedisService,
      useFactory: (manager: RedisManager) => new RedisService(manager),
      inject: [REDIS_MANAGER],
    };

    const redisHealthProvider: Provider = {
      provide: RedisHealthIndicator,
      useFactory: (manager: RedisManager) => new RedisHealthIndicator(manager),
      inject: [REDIS_MANAGER],
    };

    const clientProviders = this.createClientProviders(options);

    const providers = [
      redisManagerProvider,
      redisServiceProvider,
      redisHealthProvider,
      ...clientProviders,
    ];

    const exports = [
      REDIS_MANAGER,
      RedisService,
      RedisHealthIndicator,
      ...clientProviders.map(p => (p as any).provide || p),
    ];

    if (options.isGlobal) {
      return {
        module: TitanRedisModule,
        global: true,
        providers,
        exports,
      };
    }

    return {
      module: TitanRedisModule,
      providers,
      exports,
    };
  }

  static forRootAsync(options: RedisModuleAsyncOptions): DynamicModule {
    const asyncProviders = this.createAsyncProviders(options);

    const redisManagerProvider: Provider = {
      provide: REDIS_MANAGER,
      useFactory: (moduleOptions: RedisModuleOptions) => new RedisManager(moduleOptions),
      inject: [REDIS_MODULE_OPTIONS],
    };

    const redisServiceProvider: Provider = {
      provide: RedisService,
      useFactory: (manager: RedisManager) => new RedisService(manager),
      inject: [REDIS_MANAGER],
    };

    const redisHealthProvider: Provider = {
      provide: RedisHealthIndicator,
      useFactory: (manager: RedisManager) => new RedisHealthIndicator(manager),
      inject: [REDIS_MANAGER],
    };

    const clientProvidersFactory: Provider = {
      provide: 'REDIS_CLIENT_PROVIDERS',
      useFactory: (moduleOptions: RedisModuleOptions, manager: RedisManager) => {
        return this.createDynamicClientProviders(moduleOptions, manager);
      },
      inject: [REDIS_MODULE_OPTIONS, REDIS_MANAGER],
    };

    const providers = [
      ...asyncProviders,
      redisManagerProvider,
      redisServiceProvider,
      redisHealthProvider,
      clientProvidersFactory,
    ];

    const exports = [
      REDIS_MANAGER,
      RedisService,
      RedisHealthIndicator,
    ];

    if (options.isGlobal) {
      return {
        module: TitanRedisModule,
        global: true,
        imports: options.imports || [],
        providers,
        exports,
      };
    }

    return {
      module: TitanRedisModule,
      imports: options.imports || [],
      providers,
      exports,
    };
  }

  static forFeature(clients: string[] = []): DynamicModule {
    const providers = clients.map((namespace) => ({
      provide: getRedisToken(namespace),
      useFactory: (manager: RedisManager) => manager.getClient(namespace),
      inject: [REDIS_MANAGER],
    }));

    return {
      module: TitanRedisModule,
      providers,
      exports: providers.map(p => p.provide),
    };
  }

  private static createClientProviders(options: RedisModuleOptions): Provider[] {
    const configs: RedisClientOptions[] = [];

    if (options.config) {
      configs.push(options.config);
    }

    if (options.clients) {
      configs.push(...options.clients);
    }

    if (configs.length === 0) {
      configs.push({ namespace: DEFAULT_REDIS_NAMESPACE });
    }

    return configs.map((config) => {
      const namespace = getClientNamespace(config);
      return {
        provide: getRedisToken(namespace),
        useFactory: (manager: RedisManager) => manager.getClient(namespace),
        inject: [REDIS_MANAGER],
      };
    });
  }

  private static createDynamicClientProviders(
    options: RedisModuleOptions,
    manager: RedisManager,
  ): Provider[] {
    const configs: RedisClientOptions[] = [];

    if (options.config) {
      configs.push(options.config);
    }

    if (options.clients) {
      configs.push(...options.clients);
    }

    if (configs.length === 0) {
      configs.push({ namespace: DEFAULT_REDIS_NAMESPACE });
    }

    return configs.map((config) => {
      const namespace = getClientNamespace(config);
      return {
        provide: getRedisToken(namespace),
        useFactory: () => manager.getClient(namespace),
      };
    });
  }

  private static createAsyncProviders(options: RedisModuleAsyncOptions): Provider[] {
    if (options.useExisting || options.useFactory) {
      return [this.createAsyncOptionsProvider(options)];
    }

    if (options.useClass) {
      return [
        this.createAsyncOptionsProvider(options),
        {
          provide: options.useClass,
          useClass: options.useClass,
        },
      ];
    }

    return [];
  }

  private static createAsyncOptionsProvider(
    options: RedisModuleAsyncOptions,
  ): Provider {
    if (options.useFactory) {
      return {
        provide: REDIS_MODULE_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject || [],
      };
    }

    if (options.useExisting) {
      return {
        provide: REDIS_MODULE_OPTIONS,
        useFactory: async (optionsFactory: RedisOptionsFactory) =>
          optionsFactory.createRedisOptions(),
        inject: [options.useExisting],
      };
    }

    if (options.useClass) {
      return {
        provide: REDIS_MODULE_OPTIONS,
        useFactory: async (optionsFactory: RedisOptionsFactory) =>
          optionsFactory.createRedisOptions(),
        inject: [options.useClass],
      };
    }

    return {
      provide: REDIS_MODULE_OPTIONS,
      useValue: {},
    };
  }
}