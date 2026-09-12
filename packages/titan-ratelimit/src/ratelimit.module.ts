/**
 * Rate Limit Module
 *
 * DI module for unified rate limiting service.
 *
 * @module titan/modules/ratelimit
 */

import { Module } from '@omnitron-dev/titan/decorators';
import type { DynamicModule, ProviderDefinition, InjectionToken, Provider } from '@omnitron-dev/titan/nexus';
import { RateLimitService } from './ratelimit.service.js';
import {
  RATE_LIMIT_SERVICE_TOKEN,
  RATE_LIMIT_OPTIONS_TOKEN,
  RATE_LIMIT_STORAGE_TOKEN,
  DEFAULT_RATE_LIMIT_PREFIX,
} from './ratelimit.tokens.js';
import type { IRateLimitModuleOptions, IRateLimitModuleAsyncOptions } from './ratelimit.types.js';
import { MemoryRateLimitStorage, RedisRateLimitStorage } from './ratelimit.storage.js';
import { getRedisClientToken } from '@omnitron-dev/titan-redis';
import { LOGGER_TOKEN } from '@omnitron-dev/titan/module/logger';
import type { ILogger } from '@omnitron-dev/titan/types';

/**
 * Default rate limit module options
 */
const DEFAULT_OPTIONS: IRateLimitModuleOptions = {
  enabled: true,
  strategy: 'sliding-window',
  keyPrefix: DEFAULT_RATE_LIMIT_PREFIX,
  defaultLimit: 100,
  defaultWindowMs: 60000,
  burstLimit: 0,
  tokenRefillRate: 100,
  queueEnabled: false,
  maxQueueSize: 1000,
  queueTimeoutMs: 5000,
  storageType: 'memory',
  isGlobal: false,
};

