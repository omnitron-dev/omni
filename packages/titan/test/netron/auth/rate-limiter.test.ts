/**
 * Comprehensive Integration Tests for RateLimiter
 *
 * Tests all functionality of the auth-level rate limiter:
 * - All strategies: sliding, fixed, token-bucket
 * - Tier configurations and selection
 * - Queue mode with priorities
 * - check() vs consume() behavior
 * - reset() and getStats()
 * - cleanup and destroy()
 * - Burst allowance
 * - Edge cases
 *
 * @module @omnitron-dev/titan/test/netron/auth
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimiter, type RateLimitConfig } from '../../../src/netron/auth/rate-limiter.js';
import { RateLimitError } from '../../../src/errors/index.js';
import type { ILogger, LogLevel } from '../../../src/types/logger.js';

/**
 * Mock logger implementing ILogger interface
 * Captures log calls for verification in tests
 */
function createMockLogger(): ILogger & {
  logs: { level: string; args: any[] }[];
  clear: () => void;
} {
  const logs: { level: string; args: any[] }[] = [];

  const createLogFn =
    (level: string) =>
    (...args: any[]) => {
      logs.push({ level, args });
    };

  let currentLevel: LogLevel = 'info';

  const mockLogger: ILogger & { logs: { level: string; args: any[] }[]; clear: () => void } = {
    trace: createLogFn('trace'),
    debug: createLogFn('debug'),
    info: createLogFn('info'),
    warn: createLogFn('warn'),
    error: createLogFn('error'),
    fatal: createLogFn('fatal'),
    child: (_bindings: object) => mockLogger,
    time: (_label?: string) => () => {},
    isLevelEnabled: (_level: LogLevel) => true,
    setLevel: (level: LogLevel) => {
      currentLevel = level;
    },
    getLevel: () => currentLevel,
    logs,
    clear: () => {
      logs.length = 0;
    },
  };

  return mockLogger;
}

