/**
 * Redis-based Rate Limiter for Notifications
 *
 * Production-ready implementation with:
 * - Burst detection (sliding window)
 * - Multi-tier rate limiting (minute/hour/day)
 * - Per-recipient custom limits
 * - Per-channel limits
 * - Batch operations
 */

import { Injectable, Optional } from '@omnitron-dev/titan/decorators';
import { safeJsonParse } from '@omnitron-dev/titan/utils';

import type { Redis } from 'ioredis';
import type { IRateLimiter, NotificationType } from './notifications.types.js';

// ============================================================================
// Types
// ============================================================================

export interface RateLimitConfig {
  /** Max requests per minute */
  perMinute?: number;
  /** Max requests per hour */
  perHour?: number;
  /** Max requests per day */
  perDay?: number;
  /** Burst limit (per second) */
  burstLimit?: number;
  /** Burst window in ms (default: 1000) */
  burstWindowMs?: number;
}

export interface RateLimitStatus {
  allowed: boolean;
  remaining: {
    burst?: number;
    minute?: number;
    hour?: number;
    day?: number;
  };
  resetAt: {
    burst?: number;
    minute?: number;
    hour?: number;
    day?: number;
  };
  retryAfter?: number;
}

export interface RedisRateLimiterOptions {
  /** Redis key prefix */
  keyPrefix?: string;
  /** Default rate limits */
  defaultLimits?: RateLimitConfig;
  /** Per-channel limits (override defaults) */
  channelLimits?: Record<string, RateLimitConfig>;
  /** Enable burst detection */
  enableBurstDetection?: boolean;
}

const DEFAULT_LIMITS: RateLimitConfig = {
  perMinute: 60,
  perHour: 500,
  perDay: 5000,
  burstLimit: 10,
  burstWindowMs: 1000,
};

// ============================================================================
// Implementation
// ============================================================================

@Injectable()
export class RedisRateLimiter implements IRateLimiter {
  private readonly keyPrefix: string;
  private readonly defaultLimits: RateLimitConfig;
  private readonly channelLimits: Record<string, RateLimitConfig>;
  private readonly enableBurstDetection: boolean;

  /**
   * Maximum number of entries in memory store.
   * Prevents unbounded memory growth when using in-memory fallback (no Redis).
   */
  private static readonly MAX_MEMORY_STORE_SIZE = 10000;

  // In-memory fallback when Redis is not available (bounded by MAX_MEMORY_STORE_SIZE)
  private readonly memoryStore = new Map<string, { count: number; resetAt: number }>();

  constructor(
    @Optional() private readonly redis?: Redis,
    options?: RedisRateLimiterOptions
  ) {
    this.keyPrefix = options?.keyPrefix ?? 'notifications:ratelimit:';
    this.defaultLimits = { ...DEFAULT_LIMITS, ...options?.defaultLimits };
    this.channelLimits = options?.channelLimits ?? {};
    this.enableBurstDetection = options?.enableBurstDetection ?? true;
  }

  // ============================================================================
  // IRateLimiter Implementation
  // ============================================================================

  async checkLimit(
    recipientId: string,
    channel: string,
    type?: NotificationType
  ): Promise<{ allowed: boolean; retryAfter?: number }> {
    const status = await this.getStatus(recipientId, channel, type);

    return {
      allowed: status.allowed,
      retryAfter: status.retryAfter,
    };
  }

  async recordSent(recipientId: string, channel: string, type?: NotificationType): Promise<void> {
    const key = this.buildKey(recipientId, channel);
    const now = Date.now();

    if (this.redis) {
      await this.recordToRedis(key, now);
    } else {
      this.recordToMemory(key, now);
    }
  }

  async reset(recipientId: string, channel?: string): Promise<void> {
    if (channel) {
      await this.resetChannel(recipientId, channel);
    } else {
      await this.resetAll(recipientId);
    }
  }

  // ============================================================================
  // Advanced Features
  // ============================================================================

  /**
   * Check limits for multiple recipients in batch
   */
  async checkBatch(
    recipients: Array<{ id: string; channel: string; type?: NotificationType }>
  ): Promise<Map<string, { allowed: boolean; retryAfter?: number }>> {
    const results = new Map<string, { allowed: boolean; retryAfter?: number }>();

    // Parallel checks
    const checks = recipients.map(async (r) => {
      const result = await this.checkLimit(r.id, r.channel, r.type);
      results.set(`${r.id}:${r.channel}`, result);
    });

    await Promise.all(checks);
    return results;
  }

