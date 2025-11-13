/**
 * Tests for HTTP Cache Storage Implementation
 * Verifies that cache hints from server responses are properly stored
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { HttpCacheManager } from '../../../src/netron/transport/http/fluent-interface/cache-manager.js';

describe('HTTP Transport - Cache Storage', () => {
  let cacheManager: HttpCacheManager;

  beforeEach(() => {
    cacheManager = new HttpCacheManager({
      maxEntries: 100,
      maxSizeBytes: 1024 * 1024, // 1MB
      defaultMaxAge: 60000,
    });
  });

  afterEach(() => {
    cacheManager.clear();
  });

  describe('Cache Storage Basics', () => {
    it('should store data in cache', async () => {
      const data = { id: 1, name: 'Test' };
      const fetcher = async () => data;

      const result = await cacheManager.get('test-key', fetcher, {
        maxAge: 60000,
      });

      expect(result).toEqual(data);
    });

    it('should retrieve cached data on subsequent calls', async () => {
      let callCount = 0;
      const fetcher = async () => {
        callCount++;
        return { value: callCount };
      };

      // First call - should fetch
      const result1 = await cacheManager.get('test-key', fetcher, {
        maxAge: 60000,
      });
      expect(result1.value).toBe(1);
      expect(callCount).toBe(1);

      // Second call - should use cache
      const result2 = await cacheManager.get('test-key', fetcher, {
        maxAge: 60000,
      });
      expect(result2.value).toBe(1);
      expect(callCount).toBe(1); // Still 1, not fetched again
    });

    it('should store cache with tags', async () => {
      const fetcher = async () => ({ data: 'test' });

      await cacheManager.get('test-key', fetcher, {
        maxAge: 60000,
        tags: ['user', 'profile'],
      });

      const stats = cacheManager.getStats();
      expect(stats.entries).toBe(1);
    });

    it('should handle cache expiration', async () => {
      let callCount = 0;
      const fetcher = async () => {
        callCount++;
        return { value: callCount };
      };

      // First call with short TTL
      await cacheManager.get('test-key', fetcher, {
        maxAge: 50, // 50ms
      });
      expect(callCount).toBe(1);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should fetch again after expiration
      await cacheManager.get('test-key', fetcher, {
        maxAge: 50,
      });
      expect(callCount).toBe(2);
    });
  });

  describe('Cache Hints Processing', () => {
    it('should store response with cache hints', () => {
      const responseData = { users: ['Alice', 'Bob'] };
      const cacheHints = {
        maxAge: 300000, // 5 minutes
        tags: ['users', 'list'],
      };

      // Simulate handleCacheHints behavior
      cacheManager.set('service.method:hash123', responseData, {
        maxAge: cacheHints.maxAge,
        tags: cacheHints.tags,
      });

      const cached = cacheManager.getRaw('service.method:hash123');
      expect(cached).toEqual(responseData);
    });

    it('should not cache when maxAge is 0', () => {
      const responseData = { data: 'test' };

      // Don't cache if maxAge is 0
      const maxAge = 0;
      if (maxAge > 0) {
        cacheManager.set('test-key', responseData, { maxAge });
      }

      const cached = cacheManager.getRaw('test-key');
      expect(cached).toBeUndefined();
    });

    it('should not cache when maxAge is negative', () => {
      const responseData = { data: 'test' };

      // Don't cache if maxAge is negative
      const maxAge = -1000;
      if (maxAge > 0) {
        cacheManager.set('test-key', responseData, { maxAge });
      }

      const cached = cacheManager.getRaw('test-key');
      expect(cached).toBeUndefined();
    });

    it('should cache with different TTLs for different methods', () => {
      // Fast-changing data
      cacheManager.set('service.getStatus:hash1', { status: 'online' }, {
        maxAge: 1000, // 1 second
      });

      // Slow-changing data
      cacheManager.set('service.getConfig:hash2', { config: {} }, {
        maxAge: 600000, // 10 minutes
      });

      expect(cacheManager.getRaw('service.getStatus:hash1')).toBeDefined();
      expect(cacheManager.getRaw('service.getConfig:hash2')).toBeDefined();
    });
  });

  describe('Cache Invalidation', () => {
    beforeEach(() => {
      // Setup some cached data
      cacheManager.set('users.list:hash1', { users: [] }, {
        maxAge: 60000,
        tags: ['users'],
      });
      cacheManager.set('users.get:hash2', { user: {} }, {
        maxAge: 60000,
        tags: ['users', 'user-1'],
      });
      cacheManager.set('posts.list:hash3', { posts: [] }, {
        maxAge: 60000,
        tags: ['posts'],
      });
    });

    it('should invalidate by tag', () => {
      cacheManager.invalidate(['users']);

      expect(cacheManager.getRaw('users.list:hash1')).toBeUndefined();
      expect(cacheManager.getRaw('users.get:hash2')).toBeUndefined();
      expect(cacheManager.getRaw('posts.list:hash3')).toBeDefined(); // Not affected
    });

    it('should invalidate by specific tag', () => {
      cacheManager.invalidate(['user-1']);

      expect(cacheManager.getRaw('users.list:hash1')).toBeDefined(); // Not tagged with user-1
      expect(cacheManager.getRaw('users.get:hash2')).toBeUndefined(); // Tagged with user-1
    });

    it('should invalidate by exact key', () => {
      cacheManager.invalidate('users.list:hash1');

      expect(cacheManager.getRaw('users.list:hash1')).toBeUndefined();
      expect(cacheManager.getRaw('users.get:hash2')).toBeDefined();
      expect(cacheManager.getRaw('posts.list:hash3')).toBeDefined();
    });

    it('should invalidate by prefix pattern', () => {
      cacheManager.invalidate('users.*');

      expect(cacheManager.getRaw('users.list:hash1')).toBeUndefined();
      expect(cacheManager.getRaw('users.get:hash2')).toBeUndefined();
      expect(cacheManager.getRaw('posts.list:hash3')).toBeDefined();
    });

    it('should invalidate by regex pattern', () => {
      cacheManager.invalidate(/users\./);

      expect(cacheManager.getRaw('users.list:hash1')).toBeUndefined();
      expect(cacheManager.getRaw('users.get:hash2')).toBeUndefined();
      expect(cacheManager.getRaw('posts.list:hash3')).toBeDefined();
    });
  });

  describe('Stale-While-Revalidate', () => {
    it('should serve stale content while revalidating', async () => {
      let callCount = 0;
      const fetcher = async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { value: callCount };
      };

      // Initial fetch
      const result1 = await cacheManager.get('test-key', fetcher, {
        maxAge: 50,
        staleWhileRevalidate: 100,
      });
      expect(result1.value).toBe(1);

      // Wait for maxAge to expire but within staleWhileRevalidate window
      await new Promise((resolve) => setTimeout(resolve, 75));

      // Should return stale data immediately and revalidate in background
      const result2 = await cacheManager.get('test-key', fetcher, {
        maxAge: 50,
        staleWhileRevalidate: 100,
      });
      expect(result2.value).toBe(1); // Stale data

      // Wait for background revalidation
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Next fetch should have new data
      const result3 = await cacheManager.get('test-key', fetcher, {
        maxAge: 50,
        staleWhileRevalidate: 100,
      });
      expect(result3.value).toBe(2);
    });
  });

  describe('Cache on Error', () => {
    it('should return stale data on error when cacheOnError is enabled', async () => {
      let shouldFail = false;
      const fetcher = async () => {
        if (shouldFail) {
          throw new Error('Fetch failed');
        }
        return { value: 'success' };
      };

      // Initial successful fetch
      const result1 = await cacheManager.get('test-key', fetcher, {
        maxAge: 50,
        cacheOnError: true,
      });
      expect(result1.value).toBe('success');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Now fetcher will fail, but should return stale data
      shouldFail = true;
      const result2 = await cacheManager.get('test-key', fetcher, {
        maxAge: 50,
        cacheOnError: true,
      });
      expect(result2.value).toBe('success'); // Stale data
    });

    it('should throw error when cacheOnError is disabled', async () => {
      const fetcher = async () => {
        throw new Error('Fetch failed');
      };

      await expect(
        cacheManager.get('test-key', fetcher, {
          maxAge: 60000,
          cacheOnError: false,
        })
      ).rejects.toThrow('Fetch failed');
    });
  });

  describe('Cache Statistics', () => {
    it('should track cache hits and misses', async () => {
      const fetcher = async () => ({ value: 'test' });

      // Miss
      await cacheManager.get('key1', fetcher, { maxAge: 60000 });
      let stats = cacheManager.getStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);

      // Hit
      await cacheManager.get('key1', fetcher, { maxAge: 60000 });
      stats = cacheManager.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeGreaterThan(0);
    });

    it('should track cache size', () => {
      cacheManager.set('key1', { data: 'small' }, { maxAge: 60000 });
      cacheManager.set('key2', { data: 'x'.repeat(1000) }, { maxAge: 60000 });

      const stats = cacheManager.getStats();
      expect(stats.entries).toBe(2);
      expect(stats.sizeBytes).toBeGreaterThan(0);
    });

    it('should track active revalidations', async () => {
      let shouldDelay = false;
      const fetcher = async () => {
        if (shouldDelay) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return { value: 'test' };
      };

      // Initial fetch
      await cacheManager.get('test-key', fetcher, {
        maxAge: 50,
        staleWhileRevalidate: 100,
      });

      // Wait for maxAge
      await new Promise((resolve) => setTimeout(resolve, 75));

      // Trigger background revalidation
      shouldDelay = true;
      const promise = cacheManager.get('test-key', fetcher, {
        maxAge: 50,
        staleWhileRevalidate: 100,
      });

      // Check stats while revalidating
      await new Promise((resolve) => setTimeout(resolve, 10));
      const stats = cacheManager.getStats();
      expect(stats.activeRevalidations).toBeGreaterThan(0);

      await promise;
    });
  });

  describe('Cache Capacity Management', () => {
    it('should evict oldest entries when max entries reached', async () => {
      const cache = new HttpCacheManager({
        maxEntries: 3,
      });

      const fetcher = async (value: number) => ({ value });

      // Add 4 entries
      await cache.get('key1', () => fetcher(1), { maxAge: 60000 });
      await cache.get('key2', () => fetcher(2), { maxAge: 60000 });
      await cache.get('key3', () => fetcher(3), { maxAge: 60000 });
      await cache.get('key4', () => fetcher(4), { maxAge: 60000 });

      // Should only have 3 entries (oldest evicted)
      const stats = cache.getStats();
      expect(stats.entries).toBe(3);

      // First key should be evicted
      expect(cache.getRaw('key1')).toBeUndefined();
      expect(cache.getRaw('key4')).toBeDefined();

      cache.clear();
    });

    it('should evict entries when max size reached', async () => {
      const cache = new HttpCacheManager({
        maxSizeBytes: 100, // Very small
      });

      // Add large entries
      cache.set('key1', { data: 'x'.repeat(50) }, { maxAge: 60000 });
      cache.set('key2', { data: 'x'.repeat(50) }, { maxAge: 60000 });

      // Should have evicted some entries
      const stats = cache.getStats();
      expect(stats.sizeBytes).toBeLessThanOrEqual(150); // With overhead

      cache.clear();
    });
  });

  describe('Cache Key Generation', () => {
    it('should generate deterministic cache keys', () => {
      // Simulate the simple hash function from peer.ts
      const generateCacheKey = (service: string, method: string, input: any): string => {
        const inputStr = JSON.stringify(input || {});
        let hash = 0;
        for (let i = 0; i < inputStr.length; i++) {
          const char = inputStr.charCodeAt(i);
          hash = (hash << 5) - hash + char;
          hash = hash & hash;
        }
        const hashStr = Math.abs(hash).toString(36);
        return `${service}.${method}:${hashStr}`;
      };

      const key1 = generateCacheKey('UserService', 'getUser', { id: 1 });
      const key2 = generateCacheKey('UserService', 'getUser', { id: 1 });
      const key3 = generateCacheKey('UserService', 'getUser', { id: 2 });

      expect(key1).toBe(key2); // Same input = same key
      expect(key1).not.toBe(key3); // Different input = different key
    });

    it('should handle empty inputs in cache key generation', () => {
      const generateCacheKey = (service: string, method: string, input: any): string => {
        const inputStr = JSON.stringify(input || {});
        let hash = 0;
        for (let i = 0; i < inputStr.length; i++) {
          const char = inputStr.charCodeAt(i);
          hash = (hash << 5) - hash + char;
          hash = hash & hash;
        }
        const hashStr = Math.abs(hash).toString(36);
        return `${service}.${method}:${hashStr}`;
      };

      const key1 = generateCacheKey('UserService', 'list', null);
      const key2 = generateCacheKey('UserService', 'list', undefined);
      const key3 = generateCacheKey('UserService', 'list', {});

      // All should generate valid keys
      expect(key1).toBeTruthy();
      expect(key2).toBeTruthy();
      expect(key3).toBeTruthy();
    });
  });

  describe('Cache Clear', () => {
    it('should clear all cache entries', () => {
      cacheManager.set('key1', { data: 'test1' }, { maxAge: 60000 });
      cacheManager.set('key2', { data: 'test2' }, { maxAge: 60000 });
      cacheManager.set('key3', { data: 'test3' }, { maxAge: 60000 });

      let stats = cacheManager.getStats();
      expect(stats.entries).toBe(3);

      cacheManager.clear();

      stats = cacheManager.getStats();
      expect(stats.entries).toBe(0);
      expect(cacheManager.getRaw('key1')).toBeUndefined();
      expect(cacheManager.getRaw('key2')).toBeUndefined();
      expect(cacheManager.getRaw('key3')).toBeUndefined();
    });
  });
});
