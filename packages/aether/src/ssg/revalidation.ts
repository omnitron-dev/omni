/**
 * ISR Revalidation System
 *
 * Incremental Static Regeneration with time-based and on-demand revalidation
 */

import type { RevalidationCacheEntry, RevalidationOptions, GeneratedPage } from './types.js';

/**
 * Revalidation cache
 *
 * Stores generated pages with revalidation metadata
 */
export class RevalidationCache {
  private cache = new Map<string, RevalidationCacheEntry>();
  private tagIndex = new Map<string, Set<string>>();
  private revalidatingPaths = new Set<string>();

  /**
   * Set cache entry
   *
   * @param path - Page path
   * @param entry - Cache entry
   */
  set(path: string, entry: RevalidationCacheEntry): void {
    this.cache.set(path, entry);

    // Index by tags
    if (entry.tags) {
      for (const tag of entry.tags) {
        if (!this.tagIndex.has(tag)) {
          this.tagIndex.set(tag, new Set());
        }
        this.tagIndex.get(tag)!.add(path);
      }
    }
  }

  /**
   * Get cache entry
   *
   * @param path - Page path
   * @returns Cache entry or undefined
   */
  get(path: string): RevalidationCacheEntry | undefined {
    return this.cache.get(path);
  }

  /**
   * Check if entry exists
   *
   * @param path - Page path
   * @returns True if entry exists
   */
  has(path: string): boolean {
    return this.cache.has(path);
  }

  /**
   * Delete cache entry
   *
   * @param path - Page path
   */
  delete(path: string): void {
    const entry = this.cache.get(path);
    if (entry?.tags) {
      for (const tag of entry.tags) {
        this.tagIndex.get(tag)?.delete(path);
      }
    }
    this.cache.delete(path);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.tagIndex.clear();
    this.revalidatingPaths.clear();
  }

  /**
   * Get paths by tag
   *
   * @param tag - Tag to search for
   * @returns Set of paths with this tag
   */
  getPathsByTag(tag: string): Set<string> {
    return this.tagIndex.get(tag) || new Set();
  }

  /**
   * Check if path is currently revalidating
   *
   * @param path - Page path
   * @returns True if revalidating
   */
  isRevalidating(path: string): boolean {
    return this.revalidatingPaths.has(path);
  }

  /**
   * Mark path as revalidating
   *
   * @param path - Page path
   */
  markRevalidating(path: string): void {
    this.revalidatingPaths.add(path);
  }

  /**
   * Unmark path as revalidating
   *
   * @param path - Page path
   */
  unmarkRevalidating(path: string): void {
    this.revalidatingPaths.delete(path);
  }

