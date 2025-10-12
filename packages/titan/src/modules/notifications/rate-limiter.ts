import { Injectable } from '../../decorators/index.js';
import { Redis } from 'ioredis';

export interface RateLimitConfig {
  perMinute?: number;
  perHour?: number;
  perDay?: number;
  burstLimit?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

@Injectable()
export class RateLimiter {
  private readonly RATE_LIMIT_KEY_PREFIX = 'notifications:ratelimit:';
  private defaultLimits: RateLimitConfig;

  constructor(
    private redis: Redis,
    defaultLimits?: RateLimitConfig
  ) {
    this.defaultLimits = defaultLimits || {
      perMinute: 10,
      perHour: 100,
      perDay: 1000,
      burstLimit: 5,
    };
  }

  /**
   * Check if an action is allowed under rate limits
   */
  async checkLimit(identifier: string, action: string = 'default', customLimits?: RateLimitConfig): Promise<boolean> {
    const limits = customLimits || this.defaultLimits;
    const results: boolean[] = [];

    // Check burst limit (immediate consecutive requests)
    if (limits.burstLimit) {
      const burstAllowed = await this.checkBurstLimit(identifier, action, limits.burstLimit);
      if (!burstAllowed) {
        return false;
      }
    }

    // Check per-minute limit
    if (limits.perMinute) {
      const minuteAllowed = await this.checkWindowLimit(identifier, action, 'minute', 60, limits.perMinute);
      results.push(minuteAllowed);
    }

    // Check per-hour limit
    if (limits.perHour) {
      const hourAllowed = await this.checkWindowLimit(identifier, action, 'hour', 3600, limits.perHour);
      results.push(hourAllowed);
    }

    // Check per-day limit
    if (limits.perDay) {
      const dayAllowed = await this.checkWindowLimit(identifier, action, 'day', 86400, limits.perDay);
      results.push(dayAllowed);
    }

    // All checks must pass
    return results.length === 0 || results.every((r) => r);
  }

  /**
   * Check rate limit for a batch of identifiers
   */
  async checkBatch(
    identifiers: { id: string }[],
    action: string = 'default',
    customLimits?: RateLimitConfig
  ): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    // Check limits for each identifier
    await Promise.all(
      identifiers.map(async ({ id }) => {
        const allowed = await this.checkLimit(id, action, customLimits);
        results.set(id, allowed);
      })
    );

    return results;
  }

  /**
   * Check burst limit using sliding window
   */
  private async checkBurstLimit(identifier: string, action: string, limit: number): Promise<boolean> {
    const key = `${this.RATE_LIMIT_KEY_PREFIX}burst:${identifier}:${action}`;
    const now = Date.now();
    const windowStart = now - 1000; // 1 second window for burst

    // Remove old entries and count recent ones
    const multi = this.redis.multi();
    multi.zremrangebyscore(key, '-inf', windowStart.toString());
    multi.zadd(key, now.toString(), now.toString());
    multi.zcard(key);
    multi.expire(key, 2);

    const results = await multi.exec();
    if (!results || !results[2] || results[2][0]) {
      return true; // Allow on error
    }

    const count = results[2][1] as number;
    return count <= limit;
  }

  /**
   * Check window-based rate limit
   */
  private async checkWindowLimit(
    identifier: string,
    action: string,
    window: 'minute' | 'hour' | 'day',
    ttl: number,
    limit: number
  ): Promise<boolean> {
    const key = `${this.RATE_LIMIT_KEY_PREFIX}${window}:${identifier}:${action}`;

    // Use Redis INCR with TTL
    const multi = this.redis.multi();
    multi.incr(key);
    multi.expire(key, ttl);

    const results = await multi.exec();
    if (!results || !results[0] || results[0][0]) {
      return true; // Allow on error
    }

    const count = results[0][1] as number;
    return count <= limit;
  }

  /**
   * Get current rate limit status
   */
  async getStatus(
    identifier: string,
    action: string = 'default',
    customLimits?: RateLimitConfig
  ): Promise<{
    minute?: RateLimitResult;
    hour?: RateLimitResult;
    day?: RateLimitResult;
  }> {
    const limits = customLimits || this.defaultLimits;
    const status: any = {};

    if (limits.perMinute) {
      status.minute = await this.getWindowStatus(identifier, action, 'minute', 60, limits.perMinute);
    }

    if (limits.perHour) {
      status.hour = await this.getWindowStatus(identifier, action, 'hour', 3600, limits.perHour);
    }

    if (limits.perDay) {
      status.day = await this.getWindowStatus(identifier, action, 'day', 86400, limits.perDay);
    }

    return status;
  }

  /**
   * Get status for a specific window
   */
  private async getWindowStatus(
    identifier: string,
    action: string,
    window: 'minute' | 'hour' | 'day',
    ttl: number,
    limit: number
  ): Promise<RateLimitResult> {
    const key = `${this.RATE_LIMIT_KEY_PREFIX}${window}:${identifier}:${action}`;

    const multi = this.redis.multi();
    multi.get(key);
    multi.ttl(key);

    const results = await multi.exec();
    if (!results || !results[0] || results[0][0]) {
      return {
        allowed: true,
        remaining: limit,
        resetAt: Date.now() + ttl * 1000,
      };
    }

    const count = parseInt((results[0][1] as string) || '0', 10);
    const ttlRemaining = (results[1]?.[1] as number) || ttl;

    return {
      allowed: count < limit,
      remaining: Math.max(0, limit - count),
      resetAt: Date.now() + ttlRemaining * 1000,
    };
  }

  /**
   * Reset rate limits for an identifier
   */
  async reset(identifier: string, action?: string): Promise<void> {
    const pattern = action
      ? `${this.RATE_LIMIT_KEY_PREFIX}*:${identifier}:${action}`
      : `${this.RATE_LIMIT_KEY_PREFIX}*:${identifier}:*`;

    // Find and delete all matching keys
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  /**
   * Set custom limits for a specific identifier
   */
  async setCustomLimits(identifier: string, limits: RateLimitConfig): Promise<void> {
    const key = `${this.RATE_LIMIT_KEY_PREFIX}config:${identifier}`;
    await this.redis.set(key, JSON.stringify(limits));
  }

  /**
   * Get custom limits for a specific identifier
   */
  async getCustomLimits(identifier: string): Promise<RateLimitConfig | null> {
    const key = `${this.RATE_LIMIT_KEY_PREFIX}config:${identifier}`;
    const stored = await this.redis.get(key);

    if (!stored) {
      return null;
    }

    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }
}
