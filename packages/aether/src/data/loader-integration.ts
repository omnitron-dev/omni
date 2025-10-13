/**
 * Loader Integration - Connect data loading with router
 *
 * Provides integration between data loading infrastructure and the router:
 * - Automatic loader execution on navigation
 * - Cached loader results
 * - SSR data hydration
 * - Streaming data support
 */

import type { RouteLoader, LoaderContext } from '../router/types.js';
import { setLoaderData, executeLoader } from '../router/data.js';
import { getCacheManager, generateCacheKey } from './cache-manager.js';
import { createCachedResource } from './resource-cache.js';
import type { LoaderIntegrationOptions, CachedResource } from './types.js';

/**
 * Wrap a route loader with caching
 *
 * Creates a cached version of a route loader that automatically caches
 * results and returns cached data on subsequent navigations.
 *
 * @param loader - Route loader function
 * @param options - Integration options
 * @returns Wrapped loader with caching
 *
 * @example
 * ```typescript
 * export const loader = withLoaderCache(
 *   async ({ params }) => {
 *     const user = await fetchUser(params.id);
 *     return { user };
 *   },
 *   {
 *     cache: {
 *       ttl: 60000,
 *       key: (context) => `user-${context.params.id}`
 *     }
 *   }
 * );
 * ```
 */
export function withLoaderCache(
  loader: RouteLoader,
  options: LoaderIntegrationOptions = {}
): RouteLoader {
  const { cache } = options;

  if (!cache) {
    return loader;
  }

  const cacheManager = getCacheManager();

  return async (context: LoaderContext): Promise<any> => {
    // Generate cache key
    const cacheKey = cache.key
      ? cache.key(context)
      : generateCacheKey('loader', [context.request?.url ?? context.url.toString()]);

    // Check cache
    const cached = cacheManager.get(cacheKey);

    if (cached !== undefined) {
      // Handle stale-while-revalidate
      if (cache.staleWhileRevalidate) {
        const staleTime = cache.staleTime ?? 0;

        if (cacheManager.isStale(cacheKey, staleTime)) {
          // Return stale data immediately
          const staleData = cached;

          // Revalidate in background
          cacheManager.setRevalidating(cacheKey, true);

          executeLoader(loader, context)
            .then((result) => {
              cacheManager.set(cacheKey, result, cache.ttl);
              cacheManager.setRevalidating(cacheKey, false);
              // Update loader data map
              setLoaderData(context.request?.url ?? context.url.toString(), result);
            })
            .catch((error) => {
              console.error('Background loader revalidation failed:', error);
              cacheManager.setRevalidating(cacheKey, false);
            });

          return staleData;
        }
      }

      return cached;
    }

    // Execute loader
    const result = await executeLoader(loader, context);

    // Cache result
    cacheManager.set(cacheKey, result, cache.ttl);

    return result;
  };
}

/**
 * Create a cached resource from a route loader
 *
 * Converts a route loader into a cached resource that can be used
 * outside of route navigation.
 *
 * @param loader - Route loader function
 * @param getContext - Function to get loader context
 * @param options - Integration options
 * @returns Cached resource
 *
 * @example
 * ```typescript
 * const userLoader = async ({ params }) => fetchUser(params.id);
 *
 * const Component = defineComponent(() => {
 *   const userId = signal(1);
 *
 *   const user = createLoaderResource(
 *     userLoader,
 *     () => ({
 *       params: { id: userId().toString() },
 *       request: new Request(`/users/${userId()}`)
 *     }),
 *     { cache: { ttl: 60000 } }
 *   );
 *
 *   return () => <div>{user()?.name}</div>;
 * });
 * ```
 */
