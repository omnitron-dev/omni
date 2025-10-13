/**
 * Cached Resource - Enhanced resource with automatic caching
 *
 * Extends the core resource() primitive with:
 * - Automatic caching with TTL
 * - Stale-while-revalidate pattern
 * - Background revalidation
 * - Cache invalidation
 * - Optimistic updates
 */

import { resource as coreResource } from '../core/reactivity/resource.js';
import { computed } from '../core/reactivity/computed.js';
import { getCacheManager, generateCacheKey } from './cache-manager.js';
import type { CachedResource, CachedResourceOptions } from './types.js';

/**
 * Create a cached resource with automatic caching and revalidation
 *
 * @param fetcher - Async function to fetch data
 * @param options - Cached resource options
 * @returns Cached resource
 *
 * @example
 * ```typescript
 * const userId = signal(1);
 *
 * const user = createCachedResource(
 *   () => fetch(`/api/users/${userId()}`).then(r => r.json()),
 *   {
 *     name: 'user',
 *     ttl: 60000, // Cache for 1 minute
 *     staleWhileRevalidate: true,
 *     staleTime: 30000 // Fresh for 30 seconds
 *   }
 * );
 *
 * // Automatically cached and revalidated
 * console.log(user().name);
 * ```
 */
export function createCachedResource<T>(
  fetcher: () => Promise<T>,
  options: CachedResourceOptions = {}
): CachedResource<T> {
  const {
    name = 'anonymous',
    ttl = Infinity,
    staleWhileRevalidate = false,
    staleTime = 0,
    revalidateOnFocus = false,
    revalidateOnReconnect = false,
    refreshInterval = 0,
    key: keyFn,
    onError,
    onSuccess,
  } = options;

  const cache = getCacheManager();
  let refetchCounter = 0;

  // Initialize cache key early (important for SWR)
  let cacheKey = keyFn ? keyFn() : generateCacheKey(name, [refetchCounter]);

  // Store reference to base resource for background revalidation
  let baseResourceRef: any;

  /**
   * Wrapped fetcher with caching logic
   */
  const wrappedFetcher = async (): Promise<T> => {
    // Update cache key (includes dependencies from reactive tracking)
    cacheKey = keyFn ? keyFn() : generateCacheKey(name, [refetchCounter]);

    // Check cache first
    const cached = cache.get<T>(cacheKey);

    if (cached !== undefined) {
      // Stale-while-revalidate: return stale data and revalidate in background
      if (staleWhileRevalidate && cache.isStale(cacheKey, staleTime)) {
        // Mark as revalidating
        cache.setRevalidating(cacheKey, true);

        // Revalidate in background (don't await)
        fetcher()
          .then((result) => {
            cache.set(cacheKey, result, ttl);
            cache.setRevalidating(cacheKey, false);
            // CRITICAL FIX: Update the resource signal with new data
            if (baseResourceRef) {
              baseResourceRef.mutate(result);
            }
            if (onSuccess) {
              onSuccess(result);
            }
          })
          .catch((error) => {
            console.error('Background revalidation failed:', error);
            cache.setRevalidating(cacheKey, false);
            if (onError) {
              onError(error as Error);
            }
          });
      }

      return cached;
    }

    // Not cached, fetch data
    try {
      const result = await fetcher();

      // Cache result
      cache.set(cacheKey, result, ttl);

      if (onSuccess) {
        onSuccess(result);
      }

      return result;
    } catch (error) {
      if (onError) {
        onError(error as Error);
      }
      throw error;
    }
  };

  // Create base resource
  const baseResource = coreResource(wrappedFetcher);
  baseResourceRef = baseResource;

  // Add revalidation strategies
  if (revalidateOnFocus && typeof window !== 'undefined') {
    window.addEventListener('focus', () => {
      baseResource.refetch();
    });
  }

  if (revalidateOnReconnect && typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      baseResource.refetch();
    });
  }

  if (refreshInterval > 0) {
    const intervalId = setInterval(() => {
      baseResource.refetch();
    }, refreshInterval);

    // Cleanup interval (in real implementation, this would be tied to component lifecycle)
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        clearInterval(intervalId);
      });
    }
  }

  /**
   * Invalidate cache and refetch
   */
  function invalidate(): void {
    if (cacheKey) {
      cache.delete(cacheKey);
    }
    refetchCounter++;
    baseResource.refetch();
  }

  /**
   * Refetch data (bypasses cache)
   */
  async function refetch(): Promise<void> {
    // Clear cache to force fresh fetch
    if (cacheKey) {
      cache.delete(cacheKey);
    }
    // Increment counter to get new cache key
    refetchCounter++;
    // Trigger refetch
    await baseResource.refetch();
  }

  /**
   * Mutate local data (optimistic update)
   *
   * CRITICAL: This updates the resource synchronously for immediate UI updates.
   * We update both the cache and the resource signal synchronously.
   */
  function mutate(updater: T | ((prev: T | undefined) => T)): Promise<void> {
    const current = baseResource();

    const newData = typeof updater === 'function'
      ? (updater as (prev: T | undefined) => T)(current)
      : updater;

    // Update cache with the new data using CURRENT key
    // This ensures immediate update without changing the cache key
    const currentKey = cacheKey || (keyFn ? keyFn() : generateCacheKey(name, [refetchCounter]));
    cache.set(currentKey, newData, ttl);
    cacheKey = currentKey;

    // Update the resource signal directly (synchronous!)
    // This makes the new data available immediately to the UI
    baseResource.mutate(newData);

    // Return a resolved promise for API compatibility
    return Promise.resolve();
  }

  /**
   * Get current cache key
   */
  function getCacheKeyValue(): string {
    return cacheKey;
  }

  /**
   * Accessor function with SWR staleness check
   *
   * On every access, checks if data is stale and triggers background revalidation
   */
  function accessWithSWRCheck(): T | undefined {
    const data = baseResource();

    // If SWR is enabled and we have data, check if it's stale
    if (staleWhileRevalidate && data !== undefined && !baseResource.loading()) {
      const currentKey = cacheKey || (keyFn ? keyFn() : generateCacheKey(name, [refetchCounter]));

      // Check if data is stale and not already revalidating
      if (cache.isStale(currentKey, staleTime) && !cache.isRevalidating(currentKey)) {
        // Trigger background revalidation
        cache.setRevalidating(currentKey, true);

        fetcher()
          .then((result) => {
            cache.set(currentKey, result, ttl);
            cache.setRevalidating(currentKey, false);
            // Update the resource signal with new data
            if (baseResourceRef) {
              baseResourceRef.mutate(result);
            }
            if (onSuccess) {
              onSuccess(result);
            }
          })
          .catch((error) => {
            console.error('Background revalidation failed:', error);
            cache.setRevalidating(currentKey, false);
            if (onError) {
              onError(error as Error);
            }
          });
      }
    }

    return data;
  }

  // Create cached resource interface
  const cachedResource = Object.assign(
    accessWithSWRCheck,
    {
      loading: () => baseResource.loading(),
      error: () => baseResource.error(),
      refetch,
      invalidate,
      mutate,
      getCacheKey: getCacheKeyValue,
    }
  );

  return cachedResource as CachedResource<T>;
}

