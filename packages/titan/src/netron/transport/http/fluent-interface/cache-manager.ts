/**
 * HTTP Cache Manager
 *
 * Provides intelligent caching with features like:
 * - Stale-while-revalidate
 * - Tag-based invalidation
 * - Background revalidation
 * - TTL management
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';

/**
 * Cache options
 */
export interface CacheOptions {
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
 * Cache entry
 */
interface CacheEntry {
  /** Cached data */
  data: any;
  /** Timestamp when cached */
  timestamp: number;
  /** Cache options */
  options: CacheOptions;
  /** Whether currently revalidating */
  revalidating?: boolean;
  /** Revalidation promise */
  revalidationPromise?: Promise<any>;
  /** Error if caching failed response */
  error?: any;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Total cache entries */
  entries: number;
  /** Total cache hits */
  hits: number;
  /** Total cache misses */
  misses: number;
  /** Hit rate percentage */
  hitRate: number;
  /** Total size in bytes (approximate) */
  sizeBytes: number;
  /** Number of active revalidations */
  activeRevalidations: number;
}

/**
 * HTTP Cache Manager implementation
 */
export class HttpCacheManager extends EventEmitter {
  private cache = new Map<string, CacheEntry>();
  private tags = new Map<string, Set<string>>(); // tag -> cache keys
  private stats = {
    hits: 0,
    misses: 0,
    revalidations: 0
  };
  private revalidationTimers = new Map<string, NodeJS.Timeout>();
  private lastHitKeys = new Set<string>();

  constructor(
    private options: {
      /** Maximum cache entries */
      maxEntries?: number;
      /** Maximum cache size in bytes */
      maxSizeBytes?: number;
      /** Default max age if not specified */
      defaultMaxAge?: number;
      /** Enable debug logging */
      debug?: boolean;
    } = {}
  ) {
    super();
  }

  /**
   * Get data from cache or fetch
   */
  async get<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: CacheOptions
  ): Promise<T> {
    const entry = this.cache.get(key);
    const now = Date.now();

    // Check if we have a valid cache entry
    if (entry) {
      const age = now - entry.timestamp;

      if (age < options.maxAge) {
        // Fresh cache hit
        this.stats.hits++;
        this.lastHitKeys.add(key);
        this.emit('cache-hit', { key, age });

        if (this.options.debug) {
          console.log(`[Cache] HIT: ${key} (age: ${age}ms)`);
        }

        return entry.data;
      }

      if (options.staleWhileRevalidate && age < options.maxAge + options.staleWhileRevalidate) {
        // Serve stale while revalidating
        this.stats.hits++;
        this.lastHitKeys.add(key);
        this.emit('cache-stale', { key, age });

        if (this.options.debug) {
          console.log(`[Cache] STALE: ${key} (age: ${age}ms), revalidating...`);
        }

        // Revalidate in background if not already doing so
        if (!entry.revalidating) {
          this.revalidateInBackground(key, fetcher, options);
        }

        return entry.data;
      }

      // Check if we have an active revalidation
      if (entry.revalidationPromise) {
        if (this.options.debug) {
          console.log(`[Cache] WAITING: ${key} (revalidation in progress)`);
        }
        return entry.revalidationPromise;
      }
    }

    // Cache miss - fetch fresh data
    this.stats.misses++;
    this.lastHitKeys.delete(key);
    this.emit('cache-miss', { key });

    if (this.options.debug) {
      console.log(`[Cache] MISS: ${key}, fetching...`);
    }

    try {
      const data = await fetcher();
      this.set(key, data, options);
      return data;
    } catch (error) {
      // If cacheOnError is enabled and we have stale data, return it
      // Check both current entry and any existing entry (even if expired)
      const staleEntry = entry || this.cache.get(key);
      if (options.cacheOnError && staleEntry) {
        this.emit('cache-error-fallback', { key, error });

        if (this.options.debug) {
          console.log(`[Cache] ERROR: ${key}, returning stale data`);
        }

        return staleEntry.data;
      }

      throw error;
    }
  }