export function createLoaderResource<T>(
  loader: RouteLoader,
  getContext: () => Partial<LoaderContext>,
  options: LoaderIntegrationOptions = {}
): CachedResource<T> {
  return createCachedResource(
    async () => {
      const context = getContext();

      // Create full loader context with defaults
      const fullContext: LoaderContext = {
        params: context.params ?? {},
        request: context.request,
        url: context.url ?? new URL('/', window.location.origin),
      };

      return (await executeLoader(loader, fullContext)) as T;
    },
    {
      ...options.cache,
      name: 'loader',
    }
  );
}

/**
 * Prefetch loader data
 *
 * Executes a route loader and caches the result without navigation.
 * Useful for link prefetching.
 *
 * @param loader - Route loader function
 * @param context - Loader context
 * @param options - Integration options
 * @returns Promise resolving to loader data
 *
 * @example
 * ```typescript
 * <Link
 *   href="/users/123"
 *   onMouseEnter={() => {
 *     prefetchLoader(userLoader, {
 *       params: { id: '123' },
 *       request: new Request('/users/123')
 *     });
 *   }}
 * >
 *   View User
 * </Link>
 * ```
 */
export async function prefetchLoader(
  loader: RouteLoader,
  context: Partial<LoaderContext>,
  options: LoaderIntegrationOptions = {}
): Promise<any> {
  const fullContext: LoaderContext = {
    params: context.params ?? {},
    request: context.request,
    url: context.url ?? new URL('/', window.location.origin),
  };

  // Use cached loader if caching is enabled
  if (options.cache) {
    const cachedLoader = withLoaderCache(loader, options);
    return executeLoader(cachedLoader, fullContext);
  }

  // Execute without caching
  return executeLoader(loader, fullContext);
}

/**
 * Invalidate loader cache for a route
 *
 * @param path - Route path or pattern
 * @returns Number of cache entries invalidated
 *
 * @example
 * ```typescript
 * // Invalidate specific route
 * invalidateLoaderCache('/users/123');
 *
 * // Invalidate all user routes
 * invalidateLoaderCache(/^\/users\//);
 * ```
 */
export function invalidateLoaderCache(path: string | RegExp): number {
  const cacheManager = getCacheManager();

  if (typeof path === 'string') {
    // Normalize path to full URL to match cache key generation
    // If path is already a full URL, use it; otherwise construct one
    let fullUrl: string;
    try {
      // Try parsing as URL - if it works, it's already a full URL
      new URL(path);
      fullUrl = path;
    } catch {
      // Not a full URL, construct one with current location as base (browser)
      // or a default base (server/tests)
      const base =
        typeof window !== 'undefined' && window.location
          ? window.location.origin
          : 'http://localhost';
      fullUrl = new URL(path, base).toString();
    }

    const cacheKey = generateCacheKey('loader', [fullUrl]);
    return cacheManager.delete(cacheKey) ? 1 : 0;
  }

  return cacheManager.invalidate((key) => {
    // Extract path from cache key
    const match = key.match(/^loader:(.+)$/);
    if (match && match[1]) {
      const keyPath = match[1];
      try {
        return path.test(keyPath);
      } catch {
        return false;
      }
    }
    return false;
  });
}

/**
 * Preload multiple loaders in parallel
 *
 * @param loaders - Array of loader/context pairs
 * @param options - Shared integration options
 * @returns Promise resolving to array of results
 *
 * @example
 * ```typescript
 * await preloadLoaders([
 *   { loader: userLoader, context: { params: { id: '123' } } },
 *   { loader: postsLoader, context: { params: { userId: '123' } } }
 * ]);
 * ```
 */
export async function preloadLoaders(
  loaders: Array<{ loader: RouteLoader; context: Partial<LoaderContext> }>,
  options: LoaderIntegrationOptions = {}
): Promise<any[]> {
  return Promise.all(
    loaders.map(({ loader, context }) => prefetchLoader(loader, context, options))
  );
}

