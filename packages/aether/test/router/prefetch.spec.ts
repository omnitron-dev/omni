/**
 * @fileoverview Comprehensive tests for route prefetching
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  prefetchRoute,
  clearPrefetchCache,
  isPrefetched,
} from '../../src/router/prefetch.js';
import type { Router } from '../../src/router/types.js';

describe('route prefetching', () => {
  let mockRouter: Router;

  beforeEach(() => {
    clearPrefetchCache();

    mockRouter = {
      match: vi.fn((path: string) => ({
        route: {
          path,
          loader: vi.fn(async () => ({ data: `loaded from ${path}` })),
        },
        params: {},
      })),
      config: {
        netron: {} as any,
      },
    } as any;

    global.window = {
      location: {
        origin: 'http://localhost:3000',
      },
    } as any;
  });

  afterEach(() => {
    clearPrefetchCache();
  });

  describe('prefetchRoute', () => {
    it('should prefetch route with loader', async () => {
      await prefetchRoute(mockRouter, '/users');

      expect(mockRouter.match).toHaveBeenCalledWith('/users');
      expect(isPrefetched('/users')).toBe(true);
    });

    it('should not prefetch route without loader', async () => {
      mockRouter.match = vi.fn(() => ({
        route: { path: '/users' },
        params: {},
      }));

      await prefetchRoute(mockRouter, '/users');

      expect(isPrefetched('/users')).toBe(false);
    });

    it('should not prefetch if no route match', async () => {
      mockRouter.match = vi.fn(() => null);

      await prefetchRoute(mockRouter, '/nonexistent');

      expect(isPrefetched('/nonexistent')).toBe(false);
    });

    it('should skip already prefetched routes', async () => {
      await prefetchRoute(mockRouter, '/users');

      const matchSpy = mockRouter.match as any;
      matchSpy.mockClear();

      await prefetchRoute(mockRouter, '/users');

      // Should not call match again
      expect(matchSpy).not.toHaveBeenCalled();
    });

    it('should force prefetch when force option is true', async () => {
      await prefetchRoute(mockRouter, '/users');

      const matchSpy = mockRouter.match as any;
      matchSpy.mockClear();

      await prefetchRoute(mockRouter, '/users', { force: true });

      // Should call match again
      expect(matchSpy).toHaveBeenCalled();
    });

    it('should execute loader with correct context', async () => {
      const loaderSpy = vi.fn(async () => ({ data: 'test' }));

      mockRouter.match = vi.fn(() => ({
        route: {
          path: '/users/:id',
          loader: loaderSpy,
        },
        params: { id: '123' },
      }));

      await prefetchRoute(mockRouter, '/users/123');

      expect(loaderSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { id: '123' },
          url: expect.any(URL),
          netron: mockRouter.config.netron,
        })
      );
    });

    it('should handle loader errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockRouter.match = vi.fn(() => ({
        route: {
          path: '/users',
          loader: async () => {
            throw new Error('Loader error');
          },
        },
        params: {},
      }));

      await prefetchRoute(mockRouter, '/users');

      expect(consoleSpy).toHaveBeenCalledWith(
        'Prefetch failed for /users:',
        expect.any(Error)
      );

      // Should remove from cache on error
      expect(isPrefetched('/users')).toBe(false);

      consoleSpy.mockRestore();
    });

    it('should store prefetched data', async () => {
      // Test that prefetch marks the route as prefetched
      await prefetchRoute(mockRouter, '/users');

      // Data should be cached
      expect(isPrefetched('/users')).toBe(true);
    });
  });

  describe('clearPrefetchCache', () => {
    it('should clear specific route from cache', async () => {
      await prefetchRoute(mockRouter, '/users');
      await prefetchRoute(mockRouter, '/posts');

      expect(isPrefetched('/users')).toBe(true);
      expect(isPrefetched('/posts')).toBe(true);

      clearPrefetchCache('/users');

      expect(isPrefetched('/users')).toBe(false);
      expect(isPrefetched('/posts')).toBe(true);
    });

    it('should clear all routes when no path provided', async () => {
      await prefetchRoute(mockRouter, '/users');
      await prefetchRoute(mockRouter, '/posts');
      await prefetchRoute(mockRouter, '/about');

      expect(isPrefetched('/users')).toBe(true);
      expect(isPrefetched('/posts')).toBe(true);
      expect(isPrefetched('/about')).toBe(true);

      clearPrefetchCache();

      expect(isPrefetched('/users')).toBe(false);
      expect(isPrefetched('/posts')).toBe(false);
      expect(isPrefetched('/about')).toBe(false);
    });

    it('should handle clearing non-existent route', () => {
      expect(() => clearPrefetchCache('/nonexistent')).not.toThrow();
    });
  });

  describe('isPrefetched', () => {
    it('should return false for non-prefetched route', () => {
      expect(isPrefetched('/users')).toBe(false);
    });

    it('should return true for prefetched route', async () => {
      await prefetchRoute(mockRouter, '/users');

      expect(isPrefetched('/users')).toBe(true);
    });

    it('should handle route with query params', async () => {
      await prefetchRoute(mockRouter, '/users?page=1');

      expect(isPrefetched('/users?page=1')).toBe(true);
      expect(isPrefetched('/users')).toBe(false);
    });
  });

  describe('prefetch strategies', () => {
    it('should handle hover prefetch strategy', async () => {
      // Simulated: prefetch on mouseenter
      const element = document.createElement('a');
      element.href = '/users';

      element.addEventListener('mouseenter', async () => {
        await prefetchRoute(mockRouter, '/users');
      });

      element.dispatchEvent(new Event('mouseenter'));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(isPrefetched('/users')).toBe(true);
    });

    it('should handle immediate prefetch strategy', async () => {
      // Simulated: prefetch on render
      await prefetchRoute(mockRouter, '/users');

      expect(isPrefetched('/users')).toBe(true);
    });

    it('should handle viewport prefetch strategy', async () => {
      // Simulated: prefetch when in viewport
      const element = document.createElement('a');
      element.href = '/users';

      // Mock IntersectionObserver
      const observe = vi.fn();
      global.IntersectionObserver = vi.fn().mockImplementation((callback) => ({
        observe,
        disconnect: vi.fn(),
      }));

      // Simulate entering viewport
      await prefetchRoute(mockRouter, '/users');

      expect(isPrefetched('/users')).toBe(true);
    });
  });

  describe('prefetch with parameters', () => {
    it('should prefetch dynamic routes', async () => {
      mockRouter.match = vi.fn(() => ({
        route: {
          path: '/users/:id',
          loader: async (ctx: any) => ({ user: ctx.params.id }),
        },
        params: { id: '123' },
      }));

      await prefetchRoute(mockRouter, '/users/123');

      expect(isPrefetched('/users/123')).toBe(true);
    });

    it('should prefetch routes with query params', async () => {
      mockRouter.match = vi.fn(() => ({
        route: {
          path: '/users',
          loader: async () => ({ users: [] }),
        },
        params: {},
      }));

      await prefetchRoute(mockRouter, '/users?page=2&limit=10');

      expect(isPrefetched('/users?page=2&limit=10')).toBe(true);
    });

    it('should handle multiple path variations', async () => {
      await prefetchRoute(mockRouter, '/users/123');
      await prefetchRoute(mockRouter, '/users/456');

      expect(isPrefetched('/users/123')).toBe(true);
      expect(isPrefetched('/users/456')).toBe(true);
    });
  });

  describe('performance optimization', () => {
    it('should prefetch multiple routes concurrently', async () => {
      const paths = ['/users', '/posts', '/about', '/contact'];

      await Promise.all(
        paths.map(path => prefetchRoute(mockRouter, path))
      );

      paths.forEach(path => {
        expect(isPrefetched(path)).toBe(true);
      });
    });

    it('should deduplicate concurrent prefetches', async () => {
      const matchSpy = mockRouter.match as any;

      await Promise.all([
        prefetchRoute(mockRouter, '/users'),
        prefetchRoute(mockRouter, '/users'),
        prefetchRoute(mockRouter, '/users'),
      ]);

      // First call marks as prefetched, others skip
      expect(matchSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle slow loaders', async () => {
      let resolved = false;

      mockRouter.match = vi.fn(() => ({
        route: {
          path: '/slow',
          loader: async () => {
            await new Promise(resolve => setTimeout(resolve, 100));
            resolved = true;
            return { data: 'slow' };
          },
        },
        params: {},
      }));

      const promise = prefetchRoute(mockRouter, '/slow');

      // Should not block
      expect(resolved).toBe(false);

      await promise;

      expect(resolved).toBe(true);
      expect(isPrefetched('/slow')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty path', async () => {
      await prefetchRoute(mockRouter, '');

      // Empty path should still work
      expect(isPrefetched('')).toBe(true);
    });

    it('should handle root path', async () => {
      await prefetchRoute(mockRouter, '/');

      expect(isPrefetched('/')).toBe(true);
    });

    it('should handle paths with hash', async () => {
      await prefetchRoute(mockRouter, '/users#section');

      expect(isPrefetched('/users#section')).toBe(true);
    });

    it('should handle malformed URLs gracefully', async () => {
      mockRouter.match = vi.fn(() => null);

      await expect(prefetchRoute(mockRouter, '://invalid')).resolves.not.toThrow();
    });

    it('should handle loader that returns undefined', async () => {
      mockRouter.match = vi.fn(() => ({
        route: {
          path: '/users',
          loader: async () => undefined,
        },
        params: {},
      }));

      await prefetchRoute(mockRouter, '/users');

      expect(isPrefetched('/users')).toBe(true);
    });
  });
});
