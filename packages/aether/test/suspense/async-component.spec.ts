/**
 * Async Component Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createAsyncComponent,
  asyncComponent,
  useAsync,
  prefetch,
  isCached,
  getCached,
  invalidateAsync,
  clearAsyncComponentCache,
} from '../../src/suspense/async-component.js';
import { Suspense } from '../../src/suspense/suspense.js';

describe('Async Component', () => {
  beforeEach(() => {
    clearAsyncComponentCache();
  });

  describe('createAsyncComponent', () => {
    it('should create async component that suspends', async () => {
      const Component = createAsyncComponent(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return () => 'Content';
      });

      const suspenseComponent = Suspense({
        fallback: 'Loading...',
        children: () => Component({}),
      });

      const renderFn = suspenseComponent();

      // First render shows fallback
      expect(renderFn()).toBe('Loading...');

      // Wait for component to load
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second render shows content
      expect(renderFn()).toBe('Content');
    });

    it('should cache loaded components', async () => {
      const loader = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return () => 'Content';
      });

      const Component = createAsyncComponent(loader);

      // First load
      const suspenseComponent1 = Suspense({
        fallback: 'Loading...',
        children: () => Component({}),
      });

      suspenseComponent1()();

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second load should use cache
      const suspenseComponent2 = Suspense({
        fallback: 'Loading...',
        children: () => Component({}),
      });

      const renderFn = suspenseComponent2();
      expect(renderFn()).toBe('Content');
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('should handle errors', async () => {
      const error = new Error('Load failed');
      const Component = createAsyncComponent(async () => {
        throw error;
      });

      const suspenseComponent = Suspense({
        fallback: 'Loading...',
        children: () => {
          try {
            return Component({});
          } catch (err) {
            if (err instanceof Promise) {
              throw err;
            }
            return `Error: ${(err as Error).message}`;
          }
        },
      });

      const renderFn = suspenseComponent();

      // Wait for error
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(renderFn()).toBe('Error: Load failed');
    });

    it('should support custom cache keys', async () => {
      const loader = vi.fn(async (props: { id: number }) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return () => `Content ${props.id}`;
      });

      const Component = createAsyncComponent(loader, {
        cacheKey: (props) => `key-${props.id}`,
      });

      // Load with id=1
      const suspenseComponent1 = Suspense({
        fallback: 'Loading...',
        children: () => Component({ id: 1 }),
      });

      suspenseComponent1()();

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Load with id=2 (should not use cache)
      const suspenseComponent2 = Suspense({
        fallback: 'Loading...',
        children: () => Component({ id: 2 }),
      });

      suspenseComponent2()();

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(loader).toHaveBeenCalledTimes(2);
    });
  });

  describe('asyncComponent', () => {
    it('should wrap component with async data fetching', async () => {
      const Component = (props: { data: string; name: string }) => `${props.name}: ${props.data}`;

      const dataFetcher = async (props: { name: string }) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { data: `data-${props.name}` };
      };

      const AsyncComponent = asyncComponent(Component, dataFetcher);

      const suspenseComponent = Suspense({
        fallback: 'Loading...',
        children: () => AsyncComponent({ name: 'test' }),
      });

      const renderFn = suspenseComponent();

      // First render shows fallback
      expect(renderFn()).toBe('Loading...');

      // Wait for data to load
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second render shows content with data
      expect(renderFn()).toBe('test: data-test');
    });
  });

  describe('useAsync', () => {
    it('should fetch async data', async () => {
      const fetcher = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'data';
      });

      const suspenseComponent = Suspense({
        fallback: 'Loading...',
        children: () => {
          const data = useAsync(fetcher);
          return `Content: ${data}`;
        },
      });

      const renderFn = suspenseComponent();

      // First render shows fallback
      expect(renderFn()).toBe('Loading...');

      // Wait for data
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second render shows content
      expect(renderFn()).toContain('Content: data');
    });

    it('should refetch when deps change', async () => {
      const fetcher = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'data';
      });

      // First call with deps [1]
      const suspenseComponent1 = Suspense({
        fallback: 'Loading...',
        children: () => {
          const data = useAsync(fetcher, [1]);
          return `Content: ${data}`;
        },
      });

      suspenseComponent1()();

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second call with deps [2] - should refetch
      const suspenseComponent2 = Suspense({
        fallback: 'Loading...',
        children: () => {
          const data = useAsync(fetcher, [2]);
          return `Content: ${data}`;
        },
      });

      suspenseComponent2()();

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe('prefetch', () => {
    it('should start fetching without suspending', async () => {
      const fetcher = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'data';
      });

      // Prefetch
      const promise = prefetch(fetcher);

      // Fetcher should have been called
      expect(fetcher).toHaveBeenCalled();

      // Wait for completion
      await promise;

      // Data should be cached
      expect(isCached()).toBe(true);
    });

    it('should cache prefetched data', async () => {
      const fetcher = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'data';
      });

      // Prefetch
      await prefetch(fetcher, [1]);

      // Use prefetched data
      const suspenseComponent = Suspense({
        fallback: 'Loading...',
        children: () => {
          const data = useAsync(fetcher, [1]);
          return `Content: ${data}`;
        },
      });

      const renderFn = suspenseComponent();

      // Should not suspend since data is cached
      expect(renderFn()).toContain('Content: data');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });

  describe('isCached', () => {
    it('should check if data is cached', async () => {
      const fetcher = async () => 'data';

      expect(isCached([1])).toBe(false);

      await prefetch(fetcher, [1]);

      expect(isCached([1])).toBe(true);
    });
  });

  describe('getCached', () => {
    it('should get cached data without suspending', async () => {
      const fetcher = async () => 'data';

      expect(getCached([1])).toBeUndefined();

      await prefetch(fetcher, [1]);

      expect(getCached([1])).toBe('data');
    });
  });

  describe('invalidateAsync', () => {
    it('should clear cache for specific key', async () => {
      const fetcher = async () => 'data';

      await prefetch(fetcher, [1]);
      expect(isCached([1])).toBe(true);

      invalidateAsync([1]);
      expect(isCached([1])).toBe(false);
    });

    it('should clear all cache when no key provided', async () => {
      const fetcher = async () => 'data';

      await prefetch(fetcher, [1]);
      await prefetch(fetcher, [2]);

      expect(isCached([1])).toBe(true);
      expect(isCached([2])).toBe(true);

      invalidateAsync();

      expect(isCached([1])).toBe(false);
      expect(isCached([2])).toBe(false);
    });
  });

  describe('clearAsyncComponentCache', () => {
    it('should clear entire cache', async () => {
      const fetcher = async () => 'data';

      await prefetch(fetcher, [1]);
      await prefetch(fetcher, [2]);

      clearAsyncComponentCache();

      expect(isCached([1])).toBe(false);
      expect(isCached([2])).toBe(false);
    });
  });
});
