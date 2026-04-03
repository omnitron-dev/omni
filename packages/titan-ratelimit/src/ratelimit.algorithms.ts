/**
 * Rate Limiting Algorithm Implementations
 * @module @omnitron-dev/titan/modules/ratelimit/algorithms
 *
 * Provides three pluggable rate limiting algorithms:
 * - SlidingWindowAlgorithm: True sliding window using sorted sets
 * - FixedWindowAlgorithm: Window-aligned counters with reset boundaries
 * - TokenBucketAlgorithm: Token refill with burst capacity
 *
 * All algorithms support burst limits and implement a common interface
 * for interchangeable use with different storage backends.
 */

import type { IRateLimitStorage, IRateLimitResult, RateLimitStrategy } from './ratelimit.types.js';

/**
 * Common interface for all rate limiting algorithms
 *
 * Each algorithm implements different strategies for tracking and limiting requests:
 * - check(): Validates if request is allowed (optionally consuming a token/slot)
 * - reset(): Clears all rate limit state for a key
 */
export interface IRateLimitAlgorithm {
  /**
   * Check if a request is allowed under the rate limit
   *
   * @param storage - Storage backend instance
   * @param key - Unique identifier for the rate limit (e.g., user ID, IP address)
   * @param limit - Maximum number of requests allowed
   * @param windowMs - Time window in milliseconds
   * @param consume - Whether to consume a token/slot if allowed (default: true)
   * @returns Rate limit result with allowed status, remaining count, and reset time
   */
  check(
    storage: IRateLimitStorage,
    key: string,
    limit: number,
    windowMs: number,
    consume: boolean
  ): Promise<IRateLimitResult>;

  /**
   * Reset rate limit state for a key
   *
   * Removes all tracking data for the specified key, effectively clearing
   * the rate limit counter/tokens.
   *
   * @param storage - Storage backend instance
   * @param key - Unique identifier to reset
   */
  reset(storage: IRateLimitStorage, key: string): Promise<void>;
}

/**
 * Sliding Window Rate Limiting Algorithm
 *
 * Implements a true sliding window using sorted sets with timestamps.
 * Each request is recorded with its timestamp, and the window slides
 * continuously over time.
 *
 * **Characteristics:**
 * - Most accurate rate limiting (no boundary effects)
 * - Higher memory usage (stores timestamp per request)
 * - Automatically cleans up expired entries
 * - Ideal for strict rate limiting requirements
 *
 * **Implementation:**
 * - Uses sorted set with timestamps as scores
 * - Removes entries older than windowStart
 * - Counts entries in current window
 * - Adds new entry with timestamp + random suffix for uniqueness
 *
 * @example
 * ```typescript
 * const algorithm = new SlidingWindowAlgorithm();
 * const result = await algorithm.check(storage, 'user:123', 100, 60000, true);
 * if (!result.allowed) {
 *   console.log(`Rate limited. Retry after ${result.retryAfter}ms`);
 * }
 * ```
 */
export class SlidingWindowAlgorithm implements IRateLimitAlgorithm {
  /**
   * Check if request is allowed under sliding window rate limit
   *
   * @param storage - Storage backend
   * @param key - Rate limit key (e.g., 'user:123')
   * @param limit - Maximum requests in window (burst limit added if needed externally)
   * @param windowMs - Time window in milliseconds
   * @param consume - Whether to consume a slot if allowed
   * @returns Rate limit result
   */
  async check(
    storage: IRateLimitStorage,
    key: string,
    limit: number,
    windowMs: number,
    consume: boolean
  ): Promise<IRateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const ttl = Math.ceil(windowMs / 1000) + 1;

    // Remove expired entries (older than windowStart)
    await storage.removeFromSortedSetByScore(key, -Infinity, windowStart);

    // Count current requests in window
    const currentCount = await storage.countSortedSet(key);

    // Check if under limit
    const allowed = currentCount < limit;

    // Add timestamp if consuming and allowed
    // Use timestamp + random suffix for uniqueness to handle concurrent requests
    if (consume && allowed) {
      const uniqueMember = `${now}-${Math.random().toString(36).substring(2, 9)}`;
      await storage.addToSortedSet(key, now, uniqueMember, ttl);
    }

    // Calculate remaining slots
    const remaining = Math.max(0, limit - (consume && allowed ? currentCount + 1 : currentCount));

    // Reset time is one full window from now
    const resetAt = now + windowMs;

    return {
      allowed,
      remaining,
      resetAt,
      retryAfter: allowed ? undefined : Math.ceil(windowMs / 1000),
      limit,
    };
  }

  /**
   * Reset sliding window state for a key
   *
   * @param storage - Storage backend
   * @param key - Rate limit key to reset
   */
  async reset(storage: IRateLimitStorage, key: string): Promise<void> {
    await storage.delete(key);
  }
}

