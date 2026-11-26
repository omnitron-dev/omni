/**
 * Rate Limit Module
 *
 * DI module for unified rate limiting service.
 *
 * @module titan/modules/ratelimit
 */

import { Module } from '@omnitron-dev/titan/decorators';
import type { DynamicModule, ProviderDefinition, InjectionToken } from '@omnitron-dev/titan/nexus';
import { RateLimitService } from './ratelimit.service.js';
import {
  RATE_LIMIT_SERVICE_TOKEN,
  RATE_LIMIT_OPTIONS_TOKEN,
  RATE_LIMIT_STORAGE_TOKEN,
  DEFAULT_RATE_LIMIT_OPTIONS,
} from './ratelimit.tokens.js';
import type { IRateLimitModuleOptions, IRateLimitModuleAsyncOptions } from './ratelimit.types.js';
import { MemoryRateLimitStorage, RedisRateLimitStorage } from './ratelimit.storage.js';
import { getRedisClientToken, type IRedisClient } from '@omnitron-dev/titan-redis';
import { LOGGER_TOKEN } from '@omnitron-dev/titan/module/logger';
import type { ILogger } from '@omnitron-dev/titan/types';

/**
 * Titan Rate Limit Module
 *
 * Provides unified rate limiting with multiple strategies and storage backends.
 *
 * Features:
 * - Multiple algorithms: token bucket, sliding window, fixed window
 * - Pluggable storage: in-memory or Redis
 * - Decorator support for method-level rate limiting
 * - Explicit Redis storage for a shared quota
 * - Comprehensive statistics tracking
 *
 * @example
 * ```typescript
 * // Static configuration
 * @Module({
 *   imports: [
 *     TitanRateLimitModule.forRoot({
 *       strategy: 'sliding-window',
 *       defaultLimit: 100,
 *       defaultWindowMs: 60000,
 *       storageType: 'memory',
 *     }),
 *   ],
 * })
 * export class AppModule {}
 *
 * // Async configuration with Redis
 * @Module({
 *   imports: [
 *     RedisModule.forRoot({ host: 'localhost', port: 6379 }),
 *     TitanRateLimitModule.forRootAsync({
 *       imports: [ConfigModule],
 *       useFactory: (config: ConfigService) => ({
 *         strategy: config.get('rateLimit.strategy'),
 *         defaultLimit: config.get('rateLimit.limit'),
 *         storageType: 'redis',
 *       }),
 *       inject: [CONFIG_SERVICE_TOKEN],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 *
 * // Using in services
 * @Injectable()
 * class ApiService {
 *   constructor(
 *     @Inject(RATE_LIMIT_SERVICE_TOKEN)
 *     private readonly rateLimitService: IRateLimitService
 *   ) {}
 *
 *   async handleRequest(userId: string) {
 *     await this.rateLimitService.enforce(`user:${userId}`);
 *     // Process request
 *   }
 * }
 *
 * // Using decorators
 * @Injectable()
 * class UserService {
 *   constructor(
 *     @Inject(RATE_LIMIT_SERVICE_TOKEN)
 *     private readonly __rateLimitService__: IRateLimitService
 *   ) {}
 *
 *   @RateLimit('api:createUser', { limit: 10, windowMs: 60000 })
 *   async createUser(data: CreateUserDto) {
 *     // Rate limited to 10 calls per minute
 *   }
 * }
 * ```
 */
@Module({})
export class TitanRateLimitModule {
  /**
   * Configure rate limit module with static options
   */
  static forRoot(options: IRateLimitModuleOptions = {}): DynamicModule {
    return this.definition({ useValue: { ...DEFAULT_RATE_LIMIT_OPTIONS, ...options } }, options.isGlobal, undefined,
      options.storageType === 'redis');
  }

  /** Configure the module after its injected settings become available. */
  static forRootAsync(options: IRateLimitModuleAsyncOptions): DynamicModule {
    const settings: ProviderDefinition<IRateLimitModuleOptions> = {
      useFactory: async (...args: unknown[]) => ({ ...DEFAULT_RATE_LIMIT_OPTIONS, ...await options.useFactory?.(...args) }),
      inject: (options.inject ?? []) as InjectionToken<unknown>[],
    };
    return this.definition(settings, options.isGlobal, options.imports ?? [], true);
  }

  private static definition(
    options: ProviderDefinition<IRateLimitModuleOptions>, global: boolean | undefined,
    imports: DynamicModule['imports'], mayUseRedis: boolean
  ): DynamicModule {
    return {
      module: TitanRateLimitModule,
      ...(global && { global: true }),
      ...(imports && { imports }),
      providers: [
        [RATE_LIMIT_OPTIONS_TOKEN, options],
        [RATE_LIMIT_STORAGE_TOKEN, {
          useFactory: (settings: IRateLimitModuleOptions, redis?: IRedisClient, logger?: ILogger) => {
            if (settings.storageType === 'redis') {
              if (!redis) throw new Error('Redis rate limiting requires a registered Titan Redis client');
              // The service supplies the full storage key for both backends.
              return new RedisRateLimitStorage(redis, { keyPrefix: '', logger });
            }
            return new MemoryRateLimitStorage({ cleanupIntervalMs: 60_000, maxKeys: 10_000 });
          },
          inject: mayUseRedis
            ? [RATE_LIMIT_OPTIONS_TOKEN, { token: getRedisClientToken(), optional: true }, { token: LOGGER_TOKEN, optional: true }]
            : [RATE_LIMIT_OPTIONS_TOKEN],
        }],
        [RATE_LIMIT_SERVICE_TOKEN, { useClass: RateLimitService }],
      ],
      exports: [RATE_LIMIT_SERVICE_TOKEN, RATE_LIMIT_OPTIONS_TOKEN, RATE_LIMIT_STORAGE_TOKEN],
    };
  }
}

/**
 * Alias for backward compatibility
 */
export const RateLimitModule = TitanRateLimitModule;
