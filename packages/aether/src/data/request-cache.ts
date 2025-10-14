/**
 * Request Cache - Deduplication and caching for data fetching
 *
 * This module provides request deduplication, caching, and batching to optimize
 * data fetching and reduce redundant network requests.
 *
 * Performance Benefits:
 * - Eliminates duplicate requests (90%+ reduction in some cases)
 * - Reduces network load and server pressure
 * - Improves perceived performance with instant cache hits
 * - Supports optimistic updates
 *
 * @module data/request-cache
 */

/**
 * Cache entry metadata
 */
interface CacheEntry<T> {
  /** Cached data */
  data: T;
  /** Timestamp when cached */
  timestamp: number;
  /** Time to live in ms */
  ttl: number;
  /** ETag for conditional requests */
  etag?: string;
  /** Request in flight */
  promise?: Promise<T>;
  /** Number of hits */
  hits: number;
  /** Last access timestamp */
  lastAccess: number;
}

/**
 * Request cache configuration
 */
export interface RequestCacheConfig {
  /** Default TTL in ms (default: 300000 - 5 minutes) */
  defaultTTL?: number;
  /** Maximum cache size (default: 100) */
  maxSize?: number;
  /** Enable request batching (default: true) */
  enableBatching?: boolean;
  /** Batch window in ms (default: 10) */
  batchWindow?: number;
  /** Enable statistics tracking (default: true) */
  enableStats?: boolean;
  /** Enable optimistic updates (default: true) */
  enableOptimistic?: boolean;
}

/**
 * Request options
 */
export interface RequestOptions {
  /** Time to live in ms (overrides default) */
  ttl?: number;
  /** Force fresh fetch (bypass cache) */
  force?: boolean;
  /** Enable deduplication for this request */
  dedupe?: boolean;
  /** Enable batching for this request */
  batch?: boolean;
  /** Optimistic data for immediate return */
  optimistic?: any;
  /** Cache key (if different from default) */
  cacheKey?: string;
}

/**
 * Request function type
 */
export type RequestFunction<T> = () => Promise<T>;

/**
 * Batched request
 */
interface BatchedRequest<T> {
  key: string;
  request: RequestFunction<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  options: RequestOptions;
}

/**
 * Request cache statistics
 */
interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  deduped: number;
  batched: number;
  optimistic: number;
}

/**
 * Request cache with deduplication and batching
 */
