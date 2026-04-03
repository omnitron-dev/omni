/**
 * Rate Limit Storage Implementations
 * @module @omnitron-dev/titan/modules/ratelimit
 *
 * Provides in-memory and Redis-based storage backends for rate limiting.
 * Both implementations support the IRateLimitStorage interface for consistency.
 */

import type { IRedisClient } from '@omnitron-dev/titan-redis';
import type { IRateLimitStorage } from './ratelimit.types.js';
import type { ILogger } from '@omnitron-dev/titan/types';
import { createNullLogger } from '@omnitron-dev/titan/types';

// ═══════════════════════════════════════════════════════════════════════════
// In-Memory Storage Implementation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * In-memory storage backend for rate limiting
 *
 * Features:
 * - Fast, zero-dependency storage for single-instance deployments
 * - Automatic cleanup of expired entries via interval
 * - TTL support with expiration timestamps
 * - Memory bounds to prevent unbounded growth
 * - Sorted set emulation for sliding window algorithms
 *
 * Limitations:
 * - Not suitable for distributed systems (no shared state)
 * - Data lost on process restart
 * - Memory usage scales with number of tracked keys
 *
 * @example
 * ```typescript
 * const storage = new MemoryRateLimitStorage({ cleanupIntervalMs: 60000 });
 *
 * // Increment counter with TTL
 * const count = await storage.increment('user:123', 60);
 *
 * // Cleanup on shutdown
 * storage.destroy();
 * ```
 */
export class MemoryRateLimitStorage implements IRateLimitStorage {
  private readonly store = new Map<string, { value: number; expiresAt?: number }>();
  private readonly sortedSets = new Map<string, Map<string, number>>();
  private readonly cleanupInterval?: NodeJS.Timeout;
  private readonly maxKeys: number;

  /**
   * Maximum number of keys to store before triggering aggressive cleanup
   * @default 10000
   */
  private static readonly MAX_KEYS = 10000;

  /**
   * Creates a new in-memory storage instance
   *
   * @param options - Storage configuration
   * @param options.cleanupIntervalMs - Interval for automatic cleanup of expired entries (default: 60000ms)
   * @param options.maxKeys - Maximum number of keys before triggering cleanup (default: 10000)
   */
  constructor(options: { cleanupIntervalMs?: number; maxKeys?: number } = {}) {
    const cleanupIntervalMs = options.cleanupIntervalMs ?? 60000;
    this.maxKeys = options.maxKeys ?? MemoryRateLimitStorage.MAX_KEYS;

    // Start periodic cleanup of expired entries
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalMs);

