/**
 * Consolidated Rate Limiting Utilities
 * @module @omnitron-dev/titan/utils/rate-limiting
 *
 * Unified rate-limiting implementation consolidating:
 * - Token bucket algorithm (in-memory)
 * - Sliding window algorithm (Redis-based)
 * - Fixed window algorithm (Redis-based)
 *
 * Provides pluggable storage backends and configurable strategies.
 */

/**
 * Rate limiting strategies
 */
export type RateLimitStrategy = 'token-bucket' | 'sliding-window' | 'fixed-window';

/**
 * Storage backend types
 */
export type RateLimitStorageType = 'memory' | 'redis';

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;

  /** Number of remaining requests/tokens */
  remaining: number;

  /** When the rate limit resets (Unix timestamp in ms) */
  resetAt: number;

  /** Milliseconds until retry is possible (if denied) */
  retryAfter?: number;

  /** Current limit being checked against */
  limit?: number;
}

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
  /** Rate limiting strategy (default: 'token-bucket') */
  strategy?: RateLimitStrategy;

  /** Storage backend type (default: 'memory') */
  storage?: RateLimitStorageType;

  /** Maximum number of requests/tokens allowed in the window */
  maxRequests: number;

  /** Time window in milliseconds (default: 60000 = 1 minute) */
  windowMs?: number;

  /** Token refill rate (tokens per windowMs, only for token-bucket) */
  tokenRefillRate?: number;

  /** Burst allowance (additional requests beyond maxRequests) */
  burstLimit?: number;

  /** Key prefix for storage (default: 'ratelimit:') */
  keyPrefix?: string;

  /** Custom storage backend instance */
  storageBackend?: RateLimiterStorage;
}

/**
 * Storage backend interface for rate limiting
 *
 * Allows custom storage implementations (Redis, DynamoDB, etc.)
 */
export interface RateLimiterStorage {
  /**
   * Increment a counter for a key with optional TTL
   * @param key - Storage key
   * @param ttl - Time-to-live in seconds
   * @returns Current count after increment
   */
  increment(key: string, ttl?: number): Promise<number>;

  /**
   * Get the current value for a key
   * @param key - Storage key
   * @returns Current value or null if not found
   */
  get(key: string): Promise<number | null>;

  /**
   * Set a value for a key with optional TTL
   * @param key - Storage key
   * @param value - Value to set
   * @param ttl - Time-to-live in seconds
   */
  set(key: string, value: number, ttl?: number): Promise<void>;

  /**
   * Add a timestamped entry to a sorted set (for sliding window)
   * @param key - Storage key
   * @param score - Timestamp score
   * @param member - Member to add
   * @param ttl - Time-to-live in seconds
   */
  addToSortedSet(key: string, score: number, member: string, ttl?: number): Promise<void>;

  /**
   * Remove entries from sorted set by score range
   * @param key - Storage key
   * @param minScore - Minimum score (inclusive)
   * @param maxScore - Maximum score (inclusive)
   */
  removeFromSortedSetByScore(key: string, minScore: number, maxScore: number): Promise<void>;

  /**
   * Count entries in a sorted set
   * @param key - Storage key
   * @returns Number of entries
   */
  countSortedSet(key: string): Promise<number>;

  /**
   * Delete a key
   * @param key - Storage key
   */
  delete(key: string): Promise<void>;

  /**
   * Get TTL for a key
   * @param key - Storage key
   * @returns TTL in seconds or null if no TTL set
   */
  ttl(key: string): Promise<number | null>;
}

/**
 * In-memory storage implementation
 *
 * Simple, fast storage backend for single-instance deployments.
 * Not suitable for distributed systems.
 */
export class InMemoryStorage implements RateLimiterStorage {
  private store = new Map<string, { value: number; expiresAt?: number }>();
  private sortedSets = new Map<string, Map<string, number>>();
  private cleanupInterval?: NodeJS.Timeout;

