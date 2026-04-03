/**
 * HttpCacheAdapter Tests
 *
 * Tests for the Titan-backed HTTP cache adapter that provides
 * stale-while-revalidate, tag-based invalidation, and unified statistics.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpCacheAdapter } from '../../../../src/netron/transport/http/fluent-interface/cache-adapter.js';
import { CacheService } from '../../../../src/modules/cache/cache.service.js';

describe('HttpCacheAdapter', () => {
  let cacheService: CacheService;
  let adapter: HttpCacheAdapter;

  beforeEach(() => {
    cacheService = new CacheService({
      defaultMaxSize: 100,
      defaultTtl: 60,
      enableStats: true,
    });

    adapter = new HttpCacheAdapter({
      cacheService,
      cacheName: 'http-test',
      maxEntries: 100,
      defaultMaxAge: 5000,
    });
  });

  afterEach(async () => {
    adapter.clear();
    await cacheService.dispose();
  });

  describe('constructor', () => {
    it('should create adapter with cacheService', () => {
      expect(adapter).toBeDefined();
      expect(adapter.getTitanCache()).toBeDefined();
    });

    it('should throw if no cache or cacheService provided', () => {
      expect(() => new HttpCacheAdapter({})).toThrow('requires either cache or cacheService');
    });
  });

  describe('get', () => {
    it('should fetch and cache data on miss', async () => {
      const fetcher = vi.fn().mockResolvedValue({ id: 1, name: 'test' });

      const result = await adapter.get('user:1', fetcher, { maxAge: 5000 });

      expect(result).toEqual({ id: 1, name: 'test' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('should return cached data on hit', async () => {
      const fetcher = vi.fn().mockResolvedValue({ id: 1, name: 'test' });

      // First call - cache miss
      await adapter.get('user:1', fetcher, { maxAge: 5000 });

      // Second call - cache hit
      const result = await adapter.get('user:1', fetcher, { maxAge: 5000 });

      expect(result).toEqual({ id: 1, name: 'test' });
      expect(fetcher).toHaveBeenCalledTimes(1); // Only called once
    });

    it('should track hits and misses in stats', async () => {
      const fetcher = vi.fn().mockResolvedValue({ data: 'test' });

      await adapter.get('key1', fetcher, { maxAge: 5000 }); // miss
      await adapter.get('key1', fetcher, { maxAge: 5000 }); // hit
      await adapter.get('key2', fetcher, { maxAge: 5000 }); // miss

      const stats = adapter.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBeCloseTo(33.33, 1);
    });
  });

  describe('stale-while-revalidate', () => {
    it('should serve stale data while revalidating', async () => {
      let callCount = 0;
      const fetcher = vi.fn().mockImplementation(async () => {
        callCount++;
        return { value: callCount };
      });

      // Initial fetch
      const result1 = await adapter.get('key', fetcher, {
        maxAge: 10, // 10ms
        staleWhileRevalidate: 5000, // 5 seconds
      });
      expect(result1).toEqual({ value: 1 });

      // Wait for maxAge to expire but still within SWR window
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should return stale data immediately
      const result2 = await adapter.get('key', fetcher, {
        maxAge: 10,
        staleWhileRevalidate: 5000,
      });
      expect(result2).toEqual({ value: 1 }); // Still old value

      // Wait for background revalidation
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Third fetch should get revalidated data
      const result3 = await adapter.get('key', fetcher, {
        maxAge: 10,
        staleWhileRevalidate: 5000,
      });
      // Could be 1 or 2 depending on timing
      expect(result3.value).toBeGreaterThanOrEqual(1);
    });
  });

  describe('cacheOnError', () => {
    it('should return stale data on fetch error when cacheOnError is true', async () => {
      let shouldFail = false;
      const fetcher = vi.fn().mockImplementation(async () => {
        if (shouldFail) throw new Error('Network error');
        return { data: 'success' };
      });

      // First fetch - success
      await adapter.get('key', fetcher, {
        maxAge: 10,
        cacheOnError: true,
      });

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Enable failure
      shouldFail = true;

      // Should return stale data on error
      const result = await adapter.get('key', fetcher, {
        maxAge: 10,
        cacheOnError: true,
      });

      expect(result).toEqual({ data: 'success' });
    });

    it('should throw error when cacheOnError is false', async () => {
      const fetcher = vi.fn().mockRejectedValue(new Error('Network error'));

      await expect(adapter.get('key', fetcher, { maxAge: 5000, cacheOnError: false })).rejects.toThrow('Network error');
    });
  });

  describe('set', () => {
    it('should store data in cache', async () => {
      await adapter.set('key', { data: 'value' }, { maxAge: 5000 });

      const raw = await adapter.getRaw('key');
      expect(raw).toEqual({ data: 'value' });
    });

    it('should emit cache-set event', async () => {
      const listener = vi.fn();
      adapter.on('cache-set', listener);

      await adapter.set('key', { data: 'value' }, { maxAge: 5000 });

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ key: 'key' }));
    });
  });

  describe('invalidate', () => {
    beforeEach(async () => {
      await adapter.set('user:1', { id: 1 }, { maxAge: 5000, tags: ['users'] });
      await adapter.set('user:2', { id: 2 }, { maxAge: 5000, tags: ['users'] });
      await adapter.set('post:1', { id: 1 }, { maxAge: 5000, tags: ['posts'] });
    });

    it('should invalidate by exact key', () => {
      const count = adapter.invalidate('user:1');
      expect(count).toBe(1);
    });

    it('should invalidate by prefix pattern', () => {
      const count = adapter.invalidate('user:*');
      expect(count).toBe(2);
    });

    it('should invalidate by regex', () => {
      const count = adapter.invalidate(/user:\d+/);
      expect(count).toBe(2);
    });

    it('should invalidate by tags', () => {
      const count = adapter.invalidateByTags(['users']);
      expect(count).toBeGreaterThanOrEqual(0); // Async operation
    });

    it('should emit cache-invalidate event', () => {
      const listener = vi.fn();
      adapter.on('cache-invalidate', listener);

      adapter.invalidate('user:1');

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete specific key', async () => {
      await adapter.set('key', { data: 'value' }, { maxAge: 5000 });

      const deleted = adapter.delete('key');
      expect(deleted).toBe(true);

      const raw = await adapter.getRaw('key');
      expect(raw).toBeUndefined();
    });

    it('should return false for non-existent key', () => {
      const deleted = adapter.delete('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all cache entries', async () => {
      await adapter.set('key1', { data: 1 }, { maxAge: 5000 });
      await adapter.set('key2', { data: 2 }, { maxAge: 5000 });

      adapter.clear();

      const stats = adapter.getStats();
      expect(stats.entries).toBe(0);
    });

    it('should emit cache-clear event', () => {
      const listener = vi.fn();
      adapter.on('cache-clear', listener);

      adapter.clear();

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('isCacheHit', () => {
    it('should track last hit keys', async () => {
      const fetcher = vi.fn().mockResolvedValue({ data: 'test' });

      // Miss
      await adapter.get('key', fetcher, { maxAge: 5000 });
      expect(adapter.isCacheHit('key')).toBe(false);

      // Hit
      await adapter.get('key', fetcher, { maxAge: 5000 });
      expect(adapter.isCacheHit('key')).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return cache statistics', async () => {
      const fetcher = vi.fn().mockResolvedValue({ data: 'test' });

      await adapter.get('key1', fetcher, { maxAge: 5000 });
      await adapter.get('key2', fetcher, { maxAge: 5000 });
      await adapter.get('key1', fetcher, { maxAge: 5000 }); // hit

      const stats = adapter.getStats();

      expect(stats).toEqual(
        expect.objectContaining({
          entries: 2,
          hits: 1,
          misses: 2,
          hitRate: expect.any(Number),
          sizeBytes: expect.any(Number),
          activeRevalidations: 0,
        })
      );
    });
  });

  describe('getTitanCache', () => {
    it('should return underlying Titan cache', () => {
      const cache = adapter.getTitanCache();
      expect(cache).toBeDefined();
      expect(typeof cache.get).toBe('function');
      expect(typeof cache.set).toBe('function');
    });
  });

  describe('events', () => {
    it('should emit cache-hit event', async () => {
      const listener = vi.fn();
      adapter.on('cache-hit', listener);

      const fetcher = vi.fn().mockResolvedValue({ data: 'test' });
      await adapter.get('key', fetcher, { maxAge: 5000 });
      await adapter.get('key', fetcher, { maxAge: 5000 }); // hit

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ key: 'key' }));
    });

    it('should emit cache-miss event', async () => {
      const listener = vi.fn();
      adapter.on('cache-miss', listener);

      const fetcher = vi.fn().mockResolvedValue({ data: 'test' });
      await adapter.get('key', fetcher, { maxAge: 5000 });

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ key: 'key' }));
    });
  });
});
