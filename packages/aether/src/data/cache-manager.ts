/**
 * Cache Manager - Smart caching with TTL and invalidation
 *
 * Provides a comprehensive caching system with:
 * - Time-to-live (TTL) support
 * - LRU eviction for size limits
 * - Pattern-based invalidation
 * - Stale-while-revalidate support
 * - Cache statistics
 */

import type {
  CacheEntry,
  CacheInvalidationPattern,
  CacheManager as ICacheManager,
  CacheStats,
} from './types.js';

/**
 * Cache manager implementation with LRU eviction
 */
class CacheManagerImpl implements ICacheManager {
  private cache = new Map<string, CacheEntry<any>>();
  private accessOrder = new Map<string, number>();
  private accessCounter = 0;
  private hits = 0;
  private misses = 0;
  private maxSize: number;

  /**
   * Create a new cache manager
   *
   * @param maxSize - Maximum number of entries (default: 100)
   */
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  /**
   * Get cached value
   *
   * @param key - Cache key
   * @returns Cached value or undefined if not found/expired
   */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check if expired
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.accessOrder.delete(key);
      this.misses++;
      return undefined;
    }

    // Update access order for LRU
    this.accessOrder.set(key, ++this.accessCounter);
    this.hits++;

    return entry.data as T;
  }

  /**
   * Set cached value
   *
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttl - Time-to-live in milliseconds (default: Infinity)
   */
  set<T>(key: string, value: T, ttl = Infinity): void {
    // Evict oldest entry if at max size and key is new
    if (!this.cache.has(key) && this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    // Create cache entry
    const entry: CacheEntry<T> = {
      data: value,
      timestamp: Date.now(),
      ttl,
      revalidating: false,
    };

    this.cache.set(key, entry);
    this.accessOrder.set(key, ++this.accessCounter);
  }

  /**
   * Check if key exists and is valid
   *
   * @param key - Cache key
   * @returns True if key exists and hasn't expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    // Check if expired
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.accessOrder.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete cached value
   *
   * @param key - Cache key
   * @returns True if entry was deleted
   */
  delete(key: string): boolean {
    this.accessOrder.delete(key);
    return this.cache.delete(key);
  }

  /**
   * Clear all cached values
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder.clear();
    this.hits = 0;
    this.misses = 0;
    this.accessCounter = 0;
  }

  /**
   * Invalidate cache entries matching pattern
   *
   * @param pattern - String, regex, or function to match keys
   * @returns Number of entries invalidated
   */
  invalidate(pattern: CacheInvalidationPattern): number {
    let count = 0;
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (this.matchesPattern(key, pattern)) {
        keysToDelete.push(key);
        count++;
      }
    }

    // Delete matched keys
    for (const key of keysToDelete) {
      this.delete(key);
    }

    return count;
  }

  /**
   * Get cache statistics
   *
   * @returns Cache statistics
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? this.hits / total : 0;

    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate,
    };
  }

  /**
   * Mark entry as revalidating
   *
   * @param key - Cache key
   * @param revalidating - Revalidating state
   */
  setRevalidating(key: string, revalidating: boolean): void {
    const entry = this.cache.get(key);

    if (entry) {
      entry.revalidating = revalidating;
    }
  }

  /**
   * Check if entry is currently revalidating
   *
   * @param key - Cache key
   * @returns True if entry is currently revalidating
   */
  isRevalidating(key: string): boolean {
    const entry = this.cache.get(key);
    return entry?.revalidating ?? false;
  }

  /**
   * Check if entry is stale
   *
   * @param key - Cache key
   * @param staleTime - Stale time in milliseconds
   * @returns True if entry is stale
   */
  isStale(key: string, staleTime: number): boolean {
    const entry = this.cache.get(key);

    if (!entry) {
      return true;
    }

    const age = Date.now() - entry.timestamp;
    return age > staleTime;
  }

  /**
   * Check if entry is expired
   */
  private isExpired(entry: CacheEntry<any>): boolean {
    if (entry.ttl === Infinity) {
      return false;
    }

    const age = Date.now() - entry.timestamp;
    return age > entry.ttl;
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    let oldestKey: string | undefined;
    let oldestAccess = Infinity;

    for (const [key, access] of this.accessOrder) {
      if (access < oldestAccess) {
        oldestAccess = access;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.delete(oldestKey);
    }
  }

  /**
   * Check if key matches pattern
   */
  private matchesPattern(key: string, pattern: CacheInvalidationPattern): boolean {
    if (typeof pattern === 'string') {
      return key === pattern;
    } else if (pattern instanceof RegExp) {
      return pattern.test(key);
    } else if (typeof pattern === 'function') {
      return pattern(key);
    }
    return false;
  }
}

/**
 * Global cache manager instance
 */
let globalCacheManager: CacheManagerImpl | undefined;

/**
 * Get or create global cache manager
 *
 * @param maxSize - Maximum cache size (only used on first call)
 * @returns Global cache manager instance
 */
export function getCacheManager(maxSize = 100): ICacheManager {
  if (!globalCacheManager) {
    globalCacheManager = new CacheManagerImpl(maxSize);
  }
  return globalCacheManager;
}

/**
 * Create a new isolated cache manager
 *
 * @param maxSize - Maximum cache size
 * @returns New cache manager instance
 */
export function createCacheManager(maxSize = 100): ICacheManager {
  return new CacheManagerImpl(maxSize);
}

/**
 * Reset global cache manager (useful for testing)
 */
export function resetCacheManager(): void {
  globalCacheManager = undefined;
}

/**
 * Generate cache key from function name and arguments
 *
 * @param name - Function name
 * @param args - Function arguments
 * @returns Cache key
 */
export function generateCacheKey(name: string, args: any[]): string {
  if (args.length === 0) {
    return name;
  }

  try {
    const argsKey = JSON.stringify(args);
    return `${name}:${argsKey}`;
  } catch {
    // Fallback for non-serializable arguments
    return `${name}:${args.map((arg) => String(arg)).join(':')}`;
  }
}

/**
 * Invalidate cache entries by prefix
 *
 * @param prefix - Key prefix to invalidate
 * @returns Number of entries invalidated
 */
export function invalidateByPrefix(prefix: string): number {
  const manager = getCacheManager();
  return manager.invalidate((key) => key.startsWith(prefix));
}

/**
 * Invalidate cache entries by pattern
 *
 * @param pattern - Pattern to match (string, regex, or function)
 * @returns Number of entries invalidated
 */
export function invalidateCache(pattern?: CacheInvalidationPattern): number {
  const manager = getCacheManager();

  if (!pattern) {
    manager.clear();
    return Infinity;
  }

  return manager.invalidate(pattern);
}

/**
 * Get global cache statistics
 *
 * @returns Cache statistics
 */
export function getCacheStats(): CacheStats {
  return getCacheManager().getStats();
}