    // Prevent cleanup interval from keeping process alive
    this.cleanupInterval.unref?.();
  }

  /**
   * Increment a counter for a key with optional TTL
   *
   * @param key - Storage key
   * @param ttl - Time-to-live in milliseconds (optional)
   * @returns Current count after increment
   *
   * @example
   * ```typescript
   * // Increment with 60 second (60000ms) TTL
   * const count = await storage.increment('api:user:123', 60000);
   * ```
   */
  async increment(key: string, ttl?: number): Promise<number> {
    const entry = this.store.get(key);
    const now = Date.now();

    // Check if entry exists and is expired
    if (entry && entry.expiresAt && entry.expiresAt < now) {
      this.store.delete(key);
    }

    const current = this.store.get(key);
    const newValue = (current?.value ?? 0) + 1;
    const expiresAt = ttl ? now + ttl : current?.expiresAt;

    this.store.set(key, { value: newValue, expiresAt });

    // Trigger cleanup if approaching memory limits
    if (this.store.size > this.maxKeys) {
      this.cleanup();
    }

    return newValue;
  }

  /**
   * Get the current value for a key
   *
   * @param key - Storage key
   * @returns Current value or null if not found or expired
   *
   * @example
   * ```typescript
   * const count = await storage.get('api:user:123');
   * if (count === null) {
   *   console.log('Key not found or expired');
   * }
   * ```
   */
  async get(key: string): Promise<number | null> {
    const entry = this.store.get(key);
    const now = Date.now();

    if (!entry) {
      return null;
    }

    // Check expiration
    if (entry.expiresAt && entry.expiresAt < now) {
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Set a value for a key with optional TTL
   *
   * @param key - Storage key
   * @param value - Value to set
   * @param ttl - Time-to-live in milliseconds (optional)
   *
   * @example
   * ```typescript
   * await storage.set('api:user:123', 5, 60000);
   * ```
   */
  async set(key: string, value: number, ttl?: number): Promise<void> {
    const expiresAt = ttl ? Date.now() + ttl : undefined;
    this.store.set(key, { value, expiresAt });

    // Trigger cleanup if approaching memory limits
    if (this.store.size > this.maxKeys) {
      this.cleanup();
    }
  }

  /**
   * Add a timestamped entry to a sorted set (for sliding window)
   *
   * Emulates Redis sorted sets using a Map<string, number> where:
   * - Key = sorted set name
   * - Member = unique identifier
   * - Score = timestamp
   *
   * @param key - Sorted set key
   * @param score - Timestamp score
   * @param member - Member to add
   * @param ttl - Time-to-live in milliseconds (optional)
   *
   * @example
   * ```typescript
   * // Add request timestamp to sliding window with 60 second TTL
   * await storage.addToSortedSet('requests:user:123', Date.now(), 'req-uuid', 60000);
   * ```
   */
  async addToSortedSet(key: string, score: number, member: string, ttl?: number): Promise<void> {
    if (!this.sortedSets.has(key)) {
      this.sortedSets.set(key, new Map());
    }

    const set = this.sortedSets.get(key)!;
    set.set(member, score);

    // Store TTL metadata separately
    if (ttl) {
      const expiresAt = Date.now() + ttl;
      this.store.set(`${key}:ttl`, { value: expiresAt, expiresAt });
    }

    // Trigger cleanup if approaching memory limits
    if (this.sortedSets.size > this.maxKeys) {
      this.cleanup();
    }
  }

  /**
   * Remove entries from sorted set by score range
   *
   * Used to remove expired timestamps from sliding windows.
   *
   * @param key - Sorted set key
   * @param minScore - Minimum score (inclusive)
   * @param maxScore - Maximum score (inclusive)
   *
   * @example
   * ```typescript
   * // Remove timestamps older than 60 seconds
   * const now = Date.now();
   * await storage.removeFromSortedSetByScore('requests:user:123', 0, now - 60000);
   * ```
   */
  async removeFromSortedSetByScore(key: string, minScore: number, maxScore: number): Promise<void> {
    const set = this.sortedSets.get(key);
    if (!set) {
      return;
    }

    // Remove members with scores in range
    for (const [member, score] of set.entries()) {
      if (score >= minScore && score <= maxScore) {
        set.delete(member);
      }
    }

    // Delete empty sets to free memory
    if (set.size === 0) {
      this.sortedSets.delete(key);
      this.store.delete(`${key}:ttl`);
    }
  }

  /**
   * Count entries in a sorted set
   *
   * @param key - Sorted set key
   * @returns Number of entries in the set
   *
   * @example
   * ```typescript
   * const count = await storage.countSortedSet('requests:user:123');
   * console.log(`${count} requests in current window`);
   * ```
   */
  async countSortedSet(key: string): Promise<number> {
    const set = this.sortedSets.get(key);
    return set ? set.size : 0;
  }

  /**
   * Delete a key (counter or sorted set)
   *
   * @param key - Storage key to delete
   *
   * @example
   * ```typescript
   * await storage.delete('api:user:123');
   * ```
   */
  async delete(key: string): Promise<void> {
    this.store.delete(key);
    this.sortedSets.delete(key);
    this.store.delete(`${key}:ttl`);
  }

  /**
   * Get TTL for a key
   *
   * @param key - Storage key
   * @returns TTL in milliseconds or null if no TTL set or key not found
   *
   * @example
   * ```typescript
   * const ttl = await storage.ttl('api:user:123');
   * if (ttl === null) {
   *   console.log('No TTL set or key expired');
   * } else {
   *   console.log(`Expires in ${ttl}ms`);
   * }
   * ```
   */
  async ttl(key: string): Promise<number | null> {
    const entry = this.store.get(key);
    if (!entry || !entry.expiresAt) {
      return null;
    }

    const ttlMs = entry.expiresAt - Date.now();
    return Math.max(0, ttlMs);
  }

  /**
   * Clean up expired entries
   *
   * Called automatically by cleanup interval and when approaching memory limits.
   * Scans both counters and sorted sets for expired entries.
   *
   * @private
   */
  private cleanup(): void {
    const now = Date.now();

    // Clean expired counters
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.store.delete(key);
      }
    }

    // Clean expired sorted sets based on TTL metadata
    for (const key of this.sortedSets.keys()) {
      const ttlEntry = this.store.get(`${key}:ttl`);
      if (ttlEntry?.expiresAt && ttlEntry.expiresAt < now) {
        this.sortedSets.delete(key);
        this.store.delete(`${key}:ttl`);
      }
    }

    // If still over limit, remove oldest entries (LRU-style)
    if (this.store.size > this.maxKeys) {
      const toRemove = this.store.size - Math.floor(this.maxKeys * 0.8);
      const keys = Array.from(this.store.keys());
      for (let i = 0; i < toRemove && i < keys.length; i++) {
        const key = keys[i];
        if (key) {
          this.store.delete(key);
        }
      }
    }
  }

  /**
   * Destroy the storage instance
   *
   * Stops cleanup interval and clears all data.
   * Call this when shutting down to free resources.
   *
   * @example
   * ```typescript
   * // Cleanup on shutdown
   * process.on('SIGTERM', () => {
   *   storage.destroy();
   * });
   * ```
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.store.clear();
    this.sortedSets.clear();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Redis Storage Implementation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Redis storage backend for distributed rate limiting
 *
 * Features:
 * - Distributed rate limiting across multiple instances
 * - Atomic operations via Redis pipelines
 * - Native sorted set support for sliding windows
 * - Persistent storage across restarts
 * - Automatic key expiration via Redis TTL
 *
 * Requires:
 * - Redis server instance
 * - IRedisClient from @omnitron-dev/titan/module/redis
 *
 * @example
 * ```typescript
 * import { InjectRedis } from '@omnitron-dev/titan/module/redis';
 *
 * class RateLimitService {
 *   constructor(@InjectRedis() private readonly redis: IRedisClient) {
 *     const storage = new RedisRateLimitStorage(redis, { keyPrefix: 'ratelimit:' });
 *   }
 * }
 * ```
 */
