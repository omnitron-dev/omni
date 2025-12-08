/**
 * LRU (Least Recently Used) Cache with TTL (Time To Live) support
 *
 * This cache implementation provides:
 * - LRU eviction when maxSize is reached
 * - TTL-based expiration for entries
 * - Optional callbacks for eviction events
 * - O(1) get/set operations using Map's insertion order
 *
 * Performance characteristics:
 * - Get: O(1) average
 * - Set: O(1) average
 * - Delete: O(1)
 * - Memory: O(n) where n = maxSize
 */

import type { ILogger } from '../modules/logger/logger.types.js';

/**
 * Configuration options for LRUCache
 */
export interface LRUCacheOptions<K, V> {
  /**
   * Maximum number of entries in the cache.
   * When exceeded, least recently used entries are evicted.
   * @default 1000
   */
  maxSize?: number;

  /**
   * Time-to-live in milliseconds for cache entries.
   * Entries older than this are considered stale and will be evicted.
   * Set to 0 or undefined to disable TTL.
   * @default 0 (disabled)
   */
  ttl?: number;

  /**
   * Callback invoked when an entry is evicted (due to size limit or TTL).
   * Useful for cleanup operations like closing connections.
   */
  onEvict?: (key: K, value: V, reason: 'size' | 'ttl' | 'manual') => void;

  /**
   * Interval in milliseconds for TTL cleanup sweep.
   * Only relevant when ttl > 0.
   * @default ttl / 2 or 30000ms minimum
   */
  cleanupInterval?: number;

  /**
   * Whether to update access time on get() operations.
   * When true, accessed entries move to the end (most recently used).
   * @default true
   */
  updateOnGet?: boolean;

  /**
   * Optional logger for cache operations
   */
  logger?: ILogger;
}

/**
 * Internal cache entry with metadata
 */
interface CacheEntry<V> {
  value: V;
  createdAt: number;
  lastAccessed: number;
}

/**
 * Cache statistics for monitoring
 */
export interface LRUCacheStats {
  /** Current number of entries */
  size: number;
  /** Maximum allowed entries */
  maxSize: number;
  /** Total cache hits */
  hits: number;
  /** Total cache misses */
  misses: number;
  /** Hit rate percentage (0-100) */
  hitRate: number;
  /** Number of evictions due to size limit */
  sizeEvictions: number;
  /** Number of evictions due to TTL expiration */
  ttlEvictions: number;
  /** TTL configuration in milliseconds */
  ttl: number;
}

/**
 * LRU Cache with TTL support
 *
 * @example
 * ```typescript
 * // Basic usage with size limit
 * const cache = new LRUCache<string, Definition>({ maxSize: 100 });
 * cache.set('key', definition);
 * const value = cache.get('key');
 *
 * // With TTL (5 minutes)
 * const cache = new LRUCache<string, Definition>({
 *   maxSize: 100,
 *   ttl: 5 * 60 * 1000,
 *   onEvict: (key, value, reason) => {
 *     console.log(`Entry ${key} evicted: ${reason}`);
 *   }
 * });
 * ```
 */
export class LRUCache<K, V> {
  private cache = new Map<K, CacheEntry<V>>();
  private readonly maxSize: number;
  private readonly ttl: number;
  private readonly onEvict?: (key: K, value: V, reason: 'size' | 'ttl' | 'manual') => void;
  private readonly updateOnGet: boolean;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private logger?: ILogger;

  // Statistics
  private hits = 0;
  private misses = 0;
  private sizeEvictions = 0;
  private ttlEvictions = 0;

  constructor(options: LRUCacheOptions<K, V> = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.ttl = options.ttl ?? 0;
    this.onEvict = options.onEvict;
    this.updateOnGet = options.updateOnGet ?? true;
    this.logger = options.logger;

    // Start TTL cleanup timer if TTL is configured
    if (this.ttl > 0) {
      const interval = options.cleanupInterval ?? Math.max(this.ttl / 2, 30000);
      this.cleanupTimer = setInterval(() => this.cleanupExpired(), interval);
      // Ensure timer doesn't prevent process exit
      if (this.cleanupTimer.unref) {
        this.cleanupTimer.unref();
      }
    }
  }