  /**
   * Get detailed rate limit status
   */
  async getStatus(recipientId: string, channel: string, type?: NotificationType): Promise<RateLimitStatus> {
    const limits = await this.getLimitsFor(recipientId, channel);
    const key = this.buildKey(recipientId, channel);
    const now = Date.now();

    let allowed = true;
    let retryAfter: number | undefined;
    const remaining: RateLimitStatus['remaining'] = {};
    const resetAt: RateLimitStatus['resetAt'] = {};

    if (this.redis) {
      // Check burst limit (sliding window)
      if (this.enableBurstDetection && limits.burstLimit) {
        const burstKey = `${key}:burst`;
        const windowMs = limits.burstWindowMs ?? 1000;
        const windowStart = now - windowMs;

        await this.redis.zremrangebyscore(burstKey, '-inf', windowStart);
        const burstCount = await this.redis.zcard(burstKey);

        remaining.burst = Math.max(0, limits.burstLimit - burstCount);
        resetAt.burst = now + windowMs;

        if (burstCount >= limits.burstLimit) {
          allowed = false;
          retryAfter = Math.min(retryAfter ?? Infinity, windowMs);
        }
      }

      // Build keys for time-based limits
      const minuteKey = limits.perMinute ? `${key}:minute:${Math.floor(now / 60000)}` : null;
      const hourKey = limits.perHour ? `${key}:hour:${Math.floor(now / 3600000)}` : null;
      const dayKey = limits.perDay ? `${key}:day:${Math.floor(now / 86400000)}` : null;

      // Batch fetch all time-based limits with MGET (single Redis call instead of 3)
      const keysToFetch = [minuteKey, hourKey, dayKey].filter((k): k is string => k !== null);
      const counts = keysToFetch.length > 0 ? await this.redis.mget(...keysToFetch) : [];

      // Parse counts by key position
      let countIndex = 0;
      const minuteCount = minuteKey ? parseInt(counts[countIndex++] || '0', 10) : 0;
      const hourCount = hourKey ? parseInt(counts[countIndex++] || '0', 10) : 0;
      const dayCount = dayKey ? parseInt(counts[countIndex] || '0', 10) : 0;

      // Check minute limit
      if (limits.perMinute) {
        remaining.minute = Math.max(0, limits.perMinute - minuteCount);
        resetAt.minute = (Math.floor(now / 60000) + 1) * 60000;

        if (minuteCount >= limits.perMinute) {
          allowed = false;
          retryAfter = Math.min(retryAfter ?? Infinity, resetAt.minute - now);
        }
      }

      // Check hour limit
      if (limits.perHour) {
        remaining.hour = Math.max(0, limits.perHour - hourCount);
        resetAt.hour = (Math.floor(now / 3600000) + 1) * 3600000;

        if (hourCount >= limits.perHour) {
          allowed = false;
          retryAfter = Math.min(retryAfter ?? Infinity, resetAt.hour - now);
        }
      }

      // Check day limit
      if (limits.perDay) {
        remaining.day = Math.max(0, limits.perDay - dayCount);
        resetAt.day = (Math.floor(now / 86400000) + 1) * 86400000;

        if (dayCount >= limits.perDay) {
          allowed = false;
          retryAfter = Math.min(retryAfter ?? Infinity, resetAt.day - now);
        }
      }
    } else {
      // In-memory fallback (simplified)
      const memKey = `${key}:minute`;
      const entry = this.memoryStore.get(memKey);

      if (entry && entry.resetAt > now) {
        remaining.minute = Math.max(0, (limits.perMinute ?? 60) - entry.count);
        resetAt.minute = entry.resetAt;

        if (entry.count >= (limits.perMinute ?? 60)) {
          allowed = false;
          retryAfter = entry.resetAt - now;
        }
      } else {
        remaining.minute = limits.perMinute ?? 60;
        resetAt.minute = now + 60000;
      }
    }

    return {
      allowed,
      remaining,
      resetAt,
      retryAfter: retryAfter === Infinity ? undefined : retryAfter,
    };
  }

  /**
   * Set custom rate limits for a specific recipient
   */
  async setCustomLimits(recipientId: string, limits: RateLimitConfig): Promise<void> {
    const key = `${this.keyPrefix}config:${recipientId}`;

    if (this.redis) {
      await this.redis.set(key, JSON.stringify(limits), 'EX', 86400 * 30); // 30 days
    }
  }

