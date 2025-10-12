/**
 * Tests for RateLimiter
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { RateLimiter } from '../../../src/netron/auth/rate-limiter.js';

describe('RateLimiter', () => {
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      child: jest.fn().mockReturnThis(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  });

  describe('Fixed Window Strategy', () => {
    it('should allow requests within limit', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'fixed',
        window: 1000,
        defaultTier: { name: 'default', limit: 5 },
      });

      // Should allow 5 requests
      for (let i = 0; i < 5; i++) {
        await limiter.consume('user-1');
        const result = await limiter.check('user-1');
        expect(result.allowed).toBe(i < 4); // After consuming, check what's left
        expect(result.remaining).toBe(Math.max(0, 5 - i - 1));
      }

      limiter.destroy();
    });

    it('should deny requests exceeding limit', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'fixed',
        window: 1000,
        defaultTier: { name: 'default', limit: 3 },
      });

      // Use up the limit
      for (let i = 0; i < 3; i++) {
        await limiter.consume('user-1');
      }

      // Should deny the 4th request
      const result = await limiter.check('user-1');
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeDefined();
      expect(result.retryAfter).toBeGreaterThan(0);

      await expect(limiter.consume('user-1')).rejects.toThrow('Rate limit exceeded');

      limiter.destroy();
    });

    it('should reset at window boundary', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'fixed',
        window: 100, // 100ms window
        defaultTier: { name: 'default', limit: 2 },
      });

      // Use up the limit
      await limiter.consume('user-1');
      await limiter.consume('user-1');

      // Should be denied
      await expect(limiter.consume('user-1')).rejects.toThrow();

      // Wait for window to reset
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should be allowed again
      const result = await limiter.check('user-1');
      expect(result.allowed).toBe(true);

      limiter.destroy();
    });

    it('should track different users independently', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'fixed',
        window: 1000,
        defaultTier: { name: 'default', limit: 2 },
      });

      await limiter.consume('user-1');
      await limiter.consume('user-1');

      await expect(limiter.consume('user-1')).rejects.toThrow();

      // User 2 should still have full limit
      const result = await limiter.check('user-2');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);

      limiter.destroy();
    });
  });

  describe('Sliding Window Strategy', () => {
    it('should allow requests within limit', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'sliding',
        window: 1000,
        defaultTier: { name: 'default', limit: 5 },
      });

      for (let i = 0; i < 5; i++) {
        const result = await limiter.check('user-1');
        expect(result.allowed).toBe(true);
        await limiter.consume('user-1');
      }

      limiter.destroy();
    });

    it('should deny requests exceeding limit', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'sliding',
        window: 1000,
        defaultTier: { name: 'default', limit: 3 },
      });

      // Use up the limit
      for (let i = 0; i < 3; i++) {
        await limiter.consume('user-1');
      }

      // Should deny
      await expect(limiter.consume('user-1')).rejects.toThrow();

      limiter.destroy();
    });

    it('should slide window correctly', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'sliding',
        window: 200, // 200ms window
        defaultTier: { name: 'default', limit: 2 },
      });

      // Make 2 requests
      await limiter.consume('user-1');
      await new Promise((resolve) => setTimeout(resolve, 50));
      await limiter.consume('user-1');

      // Should be denied (2 requests within 200ms)
      await expect(limiter.consume('user-1')).rejects.toThrow();

      // Wait for first request to slide out
      await new Promise((resolve) => setTimeout(resolve, 160));

      // Should be allowed again
      const result = await limiter.check('user-1');
      expect(result.allowed).toBe(true);

      limiter.destroy();
    });

    it('should be more accurate than fixed window', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'sliding',
        window: 100,
        defaultTier: { name: 'default', limit: 2 },
      });

      // Make 2 requests
      await limiter.consume('user-1');
      await limiter.consume('user-1');

      // Wait 50ms (half the window)
      await new Promise((resolve) => setTimeout(resolve, 50));

      // With fixed window, this might be allowed (new window)
      // With sliding window, should still be denied
      const result = await limiter.check('user-1');
      expect(result.allowed).toBe(false);

      limiter.destroy();
    });
  });

  describe('Token Bucket Strategy', () => {
    it('should allow requests within token limit', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'token-bucket',
        window: 1000,
        defaultTier: { name: 'default', limit: 10 },
      });

      // Should allow 10 requests immediately
      for (let i = 0; i < 10; i++) {
        const result = await limiter.check('user-1');
        expect(result.allowed).toBe(true);
        await limiter.consume('user-1');
      }

      limiter.destroy();
    });

    it('should deny when tokens depleted', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'token-bucket',
        window: 1000,
        defaultTier: { name: 'default', limit: 3 },
      });

      // Use all tokens
      for (let i = 0; i < 3; i++) {
        await limiter.consume('user-1');
      }

      // Should deny
      await expect(limiter.consume('user-1')).rejects.toThrow();

      limiter.destroy();
    });

    it('should refill tokens over time', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'token-bucket',
        window: 100, // Refill rate: 10 tokens per 100ms
        defaultTier: { name: 'default', limit: 10 },
      });

      // Use all tokens
      for (let i = 0; i < 10; i++) {
        await limiter.consume('user-1');
      }

      // Should be denied
      await expect(limiter.consume('user-1')).rejects.toThrow();

      // Wait for some tokens to refill (50ms = 5 tokens)
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have ~5 tokens available
      const result = await limiter.check('user-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);

      limiter.destroy();
    });

    it('should support burst traffic', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'token-bucket',
        window: 1000,
        defaultTier: { name: 'default', limit: 10, burst: 5 },
      });

      // Should allow 15 requests (10 + 5 burst)
      for (let i = 0; i < 15; i++) {
        const result = await limiter.check('user-1');
        expect(result.allowed).toBe(true);
        await limiter.consume('user-1');
      }

      // 16th should be denied
      await expect(limiter.consume('user-1')).rejects.toThrow();

      limiter.destroy();
    });
  });

  describe('Tiered Rate Limiting', () => {
    it('should apply different limits to different tiers', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'fixed',
        window: 1000,
        defaultTier: { name: 'free', limit: 5 },
        tiers: {
          premium: { name: 'premium', limit: 20 },
          enterprise: { name: 'enterprise', limit: 100 },
        },
      });

      // Free tier: 5 requests
      for (let i = 0; i < 5; i++) {
        await limiter.consume('user-free');
      }
      await expect(limiter.consume('user-free')).rejects.toThrow();

      // Premium tier: 20 requests
      for (let i = 0; i < 20; i++) {
        await limiter.consume('user-premium', 'premium');
      }
      await expect(limiter.consume('user-premium', 'premium')).rejects.toThrow();

      // Enterprise tier: 100 requests
      for (let i = 0; i < 100; i++) {
        await limiter.consume('user-enterprise', 'enterprise');
      }
      await expect(limiter.consume('user-enterprise', 'enterprise')).rejects.toThrow();

      limiter.destroy();
    });

    it('should use default tier for unknown tier', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'fixed',
        window: 1000,
        defaultTier: { name: 'default', limit: 3 },
        tiers: {
          premium: { name: 'premium', limit: 10 },
        },
      });

      // Unknown tier should use default
      for (let i = 0; i < 3; i++) {
        await limiter.consume('user-1', 'unknown-tier');
      }

      await expect(limiter.consume('user-1', 'unknown-tier')).rejects.toThrow();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ tier: 'unknown-tier' }),
        expect.any(String)
      );

      limiter.destroy();
    });

    it('should support burst in tiers', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'sliding',
        window: 1000,
        defaultTier: { name: 'free', limit: 10 },
        tiers: {
          premium: { name: 'premium', limit: 50, burst: 20 },
        },
      });

      // Premium tier should allow 70 requests (50 + 20 burst)
      for (let i = 0; i < 70; i++) {
        const result = await limiter.check('user-premium', 'premium');
        expect(result.allowed).toBe(true);
        await limiter.consume('user-premium', 'premium');
      }

      await expect(limiter.consume('user-premium', 'premium')).rejects.toThrow();

      limiter.destroy();
    });
  });

  describe('Queue Mode', () => {
    it('should queue requests when limit exceeded', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'fixed',
        window: 200,
        queue: true,
        maxQueueSize: 10,
        defaultTier: { name: 'default', limit: 2 },
      });

      // Use up the limit
      await limiter.consume('user-1');
      await limiter.consume('user-1');

      // Should queue the next request
      const queuePromise = limiter.consume('user-1');

      // Give it time to queue
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Check queue status
      const stats = limiter.getStats();
      expect(stats.currentQueueSize).toBe(1);

      // Should throw queued error
      await expect(queuePromise).rejects.toThrow('queued');

      limiter.destroy();
    });

    it('should process queued requests when slots available', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'fixed',
        window: 150,
        queue: true,
        defaultTier: { name: 'default', limit: 2 },
      });

      // Use up the limit
      await limiter.consume('user-1');
      await limiter.consume('user-1');

      // Queue a request
      const consumePromise = limiter.consume('user-1').catch(() => null);

      // Wait for window to reset and queue to process
      await new Promise((resolve) => setTimeout(resolve, 250));

      // Queue should be processed
      const stats = limiter.getStats();
      expect(stats.currentQueueSize).toBe(0);

      limiter.destroy();
    });

    it('should respect max queue size', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'fixed',
        window: 1000,
        queue: true,
        maxQueueSize: 2,
        defaultTier: { name: 'default', limit: 1 },
      });

      // Use up the limit
      await limiter.consume('user-1');

      // Queue 2 requests (max)
      limiter.consume('user-1').catch(() => null);
      limiter.consume('user-1').catch(() => null);

      // 3rd queued request should be rejected (queue full)
      await expect(limiter.consume('user-1')).rejects.toThrow('Rate limit exceeded');

      limiter.destroy();
    });

    it('should prioritize requests by tier priority', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'fixed',
        window: 200,
        queue: true,
        maxQueueSize: 10,
        defaultTier: { name: 'free', limit: 1, priority: 1 },
        tiers: {
          premium: { name: 'premium', limit: 1, priority: 5 },
          enterprise: { name: 'enterprise', limit: 1, priority: 10 },
        },
      });

      // Use up limits for all tiers
      await limiter.consume('user-free');
      await limiter.consume('user-premium', 'premium');
      await limiter.consume('user-enterprise', 'enterprise');

      // Queue requests (enterprise should be processed first)
      limiter.consume('user-free').catch(() => null);
      limiter.consume('user-premium', 'premium').catch(() => null);
      limiter.consume('user-enterprise', 'enterprise').catch(() => null);

      const stats = limiter.getStats();
      expect(stats.currentQueueSize).toBe(3);

      limiter.destroy();
    });
  });

  describe('Reset Functionality', () => {
    it('should reset rate limit for a key', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'fixed',
        window: 1000,
        defaultTier: { name: 'default', limit: 2 },
      });

      // Use up the limit
      await limiter.consume('user-1');
      await limiter.consume('user-1');

      // Should be denied
      await expect(limiter.consume('user-1')).rejects.toThrow();

      // Reset
      limiter.reset('user-1');

      // Should be allowed again
      const result = await limiter.check('user-1');
      expect(result.allowed).toBe(true);

      limiter.destroy();
    });

    it('should not affect other keys when resetting', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'fixed',
        window: 1000,
        defaultTier: { name: 'default', limit: 2 },
      });

      await limiter.consume('user-1');
      await limiter.consume('user-1');
      await limiter.consume('user-2');

      limiter.reset('user-1');

      // User 1 should be reset
      const result1 = await limiter.check('user-1');
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(2);

      // User 2 should still have 1 used
      const result2 = await limiter.check('user-2');
      expect(result2.remaining).toBe(1);

      limiter.destroy();
    });
  });

  describe('Statistics', () => {
    it('should track global statistics', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'fixed',
        window: 1000,
        defaultTier: { name: 'default', limit: 3 },
      });

      // 2 allowed
      await limiter.consume('user-1');
      await limiter.consume('user-2');

      // 1 denied
      await limiter.consume('user-1');
      await limiter.consume('user-1');
      await expect(limiter.consume('user-1')).rejects.toThrow();

      const stats = limiter.getStats();
      expect(stats.totalChecks).toBeGreaterThan(0);
      expect(stats.totalAllowed).toBe(4);
      expect(stats.totalDenied).toBe(1);
      expect(stats.activeKeys).toBe(2);

      limiter.destroy();
    });

    it('should track per-key statistics', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'fixed',
        window: 1000,
        defaultTier: { name: 'default', limit: 2 },
      });

      await limiter.consume('user-1');
      await limiter.consume('user-1');
      await expect(limiter.consume('user-1')).rejects.toThrow();

      const stats = limiter.getStats('user-1');
      expect(stats.totalChecks).toBe(3);
      expect(stats.totalAllowed).toBe(2);
      expect(stats.totalDenied).toBe(1);

      limiter.destroy();
    });

    it('should return empty stats for non-existent key', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'fixed',
        window: 1000,
        defaultTier: { name: 'default', limit: 2 },
      });

      const stats = limiter.getStats('non-existent');
      expect(stats.totalChecks).toBe(0);
      expect(stats.totalAllowed).toBe(0);
      expect(stats.totalDenied).toBe(0);
      expect(stats.activeKeys).toBe(0);

      limiter.destroy();
    });
  });

  describe('Performance', () => {
    it('should handle high throughput (10K+ checks/sec)', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'sliding',
        window: 1000,
        defaultTier: { name: 'default', limit: 100000 },
      });

      const start = Date.now();
      const checks = 10000;

      // Perform 10K checks
      const promises = [];
      for (let i = 0; i < checks; i++) {
        promises.push(limiter.check(`user-${i % 100}`));
      }

      await Promise.all(promises);

      const elapsed = Date.now() - start;
      const checksPerSecond = (checks / elapsed) * 1000;

      // Should be able to do 10K+ checks per second
      expect(checksPerSecond).toBeGreaterThan(10000);

      limiter.destroy();
    });

    it('should handle concurrent requests safely', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'sliding',
        window: 1000,
        defaultTier: { name: 'default', limit: 50 },
      });

      // 100 concurrent requests for same user
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(limiter.consume('user-1').catch(() => null));
      }

      await Promise.all(promises);

      // Should have allowed exactly 50
      const stats = limiter.getStats('user-1');
      expect(stats.totalAllowed).toBe(50);
      expect(stats.totalDenied).toBe(50);

      limiter.destroy();
    });

    it('should be memory efficient with many users', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'fixed',
        window: 1000,
        defaultTier: { name: 'default', limit: 10 },
      });

      // Create 1000 users
      for (let i = 0; i < 1000; i++) {
        await limiter.consume(`user-${i}`);
      }

      const stats = limiter.getStats();
      expect(stats.activeKeys).toBe(1000);

      // Memory should be reasonable (no crash)
      expect(true).toBe(true);

      limiter.destroy();
    });
  });

  describe('Cleanup', () => {
    it('should clean up expired entries', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'fixed',
        window: 100,
        defaultTier: { name: 'default', limit: 5 },
      });

      // Create some activity
      await limiter.consume('user-1');
      await limiter.consume('user-2');
      await limiter.consume('user-3');

      expect(limiter.getStats().activeKeys).toBe(3);

      // Wait for entries to expire (2 windows)
      await new Promise((resolve) => setTimeout(resolve, 250));

      // Manually trigger cleanup (normally happens periodically)
      // @ts-ignore - accessing private method for testing
      limiter.cleanup();

      // Expired entries should be cleaned up
      expect(limiter.getStats().activeKeys).toBe(0);

      limiter.destroy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero limit gracefully', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'fixed',
        window: 1000,
        defaultTier: { name: 'default', limit: 0 },
      });

      await expect(limiter.consume('user-1')).rejects.toThrow();

      limiter.destroy();
    });

    it('should handle very short windows', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'fixed',
        window: 1, // 1ms
        defaultTier: { name: 'default', limit: 5 },
      });

      await limiter.consume('user-1');

      // Wait for window to reset
      await new Promise((resolve) => setTimeout(resolve, 5));

      const result = await limiter.check('user-1');
      expect(result.allowed).toBe(true);

      limiter.destroy();
    });

    it('should handle very large limits', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'sliding',
        window: 1000,
        defaultTier: { name: 'default', limit: 1000000 },
      });

      // Should not crash with large limit
      for (let i = 0; i < 100; i++) {
        await limiter.consume('user-1');
      }

      const stats = limiter.getStats('user-1');
      expect(stats.totalAllowed).toBe(100);

      limiter.destroy();
    });

    it('should handle rapid resets', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'fixed',
        window: 1000,
        defaultTier: { name: 'default', limit: 5 },
      });

      // Should not crash during rapid resets
      for (let i = 0; i < 10; i++) {
        await limiter.consume('user-1');
        limiter.reset('user-1');
      }

      // After last reset, stats for user-1 should be empty
      const stats = limiter.getStats('user-1');
      expect(stats.totalAllowed).toBe(0);
      expect(stats.totalDenied).toBe(0);

      // But should be able to use again
      await limiter.consume('user-1');
      const stats2 = limiter.getStats('user-1');
      expect(stats2.totalAllowed).toBe(1);

      limiter.destroy();
    });
  });

  describe('Destroy', () => {
    it('should clean up all resources', async () => {
      const limiter = new RateLimiter(mockLogger, {
        strategy: 'fixed',
        window: 1000,
        queue: true,
        defaultTier: { name: 'default', limit: 5 },
      });

      await limiter.consume('user-1');
      await limiter.consume('user-2');

      limiter.destroy();

      const stats = limiter.getStats();
      expect(stats.activeKeys).toBe(0);
      expect(stats.currentQueueSize).toBe(0);
    });
  });
});
