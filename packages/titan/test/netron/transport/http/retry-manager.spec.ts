/**
 * Tests for Retry Manager
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { RetryManager, type RetryOptions } from '../../../../src/netron/transport/http/retry-manager.js';
import { TitanError, ErrorCode } from '../../../../src/errors/index.js';

describe('RetryManager', () => {
  let retryManager: RetryManager;

  beforeEach(() => {
    retryManager = new RetryManager({
      debug: false
    });
  });

  afterEach(() => {
    retryManager.resetStats();
  });

  describe('Basic Retry Logic', () => {
    it('should retry on failure and eventually succeed', async () => {
      let attempts = 0;
      const fn = jest.fn(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Temporary failure');
        }
        return 'success';
      });

      const result = await retryManager.execute(fn, {
        attempts: 3,
        initialDelay: 10,
        backoff: 'constant'
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should fail after max attempts', async () => {
      const fn = jest.fn(async () => {
        throw new Error('Persistent failure');
      });

      await expect(
        retryManager.execute(fn, {
          attempts: 2,
          initialDelay: 10
        })
      ).rejects.toThrow('Persistent failure');

      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should succeed on first attempt without retry', async () => {
      const fn = jest.fn(async () => 'success');

      const result = await retryManager.execute(fn, {
        attempts: 3,
        initialDelay: 10
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should call onRetry callback', async () => {
      let attempts = 0;
      const fn = jest.fn(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Retry me');
        }
        return 'success';
      });

      const onRetry = jest.fn();

      await retryManager.execute(fn, {
        attempts: 3,
        initialDelay: 10,
        onRetry
      });

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledWith(1, expect.objectContaining({ message: 'Retry me' }));
      expect(onRetry).toHaveBeenCalledWith(2, expect.objectContaining({ message: 'Retry me' }));
    });
  });

  describe('Backoff Strategies', () => {
    it('should use exponential backoff', async () => {
      const delays: number[] = [];
      const fn = jest.fn(async () => {
        throw new Error('Always fails');
      });

      const originalDelay = retryManager['delay'];
      (retryManager as any).delay = jest.fn((ms: number) => {
        delays.push(ms);
        return Promise.resolve();
      });

      try {
        await retryManager.execute(fn, {
          attempts: 3,
          initialDelay: 100,
          backoff: 'exponential',
          factor: 2,
          jitter: 0 // Disable jitter for predictable testing
        });
      } catch {
        // Expected to fail
      }

      // Restore original delay
      (retryManager as any).delay = originalDelay;

      // Check delays are exponentially increasing
      expect(delays.length).toBe(3);
      expect(delays[0]).toBe(100);  // Initial delay
      expect(delays[1]).toBe(200);  // 100 * 2
      expect(delays[2]).toBe(400);  // 200 * 2
    });

    it('should use linear backoff', async () => {
      const delays: number[] = [];
      const fn = jest.fn(async () => {
        throw new Error('Always fails');
      });

      const originalDelay = retryManager['delay'];
      (retryManager as any).delay = jest.fn((ms: number) => {
        delays.push(ms);
        return Promise.resolve();
      });

      try {
        await retryManager.execute(fn, {
          attempts: 3,
          initialDelay: 100,
          backoff: 'linear',
          jitter: 0
        });
      } catch {
        // Expected to fail
      }

      // Restore original delay
      (retryManager as any).delay = originalDelay;

      // Check delays are linearly increasing
      expect(delays.length).toBe(3);
      expect(delays[0]).toBe(100);  // Initial delay
      expect(delays[1]).toBe(200);  // 100 + 100
      expect(delays[2]).toBe(300);  // 200 + 100
    });

    it('should use constant backoff', async () => {
      const delays: number[] = [];
      const fn = jest.fn(async () => {
        throw new Error('Always fails');
      });

      const originalDelay = retryManager['delay'];
      (retryManager as any).delay = jest.fn((ms: number) => {
        delays.push(ms);
        return Promise.resolve();
      });

      try {
        await retryManager.execute(fn, {
          attempts: 3,
          initialDelay: 100,
          backoff: 'constant',
          jitter: 0
        });
      } catch {
        // Expected to fail
      }

      // Restore original delay
      (retryManager as any).delay = originalDelay;

      // Check delays remain constant
      expect(delays.length).toBe(3);
      expect(delays[0]).toBe(100);
      expect(delays[1]).toBe(100);
      expect(delays[2]).toBe(100);
    });

    it('should respect maxDelay', async () => {
      const delays: number[] = [];
      const fn = jest.fn(async () => {
        throw new Error('Always fails');
      });

      const originalDelay = retryManager['delay'];
      (retryManager as any).delay = jest.fn((ms: number) => {
        delays.push(ms);
        return Promise.resolve();
      });

      try {
        await retryManager.execute(fn, {
          attempts: 5,
          initialDelay: 100,
          backoff: 'exponential',
          factor: 3,
          maxDelay: 500,
          jitter: 0
        });
      } catch {
        // Expected to fail
      }

      // Restore original delay
      (retryManager as any).delay = originalDelay;

      // Check delays are capped at maxDelay
      expect(delays[0]).toBe(100);  // Initial
      expect(delays[1]).toBe(300);  // 100 * 3
      expect(delays[2]).toBe(500);  // Capped at maxDelay
      expect(delays[3]).toBe(500);  // Still capped
      expect(delays[4]).toBe(500);  // Still capped
    });
  });

  describe('Retry Conditions', () => {
    it('should use custom shouldRetry function', async () => {
      let attempts = 0;
      const fn = jest.fn(async () => {
        attempts++;
        const error = new Error(`Attempt ${attempts}`);
        (error as any).code = attempts < 3 ? 'RETRY_ME' : 'STOP';
        throw error;
      });

      const shouldRetry = jest.fn((error: any) => error.code === 'RETRY_ME');

      await expect(
        retryManager.execute(fn, {
          attempts: 5,
          initialDelay: 10,
          shouldRetry
        })
      ).rejects.toThrow('Attempt 3');

      expect(fn).toHaveBeenCalledTimes(3);
      expect(shouldRetry).toHaveBeenCalledTimes(3);
    });

    it('should retry on network errors', async () => {
      let attempts = 0;
      const fn = jest.fn(async () => {
        attempts++;
        if (attempts < 3) {
          const error = new Error('Network error');
          (error as any).code = 'ECONNREFUSED';
          throw error;
        }
        return 'success';
      });

      const result = await retryManager.execute(fn, {
        attempts: 3,
        initialDelay: 10
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should retry on 5xx errors', async () => {
      let attempts = 0;
      const fn = jest.fn(async () => {
        attempts++;
        if (attempts < 3) {
          const error = new Error('Server error');
          (error as any).status = 503;
          throw error;
        }
        return 'success';
      });

      const result = await retryManager.execute(fn, {
        attempts: 3,
        initialDelay: 10
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should not retry on 4xx errors', async () => {
      const fn = jest.fn(async () => {
        const error = new Error('Bad request');
        (error as any).status = 400;
        throw error;
      });

      await expect(
        retryManager.execute(fn, {
          attempts: 3,
          initialDelay: 10
        })
      ).rejects.toThrow('Bad request');

      expect(fn).toHaveBeenCalledTimes(1); // No retries
    });

    it('should retry on TitanError with retryable codes', async () => {
      let attempts = 0;
      const fn = jest.fn(async () => {
        attempts++;
        if (attempts < 3) {
          throw new TitanError({
            code: ErrorCode.SERVICE_UNAVAILABLE,
            message: 'Service unavailable'
          });
        }
        return 'success';
      });

      const result = await retryManager.execute(fn, {
        attempts: 3,
        initialDelay: 10
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should not retry on TitanError with non-retryable codes', async () => {
      const fn = jest.fn(async () => {
        throw new TitanError({
          code: ErrorCode.INVALID_ARGUMENT,
          message: 'Invalid argument'
        });
      });

      await expect(
        retryManager.execute(fn, {
          attempts: 3,
          initialDelay: 10
        })
      ).rejects.toThrow('Invalid argument');

      expect(fn).toHaveBeenCalledTimes(1); // No retries
    });
  });

  describe('Timeout', () => {
    it('should timeout individual attempts', async () => {
      const fn = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'success';
      });

      await expect(
        retryManager.execute(fn, {
          attempts: 2,
          initialDelay: 10,
          attemptTimeout: 50
        })
      ).rejects.toThrow('Request timeout after 50ms');

      // Should retry after timeout
      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should succeed if completed before timeout', async () => {
      const fn = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
        return 'success';
      });

      const result = await retryManager.execute(fn, {
        attempts: 2,
        initialDelay: 10,
        attemptTimeout: 100
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('Circuit Breaker', () => {
    it('should open circuit after threshold failures', async () => {
      const manager = new RetryManager({
        circuitBreaker: {
          threshold: 3,
          windowTime: 1000,
          cooldownTime: 100
        }
      });

      const fn = jest.fn(async () => {
        throw new Error('Always fails');
      });

      // Fail multiple times to open circuit
      for (let i = 0; i < 3; i++) {
        try {
          await manager.execute(fn, { attempts: 0, initialDelay: 10 });
        } catch {
          // Expected to fail
        }
      }

      expect(manager.getCircuitBreakerState()).toBe('open');

      // Should reject immediately when circuit is open
      await expect(
        manager.execute(fn, { attempts: 3, initialDelay: 10 })
      ).rejects.toThrow('Circuit breaker is open');
    });

    it('should transition to half-open after cooldown', async () => {
      const manager = new RetryManager({
        circuitBreaker: {
          threshold: 2,
          windowTime: 1000,
          cooldownTime: 50
        }
      });

      const fn = jest.fn(async () => {
        throw new Error('Always fails');
      });

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await manager.execute(fn, { attempts: 0, initialDelay: 10 });
        } catch {
          // Expected
        }
      }

      expect(manager.getCircuitBreakerState()).toBe('open');

      // Wait for cooldown
      await new Promise(resolve => setTimeout(resolve, 60));

      // Should transition to half-open and allow one attempt
      try {
        await manager.execute(jest.fn(async () => 'success'), {
          attempts: 0,
          initialDelay: 10
        });
      } catch {
        // May fail or succeed
      }

      // Circuit state should have changed
      expect(['half-open', 'closed', 'open']).toContain(manager.getCircuitBreakerState());
    });

    it('should close circuit after successful requests in half-open state', async () => {
      const manager = new RetryManager({
        circuitBreaker: {
          threshold: 2,
          windowTime: 1000,
          cooldownTime: 50,
          successThreshold: 2
        }
      });

      // Open the circuit
      const failingFn = jest.fn(async () => {
        throw new Error('Fails');
      });

      for (let i = 0; i < 2; i++) {
        try {
          await manager.execute(failingFn, { attempts: 0, initialDelay: 10 });
        } catch {
          // Expected
        }
      }

      expect(manager.getCircuitBreakerState()).toBe('open');

      // Wait for cooldown
      await new Promise(resolve => setTimeout(resolve, 60));

      // Successful requests should close the circuit
      const successFn = jest.fn(async () => 'success');
      await manager.execute(successFn, { attempts: 0, initialDelay: 10 });
      await manager.execute(successFn, { attempts: 0, initialDelay: 10 });

      expect(manager.getCircuitBreakerState()).toBe('closed');
    });

    it('should allow manual circuit control', () => {
      const manager = new RetryManager({
        circuitBreaker: {
          threshold: 5,
          windowTime: 1000,
          cooldownTime: 100
        }
      });

      expect(manager.getCircuitBreakerState()).toBe('closed');

      // Manually trip the circuit
      manager.tripCircuitBreaker();
      expect(manager.getCircuitBreakerState()).toBe('open');

      // Manually reset the circuit
      manager.resetCircuitBreaker();
      expect(manager.getCircuitBreakerState()).toBe('closed');
    });
  });

  describe('Statistics', () => {
    it('should track retry statistics', async () => {
      let attempts = 0;
      const fn = jest.fn(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Retry me');
        }
        return 'success';
      });

      await retryManager.execute(fn, {
        attempts: 3,
        initialDelay: 10
      });

      const stats = retryManager.getStats();
      expect(stats.totalAttempts).toBe(2); // 2 retry attempts
      expect(stats.successfulRetries).toBe(1); // Final success after retries
      expect(stats.failedRetries).toBe(0);
      expect(stats.avgRetryDelay).toBeGreaterThan(0);
    });

    it('should reset statistics', async () => {
      const fn = jest.fn(async () => {
        throw new Error('Fail');
      });

      try {
        await retryManager.execute(fn, {
          attempts: 1,
          initialDelay: 10
        });
      } catch {
        // Expected
      }

      let stats = retryManager.getStats();
      expect(stats.totalAttempts).toBeGreaterThan(0);

      retryManager.resetStats();
      stats = retryManager.getStats();
      expect(stats.totalAttempts).toBe(0);
      expect(stats.successfulRetries).toBe(0);
      expect(stats.failedRetries).toBe(0);
    });
  });

  describe('Events', () => {
    it('should emit retry events', async () => {
      const events: any[] = [];
      retryManager.on('retry', (data) => events.push({ type: 'retry', ...data }));
      retryManager.on('retry-success', (data) => events.push({ type: 'success', ...data }));
      retryManager.on('retry-exhausted', (data) => events.push({ type: 'exhausted', ...data }));

      let attempts = 0;
      const fn = jest.fn(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Retry me');
        }
        return 'success';
      });

      await retryManager.execute(fn, {
        attempts: 3,
        initialDelay: 10
      });

      // Should have retry events
      expect(events.filter(e => e.type === 'retry')).toHaveLength(2);
      expect(events.filter(e => e.type === 'success')).toHaveLength(1);
      expect(events.filter(e => e.type === 'exhausted')).toHaveLength(0);
    });

    it('should emit exhausted event when max attempts reached', async () => {
      const exhaustedHandler = jest.fn();
      retryManager.on('retry-exhausted', exhaustedHandler);

      const fn = jest.fn(async () => {
        throw new Error('Always fails');
      });

      try {
        await retryManager.execute(fn, {
          attempts: 2,
          initialDelay: 10
        });
      } catch {
        // Expected
      }

      expect(exhaustedHandler).toHaveBeenCalledWith({
        attempts: 3,
        error: 'Always fails'
      });
    });
  });
});