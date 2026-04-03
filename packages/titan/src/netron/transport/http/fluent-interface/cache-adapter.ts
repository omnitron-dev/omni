/**
 * HTTP Cache Adapter
 *
 * Adapter that uses Titan's unified cache module as backend for HTTP response caching.
 * Provides the same interface as HttpCacheManager but leverages Titan's:
 * - LRU/LFU eviction policies
 * - Wheel timer for efficient TTL
 * - Compression support
 * - Multi-tier caching (L1/L2)
 * - Unified statistics
 *
 * @module titan/netron/transport/http
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import { fallbackLog } from '../../../../utils/fallback-log.js';
// Minimal cache interfaces inlined to avoid circular dep on titan-cache
interface ICacheSetOptions { ttl?: number; tags?: string[]; partition?: string }
interface ICacheStats { hits: number; misses: number; size: number; hitRate: number; memoryUsage?: number }
interface ICache<T = unknown> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, options?: ICacheSetOptions): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
  invalidateByTags?(tags: string[]): Promise<number>;
  getStats?(): ICacheStats;
}
interface ICacheService {
  getCache(name: string): ICache;
  getOrCreateCache(name: string, options?: Record<string, unknown>): ICache;
}
import type { ILogger } from '../../../../modules/logger/logger.types.js';

/**
 * Cache options for HTTP responses
 */
export interface HttpCacheOptions {
  /** Maximum age in milliseconds */
  maxAge: number;
  /** Serve stale content while revalidating in milliseconds */
  staleWhileRevalidate?: number;
  /** Cache tags for invalidation */
  tags?: string[];
  /** Whether to cache on error */
  cacheOnError?: boolean;
  /** Custom cache key */
  key?: string;
}

/**
 * Internal cache entry metadata
 */
interface HttpCacheEntryMeta {
  timestamp: number;
  maxAge: number;
  staleWhileRevalidate?: number;
  cacheOnError?: boolean;
  revalidating?: boolean;
}

/**
 * Cache statistics
 */
export interface HttpCacheStats {
  entries: number;
  hits: number;
  misses: number;
  hitRate: number;
  sizeBytes: number;
  activeRevalidations: number;
}

/**
 * Adapter configuration
 */
export interface HttpCacheAdapterOptions {
  /** Titan cache service instance */
  cacheService?: ICacheService;
  /** Pre-configured cache instance */
  cache?: ICache<unknown>;
  /** Cache name for creating new cache */
  cacheName?: string;
  /** Maximum cache entries */
  maxEntries?: number;
  /** Default max age if not specified (ms) */
  defaultMaxAge?: number;
  /** Logger instance */
  logger?: ILogger;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * HTTP Cache Adapter using Titan cache backend
 *
 * @example
 * ```typescript
 * // Using with CacheService
 * const adapter = new HttpCacheAdapter({
 *   cacheService: titanCacheService,
 *   cacheName: 'http-responses',
 *   maxEntries: 1000,
 * });
 *
 * // Using with pre-configured cache
 * const adapter = new HttpCacheAdapter({
 *   cache: existingCache,
 * });
 * ```
 */
export class HttpCacheAdapter extends EventEmitter {
  private readonly cache: ICache<unknown>;
  private readonly entryMeta: Map<string, HttpCacheEntryMeta> = new Map();
  private readonly revalidationPromises: Map<string, Promise<unknown>> = new Map();
  private readonly lastHitKeys: Set<string> = new Set();
  private readonly logger?: ILogger;
  private readonly debug: boolean;
  private stats = { hits: 0, misses: 0, revalidations: 0 };

  constructor(options: HttpCacheAdapterOptions) {
    super();
    this.logger = options.logger;
    this.debug = options.debug ?? false;

    // Use provided cache or create from service
    if (options.cache) {
      this.cache = options.cache;
    } else if (options.cacheService) {
      this.cache = options.cacheService.getOrCreateCache(options.cacheName ?? 'http-responses', {
        maxSize: options.maxEntries ?? 1000,
        defaultTtl: options.defaultMaxAge ? options.defaultMaxAge / 1000 : 300,
        evictionPolicy: 'lru',
        enableStats: true,
      });
    } else {
      throw new Error('HttpCacheAdapter requires either cache or cacheService option');
    }
  }

  /**
   * Log debug message (structured JSON always)
   */
  private log(message: string, data?: Record<string, unknown>): void {
    if (this.logger) {
      this.logger.debug(data ?? {}, message);
    } else if (this.debug) {
      fallbackLog('debug', message, data);
    }
  }

  /**
   * Get data from cache or fetch
   */
  async get<T>(key: string, fetcher: () => Promise<T>, options: HttpCacheOptions): Promise<T> {
    const now = Date.now();
    const meta = this.entryMeta.get(key);
    const cached = await this.cache.get(key);

    // Check if we have a valid cache entry
    if (cached !== undefined && meta) {
      const age = now - meta.timestamp;

      if (age < options.maxAge) {
        // Fresh cache hit
        this.stats.hits++;
        this.lastHitKeys.add(key);
        this.emit('cache-hit', { key, age });
        this.log('[HttpCache] HIT', { key });
        return cached as T;
      }

      const swr = options.staleWhileRevalidate ?? meta.staleWhileRevalidate ?? 0;
      if (swr > 0 && age < options.maxAge + swr) {
        // Serve stale while revalidating
        this.stats.hits++;
        this.lastHitKeys.add(key);
        this.emit('cache-stale', { key, age });
        this.log('[HttpCache] STALE', { key });

        // Revalidate in background if not already doing so
        if (!meta.revalidating) {
          this.revalidateInBackground(key, fetcher, options);
        }

        return cached as T;
      }

      // Check if we have an active revalidation
      const revalidationPromise = this.revalidationPromises.get(key);
      if (revalidationPromise) {
        this.log('[HttpCache] WAITING', { key });
        return revalidationPromise as Promise<T>;
      }
    }

    // Cache miss - fetch fresh data
    this.stats.misses++;
    this.lastHitKeys.delete(key);
    this.emit('cache-miss', { key });
    this.log('[HttpCache] MISS', { key });

    try {
      const data = await fetcher();
      await this.set(key, data, options);
      return data;
    } catch (error) {
      // If cacheOnError is enabled and we have stale data, return it
      if (options.cacheOnError && cached !== undefined) {
        this.emit('cache-error-fallback', { key, error });
        this.log('[HttpCache] ERROR_FALLBACK', { key });
        return cached as T;
      }
      throw error;
    }
  }

