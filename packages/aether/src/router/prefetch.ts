/**
 * Route Prefetching
 *
 * Utilities for prefetching route loaders
 */

import { executeLoader, setLoaderData } from './data.js';
import type { Router } from './types.js';

/**
 * Cache of prefetched routes to avoid duplicate fetches
 */
const prefetchCache = new Set<string>();

/**
 * Prefetch a route's data
 *
 * Executes the route's loader and caches the result.
 * Subsequent calls for the same path will be ignored unless force is true.
 *
 * @param router - Router instance
 * @param path - Path to prefetch
 * @param options - Prefetch options
 *
 * @example
 * ```typescript
 * // Prefetch on hover
 * <Link href="/users/123" prefetch="hover" />
 *
 * // Prefetch immediately
 * <Link href="/blog" prefetch="render" />
 *
 * // Manual prefetch
 * await prefetchRoute(router, '/about');
 * ```
 */
export async function prefetchRoute(router: Router, path: string, options: { force?: boolean } = {}): Promise<void> {
  const { force = false } = options;

  // Skip if already prefetched (unless forced)
  if (!force && prefetchCache.has(path)) {
    return;
  }

  // Find matching route
  const match = router.match(path);
  if (!match || !match.route.loader) {
    return; // No loader to prefetch
  }

  try {
    // Mark as prefetched
    prefetchCache.add(path);

    // Execute loader
    const url = new URL(path, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    const loaderData = await executeLoader(match.route.loader, {
      params: match.params,
      url,
      request: typeof window !== 'undefined' ? new Request(url.href) : undefined,
    });

    // Store prefetched data
    setLoaderData(path, loaderData);
  } catch (error) {
    // Remove from cache on error so it can be retried
    prefetchCache.delete(path);
    console.warn(`Prefetch failed for ${path}:`, error);
  }
}

/**
 * Clear prefetch cache for a specific path or all paths
 *
 * @param path - Optional path to clear. If not provided, clears entire cache
 */
export function clearPrefetchCache(path?: string): void {
  if (path) {
    prefetchCache.delete(path);
  } else {
    prefetchCache.clear();
  }
}

/**
 * Check if a path has been prefetched
 *
 * @param path - Path to check
 * @returns True if path has been prefetched
 */
export function isPrefetched(path: string): boolean {
  return prefetchCache.has(path);
}