export class RedisRateLimitStorage implements IRateLimitStorage {
  private readonly keyPrefix: string;
  private readonly logger: ILogger;
  private redisAvailable = true;

  /**
   * Creates a new Redis storage instance
   *
   * @param redis - Redis client instance
   * @param options - Storage configuration
   * @param options.keyPrefix - Prefix for all Redis keys (default: 'ratelimit:')
   * @param options.logger - Optional logger instance (defaults to null logger)
   */
  constructor(
    private readonly redis: IRedisClient,
    options: { keyPrefix?: string; logger?: ILogger } = {}
  ) {
    this.keyPrefix = options.keyPrefix ?? 'ratelimit:';
    this.logger = options.logger ?? createNullLogger();

    // Monitor Redis connection status
    this.redis.on('error', (error: Error) => {
      if (this.redisAvailable) {
        this.logger.error({ error: error.message }, '[RedisRateLimitStorage] Redis connection error');
        this.redisAvailable = false;
      }
    });

    this.redis.on('ready', () => {
      if (!this.redisAvailable) {
        this.logger.info('[RedisRateLimitStorage] Redis connection restored');
        this.redisAvailable = true;
      }
    });
  }

  /**
   * Build a prefixed key
   * @private
   */
  private buildKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  /**
   * Increment a counter for a key with optional TTL
   *
   * Uses Redis INCR for atomic increment and PEXPIRE for TTL.
   * Pipeline ensures atomicity of both operations.
   *
   * @param key - Storage key
   * @param ttl - Time-to-live in milliseconds (optional)
   * @returns Current count after increment
   * @throws Error if Redis operation fails
   *
   * @example
   * ```typescript
   * const count = await storage.increment('api:user:123', 60000);
   * ```
   */
  async increment(key: string, ttl?: number): Promise<number> {
    const fullKey = this.buildKey(key);

    try {
      if (ttl) {
        // Use pipeline for atomic increment + TTL
        // Convert milliseconds to seconds for Redis EXPIRE command
        const ttlSeconds = Math.ceil(ttl / 1000);
        const pipeline = this.redis.pipeline();
        pipeline.incr(fullKey);
        pipeline.expire(fullKey, ttlSeconds);
        const results = await pipeline.exec();

        if (!results || !results[0] || results[0][0]) {
          throw new Error(`Redis INCR failed: ${results?.[0]?.[0]}`);
        }

        return results[0][1] as number;
      } else {
        // Simple increment without TTL
        return await this.redis.incr(fullKey);
      }
    } catch (error) {
      this.redisAvailable = false;
      throw new Error(`Redis increment failed for key ${key}: ${error}`, { cause: error });
    }
  }

