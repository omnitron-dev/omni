/**
 * Optimistic Updates Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  optimisticUpdate,
  createOptimisticMutation,
  applyOptimisticUpdate,
  atomicOptimisticUpdate,
  mergeOptimisticUpdate,
} from '../../src/data/optimistic.js';
import { createCachedResource } from '../../src/data/resource-cache.js';
import { resetCacheManager } from '../../src/data/cache-manager.js';

describe('Optimistic Updates', () => {
  beforeEach(() => {
    resetCacheManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetCacheManager();
    vi.useRealTimers();
  });

  describe('Basic Optimistic Update', () => {
    it('should apply optimistic update immediately', async () => {
      const resource = createCachedResource(async () => ({ count: 0 }));

      await vi.runAllTimersAsync();
      expect(resource()?.count).toBe(0);

      const promise = optimisticUpdate(
        resource,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        },
        {
          optimisticData: { count: 10 },
        }
      );

      // Should update immediately
      await vi.runAllTimersAsync();
      expect(resource()?.count).toBe(10);

      // Complete mutation
      vi.advanceTimersByTime(1000);
      await promise;
    });

    it('should revalidate after mutation', async () => {
      let fetchCount = 0;
      const resource = createCachedResource(async () => {
        fetchCount++;
        return { count: fetchCount };
      });

      await vi.runAllTimersAsync();
      expect(resource()?.count).toBe(1);

      // Start mutation but don't await yet to avoid deadlock
      const promise = optimisticUpdate(
        resource,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
        },
        {
          optimisticData: { count: 99 },
          revalidate: true,
        }
      );

      // Advance timers before awaiting
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
      await promise;

      // Should refetch after mutation
      expect(fetchCount).toBe(2);
    });

    it('should rollback on error', async () => {
      const resource = createCachedResource(async () => ({ count: 0 }));

      await vi.runAllTimersAsync();
      expect(resource()?.count).toBe(0);

      try {
        await optimisticUpdate(
          resource,
          async () => {
            throw new Error('Mutation failed');
          },
          {
            optimisticData: { count: 10 },
            rollbackOnError: true,
          }
        );
      } catch {
        // Expected
      }

      await vi.runAllTimersAsync();

      // Should rollback to original value
      expect(resource()?.count).toBe(0);
    });

    it('should not rollback if rollbackOnError is false', async () => {
      const resource = createCachedResource(async () => ({ count: 0 }));

      await vi.runAllTimersAsync();

      try {
        await optimisticUpdate(
          resource,
          async () => {
            throw new Error('Mutation failed');
          },
          {
            optimisticData: { count: 10 },
            rollbackOnError: false,
          }
        );
      } catch {
        // Expected
      }

      await vi.runAllTimersAsync();

      // Should keep optimistic value
      expect(resource()?.count).toBe(10);
    });

    it('should call onError handler', async () => {
      const onError = vi.fn();
      const resource = createCachedResource(async () => ({ count: 0 }));

      await vi.runAllTimersAsync();

      try {
        await optimisticUpdate(
          resource,
          async () => {
            throw new Error('Mutation failed');
          },
          {
            optimisticData: { count: 10 },
            onError,
          }
        );
      } catch {
        // Expected
      }

      expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.any(Function));
    });
  });

  describe('Optimistic Mutation', () => {
    it('should create reusable optimistic mutation', async () => {
      const resource = createCachedResource(async () => ({ count: 0 }));

      await vi.runAllTimersAsync();

      const increment = createOptimisticMutation(
        resource,
        async (amount: number) => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { count: (resource()?.count ?? 0) + amount };
        },
        (amount: number) => (prev) => ({ count: (prev?.count ?? 0) + amount })
      );

      // Start first increment but don't await yet
      const promise1 = increment(5);
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
      await promise1;

      expect(resource()?.count).toBe(5);

      // Start second increment
      const promise2 = increment(3);
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
      await promise2;

      expect(resource()?.count).toBe(8);
    });
  });

  describe('Manual Optimistic Update', () => {
    it('should allow manual commit', async () => {
      const resource = createCachedResource(async () => ({ count: 0 }));

      await vi.runAllTimersAsync();

      const update = applyOptimisticUpdate(resource, { count: 10 });

      await vi.runAllTimersAsync();
      expect(resource()?.count).toBe(10);

      await update.commit({ count: 20 });

      await vi.runAllTimersAsync();

      expect(resource()?.count).toBe(20);
    });

    it('should allow manual rollback', async () => {
      const resource = createCachedResource(async () => ({ count: 0 }));

      await vi.runAllTimersAsync();

      const update = applyOptimisticUpdate(resource, { count: 10 });

      await vi.runAllTimersAsync();
      expect(resource()?.count).toBe(10);

      await update.rollback();

      await vi.runAllTimersAsync();

      expect(resource()?.count).toBe(0);
    });
  });

  describe('Atomic Optimistic Update', () => {
    it('should update multiple resources atomically', async () => {
      const resource1 = createCachedResource(async () => ({ count: 1 }), { name: 'res1' });
      const resource2 = createCachedResource(async () => ({ count: 2 }), { name: 'res2' });

      await vi.runAllTimersAsync();

      // Check resources are initialized
      expect(resource1()?.count).toBe(1);
      expect(resource2()?.count).toBe(2);

      // Apply atomic update
      const promise = atomicOptimisticUpdate([
        {
          resource: resource1,
          mutation: async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return { count: 10 };
          },
          optimisticData: { count: 10 },
        },
        {
          resource: resource2,
          mutation: async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return { count: 20 };
          },
          optimisticData: { count: 20 },
        },
      ]);

      // Wait for mutations to complete
      await vi.runAllTimersAsync();
      await promise;
      await vi.runAllTimersAsync();

      // Both should be updated
      expect(resource1()?.count).toBe(10);
      expect(resource2()?.count).toBe(20);
    });

    it('should rollback all on any failure', async () => {
      const resource1 = createCachedResource(async () => ({ count: 1 }));
      const resource2 = createCachedResource(async () => ({ count: 2 }));

      await vi.runAllTimersAsync();

      try {
        await atomicOptimisticUpdate([
          {
            resource: resource1,
            mutation: async () => ({ count: 10 }),
            optimisticData: { count: 10 },
          },
          {
            resource: resource2,
            mutation: async () => {
              throw new Error('Failed');
            },
            optimisticData: { count: 20 },
          },
        ]);
      } catch {
        // Expected
      }

      await vi.runAllTimersAsync();

      // Both should rollback
      expect(resource1()?.count).toBe(1);
      expect(resource2()?.count).toBe(2);
    });
  });

  describe('Merge Strategies', () => {
    it('should use server strategy', () => {
      const optimistic = { id: 1, name: 'Local', age: 30 };
      const server = { id: 1, name: 'Server', email: 'server@example.com' };

      const merged = mergeOptimisticUpdate(optimistic, server, 'server');

      expect(merged).toEqual(server);
    });

    it('should use optimistic strategy', () => {
      const optimistic = { id: 1, name: 'Local', age: 30 };
      const server = { id: 1, name: 'Server', email: 'server@example.com' };

      const merged = mergeOptimisticUpdate(optimistic, server, 'optimistic');

      expect(merged).toEqual(optimistic);
    });

    it('should use merge strategy', () => {
      const optimistic = { id: 1, name: 'Local', age: 30 };
      const server = { id: 1, name: 'Server', email: 'server@example.com' };

      const merged = mergeOptimisticUpdate(optimistic, server, 'merge');

      expect(merged).toEqual({
        id: 1,
        name: 'Server',
        age: 30,
        email: 'server@example.com',
      });
    });
  });

  describe('Updater Functions', () => {
    it('should support function as optimistic data', async () => {
      const resource = createCachedResource(async () => ({ count: 5 }));

      await vi.runAllTimersAsync();

      await optimisticUpdate(resource, async () => {}, {
        optimisticData: (prev) => ({ count: (prev?.count ?? 0) * 2 }),
      });

      await vi.runAllTimersAsync();

      expect(resource()?.count).toBe(10);
    });
  });
});