  /**
   * Get custom rate limits for a recipient
   */
  async getCustomLimits(recipientId: string): Promise<RateLimitConfig | null> {
    if (!this.redis) return null;

    const key = `${this.keyPrefix}config:${recipientId}`;
    const data = await this.redis.get(key);

    return data ? safeJsonParse<RateLimitConfig>(data) : null;
  }

  /**
   * Remove custom limits for a recipient
   */
  async removeCustomLimits(recipientId: string): Promise<void> {
    if (this.redis) {
      const key = `${this.keyPrefix}config:${recipientId}`;
      await this.redis.del(key);
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async getLimitsFor(recipientId: string, channel: string): Promise<RateLimitConfig> {
    // Check for custom limits first
    const customLimits = await this.getCustomLimits(recipientId);
    if (customLimits) {
      return { ...this.defaultLimits, ...customLimits };
    }

    // Check for channel-specific limits
    if (this.channelLimits[channel]) {
      return { ...this.defaultLimits, ...this.channelLimits[channel] };
    }

    return this.defaultLimits;
  }

  private buildKey(recipientId: string, channel: string): string {
    return `${this.keyPrefix}${recipientId}:${channel}`;
  }

  private async recordToRedis(key: string, now: number): Promise<void> {
    // Guard: This method should only be called when Redis is available
    if (!this.redis) {
      throw new Error('recordToRedis called without Redis client');
    }
    const pipeline = this.redis.pipeline();

    // Record burst (sliding window)
    if (this.enableBurstDetection) {
      const burstKey = `${key}:burst`;
      pipeline.zadd(burstKey, now, `${now}-${Math.random()}`);
      pipeline.expire(burstKey, 2); // 2 second TTL
    }

    // Record minute
    const minuteKey = `${key}:minute:${Math.floor(now / 60000)}`;
    pipeline.incr(minuteKey);
    pipeline.expire(minuteKey, 120); // 2 minutes TTL

    // Record hour
    const hourKey = `${key}:hour:${Math.floor(now / 3600000)}`;
    pipeline.incr(hourKey);
    pipeline.expire(hourKey, 7200); // 2 hours TTL

    // Record day
    const dayKey = `${key}:day:${Math.floor(now / 86400000)}`;
    pipeline.incr(dayKey);
    pipeline.expire(dayKey, 172800); // 2 days TTL

    await pipeline.exec();
  }

  private recordToMemory(key: string, now: number): void {
    const memKey = `${key}:minute`;
    const entry = this.memoryStore.get(memKey);
    const resetAt = (Math.floor(now / 60000) + 1) * 60000;

    if (entry && entry.resetAt > now) {
      entry.count++;
    } else {
      this.memoryStore.set(memKey, { count: 1, resetAt });
    }

    // Cleanup old entries when approaching size limit
    if (this.memoryStore.size > RedisRateLimiter.MAX_MEMORY_STORE_SIZE) {
      this.cleanupMemoryStore(now);
    }
  }

  /**
   * Remove expired entries and apply FIFO eviction if still over limit.
   * Ensures memory store stays bounded even under high load.
   */
  private cleanupMemoryStore(now: number): void {
    // First, remove expired entries
    for (const [key, entry] of this.memoryStore.entries()) {
      if (entry.resetAt < now) {
        this.memoryStore.delete(key);
      }
    }

    // If still over limit after expiration cleanup, apply FIFO eviction
    while (this.memoryStore.size > RedisRateLimiter.MAX_MEMORY_STORE_SIZE) {
      const firstKey = this.memoryStore.keys().next().value;
      if (firstKey) {
        this.memoryStore.delete(firstKey);
      } else {
        break;
      }
    }
  }

  private async resetChannel(recipientId: string, channel: string): Promise<void> {
    const key = this.buildKey(recipientId, channel);

    if (this.redis) {
      const keys = await this.redis.keys(`${key}:*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } else {
      for (const k of this.memoryStore.keys()) {
        if (k.startsWith(key)) {
          this.memoryStore.delete(k);
        }
      }
    }
  }

  private async resetAll(recipientId: string): Promise<void> {
    const pattern = `${this.keyPrefix}${recipientId}:*`;

    if (this.redis) {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } else {
      const prefix = `${this.keyPrefix}${recipientId}:`;
      for (const k of this.memoryStore.keys()) {
        if (k.startsWith(prefix)) {
          this.memoryStore.delete(k);
        }
      }
    }
  }
}
