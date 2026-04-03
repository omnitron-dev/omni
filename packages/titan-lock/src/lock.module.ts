/**
 * Lock Module
 *
 * DI module for distributed lock service.
 *
 * @module titan/modules/lock
 */

import { Module } from '@omnitron-dev/titan/decorators';
import type { DynamicModule, ProviderDefinition, InjectionToken, Provider } from '@omnitron-dev/titan/nexus';
import { DistributedLockService } from './lock.service.js';
import { LOCK_SERVICE_TOKEN, LOCK_OPTIONS_TOKEN } from './lock.tokens.js';
import type { ILockModuleOptions, ILockModuleAsyncOptions } from './lock.types.js';

/**
 * Default lock module options
 */
const DEFAULT_OPTIONS: ILockModuleOptions = {
  defaultTtl: 30000,
  keyPrefix: 'lock',
  defaultRetries: 3,
  defaultRetryDelay: 100,
  isGlobal: false,
};

/**
 * Titan Lock Module
 *
 * Provides Redis-based distributed locking for horizontal scaling.
 * Ensures only one instance executes critical sections at a time.
 *
 * Features:
 * - Atomic lock acquisition/release using Lua scripts
 * - UUID-based lock ownership
 * - TTL with automatic expiration
 * - Retry with exponential backoff
 * - Decorator for method-level locking
 *
 * @example
 * ```typescript
 * // Static configuration
 * @Module({
 *   imports: [
 *     TitanLockModule.forRoot({
 *       keyPrefix: 'myapp:lock',
 *       defaultTtl: 60000,
 *     }),
 *   ],
 * })
 * export class AppModule {}
 *
 * // Async configuration
 * @Module({
 *   imports: [
 *     TitanLockModule.forRootAsync({
 *       useFactory: (config: ConfigService) => ({
 *         keyPrefix: config.get('app.name') + ':lock',
 *         defaultTtl: config.get('lock.defaultTtl'),
 *       }),
 *       inject: [CONFIG_SERVICE_TOKEN],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Module({})
export class TitanLockModule {
  /**
   * Configure lock module with static options
   */
  static forRoot(options: ILockModuleOptions = {}): DynamicModule {
    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

    const providers: Array<[InjectionToken<unknown>, ProviderDefinition<unknown>] | Provider<unknown>> = [
      [
        LOCK_OPTIONS_TOKEN,
        {
          useValue: mergedOptions,
        },
      ],
      [
        LOCK_SERVICE_TOKEN,
        {
          useClass: DistributedLockService,
        },
      ],
    ];

    const exports: InjectionToken<unknown>[] = [LOCK_SERVICE_TOKEN, LOCK_OPTIONS_TOKEN];

    const result: DynamicModule = {
      module: TitanLockModule,
      providers,
      exports,
    };

    if (mergedOptions.isGlobal) {
      result.global = true;
    }

    return result;
  }

  /**
   * Configure lock module with async options factory
   */
  static forRootAsync(options: ILockModuleAsyncOptions): DynamicModule {
    const providers: Array<[InjectionToken<unknown>, ProviderDefinition<unknown>] | Provider<unknown>> = [
      [
        LOCK_OPTIONS_TOKEN,
        {
          useFactory: async (...args: unknown[]): Promise<ILockModuleOptions> => {
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
        LOCK_SERVICE_TOKEN,
        {
          useClass: DistributedLockService,
        },
      ],
    ];

    const exports: InjectionToken<unknown>[] = [LOCK_SERVICE_TOKEN, LOCK_OPTIONS_TOKEN];

    const result: DynamicModule = {
      module: TitanLockModule,
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
export const LockModule = TitanLockModule;
