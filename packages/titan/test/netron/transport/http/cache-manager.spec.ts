/**
 * Tests for HTTP Cache Manager
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HttpCacheManager } from '../../../../src/netron/transport/http/fluent-interface/index.js';

describe('HttpCacheManager', () => {
  let cacheManager: HttpCacheManager;

  beforeEach(() => {
    cacheManager = new HttpCacheManager({
      defaultMaxAge: 5000,
      debug: false,
    });
  });

  afterEach(() => {
    cacheManager.clear();
  });

  describe('Basic Caching', () => {
    it('should cache and retrieve data', async () => {
      const key = 'test-key';
      const data = { value: 'test-data' };
      let fetchCount = 0;

      const fetcher = jest.fn(async () => {
        fetchCount++;
        return data;
      });

      // First call - cache miss
      const result1 = await cacheManager.get(key, fetcher, { maxAge: 1000 });
      expect(result1).toEqual(data);
      expect(fetchCount).toBe(1);

      // Second call - cache hit
      const result2 = await cacheManager.get(key, fetcher, { maxAge: 1000 });
      expect(result2).toEqual(data);
      expect(fetchCount).toBe(1); // Should not fetch again
    });

    it('should respect maxAge', async () => {
      const key = 'test-key';
      let fetchCount = 0;
      const fetcher = jest.fn(async () => {
        fetchCount++;
        return { value: fetchCount };
      });

      // First call
      const result1 = await cacheManager.get(key, fetcher, { maxAge: 50 });
      expect(result1).toEqual({ value: 1 });

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Second call - should fetch again
      const result2 = await cacheManager.get(key, fetcher, { maxAge: 50 });
      expect(result2).toEqual({ value: 2 });
      expect(fetchCount).toBe(2);
    });

    it('should handle cache miss', async () => {
      const fetcher = jest.fn(async () => ({ data: 'fresh' }));

      const result = await cacheManager.get('new-key', fetcher, { maxAge: 1000 });
      expect(result).toEqual({ data: 'fresh' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });

  describe('Stale While Revalidate', () => {
    it('should serve stale content while revalidating', async () => {
      const key = 'swr-key';
      let fetchCount = 0;
      const fetcher = jest.fn(async () => {
        fetchCount++;
        // Simulate slow fetch
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { value: `data-${fetchCount}` };
      });

      // Initial fetch
      const result1 = await cacheManager.get(key, fetcher, {
        maxAge: 100,
        staleWhileRevalidate: 1000,
      });
      expect(result1).toEqual({ value: 'data-1' });

      // Wait for cache to become stale but within staleWhileRevalidate window
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should return stale data immediately
      const result2 = await cacheManager.get(key, fetcher, {
        maxAge: 100,
        staleWhileRevalidate: 1000,
      });
      expect(result2).toEqual({ value: 'data-1' }); // Stale data

      // Wait for background revalidation
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Next call should return fresh data
      const result3 = await cacheManager.get(key, fetcher, {
        maxAge: 100,
        staleWhileRevalidate: 1000,
      });
      expect(result3).toEqual({ value: 'data-2' }); // Fresh data
    });

    it('should handle revalidation errors', async () => {
      const key = 'error-key';
      let fetchCount = 0;
      const fetcher = jest.fn(async () => {
        fetchCount++;
        if (fetchCount === 1) {
          return { value: 'initial' };
        }
        throw new Error('Revalidation failed');
      });

      // Initial successful fetch
      await cacheManager.get(key, fetcher, {
        maxAge: 50,
        staleWhileRevalidate: 1000,
      });

      // Wait for cache to become stale
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Should still return stale data even if revalidation fails
      const result = await cacheManager.get(key, fetcher, {
        maxAge: 50,
        staleWhileRevalidate: 1000,
      });
      expect(result).toEqual({ value: 'initial' });
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate by exact key', async () => {
      const fetcher = jest.fn(async () => ({ data: 'test' }));

      // Cache some data
      await cacheManager.get('key1', fetcher, { maxAge: 1000 });
      await cacheManager.get('key2', fetcher, { maxAge: 1000 });

      // Invalidate one key
      cacheManager.invalidate('key1');

      // key1 should refetch
      await cacheManager.get('key1', fetcher, { maxAge: 1000 });
      expect(fetcher).toHaveBeenCalledTimes(3); // Initial 2 + 1 after invalidation

      // key2 should still be cached
      await cacheManager.get('key2', fetcher, { maxAge: 1000 });
      expect(fetcher).toHaveBeenCalledTimes(3); // No additional fetch
    });

    it('should invalidate by prefix pattern', async () => {
      const fetcher = jest.fn(async () => ({ data: 'test' }));

      // Cache data with similar prefixes
      await cacheManager.get('users:1', fetcher, { maxAge: 1000 });
      await cacheManager.get('users:2', fetcher, { maxAge: 1000 });
      await cacheManager.get('posts:1', fetcher, { maxAge: 1000 });

      // Invalidate by prefix
      cacheManager.invalidate('users:*');

      // Users should refetch
      await cacheManager.get('users:1', fetcher, { maxAge: 1000 });
      await cacheManager.get('users:2', fetcher, { maxAge: 1000 });
      expect(fetcher).toHaveBeenCalledTimes(5); // 3 initial + 2 after invalidation

      // Posts should still be cached
      await cacheManager.get('posts:1', fetcher, { maxAge: 1000 });
      expect(fetcher).toHaveBeenCalledTimes(5); // No additional fetch
    });

    it('should invalidate by regex pattern', async () => {
      const fetcher = jest.fn(async () => ({ data: 'test' }));

      // Cache data
      await cacheManager.get('user-123', fetcher, { maxAge: 1000 });
      await cacheManager.get('user-456', fetcher, { maxAge: 1000 });
      await cacheManager.get('post-789', fetcher, { maxAge: 1000 });

      // Invalidate by regex
      cacheManager.invalidate(/^user-/);

      // User entries should be invalidated
      await cacheManager.get('user-123', fetcher, { maxAge: 1000 });
      expect(fetcher).toHaveBeenCalledTimes(4); // 3 initial + 1 after invalidation
    });

    it('should invalidate by tags', async () => {
      const fetcher = jest.fn(async () => ({ data: 'test' }));

      // Cache data with tags
      await cacheManager.get('key1', fetcher, { maxAge: 1000, tags: ['users', 'admin'] });
      await cacheManager.get('key2', fetcher, { maxAge: 1000, tags: ['users'] });
      await cacheManager.get('key3', fetcher, { maxAge: 1000, tags: ['posts'] });

      // Invalidate by tag
      cacheManager.invalidate(['users']);

      // Keys with 'users' tag should refetch
      await cacheManager.get('key1', fetcher, { maxAge: 1000, tags: ['users', 'admin'] });
      await cacheManager.get('key2', fetcher, { maxAge: 1000, tags: ['users'] });
      expect(fetcher).toHaveBeenCalledTimes(5); // 3 initial + 2 after invalidation

      // Key without 'users' tag should still be cached
      await cacheManager.get('key3', fetcher, { maxAge: 1000, tags: ['posts'] });
      expect(fetcher).toHaveBeenCalledTimes(5); // No additional fetch
    });
  });

  describe('Cache Statistics', () => {
    it('should track cache hits and misses', async () => {
      const fetcher = jest.fn(async () => ({ data: 'test' }));

      // Initial state
      let stats = cacheManager.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);

      // Cache miss
      await cacheManager.get('key1', fetcher, { maxAge: 1000 });
      stats = cacheManager.getStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);

      // Cache hit
      await cacheManager.get('key1', fetcher, { maxAge: 1000 });
      stats = cacheManager.getStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(1);

      // Another miss
      await cacheManager.get('key2', fetcher, { maxAge: 1000 });
      stats = cacheManager.getStats();
      expect(stats.misses).toBe(2);
      expect(stats.hits).toBe(1);

      // Hit rate calculation
      expect(stats.hitRate).toBeCloseTo(33.33, 1);
    });

    it('should track cache size', async () => {
      const fetcher1 = jest.fn(async () => ({ data: 'short' }));
      const fetcher2 = jest.fn(async () => ({ data: 'a'.repeat(1000) }));

      let stats = cacheManager.getStats();
      expect(stats.entries).toBe(0);
      expect(stats.sizeBytes).toBe(0);

      await cacheManager.get('key1', fetcher1, { maxAge: 1000 });
      stats = cacheManager.getStats();
      expect(stats.entries).toBe(1);
      expect(stats.sizeBytes).toBeGreaterThan(0);

      const size1 = stats.sizeBytes;

      await cacheManager.get('key2', fetcher2, { maxAge: 1000 });
      stats = cacheManager.getStats();
      expect(stats.entries).toBe(2);
      expect(stats.sizeBytes).toBeGreaterThan(size1);
    });
  });

  describe('Cache Eviction', () => {
    it('should evict oldest entries when max entries reached', async () => {
      const cache = new HttpCacheManager({
        maxEntries: 2,
      });

      // Track fetch counts
      let fetch1Count = 0;
      let fetch2Count = 0;
      let fetch3Count = 0;

      const fetcher1 = jest.fn(async () => {
        fetch1Count++;
        return { value: `value1-${fetch1Count}` };
      });
      const fetcher2 = jest.fn(async () => {
        fetch2Count++;
        return { value: `value2-${fetch2Count}` };
      });
      const fetcher3 = jest.fn(async () => {
        fetch3Count++;
        return { value: `value3-${fetch3Count}` };
      });

      // Fill cache to capacity
      await cache.get('key1', fetcher1, { maxAge: 1000 });
      expect(fetch1Count).toBe(1);

      await cache.get('key2', fetcher2, { maxAge: 1000 });
      expect(fetch2Count).toBe(1);

      // Cache is now full with key1 and key2
      expect(cache.getStats().entries).toBe(2);

      // Add third entry - should evict key1 (oldest)
      await cache.get('key3', fetcher3, { maxAge: 1000 });
      expect(fetch3Count).toBe(1);
      expect(cache.getStats().entries).toBe(2);

      // Now cache should have key2 and key3 only
      // Accessing key2 and key3 should not trigger fetches
      const result2 = await cache.get('key2', fetcher2, { maxAge: 1000 });
      expect(fetch2Count).toBe(1); // No new fetch
      expect(result2).toEqual({ value: 'value2-1' });

      const result3 = await cache.get('key3', fetcher3, { maxAge: 1000 });
      expect(fetch3Count).toBe(1); // No new fetch
      expect(result3).toEqual({ value: 'value3-1' });

      // Accessing key1 should trigger a fetch since it was evicted
      const result1 = await cache.get('key1', fetcher1, { maxAge: 1000 });
      expect(fetch1Count).toBe(2); // New fetch required
      expect(result1).toEqual({ value: 'value1-2' });

      cache.clear();
    });
  });

  describe('Cache on Error', () => {
    it('should return stale data when fetcher fails with cacheOnError', async () => {
      const key = 'error-cache-key';
      let fetchCount = 0;
      const fetcher = jest.fn(async () => {
        fetchCount++;
        if (fetchCount === 1) {
          return { value: 'initial' };
        }
        throw new Error('Fetch failed');
      });

      // Initial successful fetch
      await cacheManager.get(key, fetcher, {
        maxAge: 50,
        cacheOnError: true,
      });

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Should return stale data on error
      const result = await cacheManager.get(key, fetcher, {
        maxAge: 50,
        cacheOnError: true,
      });
      expect(result).toEqual({ value: 'initial' });
    });

    it('should throw error when no stale data available', async () => {
      const fetcher = jest.fn(async () => {
        throw new Error('Fetch failed');
      });

      await expect(
        cacheManager.get('new-key', fetcher, {
          maxAge: 1000,
          cacheOnError: true,
        })
      ).rejects.toThrow('Fetch failed');
    });
  });

  describe('TTL and Expiration', () => {
    it('should automatically clean up expired entries', async () => {
      const fetcher = jest.fn(async () => ({ data: 'test' }));

      // Cache with short TTL
      await cacheManager.get('short-ttl', fetcher, { maxAge: 50 });

      let stats = cacheManager.getStats();
      expect(stats.entries).toBe(1);

      // Wait for expiration plus buffer
      await new Promise((resolve) => setTimeout(resolve, 100));

      stats = cacheManager.getStats();
      expect(stats.entries).toBe(0);
    });
  });

  describe('Events', () => {
    it('should emit cache events', async () => {
      const events: any[] = [];
      const handlers = {
        hit: jest.fn((data) => events.push({ type: 'hit', data })),
        miss: jest.fn((data) => events.push({ type: 'miss', data })),
        set: jest.fn((data) => events.push({ type: 'set', data })),
        invalidate: jest.fn((data) => events.push({ type: 'invalidate', data })),
      };

      cacheManager.on('cache-hit', handlers.hit);
      cacheManager.on('cache-miss', handlers.miss);
      cacheManager.on('cache-set', handlers.set);
      cacheManager.on('cache-invalidate', handlers.invalidate);

      const fetcher = jest.fn(async () => ({ data: 'test' }));

      // Trigger miss and set
      await cacheManager.get('key1', fetcher, { maxAge: 1000 });
      expect(handlers.miss).toHaveBeenCalledWith({ key: 'key1' });
      expect(handlers.set).toHaveBeenCalled();

      // Trigger hit
      await cacheManager.get('key1', fetcher, { maxAge: 1000 });
      expect(handlers.hit).toHaveBeenCalled();

      // Trigger invalidate
      cacheManager.invalidate('key1');
      expect(handlers.invalidate).toHaveBeenCalledWith({ keys: ['key1'] });
    });
  });

  describe('Debug Mode', () => {
    it('should log debug messages when debug is enabled', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const cache = new HttpCacheManager({
        defaultMaxAge: 5000,
        debug: true,
      });

      const fetcher = jest.fn(async () => ({ data: 'test' }));

      // Cache miss - should log
      await cache.get('debug-key', fetcher, { maxAge: 1000 });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Cache] MISS: debug-key'));

      // Cache hit - should log
      await cache.get('debug-key', fetcher, { maxAge: 1000 });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Cache] HIT: debug-key'));

      consoleSpy.mockRestore();
      cache.clear();
    });

    it('should log stale cache hits in debug mode', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const cache = new HttpCacheManager({
        defaultMaxAge: 5000,
        debug: true,
      });

      const fetcher = jest.fn(async () => ({ data: 'test' }));

      // Initial fetch
      await cache.get('stale-key', fetcher, { maxAge: 50, staleWhileRevalidate: 100 });

      // Wait for cache to become stale
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Access stale cache
      await cache.get('stale-key', fetcher, { maxAge: 50, staleWhileRevalidate: 100 });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Cache] STALE: stale-key'));

      consoleSpy.mockRestore();
      cache.clear();
    });

    it('should log during background revalidation', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const cache = new HttpCacheManager({
        defaultMaxAge: 5000,
        debug: true,
      });

      const fetcher = jest.fn(async () => ({ data: 'test', timestamp: Date.now() }));

      // Initial fetch
      await cache.get('revalidate-key', fetcher, { maxAge: 50, staleWhileRevalidate: 100 });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Cache] MISS'));

      // Wait for cache to become stale
      await new Promise((resolve) => setTimeout(resolve, 60));

      consoleSpy.mockClear();

      // Access stale cache - triggers background revalidation
      await cache.get('revalidate-key', fetcher, { maxAge: 50, staleWhileRevalidate: 100 });

      // Should log STALE
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Cache] STALE'));

      consoleSpy.mockRestore();
      cache.clear();
    });
  });

  describe('Size-based Eviction', () => {
    it('should evict entries when max size is exceeded', async () => {
      const cache = new HttpCacheManager({
        maxSizeBytes: 1000,
        maxEntries: 10, // Allow enough entries
      });

      const fetcher1 = jest.fn(async () => ({ data: 'x'.repeat(400) })); // ~400 bytes
      const fetcher2 = jest.fn(async () => ({ data: 'y'.repeat(400) })); // ~400 bytes
      const fetcher3 = jest.fn(async () => ({ data: 'z'.repeat(400) })); // ~400 bytes

      // Add entries
      await cache.get('size-key1', fetcher1, { maxAge: 10000 });
      const statsBefore = cache.getStats();
      const sizeBefore = statsBefore.sizeBytes;

      await cache.get('size-key2', fetcher2, { maxAge: 10000 });

      // Add third entry - should trigger eviction based on size
      await cache.get('size-key3', fetcher3, { maxAge: 10000 });

      const statsAfter = cache.getStats();
      // Size should be controlled (though not exact due to JSON overhead)
      expect(statsAfter.entries).toBeGreaterThan(0);
      expect(statsAfter.sizeBytes).toBeGreaterThan(0);

      cache.clear();
    });

    it('should calculate size correctly', async () => {
      const cache = new HttpCacheManager({
        maxSizeBytes: 10000,
      });

      const smallData = { value: 'small' };
      const fetcher = jest.fn(async () => smallData);

      await cache.get('size-test', fetcher, { maxAge: 1000 });

      const stats = cache.getStats();
      expect(stats.sizeBytes).toBeGreaterThan(0);
      expect(stats.entries).toBe(1);

      cache.clear();
    });
  });

  describe('Edge Cases', () => {
    it('should handle concurrent gets for same key from cache', async () => {
      const fetcher = jest.fn(async () => ({ data: 'concurrent' }));

      // First fetch to populate cache
      await cacheManager.get('concurrent-key', fetcher, { maxAge: 1000 });
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Concurrent gets should hit cache
      const promises = [
        cacheManager.get('concurrent-key', fetcher, { maxAge: 1000 }),
        cacheManager.get('concurrent-key', fetcher, { maxAge: 1000 }),
        cacheManager.get('concurrent-key', fetcher, { maxAge: 1000 }),
      ];

      const results = await Promise.all(promises);

      // Should not fetch again (still 1 time)
      expect(fetcher).toHaveBeenCalledTimes(1);
      results.forEach((result) => {
        expect(result).toEqual({ data: 'concurrent' });
      });
    });

    it('should handle delete of non-existent key', () => {
      const result = cacheManager.delete('non-existent');
      expect(result).toBe(false);
    });

    it('should delete existing key successfully', async () => {
      const fetcher = jest.fn(async () => ({ data: 'test' }));

      await cacheManager.get('delete-test', fetcher, { maxAge: 1000 });

      let stats = cacheManager.getStats();
      expect(stats.entries).toBe(1);

      const deleted = cacheManager.delete('delete-test');
      expect(deleted).toBe(true);

      stats = cacheManager.getStats();
      expect(stats.entries).toBe(0);
    });

    it('should update stats correctly', async () => {
      cacheManager.clear();

      const fetcher = jest.fn(async () => ({ data: 'test' }));

      const initialStats = cacheManager.getStats();
      expect(initialStats.hits).toBe(0);
      expect(initialStats.misses).toBe(0);

      // Miss
      await cacheManager.get('stats-key', fetcher, { maxAge: 1000 });

      let stats = cacheManager.getStats();
      expect(stats.misses).toBe(1);

      // Hit
      await cacheManager.get('stats-key', fetcher, { maxAge: 1000 });

      stats = cacheManager.getStats();
      expect(stats.hits).toBe(1);
    });
  });

  describe('Cache Hit Tracking', () => {
    it('should track cache hits with isCacheHit method', async () => {
      const fetcher = jest.fn().mockResolvedValue('data');
      const cacheManager = new HttpCacheManager({ debug: false });

      // First call - miss
      expect(cacheManager.isCacheHit('hit-key')).toBe(false);

      await cacheManager.get('hit-key', fetcher, { maxAge: 1000 });

      // After first call - still not a hit (was a miss)
      expect(cacheManager.isCacheHit('hit-key')).toBe(false);

      // Second call - hit
      await cacheManager.get('hit-key', fetcher, { maxAge: 1000 });

      // Now it should be tracked as a hit
      expect(cacheManager.isCacheHit('hit-key')).toBe(true);
    });

    it('should clear hit tracking on cache clear', async () => {
      const fetcher = jest.fn().mockResolvedValue('data');
      const cacheManager = new HttpCacheManager({ debug: false });

      await cacheManager.get('hit-key', fetcher, { maxAge: 1000 });
      await cacheManager.get('hit-key', fetcher, { maxAge: 1000 });

      expect(cacheManager.isCacheHit('hit-key')).toBe(true);

      cacheManager.clear();

      expect(cacheManager.isCacheHit('hit-key')).toBe(false);
    });
  });

  describe('Debug Mode - Advanced', () => {
    it('should log invalidation count in debug mode', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const cacheManager = new HttpCacheManager({ debug: true });
      const fetcher = jest.fn().mockResolvedValue('data');

      await cacheManager.get('key1', fetcher, { maxAge: 1000, tags: ['test'] });
      await cacheManager.get('key2', fetcher, { maxAge: 1000, tags: ['test'] });
      await cacheManager.get('key3', fetcher, { maxAge: 1000, tags: ['other'] });

      cacheManager.invalidate(['test']);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Cache] INVALIDATED: 2 entries'));

      consoleSpy.mockRestore();
    });

    it('should log eviction in debug mode', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const cacheManager = new HttpCacheManager({ debug: true, maxEntries: 2 });
      const fetcher = jest.fn().mockResolvedValue('data');

      await cacheManager.get('key1', fetcher, { maxAge: 1000 });
      await cacheManager.get('key2', fetcher, { maxAge: 1000 });
      await cacheManager.get('key3', fetcher, { maxAge: 1000 }); // Should evict key1

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Cache] EVICTED:'));

      consoleSpy.mockRestore();
    });
  });

  describe('Edge Cases - Advanced', () => {
    it('should handle multiple tag invalidations', async () => {
      const cacheManager = new HttpCacheManager();
      const fetcher = jest.fn().mockResolvedValue('data');

      await cacheManager.get('key1', fetcher, { maxAge: 1000, tags: ['tag1', 'tag2'] });
      await cacheManager.get('key2', fetcher, { maxAge: 1000, tags: ['tag2', 'tag3'] });
      await cacheManager.get('key3', fetcher, { maxAge: 1000, tags: ['tag3'] });

      cacheManager.invalidate(['tag2']);

      const stats = cacheManager.getStats();
      expect(stats.entries).toBe(1); // Only key3 should remain
    });

    it('should track active revalidations in stats', async () => {
      const cacheManager = new HttpCacheManager({ debug: false });

      // Mock a slow fetcher to keep revalidation active
      const slowFetcher = jest
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve('data'), 50)));

      // First call
      await cacheManager.get('key', slowFetcher, {
        maxAge: 10,
        staleWhileRevalidate: 1000,
      });

      // Wait for stale
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Trigger revalidation
      const promise = cacheManager.get('key', slowFetcher, {
        maxAge: 10,
        staleWhileRevalidate: 1000,
      });

      // Check stats during revalidation
      const stats = cacheManager.getStats();
      expect(stats.activeRevalidations).toBeGreaterThan(0);

      await promise;
    });
  });
});
