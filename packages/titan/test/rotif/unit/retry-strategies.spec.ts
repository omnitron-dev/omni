import { describe, it, expect } from '@jest/globals';
import {
  createRetryDelayFn,
  RetryStrategies,
  RetryStrategyConfig,
} from '../../../src/rotif/retry-strategies.js';
import { RotifMessage } from '../../../src/rotif/types.js';

// Helper to create a mock message
const createMockMessage = (attempt: number): RotifMessage => ({
  id: 'test-id',
  channel: 'test.channel',
  payload: {},
  timestamp: Date.now(),
  attempt,
  ack: async () => {},
});

describe('Rotif - Retry Strategies', () => {
  describe('createRetryDelayFn', () => {
    describe('exponential strategy', () => {
      it('should implement exponential backoff', () => {
        const delayFn = createRetryDelayFn({
          strategy: 'exponential',
          baseDelay: 1000,
          multiplier: 2,
          jitter: 0,
        });

        expect(delayFn(1, createMockMessage(1))).toBe(1000); // 1000 * 2^0
        expect(delayFn(2, createMockMessage(2))).toBe(2000); // 1000 * 2^1
        expect(delayFn(3, createMockMessage(3))).toBe(4000); // 1000 * 2^2
        expect(delayFn(4, createMockMessage(4))).toBe(8000); // 1000 * 2^3
      });

      it('should respect maxDelay', () => {
        const delayFn = createRetryDelayFn({
          strategy: 'exponential',
          baseDelay: 1000,
          maxDelay: 5000,
          multiplier: 2,
          jitter: 0,
        });

        expect(delayFn(10, createMockMessage(10))).toBe(5000); // Capped at maxDelay
      });

      it('should use custom multiplier', () => {
        const delayFn = createRetryDelayFn({
          strategy: 'exponential',
          baseDelay: 100,
          multiplier: 3,
          jitter: 0,
        });

        expect(delayFn(1, createMockMessage(1))).toBe(100); // 100 * 3^0
        expect(delayFn(2, createMockMessage(2))).toBe(300); // 100 * 3^1
        expect(delayFn(3, createMockMessage(3))).toBe(900); // 100 * 3^2
      });
    });

    describe('linear strategy', () => {
      it('should implement linear backoff', () => {
        const delayFn = createRetryDelayFn({
          strategy: 'linear',
          baseDelay: 1000,
          jitter: 0,
        });

        expect(delayFn(1, createMockMessage(1))).toBe(1000); // 1000 * 1
        expect(delayFn(2, createMockMessage(2))).toBe(2000); // 1000 * 2
        expect(delayFn(3, createMockMessage(3))).toBe(3000); // 1000 * 3
        expect(delayFn(5, createMockMessage(5))).toBe(5000); // 1000 * 5
      });

      it('should respect maxDelay', () => {
        const delayFn = createRetryDelayFn({
          strategy: 'linear',
          baseDelay: 1000,
          maxDelay: 2500,
          jitter: 0,
        });

        expect(delayFn(5, createMockMessage(5))).toBe(2500); // Capped at maxDelay
      });
    });

    describe('fixed strategy', () => {
      it('should use fixed delay', () => {
        const delayFn = createRetryDelayFn({
          strategy: 'fixed',
          baseDelay: 2000,
          jitter: 0,
        });

        expect(delayFn(1, createMockMessage(1))).toBe(2000);
        expect(delayFn(2, createMockMessage(2))).toBe(2000);
        expect(delayFn(10, createMockMessage(10))).toBe(2000);
      });
    });

    describe('fibonacci strategy', () => {
      it('should implement fibonacci backoff', () => {
        const delayFn = createRetryDelayFn({
          strategy: 'fibonacci',
          baseDelay: 100,
          jitter: 0,
        });

        expect(delayFn(1, createMockMessage(1))).toBe(100); // 100 * 1
        expect(delayFn(2, createMockMessage(2))).toBe(200); // 100 * 2
        expect(delayFn(3, createMockMessage(3))).toBe(300); // 100 * 3
        expect(delayFn(4, createMockMessage(4))).toBe(500); // 100 * 5
        expect(delayFn(5, createMockMessage(5))).toBe(800); // 100 * 8
        expect(delayFn(6, createMockMessage(6))).toBe(1300); // 100 * 13
      });

      it('should respect maxDelay', () => {
        const delayFn = createRetryDelayFn({
          strategy: 'fibonacci',
          baseDelay: 1000,
          maxDelay: 10000,
          jitter: 0,
        });

        expect(delayFn(10, createMockMessage(10))).toBe(10000); // Capped
      });
    });

    describe('jitter', () => {
      it('should add randomness with jitter', () => {
        const delayFn = createRetryDelayFn({
          strategy: 'fixed',
          baseDelay: 1000,
          jitter: 0.2, // 20% jitter
        });

        const delays: number[] = [];
        for (let i = 0; i < 100; i++) {
          delays.push(delayFn(1, createMockMessage(1)));
        }

        // All delays should be within ±20% of 1000
        delays.forEach((delay) => {
          expect(delay).toBeGreaterThanOrEqual(800);
          expect(delay).toBeLessThanOrEqual(1200);
        });

        // Should have some variance
        const uniqueDelays = new Set(delays);
        expect(uniqueDelays.size).toBeGreaterThan(10);
      });

      it('should not produce negative delays', () => {
        const delayFn = createRetryDelayFn({
          strategy: 'fixed',
          baseDelay: 100,
          jitter: 2.0, // Extreme jitter
        });

        for (let i = 0; i < 100; i++) {
          const delay = delayFn(1, createMockMessage(1));
          expect(delay).toBeGreaterThanOrEqual(0);
        }
      });

      it('should work with zero jitter', () => {
        const delayFn = createRetryDelayFn({
          strategy: 'fixed',
          baseDelay: 1000,
          jitter: 0,
        });

        for (let i = 0; i < 10; i++) {
          expect(delayFn(1, createMockMessage(1))).toBe(1000);
        }
      });
    });

    describe('custom delay function', () => {
      it('should use custom delay function', () => {
        const customFn = (attempt: number) => attempt * 500;

        const delayFn = createRetryDelayFn({
          customDelayFn: customFn,
        });

        expect(delayFn(1, createMockMessage(1))).toBe(500);
        expect(delayFn(2, createMockMessage(2))).toBe(1000);
        expect(delayFn(5, createMockMessage(5))).toBe(2500);
      });

      it('should have access to message in custom function', () => {
        const customFn = (attempt: number, msg: RotifMessage) => {
          return attempt * 100 + msg.timestamp;
        };

        const delayFn = createRetryDelayFn({
          customDelayFn: customFn,
        });

        const msg = createMockMessage(1);
        const delay = delayFn(1, msg);

        expect(delay).toBe(100 + msg.timestamp);
      });

      it('should ignore other config when custom function provided', () => {
        const customFn = () => 12345;

        const delayFn = createRetryDelayFn({
          strategy: 'exponential',
          baseDelay: 1000,
          customDelayFn: customFn,
        });

        expect(delayFn(1, createMockMessage(1))).toBe(12345);
      });
    });

    describe('default values', () => {
      it('should use defaults when no config provided', () => {
        const delayFn = createRetryDelayFn();

        const msg = createMockMessage(1);
        const delay = delayFn(1, msg);

        // Default is exponential with baseDelay 1000
        expect(delay).toBeGreaterThan(0);
        expect(delay).toBeLessThan(2000); // With jitter
      });

      it('should use partial config with defaults', () => {
        const delayFn = createRetryDelayFn({
          baseDelay: 500,
        });

        const delay = delayFn(1, createMockMessage(1));
        expect(delay).toBeGreaterThanOrEqual(400); // ~500 with jitter
        expect(delay).toBeLessThanOrEqual(600);
      });
    });
  });

  describe('RetryStrategies presets', () => {
    describe('aggressive', () => {
      it('should return aggressive retry config', () => {
        const config = RetryStrategies.aggressive();

        expect(config.strategy).toBe('exponential');
        expect(config.baseDelay).toBe(100);
        expect(config.maxDelay).toBe(10000);
        expect(config.multiplier).toBe(3);
        expect(config.jitter).toBe(0.2);
      });

      it('should create fast-starting delay function', () => {
        const delayFn = createRetryDelayFn(RetryStrategies.aggressive());
        const delay = delayFn(1, createMockMessage(1));

        expect(delay).toBeGreaterThanOrEqual(80);
        expect(delay).toBeLessThanOrEqual(120);
      });
    });

    describe('conservative', () => {
      it('should return conservative retry config', () => {
        const config = RetryStrategies.conservative();

        expect(config.strategy).toBe('exponential');
        expect(config.baseDelay).toBe(5000);
        expect(config.maxDelay).toBe(120000);
        expect(config.multiplier).toBe(1.5);
        expect(config.jitter).toBe(0.1);
      });

      it('should create slow-starting delay function', () => {
        const delayFn = createRetryDelayFn(RetryStrategies.conservative());
        const delay = delayFn(1, createMockMessage(1));

        expect(delay).toBeGreaterThanOrEqual(4500);
        expect(delay).toBeLessThanOrEqual(5500);
      });
    });

    describe('immediate', () => {
      it('should return immediate retry config', () => {
        const config = RetryStrategies.immediate();

        expect(config.strategy).toBe('fixed');
        expect(config.baseDelay).toBe(100);
        expect(config.jitter).toBe(0);
      });

      it('should create minimal delay function', () => {
        const delayFn = createRetryDelayFn(RetryStrategies.immediate());

        expect(delayFn(1, createMockMessage(1))).toBe(100);
        expect(delayFn(5, createMockMessage(5))).toBe(100);
      });
    });

    describe('linear', () => {
      it('should return linear retry config', () => {
        const config = RetryStrategies.linear(2000);

        expect(config.strategy).toBe('linear');
        expect(config.baseDelay).toBe(2000);
        expect(config.maxDelay).toBe(30000);
        expect(config.jitter).toBe(0.1);
      });

      it('should use default baseDelay if not provided', () => {
        const config = RetryStrategies.linear();

        expect(config.baseDelay).toBe(1000);
      });
    });

    describe('fibonacci', () => {
      it('should return fibonacci retry config', () => {
        const config = RetryStrategies.fibonacci(500);

        expect(config.strategy).toBe('fibonacci');
        expect(config.baseDelay).toBe(500);
        expect(config.maxDelay).toBe(60000);
        expect(config.jitter).toBe(0.15);
      });

      it('should use default baseDelay if not provided', () => {
        const config = RetryStrategies.fibonacci();

        expect(config.baseDelay).toBe(500);
      });
    });
  });

  describe('edge cases', () => {
    it('should handle attempt 0', () => {
      const delayFn = createRetryDelayFn({
        strategy: 'exponential',
        baseDelay: 1000,
        jitter: 0,
      });

      // Attempt 0 should still work (though unusual)
      const delay = delayFn(0, createMockMessage(0));
      expect(delay).toBeGreaterThanOrEqual(0);
    });

    it('should handle very large attempt numbers', () => {
      const delayFn = createRetryDelayFn({
        strategy: 'exponential',
        baseDelay: 1000,
        maxDelay: 60000,
        jitter: 0,
      });

      const delay = delayFn(100, createMockMessage(100));
      expect(delay).toBe(60000); // Should be capped
    });

    it('should handle zero baseDelay', () => {
      const delayFn = createRetryDelayFn({
        strategy: 'fixed',
        baseDelay: 0,
        jitter: 0,
      });

      expect(delayFn(1, createMockMessage(1))).toBe(0);
    });
  });
});