  /**
   * Get the current value for a key
   *
   * @param key - Storage key
   * @returns Current value or null if not found
   * @throws Error if Redis operation fails
   *
   * @example
   * ```typescript
   * const count = await storage.get('api:user:123');
   * ```
   */
  async get(key: string): Promise<number | null> {
    const fullKey = this.buildKey(key);

    try {
      const value = await this.redis.get(fullKey);
      return value ? parseInt(value, 10) : null;
    } catch (error) {
      this.redisAvailable = false;
      throw new Error(`Redis GET failed for key ${key}: ${error}`, { cause: error });
    }
  }

  /**
   * Set a value for a key with optional TTL
   *
   * @param key - Storage key
   * @param value - Value to set
   * @param ttl - Time-to-live in milliseconds (optional)
   * @throws Error if Redis operation fails
   *
   * @example
   * ```typescript
   * await storage.set('api:user:123', 5, 60000);
   * ```
   */
  async set(key: string, value: number, ttl?: number): Promise<void> {
    const fullKey = this.buildKey(key);

    try {
      if (ttl) {
        // SET with PX option for atomic set + TTL in milliseconds
        await this.redis.set(fullKey, value.toString(), 'PX', ttl);
      } else {
        await this.redis.set(fullKey, value.toString());
      }
    } catch (error) {
      this.redisAvailable = false;
      throw new Error(`Redis SET failed for key ${key}: ${error}`, { cause: error });
    }
  }

  /**
   * Add a timestamped entry to a sorted set
   *
   * Uses Redis ZADD for atomic addition to sorted set.
   * Score is typically a timestamp for sliding window algorithms.
   *
   * @param key - Sorted set key
   * @param score - Timestamp score
   * @param member - Member to add (typically a unique request ID)
   * @param ttl - Time-to-live in milliseconds (optional)
   * @throws Error if Redis operation fails
   *
   * @example
   * ```typescript
   * // Add request to sliding window with 60 second TTL
   * await storage.addToSortedSet('requests:user:123', Date.now(), 'req-uuid-123', 60000);
   * ```
   */
  async addToSortedSet(key: string, score: number, member: string, ttl?: number): Promise<void> {
    const fullKey = this.buildKey(key);

    try {
      if (ttl) {
        // Convert milliseconds to seconds for Redis EXPIRE command
        const ttlSeconds = Math.ceil(ttl / 1000);
        const pipeline = this.redis.pipeline();
        pipeline.zadd(fullKey, score, member);
        pipeline.expire(fullKey, ttlSeconds);
        const results = await pipeline.exec();

        if (!results || results[0]?.[0]) {
          throw new Error(`Redis ZADD failed: ${results?.[0]?.[0]}`);
        }
      } else {
        await this.redis.zadd(fullKey, score, member);
      }
    } catch (error) {
      this.redisAvailable = false;
      throw new Error(`Redis ZADD failed for key ${key}: ${error}`, { cause: error });
    }
  }