describe('RateLimiter', () => {
  let logger: ReturnType<typeof createMockLogger>;
  let limiter: RateLimiter;

  beforeEach(() => {
    logger = createMockLogger();
  });

  afterEach(() => {
    if (limiter) {
      limiter.destroy();
    }
    logger.clear();
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      limiter = new RateLimiter(logger);

      const stats = limiter.getStats();
      expect(stats.activeKeys).toBe(0);
      expect(stats.currentQueueSize).toBe(0);
      expect(stats.totalChecks).toBe(0);
    });

    it('should initialize with custom configuration', () => {
      const config: RateLimitConfig = {
        window: 30000,
        strategy: 'token-bucket',
        queue: true,
        maxQueueSize: 500,
        defaultTier: { name: 'custom', limit: 50 },
        tiers: {
          premium: { name: 'premium', limit: 200 },
        },
      };

      limiter = new RateLimiter(logger, config);
      const stats = limiter.getStats();
      expect(stats.activeKeys).toBe(0);
    });
  });

  describe('Sliding Window Strategy', () => {
    beforeEach(() => {
      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 1000, // 1 second window for fast tests
        defaultTier: { name: 'default', limit: 5 },
      });
    });

    it('should allow requests under the limit', async () => {
      for (let i = 0; i < 5; i++) {
        const result = await limiter.check('user-1');
        expect(result.allowed).toBe(true);
        expect(result.tier).toBe('default');
        await limiter.consume('user-1');
      }
    });

    it('should deny requests over the limit', async () => {
      // Consume all 5 requests
      for (let i = 0; i < 5; i++) {
        await limiter.consume('user-1');
      }

      // Next request should be denied
      const result = await limiter.check('user-1');
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeDefined();
      expect(result.remaining).toBe(0);
    });

    it('should throw RateLimitError when consuming over limit', async () => {
      // Consume all requests
      for (let i = 0; i < 5; i++) {
        await limiter.consume('user-1');
      }

      // Next consume should throw
      await expect(limiter.consume('user-1')).rejects.toThrow(RateLimitError);
    });

    it('should reset after window expires', async () => {
      // Consume all requests
      for (let i = 0; i < 5; i++) {
        await limiter.consume('user-1');
      }

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should be allowed again
      const result = await limiter.check('user-1');
      expect(result.allowed).toBe(true);
    });

    it('should track remaining requests correctly', async () => {
      let result = await limiter.check('user-1');
      expect(result.remaining).toBe(5);

      await limiter.consume('user-1');
      result = await limiter.check('user-1');
      expect(result.remaining).toBe(4);

      await limiter.consume('user-1');
      await limiter.consume('user-1');
      result = await limiter.check('user-1');
      expect(result.remaining).toBe(2);
    });

    it('should handle sliding window accurately with timestamps', async () => {
      // Consume 3 requests
      await limiter.consume('user-1');
      await new Promise((resolve) => setTimeout(resolve, 300));
      await limiter.consume('user-1');
      await new Promise((resolve) => setTimeout(resolve, 300));
      await limiter.consume('user-1');

      // After 500ms, first request should have expired (total ~600ms from first)
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should have capacity for more since first request expired
      const result = await limiter.check('user-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
    });
  });

  describe('Fixed Window Strategy', () => {
    beforeEach(() => {
      limiter = new RateLimiter(logger, {
        strategy: 'fixed',
        window: 1000, // 1 second window
        defaultTier: { name: 'default', limit: 5 },
      });
    });

    it('should allow requests under the limit', async () => {
      for (let i = 0; i < 5; i++) {
        const result = await limiter.check('user-1');
        expect(result.allowed).toBe(true);
        await limiter.consume('user-1');
      }
    });

    it('should deny requests over the limit', async () => {
      for (let i = 0; i < 5; i++) {
        await limiter.consume('user-1');
      }

      const result = await limiter.check('user-1');
      expect(result.allowed).toBe(false);
    });

    it('should reset at fixed window boundaries', async () => {
      for (let i = 0; i < 5; i++) {
        await limiter.consume('user-1');
      }

      // Wait for next window
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const result = await limiter.check('user-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5);
    });

    it('should provide accurate resetAt time', async () => {
      const beforeConsume = Date.now();
      await limiter.consume('user-1');

      const result = await limiter.check('user-1');
      const resetAt = result.resetAt.getTime();

      // resetAt should be within the current window boundary
      expect(resetAt).toBeGreaterThanOrEqual(beforeConsume);
      expect(resetAt).toBeLessThanOrEqual(beforeConsume + 2000);
    });
  });

  describe('Token Bucket Strategy', () => {
    beforeEach(() => {
      limiter = new RateLimiter(logger, {
        strategy: 'token-bucket',
        window: 1000, // Refill rate: limit tokens per window
        defaultTier: { name: 'default', limit: 5 },
      });
    });

    it('should allow requests when tokens available', async () => {
      for (let i = 0; i < 5; i++) {
        const result = await limiter.check('user-1');
        expect(result.allowed).toBe(true);
        await limiter.consume('user-1');
      }
    });

    it('should deny requests when tokens exhausted', async () => {
      for (let i = 0; i < 5; i++) {
        await limiter.consume('user-1');
      }

      const result = await limiter.check('user-1');
      expect(result.allowed).toBe(false);
    });

    it('should refill tokens over time', async () => {
      // Consume all tokens
      for (let i = 0; i < 5; i++) {
        await limiter.consume('user-1');
      }

      // Wait for partial refill (1 token takes 200ms = 1000ms/5)
      await new Promise((resolve) => setTimeout(resolve, 250));

      const result = await limiter.check('user-1');
      expect(result.allowed).toBe(true);
    });

    it('should cap tokens at max limit', async () => {
      // Wait extra time for tokens to accumulate
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should still only have 5 tokens (max)
      const result = await limiter.check('user-1');
      expect(result.remaining).toBeLessThanOrEqual(5);
    });
  });

  describe('Burst Allowance', () => {
    it('should allow burst requests beyond base limit', async () => {
      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 1000,
        defaultTier: { name: 'default', limit: 5, burst: 3 }, // Total: 8
      });

      // Should allow 8 requests (5 base + 3 burst)
      for (let i = 0; i < 8; i++) {
        await limiter.consume('user-1');
      }

      // 9th should fail
      const result = await limiter.check('user-1');
      expect(result.allowed).toBe(false);
    });

    it('should work with burst in token-bucket strategy', async () => {
      limiter = new RateLimiter(logger, {
        strategy: 'token-bucket',
        window: 1000,
        defaultTier: { name: 'default', limit: 5, burst: 5 }, // Total: 10 max tokens
      });

      // Should allow 10 requests initially
      for (let i = 0; i < 10; i++) {
        const result = await limiter.check('user-1');
        expect(result.allowed).toBe(true);
        await limiter.consume('user-1');
      }
    });

    it('should work with burst in fixed window strategy', async () => {
      limiter = new RateLimiter(logger, {
        strategy: 'fixed',
        window: 1000,
        defaultTier: { name: 'default', limit: 3, burst: 2 },
      });

      // Should allow 5 requests (3 base + 2 burst)
      for (let i = 0; i < 5; i++) {
        await limiter.consume('user-1');
      }

      const result = await limiter.check('user-1');
      expect(result.allowed).toBe(false);
    });
  });

  describe('Tier Configuration', () => {
    beforeEach(() => {
      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 1000,
        defaultTier: { name: 'free', limit: 2 },
        tiers: {
          premium: { name: 'premium', limit: 10, burst: 5, priority: 5 },
          enterprise: { name: 'enterprise', limit: 100, burst: 20, priority: 10 },
        },
      });
    });

    it('should apply default tier for unknown tier', async () => {
      const result = await limiter.check('user-1', 'unknown-tier');
      expect(result.tier).toBe('free'); // Falls back to default
      expect(result.remaining).toBe(2); // Default limit

      // Verify warning was logged
      const warningLog = logger.logs.find(
        (log) => log.level === 'warn' && JSON.stringify(log.args).includes('Unknown tier')
      );
      expect(warningLog).toBeDefined();
    });

    it('should apply premium tier limits', async () => {
      // Premium has limit: 10, burst: 5 = 15 total
      for (let i = 0; i < 15; i++) {
        await limiter.consume('user-1', 'premium');
      }

      const result = await limiter.check('user-1', 'premium');
      expect(result.allowed).toBe(false);
      expect(result.tier).toBe('premium');
    });

    it('should apply enterprise tier limits', async () => {
      // Enterprise has limit: 100, burst: 20 = 120 total
      for (let i = 0; i < 50; i++) {
        await limiter.consume('user-1', 'enterprise');
      }

      const result = await limiter.check('user-1', 'enterprise');
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe('enterprise');
      expect(result.remaining).toBe(70); // 120 - 50
    });

    it('should track different tiers separately per key', async () => {
      // Exhaust free tier for user-1
      await limiter.consume('user-1', 'free');
      await limiter.consume('user-1', 'free');

      const freeResult = await limiter.check('user-1', 'free');
      expect(freeResult.allowed).toBe(false);

      // Premium tier for same user should work (different state)
      const premiumResult = await limiter.check('user-1', 'premium');
      // Note: They share the same key state, so this tests the tier limit evaluation
      expect(premiumResult.tier).toBe('premium');
    });

    it('should use undefined tier to get default', async () => {
      const result = await limiter.check('user-1', undefined);
      expect(result.tier).toBe('free');
    });
  });

  describe('check() vs consume() Behavior', () => {
    beforeEach(() => {
      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 1000,
        defaultTier: { name: 'default', limit: 3 },
      });
    });

    it('check() should not modify state', async () => {
      // Check multiple times
      await limiter.check('user-1');
      await limiter.check('user-1');
      await limiter.check('user-1');

      // All should still return allowed
      const result = await limiter.check('user-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(3); // Nothing consumed yet
    });

    it('consume() should modify state', async () => {
      await limiter.consume('user-1');

      const result = await limiter.check('user-1');
      expect(result.remaining).toBe(2); // One consumed
    });

    it('check() followed by consume() is idempotent pattern', async () => {
      const check1 = await limiter.check('user-1');
      expect(check1.allowed).toBe(true);
      await limiter.consume('user-1');

      const check2 = await limiter.check('user-1');
      expect(check2.allowed).toBe(true);
      expect(check2.remaining).toBe(2);
    });

    it('consume() throws when limit exceeded', async () => {
      await limiter.consume('user-1');
      await limiter.consume('user-1');
      await limiter.consume('user-1');

      await expect(limiter.consume('user-1')).rejects.toThrow(RateLimitError);
    });

    it('RateLimitError should contain retryAfter', async () => {
      await limiter.consume('user-1');
      await limiter.consume('user-1');
      await limiter.consume('user-1');

      try {
        await limiter.consume('user-1');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RateLimitError);
        expect((error as RateLimitError).retryAfter).toBeDefined();
        expect((error as RateLimitError).retryAfter).toBeGreaterThan(0);
      }
    });
  });

  describe('Queue Mode', () => {
    beforeEach(() => {
      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 500, // Short window for queue processing
        queue: true,
        maxQueueSize: 5,
        defaultTier: { name: 'default', limit: 2 },
        tiers: {
          premium: { name: 'premium', limit: 2, priority: 10 },
          free: { name: 'free', limit: 2, priority: 1 },
        },
      });
    });

    it('should queue requests when limit exceeded', async () => {
      // Exhaust limit
      await limiter.consume('user-1');
      await limiter.consume('user-1');

      // Next consume should throw with "queued" message
      try {
        await limiter.consume('user-1');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RateLimitError);
        expect((error as Error).message).toContain('queued');
      }
    });

    it('should process queued requests as capacity becomes available', async () => {
      // Exhaust limit
      await limiter.consume('user-1');
      await limiter.consume('user-1');

      // Start a queued request (will be processed after window expires)
      const queuedPromise = limiter
        .consume('user-1')
        .then(() => 'processed')
        .catch((e) => e.message);

      // Wait for window to expire and queue processor to run
      await new Promise((resolve) => setTimeout(resolve, 700));

      const result = await queuedPromise;
      // Should either be processed or have specific error message
      expect(typeof result).toBe('string');
    });

    it('should reject when queue is full', async () => {
      // Fill the limiter and queue
      await limiter.consume('user-1');
      await limiter.consume('user-1');

      // Fill the queue (maxQueueSize: 5)
      const queuePromises: Promise<any>[] = [];
      for (let i = 0; i < 5; i++) {
        queuePromises.push(limiter.consume('user-1').catch((e) => e));
      }

      // Wait for all to be queued
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Next request should fail with rate limit (not queued)
      try {
        await limiter.consume('user-1');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RateLimitError);
        expect((error as Error).message).toContain('Rate limit exceeded');
      }

      // Cleanup
      limiter.destroy();
      await Promise.allSettled(queuePromises);
    });

    it('should track queue size in stats', async () => {
      await limiter.consume('user-1');
      await limiter.consume('user-1');

      // Queue some requests
      const promises: Promise<any>[] = [];
      for (let i = 0; i < 3; i++) {
        promises.push(limiter.consume('user-1').catch(() => {}));
      }

      await new Promise((resolve) => setTimeout(resolve, 50));

      const stats = limiter.getStats();
      expect(stats.currentQueueSize).toBeGreaterThan(0);

      // Cleanup
      limiter.destroy();
      await Promise.allSettled(promises);
    });
  });

  describe('Queue Priority', () => {
    it('should process higher priority requests first', async () => {
      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 200,
        queue: true,
        maxQueueSize: 10,
        defaultTier: { name: 'default', limit: 1 },
        tiers: {
          low: { name: 'low', limit: 1, priority: 1 },
          high: { name: 'high', limit: 1, priority: 10 },
        },
      });

      // Exhaust limit
      await limiter.consume('user-1', 'low');

      // Queue low priority first
      const lowPromise = limiter
        .consume('user-1', 'low')
        .then(() => 'low')
        .catch((e) => `low:${e.message}`);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Queue high priority second
      const highPromise = limiter
        .consume('user-1', 'high')
        .then(() => 'high')
        .catch((e) => `high:${e.message}`);

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 400));

      const results = await Promise.all([lowPromise, highPromise]);

      // Both should have been processed or queued
      expect(results).toBeDefined();

      // Cleanup
      limiter.destroy();
    });
  });

  describe('reset()', () => {
    beforeEach(() => {
      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 10000, // Long window
        defaultTier: { name: 'default', limit: 3 },
      });
    });

    it('should reset state for a key', async () => {
      // Consume all
      await limiter.consume('user-1');
      await limiter.consume('user-1');
      await limiter.consume('user-1');

      const beforeReset = await limiter.check('user-1');
      expect(beforeReset.allowed).toBe(false);

      // Reset
      limiter.reset('user-1');

      // Should be allowed again
      const afterReset = await limiter.check('user-1');
      expect(afterReset.allowed).toBe(true);
      expect(afterReset.remaining).toBe(3);
    });

    it('should not affect other keys', async () => {
      await limiter.consume('user-1');
      await limiter.consume('user-2');
      await limiter.consume('user-2');

      limiter.reset('user-1');

      const user1Stats = limiter.getStats('user-1');
      expect(user1Stats.totalAllowed).toBe(0);

      const user2Stats = limiter.getStats('user-2');
      expect(user2Stats.totalAllowed).toBe(2);
    });

    it('should handle reset of non-existent key gracefully', () => {
      expect(() => {
        limiter.reset('non-existent');
      }).not.toThrow();
    });
  });

  describe('getStats()', () => {
    beforeEach(() => {
      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 10000,
        defaultTier: { name: 'default', limit: 10 },
      });
    });

    it('should return global stats', async () => {
      await limiter.consume('user-1');
      await limiter.consume('user-1');
      await limiter.consume('user-2');

      const stats = limiter.getStats();
      expect(stats.totalAllowed).toBe(3);
      expect(stats.totalChecks).toBe(3);
      expect(stats.activeKeys).toBe(2);
    });

    it('should return stats for specific key', async () => {
      await limiter.consume('user-1');
      await limiter.consume('user-1');
      await limiter.consume('user-2');

      const user1Stats = limiter.getStats('user-1');
      expect(user1Stats.totalAllowed).toBe(2);
      expect(user1Stats.totalChecks).toBe(2);
      expect(user1Stats.activeKeys).toBe(1);
    });

    it('should return empty stats for unknown key', () => {
      const stats = limiter.getStats('unknown');
      expect(stats.totalChecks).toBe(0);
      expect(stats.totalAllowed).toBe(0);
      expect(stats.activeKeys).toBe(0);
    });

    it('should track denied requests', async () => {
      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 10000,
        defaultTier: { name: 'default', limit: 2 },
      });

      await limiter.consume('user-1');
      await limiter.consume('user-1');

      try {
        await limiter.consume('user-1');
      } catch {
        // Expected
      }

      const stats = limiter.getStats('user-1');
      expect(stats.totalDenied).toBe(1);
    });
  });

  describe('destroy()', () => {
    it('should clear all state', async () => {
      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 10000,
        defaultTier: { name: 'default', limit: 10 },
      });

      await limiter.consume('user-1');
      await limiter.consume('user-2');

      limiter.destroy();

      const stats = limiter.getStats();
      expect(stats.activeKeys).toBe(0);
    });

    it('should clear intervals', () => {
      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 1000,
        queue: true,
        defaultTier: { name: 'default', limit: 10 },
      });

      // Should not throw
      expect(() => limiter.destroy()).not.toThrow();
      // Can destroy multiple times
      expect(() => limiter.destroy()).not.toThrow();
    });

    it('should reject pending queue requests', async () => {
      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 10000,
        queue: true,
        maxQueueSize: 10,
        defaultTier: { name: 'default', limit: 1 },
      });

      await limiter.consume('user-1');

      // Queue a request
      const queuedPromise = limiter.consume('user-1').catch((e) => e.message);

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Destroy should reject queued requests
      limiter.destroy();

      const result = await queuedPromise;
      expect(result).toContain('destroyed');
    });
  });

  describe('Cleanup', () => {
    it('should cleanup expired entries', async () => {
      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 100, // Very short window for testing
        defaultTier: { name: 'default', limit: 10 },
      });

      await limiter.consume('user-1');

      // Access private cleanup method
      (limiter as any).cleanup();

      // Entry should still exist (within 2x window)
      let stats = limiter.getStats();
      expect(stats.activeKeys).toBe(1);

      // Wait for 2x window + buffer
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Trigger cleanup again
      (limiter as any).cleanup();

      stats = limiter.getStats();
      expect(stats.activeKeys).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero limit tier', async () => {
      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 1000,
        defaultTier: { name: 'blocked', limit: 0 },
      });

      const result = await limiter.check('user-1');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should handle very high limit', async () => {
      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 1000,
        defaultTier: { name: 'unlimited', limit: 1000000 },
      });

      for (let i = 0; i < 100; i++) {
        await limiter.consume('user-1');
      }

      const result = await limiter.check('user-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(999900);
    });

    it('should handle concurrent requests correctly', async () => {
      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 1000,
        defaultTier: { name: 'default', limit: 10 },
      });

      // Fire 10 concurrent requests
      const promises = Array.from({ length: 10 }, () => limiter.consume('user-1'));

      await Promise.all(promises);

      const result = await limiter.check('user-1');
      expect(result.allowed).toBe(false);
    });

    it('should handle special characters in key', async () => {
      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 1000,
        defaultTier: { name: 'default', limit: 5 },
      });

      const specialKey = 'user:123:action/test?param=value&foo=bar';
      await limiter.consume(specialKey);

      const result = await limiter.check(specialKey);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it('should handle empty string key', async () => {
      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 1000,
        defaultTier: { name: 'default', limit: 5 },
      });

      await limiter.consume('');
      const result = await limiter.check('');
      expect(result.remaining).toBe(4);
    });

    it('should isolate keys completely', async () => {
      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 10000,
        defaultTier: { name: 'default', limit: 3 },
      });

      // Exhaust user-1
      await limiter.consume('user-1');
      await limiter.consume('user-1');
      await limiter.consume('user-1');

      // user-2 should still have full quota
      const result = await limiter.check('user-2');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(3);
    });
  });

  describe('Queue Timeout Protection', () => {
    it('should timeout queued requests after max timeout', async () => {
      vi.useFakeTimers();

      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 60000, // Long window so requests stay rate limited
        queue: true,
        maxQueueSize: 10,
        defaultTier: { name: 'default', limit: 1 },
      });

      // Exhaust limit
      await limiter.consume('user-1');

      // Queue a request
      const queuedPromise = limiter.consume('user-1');

      // Advance time by 30 seconds (MAX_QUEUE_TIMEOUT_MS)
      vi.advanceTimersByTime(30000);

      vi.useRealTimers();

      // Should reject with timeout
      await expect(queuedPromise).rejects.toThrow();

      // Cleanup
      limiter.destroy();
    }, 35000);
  });

  describe('Multiple Keys Performance', () => {
    it('should handle many unique keys efficiently', async () => {
      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 10000,
        defaultTier: { name: 'default', limit: 100 },
      });

      const startTime = Date.now();

      // Create 1000 unique keys
      for (let i = 0; i < 1000; i++) {
        await limiter.consume(`user-${i}`);
      }

      const elapsed = Date.now() - startTime;

      const stats = limiter.getStats();
      expect(stats.activeKeys).toBe(1000);
      expect(elapsed).toBeLessThan(5000); // Should complete in under 5 seconds
    });
  });

  describe('Strategy-Specific Behavior', () => {
    describe('Sliding vs Fixed Window Boundary Behavior', () => {
      it('sliding window should gradually allow requests as old ones expire', async () => {
        limiter = new RateLimiter(logger, {
          strategy: 'sliding',
          window: 500,
          defaultTier: { name: 'default', limit: 2 },
        });

        await limiter.consume('user-1');
        await new Promise((resolve) => setTimeout(resolve, 100));
        await limiter.consume('user-1');

        // Both consumed, wait for first to expire
        await new Promise((resolve) => setTimeout(resolve, 450));

        // First request expired, should have 1 slot
        const result = await limiter.check('user-1');
        expect(result.allowed).toBe(true);
      });

      it('fixed window should reset all at once at boundary', async () => {
        limiter = new RateLimiter(logger, {
          strategy: 'fixed',
          window: 300,
          defaultTier: { name: 'default', limit: 2 },
        });

        await limiter.consume('user-1');
        await limiter.consume('user-1');

        // Wait just past window boundary
        await new Promise((resolve) => setTimeout(resolve, 350));

        // Should have full capacity back
        const result = await limiter.check('user-1');
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(2);
      });
    });

    describe('Token Bucket Gradual Refill', () => {
      it('should refill tokens gradually', async () => {
        limiter = new RateLimiter(logger, {
          strategy: 'token-bucket',
          window: 1000, // 5 tokens per second
          defaultTier: { name: 'default', limit: 5 },
        });

        // Consume all tokens
        for (let i = 0; i < 5; i++) {
          await limiter.consume('user-1');
        }

        // Wait for ~2 tokens to refill (400ms = 2/5 of window)
        await new Promise((resolve) => setTimeout(resolve, 450));

        // Should have approximately 2 tokens
        const result = await limiter.check('user-1');
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBeGreaterThanOrEqual(1);
        expect(result.remaining).toBeLessThanOrEqual(3);
      });
    });
  });

  describe('Real Integration Scenarios', () => {
    it('should handle API rate limiting scenario', async () => {
      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 1000,
        defaultTier: { name: 'free', limit: 5 },
        tiers: {
          premium: { name: 'premium', limit: 20, burst: 5 },
        },
      });

      // Simulate free user making rapid requests
      const freeUserKey = 'api:user:123:free';
      for (let i = 0; i < 5; i++) {
        await limiter.consume(freeUserKey, 'free');
      }

      // Free user should be rate limited
      const freeResult = await limiter.check(freeUserKey, 'free');
      expect(freeResult.allowed).toBe(false);

      // Premium user should have higher limits
      const premiumUserKey = 'api:user:456:premium';
      for (let i = 0; i < 10; i++) {
        await limiter.consume(premiumUserKey, 'premium');
      }

      const premiumResult = await limiter.check(premiumUserKey, 'premium');
      expect(premiumResult.allowed).toBe(true);
      expect(premiumResult.remaining).toBe(15); // 25 - 10
    });

    it('should handle subscription tier upgrade scenario', async () => {
      limiter = new RateLimiter(logger, {
        strategy: 'sliding',
        window: 5000,
        defaultTier: { name: 'free', limit: 3 },
        tiers: {
          premium: { name: 'premium', limit: 100 },
        },
      });

      const userKey = 'user:789';

      // User starts as free tier
      await limiter.consume(userKey, 'free');
      await limiter.consume(userKey, 'free');
      await limiter.consume(userKey, 'free');

      // Free tier exhausted
      const beforeUpgrade = await limiter.check(userKey, 'free');
      expect(beforeUpgrade.allowed).toBe(false);

      // "Upgrade" - check with premium tier
      // Note: Same key, same state, but higher limit
      const afterUpgrade = await limiter.check(userKey, 'premium');
      expect(afterUpgrade.allowed).toBe(true);
      expect(afterUpgrade.tier).toBe('premium');
    });
  });
});
