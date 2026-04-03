/**
 * Tests for AsyncLock utility
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AsyncLock, AsyncLockTimeoutError, createAsyncLock, createTokenRefreshLock, withLock } from '../async-lock.js';

describe('AsyncLock', () => {
  let lock: AsyncLock;

  beforeEach(() => {
    lock = new AsyncLock({ timeout: 5000 });
  });

  describe('acquire', () => {
    it('executes operation and returns result', async () => {
      const { value, wasExecutor } = await lock.acquire('test', async () => 'result');
      expect(value).toBe('result');
      expect(wasExecutor).toBe(true);
    });

    it('multiple concurrent calls share same result', async () => {
      let executionCount = 0;

      const operation = async () => {
        executionCount++;
        await new Promise((r) => setTimeout(r, 50));
        return 'shared-result';
      };

      const [r1, r2, r3] = await Promise.all([
        lock.acquire('test', operation),
        lock.acquire('test', operation),
        lock.acquire('test', operation),
      ]);

      expect(executionCount).toBe(1);
      expect(r1.value).toBe('shared-result');
      expect(r2.value).toBe('shared-result');
      expect(r3.value).toBe('shared-result');
      expect(r1.wasExecutor).toBe(true);
      expect(r2.wasExecutor).toBe(false);
      expect(r3.wasExecutor).toBe(false);
    });

    it('propagates errors to all waiters', async () => {
      const error = new Error('Test error');
      const operation = async () => {
        await new Promise((r) => setTimeout(r, 20));
        throw error;
      };

      const promises = [lock.acquire('test', operation), lock.acquire('test', operation)];

      await expect(Promise.all(promises)).rejects.toThrow('Test error');
    });

    it('releases lock after operation completes', async () => {
      await lock.acquire('test', async () => 'done');
      expect(lock.isLocked('test')).toBe(false);

      // Can acquire again
      const { value } = await lock.acquire('test', async () => 'second');
      expect(value).toBe('second');
    });

    it('handles different keys independently', async () => {
      let count1 = 0;
      let count2 = 0;

      await Promise.all([
        lock.acquire('key1', async () => {
          count1++;
        }),
        lock.acquire('key2', async () => {
          count2++;
        }),
      ]);

      expect(count1).toBe(1);
      expect(count2).toBe(1);
    });
  });

  describe('tryAcquire', () => {
    it('returns null if lock is held', async () => {
      const slowOperation = new Promise((r) => setTimeout(r, 100));

      const acquirePromise = lock.acquire('test', async () => {
        await slowOperation;
        return 'done';
      });

      // Wait a tick for the lock to be acquired
      await new Promise((r) => setTimeout(r, 10));

      const tryResult = await lock.tryAcquire('test', async () => 'would-not-run');
      expect(tryResult).toBeNull();

      await acquirePromise;
    });

    it('acquires if lock is available', async () => {
      const result = await lock.tryAcquire('test', async () => 'acquired');
      expect(result?.value).toBe('acquired');
      expect(result?.wasExecutor).toBe(true);
    });
  });

  describe('getState', () => {
    it('returns idle when not locked', () => {
      expect(lock.getState('test')).toBe('idle');
    });

    it('returns locked when operation in progress', async () => {
      const operationPromise = lock.acquire('test', async () => {
        await new Promise((r) => setTimeout(r, 100));
        return 'done';
      });

      await new Promise((r) => setTimeout(r, 10));
      expect(lock.getState('test')).toBe('locked');

      await operationPromise;
    });
  });

  describe('isLocked', () => {
    it('returns false when not locked', () => {
      expect(lock.isLocked('test')).toBe(false);
    });

    it('returns true when locked', async () => {
      const operationPromise = lock.acquire('test', async () => {
        await new Promise((r) => setTimeout(r, 100));
        return 'done';
      });

      await new Promise((r) => setTimeout(r, 10));
      expect(lock.isLocked('test')).toBe(true);

      await operationPromise;
    });
  });

  describe('getActiveLocks', () => {
    it('returns empty array when no locks', () => {
      expect(lock.getActiveLocks()).toEqual([]);
    });

    it('returns active lock keys', async () => {
      const op1 = lock.acquire('key1', () => new Promise((r) => setTimeout(r, 100)));
      const op2 = lock.acquire('key2', () => new Promise((r) => setTimeout(r, 100)));

      await new Promise((r) => setTimeout(r, 10));
      const activeLocks = lock.getActiveLocks();
      expect(activeLocks).toContain('key1');
      expect(activeLocks).toContain('key2');

      await Promise.all([op1, op2]);
    });
  });

  describe('forceRelease', () => {
    it('releases lock and rejects waiters', async () => {
      // Create a waiter that will be rejected
      const operationStarted = new Promise<void>((resolve) => {
        lock
          .acquire('test', async () => {
            resolve();
            await new Promise((r) => setTimeout(r, 500));
            return 'done';
          })
          .catch(() => {
            // Expected rejection from forceRelease
          });
      });

      await operationStarted;
      await new Promise((r) => setTimeout(r, 10));

      // Now add a waiter
      const waiterPromise = lock.acquire('test', async () => 'waiter-result');

      lock.forceRelease('test', new Error('Forced release'));

      await expect(waiterPromise).rejects.toThrow('Forced release');
    });
  });

  describe('clearAll', () => {
    it('clears all locks and rejects waiters', async () => {
      // Start two operations
      const op1Promise = lock.acquire('key1', async () => {
        await new Promise((r) => setTimeout(r, 200));
        return 'result1';
      });

      const op2Promise = lock.acquire('key2', async () => {
        await new Promise((r) => setTimeout(r, 200));
        return 'result2';
      });

      // Wait for locks to be acquired
      await new Promise((r) => setTimeout(r, 10));
      expect(lock.getActiveLocks().sort()).toEqual(['key1', 'key2']);

      // Add waiters for both keys
      const waiter1 = lock.acquire('key1', async () => 'waiter1').catch((e) => e);
      const waiter2 = lock.acquire('key2', async () => 'waiter2').catch((e) => e);

      // Clear all locks - this rejects waiters
      lock.clearAll(new Error('Cleared'));

      // Original operations may resolve (they're already running)
      // but waiters should be rejected
      const [w1Result, w2Result] = await Promise.all([waiter1, waiter2]);

      expect(w1Result).toBeInstanceOf(Error);
      expect((w1Result as Error).message).toBe('Cleared');
      expect(w2Result).toBeInstanceOf(Error);
      expect((w2Result as Error).message).toBe('Cleared');

      // Locks should be cleared
      expect(lock.getActiveLocks()).toEqual([]);

      // Let the original operations finish (they won't resolve through the lock anymore)
      // We need to handle potential rejections
      try {
        await Promise.race([Promise.allSettled([op1Promise, op2Promise]), new Promise((r) => setTimeout(r, 300))]);
      } catch {
        // Ignore
      }
    });
  });

  describe('timeout', () => {
    it('throws AsyncLockTimeoutError on timeout', async () => {
      const shortTimeoutLock = new AsyncLock({ timeout: 50 });

      const slowOperationPromise = shortTimeoutLock.acquire('test', async () => {
        await new Promise((r) => setTimeout(r, 200));
        return 'done';
      });

      await new Promise((r) => setTimeout(r, 10));

      const waiterPromise = shortTimeoutLock.acquire('test', async () => 'waiter');

      await expect(waiterPromise).rejects.toThrow(AsyncLockTimeoutError);

      // Clean up
      try {
        await slowOperationPromise;
      } catch {
        // Ignore
      }
    });
  });
});

describe('createAsyncLock', () => {
  it('creates new AsyncLock instance', () => {
    const lock = createAsyncLock();
    expect(lock).toBeInstanceOf(AsyncLock);
  });

  it('accepts options', () => {
    const lock = createAsyncLock({ timeout: 1000 });
    expect(lock).toBeInstanceOf(AsyncLock);
  });
});

describe('createTokenRefreshLock', () => {
  it('creates AsyncLock with token refresh defaults', () => {
    const lock = createTokenRefreshLock();
    expect(lock).toBeInstanceOf(AsyncLock);
  });
});

describe('withLock', () => {
  it('executes operation with locking', async () => {
    const result = await withLock('test-key', async () => 'result');
    expect(result).toBe('result');
  });

  it('shares result across concurrent calls', async () => {
    let count = 0;
    const operation = async () => {
      count++;
      await new Promise((r) => setTimeout(r, 50));
      return 'shared';
    };

    const [r1, r2] = await Promise.all([withLock('same-key', operation), withLock('same-key', operation)]);

    expect(count).toBe(1);
    expect(r1).toBe('shared');
    expect(r2).toBe('shared');
  });
});

describe('AsyncLockTimeoutError', () => {
  it('has correct name', () => {
    const error = new AsyncLockTimeoutError('Test timeout');
    expect(error.name).toBe('AsyncLockTimeoutError');
    expect(error.message).toBe('Test timeout');
  });

  it('is instanceof Error', () => {
    const error = new AsyncLockTimeoutError('Test');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AsyncLockTimeoutError);
  });
});
