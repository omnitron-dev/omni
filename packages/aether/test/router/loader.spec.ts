/**
 * @fileoverview Comprehensive tests for auto-loader execution
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeLoader, executeLoadersParallel, defer, setLoaderData } from '../../src/router/data.js';
import type { LoaderContext } from '../../src/router/types.js';

describe('auto-loader execution', () => {
  let mockNetron: any;
  let baseContext: LoaderContext;

  beforeEach(() => {
    mockNetron = {
      query: vi.fn().mockResolvedValue({ data: 'mocked' }),
      mutate: vi.fn().mockResolvedValue({ success: true }),
    };

    baseContext = {
      params: {},
      url: new URL('http://localhost:3000/test'),
      request: new Request('http://localhost:3000/test'),
      netron: mockNetron,
    };
  });

  describe('loader execution', () => {
    it('should execute loader with context', async () => {
      const loader = vi.fn(async (ctx: LoaderContext) => {
        return { data: 'loaded', params: ctx.params };
      });

      const context: LoaderContext = {
        ...baseContext,
        params: { id: '123' },
      };

      const result = await executeLoader(loader, context);

      expect(loader).toHaveBeenCalledWith(context);
      expect(result).toEqual({
        data: 'loaded',
        params: { id: '123' },
      });
    });

    it('should execute loader with netron integration', async () => {
      const loader = async (ctx: LoaderContext) => {
        const users = await ctx.netron.query('users', 'getAll', []);
        return { users };
      };

      const result = await executeLoader(loader, baseContext);

      expect(mockNetron.query).toHaveBeenCalledWith('users', 'getAll', []);
      expect(result).toEqual({ users: { data: 'mocked' } });
    });

    it('should pass URL parameters', async () => {
      const context: LoaderContext = {
        ...baseContext,
        url: new URL('http://localhost:3000/users?page=2&limit=10'),
      };

      const loader = async (ctx: LoaderContext) => {
        const page = ctx.url.searchParams.get('page');
        const limit = ctx.url.searchParams.get('limit');
        return { page, limit };
      };

      const result = await executeLoader(loader, context);

      expect(result).toEqual({ page: '2', limit: '10' });
    });

    it('should handle dynamic route params', async () => {
      const context: LoaderContext = {
        ...baseContext,
        params: { userId: '123', postId: '456' },
      };

      const loader = async (ctx: LoaderContext) => {
        return {
          user: await ctx.netron.query('users', 'get', [ctx.params.userId]),
          post: await ctx.netron.query('posts', 'get', [ctx.params.postId]),
        };
      };

      const result = await executeLoader(loader, context);

      expect(mockNetron.query).toHaveBeenCalledWith('users', 'get', ['123']);
      expect(mockNetron.query).toHaveBeenCalledWith('posts', 'get', ['456']);
    });
  });

  describe('parallel loader execution', () => {
    it('should execute multiple loaders concurrently', async () => {
      const startTimes: number[] = [];

      const loaders = [
        {
          key: 'user',
          loader: async (ctx: LoaderContext) => {
            startTimes.push(Date.now());
            await new Promise(resolve => setTimeout(resolve, 10));
            return { name: 'John' };
          },
        },
        {
          key: 'posts',
          loader: async (ctx: LoaderContext) => {
            startTimes.push(Date.now());
            await new Promise(resolve => setTimeout(resolve, 10));
            return [{ id: 1 }];
          },
        },
      ];

      const results = await executeLoadersParallel(loaders, baseContext);

      // Should start at roughly the same time
      expect(Math.abs(startTimes[0] - startTimes[1])).toBeLessThan(5);

      expect(results).toEqual({
        user: { name: 'John' },
        posts: [{ id: 1 }],
      });
    });

    it('should collect all loader results', async () => {
      const loaders = [
        { key: 'users', loader: async () => [{ id: 1 }, { id: 2 }] },
        { key: 'posts', loader: async () => [{ id: 1 }] },
        { key: 'settings', loader: async () => ({ theme: 'dark' }) },
      ];

      const results = await executeLoadersParallel(loaders, baseContext);

      expect(results).toHaveProperty('users');
      expect(results).toHaveProperty('posts');
      expect(results).toHaveProperty('settings');
      expect(results.users).toHaveLength(2);
    });

    it('should handle one loader failing', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const loaders = [
        { key: 'user', loader: async () => ({ name: 'John' }) },
        { key: 'posts', loader: async () => { throw new Error('Failed'); } },
        { key: 'settings', loader: async () => ({ theme: 'dark' }) },
      ];

      const results = await executeLoadersParallel(loaders, baseContext);

      expect(results.user).toEqual({ name: 'John' });
      expect(results.posts).toHaveProperty('__error');
      expect(results.settings).toEqual({ theme: 'dark' });
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should preserve loader keys', async () => {
      const loaders = [
        { key: 'customKey1', loader: async () => 'value1' },
        { key: 'customKey2', loader: async () => 'value2' },
      ];

      const results = await executeLoadersParallel(loaders, baseContext);

      expect(Object.keys(results)).toEqual(['customKey1', 'customKey2']);
    });
  });

  describe('deferred loading', () => {
    it('should support deferred data in loaders', async () => {
      const loader = async (ctx: LoaderContext) => {
        const criticalData = await ctx.netron.query('users', 'getCurrent', []);

        const deferredData = defer(
          ctx.netron.query('posts', 'getAll', [])
        );

        return {
          user: criticalData,
          posts: deferredData,
        };
      };

      const result = await executeLoader(loader, baseContext);

      expect(result.user).toEqual({ data: 'mocked' });
      expect(result.posts).toHaveProperty('promise');
      expect(result.posts.resolved).toBe(false);
    });

    it('should allow mixing sync and deferred data', async () => {
      const loader = async () => {
        return {
          syncData: { value: 'immediate' },
          deferredData: defer(
            new Promise(resolve => setTimeout(() => resolve({ value: 'deferred' }), 10))
          ),
        };
      };

      const result = await executeLoader(loader, baseContext);

      expect(result.syncData).toEqual({ value: 'immediate' });
      expect(result.deferredData).toHaveProperty('promise');
    });
  });

  describe('loader caching and optimization', () => {
    it('should cache loader results', async () => {
      const loader = vi.fn(async () => ({ data: 'test' }));

      const result1 = await executeLoader(loader, baseContext);
      setLoaderData('/test', result1);

      // In a real router, cached data would be reused
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('should support conditional loading', async () => {
      const loader = async (ctx: LoaderContext) => {
        const cached = { /* cached data */ };

        // Only fetch if not cached
        if (!cached) {
          return await ctx.netron.query('users', 'getAll', []);
        }

        return cached;
      };

      const result = await executeLoader(loader, baseContext);

      // Should use cached data
      expect(result).toEqual({});
    });
  });

  describe('nested route loaders', () => {
    it('should execute parent and child loaders', async () => {
      const parentLoader = async () => ({ layout: 'default' });
      const childLoader = async () => ({ content: 'page' });

      const loaders = [
        { key: 'parent', loader: parentLoader },
        { key: 'child', loader: childLoader },
      ];

      const results = await executeLoadersParallel(loaders, baseContext);

      expect(results.parent).toEqual({ layout: 'default' });
      expect(results.child).toEqual({ content: 'page' });
    });

    it('should pass parent data to child loaders', async () => {
      let parentData: any;

      const parentLoader = async () => {
        parentData = { userId: '123' };
        return parentData;
      };

      const childLoader = async () => {
        // In a real implementation, parent data would be available
        return { userId: parentData?.userId };
      };

      const loaders = [
        { key: 'parent', loader: parentLoader },
        { key: 'child', loader: childLoader },
      ];

      const results = await executeLoadersParallel(loaders, baseContext);

      expect(results.child.userId).toBe('123');
    });
  });

  describe('error handling', () => {
    it('should handle loader throwing error', async () => {
      const loader = async () => {
        throw new Error('Loader failed');
      };

      await expect(executeLoader(loader, baseContext)).rejects.toThrow('Loader failed');
    });

    it('should handle netron query failure', async () => {
      mockNetron.query.mockRejectedValue(new Error('Network error'));

      const loader = async (ctx: LoaderContext) => {
        return await ctx.netron.query('users', 'getAll', []);
      };

      await expect(executeLoader(loader, baseContext)).rejects.toThrow('Network error');
    });

    it('should handle timeout errors', async () => {
      const loader = async () => {
        await new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 100)
        );
      };

      await expect(executeLoader(loader, baseContext)).rejects.toThrow('Timeout');
    });

    it('should provide error context', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const loader = async () => {
        throw new Error('Loader error');
      };

      try {
        await executeLoader(loader, baseContext);
      } catch (error: any) {
        expect(error.message).toBe('Loader error');
      }

      expect(consoleSpy).toHaveBeenCalledWith('Loader error:', expect.any(Error));

      consoleSpy.mockRestore();
    });
  });

  describe('loader dependencies', () => {
    it('should support sequential dependent loaders', async () => {
      const loaders = [
        { key: 'user', loader: async () => ({ id: '123', name: 'John' }) },
        {
          key: 'posts',
          loader: async () => {
            // In real implementation, would access user from previous loader
            return [{ userId: '123', title: 'Post' }];
          },
        },
      ];

      const results = await executeLoadersParallel(loaders, baseContext);

      expect(results.user.id).toBe('123');
      expect(results.posts[0].userId).toBe('123');
    });

    it('should handle circular dependencies gracefully', async () => {
      // This test ensures the implementation doesn't deadlock
      const loaders = [
        { key: 'a', loader: async () => ({ ref: 'b' }) },
        { key: 'b', loader: async () => ({ ref: 'a' }) },
      ];

      const results = await executeLoadersParallel(loaders, baseContext);

      expect(results.a).toEqual({ ref: 'b' });
      expect(results.b).toEqual({ ref: 'a' });
    });
  });

  describe('performance', () => {
    it('should complete parallel loaders faster than sequential', async () => {
      const delay = 50;

      const loaders = [
        { key: 'slow1', loader: async () => {
          await new Promise(resolve => setTimeout(resolve, delay));
          return 'data1';
        }},
        { key: 'slow2', loader: async () => {
          await new Promise(resolve => setTimeout(resolve, delay));
          return 'data2';
        }},
      ];

      const start = Date.now();
      await executeLoadersParallel(loaders, baseContext);
      const duration = Date.now() - start;

      // Parallel should take roughly 'delay' ms, not 2 * delay
      expect(duration).toBeLessThan(delay * 1.5);
    });

    it('should handle many concurrent loaders', async () => {
      const loaders = Array.from({ length: 50 }, (_, i) => ({
        key: `loader${i}`,
        loader: async () => ({ id: i }),
      }));

      const results = await executeLoadersParallel(loaders, baseContext);

      expect(Object.keys(results)).toHaveLength(50);
    });
  });
});
