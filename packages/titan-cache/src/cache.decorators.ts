/* eslint-disable func-names */
/**
 * Cache Decorators
 *
 * Method and parameter decorators for declarative caching:
 * - @Cacheable - Cache method return values
 * - @CacheInvalidate - Invalidate cache entries after method execution
 * - @CachePut - Update cache with method return value
 * - @CacheKey - Mark parameter as cache key component
 *
 * ## Cache Service Discovery
 *
 * Decorators automatically discover the cache service from the target instance.
 * The cache service is looked up in this order:
 * 1. Property decorated with @InjectCacheService()
 * 2. Property named 'cacheService'
 * 3. DI container via 'container' property using CACHE_SERVICE_TOKEN
 *
 * @module titan/modules/cache
 */

import 'reflect-metadata';
import type { ICache, ICacheSetOptions, ICacheService } from './cache.types.js';
import { CACHE_SERVICE_TOKEN } from './cache.tokens.js';
import type { ILogger } from '@omnitron-dev/titan/module/logger';

/**
 * Metadata keys for cache decorators
 */
const CACHE_METADATA_KEY = Symbol.for('titan:cache:metadata');
const CACHE_KEY_METADATA = Symbol.for('titan:cache:key');
const CACHE_SERVICE_METADATA = Symbol.for('titan:cache:service');
const CACHE_LOGGER_METADATA = Symbol.for('titan:cache:logger');

/**
 * Cacheable decorator options
 */
export interface CacheableOptions {
  /** Cache name (defaults to 'default') */
  cacheName?: string;
  /** Key prefix */
  keyPrefix?: string;
  /** Custom key generator function */
  keyGenerator?: (...args: unknown[]) => string;
  /** TTL in seconds */
  ttl?: number;
  /** Tags for grouped invalidation */
  tags?: string[] | ((...args: unknown[]) => string[]);
  /** Condition function - only cache if returns true */
  condition?: (...args: unknown[]) => boolean;
  /** Unless function - don't cache if returns true */
  unless?: (result: unknown) => boolean;
  /** Enable compression */
  compress?: boolean;
}

/**
 * Cache invalidate decorator options
 */
export interface CacheInvalidateOptions {
  /** Cache name (defaults to 'default') */
  cacheName?: string;
  /** Key pattern to invalidate (supports {0}, {1} for argument substitution) */
  keyPattern?: string;
  /** Tags to invalidate */
  tags?: string[] | ((...args: unknown[]) => string[]);
  /** Invalidate all entries */
  allEntries?: boolean;
  /** Invalidate before method execution (default: after) */
  beforeInvocation?: boolean;
  /** Custom key generator for invalidation */
  keyGenerator?: (...args: unknown[]) => string[];
}

/**
 * Cache put decorator options
 */
export interface CachePutOptions extends CacheableOptions {
  /** Key to use (with argument substitution) */
  key?: string;
}

/**
 * Internal cache metadata structure
 */
interface CacheMetadata {
  type: 'cacheable' | 'invalidate' | 'put';
  options: CacheableOptions | CacheInvalidateOptions | CachePutOptions;
}

/**
 * Get cache service from target instance.
 *
 * Discovery order:
 * 1. Property marked with @InjectCacheService() decorator
 * 2. Property named 'cacheService'
 * 3. DI container via 'container' property
 */
function getCacheService(target: object): ICacheService | undefined {
  const targetRecord = target as Record<string | symbol, unknown>;

  // 1. Try to get from property marked with @InjectCacheService()
  const markedProp = Reflect.getMetadata(CACHE_SERVICE_METADATA, target.constructor);
  if (markedProp && targetRecord[markedProp]) {
    return targetRecord[markedProp] as ICacheService;
  }

  // 2. Try conventional property name
  if (targetRecord['cacheService']) {
    return targetRecord['cacheService'] as ICacheService;
  }

  // 3. Try to get from container if available
  const container = targetRecord['container'] as { get?: (token: unknown) => unknown } | undefined;
  if (container?.get) {
    try {
      return container.get(CACHE_SERVICE_TOKEN) as ICacheService;
    } catch {
      // Container doesn't have cache service
    }
  }

  return undefined;
}

/**
 * Get logger from target instance for error reporting.
 */