  /**
   * Remove entries from sorted set by score range
   *
   * Uses Redis ZREMRANGEBYSCORE to atomically remove entries.
   * Typically used to remove expired timestamps from sliding windows.
   *
   * @param key - Sorted set key
   * @param minScore - Minimum score (inclusive)
   * @param maxScore - Maximum score (inclusive)
   * @throws Error if Redis operation fails
   *
   * @example
   * ```typescript
   * // Remove requests older than 60 seconds
   * const now = Date.now();
   * await storage.removeFromSortedSetByScore('requests:user:123', 0, now - 60000);
   * ```
   */
  async removeFromSortedSetByScore(key: string, minScore: number, maxScore: number): Promise<void> {
    const fullKey = this.buildKey(key);

    try {
      await this.redis.zremrangebyscore(fullKey, minScore, maxScore);
    } catch (error) {
      this.redisAvailable = false;
      throw new Error(`Redis ZREMRANGEBYSCORE failed for key ${key}: ${error}`, { cause: error });
    }
  }

  /**
   * Count entries in a sorted set
   *
   * Uses Redis ZCARD to get the cardinality of the set.
   *
   * @param key - Sorted set key
   * @returns Number of entries in the set
   * @throws Error if Redis operation fails
   *
   * @example
   * ```typescript
   * const count = await storage.countSortedSet('requests:user:123');
   * ```
   */
  async countSortedSet(key: string): Promise<number> {
    const fullKey = this.buildKey(key);

    try {
      return await this.redis.zcard(fullKey);
    } catch (error) {
      this.redisAvailable = false;
      throw new Error(`Redis ZCARD failed for key ${key}: ${error}`, { cause: error });
    }
  }

  /**
   * Delete a key (counter or sorted set)
   *
   * Uses Redis DEL to remove the key.
   *
   * @param key - Storage key to delete
   * @throws Error if Redis operation fails
   *
   * @example
   * ```typescript
   * await storage.delete('api:user:123');
   * ```
   */
  async delete(key: string): Promise<void> {
    const fullKey = this.buildKey(key);

    try {
      await this.redis.del(fullKey);
    } catch (error) {
      this.redisAvailable = false;
      throw new Error(`Redis DEL failed for key ${key}: ${error}`, { cause: error });
    }
  }

  /**
   * Get TTL for a key
   *
   * Uses Redis PTTL command to get remaining time-to-live in milliseconds.
   *
   * @param key - Storage key
   * @returns TTL in milliseconds, null if no TTL set, or -2 if key doesn't exist
   * @throws Error if Redis operation fails
   *
   * @example
   * ```typescript
   * const ttl = await storage.ttl('api:user:123');
   * if (ttl === null || ttl === -2) {
   *   console.log('No TTL or key not found');
   * }
   * ```
   */
  async ttl(key: string): Promise<number | null> {
    const fullKey = this.buildKey(key);

    try {
      const ttl = await this.redis.pttl(fullKey);

      // Redis PTTL returns:
      // -2 if key doesn't exist
      // -1 if key exists but has no TTL
      // >0 for TTL in milliseconds
      if (ttl === -2 || ttl === -1) {
        return null;
      }

      return ttl;
    } catch (error) {
      this.redisAvailable = false;
      throw new Error(`Redis PTTL failed for key ${key}: ${error}`, { cause: error });
    }
  }

  /**
   * Check if Redis is available
   *
   * @returns true if Redis is connected and ready
   */
  isAvailable(): boolean {
    return this.redisAvailable && this.redis.status === 'ready';
  }
}