/**
 * Titan Rate Limit Module
 *
 * Provides unified rate limiting with multiple strategies and storage backends.
 *
 * Features:
 * - Multiple algorithms: token bucket, sliding window, fixed window
 * - Pluggable storage: in-memory or Redis
 * - Decorator support for method-level rate limiting
 * - Auto-detection of Redis availability
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
    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

    const providers: Array<[InjectionToken<unknown>, ProviderDefinition<unknown>] | Provider<unknown>> = [
      [
        RATE_LIMIT_OPTIONS_TOKEN,
        {
          useValue: mergedOptions,
        },
      ],
      [
        RATE_LIMIT_STORAGE_TOKEN,
        {
          useFactory: (...args: unknown[]): MemoryRateLimitStorage | RedisRateLimitStorage => {
            // Auto-detect storage type
            const storageType = mergedOptions.storageType;
            const logger = args[args.length - 1] as ILogger | undefined;

            // If Redis is requested, try to get Redis client
            if (storageType === 'redis') {
              try {
                const redisClient = args[0];
                if (redisClient) {
                  return new RedisRateLimitStorage(redisClient as any, {
                    // Empty, deliberately. `RateLimitService.buildKey` already
                    // puts `keyPrefix` at the front of every key it hands to a
                    // storage, and the storage prepends its own — with no
                    // separator, because its default `'ratelimit:'` carries a
                    // trailing colon that a configured prefix does not.
                    //
                    // Passing the prefix here applied it twice. Observed on a
                    // running deployment, with `keyPrefix: 'main:ratelimit'`:
                    //
                    //   main:ratelimitmain:ratelimit:default:Auth@1.0.0.signin:anon
                    //
                    // The limits still worked — the doubling is consistent —
                    // but nothing could find them: a `SCAN main:ratelimit:*`,
                    // which is how an operator inspects or clears a limit,
                    // matches none of them. The memory storage does not
                    // prefix at all, so the same limit was keyed differently
                    // depending on which storage was in use.
                    //
                    // The service owns the key. A storage stores what it is
                    // given. The option stays for callers who construct the
                    // storage directly and have no service in front of it.
                    keyPrefix: '',
                    logger,
                  });
                }
              } catch {
                // Fall back to memory storage if Redis not available
                logger?.warn('[RateLimitModule] Redis not available, falling back to memory storage');
              }
            }

            // Use memory storage
            return new MemoryRateLimitStorage({
              cleanupIntervalMs: 60000,
              maxKeys: 10000,
            });
          },
          inject: mergedOptions.storageType === 'redis' ? [getRedisClientToken(), LOGGER_TOKEN] : [LOGGER_TOKEN],
        },
      ],
      [
        RATE_LIMIT_SERVICE_TOKEN,
        {
          useClass: RateLimitService,
        },
      ],
    ];

    const exports: InjectionToken<unknown>[] = [
      RATE_LIMIT_SERVICE_TOKEN,
      RATE_LIMIT_OPTIONS_TOKEN,
      RATE_LIMIT_STORAGE_TOKEN,
    ];

    const result: DynamicModule = {
      module: TitanRateLimitModule,
      providers,
      exports,
    };

    if (mergedOptions.isGlobal) {
      result.global = true;
    }

    return result;
  }

  /**
   * Configure rate limit module with async options factory
   */
  static forRootAsync(options: IRateLimitModuleAsyncOptions): DynamicModule {
    const providers: Array<[InjectionToken<unknown>, ProviderDefinition<unknown>] | Provider<unknown>> = [
      [
        RATE_LIMIT_OPTIONS_TOKEN,
        {
          useFactory: async (...args: unknown[]): Promise<IRateLimitModuleOptions> => {
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
        RATE_LIMIT_STORAGE_TOKEN,
        {
          useFactory: async (...args: unknown[]): Promise<MemoryRateLimitStorage | RedisRateLimitStorage> => {
            // Get options (first arg is the options from factory above)
            const opts = args[0] as IRateLimitModuleOptions;
            const logger = args[2] as ILogger | undefined;
            const storageType = opts?.storageType ?? 'memory';

            // If Redis is requested, try to get Redis client
            if (storageType === 'redis') {
              try {
                // Redis client is the second argument (after options)
                const redisClient = args[1];
                if (redisClient) {
                  return new RedisRateLimitStorage(redisClient as any, {
                    // Empty for the same reason as the `forRoot` branch above:
                    // `RateLimitService.buildKey` has already put the prefix
                    // at the front. This is the branch downstream actually takes —
                    // `forRootAsync` — which is why the live keys still read
                    // `main:ratelimitmain:ratelimit:…` after the other one was
                    // fixed, and why the probe was worth running.
                    keyPrefix: '',
                    logger,
                  });
                }
              } catch {
                // Fall back to memory storage if Redis not available
                logger?.warn('[RateLimitModule] Redis not available, falling back to memory storage');
                // storageType would be 'memory' — falls through to memory storage below
              }
            }

            // Use memory storage
            return new MemoryRateLimitStorage({
              cleanupIntervalMs: 60000,
              maxKeys: 10000,
            });
          },
          inject: [RATE_LIMIT_OPTIONS_TOKEN, getRedisClientToken(), LOGGER_TOKEN],
        },
      ],
      [
        RATE_LIMIT_SERVICE_TOKEN,
        {
          useClass: RateLimitService,
        },
      ],
    ];

    const exports: InjectionToken<unknown>[] = [
      RATE_LIMIT_SERVICE_TOKEN,
      RATE_LIMIT_OPTIONS_TOKEN,
      RATE_LIMIT_STORAGE_TOKEN,
    ];

    const result: DynamicModule = {
      module: TitanRateLimitModule,
      imports: (options.imports as DynamicModule['imports']) ?? [],
      providers,
      exports,
    };

    if (options.isGlobal) {
      result.global = true;
    }

    return result;
  }
}

/**
 * Alias for backward compatibility
 */
export const RateLimitModule = TitanRateLimitModule;
