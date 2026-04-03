/**
 * Rate limiting strategies supported by the module.
 *
 * - `sliding-window`: Smoothly tracks requests over a rolling time window
 * - `fixed-window`: Resets count at fixed intervals (simpler, less precise)
 * - `token-bucket`: Allows bursts with gradual token refill
 *
 * @public
 */
export type RateLimitStrategy = 'sliding-window' | 'fixed-window' | 'token-bucket';

/**
 * Pluggable storage interface for rate limit data.
 *
 * Implementations can use Redis, in-memory storage, or any other backend
 * that supports counters and sorted sets.
 *
 * @public
 */
export interface IRateLimitStorage {
  /**
   * Increment a counter and return the new value.
   *
   * @param key - Storage key
   * @param ttl - Time-to-live in milliseconds (optional)
   * @returns New counter value
   */
  increment(key: string, ttl?: number): Promise<number>;

  /**
   * Get the current value of a counter.
   *
   * @param key - Storage key
   * @returns Counter value or null if not found
   */
  get(key: string): Promise<number | null>;

  /**
   * Set a counter to a specific value.
   *
   * @param key - Storage key
   * @param value - Counter value
   * @param ttl - Time-to-live in milliseconds (optional)
   */
  set(key: string, value: number, ttl?: number): Promise<void>;

  /**
   * Delete a key from storage.
   *
   * @param key - Storage key
   */
  delete(key: string): Promise<void>;

  /**
   * Add a member to a sorted set with a score (used for sliding window).
   *
   * @param key - Storage key
   * @param score - Timestamp or numeric score
   * @param member - Unique member identifier
   * @param ttl - Time-to-live in milliseconds (optional)
   */
  addToSortedSet(key: string, score: number, member: string, ttl?: number): Promise<void>;

  /**
   * Remove members from a sorted set within a score range.
   *
   * @param key - Storage key
   * @param min - Minimum score (inclusive)
   * @param max - Maximum score (inclusive)
   */
  removeFromSortedSetByScore(key: string, min: number, max: number): Promise<void>;

  /**
   * Count the number of members in a sorted set.
   *
   * @param key - Storage key
   * @returns Number of members
   */
  countSortedSet(key: string): Promise<number>;

  /**
   * Get the time-to-live of a key in milliseconds.
   *
   * @param key - Storage key
   * @returns TTL in milliseconds or null if key doesn't exist or has no expiry
   */
  ttl(key: string): Promise<number | null>;

  /**
   * Cleanup resources when shutting down.
   */
  destroy?(): void;
}

/**
 * Result from a rate limit check.
 *
 * @public
 */
export interface IRateLimitResult {
  /**
   * Whether the request is allowed (within rate limit).
   */
  allowed: boolean;

  /**
   * Number of requests remaining in the current window.
   */
  remaining: number;

  /**
   * Maximum number of requests allowed.
   */
  limit: number;

  /**
   * Unix timestamp (ms) when the rate limit window resets.
   */
  resetAt: number;

  /**
   * Seconds to wait before retrying (only set when allowed=false).
   */
  retryAfter?: number;

  /**
   * Name of the tier that was applied (if using multi-tier limits).
   */
  tier?: string;
}

/**
 * Configuration for a rate limit tier.
 *
 * Tiers allow different rate limits for different user classes
 * (e.g., free, premium, enterprise).
 *
 * @public
 */
export interface IRateLimitTier {
  /**
   * Unique name for the tier.
   */
  name: string;

  /**
   * Maximum number of requests allowed in the window.
   */
  limit: number;

  /**
   * Extra burst allowance beyond the base limit.
   */
  burst?: number;

  /**
   * Queue priority (higher = processed first).
   */
  priority?: number;

  /**
   * Custom window duration in milliseconds for this tier.
   */
  windowMs?: number;
}

/**
 * Options for a single rate limit check.
 *
 * @public
 */
export interface IRateLimitCheckOptions {
  /**
   * Unique identifier for what is being rate limited
   * (e.g., user ID, IP address, API key).
   */
  key: string;

