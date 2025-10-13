/**
 * Cached Resource Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCachedResource, createCachedResources, preloadCachedResource } from '../../src/data/resource-cache.js';
import { resetCacheManager } from '../../src/data/cache-manager.js';

describe('Cached Resource', () => {
  beforeEach(() => {
    resetCacheManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetCacheManager();
    vi.useRealTimers();
  });

  describe('Basic Functionality', () => {
    it('should create a cached resource', async () => {
      const resource = createCachedResource(async () => 'test-data');

      // Initially loading
      expect(resource.loading()).toBe(true);

      // Wait for fetch
      await vi.runAllTimersAsync();

      expect(resource.loading()).toBe(false);
      expect(resource()).toBe('test-data');
      expect(resource.error()).toBeUndefined();
    });

    it('should handle errors', async () => {
      const resource = createCachedResource(async () => {
        throw new Error('Fetch failed');
      });

      await vi.runAllTimersAsync();

      expect(resource.loading()).toBe(false);
      expect(resource()).toBeUndefined();
      expect(resource.error()?.message).toBe('Fetch failed');
    });

    it('should refetch data', async () => {
      let callCount = 0;
      const resource = createCachedResource(async () => {
        callCount++;
        return `data-${callCount}`;
      });

      await vi.runAllTimersAsync();
      expect(resource()).toBe('data-1');

      await resource.refetch();
      expect(resource()).toBe('data-2');
    });
  });

  describe('Caching', () => {
    it('should cache results', async () => {
      let callCount = 0;
      const resource = createCachedResource(
        async () => {
          callCount++;
          return 'data';
        },
        {
          name: 'test',
          ttl: 60000,
        }
      );

      await vi.runAllTimersAsync();
      expect(callCount).toBe(1);

      // Create new resource with same config
      const resource2 = createCachedResource(
        async () => {
          callCount++;
          return 'data';
        },
        {
          name: 'test',
          ttl: 60000,
        }
      );

      await vi.runAllTimersAsync();

      // Should use cache
      expect(callCount).toBe(1);
      expect(resource2()).toBe('data');
    });

    it('should respect TTL', async () => {
      let callCount = 0;
      const resource = createCachedResource(
        async () => {
          callCount++;
          return 'data';
        },
        {
          name: 'test',
          ttl: 1000,
        }
      );

      await vi.runAllTimersAsync();
      expect(callCount).toBe(1);

      // Before TTL expires
      const resource2 = createCachedResource(
        async () => {
          callCount++;
          return 'data';
        },
        {
          name: 'test',
          ttl: 1000,
        }
      );

      await vi.runAllTimersAsync();
      expect(callCount).toBe(1);

      // After TTL expires
      vi.advanceTimersByTime(1500);

      const resource3 = createCachedResource(
        async () => {
          callCount++;
          return 'data';
        },
        {
          name: 'test',
          ttl: 1000,
        }
      );

      await vi.runAllTimersAsync();
      expect(callCount).toBe(2);
    });
  });

  describe('Stale-While-Revalidate', () => {
    it('should return stale data and revalidate in background', async () => {
      let callCount = 0;
      const fetcher = async () => {
        callCount++;
        return `data-${callCount}`;
      };

      // First resource - initial fetch
      const resource = createCachedResource(fetcher, {
        name: 'test',
        ttl: 60000,
        staleWhileRevalidate: true,
        staleTime: 1000,
      });

      await vi.runAllTimersAsync();
      expect(resource()).toBe('data-1');
      expect(callCount).toBe(1);

      // Advance time to make data stale
      vi.advanceTimersByTime(1500);

      // Reading the resource should trigger revalidation
      const value = resource();
      expect(value).toBe('data-1'); // Still has stale data

      // Allow revalidation to complete
      await vi.runAllTimersAsync();

      // Revalidation should have happened
      expect(callCount).toBe(2);

      // After revalidation completes, resource should have new data
      expect(resource()).toBe('data-2');
    });
  });

  describe('Invalidation', () => {
    it('should invalidate and refetch', async () => {
      let callCount = 0;
      const resource = createCachedResource(
        async () => {
          callCount++;
          return `data-${callCount}`;
        },
        { name: 'test', ttl: 60000 }
      );

      await vi.runAllTimersAsync();
      expect(resource()).toBe('data-1');

      resource.invalidate();

      await vi.runAllTimersAsync();
      expect(resource()).toBe('data-2');
    });
  });

  describe('Mutation', () => {
    it('should mutate data optimistically', async () => {
      const resource = createCachedResource(async () => ({ count: 0 }));

      await vi.runAllTimersAsync();
      expect(resource()?.count).toBe(0);

      resource.mutate({ count: 10 });

      await vi.runAllTimersAsync();
      expect(resource()?.count).toBe(10);
    });

    it('should support updater function', async () => {
      const resource = createCachedResource(async () => ({ count: 0 }));

      await vi.runAllTimersAsync();

      resource.mutate((prev) => ({ count: (prev?.count ?? 0) + 1 }));

      await vi.runAllTimersAsync();
      expect(resource()?.count).toBe(1);
    });
  });

  describe('Callbacks', () => {
    it('should call onSuccess', async () => {
      const onSuccess = vi.fn();
      const resource = createCachedResource(async () => 'data', {
        onSuccess,
      });

      await vi.runAllTimersAsync();

      expect(onSuccess).toHaveBeenCalledWith('data');
    });

    it('should call onError', async () => {
      const onError = vi.fn();
      const resource = createCachedResource(
        async () => {
          throw new Error('Failed');
        },
        {
          onError,
        }
      );

      await vi.runAllTimersAsync();

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('Create Multiple Resources', () => {
    it('should create multiple cached resources', async () => {
      const resources = createCachedResources(
        {
          user: async () => ({ id: 1, name: 'Alice' }),
          posts: async () => [{ id: 1, title: 'Post 1' }],
          count: async () => 42,
        },
        { ttl: 60000 }
      );

      await vi.runAllTimersAsync();

      expect(resources.user()?.name).toBe('Alice');
      expect(resources.posts()?.[0]?.title).toBe('Post 1');
      expect(resources.count()).toBe(42);
    });
  });

  describe('Preload', () => {
    it('should preload and cache data', async () => {
      let callCount = 0;
      const fetcher = async () => {
        callCount++;
        return 'data';
      };

      await preloadCachedResource(fetcher, {
        name: 'test',
        ttl: 60000,
      });

      expect(callCount).toBe(1);

      // Create resource with same config - should use cache
      const resource = createCachedResource(fetcher, {
        name: 'test',
        ttl: 60000,
      });

      await vi.runAllTimersAsync();
      expect(callCount).toBe(1);
      expect(resource()).toBe('data');
    });

    it('should return cached data immediately', async () => {
      const result = await preloadCachedResource(async () => 'data', {
        name: 'test',
        ttl: 60000,
      });

      expect(result).toBe('data');

      // Second call returns cached
      const result2 = await preloadCachedResource(async () => 'data2', {
        name: 'test',
        ttl: 60000,
      });

      expect(result2).toBe('data');
    });
  });

  describe('Cache Key', () => {
    it('should expose cache key', async () => {
      const resource = createCachedResource(async () => 'data', {
        name: 'test',
      });

      await vi.runAllTimersAsync();

      const cacheKey = resource.getCacheKey();
      expect(cacheKey).toContain('test');
    });
  });
});
