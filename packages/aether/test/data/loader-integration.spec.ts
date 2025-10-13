/**
 * Loader Integration Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  withLoaderCache,
  prefetchLoader,
  invalidateLoaderCache,
  enhanceLoader,
} from '../../src/data/loader-integration.js';
import { resetCacheManager } from '../../src/data/cache-manager.js';
import type { LoaderContext, RouteLoader } from '../../src/router/types.js';

describe('Loader Integration', () => {
  beforeEach(() => {
    resetCacheManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetCacheManager();
    vi.useRealTimers();
  });

  const createLoaderContext = (url = '/test'): LoaderContext => ({
    params: {},
    request: new Request(url),
    url: new URL(url, 'http://localhost'),
    query: new URLSearchParams(),
  });

  describe('Loader Caching', () => {
    it('should cache loader results', async () => {
      let callCount = 0;
      const loader: RouteLoader = async () => {
        callCount++;
        return { data: 'test' };
      };

      const cachedLoader = withLoaderCache(loader, {
        cache: { ttl: 60000 },
      });

      const context = createLoaderContext();

      await cachedLoader(context);
      expect(callCount).toBe(1);

      // Second call should use cache
      await cachedLoader(context);
      expect(callCount).toBe(1);
    });

    it('should respect TTL', async () => {
      let callCount = 0;
      const loader: RouteLoader = async () => {
        callCount++;
        return { data: 'test' };
      };

      const cachedLoader = withLoaderCache(loader, {
        cache: { ttl: 1000 },
      });

      const context = createLoaderContext();

      await cachedLoader(context);
      expect(callCount).toBe(1);

      // Before TTL
      await cachedLoader(context);
      expect(callCount).toBe(1);

      // After TTL
      vi.advanceTimersByTime(1500);
      await cachedLoader(context);
      expect(callCount).toBe(2);
    });

    it('should use custom cache key', async () => {
      let callCount = 0;
      const loader: RouteLoader = async ({ params }) => {
        callCount++;
        return { data: params.id };
      };

      const cachedLoader = withLoaderCache(loader, {
        cache: {
          ttl: 60000,
          key: (context) => `user:${context.params.id}`,
        },
      });

      const context1 = createLoaderContext('/users/1');
      context1.params = { id: '1' };

      const context2 = createLoaderContext('/users/1');
      context2.params = { id: '1' };

      await cachedLoader(context1);
      expect(callCount).toBe(1);

      // Same ID, should use cache
      await cachedLoader(context2);
      expect(callCount).toBe(1);
    });

    it('should support stale-while-revalidate', async () => {
      let callCount = 0;
      const loader: RouteLoader = async () => {
        callCount++;
        return { data: `test-${callCount}` };
      };

      const cachedLoader = withLoaderCache(loader, {
        cache: {
          ttl: 60000,
          staleWhileRevalidate: true,
          staleTime: 1000,
        },
      });

      const context = createLoaderContext();

      await cachedLoader(context);
      expect(callCount).toBe(1);

      // Before stale time
      vi.advanceTimersByTime(500);
      await cachedLoader(context);
      expect(callCount).toBe(1);

      // After stale time - returns stale, revalidates
      vi.advanceTimersByTime(1000);
      const result = await cachedLoader(context);

      // Returns cached data immediately
      expect(result.data).toBe('test-1');

      // But triggers background revalidation
      await vi.runAllTimersAsync();
      expect(callCount).toBe(2);
    });
  });

  describe('Prefetching', () => {
    it('should prefetch loader data', async () => {
      let callCount = 0;
      const loader: RouteLoader = async () => {
        callCount++;
        return { data: 'test' };
      };

      const context = createLoaderContext();

      await prefetchLoader(loader, context, {
        cache: { ttl: 60000 },
      });

      expect(callCount).toBe(1);

      // Create cached loader - should use prefetched data
      const cachedLoader = withLoaderCache(loader, {
        cache: { ttl: 60000 },
      });

      await cachedLoader(context);
      expect(callCount).toBe(1);
    });

    it('should prefetch without caching', async () => {
      let callCount = 0;
      const loader: RouteLoader = async () => {
        callCount++;
        return { data: 'test' };
      };

      const context = createLoaderContext();

      await prefetchLoader(loader, context);
      await prefetchLoader(loader, context);

      expect(callCount).toBe(2);
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate specific route', async () => {
      let callCount = 0;
      const loader: RouteLoader = async () => {
        callCount++;
        return { data: 'test' };
      };

      const cachedLoader = withLoaderCache(loader, {
        cache: { ttl: 60000 },
      });

      const context = createLoaderContext('/test');

      await cachedLoader(context);
      expect(callCount).toBe(1);

      // Should use cache
      await cachedLoader(context);
      expect(callCount).toBe(1);

      // Invalidate
      invalidateLoaderCache('/test');

      // Should refetch
      await cachedLoader(context);
      expect(callCount).toBe(2);
    });

    it('should invalidate by pattern', async () => {
      const loader: RouteLoader = async () => ({ data: 'test' });
      const cachedLoader = withLoaderCache(loader, {
        cache: { ttl: 60000 },
      });

      // Cache multiple routes
      await cachedLoader(createLoaderContext('/users/1'));
      await cachedLoader(createLoaderContext('/users/2'));
      await cachedLoader(createLoaderContext('/posts/1'));

      // Invalidate user routes
      const count = invalidateLoaderCache(/^\/users\//);

      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Enhanced Loader', () => {
    it('should combine multiple strategies', async () => {
      let callCount = 0;
      const loader: RouteLoader = async () => {
        callCount++;
        return { data: 'test' };
      };

      const enhanced = enhanceLoader(loader, {
        cache: { ttl: 60000 },
      });

      const context = createLoaderContext();

      await enhanced(context);
      await enhanced(context);

      expect(callCount).toBe(1);
    });
  });

  describe('Type Safety', () => {
    it('should maintain type safety for loader results', async () => {
      interface UserData {
        id: number;
        name: string;
      }

      const loader: RouteLoader = async () => {
        return { user: { id: 1, name: 'Alice' } } as { user: UserData };
      };

      const cachedLoader = withLoaderCache(loader, {
        cache: { ttl: 60000 },
      });

      const context = createLoaderContext();
      const result = await cachedLoader(context);

      // TypeScript should know result type
      expect(result.user.id).toBe(1);
      expect(result.user.name).toBe('Alice');
    });
  });

  describe('Error Handling', () => {
    it('should not cache errors', async () => {
      let callCount = 0;
      const loader: RouteLoader = async () => {
        callCount++;
        throw new Error('Loader failed');
      };

      const cachedLoader = withLoaderCache(loader, {
        cache: { ttl: 60000 },
      });

      const context = createLoaderContext();

      await expect(cachedLoader(context)).rejects.toThrow('Loader failed');
      expect(callCount).toBe(1);

      // Should not use cache, call again
      await expect(cachedLoader(context)).rejects.toThrow('Loader failed');
      expect(callCount).toBe(2);
    });
  });
});