  /**
   * Override the default request limit for this check.
   */
  limit?: number;

  /**
   * Override the default window duration in milliseconds.
   */
  windowMs?: number;

  /**
   * Name of the tier to use (if using multi-tier limits).
   */
  tier?: string;

  /**
   * If false, check the limit without consuming a token.
   * Useful for preview/status checks.
   *
   * @defaultValue true
   */
  consume?: boolean;
}

/**
 * Core rate limiting service interface.
 *
 * @public
 */
export interface IRateLimitService {
  /**
   * Check if a request is within the rate limit.
   *
   * @param options - Check options
   * @returns Rate limit result
   */
  check(options: IRateLimitCheckOptions): Promise<IRateLimitResult>;

  /**
   * Consume a token from the rate limit bucket.
   *
   * Convenience wrapper around `check()` with `consume: true`.
   *
   * @param key - Rate limit key
   * @param options - Optional overrides
   * @returns Rate limit result
   */
  consume(key: string, options?: Partial<IRateLimitCheckOptions>): Promise<IRateLimitResult>;

  /**
   * Enforce a rate limit, throwing an error if exceeded.
   *
   * @param key - Rate limit key
   * @param options - Optional overrides
   * @throws {RateLimitExceededError} When rate limit is exceeded
   */
  enforce(key: string, options?: Partial<IRateLimitCheckOptions>): Promise<void>;

  /**
   * Get the current status without consuming a token.
   *
   * @param key - Rate limit key
   * @param options - Optional overrides
   * @returns Rate limit result with `consume: false`
   */
  getStatus(key: string, options?: Partial<IRateLimitCheckOptions>): Promise<IRateLimitResult>;

  /**
   * Reset the rate limit for a specific key.
   *
   * @param key - Rate limit key to reset
   * @param tier - Optional tier for the key
   */
  reset(key: string, tier?: string): Promise<void>;

  /**
   * Get usage statistics for the rate limiter.
   *
   * @returns Statistics object
   */
  getStats(): IRateLimitStats;

  /**
   * Cleanup resources and stop the service.
   */
  destroy(): void;
}

/**
 * Usage statistics for the rate limiter.
 *
 * @public
 */
export interface IRateLimitStats {
  /**
   * Total number of rate limit checks performed.
   */
  totalChecks: number;

  /**
   * Total number of allowed requests.
   */
  totalAllowed: number;

  /**
   * Total number of denied requests.
   */
  totalDenied: number;

  /**
   * Number of currently active rate limit keys.
   */
  activeKeys: number;

  /**
   * Per-tier statistics (if using multi-tier limits).
   */
  byTier?: Map<string, { checks: number; allowed: number; denied: number }>;
}

/**
 * Configuration options for the rate limit module.
 *
 * @public
 */
export interface IRateLimitModuleOptions {
  /**
   * Enable or disable rate limiting globally.
   *
   * @defaultValue true
   */
  enabled?: boolean;

  /**
   * Rate limiting strategy to use.
   *
   * @defaultValue 'sliding-window'
   */
  strategy?: RateLimitStrategy;

  /**
   * Prefix for all rate limit keys in storage.
   *
   * @defaultValue 'ratelimit'
   */
  keyPrefix?: string;

  /**
   * Default maximum number of requests allowed.
   *
   * @defaultValue 100
   */
  defaultLimit?: number;

  /**
   * Default window duration in milliseconds.
   *
   * @defaultValue 60000 (1 minute)
   */
  defaultWindowMs?: number;

  /**
   * Additional burst allowance beyond the base limit.
   */
  burstLimit?: number;

  /**
   * Rate at which tokens are refilled (token-bucket strategy only).
   *
   * @remarks
   * Expressed as tokens per second.
   */
  tokenRefillRate?: number;

  /**
   * Default tier configuration (if using multi-tier limits).
   */
  defaultTier?: IRateLimitTier;

  /**
   * Named tier configurations for different user classes.
   */
  tiers?: Record<string, IRateLimitTier>;

