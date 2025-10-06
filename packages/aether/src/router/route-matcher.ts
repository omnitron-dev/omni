/**
 * Router - Route Matching Algorithm
 *
 * Matches URL paths against route patterns with support for:
 * - Static routes: /about
 * - Dynamic routes: /users/[id]
 * - Catch-all routes: /docs/[...path]
 * - Optional parameters: /blog/[[page]]
 * - Optional catch-all: /shop/[[...categories]]
 */

import type { RouteDefinition, RouteMatch, RouteParams, RouteSegment } from './types.js';

/**
 * Parse route pattern into segments
 *
 * @example
 * parseRoutePattern('/users/[id]')
 * // => [
 * //   { type: 'static', value: 'users' },
 * //   { type: 'dynamic', name: 'id' }
 * // ]
 */
export function parseRoutePattern(pattern: string): RouteSegment[] {
  // Remove leading/trailing slashes and split
  const parts = pattern.replace(/^\/|\/$/g, '').split('/');

  return parts.map(part => {
    // Optional catch-all: [[...rest]]
    if (/^\[\[\.\.\.(.+)\]\]$/.test(part)) {
      const name = part.match(/^\[\[\.\.\.(.+)\]\]$/)?.[1];
      return { type: 'optional-catchall', name };
    }

    // Catch-all: [...rest]
    if (/^\[\.\.\.(.+)\]$/.test(part)) {
      const name = part.match(/^\[\.\.\.(.+)\]$/)?.[1];
      return { type: 'catchall', name };
    }

    // Optional param: [[param]]
    if (/^\[\[(.+)\]\]$/.test(part)) {
      const name = part.match(/^\[\[(.+)\]\]$/)?.[1];
      return { type: 'optional-param', name };
    }

    // Dynamic param: [param]
    if (/^\[(.+)\]$/.test(part)) {
      const name = part.match(/^\[(.+)\]$/)?.[1];
      return { type: 'dynamic', name };
    }

    // Static segment
    return { type: 'static', value: part };
  });
}

/**
 * Match pathname against route pattern
 *
 * @returns Match result with params, or null if no match
 */
export function matchRoute(
  pathname: string,
  route: RouteDefinition
): RouteMatch | null {
  const segments = parseRoutePattern(route.path);
  const pathParts = pathname.replace(/^\/|\/$/g, '').split('/').filter(Boolean);

  const params: RouteParams = {};
  let score = 0;
  let segmentIndex = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue; // Type guard

    if (segment.type === 'static') {
      // Static segment must match exactly
      if (pathParts[segmentIndex] !== segment.value) {
        return null;
      }
      segmentIndex++;
      score += 10; // Static segments have highest priority
    } else if (segment.type === 'dynamic') {
      // Dynamic segment matches any single part
      if (segmentIndex >= pathParts.length) {
        return null;
      }
      const part = pathParts[segmentIndex];
      if (segment.name && part !== undefined) {
        params[segment.name] = part;
      }
      segmentIndex++;
      score += 5; // Dynamic segments have medium priority
    } else if (segment.type === 'optional-param') {
      // Optional param matches zero or one part
      if (segmentIndex < pathParts.length) {
        const part = pathParts[segmentIndex];
        if (segment.name && part !== undefined) {
          params[segment.name] = part;
        }
        segmentIndex++;
      }
      score += 3; // Optional params have lower priority
    } else if (segment.type === 'catchall') {
      // Catch-all matches remaining parts (must have at least one)
      if (segmentIndex >= pathParts.length) {
        return null;
      }
      if (segment.name) {
        params[segment.name] = pathParts.slice(segmentIndex);
      }
      segmentIndex = pathParts.length;
      score += 1; // Catch-all has lowest priority
    } else if (segment.type === 'optional-catchall') {
      // Optional catch-all matches zero or more remaining parts
      if (segmentIndex < pathParts.length) {
        if (segment.name) {
          params[segment.name] = pathParts.slice(segmentIndex);
        }
        segmentIndex = pathParts.length;
      }
      score += 1;
    }
  }

  // All path parts must be consumed
  if (segmentIndex !== pathParts.length) {
    return null;
  }

  return {
    route,
    params,
    path: pathname,
    score,
  };
}

/**
 * Find best matching route from a list of routes
 *
 * Routes are sorted by score (higher is better)
 */
export function findBestMatch(
  pathname: string,
  routes: RouteDefinition[]
): RouteMatch | null {
  const matches: RouteMatch[] = [];

  for (const route of routes) {
    const match = matchRoute(pathname, route);
    if (match) {
      matches.push(match);
    }
  }

  if (matches.length === 0) {
    return null;
  }

  // Sort by score (highest first)
  matches.sort((a, b) => b.score - a.score);

  return matches[0] ?? null;
}

/**
 * Build pathname from route pattern and params
 *
 * @example
 * buildPath('/users/[id]', { id: '123' })
 * // => '/users/123'
 */
export function buildPath(pattern: string, params: RouteParams = {}): string {
  const segments = parseRoutePattern(pattern);

  const parts = segments.map(segment => {
    if (segment.type === 'static') {
      return segment.value;
    }

    if (segment.type === 'dynamic') {
      const value = params[segment.name!];
      if (value === undefined) {
        throw new Error(`Missing parameter: ${segment.name}`);
      }
      return String(value);
    }

    if (segment.type === 'optional-param') {
      const value = params[segment.name!];
      return value !== undefined ? String(value) : null;
    }

    if (segment.type === 'catchall' || segment.type === 'optional-catchall') {
      const value = params[segment.name!];
      if (segment.type === 'catchall' && value === undefined) {
        throw new Error(`Missing catch-all parameter: ${segment.name}`);
      }
      if (Array.isArray(value)) {
        return value.join('/');
      }
      return value !== undefined ? String(value) : null;
    }

    return null;
  });

  // Filter out null parts (optional params that weren't provided)
  const filteredParts = parts.filter(p => p !== null);

  return '/' + filteredParts.join('/');
}

/**
 * Normalize pathname (remove trailing slash, handle empty path)
 */
export function normalizePath(pathname: string): string {
  // Remove trailing slash (except for root)
  pathname = pathname.replace(/\/$/, '');

  // Empty path becomes root
  if (pathname === '') {
    pathname = '/';
  }

  // Ensure leading slash
  if (!pathname.startsWith('/')) {
    pathname = '/' + pathname;
  }

  return pathname;
}