  /**
   * Set cache entry
   */
  async set(key: string, data: unknown, options: HttpCacheOptions): Promise<void> {
    const now = Date.now();

    // Calculate TTL - if cacheOnError, keep longer for fallback
    const ttlMs = options.cacheOnError
      ? Math.max(options.maxAge * 10, 60000)
      : options.maxAge + (options.staleWhileRevalidate ?? 0);

    // Store in Titan cache
    const cacheOptions: ICacheSetOptions = {
      ttl: Math.ceil(ttlMs / 1000),
      tags: options.tags,
    };

    await this.cache.set(key, data, cacheOptions);

    // Store metadata
    this.entryMeta.set(key, {
      timestamp: now,
      maxAge: options.maxAge,
      staleWhileRevalidate: options.staleWhileRevalidate,
      cacheOnError: options.cacheOnError,
    });

    this.emit('cache-set', { key, options });
  }

  /**
   * Invalidate cache entries
   * @returns Number of entries invalidated
   */
  invalidate(pattern?: string | RegExp | string[]): number {
    let count = 0;

    if (pattern === undefined) {
      // Clear all
      count = this.entryMeta.size;
      this.clear();
      return count;
    }

    if (Array.isArray(pattern)) {
      // Invalidate by tags
      this.cache.invalidateByTags?.(pattern).then((c: number) => {
        this.log('[HttpCache] INVALIDATED_BY_TAGS', { tags: pattern, count: c });
      });
      // Also clean up metadata
      for (const key of this.entryMeta.keys()) {
        this.entryMeta.delete(key);
        count++;
      }
    } else if (pattern instanceof RegExp) {
      // Pattern matching
      for (const key of this.entryMeta.keys()) {
        if (pattern.test(key)) {
          this.delete(key);
          count++;
        }
      }
    } else if (pattern.endsWith('*')) {
      // Prefix match
      const prefix = pattern.slice(0, -1);
      for (const key of this.entryMeta.keys()) {
        if (key.startsWith(prefix)) {
          this.delete(key);
          count++;
        }
      }
    } else {
      // Exact match
      if (this.delete(pattern)) {
        count = 1;
      }
    }

    this.log('[HttpCache] INVALIDATED', { pattern: String(pattern), count });
    this.emit('cache-invalidate', { pattern, count });
    return count;
  }

  /**
   * Invalidate by tags
   */
  invalidateByTags(tags: string[]): number {
    return this.invalidate(tags);
  }

  /**
   * Delete a specific cache entry
   */
  delete(key: string): boolean {
    const had = this.entryMeta.has(key);
    this.entryMeta.delete(key);
    this.revalidationPromises.delete(key);
    this.lastHitKeys.delete(key);
    this.cache.delete(key);
    return had;
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.entryMeta.clear();
    this.revalidationPromises.clear();
    this.lastHitKeys.clear();
    this.cache.clear();
    this.emit('cache-clear');
    this.log('[HttpCache] CLEARED');
  }

  /**
   * Check if key was a cache hit
   */
  isCacheHit(key: string): boolean {
    return this.lastHitKeys.has(key);
  }

  /**
   * Get raw cached data without fetching
   */
  async getRaw(key: string): Promise<unknown | undefined> {
    return this.cache.get(key);
  }

  /**
   * Get cache statistics
   */
  getStats(): HttpCacheStats {
    const titanStats = this.cache.getStats?.();
    let activeRevalidations = 0;
    for (const meta of this.entryMeta.values()) {
      if (meta.revalidating) {
        activeRevalidations++;
      }
    }

    return {
      entries: this.entryMeta.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate:
        this.stats.hits + this.stats.misses > 0 ? (this.stats.hits / (this.stats.hits + this.stats.misses)) * 100 : 0,
      sizeBytes: titanStats?.memoryUsage ?? 0,
      activeRevalidations,
    };
  }

  /**
   * Get underlying Titan cache for advanced operations
   */
  getTitanCache(): ICache<unknown> {
    return this.cache;
  }

  /**
   * Revalidate in background
   */
  private async revalidateInBackground(
    key: string,
    fetcher: () => Promise<unknown>,
    options: HttpCacheOptions
  ): Promise<void> {
    const meta = this.entryMeta.get(key);
    if (!meta) return;

    meta.revalidating = true;
    this.stats.revalidations++;

    const promise = fetcher()
      .then(async (data) => {
        await this.set(key, data, options);
        meta.revalidating = false;
        this.revalidationPromises.delete(key);
        this.emit('cache-revalidated', { key });
        this.log('[HttpCache] REVALIDATED', { key });
        return data;
      })
      .catch((error) => {
        meta.revalidating = false;
        this.revalidationPromises.delete(key);
        this.emit('cache-revalidation-error', { key, error });
        this.log('[HttpCache] REVALIDATION_FAILED', { key, error: String(error) });
        // Return existing data
        return this.cache.get(key);
      });

    this.revalidationPromises.set(key, promise);
  }
}
