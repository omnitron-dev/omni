import { describe, it, expect, beforeEach } from '@jest/globals';
import { createRetryDelayFn, RetryStrategies, RetryStrategy } from '../src/retry-strategies.js';
import type { RotifMessage } from '../src/types.js';

describe('Retry Strategies', () => {
  let mockMessage: RotifMessage;

  beforeEach(() => {
    mockMessage = {
      id: 'test-id',
      channel: 'test-channel',
      payload: { test: 'data' },
      timestamp: Date.now(),
      attempt: 1,
      ack: async () => { }
    };
  });

  describe('createRetryDelayFn', () => {
    describe('Exponential Strategy', () => {
      it('should calculate exponential backoff delays', () => {
        const retryFn = createRetryDelayFn({
          strategy: 'exponential',
          baseDelay: 100,
          maxDelay: 5000,
          multiplier: 2,
          jitter: 0
        });

        expect(retryFn(1, mockMessage)).toBe(100);
        expect(retryFn(2, mockMessage)).toBe(200);
        expect(retryFn(3, mockMessage)).toBe(400);
        expect(retryFn(4, mockMessage)).toBe(800);
        expect(retryFn(5, mockMessage)).toBe(1600);
        expect(retryFn(6, mockMessage)).toBe(3200);
        expect(retryFn(7, mockMessage)).toBe(5000); // Max delay
        expect(retryFn(8, mockMessage)).toBe(5000); // Should not exceed max
      });

      it('should add jitter when specified', () => {
        const retryFn = createRetryDelayFn({
          strategy: 'exponential',
          baseDelay: 1000,
          jitter: 0.2
        });

        const delays = Array.from({ length: 10 }, () => retryFn(3, mockMessage));

        // All delays should be within 20% of base value (4000 for attempt 3)
        delays.forEach(delay => {
          expect(delay).toBeGreaterThanOrEqual(3200); // 4000 * 0.8
          expect(delay).toBeLessThanOrEqual(4800); // 4000 * 1.2
        });

        // Delays should vary (not all the same)
        const uniqueDelays = new Set(delays);
        expect(uniqueDelays.size).toBeGreaterThan(1);
      });
    });

    describe('Linear Strategy', () => {
      it('should calculate linear delays', () => {
        const retryFn = createRetryDelayFn({
          strategy: 'linear',
          baseDelay: 500,
          maxDelay: 3000,
          jitter: 0
        });

        expect(retryFn(1, mockMessage)).toBe(500);
        expect(retryFn(2, mockMessage)).toBe(1000);
        expect(retryFn(3, mockMessage)).toBe(1500);
        expect(retryFn(4, mockMessage)).toBe(2000);
        expect(retryFn(5, mockMessage)).toBe(2500);
        expect(retryFn(6, mockMessage)).toBe(3000);
        expect(retryFn(7, mockMessage)).toBe(3000); // Max delay
      });
    });

    describe('Fixed Strategy', () => {
      it('should return fixed delay', () => {
        const retryFn = createRetryDelayFn({
          strategy: 'fixed',
          baseDelay: 750,
          jitter: 0
        });

        expect(retryFn(1, mockMessage)).toBe(750);
        expect(retryFn(2, mockMessage)).toBe(750);
        expect(retryFn(5, mockMessage)).toBe(750);
        expect(retryFn(10, mockMessage)).toBe(750);
      });
    });

    describe('Fibonacci Strategy', () => {
      it('should calculate fibonacci delays', () => {
        const retryFn = createRetryDelayFn({
          strategy: 'fibonacci',
          baseDelay: 100,
          maxDelay: 10000,
          jitter: 0
        });

        expect(retryFn(1, mockMessage)).toBe(100);   // 1 * 100
        expect(retryFn(2, mockMessage)).toBe(200);   // 2 * 100
        expect(retryFn(3, mockMessage)).toBe(300);   // 3 * 100
        expect(retryFn(4, mockMessage)).toBe(500);   // 5 * 100
        expect(retryFn(5, mockMessage)).toBe(800);   // 8 * 100
        expect(retryFn(6, mockMessage)).toBe(1300);  // 13 * 100
        expect(retryFn(7, mockMessage)).toBe(2100);  // 21 * 100
      });
    });

    describe('Custom Function', () => {
      it('should use custom delay function when provided', () => {
        const customDelayFn = (attempt: number, msg: RotifMessage) => {
          return attempt * 333 + msg.channel.length;
        };

        const retryFn = createRetryDelayFn({
          customDelayFn
        });

        mockMessage.channel = 'test'; // length = 4
        expect(retryFn(1, mockMessage)).toBe(337); // 1 * 333 + 4
        expect(retryFn(2, mockMessage)).toBe(670); // 2 * 333 + 4
        expect(retryFn(3, mockMessage)).toBe(1003); // 3 * 333 + 4
      });
    });
  });

  describe('Preset Strategies', () => {
    it('should provide aggressive strategy', () => {
      const config = RetryStrategies.aggressive();
      const retryFn = createRetryDelayFn(config);

      expect(config.strategy).toBe('exponential');
      expect(config.baseDelay).toBe(100);
      expect(config.maxDelay).toBe(10000);
      expect(config.multiplier).toBe(3);

      // Test actual delays
      expect(retryFn(1, mockMessage)).toBeGreaterThanOrEqual(80);
      expect(retryFn(1, mockMessage)).toBeLessThanOrEqual(120);
    });

    it('should provide conservative strategy', () => {
      const config = RetryStrategies.conservative();
      const retryFn = createRetryDelayFn(config);

      expect(config.strategy).toBe('exponential');
      expect(config.baseDelay).toBe(5000);
      expect(config.maxDelay).toBe(120000);
      expect(config.multiplier).toBe(1.5);
    });

    it('should provide immediate strategy', () => {
      const config = RetryStrategies.immediate();
      const retryFn = createRetryDelayFn(config);

      expect(config.strategy).toBe('fixed');
      expect(config.baseDelay).toBe(100);
      expect(config.jitter).toBe(0);

      // Should always return same value
      expect(retryFn(1, mockMessage)).toBe(100);
      expect(retryFn(10, mockMessage)).toBe(100);
    });

    it('should provide linear strategy with custom base', () => {
      const config = RetryStrategies.linear(2000);
      const retryFn = createRetryDelayFn(config);

      expect(config.strategy).toBe('linear');
      expect(config.baseDelay).toBe(2000);
      expect(config.maxDelay).toBe(30000);
    });

    it('should provide fibonacci strategy with custom base', () => {
      const config = RetryStrategies.fibonacci(250);
      const retryFn = createRetryDelayFn(config);

      expect(config.strategy).toBe('fibonacci');
      expect(config.baseDelay).toBe(250);
      expect(config.maxDelay).toBe(60000);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero jitter', () => {
      const retryFn = createRetryDelayFn({
        strategy: 'exponential',
        baseDelay: 1000,
        jitter: 0
      });

      const delay1 = retryFn(2, mockMessage);
      const delay2 = retryFn(2, mockMessage);
      expect(delay1).toBe(delay2);
      expect(delay1).toBe(2000);
    });

    it('should handle negative jitter by ensuring non-negative delays', () => {
      const retryFn = createRetryDelayFn({
        strategy: 'fixed',
        baseDelay: 10,
        jitter: 2.0 // Very high jitter
      });

      // Even with high jitter, should never return negative
      for (let i = 0; i < 100; i++) {
        expect(retryFn(1, mockMessage)).toBeGreaterThanOrEqual(0);
      }
    });

    it('should default to exponential strategy', () => {
      const retryFn = createRetryDelayFn({
        baseDelay: 100,
        multiplier: 2,
        jitter: 0
      });

      expect(retryFn(1, mockMessage)).toBe(100);
      expect(retryFn(2, mockMessage)).toBe(200);
      expect(retryFn(3, mockMessage)).toBe(400);
    });

    it('should handle unknown strategy by defaulting to exponential', () => {
      const retryFn = createRetryDelayFn({
        strategy: 'unknown' as RetryStrategy,
        baseDelay: 100,
        jitter: 0
      });

      expect(retryFn(1, mockMessage)).toBe(100);
      expect(retryFn(2, mockMessage)).toBe(200);
    });
  });
});