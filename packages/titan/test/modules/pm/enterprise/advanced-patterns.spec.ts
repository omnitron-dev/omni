/**
 * Comprehensive Tests for Advanced Patterns
 *
 * Tests Circuit Breaker, Bulkhead, Rate Limiter, Retry Handler,
 * Timeout Handler, and Resilience Builder patterns.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  CircuitBreaker,
  CircuitBreakerState,
  Bulkhead,
  RateLimiter,
  RetryHandler,
  BackoffStrategy,
  TimeoutHandler,
  ResilienceBuilder,
  type ICircuitBreakerConfig,
  type IBulkheadConfig,
  type IRateLimiterConfig,
  type IRetryConfig,
  type ITimeoutConfig,
  type IResilienceConfig,
} from '../../../../src/modules/pm/enterprise/advanced-patterns.js';

// ============================================================================
// Circuit Breaker Tests
// ============================================================================

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;

  afterEach(() => {
    if (circuitBreaker) {
      circuitBreaker.removeAllListeners();
      circuitBreaker.reset();
    }
  });

  describe('Initial State', () => {
    it('should start in closed state', () => {
      circuitBreaker = new CircuitBreaker('test-service');

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should have zero metrics initially', () => {
      circuitBreaker = new CircuitBreaker('test-service');
      const metrics = circuitBreaker.getMetrics();

      expect(metrics.totalCalls).toBe(0);
      expect(metrics.successfulCalls).toBe(0);
      expect(metrics.failedCalls).toBe(0);
      expect(metrics.rejectedCalls).toBe(0);
      expect(metrics.failureRate).toBe(0);
    });
  });

  describe('Successful Calls', () => {
    it('should execute successful calls', async () => {
      circuitBreaker = new CircuitBreaker('test-service');

      const result = await circuitBreaker.execute(async () => 'success');

      expect(result).toBe('success');
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should track successful call metrics', async () => {
      circuitBreaker = new CircuitBreaker('test-service');

      await circuitBreaker.execute(async () => 'success');
      await circuitBreaker.execute(async () => 'success');

      const metrics = circuitBreaker.getMetrics();
      expect(metrics.totalCalls).toBe(2);
      expect(metrics.successfulCalls).toBe(2);
    });

    it('should emit success event', async () => {
      circuitBreaker = new CircuitBreaker('test-service');
      let successEmitted = false;

      circuitBreaker.on('success', () => {
        successEmitted = true;
      });

      await circuitBreaker.execute(async () => 'success');

      expect(successEmitted).toBe(true);
    });
  });

  describe('Failed Calls', () => {
    it('should propagate errors', async () => {
      circuitBreaker = new CircuitBreaker('test-service');

      await expect(
        circuitBreaker.execute(async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');
    });

    it('should track failed call metrics', async () => {
      circuitBreaker = new CircuitBreaker('test-service');

      try {
        await circuitBreaker.execute(async () => {
          throw new Error('Test error');
        });
      } catch {
        // Expected
      }

      const metrics = circuitBreaker.getMetrics();
      expect(metrics.failedCalls).toBe(1);
    });

    it('should emit failure event', async () => {
      circuitBreaker = new CircuitBreaker('test-service');
      let failureEmitted = false;

      circuitBreaker.on('failure', () => {
        failureEmitted = true;
      });

      try {
        await circuitBreaker.execute(async () => {
          throw new Error('Test error');
        });
      } catch {
        // Expected
      }

      expect(failureEmitted).toBe(true);
    });
  });

  describe('State Transitions', () => {
    it('should transition to open after threshold failures', async () => {
      const config: ICircuitBreakerConfig = {
        failureThreshold: 3,
        volumeThreshold: 3,
      };
      circuitBreaker = new CircuitBreaker('test-service', config);

      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('Test error');
          });
        } catch {
          // Expected
        }
      }

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });

    it('should emit stateChange event on transition', async () => {
      const config: ICircuitBreakerConfig = {
        failureThreshold: 2,
        volumeThreshold: 2,
      };
      circuitBreaker = new CircuitBreaker('test-service', config);
      let stateChangeEmitted = false;
      let newState: CircuitBreakerState | null = null;

      circuitBreaker.on('stateChange', (event) => {
        stateChangeEmitted = true;
        newState = event.newState;
      });

      for (let i = 0; i < 2; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('Test error');
          });
        } catch {
          // Expected
        }
      }

      expect(stateChangeEmitted).toBe(true);
      expect(newState).toBe(CircuitBreakerState.OPEN);
    });

    it('should reject calls when open', async () => {
      const config: ICircuitBreakerConfig = {
        failureThreshold: 1,
        volumeThreshold: 1,
      };
      circuitBreaker = new CircuitBreaker('test-service', config);

      // Trigger open state
      try {
        await circuitBreaker.execute(async () => {
          throw new Error('Test error');
        });
      } catch {
        // Expected
      }

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);

      // Should reject
      await expect(
        circuitBreaker.execute(async () => 'success')
      ).rejects.toThrow('Circuit breaker is open');
    });

    it('should transition to half-open after reset timeout', async () => {
      const config: ICircuitBreakerConfig = {
        failureThreshold: 1,
        volumeThreshold: 1,
        resetTimeout: 50,
      };
      circuitBreaker = new CircuitBreaker('test-service', config);

      // Trigger open state
      try {
        await circuitBreaker.execute(async () => {
          throw new Error('Test error');
        });
      } catch {
        // Expected
      }

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Next call should transition to half-open and execute
      await circuitBreaker.execute(async () => 'success');

      // Should be in half-open or closed (if success threshold met)
      expect([CircuitBreakerState.HALF_OPEN, CircuitBreakerState.CLOSED]).toContain(
        circuitBreaker.getState()
      );
    });

    it('should transition to closed after successful calls in half-open', async () => {
      const config: ICircuitBreakerConfig = {
        failureThreshold: 1,
        volumeThreshold: 1,
        resetTimeout: 50,
        successThreshold: 2,
      };
      circuitBreaker = new CircuitBreaker('test-service', config);

      // Trigger open state
      try {
        await circuitBreaker.execute(async () => {
          throw new Error('Test error');
        });
      } catch {
        // Expected
      }

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Successful calls to close the circuit
      await circuitBreaker.execute(async () => 'success');
      await circuitBreaker.execute(async () => 'success');

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should reopen after failure in half-open', async () => {
      const config: ICircuitBreakerConfig = {
        failureThreshold: 1,
        volumeThreshold: 1,
        resetTimeout: 50,
        successThreshold: 3,
      };
      circuitBreaker = new CircuitBreaker('test-service', config);

      // Trigger open state
      try {
        await circuitBreaker.execute(async () => {
          throw new Error('Test error');
        });
      } catch {
        // Expected
      }

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 60));

      // One success
      await circuitBreaker.execute(async () => 'success');
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);

      // Wait a bit and then fail - should reopen
      await new Promise((resolve) => setTimeout(resolve, 60));

      try {
        await circuitBreaker.execute(async () => {
          throw new Error('Test error');
        });
      } catch {
        // Expected
      }

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });
  });

  describe('Call Timeout', () => {
    it('should timeout slow calls', async () => {
      const config: ICircuitBreakerConfig = {
        callTimeout: 50,
      };
      circuitBreaker = new CircuitBreaker('test-service', config);

      await expect(
        circuitBreaker.execute(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return 'success';
        })
      ).rejects.toThrow(/timed out/);
    });

    it('should allow fast calls', async () => {
      const config: ICircuitBreakerConfig = {
        callTimeout: 100,
      };
      circuitBreaker = new CircuitBreaker('test-service', config);

      const result = await circuitBreaker.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'success';
      });

      expect(result).toBe('success');
    });
  });

  describe('Failure Rate Threshold', () => {
    it('should open based on failure rate', async () => {
      const config: ICircuitBreakerConfig = {
        failureRateThreshold: 50, // 50%
        volumeThreshold: 4,
        slidingWindowSize: 10,
        failureThreshold: 100, // High so it doesn't trigger first
      };
      circuitBreaker = new CircuitBreaker('test-service', config);

      // 2 successes
      await circuitBreaker.execute(async () => 'success');
      await circuitBreaker.execute(async () => 'success');

      // 2 failures (50% failure rate)
      for (let i = 0; i < 2; i++) {
        try {
          await circuitBreaker.execute(async () => {
            throw new Error('Test error');
          });
        } catch {
          // Expected
        }
      }

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });
  });

  describe('Force State Methods', () => {
    it('should force open', () => {
      circuitBreaker = new CircuitBreaker('test-service');

      circuitBreaker.forceOpen();

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });

    it('should force closed', async () => {
      const config: ICircuitBreakerConfig = {
        failureThreshold: 1,
        volumeThreshold: 1,
      };
      circuitBreaker = new CircuitBreaker('test-service', config);

      // Trigger open
      try {
        await circuitBreaker.execute(async () => {
          throw new Error('Test error');
        });
      } catch {
        // Expected
      }

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);

      circuitBreaker.forceClosed();

      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });
  });

  describe('Reset', () => {
    it('should reset all state', async () => {
      circuitBreaker = new CircuitBreaker('test-service');

      // Execute some calls
      await circuitBreaker.execute(async () => 'success');
      try {
        await circuitBreaker.execute(async () => {
          throw new Error('Test error');
        });
      } catch {
        // Expected
      }

      circuitBreaker.reset();

      const metrics = circuitBreaker.getMetrics();
      expect(metrics.totalCalls).toBe(0);
      expect(metrics.successfulCalls).toBe(0);
      expect(metrics.failedCalls).toBe(0);
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });
  });
});

// ============================================================================
// Bulkhead Tests
// ============================================================================

describe('Bulkhead', () => {
  let bulkhead: Bulkhead;

  afterEach(() => {
    if (bulkhead) {
      bulkhead.drain();
      bulkhead.removeAllListeners();
    }
  });

  describe('Basic Operations', () => {
    it('should execute functions', async () => {
      bulkhead = new Bulkhead({ maxConcurrent: 5 });

      const result = await bulkhead.execute(async () => 'success');

      expect(result).toBe('success');
    });

    it('should track metrics', async () => {
      bulkhead = new Bulkhead({ maxConcurrent: 5, name: 'test' });

      await bulkhead.execute(async () => 'success');

      const metrics = bulkhead.getMetrics();
      expect(metrics.totalExecuted).toBe(1);
      expect(metrics.activeCount).toBe(0);
    });
  });

  describe('Concurrency Limiting', () => {
    it('should limit concurrent executions', async () => {
      bulkhead = new Bulkhead({ maxConcurrent: 2, maxQueue: 10 });
      let concurrentCount = 0;
      let maxConcurrent = 0;

      const tasks = Array.from({ length: 5 }, () =>
        bulkhead.execute(async () => {
          concurrentCount++;
          maxConcurrent = Math.max(maxConcurrent, concurrentCount);
          await new Promise((resolve) => setTimeout(resolve, 50));
          concurrentCount--;
          return 'done';
        })
      );

      await Promise.all(tasks);

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('should queue requests when at capacity', async () => {
      bulkhead = new Bulkhead({ maxConcurrent: 1, maxQueue: 5 });
      let queueEmitted = false;

      bulkhead.on('queued', () => {
        queueEmitted = true;
      });

      const task1 = bulkhead.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'task1';
      });

      const task2 = bulkhead.execute(async () => 'task2');

      await Promise.all([task1, task2]);

      expect(queueEmitted).toBe(true);
    });

    it('should reject when queue is full', async () => {
      bulkhead = new Bulkhead({ maxConcurrent: 1, maxQueue: 1, queueTimeout: 0 });

      // Fill up concurrent slot
      const longTask = bulkhead.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'long';
      });

      // Fill up queue
      const queuedTask = bulkhead.execute(async () => 'queued');

      // This should be rejected (disabled timeout doesn't help if queue is full)
      await expect(bulkhead.execute(async () => 'rejected')).rejects.toThrow('Queue is full');

      // Wait for tasks to complete before cleanup
      await Promise.allSettled([longTask, queuedTask]);
    });
  });

  describe('Queue Timeout', () => {
    it('should timeout queued requests', async () => {
      bulkhead = new Bulkhead({
        maxConcurrent: 1,
        maxQueue: 5,
        queueTimeout: 50,
      });

      // Start a long task
      const longTask = bulkhead.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'long';
      });

      // Queue a task that will timeout
      const queuedTask = bulkhead.execute(async () => 'queued');

      await expect(queuedTask).rejects.toThrow(/timed out/);

      // Cleanup
      await longTask;
    });
  });

  describe('Utilization', () => {
    it('should report utilization', async () => {
      bulkhead = new Bulkhead({ maxConcurrent: 2 });

      expect(bulkhead.getUtilization()).toBe(0);

      const task = bulkhead.execute(async () => {
        expect(bulkhead.getUtilization()).toBe(50);
        return 'done';
      });

      await task;
    });

    it('should report availability', async () => {
      bulkhead = new Bulkhead({ maxConcurrent: 1, maxQueue: 1 });

      expect(bulkhead.isAvailable()).toBe(true);

      const task = bulkhead.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'done';
      });

      // Still available because queue has space
      expect(bulkhead.isAvailable()).toBe(true);

      await task;
    });
  });

  describe('Drain', () => {
    it('should reject all queued requests on drain', async () => {
      bulkhead = new Bulkhead({ maxConcurrent: 1, maxQueue: 5, queueTimeout: 10000 });

      // Start a long task
      const longTask = bulkhead.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'long';
      });

      // Queue some tasks
      const queuedTasks = [
        bulkhead.execute(async () => 'q1'),
        bulkhead.execute(async () => 'q2'),
      ];

      // Drain the queue
      bulkhead.drain();

      // Queued tasks should be rejected
      for (const task of queuedTasks) {
        await expect(task).rejects.toThrow('Queue drained');
      }

      await longTask;
    });
  });
});

// ============================================================================
// Rate Limiter Tests
// ============================================================================

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  afterEach(() => {
    if (rateLimiter) {
      rateLimiter.stop();
      rateLimiter.removeAllListeners();
    }
  });

  describe('Token Bucket', () => {
    it('should start with initial tokens', () => {
      rateLimiter = new RateLimiter({ maxTokens: 100, initialTokens: 50 });

      expect(rateLimiter.getTokens()).toBe(50);
    });

    it('should start with max tokens if no initial specified', () => {
      rateLimiter = new RateLimiter({ maxTokens: 100 });

      expect(rateLimiter.getTokens()).toBe(100);
    });
  });

  describe('Token Acquisition', () => {
    it('should acquire tokens immediately when available', () => {
      rateLimiter = new RateLimiter({ maxTokens: 100 });

      const acquired = rateLimiter.tryAcquire(10);

      expect(acquired).toBe(true);
      expect(rateLimiter.getTokens()).toBe(90);
    });

    it('should reject when insufficient tokens', () => {
      rateLimiter = new RateLimiter({ maxTokens: 10, initialTokens: 5 });

      const acquired = rateLimiter.tryAcquire(10);

      expect(acquired).toBe(false);
      expect(rateLimiter.getTokens()).toBe(5);
    });

    it('should throw when requesting more than max', () => {
      rateLimiter = new RateLimiter({ maxTokens: 10 });

      expect(() => rateLimiter.tryAcquire(20)).toThrow(/max is 10/);
    });
  });

  describe('Async Acquisition', () => {
    it('should wait for tokens when not available', async () => {
      rateLimiter = new RateLimiter({
        maxTokens: 10,
        initialTokens: 0,
        refillAmount: 5,
        refillInterval: 50,
      });

      const acquirePromise = rateLimiter.acquire(5);

      // Should not have acquired yet
      expect(rateLimiter.getTokens()).toBe(0);

      const acquired = await acquirePromise;

      expect(acquired).toBe(true);
    });

    it('should timeout waiting requests', async () => {
      rateLimiter = new RateLimiter({
        maxTokens: 10,
        initialTokens: 0,
        refillInterval: 10000, // Very slow refill
        timeout: 50,
      });

      await expect(rateLimiter.acquire(5)).rejects.toThrow(/timed out/);
    });
  });

  describe('Refill', () => {
    it('should refill tokens periodically', async () => {
      rateLimiter = new RateLimiter({
        maxTokens: 100,
        initialTokens: 50,
        refillAmount: 10,
        refillInterval: 50,
      });

      await new Promise((resolve) => setTimeout(resolve, 70));

      expect(rateLimiter.getTokens()).toBe(60);
    });

    it('should not exceed max tokens', async () => {
      rateLimiter = new RateLimiter({
        maxTokens: 100,
        initialTokens: 95,
        refillAmount: 10,
        refillInterval: 50,
      });

      await new Promise((resolve) => setTimeout(resolve, 70));

      expect(rateLimiter.getTokens()).toBe(100);
    });

    it('should emit refill event', async () => {
      rateLimiter = new RateLimiter({
        maxTokens: 100,
        initialTokens: 90,
        refillAmount: 10,
        refillInterval: 50,
      });

      let refillEmitted = false;
      rateLimiter.on('refill', () => {
        refillEmitted = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 70));

      expect(refillEmitted).toBe(true);
    });
  });

  describe('Execute', () => {
    it('should execute function when tokens available', async () => {
      rateLimiter = new RateLimiter({ maxTokens: 100 });

      const result = await rateLimiter.execute(async () => 'success');

      expect(result).toBe('success');
    });

    it('should consume tokens on execute', async () => {
      rateLimiter = new RateLimiter({ maxTokens: 100 });

      await rateLimiter.execute(async () => 'success', 10);

      expect(rateLimiter.getTokens()).toBe(90); // 100 - 10
    });
  });

  describe('Metrics', () => {
    it('should track acquisition metrics', async () => {
      rateLimiter = new RateLimiter({ maxTokens: 100 });

      rateLimiter.tryAcquire(10);
      rateLimiter.tryAcquire(10);

      const metrics = rateLimiter.getMetrics();
      expect(metrics.totalAcquired).toBe(2);
    });

    it('should track rejection metrics', () => {
      rateLimiter = new RateLimiter({ maxTokens: 10, initialTokens: 5 });

      rateLimiter.tryAcquire(10);

      const metrics = rateLimiter.getMetrics();
      expect(metrics.totalRejected).toBe(1);
    });
  });

  describe('Reset', () => {
    it('should reset to initial state', () => {
      rateLimiter = new RateLimiter({ maxTokens: 100, initialTokens: 50 });

      rateLimiter.tryAcquire(30);
      expect(rateLimiter.getTokens()).toBe(20);

      rateLimiter.reset();

      expect(rateLimiter.getTokens()).toBe(50);
      expect(rateLimiter.getMetrics().totalAcquired).toBe(0);
    });
  });

  describe('Stop', () => {
    it('should reject waiting requests on stop', async () => {
      rateLimiter = new RateLimiter({
        maxTokens: 10,
        initialTokens: 0,
        refillInterval: 10000,
      });

      const acquirePromise = rateLimiter.acquire(5);

      rateLimiter.stop();

      await expect(acquirePromise).rejects.toThrow('Stopped');
    });
  });
});

// ============================================================================
// Retry Handler Tests
// ============================================================================

describe('RetryHandler', () => {
  describe('Successful Execution', () => {
    it('should return result on success', async () => {
      const handler = new RetryHandler();

      const result = await handler.execute(async () => 'success');

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(result.attempts).toBe(1);
    });

    it('should emit success event', async () => {
      const handler = new RetryHandler();
      let successEmitted = false;

      handler.on('success', () => {
        successEmitted = true;
      });

      await handler.execute(async () => 'success');

      expect(successEmitted).toBe(true);
    });
  });

  describe('Retry Logic', () => {
    it('should retry on failure', async () => {
      let attempts = 0;
      const handler = new RetryHandler({ maxRetries: 3 });

      const result = await handler.execute(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Temporary failure');
        }
        return 'success';
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(3);
    });

    it('should fail after max retries', async () => {
      const handler = new RetryHandler({ maxRetries: 2 });

      const result = await handler.execute(async () => {
        throw new Error('Permanent failure');
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3); // 1 initial + 2 retries
      expect(result.error?.message).toBe('Permanent failure');
    });

    it('should emit retry event', async () => {
      let retryCount = 0;
      const handler = new RetryHandler({
        maxRetries: 2,
        initialDelay: 10,
      });

      handler.on('retry', () => {
        retryCount++;
      });

      await handler.execute(async () => {
        throw new Error('Failure');
      });

      expect(retryCount).toBe(2);
    });

    it('should call onRetry callback', async () => {
      let callbackAttempts: number[] = [];
      const handler = new RetryHandler({
        maxRetries: 2,
        initialDelay: 10,
        onRetry: (attempt) => {
          callbackAttempts.push(attempt);
        },
      });

      await handler.execute(async () => {
        throw new Error('Failure');
      });

      expect(callbackAttempts).toEqual([1, 2]);
    });
  });

  describe('Conditional Retry', () => {
    it('should not retry if retryOn returns false', async () => {
      let attempts = 0;
      const handler = new RetryHandler({
        maxRetries: 3,
        retryOn: (error) => error.message !== 'Non-retryable',
      });

      const result = await handler.execute(async () => {
        attempts++;
        throw new Error('Non-retryable');
      });

      expect(result.success).toBe(false);
      expect(attempts).toBe(1);
    });

    it('should retry if retryOn returns true', async () => {
      let attempts = 0;
      const handler = new RetryHandler({
        maxRetries: 3,
        initialDelay: 10,
        retryOn: (error) => error.message === 'Retryable',
      });

      await handler.execute(async () => {
        attempts++;
        throw new Error('Retryable');
      });

      expect(attempts).toBe(4); // 1 initial + 3 retries
    });
  });

  describe('Backoff Strategies', () => {
    it('should use fixed backoff', () => {
      const handler = new RetryHandler({
        backoffStrategy: BackoffStrategy.FIXED,
        initialDelay: 100,
      });

      expect(handler.calculateDelay(1)).toBe(100);
      expect(handler.calculateDelay(2)).toBe(100);
      expect(handler.calculateDelay(3)).toBe(100);
    });

    it('should use linear backoff', () => {
      const handler = new RetryHandler({
        backoffStrategy: BackoffStrategy.LINEAR,
        initialDelay: 100,
      });

      expect(handler.calculateDelay(1)).toBe(100);
      expect(handler.calculateDelay(2)).toBe(200);
      expect(handler.calculateDelay(3)).toBe(300);
    });

    it('should use exponential backoff', () => {
      const handler = new RetryHandler({
        backoffStrategy: BackoffStrategy.EXPONENTIAL,
        initialDelay: 100,
        multiplier: 2,
      });

      expect(handler.calculateDelay(1)).toBe(100);
      expect(handler.calculateDelay(2)).toBe(200);
      expect(handler.calculateDelay(3)).toBe(400);
    });

    it('should respect max delay', () => {
      const handler = new RetryHandler({
        backoffStrategy: BackoffStrategy.EXPONENTIAL,
        initialDelay: 100,
        multiplier: 2,
        maxDelay: 300,
      });

      expect(handler.calculateDelay(1)).toBe(100);
      expect(handler.calculateDelay(2)).toBe(200);
      expect(handler.calculateDelay(3)).toBe(300); // Capped
      expect(handler.calculateDelay(4)).toBe(300); // Still capped
    });

    it('should use exponential with jitter', () => {
      const handler = new RetryHandler({
        backoffStrategy: BackoffStrategy.EXPONENTIAL_WITH_JITTER,
        initialDelay: 100,
        multiplier: 2,
        jitterFactor: 0.1,
      });

      const delay1 = handler.calculateDelay(1);
      expect(delay1).toBeGreaterThanOrEqual(90);
      expect(delay1).toBeLessThanOrEqual(110);
    });

    it('should use decorrelated jitter', () => {
      const handler = new RetryHandler({
        backoffStrategy: BackoffStrategy.DECORRELATED_JITTER,
        initialDelay: 100,
      });

      const delay = handler.calculateDelay(2);
      expect(delay).toBeGreaterThanOrEqual(100);
    });
  });

  describe('executeOrThrow', () => {
    it('should return result on success', async () => {
      const handler = new RetryHandler();

      const result = await handler.executeOrThrow(async () => 'success');

      expect(result).toBe('success');
    });

    it('should throw on failure', async () => {
      const handler = new RetryHandler({ maxRetries: 1, initialDelay: 10 });

      await expect(
        handler.executeOrThrow(async () => {
          throw new Error('Failure');
        })
      ).rejects.toThrow('Failure');
    });
  });
});

// ============================================================================
// Timeout Handler Tests
// ============================================================================

describe('TimeoutHandler', () => {
  let handler: TimeoutHandler;

  afterEach(() => {
    if (handler) {
      handler.removeAllListeners();
    }
  });

  describe('Basic Execution', () => {
    it('should return result when fast', async () => {
      handler = new TimeoutHandler({ defaultTimeout: 1000 });

      const result = await handler.execute(async () => 'success');

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(result.timedOut).toBe(false);
    });

    it('should timeout slow operations', async () => {
      handler = new TimeoutHandler({ defaultTimeout: 50 });

      const result = await handler.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'success';
      });

      expect(result.success).toBe(false);
      expect(result.timedOut).toBe(true);
    });

    it('should handle errors', async () => {
      handler = new TimeoutHandler({ defaultTimeout: 1000 });

      // Add error listener to prevent unhandled error event
      handler.on('error', () => {
        // Expected - handler emits error event
      });

      const result = await handler.execute(async () => {
        throw new Error('Test error');
      });

      expect(result.success).toBe(false);
      expect(result.timedOut).toBe(false);
      expect(result.error?.message).toBe('Test error');
    });
  });

  describe('Timeout Configuration', () => {
    it('should use per-call timeout', async () => {
      handler = new TimeoutHandler({ defaultTimeout: 1000 });

      const result = await handler.execute(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return 'success';
        },
        50 // Override timeout
      );

      expect(result.timedOut).toBe(true);
    });

    it('should call onTimeout callback', async () => {
      let callbackCalled = false;
      handler = new TimeoutHandler({
        defaultTimeout: 50,
        onTimeout: () => {
          callbackCalled = true;
        },
      });

      await handler.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(callbackCalled).toBe(true);
    });
  });

  describe('Events', () => {
    it('should emit success event', async () => {
      handler = new TimeoutHandler();
      let successEmitted = false;

      handler.on('success', () => {
        successEmitted = true;
      });

      await handler.execute(async () => 'success');

      expect(successEmitted).toBe(true);
    });

    it('should emit timeout event', async () => {
      handler = new TimeoutHandler({ defaultTimeout: 50 });
      let timeoutEmitted = false;

      handler.on('timeout', () => {
        timeoutEmitted = true;
      });

      await handler.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(timeoutEmitted).toBe(true);
    });

    it('should emit error event', async () => {
      handler = new TimeoutHandler();
      let errorEmitted = false;

      handler.on('error', () => {
        errorEmitted = true;
      });

      await handler.execute(async () => {
        throw new Error('Test error');
      });

      expect(errorEmitted).toBe(true);
    });
  });

  describe('executeOrThrow', () => {
    it('should return result on success', async () => {
      handler = new TimeoutHandler();

      const result = await handler.executeOrThrow(async () => 'success');

      expect(result).toBe('success');
    });

    it('should throw on timeout', async () => {
      handler = new TimeoutHandler({ defaultTimeout: 50 });

      await expect(
        handler.executeOrThrow(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return 'success';
        })
      ).rejects.toThrow(/timed out/);
    });

    it('should throw on error', async () => {
      handler = new TimeoutHandler();

      // Add error listener to prevent unhandled error event
      handler.on('error', () => {
        // Expected - handler emits error event
      });

      await expect(
        handler.executeOrThrow(async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');
    });
  });

  describe('Race', () => {
    it('should return result when fast', async () => {
      handler = new TimeoutHandler({ defaultTimeout: 1000 });

      const result = await handler.race(async () => 'success');

      expect(result).toBe('success');
    });

    it('should reject on timeout', async () => {
      handler = new TimeoutHandler({ defaultTimeout: 50 });

      await expect(
        handler.race(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return 'success';
        })
      ).rejects.toThrow(/timed out/);
    });
  });

  describe('Wrap', () => {
    it('should wrap function with timeout', async () => {
      handler = new TimeoutHandler({ defaultTimeout: 1000 });

      const wrapped = handler.wrap(async (x: number) => x * 2);

      const result = await wrapped(5);

      expect(result).toBe(10);
    });

    it('should timeout wrapped function', async () => {
      handler = new TimeoutHandler({ defaultTimeout: 50 });

      const wrapped = handler.wrap(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'success';
      });

      await expect(wrapped()).rejects.toThrow(/timed out/);
    });
  });

  describe('Duration Tracking', () => {
    it('should track execution duration', async () => {
      handler = new TimeoutHandler();

      const result = await handler.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'success';
      });

      expect(result.duration).toBeGreaterThanOrEqual(40);
      expect(result.duration).toBeLessThan(200);
    });
  });
});

// ============================================================================
// Resilience Builder Tests
// ============================================================================

describe('ResilienceBuilder', () => {
  let builder: ResilienceBuilder;

  afterEach(() => {
    if (builder) {
      builder.shutdown();
    }
  });

  describe('Pattern Initialization', () => {
    it('should initialize circuit breaker', () => {
      const config: IResilienceConfig = {
        circuitBreaker: { failureThreshold: 5 },
      };

      builder = new ResilienceBuilder('test', config);

      expect(builder.getCircuitBreaker()).toBeDefined();
    });

    it('should initialize bulkhead', () => {
      const config: IResilienceConfig = {
        bulkhead: { maxConcurrent: 10 },
      };

      builder = new ResilienceBuilder('test', config);

      expect(builder.getBulkhead()).toBeDefined();
    });

    it('should initialize rate limiter', () => {
      const config: IResilienceConfig = {
        rateLimiter: { maxTokens: 100 },
      };

      builder = new ResilienceBuilder('test', config);

      expect(builder.getRateLimiter()).toBeDefined();
    });

    it('should initialize retry handler', () => {
      const config: IResilienceConfig = {
        retry: { maxRetries: 3 },
      };

      builder = new ResilienceBuilder('test', config);

      expect(builder.getRetryHandler()).toBeDefined();
    });

    it('should initialize timeout handler', () => {
      const config: IResilienceConfig = {
        timeout: { defaultTimeout: 5000 },
      };

      builder = new ResilienceBuilder('test', config);

      expect(builder.getTimeoutHandler()).toBeDefined();
    });
  });

  describe('Combined Execution', () => {
    it('should execute with all patterns', async () => {
      const config: IResilienceConfig = {
        circuitBreaker: { failureThreshold: 5, volumeThreshold: 5 },
        bulkhead: { maxConcurrent: 10 },
        rateLimiter: { maxTokens: 100, refillInterval: 10000 },
        retry: { maxRetries: 2 },
        timeout: { defaultTimeout: 1000 },
      };

      builder = new ResilienceBuilder('test', config);

      const result = await builder.execute(async () => 'success');

      expect(result).toBe('success');
    });

    it('should apply rate limiting', async () => {
      const config: IResilienceConfig = {
        rateLimiter: { maxTokens: 2, initialTokens: 2, refillInterval: 10000 },
      };

      builder = new ResilienceBuilder('test', config);

      await builder.execute(async () => 'one');
      await builder.execute(async () => 'two');

      // Third should wait for refill (or timeout)
      const rl = builder.getRateLimiter()!;
      expect(rl.getTokens()).toBe(0);
    });

    it('should apply circuit breaker', async () => {
      const config: IResilienceConfig = {
        circuitBreaker: {
          failureThreshold: 2,
          volumeThreshold: 2,
          resetTimeout: 60000,
        },
      };

      builder = new ResilienceBuilder('test', config);

      // Cause failures to open circuit
      for (let i = 0; i < 2; i++) {
        try {
          await builder.execute(async () => {
            throw new Error('Failure');
          });
        } catch {
          // Expected
        }
      }

      const cb = builder.getCircuitBreaker()!;
      expect(cb.getState()).toBe(CircuitBreakerState.OPEN);

      // Next call should be rejected
      await expect(builder.execute(async () => 'success')).rejects.toThrow(
        'Circuit breaker is open'
      );
    });

    it('should apply timeout', async () => {
      const config: IResilienceConfig = {
        timeout: { defaultTimeout: 50 },
      };

      builder = new ResilienceBuilder('test', config);

      await expect(
        builder.execute(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return 'success';
        })
      ).rejects.toThrow(/timed out/);
    });

    it('should apply retry', async () => {
      let attempts = 0;
      const config: IResilienceConfig = {
        retry: { maxRetries: 2, initialDelay: 10 },
      };

      builder = new ResilienceBuilder('test', config);

      const result = await builder.execute(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Temporary failure');
        }
        return 'success';
      });

      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });
  });

  describe('Shutdown', () => {
    it('should shutdown all patterns', () => {
      const config: IResilienceConfig = {
        circuitBreaker: {},
        bulkhead: {},
        rateLimiter: {},
        retry: {},
        timeout: {},
      };

      builder = new ResilienceBuilder('test', config);
      builder.shutdown();

      // Circuit breaker should be reset
      const cb = builder.getCircuitBreaker()!;
      expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
    });
  });
});

// ============================================================================
// Edge Cases and Integration Tests
// ============================================================================

describe('Integration Tests', () => {
  describe('Circuit Breaker + Retry', () => {
    it('should retry until circuit opens', async () => {
      const circuitBreaker = new CircuitBreaker('test', {
        failureThreshold: 3,
        volumeThreshold: 3,
      });

      const retryHandler = new RetryHandler({
        maxRetries: 5,
        initialDelay: 10,
      });

      let attempts = 0;

      const result = await retryHandler.execute(async () => {
        attempts++;
        return circuitBreaker.execute(async () => {
          throw new Error('Service error');
        });
      });

      // Circuit should be open, retry should have stopped
      expect(result.success).toBe(false);
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);

      circuitBreaker.reset();
    });
  });

  describe('Rate Limiter + Bulkhead', () => {
    it('should handle both rate limiting and concurrency', async () => {
      const rateLimiter = new RateLimiter({
        maxTokens: 5,
        initialTokens: 5,
        refillInterval: 10000,
      });

      const bulkhead = new Bulkhead({
        maxConcurrent: 2,
        maxQueue: 3,
      });

      const results: string[] = [];

      const execute = async (id: string) => {
        const acquired = rateLimiter.tryAcquire();
        if (!acquired) {
          return 'rate-limited';
        }
        return bulkhead.execute(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          results.push(id);
          return id;
        });
      };

      const promises = Array.from({ length: 10 }, (_, i) => execute(`task-${i}`));
      const taskResults = await Promise.all(promises);

      // Some should be rate-limited
      expect(taskResults.filter((r) => r === 'rate-limited').length).toBeGreaterThan(0);

      rateLimiter.stop();
      bulkhead.drain();
    });
  });
});
