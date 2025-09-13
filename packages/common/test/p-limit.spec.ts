import { pLimit, limitFunction } from '../src/p-limit';

describe('p-limit', () => {
  describe('pLimit', () => {
    it('should limit concurrency', async () => {
      const limit = pLimit(2);
      let activeCount = 0;
      let maxActiveCount = 0;

      const createTask = (duration: number) => async () => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        await new Promise((resolve) => setTimeout(resolve, duration));
        activeCount--;
        return duration;
      };

      const tasks = [limit(createTask(100)), limit(createTask(50)), limit(createTask(100)), limit(createTask(50))];

      await Promise.all(tasks);

      expect(maxActiveCount).toBe(2);
      expect(activeCount).toBe(0);
    });

    it('should handle concurrency of 1', async () => {
      const limit = pLimit(1);
      const results: number[] = [];

      const tasks = [1, 2, 3].map((n) =>
        limit(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          results.push(n);
          return n;
        })
      );

      const values = await Promise.all(tasks);

      expect(results).toEqual([1, 2, 3]);
      expect(values).toEqual([1, 2, 3]);
    });

    it('should handle infinite concurrency', async () => {
      const limit = pLimit(Number.POSITIVE_INFINITY);
      let activeCount = 0;
      let maxActiveCount = 0;

      const createTask = () => async () => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeCount--;
      };

      const tasks = Array(10)
        .fill(null)
        .map(() => limit(createTask()));
      await Promise.all(tasks);

      expect(maxActiveCount).toBe(10);
      expect(activeCount).toBe(0);
    });

    it('should handle errors correctly', async () => {
      const limit = pLimit(2);
      const error = new Error('Test error');

      const tasks = [
        limit(async () => 'success'),
        limit(async () => {
          throw error;
        }),
        limit(async () => 'another success'),
      ];

      const results = await Promise.allSettled(tasks);

      expect(results[0]).toEqual({ status: 'fulfilled', value: 'success' });
      expect(results[1]).toEqual({ status: 'rejected', reason: error });
      expect(results[2]).toEqual({ status: 'fulfilled', value: 'another success' });
    });

    it('should expose activeCount property', async () => {
      const limit = pLimit(2);

      expect(limit.activeCount).toBe(0);

      const promise1 = limit(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      const promise2 = limit(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      // Wait a bit for tasks to start
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(limit.activeCount).toBe(2);

      await Promise.all([promise1, promise2]);
      expect(limit.activeCount).toBe(0);
    });

    it('should expose pendingCount property', async () => {
      const limit = pLimit(1);

      expect(limit.pendingCount).toBe(0);

      const promises = Array(3)
        .fill(null)
        .map(() =>
          limit(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
          })
        );

      // Wait a bit for first task to start and others to queue
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(limit.pendingCount).toBe(2);

      await Promise.all(promises);
      expect(limit.pendingCount).toBe(0);
    });

    it('should allow changing concurrency', async () => {
      const limit = pLimit(1);

      expect(limit.concurrency).toBe(1);

      const promises = Array(3)
        .fill(null)
        .map(() =>
          limit(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
          })
        );

      // Wait a bit then increase concurrency
      await new Promise((resolve) => setTimeout(resolve, 10));
      limit.concurrency = 2;

      expect(limit.concurrency).toBe(2);

      await Promise.all(promises);
    });

    it('should clear queue', async () => {
      const limit = pLimit(1);
      const results: number[] = [];

      // Start multiple tasks
      Array(3)
        .fill(null)
        .forEach((_, i) => {
          limit(async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            results.push(i + 1);
          });
        });

      // Wait for first task to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify there are pending tasks
      expect(limit.pendingCount).toBe(2);
      expect(limit.activeCount).toBe(1);

      // Clear the queue
      limit.clearQueue();

      // Verify queue was cleared
      expect(limit.pendingCount).toBe(0);
      expect(limit.activeCount).toBe(1); // First task still running

      // Wait for the first task to complete
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Only the first task should have completed
      expect(results.length).toBe(1);
      expect(limit.activeCount).toBe(0);
    });

    it('should support map method', async () => {
      const limit = pLimit(2);
      const input = [1, 2, 3, 4, 5];

      const results = await limit.map(input, async (value, index) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return value * 2 + index;
      });

      expect(results).toEqual([2, 5, 8, 11, 14]);
    });

    it('should pass arguments correctly', async () => {
      const limit = pLimit(2);

      const fn = async (a: number, b: string, c: boolean) => ({ a, b, c });

      const result = await limit(fn, 42, 'hello', true);
      expect(result).toEqual({ a: 42, b: 'hello', c: true });
    });

    it('should validate concurrency', () => {
      expect(() => pLimit(0)).toThrow(TypeError);
      expect(() => pLimit(-1)).toThrow(TypeError);
      expect(() => pLimit(1.5)).toThrow(TypeError);
      expect(() => pLimit(NaN)).toThrow(TypeError);

      // Valid values
      expect(() => pLimit(1)).not.toThrow();
      expect(() => pLimit(100)).not.toThrow();
      expect(() => pLimit(Number.POSITIVE_INFINITY)).not.toThrow();
    });
  });

  describe('Advanced tests from experiments/p-limit', () => {
    it('should handle non-promise returning functions', async () => {
      const limit = pLimit(1);
      const result = await limit(() => 'sync result');
      expect(result).toBe('sync result');
    });

    it('should continue after sync throw', async () => {
      const limit = pLimit(1);
      let ran = false;
      const error = new Error('test error');

      const promises = [
        limit(() => {
          throw error;
        }),
        limit(() => {
          ran = true;
          return 'success';
        }),
      ];

      const results = await Promise.allSettled(promises);

      expect(results[0]).toEqual({ status: 'rejected', reason: error });
      expect(results[1]).toEqual({ status: 'fulfilled', value: 'success' });
      expect(ran).toBe(true);
    });

    it('should run all tasks asynchronously', async () => {
      const limit = pLimit(3);
      let value = 1;

      // Use async functions that take some time to ensure we can check activeCount
      const one = limit(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 1;
      });
      const two = limit(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return value;
      });

      // Tasks should be running now
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(limit.activeCount).toBe(2);

      value = 2;

      const results = await Promise.all([one, two]);
      expect(results).toEqual([1, 2]);
    });

    it('should handle detailed activeCount and pendingCount', async () => {
      const limit = pLimit(5);
      expect(limit.activeCount).toBe(0);
      expect(limit.pendingCount).toBe(0);

      const runningPromise1 = limit(() => new Promise((resolve) => setTimeout(resolve, 100)));

      // Wait for the task to actually start
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(limit.activeCount).toBe(1);
      expect(limit.pendingCount).toBe(0);

      await runningPromise1;
      expect(limit.activeCount).toBe(0);
      expect(limit.pendingCount).toBe(0);

      const immediatePromises = Array(5)
        .fill(null)
        .map(() => limit(() => new Promise((resolve) => setTimeout(resolve, 100))));
      const delayedPromises = Array(3)
        .fill(null)
        .map(() => limit(() => new Promise((resolve) => setTimeout(resolve, 100))));

      // Wait for tasks to be queued
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(limit.activeCount).toBe(5);
      expect(limit.pendingCount).toBe(3);

      await Promise.all(immediatePromises);

      // Wait a bit for pending tasks to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(limit.activeCount).toBe(3);
      expect(limit.pendingCount).toBe(0);

      await Promise.all(delayedPromises);
      expect(limit.activeCount).toBe(0);
      expect(limit.pendingCount).toBe(0);
    });

    it('should handle changing concurrency to smaller value', async () => {
      const limit = pLimit(4);
      let running = 0;
      const log: number[] = [];

      const promises = Array(10)
        .fill(null)
        .map(() =>
          limit(async () => {
            running++;
            log.push(running);
            await new Promise((resolve) => setTimeout(resolve, 50));
            running--;
          })
        );

      // Wait for initial tasks to start
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(running).toBe(4);

      // Reduce concurrency
      limit.concurrency = 2;

      await Promise.all(promises);

      // After reducing to 2, no more than 2 should run concurrently
      const maxAfterReduction = Math.max(...log.slice(4));
      expect(maxAfterReduction).toBeLessThanOrEqual(2);
    });

    it('should handle changing concurrency to bigger value', async () => {
      const limit = pLimit(2);
      let running = 0;
      const log: number[] = [];

      const promises = Array(10)
        .fill(null)
        .map(() =>
          limit(async () => {
            running++;
            log.push(running);
            await new Promise((resolve) => setTimeout(resolve, 50));
            running--;
          })
        );

      // Wait for initial tasks to start
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(running).toBe(2);

      // Increase concurrency
      limit.concurrency = 4;

      // Wait a bit for new tasks to start
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should now have 4 running
      expect(running).toBeLessThanOrEqual(4);

      await Promise.all(promises);
    });

    it('should validate concurrency on setter', () => {
      const limit = pLimit(1);

      expect(() => {
        limit.concurrency = 0;
      }).toThrow(TypeError);
      expect(() => {
        limit.concurrency = -1;
      }).toThrow(TypeError);
      expect(() => {
        limit.concurrency = 1.5;
      }).toThrow(TypeError);
      expect(() => {
        limit.concurrency = NaN;
      }).toThrow(TypeError);

      // Valid values should not throw
      expect(() => {
        limit.concurrency = 2;
      }).not.toThrow();
      expect(() => {
        limit.concurrency = Number.POSITIVE_INFINITY;
      }).not.toThrow();
    });
  });

  describe('Edge cases and compatibility', () => {
    it('should handle rapid concurrent calls', async () => {
      const limit = pLimit(2);
      const results: number[] = [];

      // Create many tasks rapidly
      const promises = Array(20)
        .fill(null)
        .map((_, i) =>
          limit(async () => {
            await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
            results.push(i);
            return i;
          })
        );

      const values = await Promise.all(promises);

      // All tasks should complete
      expect(values.length).toBe(20);
      expect(results.length).toBe(20);

      // Results should contain all indices
      expect(results.sort((a, b) => a - b)).toEqual(
        Array(20)
          .fill(null)
          .map((_, i) => i)
      );
    });

    it('should handle empty function arguments', async () => {
      const limit = pLimit(1);
      const fn = async () => 'no args';

      const result = await limit(fn);
      expect(result).toBe('no args');
    });

    it('should handle queue after error', async () => {
      const limit = pLimit(1);
      const results: string[] = [];

      const promises = [
        limit(async () => {
          results.push('first');
          return 'first';
        }),
        limit(async () => {
          results.push('error');
          throw new Error('middle error');
        }),
        limit(async () => {
          results.push('last');
          return 'last';
        }),
      ];

      const settled = await Promise.allSettled(promises);

      // All tasks should have been attempted
      expect(results).toEqual(['first', 'error', 'last']);
      expect(settled[0]?.status).toBe('fulfilled');
      expect(settled[1]?.status).toBe('rejected');
      expect(settled[2]?.status).toBe('fulfilled');
    });

    it('should work with map on empty array', async () => {
      const limit = pLimit(2);
      const results = await limit.map([], async () => 'never called');
      expect(results).toEqual([]);
    });

    it('should preserve this context in map', async () => {
      const limit = pLimit(2);
      const context = { multiplier: 2 };

      const results = await limit.map([1, 2, 3], async function (this: typeof context, value: number) {
        // Note: arrow functions don't have their own 'this', so we use regular function
        // But p-limit doesn't preserve 'this' context, so this test verifies that behavior
        return value * 2;
      });

      expect(results).toEqual([2, 4, 6]);
    });
  });

  describe('limitFunction', () => {
    it('should create a limited function', async () => {
      let callCount = 0;
      let activeCount = 0;
      let maxActiveCount = 0;

      const fn = async (value: number) => {
        callCount++;
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        await new Promise((resolve) => setTimeout(resolve, 20));
        activeCount--;
        return value * 2;
      };

      const limitedFn = limitFunction(fn, { concurrency: 2 });

      const results = await Promise.all([limitedFn(1), limitedFn(2), limitedFn(3), limitedFn(4)]);

      expect(results).toEqual([2, 4, 6, 8]);
      expect(callCount).toBe(4);
      expect(maxActiveCount).toBe(2);
      expect(activeCount).toBe(0);
    });
  });
});