/**
 * Fixed Window Rate Limiting Algorithm
 *
 * Implements fixed time windows aligned to boundaries.
 * Windows reset at predictable intervals (e.g., top of each minute).
 *
 * **Characteristics:**
 * - Lower memory footprint (single counter per window)
 * - Predictable reset times
 * - Potential for burst at window boundaries (2x limit in 2 seconds)
 * - Simple and fast
 * - Ideal for less strict rate limiting
 *
 * **Implementation:**
 * - Window ID = floor(timestamp / windowMs)
 * - Key includes window ID for automatic expiry
 * - Counter increments within window
 * - Resets at next window boundary
 *
 * **Edge Case:**
 * User can make `limit` requests at 59.9s and `limit` more at 60.1s,
 * effectively getting 2x limit in ~0.2 seconds.
 *
 * @example
 * ```typescript
 * const algorithm = new FixedWindowAlgorithm();
 * // 100 requests per minute, windows aligned to minute boundaries
 * const result = await algorithm.check(storage, 'api:key:abc', 100, 60000, true);
 * console.log(`Remaining: ${result.remaining}, Resets at: ${new Date(result.resetAt)}`);
 * ```
 */
export class FixedWindowAlgorithm implements IRateLimitAlgorithm {
  /**
   * Check if request is allowed under fixed window rate limit
   *
   * @param storage - Storage backend
   * @param key - Rate limit key (e.g., 'api:key:abc')
   * @param limit - Maximum requests in window (burst limit added if needed externally)
   * @param windowMs - Time window in milliseconds
   * @param consume - Whether to consume a slot if allowed
   * @returns Rate limit result
   */
  async check(
    storage: IRateLimitStorage,
    key: string,
    limit: number,
    windowMs: number,
    consume: boolean
  ): Promise<IRateLimitResult> {
    const now = Date.now();

    // Calculate current window ID (e.g., minute 0, minute 1, ...)
    const currentWindow = Math.floor(now / windowMs);
    const windowStart = currentWindow * windowMs;
    const windowEnd = windowStart + windowMs;
    const ttl = Math.ceil(windowMs / 1000) + 1;

    // Include window ID in key for automatic cleanup
    const windowKey = `${key}:${currentWindow}`;

    // Get current count for this window
    let currentCount = (await storage.get(windowKey)) ?? 0;

    // Check if under limit
    const allowed = currentCount < limit;

    // Increment if consuming and allowed
    if (consume && allowed) {
      currentCount = await storage.increment(windowKey, ttl);
    }

    // Calculate remaining slots
    const remaining = Math.max(0, limit - currentCount);

    return {
      allowed,
      remaining,
      resetAt: windowEnd,
      retryAfter: allowed ? undefined : Math.ceil((windowEnd - now) / 1000),
      limit,
    };
  }

  /**
   * Reset fixed window state for a key
   *
   * Note: This resets the current window. Previous/future windows
   * are unaffected and will expire naturally.
   *
   * @param storage - Storage backend
   * @param key - Rate limit key to reset (without window ID)
   */
  async reset(storage: IRateLimitStorage, key: string): Promise<void> {
    // Delete the base key - specific window keys will expire naturally
    await storage.delete(key);
  }
}

/**
 * Token Bucket Rate Limiting Algorithm
 *
 * Implements token bucket with continuous refill over time.
 * Tokens are added at a constant rate, and requests consume tokens.
 *
 * **Characteristics:**
 * - Smooth rate limiting (no hard window boundaries)
 * - Supports burst capacity (extra tokens above base limit)
 * - Tokens refill continuously, not in discrete windows
 * - Ideal for APIs with variable load patterns
 * - Good for preventing sustained abuse while allowing bursts
 *
 * **Implementation:**
 * - Stores: current tokens, last refill timestamp
 * - Tokens refill based on time elapsed since last refill
 * - Bucket capacity = limit (can include burst limit)
 * - Refill rate configurable (defaults to limit per window)
 *
 * **Example:**
 * - Limit: 100 tokens, Window: 60s, Refill: 100/60s
 * - Bucket starts full (100 tokens)
 * - User makes 50 requests → 50 tokens remain
 * - After 30s → 50 + (30/60 * 100) = 100 tokens (capped at limit)
 * - Burst limit of 20 → capacity becomes 120 tokens
 *
 * @example
 * ```typescript
 * const algorithm = new TokenBucketAlgorithm(100); // 100 tokens refill rate
 * // Check with burst support (limit=100, burst=20, window=60s)
 * const result = await algorithm.check(storage, 'user:456', 120, 60000, true);
 * console.log(`Tokens remaining: ${result.remaining}`);
 * ```
 */