  constructor(cleanupIntervalMs: number = 60000) {
    // Periodic cleanup of expired entries
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalMs);
  }

  async increment(key: string, ttl?: number): Promise<number> {
    const entry = this.store.get(key);
    const now = Date.now();

    if (entry && entry.expiresAt && entry.expiresAt < now) {
      // Expired, reset
      this.store.delete(key);
    }

    const current = this.store.get(key);
    const newValue = (current?.value ?? 0) + 1;
    const expiresAt = ttl ? now + ttl * 1000 : current?.expiresAt;

    this.store.set(key, { value: newValue, expiresAt });
    return newValue;
  }

  async get(key: string): Promise<number | null> {
    const entry = this.store.get(key);
    const now = Date.now();

    if (!entry) {
      return null;
    }

    if (entry.expiresAt && entry.expiresAt < now) {
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }

  async set(key: string, value: number, ttl?: number): Promise<void> {
    const expiresAt = ttl ? Date.now() + ttl * 1000 : undefined;
    this.store.set(key, { value, expiresAt });
  }

  async addToSortedSet(key: string, score: number, member: string, ttl?: number): Promise<void> {
    if (!this.sortedSets.has(key)) {
      this.sortedSets.set(key, new Map());
    }

    const set = this.sortedSets.get(key)!;
    set.set(member, score);

    // Store TTL separately if needed
    if (ttl) {
      const expiresAt = Date.now() + ttl * 1000;
      this.store.set(`${key}:ttl`, { value: expiresAt, expiresAt });
    }
  }

  async removeFromSortedSetByScore(key: string, minScore: number, maxScore: number): Promise<void> {
    const set = this.sortedSets.get(key);
    if (!set) {
      return;
    }

    for (const [member, score] of set.entries()) {
      if (score >= minScore && score <= maxScore) {
        set.delete(member);
      }
    }

    if (set.size === 0) {
      this.sortedSets.delete(key);
    }
  }

  async countSortedSet(key: string): Promise<number> {
    const set = this.sortedSets.get(key);
    return set ? set.size : 0;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
    this.sortedSets.delete(key);
  }

  async ttl(key: string): Promise<number | null> {
    const entry = this.store.get(key);
    if (!entry || !entry.expiresAt) {
      return null;
    }

    const ttlMs = entry.expiresAt - Date.now();
    return Math.max(0, Math.floor(ttlMs / 1000));
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.store.delete(key);
        cleaned++;
      }
    }
  }

  /**
   * Destroy the storage (cleanup resources)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.store.clear();
    this.sortedSets.clear();
  }
}

/**
 * Unified Rate Limiter
 *
 * Provides configurable rate limiting with multiple strategies and pluggable storage backends.
 *
 * @example
 * ```typescript
 * // Token bucket (in-memory)
 * const limiter = new RateLimiter({
 *   strategy: 'token-bucket',
 *   maxRequests: 100,
 *   windowMs: 60000,
 *   tokenRefillRate: 10
 * });
 *
 * // Sliding window (Redis)
 * const limiterRedis = new RateLimiter({
 *   strategy: 'sliding-window',
 *   maxRequests: 1000,
 *   windowMs: 3600000,
 *   storage: 'redis',
 *   storageBackend: new RedisStorage(redisClient)
 * });
 *
 * // Check and consume
 * const result = await limiter.tryAcquire('user:123');
 * if (result.allowed) {
 *   // Process request
 * } else {
 *   // Rate limited, retry after result.retryAfter ms
 * }
 * ```
 */
export class RateLimiter {
  private readonly config: Required<Omit<RateLimiterConfig, 'storageBackend' | 'tokenRefillRate' | 'burstLimit'>> & {
    tokenRefillRate?: number;
    burstLimit?: number;
    storageBackend: RateLimiterStorage;
  };

  constructor(config: RateLimiterConfig) {
    // Validate config
    if (config.maxRequests <= 0) {
      throw new Error('maxRequests must be greater than 0');
    }

    // Set defaults
    const strategy = config.strategy ?? 'token-bucket';
    const storage = config.storage ?? 'memory';
    const windowMs = config.windowMs ?? 60000;
    const keyPrefix = config.keyPrefix ?? 'ratelimit:';

    // Create storage backend if not provided
    let storageBackend = config.storageBackend;
    if (!storageBackend) {
      if (storage === 'memory') {
        storageBackend = new InMemoryStorage();
      } else {
        throw new Error(`Storage type '${storage}' requires a storageBackend instance`);
      }
    }

    this.config = {
      strategy,
      storage,
      maxRequests: config.maxRequests,
      windowMs,
      keyPrefix,
      tokenRefillRate: config.tokenRefillRate,
      burstLimit: config.burstLimit,
      storageBackend,
    };
  }