function getLogger(target: object): ILogger | undefined {
  const targetRecord = target as Record<string | symbol, unknown>;

  // Try property marked with @InjectCacheLogger()
  const markedProp = Reflect.getMetadata(CACHE_LOGGER_METADATA, target.constructor);
  if (markedProp && targetRecord[markedProp]) {
    const loggerModule = targetRecord[markedProp] as { logger?: ILogger };
    return loggerModule.logger ?? (loggerModule as unknown as ILogger);
  }

  // Try conventional property names
  const loggerModule = targetRecord['loggerModule'] as { logger?: ILogger } | undefined;
  if (loggerModule?.logger) return loggerModule.logger;

  const logger = targetRecord['logger'] as ILogger | undefined;
  if (logger) return logger;

  return undefined;
}

/**
 * Log an error using the discovered logger or fallback to console.
 */
function logError(target: object, message: string, error: unknown): void {
  const logger = getLogger(target);
  if (logger) {
    logger.error({ err: error }, message);
  } else {
    // Fallback to console only if no logger available

    console.error(`[Cache] ${message}:`, error);
  }
}

/**
 * Generate cache key from method arguments
 */
function generateCacheKey(
  keyPrefix: string,
  methodName: string,
  args: unknown[],
  keyGenerator?: (...args: unknown[]) => string,
  keyParamIndices?: number[]
): string {
  if (keyGenerator) {
    return keyGenerator(...args);
  }

  const keyParts: string[] = [keyPrefix, methodName];

  // If specific key parameters are marked, use only those
  if (keyParamIndices && keyParamIndices.length > 0) {
    for (const index of keyParamIndices) {
      keyParts.push(stringifyArg(args[index]));
    }
  } else {
    // Use all arguments
    for (const arg of args) {
      keyParts.push(stringifyArg(arg));
    }
  }

  return keyParts.join(':');
}

/**
 * Convert argument to string for cache key
 */