export class TokenBucketAlgorithm implements IRateLimitAlgorithm {
  /**
   * Token refill rate (tokens added per windowMs)
   * If not specified in constructor, defaults to limit parameter in check()
   */
  private readonly refillRate?: number;

  /**
   * Create a token bucket algorithm instance
   *
   * @param refillRate - Optional: Tokens to refill per windowMs. If omitted, uses limit from check()
   */
  constructor(refillRate?: number) {
    this.refillRate = refillRate;
  }

  /**
   * Check if request is allowed under token bucket rate limit
   *
   * @param storage - Storage backend
   * @param key - Rate limit key (e.g., 'user:456')
   * @param limit - Bucket capacity (maxRequests + burstLimit)
   * @param windowMs - Time window in milliseconds (for refill rate calculation)
   * @param consume - Whether to consume a token if allowed
   * @returns Rate limit result
   */
  async check(
    storage: IRateLimitStorage,
    key: string,
    limit: number,
    windowMs: number,
    consume: boolean
  ): Promise<IRateLimitResult> {
    const now = Date.now();
    const refillRate = this.refillRate ?? limit;

    // Storage keys for bucket state
    const tokenKey = `${key}:tokens`;
    const lastRefillKey = `${key}:lastRefill`;

    // Get current bucket state (defaults: full bucket, refill time = now)
    const currentTokens = (await storage.get(tokenKey)) ?? limit;
    const lastRefill = (await storage.get(lastRefillKey)) ?? now;

    // Calculate tokens to add based on elapsed time
    const timePassed = now - lastRefill;
    const tokensToAdd = timePassed > 0 ? (timePassed / windowMs) * refillRate : 0;

    // Calculate available tokens (capped at bucket capacity)
    let availableTokens = Math.min(limit, currentTokens + tokensToAdd);

    // Check if we have at least 1 token available
    const allowed = availableTokens >= 1;

    // Consume token if requested and allowed
    if (consume && allowed) {
      availableTokens -= 1;
      await storage.set(tokenKey, availableTokens);
      await storage.set(lastRefillKey, now);
    }

    // Calculate when bucket will be full again
    const tokensNeeded = limit - availableTokens;
    const timeToRefill = tokensNeeded > 0 ? (tokensNeeded / refillRate) * windowMs : 0;
    const resetAt = now + timeToRefill;

    // Remaining tokens (floor to avoid fractional tokens)
    const remaining = Math.floor(
      consume && allowed ? availableTokens : allowed ? availableTokens - 1 : availableTokens
    );

    return {
      allowed,
      remaining,
      resetAt,
      retryAfter: allowed ? undefined : Math.ceil(timeToRefill / 1000),
      limit,
    };
  }

  /**
   * Reset token bucket state for a key
   *
   * Refills bucket to capacity and resets refill timestamp.
   *
   * @param storage - Storage backend
   * @param key - Rate limit key to reset
   */
  async reset(storage: IRateLimitStorage, key: string): Promise<void> {
    const tokenKey = `${key}:tokens`;
    const lastRefillKey = `${key}:lastRefill`;

    await storage.delete(tokenKey);
    await storage.delete(lastRefillKey);
  }
}

/**
 * Factory function to create rate limiting algorithm instances
 *
 * Provides a centralized way to instantiate algorithms based on strategy type.
 * Supports optional refill rate configuration for token bucket.
 *
 * @param strategy - Rate limiting strategy type
 * @param options - Optional configuration (e.g., refillRate for token-bucket)
 * @returns Algorithm instance implementing IRateLimitAlgorithm
 *
 * @example
 * ```typescript
 * // Create sliding window algorithm
 * const slidingWindow = createAlgorithm('sliding-window');
 *
 * // Create fixed window algorithm
 * const fixedWindow = createAlgorithm('fixed-window');
 *
 * // Create token bucket with custom refill rate
 * const tokenBucket = createAlgorithm('token-bucket', { refillRate: 50 });
 * ```
 */
export function createAlgorithm(strategy: RateLimitStrategy, options?: { refillRate?: number }): IRateLimitAlgorithm {
  switch (strategy) {
    case 'sliding-window':
      return new SlidingWindowAlgorithm();

    case 'fixed-window':
      return new FixedWindowAlgorithm();

    case 'token-bucket':
      return new TokenBucketAlgorithm(options?.refillRate);

    default:
      // TypeScript should catch this at compile time, but runtime safety
      throw new Error(`Unknown rate limit strategy: ${strategy}`);
  }
}