  /**
   * Get a value from the cache.
   * Updates the entry's access time (making it most recently used) if updateOnGet is true.
   *
   * @param key - The key to look up
   * @returns The value if found and not expired, undefined otherwise
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check TTL expiration
    if (this.isExpired(entry)) {
      this.deleteWithCallback(key, entry.value, 'ttl');
      this.misses++;
      return undefined;
    }

    this.hits++;

    // Update access time and move to end (most recently used)
    if (this.updateOnGet) {
      entry.lastAccessed = Date.now();
      // Re-insert to move to end of Map (most recently used position)
      this.cache.delete(key);
      this.cache.set(key, entry);
    }

    return entry.value;
  }

  /**
   * Set a value in the cache.
   * If the cache is at capacity, the least recently used entry is evicted.
   *
   * @param key - The key to store under
   * @param value - The value to store
   * @returns this for chaining
   */
  set(key: K, value: V): this {
    // If key exists, delete it first (to update position in Map)
    const existing = this.cache.get(key);
    if (existing) {
      this.cache.delete(key);
    }

    // Evict LRU entries if at capacity
    while (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    const now = Date.now();
    this.cache.set(key, {
      value,
      createdAt: now,
      lastAccessed: now,
    });

    return this;
  }

  /**
   * Check if a key exists and is not expired.
   *
   * @param key - The key to check
   * @returns true if the key exists and is not expired
   */
  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (this.isExpired(entry)) {
      this.deleteWithCallback(key, entry.value, 'ttl');
      return false;
    }

    return true;
  }

  /**
   * Delete an entry from the cache.
   *
   * @param key - The key to delete
   * @returns true if an entry was deleted
   */
  delete(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    this.deleteWithCallback(key, entry.value, 'manual');
    return true;
  }

  /**
   * Clear all entries from the cache.
   * Invokes onEvict callback for each entry if configured.
   */
  clear(): void {
    if (this.onEvict) {
      for (const [key, entry] of this.cache) {
        this.onEvict(key, entry.value, 'manual');
      }
    }
    this.cache.clear();
  }

  /**
   * Get the current number of entries in the cache.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get all keys in the cache (including potentially expired ones).
   * For accurate results, call cleanupExpired() first.
   */
  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  /**
   * Get all values in the cache (including potentially expired ones).
   * For accurate results, call cleanupExpired() first.
   */
  *values(): IterableIterator<V> {
    for (const entry of this.cache.values()) {
      yield entry.value;
    }
  }

  /**
   * Get all entries in the cache (including potentially expired ones).
   * For accurate results, call cleanupExpired() first.
   */
  *entries(): IterableIterator<[K, V]> {
    for (const [key, entry] of this.cache.entries()) {
      yield [key, entry.value];
    }
  }

  /**
   * Iterate over all entries using forEach.
   */
  forEach(callback: (value: V, key: K, cache: LRUCache<K, V>) => void): void {
    for (const [key, entry] of this.cache) {
      callback(entry.value, key, this);
    }
  }

  /**
   * Get cache statistics for monitoring.
   */
  getStats(): LRUCacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? (this.hits / total) * 100 : 0,
      sizeEvictions: this.sizeEvictions,
      ttlEvictions: this.ttlEvictions,
      ttl: this.ttl,
    };
  }

  /**
   * Reset statistics counters.
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.sizeEvictions = 0;
    this.ttlEvictions = 0;
  }

  /**
   * Manually trigger cleanup of expired entries.
   * This is called automatically on a timer if TTL is configured.
   *
   * @returns Number of entries removed
   */
  cleanupExpired(): number {
    if (this.ttl <= 0) return 0;

    let removed = 0;
    for (const [key, entry] of this.cache) {
      if (this.isExpired(entry)) {
        this.deleteWithCallback(key, entry.value, 'ttl');
        removed++;
      }
    }
    return removed;
  }

  /**
   * Stop the automatic TTL cleanup timer.
   * Call this when disposing of the cache to prevent memory leaks.
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Check if an entry has expired based on TTL.
   */
  private isExpired(entry: CacheEntry<V>): boolean {
    if (this.ttl <= 0) return false;
    return Date.now() - entry.createdAt > this.ttl;
  }

  /**
   * Evict the least recently used entry (first entry in Map).
   */
  private evictLRU(): void {
    // Map maintains insertion order, first key is LRU
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      const entry = this.cache.get(firstKey);
      if (entry) {
        this.sizeEvictions++;
        this.deleteWithCallback(firstKey, entry.value, 'size');
      }
    }
  }

  /**
   * Delete an entry and invoke the eviction callback.
   */
  private deleteWithCallback(key: K, value: V, reason: 'size' | 'ttl' | 'manual'): void {
    this.cache.delete(key);
    if (reason === 'ttl') {
      this.ttlEvictions++;
    }
    if (this.onEvict) {
      try {
        this.onEvict(key, value, reason);
      } catch (error) {
        // Log callback errors but don't throw to prevent cache corruption
        this.logger?.error(
          { err: error as Error, key, reason },
          'LRU cache eviction callback error'
        );
      }
    }
  }
}
