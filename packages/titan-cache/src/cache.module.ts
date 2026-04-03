/**
 * Cache Module
 *
 * DI module for cache service with support for:
 * - Static configuration via forRoot()
 * - Async configuration via forRootAsync()
 * - Global module registration
 * - Multiple named cache instances
 *
 * @module titan/modules/cache
 */

import { Module } from '@omnitron-dev/titan/decorators';
import type { DynamicModule, ProviderDefinition, InjectionToken, Provider } from '@omnitron-dev/titan/nexus';
import { CacheService } from './cache.service.js';
import {
  CACHE_SERVICE_TOKEN,
  CACHE_DEFAULT_TOKEN,
  CACHE_OPTIONS_TOKEN,
  DEFAULT_CACHE_NAME,
  getCacheToken,
} from './cache.tokens.js';
import type { ICacheModuleOptions, ICacheModuleAsyncOptions, ICache, ICacheService } from './cache.types.js';

/**
 * Default cache module options
 */
const DEFAULT_OPTIONS: ICacheModuleOptions = {
  maxSize: 1000,
  defaultTtl: 300,
  evictionPolicy: 'lru',
  enableStats: true,
  compressionThreshold: 1024,
  compressionAlgorithm: 'none',
  isGlobal: false,
};

/**
 * Titan Cache Module
 *
 * Provides high-performance caching with LRU/LFU eviction,
 * multi-tier support (L1/L2), compression, and TTL management.
 *
 * @example
 * ```typescript
 * // Static configuration
 * @Module({
 *   imports: [
 *     TitanCacheModule.forRoot({
 *       maxSize: 5000,
 *       defaultTtl: 600,
 *       evictionPolicy: 'lru',
 *     }),
 *   ],
 * })
 * export class AppModule {}
 *
 * // Async configuration with Redis L2
 * @Module({
 *   imports: [
 *     TitanCacheModule.forRootAsync({
 *       useFactory: async (config: ConfigService) => ({
 *         multiTier: true,
 *         l1: { maxSize: 1000, ttl: 60 },
 *         l2: { client: redisAdapter, ttl: 3600, prefix: 'cache:' },
 *       }),
 *       inject: [CONFIG_SERVICE_TOKEN],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Module({})
export class TitanCacheModule {
  /**
   * Configure cache module with static options
   */
  static forRoot(options: ICacheModuleOptions = {}): DynamicModule {
    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

    // Use tuple format [token, provider] as per Nexus DI pattern
    const providers: Array<[InjectionToken<unknown>, ProviderDefinition<unknown>] | Provider<unknown>> = [
      [
        CACHE_OPTIONS_TOKEN,
        {
          useValue: mergedOptions,
        },
      ],
      [
        CACHE_SERVICE_TOKEN,
        {
          useFactory: (opts: ICacheModuleOptions): ICacheService => new CacheService(opts),
          inject: [CACHE_OPTIONS_TOKEN],
        },
      ],
      [
        CACHE_DEFAULT_TOKEN,
        {
          useFactory: (service: ICacheService): ICache => service.getCache(DEFAULT_CACHE_NAME),
          inject: [CACHE_SERVICE_TOKEN],
        },
      ],
    ];

    const exports: InjectionToken<unknown>[] = [CACHE_SERVICE_TOKEN, CACHE_DEFAULT_TOKEN, CACHE_OPTIONS_TOKEN];

    const result: DynamicModule = {
      module: TitanCacheModule,
      providers,
      exports,
    };

    if (mergedOptions.isGlobal) {
      result.global = true;
    }

    return result;
  }

  /**
   * Configure cache module with async options factory
   */
  static forRootAsync(options: ICacheModuleAsyncOptions): DynamicModule {
    const providers: Array<[InjectionToken<unknown>, ProviderDefinition<unknown>] | Provider<unknown>> = [
      [
        CACHE_OPTIONS_TOKEN,
        {
          useFactory: async (...args: unknown[]): Promise<ICacheModuleOptions> => {
            if (options.useFactory) {
              const result = await options.useFactory(...args);
              return { ...DEFAULT_OPTIONS, ...result };
            }
            return DEFAULT_OPTIONS;
          },
          inject: (options.inject ?? []) as InjectionToken<unknown>[],
        },
      ],
      [
        CACHE_SERVICE_TOKEN,
        {
          useFactory: (opts: ICacheModuleOptions): ICacheService => new CacheService(opts),
          inject: [CACHE_OPTIONS_TOKEN],
        },
      ],
      [
        CACHE_DEFAULT_TOKEN,
        {
          useFactory: (service: ICacheService): ICache => service.getCache(DEFAULT_CACHE_NAME),
          inject: [CACHE_SERVICE_TOKEN],
        },
      ],
    ];

    const exports: InjectionToken<unknown>[] = [CACHE_SERVICE_TOKEN, CACHE_DEFAULT_TOKEN, CACHE_OPTIONS_TOKEN];

    const result: DynamicModule = {
      module: TitanCacheModule,

      imports: (options.imports as any) ?? [],
      providers,
      exports,
    };

    if (options.isGlobal) {
      result.global = true;
    }

    return result;
  }

  /**
   * Register a feature module with additional cache instances
   *
   * @example
   * ```typescript
   * @Module({
   *   imports: [
   *     TitanCacheModule.forFeature([
   *       { name: 'users', maxSize: 500, defaultTtl: 300 },
   *       { name: 'products', maxSize: 1000, defaultTtl: 600 },
   *     ]),
   *   ],
   * })
   * export class FeatureModule {}
   * ```
   */
  static forFeature(caches: Array<{ name: string } & ICacheModuleOptions>): DynamicModule {
    const providers: Array<[InjectionToken<unknown>, ProviderDefinition<unknown>]> = [];
    const exports: InjectionToken<unknown>[] = [];

    for (const cacheConfig of caches) {
      const { name, ...options } = cacheConfig;
      const token = getCacheToken(name);

      providers.push([
        token,
        {
          useFactory: (service: ICacheService): ICache => service.getOrCreateCache(name, options),
          inject: [CACHE_SERVICE_TOKEN],
        },
      ]);

      exports.push(token);
    }

    return {
      module: TitanCacheModule,
      providers,
      exports,
    };
  }
}

/**
 * Alias for backward compatibility
 */
export const CacheModule = TitanCacheModule;
