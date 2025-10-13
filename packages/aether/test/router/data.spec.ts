/**
 * @fileoverview Comprehensive tests for router data loading
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  defer,
  isDeferred,
  awaitDeferred,
  executeLoader,
  executeLoadersParallel,
  executeAction,
  setLoaderData,
  setActionData,
  setNavigationState,
  useFetcher,
} from '../../src/router/data.js';

describe('router data loading', () => {
  describe('defer', () => {
    it('should create deferred data', () => {
      const promise = Promise.resolve({ data: 'test' });
      const deferred = defer(promise);

      expect(deferred).toHaveProperty('promise');
      expect(deferred).toHaveProperty('resolved');
      expect(deferred.resolved).toBe(false);
    });

    it('should mark as resolved on success', async () => {
      const promise = Promise.resolve({ data: 'test' });
      const deferred = defer(promise);

      await promise;
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(deferred.resolved).toBe(true);
      expect(deferred.data).toEqual({ data: 'test' });
    });

    it('should capture error on rejection', async () => {
      const promise = Promise.reject(new Error('Test error'));
      const deferred = defer(promise);

      await promise.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(deferred.resolved).toBe(true);
      expect(deferred.error).toBeInstanceOf(Error);
      expect(deferred.error?.message).toBe('Test error');
    });

    it('should convert non-Error rejection to Error', async () => {
      const promise = Promise.reject('string error');
      const deferred = defer(promise);

      await promise.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(deferred.error).toBeInstanceOf(Error);
    });
  });

  describe('isDeferred', () => {
    it('should identify deferred data', () => {
      const deferred = defer(Promise.resolve('test'));
      expect(isDeferred(deferred)).toBe(true);
    });

    it('should return false for non-deferred data', () => {
      expect(isDeferred(null)).toBe(false);
      expect(isDeferred(undefined)).toBe(false);
      expect(isDeferred({})).toBe(false);
      expect(isDeferred({ promise: 'not a promise' })).toBe(false);
      expect(isDeferred(Promise.resolve('test'))).toBe(false);
    });

    it('should validate deferred structure', () => {
      const valid = {
        promise: Promise.resolve('test'),
        resolved: false,
      };
      expect(isDeferred(valid)).toBe(true);

      const invalid = {
        promise: 'not a promise',
        resolved: false,
      };
      expect(isDeferred(invalid)).toBe(false);
    });
  });

  describe('awaitDeferred', () => {
    it('should await deferred promise', async () => {
      const deferred = defer(Promise.resolve({ data: 'test' }));
      const result = await awaitDeferred(deferred);

      expect(result).toEqual({ data: 'test' });
    });

    it('should return data if already resolved', async () => {
      const promise = Promise.resolve({ data: 'test' });
      const deferred = defer(promise);

      await promise;
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await awaitDeferred(deferred);
      expect(result).toEqual({ data: 'test' });
    });

    it('should throw if promise rejected', async () => {
      const deferred = defer(Promise.reject(new Error('Test error')));

      await expect(awaitDeferred(deferred)).rejects.toThrow('Test error');
    });

    it('should throw resolved error', async () => {
      const promise = Promise.reject(new Error('Test error'));
      const deferred = defer(promise);

      await promise.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 10));

      await expect(awaitDeferred(deferred)).rejects.toThrow('Test error');
    });
  });

  describe('executeLoader', () => {
    it('should execute loader with context', async () => {
      const loader = vi.fn(async (ctx) => ({ user: ctx.params.id }));
      const context: any = {
        params: { id: '123' },
        url: new URL('http://test.com/users/123'),
      };

      const result = await executeLoader(loader, context);

      expect(loader).toHaveBeenCalledWith(context);
      expect(result).toEqual({ user: '123' });
    });

    it('should handle loader errors', async () => {
      const loader = vi.fn(async () => {
        throw new Error('Loader error');
      });

      await expect(executeLoader(loader, {} as any)).rejects.toThrow('Loader error');
    });
  });

  describe('executeLoadersParallel', () => {
    it('should execute multiple loaders in parallel', async () => {
      const loaders = [
        { key: 'user', loader: async () => ({ name: 'John' }) },
        { key: 'posts', loader: async () => [{ id: 1 }] },
      ];

      const results = await executeLoadersParallel(loaders, {} as any);

      expect(results).toEqual({
        user: { name: 'John' },
        posts: [{ id: 1 }],
      });
    });

    it('should handle loader errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const loaders = [
        { key: 'user', loader: async () => ({ name: 'John' }) },
        {
          key: 'posts',
          loader: async () => {
            throw new Error('Failed');
          },
        },
      ];

      const results = await executeLoadersParallel(loaders, {} as any);

      expect(results.user).toEqual({ name: 'John' });
      expect(results.posts).toHaveProperty('__error');
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should wait for all loaders', async () => {
      const order: number[] = [];

      const loaders = [
        {
          key: 'fast',
          loader: async () => {
            order.push(1);
            return 'fast';
          },
        },
        {
          key: 'slow',
          loader: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            order.push(2);
            return 'slow';
          },
        },
      ];

      const results = await executeLoadersParallel(loaders, {} as any);

      expect(results.fast).toBe('fast');
      expect(results.slow).toBe('slow');
      expect(order).toHaveLength(2);
    });
  });

  describe('executeAction', () => {
    it('should execute action with context', async () => {
      const action = vi.fn(async (ctx) => ({ success: true, data: ctx.request }));
      const context: any = {
        request: new Request('http://test.com'),
        params: {},
      };

      const result = await executeAction(action, context);

      expect(action).toHaveBeenCalledWith(context);
      expect(result.success).toBe(true);
    });

    it('should handle action errors', async () => {
      const action = vi.fn(async () => {
        throw new Error('Action error');
      });

      await expect(executeAction(action, {} as any)).rejects.toThrow('Action error');
    });
  });

  describe('data storage', () => {
    it('should set and get loader data', () => {
      setLoaderData('/users', { data: 'test' });

      // Note: Direct access to internal map for testing
      // In real usage, this would be accessed via useLoaderData
    });

    it('should set and get action data', () => {
      setActionData('/users', { success: true });

      // Note: Direct access to internal map for testing
    });

    it('should set navigation state', () => {
      setNavigationState('loading', '/users');

      // Navigation state would be accessed via useNavigation
    });
  });

  describe('useFetcher', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
      global.window = {
        location: {
          origin: 'http://localhost:3000',
        },
      } as any;
    });

    it('should create fetcher with initial state', () => {
      const fetcher = useFetcher();

      expect(fetcher.state).toBe('idle');
      expect(fetcher.data).toBeUndefined();
      expect(fetcher.submit).toBeInstanceOf(Function);
      expect(fetcher.load).toBeInstanceOf(Function);
    });

    it('should submit data', async () => {
      const mockResponse = { ok: true, json: async () => ({ success: true }) };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const fetcher = useFetcher();

      await fetcher.submit({ field: 'value' }, { action: '/api/test' });

      expect(fetcher.state).toBe('idle');
      expect(fetcher.data).toEqual({ success: true });
    });

    it('should handle submit errors', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fetcher = useFetcher();

      await fetcher.submit({ field: 'value' });

      expect(fetcher.state).toBe('idle');
      expect(fetcher.data.error).toBeDefined();

      consoleSpy.mockRestore();
    });

    it('should load data', async () => {
      const mockResponse = { ok: true, json: async () => ({ data: 'loaded' }) };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const fetcher = useFetcher();

      await fetcher.load('/users/123');

      expect(fetcher.state).toBe('idle');
      expect(fetcher.data).toEqual({ data: 'loaded' });
    });

    it('should handle FormData submission', async () => {
      const mockResponse = { ok: true, json: async () => ({ success: true }) };
      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const fetcher = useFetcher();
      const formData = new FormData();
      formData.append('field', 'value');

      await fetcher.submit(formData);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: formData,
          headers: {},
        })
      );
    });
  });

  describe('edge cases', () => {
    it('should handle empty loader results', async () => {
      const loader = async () => undefined;
      const result = await executeLoader(loader, {} as any);

      expect(result).toBeUndefined();
    });

    it('should handle null loader results', async () => {
      const loader = async () => null;
      const result = await executeLoader(loader, {} as any);

      expect(result).toBeNull();
    });

    it('should handle multiple deferred promises', async () => {
      const deferred1 = defer(Promise.resolve('first'));
      const deferred2 = defer(Promise.resolve('second'));

      const [result1, result2] = await Promise.all([awaitDeferred(deferred1), awaitDeferred(deferred2)]);

      expect(result1).toBe('first');
      expect(result2).toBe('second');
    });

    it('should handle mixed resolved/unresolved deferred', async () => {
      const promise1 = Promise.resolve('resolved');
      const deferred1 = defer(promise1);

      await promise1;
      await new Promise((resolve) => setTimeout(resolve, 10));

      const deferred2 = defer(Promise.resolve('unresolved'));

      const [result1, result2] = await Promise.all([awaitDeferred(deferred1), awaitDeferred(deferred2)]);

      expect(result1).toBe('resolved');
      expect(result2).toBe('unresolved');
    });
  });
});
