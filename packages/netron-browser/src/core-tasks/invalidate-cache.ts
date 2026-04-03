/**
 * Invalidate Cache core-task for Netron Browser Client
 *
 * Provides cache invalidation coordination between client and server.
 * Supports pattern matching for selective cache invalidation.
 *
 * Adapted from Titan's invalidate_cache task for client-side use with both
 * HTTP cache and service definition cache.
 */

/**
 * Cache invalidation request payload
 */
export interface InvalidateCacheRequest {
  /**
   * Service name pattern (supports * wildcard).
   * If not provided, clears all cache.
   *
   * Examples:
   * - "UserService@1.0.0" - Exact service name
   * - "User*" - All services starting with "User"
   * - "*@1.0.0" - All services at version 1.0.0
   * - undefined - Clear all cache
   */
  pattern?: string;

  /**
   * Cache types to invalidate
   * - 'service': Service definitions cache (default)
   * - 'http': HTTP response cache
   * - 'all': Both service and HTTP cache
   */
  cacheType?: 'service' | 'http' | 'all';
}

/**
 * Cache invalidation response
 */
export interface InvalidateCacheResponse {
  /**
   * Number of cache entries invalidated
   */
  count: number;

  /**
   * Breakdown of invalidated entries by type
   */
  breakdown?: {
    service?: number;
    http?: number;
  };
}

/**
 * Core task name for cache invalidation
 */
export const CORE_TASK_INVALIDATE_CACHE = 'netron.invalidate_cache';

/**
 * Create an invalidate cache request
 *
 * @param pattern - Service name pattern (supports * wildcard)
 * @param cacheType - Cache type to invalidate (default: 'all')
 * @returns Cache invalidation request
 *
 * @example
 * // Clear all cache
 * createInvalidateCacheRequest()
 *
 * @example
 * // Clear specific service
 * createInvalidateCacheRequest('UserService@1.0.0')
 *
 * @example
 * // Clear all services starting with "User"
 * createInvalidateCacheRequest('User*')
 *
 * @example
 * // Clear only HTTP cache
 * createInvalidateCacheRequest(undefined, 'http')
 */
export function createInvalidateCacheRequest(
  pattern?: string,
  cacheType: 'service' | 'http' | 'all' = 'all'
): InvalidateCacheRequest {
  return { pattern, cacheType };
}

/**
 * Validate invalidate cache response
 */
export function isInvalidateCacheResponse(obj: any): obj is InvalidateCacheResponse {
  return (
    obj !== null && obj !== undefined && typeof obj === 'object' && 'count' in obj && typeof obj.count === 'number'
  );
}

/**
 * Pattern matching helper for cache invalidation
 * Supports wildcards (* for any characters)
 *
 * @param name - Actual service name or cache key
 * @param pattern - Pattern to match (supports *)
 * @returns True if matches
 *
 * @internal
 */
export function matchesPattern(name: string, pattern: string): boolean {
  // Exact match
  if (name === pattern) {
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
  return regex.test(name);
}
