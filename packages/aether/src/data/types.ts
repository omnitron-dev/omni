/**
 * Data Loading - Type Definitions
 *
 * Type definitions for data loading infrastructure including caching,
 * server functions, and optimistic updates.
 */

import type { Resource } from '../core/reactivity/types.js';

/**
 * Cache configuration options
 */
export interface CacheOptions {
  /**
   * Cache key generator function
   * Generates a unique key for caching based on arguments
   */
  key?: (...args: any[]) => string;

  /**
   * Time-to-live in milliseconds
   * How long cached data remains valid
   * @default Infinity (never expires)
   */
  ttl?: number;

  /**
   * Maximum cache size
   * Limits number of cached entries (LRU eviction)
   * @default 100
   */
  maxSize?: number;

  /**
   * Enable stale-while-revalidate pattern
   * Returns stale data immediately while revalidating in background
   * @default false
   */
  staleWhileRevalidate?: boolean;

  /**
   * Stale time in milliseconds
   * How long data is considered fresh before becoming stale
   * Only used with staleWhileRevalidate
   * @default 0
   */
  staleTime?: number;

  /**
   * Revalidate on focus
   * Automatically revalidate when window regains focus
   * @default false
   */
  revalidateOnFocus?: boolean;

  /**
   * Revalidate on reconnect
   * Automatically revalidate when network reconnects
   * @default false
   */
  revalidateOnReconnect?: boolean;

  /**
   * Polling interval in milliseconds
   * Automatically revalidate at this interval (0 to disable)
   * @default 0
   */
  refreshInterval?: number;
}

/**
 * Cache entry with metadata
 */
export interface CacheEntry<T> {
  /** Cached data */
  data: T;

  /** Timestamp when data was cached */
  timestamp: number;

  /** Time-to-live in milliseconds */
  ttl: number;

  /** Whether data is currently being revalidated */
  revalidating: boolean;
}

/**
 * Cache invalidation pattern
 */
export type CacheInvalidationPattern = string | RegExp | ((key: string) => boolean);

/**
 * Server function options
 */
export interface ServerFunctionOptions {
  /**
   * Function name for RPC identification
   */
  name?: string;

  /**
   * Cache configuration for server function results
   */
  cache?: CacheOptions;

  /**
   * Retry options for failed requests
   */
  retry?: {
    /** Maximum number of retries */
    maxRetries?: number;
    /** Delay between retries in milliseconds */
    delay?: number;
    /** Exponential backoff multiplier */
    backoff?: number;
  };

  /**
   * Timeout in milliseconds
   */
  timeout?: number;
}

/**
 * Server function type
 */
export type ServerFunction<TArgs extends any[], TReturn> = (...args: TArgs) => Promise<TReturn>;

/**
 * Wrapped server function with client-side enhancements
 */
export interface WrappedServerFunction<TArgs extends any[], TReturn> extends ServerFunction<TArgs, TReturn> {
  /**
   * Invalidate cached results
   */
  invalidate: (...args: TArgs) => void;

  /**
   * Get cached result without triggering a request
   */
  getCached: (...args: TArgs) => TReturn | undefined;
}

/**
 * Cached resource options
 */
export interface CachedResourceOptions extends CacheOptions {
  /**
   * Initial value before first fetch
   */
  initialValue?: any;

  /**
   * Custom name for debugging
   */
  name?: string;

  /**
   * Error handler
   */
  onError?: (error: Error) => void;

  /**
   * Success handler
   */
  onSuccess?: (data: any) => void;
}

/**
 * Cached resource interface
 */
export interface CachedResource<T> extends Resource<T> {
  /**
   * Manually invalidate cache and refetch
   */
  invalidate: () => void;

  /**
   * Mutate local data (optimistic update)
   */
  mutate: (updater: T | ((prev: T | undefined) => T)) => Promise<void>;

  /**
   * Get cache key
   */
  getCacheKey: () => string;
}

/**
 * Optimistic update configuration
 */
export interface OptimisticUpdateOptions<T> {
  /**
   * Optimistic data to display immediately
   */
  optimisticData: T | ((current: T | undefined) => T);

  /**
   * Whether to revalidate after mutation
   * @default true
   */
  revalidate?: boolean;

  /**
   * Whether to rollback on error
   * @default true
   */
  rollbackOnError?: boolean;

  /**
   * Custom error handler
   */
  onError?: (error: Error, rollback: () => void) => void;
}

/**
 * Optimistic update result
 */
export interface OptimisticUpdateResult<T> {
  /**
   * Commit the optimistic update (after successful mutation)
   */
  commit: (data?: T) => Promise<void>;

  /**
   * Rollback the optimistic update (on error)
   */
  rollback: () => Promise<void>;
}

/**
 * Mutation function type
 */
export type MutationFunction<TArgs extends any[], TReturn> = (...args: TArgs) => Promise<TReturn>;

/**
 * Revalidation strategy
 */
export type RevalidationStrategy =
  | 'none' // No revalidation
  | 'immediate' // Revalidate immediately
  | 'debounced' // Debounce revalidation
  | 'throttled'; // Throttle revalidation

/**
 * Loader integration options
 */
export interface LoaderIntegrationOptions {
  /**
   * Whether to execute loader automatically on navigation
   * @default true
   */
  autoExecute?: boolean;

  /**
   * Cache configuration for loader results
   */
  cache?: CacheOptions;

  /**
   * SSR configuration
   */
  ssr?: {
    /** Enable SSR data loading */
    enabled?: boolean;
    /** Serialize data for hydration */
    serialize?: boolean;
  };

  /**
   * Streaming configuration
   */
  streaming?: {
    /** Enable streaming data support */
    enabled?: boolean;
    /** Chunk size for streaming */
    chunkSize?: number;
  };
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Total number of cache hits */
  hits: number;

  /** Total number of cache misses */
  misses: number;

  /** Current cache size */
  size: number;

  /** Maximum cache size */
  maxSize: number;

  /** Hit rate (0-1) */
  hitRate: number;
}

/**
 * Cache manager interface
 */
export interface CacheManager {
  /**
   * Get cached value
   */
  get: <T>(key: string) => T | undefined;

  /**
   * Set cached value
   */
  set: <T>(key: string, value: T, ttl?: number) => void;

  /**
   * Check if key exists and is valid
   */
  has: (key: string) => boolean;

  /**
   * Delete cached value
   */
  delete: (key: string) => boolean;

  /**
   * Clear all cached values
   */
  clear: () => void;

  /**
   * Invalidate cache entries matching pattern
   */
  invalidate: (pattern: CacheInvalidationPattern) => number;

  /**
   * Get cache statistics
   */
  getStats: () => CacheStats;

  /**
   * Mark entry as revalidating
   */
  setRevalidating: (key: string, revalidating: boolean) => void;

  /**
   * Check if entry is currently revalidating
   */
  isRevalidating: (key: string) => boolean;

  /**
   * Check if entry is stale
   */
  isStale: (key: string, staleTime: number) => boolean;
}