  /**
   * Set cache entry
   */
  set(key: string, data: any, options: CacheOptions): void {
    // Check if we need to evict entries before adding (if key doesn't exist)
    if (!this.cache.has(key)) {
      this.checkCapacity();
    }

    // Create cache entry
    const entry: CacheEntry = {
      data,
      timestamp: Date.now(),
      options
    };

    // Store in cache
    this.cache.set(key, entry);

    // Update tags index
    if (options.tags) {
      for (const tag of options.tags) {
        if (!this.tags.has(tag)) {
          this.tags.set(tag, new Set());
        }
        this.tags.get(tag)!.add(key);
      }
    }

    // Set TTL timer for automatic cleanup
    // If cacheOnError is enabled, keep stale data longer for error fallback
    const ttl = options.cacheOnError
      ? Math.max(options.maxAge * 10, 60000) // Keep for 10x maxAge or 60s minimum
      : options.maxAge + (options.staleWhileRevalidate || 0);
    this.setTTLTimer(key, ttl);

    this.emit('cache-set', { key, options });
  }

  /**
   * Invalidate cache entries
   */
  invalidate(pattern: string | RegExp | string[]): void {
    const keysToInvalidate = new Set<string>();

    if (Array.isArray(pattern)) {
      // Invalidate by tags
      for (const tag of pattern) {
        const keys = this.tags.get(tag);
        if (keys) {
          keys.forEach(key => keysToInvalidate.add(key));
          this.tags.delete(tag);
        }
      }
    } else if (pattern instanceof RegExp) {
      // Pattern matching
      for (const key of this.cache.keys()) {
        if (pattern.test(key)) {
          keysToInvalidate.add(key);
        }
      }
    } else {
      // Exact match or prefix
      if (pattern.endsWith('*')) {
        // Prefix match
        const prefix = pattern.slice(0, -1);
        for (const key of this.cache.keys()) {
          if (key.startsWith(prefix)) {
            keysToInvalidate.add(key);
          }
        }
      } else {
        // Exact match
        keysToInvalidate.add(pattern);
      }
    }

    // Remove invalidated entries
    for (const key of keysToInvalidate) {
      this.delete(key);
    }

    if (this.options.debug) {
      console.log(`[Cache] INVALIDATED: ${keysToInvalidate.size} entries`);
    }

    this.emit('cache-invalidate', { keys: Array.from(keysToInvalidate) });
  }

  /**
   * Delete a specific cache entry
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Remove from cache
    this.cache.delete(key);

    // Remove from tags index
    if (entry.options.tags) {
      for (const tag of entry.options.tags) {
        const keys = this.tags.get(tag);
        if (keys) {
          keys.delete(key);
          if (keys.size === 0) {
            this.tags.delete(tag);
          }
        }
      }
    }

    // Clear TTL timer
    const timer = this.revalidationTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.revalidationTimers.delete(key);
    }

    return true;
  }

  /**
   * Clear all cache
   */
  clear(): void {
    // Clear all TTL timers
    for (const timer of this.revalidationTimers.values()) {
      clearTimeout(timer);
    }

    this.cache.clear();
    this.tags.clear();
    this.revalidationTimers.clear();
    this.lastHitKeys.clear();

    this.emit('cache-clear');

    if (this.options.debug) {
      console.log('[Cache] CLEARED');
    }
  }

  /**
   * Check if key was a cache hit
   */
  isCacheHit(key: string): boolean {
    return this.lastHitKeys.has(key);
  }

