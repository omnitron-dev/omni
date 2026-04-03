/**
 * Tests for Retry Strategies
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createRetryDelayFn, RetryStrategies } from '../../../src/utils/retry.js';
import type { IncomingNotification } from '../../../src/modules/notifications/transport/transport.interface.js';

describe('Retry Strategies', () => {
  let mockNotification: IncomingNotification;

  beforeEach(() => {
    mockNotification = createMockNotification();
  });

  describe('createRetryDelayFn', () => {
    describe('exponential backoff', () => {
      it('should create exponential backoff function', () => {
        const fn = createRetryDelayFn({
          strategy: 'exponential',
          baseDelay: 1000,
          multiplier: 2,
          maxDelay: 10000,
          jitter: 0, // Disable jitter for predictable tests
        });

        expect(fn(1, mockNotification)).toBe(1000); // 1000 * 2^0
        expect(fn(2, mockNotification)).toBe(2000); // 1000 * 2^1
        expect(fn(3, mockNotification)).toBe(4000); // 1000 * 2^2
        expect(fn(4, mockNotification)).toBe(8000); // 1000 * 2^3
      });

      it('should respect maxDelay cap', () => {
        const fn = createRetryDelayFn({
          strategy: 'exponential',
          baseDelay: 1000,
          multiplier: 2,
          maxDelay: 5000,
          jitter: 0,
        });

        expect(fn(1, mockNotification)).toBe(1000);
        expect(fn(2, mockNotification)).toBe(2000);
        expect(fn(3, mockNotification)).toBe(4000);
        expect(fn(4, mockNotification)).toBe(5000); // Capped at maxDelay
        expect(fn(10, mockNotification)).toBe(5000); // Still capped
      });

      it('should work with different multipliers', () => {
        const fn = createRetryDelayFn({
          strategy: 'exponential',
          baseDelay: 100,
          multiplier: 3,
          maxDelay: 10000,
          jitter: 0,
        });

        expect(fn(1, mockNotification)).toBe(100); // 100 * 3^0
        expect(fn(2, mockNotification)).toBe(300); // 100 * 3^1
        expect(fn(3, mockNotification)).toBe(900); // 100 * 3^2
        expect(fn(4, mockNotification)).toBe(2700); // 100 * 3^3
      });
    });

    describe('linear backoff', () => {
      it('should create linear backoff function', () => {
        const fn = createRetryDelayFn({
          strategy: 'linear',
          baseDelay: 1000,
          maxDelay: 10000,
          jitter: 0,
        });

        expect(fn(1, mockNotification)).toBe(1000); // 1000 * 1
        expect(fn(2, mockNotification)).toBe(2000); // 1000 * 2
        expect(fn(3, mockNotification)).toBe(3000); // 1000 * 3
        expect(fn(5, mockNotification)).toBe(5000); // 1000 * 5
      });

      it('should respect maxDelay cap', () => {
        const fn = createRetryDelayFn({
          strategy: 'linear',
          baseDelay: 1000,
          maxDelay: 3000,
          jitter: 0,
        });

        expect(fn(1, mockNotification)).toBe(1000);
        expect(fn(2, mockNotification)).toBe(2000);
        expect(fn(3, mockNotification)).toBe(3000);
        expect(fn(4, mockNotification)).toBe(3000); // Capped
        expect(fn(10, mockNotification)).toBe(3000); // Still capped
      });
    });

    describe('fixed delay', () => {
      it('should create fixed delay function', () => {
        const fn = createRetryDelayFn({
          strategy: 'fixed',
          baseDelay: 2000,
          jitter: 0,
        });

        expect(fn(1, mockNotification)).toBe(2000);
        expect(fn(2, mockNotification)).toBe(2000);
        expect(fn(5, mockNotification)).toBe(2000);
        expect(fn(10, mockNotification)).toBe(2000);
      });

      it('should respect maxDelay for fixed strategy', () => {
        const fn = createRetryDelayFn({
          strategy: 'fixed',
          baseDelay: 5000,
          maxDelay: 1000, // maxDelay caps the fixed delay
          jitter: 0,
        });

        // maxDelay caps the fixed delay to 1000
        expect(fn(1, mockNotification)).toBe(1000);
        expect(fn(10, mockNotification)).toBe(1000);
      });
    });

    describe('fibonacci sequence', () => {
      it('should create fibonacci backoff function', () => {
        const fn = createRetryDelayFn({
          strategy: 'fibonacci',
          baseDelay: 100,
          maxDelay: 10000,
          jitter: 0,
        });

        // Fibonacci: 1, 2, 3, 5, 8, 13, 21, 34...
        expect(fn(1, mockNotification)).toBe(100); // 100 * 1
        expect(fn(2, mockNotification)).toBe(200); // 100 * 2
        expect(fn(3, mockNotification)).toBe(300); // 100 * 3
        expect(fn(4, mockNotification)).toBe(500); // 100 * 5
        expect(fn(5, mockNotification)).toBe(800); // 100 * 8
        expect(fn(6, mockNotification)).toBe(1300); // 100 * 13
        expect(fn(7, mockNotification)).toBe(2100); // 100 * 21
      });

      it('should respect maxDelay cap', () => {
        const fn = createRetryDelayFn({
          strategy: 'fibonacci',
          baseDelay: 1000,
          maxDelay: 5000,
          jitter: 0,
        });

        expect(fn(1, mockNotification)).toBe(1000);
        expect(fn(2, mockNotification)).toBe(2000);
        expect(fn(3, mockNotification)).toBe(3000);
        expect(fn(4, mockNotification)).toBe(5000); // Capped (would be 5000)
        expect(fn(5, mockNotification)).toBe(5000); // Capped (would be 8000)
      });
    });

    describe('custom delay function', () => {
      it('should use custom delay function when provided', () => {
        const customFn = (attempt: number, notification: IncomingNotification): number => attempt * 500 + 100;

        const fn = createRetryDelayFn({
          customDelayFn: customFn,
          // These should be ignored when customDelayFn is provided
          strategy: 'exponential',
          baseDelay: 1000,
        });

        expect(fn(1, mockNotification)).toBe(600); // 1 * 500 + 100
        expect(fn(2, mockNotification)).toBe(1100); // 2 * 500 + 100
        expect(fn(3, mockNotification)).toBe(1600); // 3 * 500 + 100
      });

      it('should pass notification to custom function', () => {
        let capturedNotification: IncomingNotification | null = null;

        const customFn = (attempt: number, notification: IncomingNotification): number => {
          capturedNotification = notification;
          return 1000;
        };

        const fn = createRetryDelayFn({ customDelayFn: customFn });
        fn(1, mockNotification);

        expect(capturedNotification).toBe(mockNotification);
      });
    });

    describe('jitter application', () => {
      it('should apply jitter to delay', () => {
        const fn = createRetryDelayFn({
          strategy: 'fixed',
          baseDelay: 1000,
          jitter: 0.2, // 20% jitter
        });

        // Run multiple times to check jitter variance
        const delays = Array.from({ length: 100 }, () => fn(1, mockNotification));

        // All delays should be within ±20% of base delay (800-1200ms)
        const allInRange = delays.every((delay) => delay >= 800 && delay <= 1200);
        expect(allInRange).toBe(true);

        // Should have some variance (not all the same)
        const uniqueDelays = new Set(delays);
        expect(uniqueDelays.size).toBeGreaterThan(1);
      });

      it('should ensure non-negative delays with jitter', () => {
        const fn = createRetryDelayFn({
          strategy: 'fixed',
          baseDelay: 10,
          jitter: 2, // 200% jitter (extreme case)
        });

        // Even with extreme jitter, delay should not be negative
        const delays = Array.from({ length: 100 }, () => fn(1, mockNotification));
        const allNonNegative = delays.every((delay) => delay >= 0);
        expect(allNonNegative).toBe(true);
      });

      it('should round delay to integer', () => {
        const fn = createRetryDelayFn({
          strategy: 'exponential',
          baseDelay: 1000,
          multiplier: 1.5,
          jitter: 0.1,
        });

        const delay = fn(2, mockNotification);
        expect(Number.isInteger(delay)).toBe(true);
      });
    });

    describe('default values', () => {
      it('should use default values when config is empty', () => {
        const fn = createRetryDelayFn({});

        // Default: exponential, baseDelay: 1000, multiplier: 2
        // Jitter is enabled by default, so we check range
        const delay = fn(1, mockNotification);
        expect(delay).toBeGreaterThan(0);
        expect(delay).toBeLessThanOrEqual(1200); // 1000 + 10% jitter
      });

      it('should use default values for missing properties', () => {
        const fn = createRetryDelayFn({
          strategy: 'linear',
          // Missing baseDelay, maxDelay, jitter
        });

        const delay = fn(2, mockNotification);
        expect(delay).toBeGreaterThan(0);
      });
    });
  });

  describe('RetryStrategies presets', () => {
    describe('aggressive()', () => {
      it('should return quick retry config', () => {
        const config = RetryStrategies.aggressive();

        expect(config.strategy).toBe('exponential');
        expect(config.baseDelay).toBe(100);
        expect(config.maxDelay).toBe(10000);
        expect(config.multiplier).toBe(3);
        expect(config.jitter).toBe(0.2);
      });

      it('should create fast-growing delays', () => {
        const config = RetryStrategies.aggressive();
        const fn = createRetryDelayFn({ ...config, jitter: 0 });

        const delay1 = fn(1, mockNotification);
        const delay2 = fn(2, mockNotification);
        const delay3 = fn(3, mockNotification);

        expect(delay1).toBe(100);
        expect(delay2).toBe(300);
        expect(delay3).toBe(900);
      });
    });

    describe('conservative()', () => {
      it('should return slow retry config', () => {
        const config = RetryStrategies.conservative();

        expect(config.strategy).toBe('exponential');
        expect(config.baseDelay).toBe(5000);
        expect(config.maxDelay).toBe(120000);
        expect(config.multiplier).toBe(1.5);
        expect(config.jitter).toBe(0.1);
      });

      it('should create slow-growing delays', () => {
        const config = RetryStrategies.conservative();
        const fn = createRetryDelayFn({ ...config, jitter: 0 });

        const delay1 = fn(1, mockNotification);
        const delay2 = fn(2, mockNotification);

        expect(delay1).toBe(5000);
        expect(delay2).toBe(7500); // 5000 * 1.5
      });
    });

    describe('immediate()', () => {
      it('should return fixed immediate retry config', () => {
        const config = RetryStrategies.immediate();

        expect(config.strategy).toBe('fixed');
        expect(config.baseDelay).toBe(100);
        expect(config.jitter).toBe(0);
      });

      it('should create constant small delays', () => {
        const config = RetryStrategies.immediate();
        const fn = createRetryDelayFn(config);

        expect(fn(1, mockNotification)).toBe(100);
        expect(fn(5, mockNotification)).toBe(100);
        expect(fn(10, mockNotification)).toBe(100);
      });
    });

    describe('linear()', () => {
      it('should return linear backoff config with default baseDelay', () => {
        const config = RetryStrategies.linear();

        expect(config.strategy).toBe('linear');
        expect(config.baseDelay).toBe(1000);
        expect(config.maxDelay).toBe(30000);
        expect(config.jitter).toBe(0.1);
      });

      it('should accept custom baseDelay', () => {
        const config = RetryStrategies.linear(2000);

        expect(config.baseDelay).toBe(2000);
      });

      it('should create linear delays', () => {
        const config = RetryStrategies.linear(500);
        const fn = createRetryDelayFn({ ...config, jitter: 0 });

        expect(fn(1, mockNotification)).toBe(500);
        expect(fn(2, mockNotification)).toBe(1000);
        expect(fn(3, mockNotification)).toBe(1500);
      });
    });

    describe('fibonacci()', () => {
      it('should return fibonacci backoff config with default baseDelay', () => {
        const config = RetryStrategies.fibonacci();

        expect(config.strategy).toBe('fibonacci');
        expect(config.baseDelay).toBe(500);
        expect(config.maxDelay).toBe(60000);
        expect(config.jitter).toBe(0.15);
      });

      it('should accept custom baseDelay', () => {
        const config = RetryStrategies.fibonacci(1000);

        expect(config.baseDelay).toBe(1000);
      });

      it('should create fibonacci delays', () => {
        const config = RetryStrategies.fibonacci(100);
        const fn = createRetryDelayFn({ ...config, jitter: 0 });

        expect(fn(1, mockNotification)).toBe(100);
        expect(fn(2, mockNotification)).toBe(200);
        expect(fn(3, mockNotification)).toBe(300);
        expect(fn(4, mockNotification)).toBe(500);
      });
    });
  });

  describe('edge cases', () => {
    it('should handle attempt = 0', () => {
      const fn = createRetryDelayFn({
        strategy: 'exponential',
        baseDelay: 1000,
        jitter: 0,
      });

      // attempt 0 should still work (though typically starts at 1)
      const delay = fn(0, mockNotification);
      expect(delay).toBeGreaterThanOrEqual(0);
    });

    it('should handle very large attempt numbers', () => {
      const fn = createRetryDelayFn({
        strategy: 'exponential',
        baseDelay: 1000,
        maxDelay: 60000,
        jitter: 0,
      });

      const delay = fn(1000, mockNotification);
      expect(delay).toBe(60000); // Should be capped at maxDelay
    });

    it('should handle baseDelay = 0', () => {
      const fn = createRetryDelayFn({
        strategy: 'exponential',
        baseDelay: 0,
        jitter: 0,
      });

      expect(fn(1, mockNotification)).toBe(0);
      expect(fn(5, mockNotification)).toBe(0);
    });

    it('should handle maxDelay = 0', () => {
      const fn = createRetryDelayFn({
        strategy: 'exponential',
        baseDelay: 1000,
        maxDelay: 0,
        jitter: 0,
      });

      // All delays should be capped at 0
      expect(fn(1, mockNotification)).toBe(0);
      expect(fn(2, mockNotification)).toBe(0);
    });

    it('should handle jitter = 0', () => {
      const fn = createRetryDelayFn({
        strategy: 'fixed',
        baseDelay: 1000,
        jitter: 0,
      });

      // Without jitter, all delays should be identical
      const delays = Array.from({ length: 10 }, () => fn(1, mockNotification));
      expect(new Set(delays).size).toBe(1);
      expect(delays[0]).toBe(1000);
    });
  });
});

/**
 * Create a mock incoming notification
 */
function createMockNotification(overrides: Partial<IncomingNotification> = {}): IncomingNotification {
  return {
    id: 'test-msg-1',
    channel: 'test.channel',
    payload: { type: 'test', data: {} },
    timestamp: Date.now(),
    attempt: 1,
    async ack() {},
    ...overrides,
  };
}
