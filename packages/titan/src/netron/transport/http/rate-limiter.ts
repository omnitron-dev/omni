import type { RateLimitResult } from '../request-limiter.js';

// Retain the original public HTTP class name for existing consumers.
export { TransportRequestLimiter as SlidingWindowRateLimiter, type RateLimitResult } from '../request-limiter.js';

/**
 * Create rate limit headers for a response
 */
export function createRateLimitHeaders(result: RateLimitResult): Headers {
  const headers = new Headers();

  headers.set('X-RateLimit-Limit', String(result.limit));
  headers.set('X-RateLimit-Remaining', String(result.remaining));
  headers.set('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

  if (!result.allowed && result.retryAfter !== undefined) {
    headers.set('Retry-After', String(result.retryAfter));
  }

  return headers;
}