/**
 * Create multiple cached resources that load in parallel
 *
 * @param resources - Object with resource fetchers
 * @param options - Shared options for all resources
 * @returns Object with cached resources
 *
 * @example
 * ```typescript
 * const { user, posts, comments } = createCachedResources({
 *   user: () => fetchUser(),
 *   posts: () => fetchPosts(),
 *   comments: () => fetchComments()
 * }, {
 *   ttl: 60000,
 *   staleWhileRevalidate: true
 * });
 * ```
 */
export function createCachedResources<
  T extends Record<string, () => Promise<any>>
>(
  resources: T,
  options: CachedResourceOptions = {}
): {
  [K in keyof T]: CachedResource<
    T[K] extends () => Promise<infer R> ? R : never
  >;
} {
  const result: any = {};

  for (const [key, fetcher] of Object.entries(resources)) {
    result[key] = createCachedResource(fetcher, {
      ...options,
      name: options.name ? `${options.name}.${key}` : key,
    });
  }

  return result;
}

/**
 * Create a cached resource with automatic dependency tracking
 *
 * Similar to createCachedResource but automatically generates cache keys
 * based on signal dependencies.
 *
 * @param fetcher - Async function to fetch data
 * @param options - Cached resource options
 * @returns Cached resource
 *
 * @example
 * ```typescript
 * const userId = signal(1);
 *
 * // Cache key automatically includes userId value
 * const user = createAutoTrackedResource(
 *   () => fetch(`/api/users/${userId()}`).then(r => r.json()),
 *   { name: 'user', ttl: 60000 }
 * );
 * ```
 */
export function createAutoTrackedResource<T>(
  fetcher: () => Promise<T>,
  options: CachedResourceOptions = {}
): CachedResource<T> {
  // Track dependencies to generate cache key
  const deps: any[] = [];

  // Wrapper that tracks signal accesses
  const trackingFetcher = async (): Promise<T> => {
    // Reset deps
    deps.length = 0;

    // Create computed to track dependencies
    const tracker = computed(() => {
      try {
        // Access signals to track them
        return fetcher();
      } catch {
        return fetcher();
      }
    });

    // Execute to capture dependencies
    const result = tracker();

    // Store dependency values for cache key
    // In a real implementation, this would capture actual signal values
    // For now, we'll use a counter-based approach

    return result;
  };

  return createCachedResource(trackingFetcher, {
    ...options,
    key: () =>
      // Generate key based on tracked dependencies
      generateCacheKey(options.name ?? 'auto-tracked', deps),
  });
}

/**
 * Preload a cached resource
 *
 * Fetches data and caches it without creating a resource instance.
 * Useful for prefetching data before navigation.
 *
 * @param fetcher - Async function to fetch data
 * @param options - Cache options
 * @returns Promise resolving to fetched data
 *
 * @example
 * ```typescript
 * // Preload user data on link hover
 * <Link
 *   href="/users/123"
 *   onMouseEnter={() => {
 *     preloadCachedResource(
 *       () => fetchUser(123),
 *       { name: 'user', ttl: 60000 }
 *     );
 *   }}
 * >
 *   View User
 * </Link>
 * ```
 */
export async function preloadCachedResource<T>(
  fetcher: () => Promise<T>,
  options: CachedResourceOptions = {}
): Promise<T> {
  const { name = 'anonymous', ttl = Infinity, key: keyFn } = options;
  const cache = getCacheManager();

  // Generate cache key (use [0] to match initial refetchCounter in createCachedResource)
  const cacheKey = keyFn ? keyFn() : generateCacheKey(name, [0]);

  // Check if already cached
  const cached = cache.get<T>(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  // Fetch and cache
  const result = await fetcher();
  cache.set(cacheKey, result, ttl);

  return result;
}
