/**
 * Invalidate Cache core-task for Netron
 *
 * Clears both service definitions and HTTP response cache with optional pattern matching.
 */

import type { RemotePeer } from '../remote-peer.js';

/**
 * Cache invalidation options
 */
export interface InvalidateCacheOptions {
  /** Pattern for service/key names (supports * wildcard). If not provided, clears all. */
  pattern?: string;
  /** If true, only invalidate service definitions (skip HTTP cache) */
  servicesOnly?: boolean;
  /** If true, only invalidate HTTP response cache (skip service definitions) */
  httpOnly?: boolean;
  /** Tags to invalidate in HTTP cache */
  tags?: string[];
}

/**
 * Invalidate cached service definitions and HTTP response cache
 *
 * This core-task:
 * 1. Clears cached service definitions from the peer
 * 2. Clears HTTP response cache (if HttpTransportPeer with cache manager)
 * 3. Supports wildcard pattern matching (e.g., "user*" matches "userService", "userAuth")
 * 4. Supports tag-based invalidation for HTTP cache
 * 5. Returns the count of invalidated entries
 *
 * @param peer - The remote peer whose cache should be invalidated
 * @param patternOrOptions - Service name pattern or options object
 * @returns Number of cache entries invalidated
 *
 * @example
 * // Clear specific service cache
 * const count = await peer.runTask('invalidate_cache', 'userService@1.0.0');
 *
 * @example
 * // Clear all services starting with "user"
 * const count = await peer.runTask('invalidate_cache', 'user*');
 *
 * @example
 * // Clear all cached definitions and HTTP cache
 * const count = await peer.runTask('invalidate_cache');
 *
 * @example
 * // Clear only HTTP cache by tags
 * const count = await peer.runTask('invalidate_cache', { httpOnly: true, tags: ['users'] });
 */
export async function invalidate_cache(
  peer: RemotePeer,
  patternOrOptions?: string | InvalidateCacheOptions
): Promise<number> {
  // Normalize options
  const options: InvalidateCacheOptions =
    typeof patternOrOptions === 'string' ? { pattern: patternOrOptions } : (patternOrOptions ?? {});

  const { pattern, servicesOnly = false, httpOnly = false, tags } = options;
  let invalidatedCount = 0;

  // Invalidate service definitions (unless httpOnly is true)
  if (!httpOnly) {
    invalidatedCount += invalidateServiceDefinitions(peer, pattern);
  }

  // Invalidate HTTP response cache (unless servicesOnly is true)
  if (!servicesOnly) {
    invalidatedCount += await invalidateHttpCache(peer, pattern, tags);
  }

  return invalidatedCount;
}

/**
 * Invalidate service definitions cache
 */
function invalidateServiceDefinitions(peer: RemotePeer, pattern?: string): number {
  let invalidatedCount = 0;

  // If no pattern provided, clear all cached definitions
  if (pattern === undefined) {
    invalidatedCount = peer.services.size;
    peer.services.clear();

    peer.logger.info({ count: invalidatedCount }, 'All cached service definitions invalidated');
    return invalidatedCount;
  }

  // Pattern matching - find services to invalidate
  const servicesToInvalidate: string[] = [];

  for (const serviceName of peer.services.keys()) {
    if (matchesPattern(serviceName, pattern)) {
      servicesToInvalidate.push(serviceName);
    }
  }

  // Delete matched services
  for (const serviceName of servicesToInvalidate) {
    peer.services.delete(serviceName);
    invalidatedCount++;
  }

  if (invalidatedCount > 0) {
    peer.logger.info(
      {
        pattern,
        count: invalidatedCount,
        services: servicesToInvalidate,
      },
      'Cached service definitions invalidated'
    );
  }

  return invalidatedCount;
}

/**
 * Invalidate HTTP response cache (for HttpTransportPeer)
 */
async function invalidateHttpCache(peer: RemotePeer, pattern?: string, tags?: string[]): Promise<number> {
  // Check if peer has HTTP cache manager
  const peerWithCache = peer as {
    getCacheManager?: () =>
      | { invalidate?: (pattern?: string) => number; invalidateByTags?: (tags: string[]) => number }
      | undefined;
  };

  if (typeof peerWithCache.getCacheManager !== 'function') {
    return 0;
  }

  const cacheManager = peerWithCache.getCacheManager();
  if (!cacheManager) {
    return 0;
  }

  let invalidatedCount = 0;

  // Tag-based invalidation
  if (tags && tags.length > 0 && typeof cacheManager.invalidateByTags === 'function') {
    invalidatedCount += cacheManager.invalidateByTags(tags);
    peer.logger.info({ tags, count: invalidatedCount }, 'HTTP cache invalidated by tags');
  }

  // Pattern-based invalidation
  if (typeof cacheManager.invalidate === 'function') {
    const count = cacheManager.invalidate(pattern);
    invalidatedCount += count;

    if (count > 0) {
      peer.logger.info({ pattern, count }, 'HTTP response cache invalidated');
    }
  }

  return invalidatedCount;
}

/**
 * Check if service name matches the pattern
 * Supports wildcards (* for any characters)
 *
 * @param serviceName - Actual service name
 * @param pattern - Pattern to match (supports *)
 * @returns True if matches
 *
 * @internal
 */
function matchesPattern(serviceName: string, pattern: string): boolean {
  // Exact match
  if (serviceName === pattern) {
    return true;
  }

  // No wildcards - no match
  if (!pattern.includes('*')) {
    return false;
  }

  // Convert pattern to regex
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
    .replace(/\*/g, '.*'); // Replace * with .*

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(serviceName);
}
