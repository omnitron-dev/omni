/**
 * Server Function Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { serverFunction, batchServerFunctions } from '../../src/data/server-function.js';
import { resetCacheManager } from '../../src/data/cache-manager.js';

describe('Server Function', () => {
  beforeEach(() => {
    resetCacheManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetCacheManager();
    vi.useRealTimers();
  });

  describe('Basic Execution', () => {
    it('should execute server function', async () => {
      const fn = serverFunction(async (x: number) => x * 2);

      const result = await fn(5);

      expect(result).toBe(10);
    });

    it('should handle async operations', async () => {
      const fn = serverFunction(
        async (delay: number) =>
          new Promise((resolve) => {
            setTimeout(() => resolve('done'), delay);
          })
      );

      const promise = fn(100);
      vi.advanceTimersByTime(100);
      const result = await promise;

      expect(result).toBe('done');
    });

    it('should pass multiple arguments', async () => {
      const fn = serverFunction(async (a: number, b: number, c: number) => a + b + c);

      const result = await fn(1, 2, 3);

      expect(result).toBe(6);
    });
  });

  describe('Caching', () => {
    it('should cache results', async () => {
      let callCount = 0;
      const fn = serverFunction(
        async (x: number) => {
          callCount++;
          return x * 2;
        },
        {
          name: 'double',
          cache: { ttl: 60000 },
        }
      );

      // First call
      await fn(5);
      expect(callCount).toBe(1);

      // Second call - should use cache
      await fn(5);
      expect(callCount).toBe(1);

      // Different argument - should call function
      await fn(10);
      expect(callCount).toBe(2);
    });

    it('should respect TTL', async () => {
      let callCount = 0;
      const fn = serverFunction(
        async (x: number) => {
          callCount++;
          return x * 2;
        },
        {
          name: 'double',
          cache: { ttl: 1000 },
        }
      );

      await fn(5);
      expect(callCount).toBe(1);

      // Before TTL expires
      await fn(5);
      expect(callCount).toBe(1);

      // After TTL expires
      vi.advanceTimersByTime(1500);
      await fn(5);
      expect(callCount).toBe(2);
    });

    it('should use custom cache key', async () => {
      let callCount = 0;
      const fn = serverFunction(
        async (user: { id: number; name: string }) => {
          callCount++;
          return user;
        },
        {
          name: 'getUser',
          cache: {
            ttl: 60000,
            key: (user) => `user:${user.id}`,
          },
        }
      );

      await fn({ id: 1, name: 'Alice' });
      expect(callCount).toBe(1);

      // Same ID, different name - should use cache
      await fn({ id: 1, name: 'Bob' });
      expect(callCount).toBe(1);

      // Different ID - should call function
      await fn({ id: 2, name: 'Alice' });
      expect(callCount).toBe(2);
    });

    it('should support stale-while-revalidate', async () => {
      let callCount = 0;
      const fn = serverFunction(
        async (x: number) => {
          callCount++;
          return x * 2;
        },
        {
          name: 'double',
          cache: {
            ttl: 60000,
            staleWhileRevalidate: true,
            staleTime: 1000,
          },
        }
      );

      // First call
      const result1 = await fn(5);
      expect(result1).toBe(10);
      expect(callCount).toBe(1);

      // Before stale time - returns cached, no revalidation
      const result2 = await fn(5);
      expect(result2).toBe(10);
      expect(callCount).toBe(1);

      // After stale time - returns cached, triggers background revalidation
      vi.advanceTimersByTime(1500);
      const result3 = await fn(5);
      expect(result3).toBe(10);

      // Wait for background revalidation
      await vi.runAllTimersAsync();

      expect(callCount).toBe(2);
    });
  });

  describe('Retry Logic', () => {
    it('should retry on failure', async () => {
      let attemptCount = 0;
      const fn = serverFunction(
        async () => {
          attemptCount++;
          if (attemptCount < 3) {
            throw new Error('Temporary failure');
          }
          return 'success';
        },
        {
          retry: {
            maxRetries: 3,
            delay: 100,
            backoff: 2,
          },
        }
      );

      const promise = fn();

      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result).toBe('success');
      expect(attemptCount).toBe(3);
    });

    it('should fail after max retries', async () => {
      // Use real timers for this test to avoid unhandled rejection issues with fake timers
      vi.useRealTimers();

      let attemptCount = 0;
      const fn = serverFunction(
        async () => {
          attemptCount++;
          throw new Error('Permanent failure');
        },
        {
          retry: {
            maxRetries: 2,
            delay: 10, // Short delay for faster test
            backoff: 1,
          },
        }
      );

      await expect(fn()).rejects.toThrow('Permanent failure');
      expect(attemptCount).toBe(3); // Initial + 2 retries

      // Restore fake timers for other tests
      vi.useFakeTimers();
    });
  });

  describe('Timeout', () => {
    it('should timeout after specified duration', async () => {
      // Already using real timers - no change needed
      vi.useRealTimers();

      const fn = serverFunction(
        async () =>
          new Promise((resolve) => {
            setTimeout(() => resolve('success'), 100);
          }),
        {
          timeout: 10,
        }
      );

      await expect(fn()).rejects.toThrow('timeout');

      // Restore fake timers for other tests
      vi.useFakeTimers();
    });

    it('should succeed if completed before timeout', async () => {
      vi.useRealTimers();
      const fn = serverFunction(
        async () =>
          new Promise((resolve) => {
            setTimeout(() => resolve('success'), 10);
          }),
        {
          timeout: 100,
        }
      );

      const result = await fn();
      expect(result).toBe('success');
      vi.useFakeTimers();
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate cached results', async () => {
      let callCount = 0;
      const fn = serverFunction(
        async (x: number) => {
          callCount++;
          return x * 2;
        },
        {
          name: 'double',
          cache: { ttl: 60000 },
        }
      );

      await fn(5);
      expect(callCount).toBe(1);

      // Should use cache
      await fn(5);
      expect(callCount).toBe(1);

      // Invalidate
      fn.invalidate(5);

      // Should call function again
      await fn(5);
      expect(callCount).toBe(2);
    });

    it('should get cached result without triggering request', async () => {
      const fn = serverFunction(async (x: number) => x * 2, {
        name: 'double',
        cache: { ttl: 60000 },
      });

      // Not cached yet
      expect(fn.getCached(5)).toBeUndefined();

      // Cache it
      await fn(5);

      // Now cached
      expect(fn.getCached(5)).toBe(10);
    });
  });

  describe('Batch Server Functions', () => {
    it('should execute multiple functions in parallel', async () => {
      const fn1 = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'result1';
      };

      const fn2 = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'result2';
      };

      const fn3 = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'result3';
      };

      const promise = batchServerFunctions([fn1(), fn2(), fn3()]);

      vi.advanceTimersByTime(150);

      const results = await promise;

      expect(results).toEqual(['result1', 'result2', 'result3']);
    });

    it('should fail if any function fails', async () => {
      const fn1 = async () => 'success';
      const fn2 = async () => {
        throw new Error('Failed');
      };

      const promise = batchServerFunctions([fn1(), fn2()]);

      await expect(promise).rejects.toThrow('Failed');
    });

    it('should type check results correctly', async () => {
      const getUser = async () => ({ id: 1, name: 'Alice' });
      const getPosts = async () => [{ id: 1, title: 'Post 1' }];
      const getCount = async () => 42;

      const [user, posts, count] = await batchServerFunctions([getUser(), getPosts(), getCount()]);

      // TypeScript should infer correct types
      expect(user.id).toBe(1);
      expect(posts[0].title).toBe('Post 1');
      expect(count).toBe(42);
    });
  });

  describe('Error Handling', () => {
    it('should propagate errors', async () => {
      const fn = serverFunction(
        async () => {
          throw new Error('Test error');
        },
        {
          retry: { maxRetries: 0 },
        }
      );

      await expect(fn()).rejects.toThrow('Test error');
    });

    it('should not cache errors', async () => {
      let callCount = 0;
      const fn = serverFunction(
        async () => {
          callCount++;
          throw new Error('Error');
        },
        {
          name: 'failing',
          cache: { ttl: 60000 },
          retry: { maxRetries: 0 },
        }
      );

      await expect(fn()).rejects.toThrow('Error');
      expect(callCount).toBe(1);

      // Should not use cache, call again
      await expect(fn()).rejects.toThrow('Error');
      expect(callCount).toBe(2);
    });
  });

  describe('Type Safety', () => {
    it('should maintain type safety for arguments', async () => {
      const fn = serverFunction(async (x: number, y: string) => `${x}-${y}`);

      const result = await fn(42, 'test');
      expect(result).toBe('42-test');

      // TypeScript would catch these errors:
      // fn('wrong', 42);
      // fn(42);
    });

    it('should maintain type safety for return values', async () => {
      interface User {
        id: number;
        name: string;
      }

      const fn = serverFunction<[number], User>(async (id) => ({ id, name: 'Test' }));

      const result = await fn(1);

      // TypeScript knows result is User
      expect(result.id).toBe(1);
      expect(result.name).toBe('Test');
    });
  });
});