/**
 * Create an SSR-aware loader
 *
 * Wraps a loader to handle SSR data hydration automatically.
 *
 * @param loader - Route loader function
 * @param options - Integration options
 * @returns SSR-aware loader
 *
 * @example
 * ```typescript
 * export const loader = withSSR(
 *   async ({ params }) => {
 *     return await fetchUser(params.id);
 *   },
 *   {
 *     ssr: {
 *       enabled: true,
 *       serialize: true
 *     }
 *   }
 * );
 * ```
 */
export function withSSR(
  loader: RouteLoader,
  options: LoaderIntegrationOptions = {}
): RouteLoader {
  const { ssr } = options;

  if (!ssr?.enabled) {
    return loader;
  }

  return async (context: LoaderContext): Promise<any> => {
    // Check if we're on the server
    const isServer = typeof window === 'undefined';

    if (isServer) {
      // On server: execute loader and optionally serialize
      const result = await executeLoader(loader, context);

      if (ssr.serialize && context.request) {
        // Store in global for hydration
        if (typeof global !== 'undefined') {
          (global as any).__AETHER_SSR_DATA__ = (global as any).__AETHER_SSR_DATA__ || {};
          (global as any).__AETHER_SSR_DATA__[context.request.url] = result;
        }
      }

      return result;
    }

    // On client: try to use hydrated data first
    if (ssr.serialize && typeof window !== 'undefined' && context.request) {
      const ssrData = (window as any).__AETHER_SSR_DATA__;
      const requestUrl = context.request.url;
      if (ssrData && requestUrl in ssrData) {
        const hydrated = ssrData[requestUrl];
        // Clean up to save memory
        delete ssrData[requestUrl];
        return hydrated;
      }
    }

    // No hydrated data available, execute loader
    return executeLoader(loader, context);
  };
}

/**
 * Create a streaming loader
 *
 * Wraps a loader to support streaming data in chunks.
 *
 * @param loader - Route loader function
 * @param options - Integration options with streaming config
 * @returns Streaming loader
 *
 * @example
 * ```typescript
 * export const loader = withStreaming(
 *   async ({ params }) => {
 *     // Return async generator for streaming
 *     async function* streamPosts() {
 *       for (let i = 0; i < 10; i++) {
 *         yield await fetchPostPage(i);
 *       }
 *     }
 *     return streamPosts();
 *   },
 *   {
 *     streaming: {
 *       enabled: true,
 *       chunkSize: 10
 *     }
 *   }
 * );
 * ```
 */
export function withStreaming(
  loader: RouteLoader,
  options: LoaderIntegrationOptions = {}
): RouteLoader {
  const { streaming } = options;

  if (!streaming?.enabled) {
    return loader;
  }

  return async (context: LoaderContext): Promise<any> => {
    const result = await executeLoader(loader, context);

    // Check if result is an async generator
    if (
      result &&
      typeof result === 'object' &&
      Symbol.asyncIterator in result
    ) {
      // Return streaming result as-is
      return result;
    }

    // Not a streaming result, return normally
    return result;
  };
}

/**
 * Combine multiple loader integration strategies
 *
 * @param loader - Route loader function
 * @param options - Integration options
 * @returns Enhanced loader with all strategies applied
 *
 * @example
 * ```typescript
 * export const loader = enhanceLoader(
 *   async ({ params }) => fetchUser(params.id),
 *   {
 *     cache: { ttl: 60000, staleWhileRevalidate: true },
 *     ssr: { enabled: true, serialize: true },
 *     streaming: { enabled: false }
 *   }
 * );
 * ```
 */
export function enhanceLoader(
  loader: RouteLoader,
  options: LoaderIntegrationOptions = {}
): RouteLoader {
  let enhanced = loader;

  // Apply strategies in order
  if (options.ssr?.enabled) {
    enhanced = withSSR(enhanced, options);
  }

  if (options.streaming?.enabled) {
    enhanced = withStreaming(enhanced, options);
  }

  if (options.cache) {
    enhanced = withLoaderCache(enhanced, options);
  }

  return enhanced;
}
