/**
 * Cache Adapter
 *
 * High-level cache adapter wrapping Titan's ICache with:
 * - Singleflight stampede protection
 * - TTL jitter to prevent thundering herd
 * - Null-returning API for backward compatibility
 * - Combined stats tracking
 *
 * @module titan/modules/cache
 */

import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { LOGGER_TOKEN } from '@omnitron-dev/titan/module/logger';
import type { ILogger } from '@omnitron-dev/titan/types';
import type { ICache, ICacheService } from './cache.types.js';
import { CACHE_SERVICE_TOKEN } from './cache.tokens.js';
import { Singleflight, createTtlCalculator } from './cache.utils.js';
import { CACHE_ADAPTER_OPTIONS_TOKEN } from './cache.tokens.js';

/**
 * Cache adapter statistics
 */
export interface ICacheAdapterStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  errors: number;
}

/**
 * Cache adapter configuration options
 */
export interface ICacheAdapterOptions {
  /** Namespace for this adapter's named cache */
  namespace: string;
  /** Maximum cache entries */
  maxSize?: number;
  /** Default TTL in seconds */
  defaultTtl?: number;
}

/**
 * Cache Adapter
 *
 * Wraps Titan's ICache with a simplified API suitable for application use:
 * - `get<T>(key)`: Returns `null` for misses (not `undefined`)
 * - `set<T>(key, value, ttl?)`: TTL in seconds
 * - `del(key)`: Delete single key
 * - `invalidatePattern(pattern)`: Glob-pattern invalidation
 * - `getOrSet<T>(key, factory, ttl)`: Stampede-protected cache-aside
 *
 * @example
 * ```typescript
 * @Injectable()
 * class MyService {
 *   constructor(@Inject(CACHE_ADAPTER_TOKEN) private cache: CacheAdapter) {}
 *
 *   async getUser(id: string): Promise<User> {
 *     return this.cache.getOrSet(`user:${id}`, () => this.db.findUser(id), 300);
 *   }
 * }
 * ```
 */
@Injectable()
export class CacheAdapter {
  private readonly cache: ICache<unknown>;
  private readonly singleflight = new Singleflight<unknown>();
  private readonly ttlCalculators: Map<number, () => number> = new Map();
  private internalStats = { sets: 0, deletes: 0, errors: 0 };

  constructor(
    @Inject(CACHE_SERVICE_TOKEN) cacheService: ICacheService,
    @Inject(CACHE_ADAPTER_OPTIONS_TOKEN) options: ICacheAdapterOptions,
    @Inject(LOGGER_TOKEN) private readonly logger: ILogger
  ) {
    this.cache = cacheService.getOrCreateCache(options.namespace, {
      maxSize: options.maxSize ?? 10_000,
      defaultTtl: options.defaultTtl ?? 300,
      evictionPolicy: 'lru',
      enableStats: true,
    });
  }

  /**
   * Get TTL with jitter to prevent cache stampede on expiration.
   */
  private getTtlWithJitter(baseTtl: number, jitterPercent: number = 10): number {
    if (!this.ttlCalculators.has(baseTtl)) {
      this.ttlCalculators.set(baseTtl, createTtlCalculator(baseTtl, jitterPercent));
    }
    return this.ttlCalculators.get(baseTtl)!();
  }

  /**
   * Get a cached value by key. Returns `null` for misses.
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.cache.get(key);
      return value === undefined ? null : (value as T);
    } catch (error) {
      this.internalStats.errors++;
      this.logger.error({ err: error, key }, '[CacheAdapter] Error getting key');
      return null;
    }
  }

  /**
   * Set a cached value with optional TTL (in seconds).
   */
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      await this.cache.set(key, value, ttlSeconds !== undefined ? { ttl: ttlSeconds } : {});
      this.internalStats.sets++;
    } catch (error) {
      this.internalStats.errors++;
      this.logger.error({ err: error, key }, '[CacheAdapter] Error setting key');
      throw error;
    }
  }

  /**
   * Get or set a cached value with stampede protection and TTL jitter.
   *
   * Uses Singleflight to deduplicate concurrent factory calls for the same key.
   * Double-checked locking ensures cache consistency.
   */
  async getOrSet<T>(key: string, factory: () => Promise<T>, ttlSeconds: number): Promise<T> {
    try {
      const cached = await this.cache.get(key);
      if (cached !== undefined) {
        return cached as T;
      }

      const value = await this.singleflight.do(key, async () => {
        // Double-check cache
        const cached2 = await this.cache.get(key);
        if (cached2 !== undefined) {
          return cached2;
        }

        const result = await factory();
        const ttlWithJitter = this.getTtlWithJitter(ttlSeconds);
        await this.cache.set(key, result, { ttl: ttlWithJitter });
        this.internalStats.sets++;
        return result;
      });

      return value as T;
    } catch (error) {
      this.internalStats.errors++;
      this.logger.error({ err: error, key }, '[CacheAdapter] Error in getOrSet');
      throw error;
    }
  }

  /**
   * Delete a cached value.
   */
  async del(key: string): Promise<void> {
    try {
      await this.cache.delete(key);
      this.internalStats.deletes++;
    } catch (error) {
      this.internalStats.errors++;
      this.logger.error({ err: error, key }, '[CacheAdapter] Error deleting key');
      throw error;
    }
  }

  /**
   * Invalidate all keys matching a glob pattern (e.g., `"coins:*"`).
   */
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const regexPattern = pattern.replace(/\*/g, '.*');
      await this.cache.clear(regexPattern);
      this.logger.debug({ pattern }, '[CacheAdapter] Invalidated keys');
    } catch (error) {
      this.internalStats.errors++;
      this.logger.error({ err: error, pattern }, '[CacheAdapter] Error invalidating pattern');
      throw error;
    }
  }

  /**
   * Get combined cache statistics.
   */
  getStats(): Readonly<ICacheAdapterStats> {
    const titanStats = this.cache.getStats();
    return {
      hits: titanStats.hits,
      misses: titanStats.misses,
      sets: this.internalStats.sets,
      deletes: this.internalStats.deletes,
      errors: this.internalStats.errors,
    };
  }

  /**
   * Get current in-flight singleflight request count.
   */
  getInflightCount(): number {
    return this.singleflight.size;
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.cache.resetStats();
    this.internalStats = { sets: 0, deletes: 0, errors: 0 };
  }

  /**
   * Log current cache statistics.
   */
  logStats(): void {
    const stats = this.getStats();
    const total = stats.hits + stats.misses;
    const hitRate = total > 0 ? ((stats.hits / total) * 100).toFixed(2) : '0.00';

    this.logger.info(
      {
        hits: stats.hits,
        misses: stats.misses,
        hitRate: `${hitRate}%`,
        sets: stats.sets,
        deletes: stats.deletes,
        errors: stats.errors,
      },
      '[CacheAdapter] Stats'
    );
  }
}
