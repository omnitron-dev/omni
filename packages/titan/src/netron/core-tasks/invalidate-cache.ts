/**
 * Invalidate Cache core-task for Netron
 * Clears cached service definitions with optional pattern matching
 */

import type { RemotePeer } from '../remote-peer.js';

/**
 * Invalidate cached service definitions
 *
 * This core-task:
 * 1. Clears cached service definitions from the peer
 * 2. Supports wildcard pattern matching (e.g., "user*" matches "userService", "userAuth")
 * 3. Returns the count of invalidated entries
 *
 * @param peer - The remote peer whose cache should be invalidated
 * @param pattern - Service name pattern (supports * wildcard). If not provided, clears all cache.
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
 * // Clear all cached definitions
 * const count = await peer.runTask('invalidate_cache');
 */
export async function invalidate_cache(
  peer: RemotePeer,
  pattern?: string,
): Promise<number> {
  let invalidatedCount = 0;

  // If no pattern provided (undefined), clear all cached definitions
  if (pattern === undefined) {
    invalidatedCount = peer.services.size;
    peer.services.clear();

    peer.logger.info(
      { count: invalidatedCount },
      'All cached service definitions invalidated',
    );

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

  peer.logger.info(
    {
      pattern,
      count: invalidatedCount,
      services: servicesToInvalidate,
    },
    'Cached service definitions invalidated',
  );

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