  /**
   * Get all cached paths
   *
   * @returns Array of all paths
   */
  getAllPaths(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache size
   *
   * @returns Number of cached entries
   */
  size(): number {
    return this.cache.size;
  }
}

/**
 * Global revalidation cache instance
 */
const globalCache = new RevalidationCache();

/**
 * Get global revalidation cache
 *
 * @returns Revalidation cache instance
 */
export function getRevalidationCache(): RevalidationCache {
  return globalCache;
}

/**
 * Check if page needs revalidation
 *
 * @param entry - Cache entry
 * @returns True if page needs revalidation
 */
export function needsRevalidation(entry: RevalidationCacheEntry): boolean {
  // No revalidation configured
  if (entry.revalidate === false || entry.revalidate === undefined) {
    return false;
  }

  const now = Date.now();
  const generatedAt = entry.generatedAt.getTime();
  const age = (now - generatedAt) / 1000; // age in seconds

  return age >= entry.revalidate;
}

/**
 * Check if page is stale but can serve
 *
 * @param entry - Cache entry
 * @returns True if stale but can serve (stale-while-revalidate)
 */
export function isStale(entry: RevalidationCacheEntry): boolean {
  if (!entry.staleWhileRevalidate) {
    return false;
  }

  const now = Date.now();
  const generatedAt = entry.generatedAt.getTime();
  const age = (now - generatedAt) / 1000; // age in seconds

  // If has revalidate time, check if we're in stale window
  if (entry.revalidate) {
    return age >= entry.revalidate && age < entry.revalidate + entry.staleWhileRevalidate;
  }

  // No revalidate time, check against staleWhileRevalidate
  return age < entry.staleWhileRevalidate;
}

/**
 * Check if page is expired and cannot serve
 *
 * @param entry - Cache entry
 * @returns True if page is expired
 */
export function isExpired(entry: RevalidationCacheEntry): boolean {
  if (typeof entry.revalidate !== 'number') {
    return false;
  }

  const now = Date.now();
  const generatedAt = entry.generatedAt.getTime();
  const age = (now - generatedAt) / 1000;

  // If has staleWhileRevalidate, check if beyond that window
  if (entry.staleWhileRevalidate) {
    return age >= entry.revalidate + entry.staleWhileRevalidate;
  }

  // No staleWhileRevalidate, expired if past revalidate time
  return age >= entry.revalidate;
}

/**
 * Revalidate path
 *
 * Regenerates the page for the given path
 *
 * @param path - Path to revalidate
 * @param regenerate - Function to regenerate the page
 * @returns Promise that resolves when revalidation is complete
 */
export async function revalidatePath(path: string, regenerate: () => Promise<GeneratedPage>): Promise<void> {
  const cache = getRevalidationCache();

  // Prevent concurrent revalidation of same path
  if (cache.isRevalidating(path)) {
    return;
  }

  try {
    cache.markRevalidating(path);

    // Regenerate the page
    const page = await regenerate();

    // Update cache
    cache.set(path, {
      path: page.path,
      props: page.props,
      html: page.html,
      generatedAt: page.generatedAt,
      revalidate: page.revalidate,
      staleWhileRevalidate: page.staleWhileRevalidate,
      tags: page.tags,
    });
  } finally {
    cache.unmarkRevalidating(path);
  }
}

/**
 * Revalidate by tag
 *
 * Regenerates all pages with the given tag
 *
 * @param tag - Tag to revalidate
 * @param regenerate - Function to regenerate a page
 * @returns Promise that resolves when all revalidations are complete
 */
export async function revalidateTag(tag: string, regenerate: (path: string) => Promise<GeneratedPage>): Promise<void> {
  const cache = getRevalidationCache();
  const paths = cache.getPathsByTag(tag);

  // Revalidate all paths with this tag in parallel
  await Promise.all(
    Array.from(paths).map(async (path) => {
      await revalidatePath(path, () => regenerate(path));
    })
  );
}

/**
 * Background revalidation
 *
 * Revalidates a path in the background without blocking the request
 *
 * @param path - Path to revalidate
 * @param regenerate - Function to regenerate the page
 */
export function revalidateInBackground(path: string, regenerate: () => Promise<GeneratedPage>): void {
  // Don't await - let it run in background
  revalidatePath(path, regenerate).catch((error) => {
    console.error(`Background revalidation failed for ${path}:`, error);
  });
}

/**
 * Create revalidation handler
 *
 * Creates an HTTP handler for on-demand revalidation
 *
 * @param options - Revalidation options
 * @param regenerate - Function to regenerate a page
 * @returns Request handler
 */
export function createRevalidationHandler(
  options: {
    secret?: string;
  },
  regenerate: (path: string) => Promise<GeneratedPage>
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    try {
      // Parse request body
      const body = await request.json();
      const { secret, path, tag } = body as RevalidationOptions;

      // Verify secret if configured
      if (options.secret && secret !== options.secret) {
        return new Response('Invalid secret', { status: 401 });
      }

      // Revalidate by path
      if (path) {
        await revalidatePath(path, () => regenerate(path));
        return new Response(JSON.stringify({ revalidated: true, path }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Revalidate by tag
      if (tag) {
        await revalidateTag(tag, regenerate);
        return new Response(JSON.stringify({ revalidated: true, tag }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Missing path or tag', { status: 400 });
    } catch (error) {
      console.error('Revalidation error:', error);
      return new Response('Internal server error', { status: 500 });
    }
  };
}

/**
 * Cleanup expired entries
 *
 * Removes expired entries from the cache
 *
 * @param maxAge - Maximum age in seconds (optional)
 */
export function cleanupExpiredEntries(maxAge?: number): void {
  const cache = getRevalidationCache();
  const now = Date.now();

  for (const path of cache.getAllPaths()) {
    const entry = cache.get(path);
    if (!entry) continue;

    // Check if expired
    if (isExpired(entry)) {
      cache.delete(path);
      continue;
    }

    // Check against max age if provided
    if (maxAge) {
      const age = (now - entry.generatedAt.getTime()) / 1000;
      if (age > maxAge) {
        cache.delete(path);
      }
    }
  }
}

/**
 * Schedule periodic cleanup
 *
 * Runs cleanup on an interval
 *
 * @param interval - Cleanup interval in milliseconds
 * @param maxAge - Maximum age in seconds
 * @returns Cleanup timer
 */
export function scheduleCleanup(interval: number, maxAge?: number): NodeJS.Timeout {
  return setInterval(() => {
    cleanupExpiredEntries(maxAge);
  }, interval);
}

/**
 * Get cache statistics
 *
 * @returns Cache statistics
 */
export function getCacheStats(): {
  totalEntries: number;
  needsRevalidation: number;
  stale: number;
  expired: number;
  revalidating: number;
  tags: number;
} {
  const cache = getRevalidationCache();
  let needsRevalidationCount = 0;
  let staleCount = 0;
  let expiredCount = 0;

  for (const path of cache.getAllPaths()) {
    const entry = cache.get(path);
    if (!entry) continue;

    if (isExpired(entry)) {
      expiredCount++;
    } else if (needsRevalidation(entry)) {
      needsRevalidationCount++;
    } else if (isStale(entry)) {
      staleCount++;
    }
  }

  return {
    totalEntries: cache.size(),
    needsRevalidation: needsRevalidationCount,
    stale: staleCount,
    expired: expiredCount,
    revalidating: Array.from(cache['revalidatingPaths']).length,
    tags: cache['tagIndex'].size,
  };
}

/**
 * Preload cache from disk
 *
 * Loads generated pages into the cache
 *
 * @param pages - Generated pages to load
 */
export function preloadCache(pages: GeneratedPage[]): void {
  const cache = getRevalidationCache();

  for (const page of pages) {
    cache.set(page.path, {
      path: page.path,
      props: page.props,
      html: page.html,
      generatedAt: page.generatedAt,
      revalidate: page.revalidate,
      staleWhileRevalidate: page.staleWhileRevalidate,
      tags: page.tags,
    });
  }
}

/**
 * Export cache to JSON
 *
 * Serializes cache for persistence
 *
 * @returns Serializable cache data
 */
export function exportCache(): Array<RevalidationCacheEntry & { path: string }> {
  const cache = getRevalidationCache();
  const entries: Array<RevalidationCacheEntry & { path: string }> = [];

  for (const path of cache.getAllPaths()) {
    const entry = cache.get(path);
    if (entry) {
      entries.push({ ...entry, path });
    }
  }

  return entries;
}

/**
 * Import cache from JSON
 *
 * Loads cache from serialized data
 *
 * @param data - Serialized cache data
 */
export function importCache(data: Array<RevalidationCacheEntry & { path: string }>): void {
  const cache = getRevalidationCache();

  for (const entry of data) {
    // Convert date string back to Date object
    const entryWithDate = {
      ...entry,
      generatedAt: new Date(entry.generatedAt),
    };
    cache.set(entry.path, entryWithDate);
  }
}