  /**
   * Try to acquire a token/request (non-blocking)
   *
   * @param key - Identifier for rate limiting (e.g., user ID, IP address)
   * @returns Rate limit result
   */
  async tryAcquire(key: string): Promise<RateLimitResult> {
    const storageKey = `${this.config.keyPrefix}${key}`;

    switch (this.config.strategy) {
      case 'token-bucket':
        return this.tryAcquireTokenBucket(storageKey);
      case 'sliding-window':
        return this.tryAcquireSlidingWindow(storageKey);
      case 'fixed-window':
        return this.tryAcquireFixedWindow(storageKey);
      default:
        throw new Error(`Unknown strategy: ${this.config.strategy}`);
    }
  }

  /**
   * Check if a request is allowed without consuming a token
   *
   * @param key - Identifier for rate limiting
   * @returns Rate limit result (without consuming)
   */
  async isAllowed(key: string): Promise<RateLimitResult> {
    const storageKey = `${this.config.keyPrefix}${key}`;

    switch (this.config.strategy) {
      case 'token-bucket':
        return this.checkTokenBucket(storageKey, false);
      case 'sliding-window':
        return this.checkSlidingWindow(storageKey, false);
      case 'fixed-window':
        return this.checkFixedWindow(storageKey, false);
      default:
        throw new Error(`Unknown strategy: ${this.config.strategy}`);
    }
  }

  /**
   * Get remaining tokens/requests for a key
   *
   * @param key - Identifier for rate limiting
   * @returns Number of remaining tokens/requests
   */
  async getRemainingTokens(key: string): Promise<number> {
    const result = await this.isAllowed(key);
    return result.remaining;
  }

  /**
   * Reset rate limit for a key
   *
   * @param key - Identifier for rate limiting
   */
  async reset(key: string): Promise<void> {
    const storageKey = `${this.config.keyPrefix}${key}`;
    await this.config.storageBackend.delete(storageKey);
  }

  /**
   * Token bucket implementation
   */
  private async tryAcquireTokenBucket(storageKey: string): Promise<RateLimitResult> {
    return this.checkTokenBucket(storageKey, true);
  }

  private async checkTokenBucket(storageKey: string, consume: boolean): Promise<RateLimitResult> {
    const now = Date.now();
    const limit = this.config.maxRequests + (this.config.burstLimit ?? 0);
    const refillRate = this.config.tokenRefillRate ?? this.config.maxRequests;

    // Get current token state
    const tokenKey = `${storageKey}:tokens`;
    const lastRefillKey = `${storageKey}:lastRefill`;

    const currentTokens = (await this.config.storageBackend.get(tokenKey)) ?? limit;
    const lastRefill = (await this.config.storageBackend.get(lastRefillKey)) ?? now;

    // Calculate tokens to add based on time passed
    const timePassed = now - lastRefill;
    const tokensToAdd = timePassed > 0 ? (timePassed / this.config.windowMs) * refillRate : 0;

    // Calculate available tokens (up to limit)
    let availableTokens = Math.min(limit, currentTokens + tokensToAdd);

    // Check if we have tokens available
    const allowed = availableTokens >= 1;

    // Consume token if requested and allowed
    if (consume && allowed) {
      availableTokens -= 1;
      await this.config.storageBackend.set(tokenKey, availableTokens);
      await this.config.storageBackend.set(lastRefillKey, now);
    }

    // Calculate reset time
    const tokensNeeded = limit - availableTokens;
    const timeToRefill = tokensNeeded > 0 ? (tokensNeeded / refillRate) * this.config.windowMs : 0;
    const resetAt = now + timeToRefill;

    return {
      allowed,
      remaining: Math.floor(consume && allowed ? availableTokens : allowed ? availableTokens - 1 : availableTokens),
      resetAt,
      retryAfter: allowed ? undefined : Math.ceil(timeToRefill),
      limit,
    };
  }

  /**
   * Sliding window implementation
   */
  private async tryAcquireSlidingWindow(storageKey: string): Promise<RateLimitResult> {
    return this.checkSlidingWindow(storageKey, true);
  }

  private async checkSlidingWindow(storageKey: string, consume: boolean): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    const limit = this.config.maxRequests + (this.config.burstLimit ?? 0);
    const ttl = Math.ceil(this.config.windowMs / 1000) + 1;