  /**
   * Enable request queueing for graceful degradation.
   *
   * @defaultValue false
   */
  queueEnabled?: boolean;

  /**
   * Maximum number of requests to hold in the queue.
   */
  maxQueueSize?: number;

  /**
   * Maximum time (ms) a request can wait in the queue.
   */
  queueTimeoutMs?: number;

  /**
   * Storage backend type.
   *
   * @defaultValue 'memory' (auto-detects Redis if available)
   */
  storageType?: 'memory' | 'redis';

  /**
   * Register the module globally (available to all modules).
   *
   * @defaultValue false
   */
  isGlobal?: boolean;
}

/**
 * Async configuration for the rate limit module.
 *
 * Allows dynamic configuration via factory functions.
 *
 * @public
 */
export interface IRateLimitModuleAsyncOptions {
  /**
   * Modules to import for dependency injection.
   */
  imports?: any[];

  /**
   * Factory function to create module options.
   */
  useFactory?: (...args: any[]) => Promise<IRateLimitModuleOptions> | IRateLimitModuleOptions;

  /**
   * Tokens to inject into the factory function.
   */
  inject?: any[];

  /**
   * Register the module globally (available to all modules).
   *
   * @defaultValue false
   */
  isGlobal?: boolean;
}

/**
 * Options for the @RateLimit() decorator.
 *
 * @public
 */
export interface IRateLimitDecoratorOptions {
  /**
   * Override the default request limit.
   */
  limit?: number;

  /**
   * Override the default window duration in milliseconds.
   */
  windowMs?: number;

  /**
   * Name of the tier to use.
   */
  tier?: string;

  /**
   * Custom function to generate the rate limit key from method arguments.
   *
   * @param args - Method arguments
   * @returns Rate limit key
   */
  keyGenerator?: (...args: unknown[]) => string;

  /**
   * Include the method name in the auto-generated key.
   *
   * @defaultValue true
   */
  includeMethodName?: boolean;

  /**
   * Continue execution if the rate limit check fails (e.g., storage unavailable).
   *
   * @defaultValue false
   */
  skipOnError?: boolean;
}

/**
 * Context interface for classes using the @RateLimit() decorator.
 *
 * The decorator looks for `__rateLimitService__` or injects it at runtime.
 *
 * @public
 */
export interface IRateLimitContext {
  /**
   * Injected rate limit service instance.
   */
  __rateLimitService__?: IRateLimitService;

  /**
   * Optional logger for debugging rate limit operations.
   */
  logger?: { debug: (...args: any[]) => void; warn: (...args: any[]) => void };

  /**
   * Alternative logger location (e.g., from LoggerModule).
   */
  loggerModule?: { logger?: { debug: (...args: any[]) => void; warn: (...args: any[]) => void } };
}

/**
 * HTTP-specific rate limiting options for Netron integration.
 *
 * Extends base options with HTTP-aware features.
 *
 * @public
 */
export interface IRateLimitHttpOptions extends IRateLimitModuleOptions {
  /**
   * Trust proxy headers (X-Forwarded-For, X-Real-IP) for IP extraction.
   *
   * @defaultValue false
   */
  trustProxy?: boolean;

  /**
   * IP addresses or CIDR ranges to exempt from rate limiting.
   */
  whitelist?: string[];

  /**
   * Global maximum requests per second for the entire server.
   */
  globalMaxRequests?: number;

  /**
   * Custom function to generate the rate limit key from an HTTP request.
   *
   * @param request - HTTP request object
   * @returns Rate limit key
   */
  keyGenerator?: (request: Request) => string;

  /**
   * Custom error message when rate limit is exceeded.
   *
   * @defaultValue 'Too many requests, please try again later.'
   */
  message?: string;

  /**
   * Only count requests that succeed (2xx status codes).
   *
   * @defaultValue false
   */
  skipSuccessfulRequests?: boolean;

  /**
   * Only count requests that fail (4xx/5xx status codes).
   *
   * @defaultValue false
   */
  skipFailedRequests?: boolean;
}