  /**
   * Get raw cached data without fetching
   * Returns undefined if not cached or expired
   */
  getRaw(key: string): any | undefined {
    const entry = this.cache.get(key);
    return entry ? entry.data : undefined;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const entries = this.cache.size;
    const hits = this.stats.hits;
    const misses = this.stats.misses;
    const hitRate = hits + misses > 0 ? (hits / (hits + misses)) * 100 : 0;

    // Estimate size - optimized: avoid expensive JSON.stringify in loop
    let sizeBytes = 0;
    for (const entry of this.cache.values()) {
      sizeBytes += this.estimateSize(entry.data);
    }

    // Count active revalidations
    let activeRevalidations = 0;
    for (const entry of this.cache.values()) {
      if (entry.revalidating) {
        activeRevalidations++;
      }
    }

    return {
      entries,
      hits,
      misses,
      hitRate,
      sizeBytes,
      activeRevalidations
    };
  }

  /**
   * Quick size estimation without expensive JSON.stringify
   * Provides rough estimation for cache size management
   */
  private estimateSize(data: any): number {
    if (data === null || data === undefined) return 4;

    const type = typeof data;

    // Primitives
    if (type === 'string') return data.length * 2; // UTF-16 encoding
    if (type === 'number') return 8;
    if (type === 'boolean') return 4;

    // Arrays
    if (Array.isArray(data)) {
      let size = 16; // base array overhead
      for (const item of data) {
        size += this.estimateSize(item);
      }
      return size;
    }

    // Objects
    if (type === 'object') {
      let size = 16; // base object overhead
      for (const key in data) {
        size += key.length * 2; // key size
        size += this.estimateSize(data[key]); // value size
      }
      return size;
    }

    // Fallback for other types
    return 16;
  }

  /**
   * Revalidate in background
   */
  private async revalidateInBackground(
    key: string,
    fetcher: () => Promise<any>,
    options: CacheOptions
  ): Promise<void> {
    const entry = this.cache.get(key);
    if (!entry) return;

    // Mark as revalidating
    entry.revalidating = true;
    this.stats.revalidations++;

    const revalidationPromise = fetcher()
      .then(data => {
        this.set(key, data, options);
        entry.revalidating = false;
        entry.revalidationPromise = undefined;

        this.emit('cache-revalidated', { key });

        if (this.options.debug) {
          console.log(`[Cache] REVALIDATED: ${key}`);
        }

        return data;
      })
      .catch(error => {
        // Keep stale data on error
        entry.revalidating = false;
        entry.revalidationPromise = undefined;
        entry.error = error;

        this.emit('cache-revalidation-error', { key, error });

        if (this.options.debug) {
          console.warn(`[Cache] REVALIDATION FAILED: ${key}`, error);
        }

        // Return existing data
        return entry.data;
      });

    entry.revalidationPromise = revalidationPromise;
  }

  /**
   * Set TTL timer for automatic cleanup
   */
  private setTTLTimer(key: string, ttl: number): void {
    // Clear existing timer
    const existingTimer = this.revalidationTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.delete(key);
      this.emit('cache-expired', { key });

      if (this.options.debug) {
        console.log(`[Cache] EXPIRED: ${key}`);
      }
    }, ttl);

    this.revalidationTimers.set(key, timer);
  }

  /**
   * Check capacity and evict if necessary
   */
  private checkCapacity(): void {
    // Check max entries - evict if we are at capacity (to make room for new entry)
    if (this.options.maxEntries && this.cache.size >= this.options.maxEntries) {
      this.evictOldest();
    }

    // Check max size
    if (this.options.maxSizeBytes) {
      const stats = this.getStats();
      if (stats.sizeBytes >= this.options.maxSizeBytes) {
        this.evictOldest();
      }
    }
  }

  /**
   * Evict oldest entries (LRU)
   */
  private evictOldest(): void {
    // Find oldest entry (lowest timestamp = oldest)
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.delete(oldestKey);
      this.emit('cache-evicted', { key: oldestKey });

      if (this.options.debug) {
        console.log(`[Cache] EVICTED: ${oldestKey}`);
      }
    }
  }
}