    // Remove expired entries
    await this.config.storageBackend.removeFromSortedSetByScore(storageKey, -Infinity, windowStart);

    // Count current requests in window
    const currentCount = await this.config.storageBackend.countSortedSet(storageKey);

    // Check if under limit
    const allowed = currentCount < limit;

    // Add timestamp if consuming and allowed
    if (consume && allowed) {
      await this.config.storageBackend.addToSortedSet(storageKey, now, `${now}`, ttl);
    }

    // Calculate remaining and reset time
    const remaining = Math.max(0, limit - (consume && allowed ? currentCount + 1 : currentCount));
    const resetAt = now + this.config.windowMs;

    return {
      allowed,
      remaining,
      resetAt,
      retryAfter: allowed ? undefined : this.config.windowMs,
      limit,
    };
  }

  /**
   * Fixed window implementation
   */
  private async tryAcquireFixedWindow(storageKey: string): Promise<RateLimitResult> {
    return this.checkFixedWindow(storageKey, true);
  }

  private async checkFixedWindow(storageKey: string, consume: boolean): Promise<RateLimitResult> {
    const now = Date.now();
    const currentWindow = Math.floor(now / this.config.windowMs);
    const windowStart = currentWindow * this.config.windowMs;
    const windowEnd = windowStart + this.config.windowMs;
    const limit = this.config.maxRequests + (this.config.burstLimit ?? 0);
    const ttl = Math.ceil(this.config.windowMs / 1000) + 1;

    const windowKey = `${storageKey}:${currentWindow}`;

    // Get current count
    let currentCount = (await this.config.storageBackend.get(windowKey)) ?? 0;

    // Check if under limit
    const allowed = currentCount < limit;

    // Increment if consuming and allowed
    if (consume && allowed) {
      currentCount = await this.config.storageBackend.increment(windowKey, ttl);
    }

    // Calculate remaining and reset time
    const remaining = Math.max(0, limit - currentCount);
    const resetAt = windowEnd;

    return {
      allowed,
      remaining,
      resetAt,
      retryAfter: allowed ? undefined : windowEnd - now,
      limit,
    };
  }

  /**
   * Get the storage backend
   */
  getStorage(): RateLimiterStorage {
    return this.config.storageBackend;
  }

  /**
   * Destroy the rate limiter (cleanup resources)
   */
  destroy(): void {
    if (this.config.storageBackend instanceof InMemoryStorage) {
      this.config.storageBackend.destroy();
    }
  }
}

/**
 * Create a rate limiter with token bucket strategy
 *
 * @param maxRequests - Maximum tokens in bucket
 * @param windowMs - Refill interval in milliseconds
 * @param tokenRefillRate - Tokens added per interval
 * @returns Configured rate limiter
 */
export function createTokenBucketLimiter(
  maxRequests: number,
  windowMs: number = 60000,
  tokenRefillRate?: number
): RateLimiter {
  return new RateLimiter({
    strategy: 'token-bucket',
    maxRequests,
    windowMs,
    tokenRefillRate: tokenRefillRate ?? maxRequests,
  });
}

/**
 * Create a rate limiter with sliding window strategy
 *
 * @param maxRequests - Maximum requests in window
 * @param windowMs - Window size in milliseconds
 * @param storageBackend - Optional custom storage backend
 * @returns Configured rate limiter
 */
export function createSlidingWindowLimiter(
  maxRequests: number,
  windowMs: number = 60000,
  storageBackend?: RateLimiterStorage
): RateLimiter {
  return new RateLimiter({
    strategy: 'sliding-window',
    maxRequests,
    windowMs,
    storageBackend,
  });
}

/**
 * Create a rate limiter with fixed window strategy
 *
 * @param maxRequests - Maximum requests per window
 * @param windowMs - Window size in milliseconds
 * @param storageBackend - Optional custom storage backend
 * @returns Configured rate limiter
 */
export function createFixedWindowLimiter(
  maxRequests: number,
  windowMs: number = 60000,
  storageBackend?: RateLimiterStorage
): RateLimiter {
  return new RateLimiter({
    strategy: 'fixed-window',
    maxRequests,
    windowMs,
    storageBackend,
  });
}