function stringifyArg(arg: unknown): string {
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
  if (typeof arg === 'object') {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

/**
 * Substitute {0}, {1}, etc. in pattern with actual arguments
 */
function substitutePattern(pattern: string, args: unknown[]): string {
  return pattern.replace(/\{(\d+)\}/g, (_, index) => {
    const argIndex = parseInt(index, 10);
    return stringifyArg(args[argIndex]);
  });
}

/**
 * @Cacheable decorator
 *
 * Caches the return value of a method. On subsequent calls with the same
 * arguments, returns the cached value instead of executing the method.
 *
 * @example
 * ```typescript
 * class UserService {
 *   @Cacheable({ keyPrefix: 'user', ttl: 300 })
 *   async getUser(id: string): Promise<User> {
 *     return this.repository.findById(id);
 *   }
 *
 *   @Cacheable({
 *     keyPrefix: 'users',
 *     keyGenerator: (tenantId, filters) => `users:${tenantId}:${hash(filters)}`,
 *     ttl: 60,
 *     tags: ['users'],
 *   })
 *   async listUsers(tenantId: string, filters: UserFilters): Promise<User[]> {
 *     return this.repository.findAll(tenantId, filters);
 *   }
 * }
 * ```
 */
export function Cacheable(options: CacheableOptions = {}): MethodDecorator {
  return function (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value;
    const methodName = String(propertyKey);

    // Store metadata for inspection
    Reflect.defineMetadata(CACHE_METADATA_KEY, { type: 'cacheable', options } as CacheMetadata, target, propertyKey);

    descriptor.value = async function (this: object, ...args: unknown[]): Promise<unknown> {
      const cacheService = getCacheService(this);

      if (!cacheService) {
        // No cache service available, execute method normally
        return originalMethod.apply(this, args);
      }

      // Check condition
      if (options.condition && !options.condition(...args)) {
        return originalMethod.apply(this, args);
      }

      const keyParamIndices = Reflect.getMetadata(CACHE_KEY_METADATA, target, propertyKey) as number[] | undefined;
      const cacheKey = generateCacheKey(
        options.keyPrefix ?? target.constructor.name,
        methodName,
        args,
        options.keyGenerator,
        keyParamIndices
      );

      const cache: ICache<unknown> = cacheService.getCache(options.cacheName);

      // Try to get from cache
      const cached = await cache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }

      // Execute method
      const result = await originalMethod.apply(this, args);

      // Check unless condition
      if (options.unless && options.unless(result)) {
        return result;
      }

      // Don't cache null/undefined
      if (result === null || result === undefined) {
        return result;
      }

      // Build cache options
      const cacheOptions: ICacheSetOptions = {};
      if (options.ttl !== undefined) {
        cacheOptions.ttl = options.ttl;
      }
      if (options.compress !== undefined) {
        cacheOptions.compress = options.compress;
      }
      if (options.tags) {
        cacheOptions.tags = typeof options.tags === 'function' ? options.tags(...args) : options.tags;
      }

      // Store in cache
      await cache.set(cacheKey, result, cacheOptions);

      return result;
    };

    return descriptor;
  };
}

/**
 * @CacheInvalidate decorator
 *
 * Invalidates cache entries after method execution.
 *
 * @example
 * ```typescript
 * class UserService {
 *   @CacheInvalidate({ keyPattern: 'user:{0}' })
 *   async updateUser(id: string, data: UpdateUserData): Promise<User> {
 *     return this.repository.update(id, data);
 *   }
 *
 *   @CacheInvalidate({ tags: ['users'], allEntries: true })
 *   async importUsers(users: User[]): Promise<void> {
 *     await this.repository.bulkInsert(users);
 *   }
 * }
 * ```
 */
export function CacheInvalidate(options: CacheInvalidateOptions = {}): MethodDecorator {
  return function (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value;

    // Store metadata for inspection
    Reflect.defineMetadata(CACHE_METADATA_KEY, { type: 'invalidate', options } as CacheMetadata, target, propertyKey);

    descriptor.value = async function (this: object, ...args: unknown[]): Promise<unknown> {
      const cacheService = getCacheService(this);

      const invalidate = async (): Promise<void> => {
        if (!cacheService) return;

        const cache: ICache<unknown> = cacheService.getCache(options.cacheName);

        // Tag-based invalidation
        if (options.tags) {
          const tags = typeof options.tags === 'function' ? options.tags(...args) : options.tags;
          await cache.invalidateByTags(tags);
        }

        // Clear all entries
        if (options.allEntries) {
          await cache.clear();
          return;
        }

        // Pattern-based invalidation
        if (options.keyPattern) {
          const pattern = substitutePattern(options.keyPattern, args);
          await cache.clear(pattern);
        }

        // Custom key generator
        if (options.keyGenerator) {
          const keys = options.keyGenerator(...args);
          await Promise.all(keys.map((key) => cache.delete(key)));
        }
      };

      // Invalidate before if requested
      if (options.beforeInvocation) {
        await invalidate();
      }

      // Execute method
      const result = await originalMethod.apply(this, args);

      // Invalidate after (default)
      if (!options.beforeInvocation) {
        try {
          await invalidate();
        } catch (error) {
          // Log but don't fail the operation
          logError(this, 'Failed to invalidate cache', error);
        }
      }

      return result;
    };

    return descriptor;
  };
}

/**
 * @CachePut decorator
 *
 * Always executes the method and updates the cache with the result.
 * Unlike @Cacheable, this always runs the method.
 *
 * @example
 * ```typescript
 * class UserService {
 *   @CachePut({ keyPrefix: 'user', key: 'user:{0}', ttl: 300 })
 *   async updateUser(id: string, data: UpdateUserData): Promise<User> {
 *     return this.repository.update(id, data);
 *   }
 * }
 * ```
 */
export function CachePut(options: CachePutOptions = {}): MethodDecorator {
  return function (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value;
    const methodName = String(propertyKey);

    // Store metadata for inspection
    Reflect.defineMetadata(CACHE_METADATA_KEY, { type: 'put', options } as CacheMetadata, target, propertyKey);

    descriptor.value = async function (this: object, ...args: unknown[]): Promise<unknown> {
      // Execute method first
      const result = await originalMethod.apply(this, args);

      const cacheService = getCacheService(this);
      if (!cacheService) {
        return result;
      }

      // Don't cache null/undefined
      if (result === null || result === undefined) {
        return result;
      }

      // Check condition
      if (options.condition && !options.condition(...args)) {
        return result;
      }

      // Check unless condition
      if (options.unless && options.unless(result)) {
        return result;
      }

      // Generate key
      const keyParamIndices = Reflect.getMetadata(CACHE_KEY_METADATA, target, propertyKey) as number[] | undefined;
      let cacheKey: string;

      if (options.key) {
        cacheKey = substitutePattern(options.key, args);
      } else {
        cacheKey = generateCacheKey(
          options.keyPrefix ?? target.constructor.name,
          methodName,
          args,
          options.keyGenerator,
          keyParamIndices
        );
      }

      const cache: ICache<unknown> = cacheService.getCache(options.cacheName);

      // Build cache options
      const cacheOptions: ICacheSetOptions = {};
      if (options.ttl !== undefined) {
        cacheOptions.ttl = options.ttl;
      }
      if (options.compress !== undefined) {
        cacheOptions.compress = options.compress;
      }
      if (options.tags) {
        cacheOptions.tags = typeof options.tags === 'function' ? options.tags(...args) : options.tags;
      }

      // Store in cache
      await cache.set(cacheKey, result, cacheOptions);

      return result;
    };

    return descriptor;
  };
}

/**
 * @CacheKey parameter decorator
 *
 * Marks a parameter to be used for cache key generation.
 * Only marked parameters will be included in the cache key.
 *
 * @example
 * ```typescript
 * class UserService {
 *   @Cacheable({ keyPrefix: 'user', ttl: 300 })
 *   async getUser(
 *     @CacheKey() id: string,
 *     options?: QueryOptions  // Not included in cache key
 *   ): Promise<User> {
 *     return this.repository.findById(id, options);
 *   }
 * }
 * ```
 */
export function CacheKey(): ParameterDecorator {
  return function (target: object, propertyKey: string | symbol | undefined, parameterIndex: number): void {
    if (propertyKey === undefined) return;

    const existingKeys: number[] = Reflect.getMetadata(CACHE_KEY_METADATA, target, propertyKey) || [];
    existingKeys.push(parameterIndex);
    existingKeys.sort((a, b) => a - b);
    Reflect.defineMetadata(CACHE_KEY_METADATA, existingKeys, target, propertyKey);
  };
}

/**
 * Get cache metadata from a method
 *
 * @example
 * ```typescript
 * const metadata = getCacheMetadata(userService, 'getUser');
 * console.log(metadata); // { type: 'cacheable', options: {...} }
 * ```
 */
export function getCacheMetadata(target: object, propertyKey: string | symbol): CacheMetadata | undefined {
  return Reflect.getMetadata(CACHE_METADATA_KEY, target, propertyKey);
}

/**
 * Check if a method has cache decorators
 */
export function hasCacheDecorator(target: object, propertyKey: string | symbol): boolean {
  return Reflect.hasMetadata(CACHE_METADATA_KEY, target, propertyKey);
}

/**
 * @InjectCacheService property decorator
 *
 * Marks a property as the cache service for cache decorators to use.
 * This provides explicit control over which property contains the cache service.
 *
 * @example
 * ```typescript
 * class UserService {
 *   @InjectCacheService()
 *   private cache!: ICacheService;
 *
 *   @Cacheable({ keyPrefix: 'user', ttl: 300 })
 *   async getUser(id: string): Promise<User> {
 *     return this.repository.findById(id);
 *   }
 * }
 * ```
 */
export function InjectCacheService(): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol): void {
    Reflect.defineMetadata(CACHE_SERVICE_METADATA, propertyKey, target.constructor);
  };
}

/**
 * @InjectCacheLogger property decorator
 *
 * Marks a property as the logger for cache decorators to use for error logging.
 * If not specified, decorators will try 'loggerModule' or 'logger' properties.
 *
 * @example
 * ```typescript
 * class UserService {
 *   @InjectCacheLogger()
 *   private loggerModule!: ILoggerModule;
 *
 *   @CacheInvalidate({ keyPattern: 'user:{0}' })
 *   async updateUser(id: string, data: UpdateData): Promise<User> {
 *     return this.repository.update(id, data);
 *   }
 * }
 * ```
 */
export function InjectCacheLogger(): PropertyDecorator {
  return function (target: object, propertyKey: string | symbol): void {
    Reflect.defineMetadata(CACHE_LOGGER_METADATA, propertyKey, target.constructor);
  };
}