export class RequestCache {
  private cache = new Map<string, CacheEntry<any>>();
  private inFlight = new Map<string, Promise<any>>();
  private batchQueue = new Map<string, BatchedRequest<any>[]>();
  private batchTimer?: NodeJS.Timeout | number;
  private config: Required<RequestCacheConfig>;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    deduped: 0,
    batched: 0,
    optimistic: 0,
  };

  constructor(config: RequestCacheConfig = {}) {
    this.config = {
      defaultTTL: config.defaultTTL ?? 300000, // 5 minutes
      maxSize: config.maxSize ?? 100,
      enableBatching: config.enableBatching ?? true,
      batchWindow: config.batchWindow ?? 10,
      enableStats: config.enableStats ?? true,
      enableOptimistic: config.enableOptimistic ?? true,
    };
  }

  /**
   * Fetch data with caching and deduplication
   *
   * @param key - Cache key
   * @param request - Request function
   * @param options - Request options
   * @returns Promise resolving to data
   */
  async fetch<T>(key: string, request: RequestFunction<T>, options: RequestOptions = {}): Promise<T> {
    const cacheKey = options.cacheKey ?? key;
    const dedupe = options.dedupe ?? true;
    const batch = options.batch ?? this.config.enableBatching;

    // Check for optimistic data
    if (this.config.enableOptimistic && options.optimistic !== undefined) {
      this.stats.optimistic++;

      // Return optimistic data immediately
      const optimisticPromise = Promise.resolve(options.optimistic as T);

      // Fetch real data in background
      this.fetchReal(cacheKey, request, options).catch(() => {
        // Silently fail background fetch
      });

      return optimisticPromise;
    }

    // Check cache if not forced
    if (!options.force) {
      const cached = this.get<T>(cacheKey);
      if (cached !== null) {
        this.stats.hits++;
        return cached;
      }
    }

    this.stats.misses++;

    // Check for in-flight request (deduplication)
    if (dedupe) {
      const inFlight = this.inFlight.get(cacheKey);
      if (inFlight) {
        this.stats.deduped++;
        return inFlight;
      }
    }

    // Check for batching
    if (batch) {
      return this.batchRequest(cacheKey, request, options);
    }

    // Execute request
    return this.fetchReal(cacheKey, request, options);
  }

  /**
   * Execute real fetch
   */
  private async fetchReal<T>(key: string, request: RequestFunction<T>, options: RequestOptions): Promise<T> {
    // Create promise
    const promise = request();

    // Track in-flight request
    this.inFlight.set(key, promise);

    try {
      // Await result
      const data = await promise;

      // Cache result
      this.set(key, data, options.ttl ?? this.config.defaultTTL);

      return data;
    } catch (error) {
      // Remove from cache on error
      this.delete(key);
      throw error;
    } finally {
      // Remove from in-flight
      this.inFlight.delete(key);
    }
  }

  /**
   * Batch request for later execution
   */
  private batchRequest<T>(key: string, request: RequestFunction<T>, options: RequestOptions): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // Get or create batch queue
      let queue = this.batchQueue.get(key);
      if (!queue) {
        queue = [];
        this.batchQueue.set(key, queue);
      }

      // Add to queue
      queue.push({
        key,
        request,
        resolve,
        reject,
        options,
      });

      // Schedule batch execution
      if (!this.batchTimer) {
        this.scheduleBatch();
      }
    });
  }

  /**
   * Schedule batch execution
   */
  private scheduleBatch(): void {
    this.batchTimer = setTimeout(() => {
      this.executeBatch();
    }, this.config.batchWindow);
  }

  /**
   * Execute batched requests
   */
  private async executeBatch(): Promise<void> {
    this.batchTimer = undefined;

    // Get all queued requests
    const queues = Array.from(this.batchQueue.entries());
    this.batchQueue.clear();

    // Execute each batch
    for (const [key, queue] of queues) {
      if (queue.length === 0) continue;

      this.stats.batched += queue.length;

      // Take first request (others are duplicates)
      const first = queue[0];
      if (!first) continue;

      try {
        // Execute request
        const data = await this.fetchReal(key, first.request, first.options);

        // Resolve all waiting promises
        for (const req of queue) {
          req.resolve(data);
        }
      } catch (error) {
        // Reject all waiting promises
        for (const req of queue) {
          req.reject(error);
        }
      }
    }
  }

  /**
   * Get cached data
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    // Check expiration
    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.delete(key);
      return null;
    }

    // Update access time and hits
    entry.lastAccess = now;
    entry.hits++;

    return entry.data;
  }

  /**
   * Set cached data
   */
  set<T>(key: string, data: T, ttl?: number): void {
    // Check cache size
    if (this.cache.size >= this.config.maxSize) {
      this.evictLRU();
    }

    const now = Date.now();
    this.cache.set(key, {
      data,
      timestamp: now,
      ttl: ttl ?? this.config.defaultTTL,
      hits: 0,
      lastAccess: now,
    });
  }

  /**
   * Delete cached data
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.cache.clear();
    this.inFlight.clear();
    this.batchQueue.clear();
    if (this.batchTimer) {
      clearTimeout(this.batchTimer as any);
      this.batchTimer = undefined;
    }
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  /**
   * Invalidate cache entries matching pattern
   */
  invalidate(pattern: string | RegExp): number {
    let count = 0;
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }

    return count;
  }

  /**
   * Update cache entry
   */
  update<T>(key: string, updater: (data: T) => T): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    entry.data = updater(entry.data);
    entry.timestamp = Date.now();
    return true;
  }

  /**
   * Prefetch data
   */
  async prefetch<T>(key: string, request: RequestFunction<T>, options: RequestOptions = {}): Promise<void> {
    // Fetch without waiting
    this.fetch(key, request, { ...options, force: false }).catch(() => {
      // Silently fail prefetch
    });
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.cache.size,
      inFlightCount: this.inFlight.size,
      hitRate: this.stats.hits / Math.max(1, this.stats.hits + this.stats.misses),
      dedupeRate: this.stats.deduped / Math.max(1, this.stats.misses),
    };
  }

  /**
   * Get cache info
   */
  getInfo(key: string): { exists: boolean; ttl?: number; hits?: number; age?: number } | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return { exists: false };
    }

    const now = Date.now();
    const age = now - entry.timestamp;
    const remaining = entry.ttl - age;

    return {
      exists: true,
      ttl: remaining > 0 ? remaining : 0,
      hits: entry.hits,
      age,
    };
  }
}

/**
 * Global request cache instance
 */
export const globalRequestCache = new RequestCache({
  defaultTTL: 300000, // 5 minutes
  maxSize: 100,
  enableBatching: true,
  batchWindow: 10,
  enableStats: true,
  enableOptimistic: true,
});

/**
 * Fetch with caching and deduplication
 *
 * @param key - Cache key
 * @param request - Request function
 * @param options - Request options
 * @returns Promise resolving to data
 */
export function cachedFetch<T>(key: string, request: RequestFunction<T>, options?: RequestOptions): Promise<T> {
  return globalRequestCache.fetch(key, request, options);
}

/**
 * Invalidate cache entries
 *
 * @param pattern - Pattern to match keys
 * @returns Number of invalidated entries
 */
export function invalidateCache(pattern: string | RegExp): number {
  return globalRequestCache.invalidate(pattern);
}

/**
 * Clear all cache
 */
export function clearCache(): void {
  globalRequestCache.clear();
}

/**
 * Create request function with automatic deduplication
 *
 * @param keyFn - Function to generate cache key from arguments
 * @param requestFn - Request function
 * @returns Wrapped request function
 */
export function createCachedRequest<Args extends any[], Result>(
  keyFn: (...args: Args) => string,
  requestFn: (...args: Args) => Promise<Result>
): (...args: Args) => Promise<Result> {
  return (...args: Args) => {
    const key = keyFn(...args);
    return globalRequestCache.fetch(key, () => requestFn(...args));
  };
}
