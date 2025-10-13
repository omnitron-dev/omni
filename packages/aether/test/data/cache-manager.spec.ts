/**
 * Cache Manager Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getCacheManager,
  createCacheManager,
  resetCacheManager,
  generateCacheKey,
  invalidateByPrefix,
  invalidateCache,
  getCacheStats,
} from '../../src/data/cache-manager.js';

describe('CacheManager', () => {
  beforeEach(() => {
    resetCacheManager();
  });

  afterEach(() => {
    resetCacheManager();
  });

  describe('Basic Operations', () => {
    it('should get and set values', () => {
      const cache = getCacheManager();

      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for non-existent keys', () => {
      const cache = getCacheManager();

      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should check if key exists', () => {
      const cache = getCacheManager();

      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(false);
    });

    it('should delete values', () => {
      const cache = getCacheManager();

      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);

      const deleted = cache.delete('key1');
      expect(deleted).toBe(true);
      expect(cache.has('key1')).toBe(false);
    });

    it('should clear all values', () => {
      const cache = getCacheManager();

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      cache.clear();

      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(false);
      expect(cache.has('key3')).toBe(false);
    });
  });

  describe('TTL Support', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should expire entries after TTL', () => {
      const cache = getCacheManager();

      cache.set('key1', 'value1', 1000);
      expect(cache.get('key1')).toBe('value1');

      vi.advanceTimersByTime(1500);

      expect(cache.get('key1')).toBeUndefined();
      expect(cache.has('key1')).toBe(false);
    });

    it('should not expire entries with infinite TTL', () => {
      const cache = getCacheManager();

      cache.set('key1', 'value1', Infinity);
      expect(cache.get('key1')).toBe('value1');

      vi.advanceTimersByTime(999999999);

      expect(cache.get('key1')).toBe('value1');
    });

    it('should handle default infinite TTL', () => {
      const cache = getCacheManager();

      cache.set('key1', 'value1');

      vi.advanceTimersByTime(999999999);

      expect(cache.get('key1')).toBe('value1');
    });
  });

  describe('LRU Eviction', () => {
    it('should evict least recently used entry when at max size', () => {
      const cache = createCacheManager(3);

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // All entries should exist
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(true);
      expect(cache.has('key3')).toBe(true);

      // Add fourth entry, should evict key1 (least recently used)
      cache.set('key4', 'value4');

      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(true);
      expect(cache.has('key3')).toBe(true);
      expect(cache.has('key4')).toBe(true);
    });

    it('should update access order on get', () => {
      const cache = createCacheManager(3);

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Access key1 to make it most recently used
      cache.get('key1');

      // Add fourth entry, should evict key2 (now least recently used)
      cache.set('key4', 'value4');

      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(false);
      expect(cache.has('key3')).toBe(true);
      expect(cache.has('key4')).toBe(true);
    });

    it('should not evict when updating existing key', () => {
      const cache = createCacheManager(3);

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Update existing key
      cache.set('key2', 'value2-updated');

      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(true);
      expect(cache.has('key3')).toBe(true);
      expect(cache.get('key2')).toBe('value2-updated');
    });
  });

  describe('Pattern-based Invalidation', () => {
    it('should invalidate by exact string match', () => {
      const cache = getCacheManager();

      cache.set('user:1', 'user1');
      cache.set('user:2', 'user2');
      cache.set('post:1', 'post1');

      const count = cache.invalidate('user:1');

      expect(count).toBe(1);
      expect(cache.has('user:1')).toBe(false);
      expect(cache.has('user:2')).toBe(true);
      expect(cache.has('post:1')).toBe(true);
    });

    it('should invalidate by regex pattern', () => {
      const cache = getCacheManager();

      cache.set('user:1', 'user1');
      cache.set('user:2', 'user2');
      cache.set('post:1', 'post1');

      const count = cache.invalidate(/^user:/);

      expect(count).toBe(2);
      expect(cache.has('user:1')).toBe(false);
      expect(cache.has('user:2')).toBe(false);
      expect(cache.has('post:1')).toBe(true);
    });

    it('should invalidate by function predicate', () => {
      const cache = getCacheManager();

      cache.set('user:1', 'user1');
      cache.set('user:2', 'user2');
      cache.set('post:1', 'post1');

      const count = cache.invalidate((key) => key.includes('user'));

      expect(count).toBe(2);
      expect(cache.has('user:1')).toBe(false);
      expect(cache.has('user:2')).toBe(false);
      expect(cache.has('post:1')).toBe(true);
    });
  });

  describe('Revalidation Support', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should mark entry as revalidating', () => {
      const cache = getCacheManager();

      cache.set('key1', 'value1');
      cache.setRevalidating('key1', true);

      // Internal state - can't directly access revalidating flag
      // but we can verify it doesn't affect get/has
      expect(cache.has('key1')).toBe(true);
      expect(cache.get('key1')).toBe('value1');
    });

    it('should check if entry is stale', () => {
      const cache = getCacheManager();

      cache.set('key1', 'value1');

      expect(cache.isStale('key1', 0)).toBe(false);

      vi.advanceTimersByTime(1000);

      expect(cache.isStale('key1', 500)).toBe(true);
      expect(cache.isStale('key1', 2000)).toBe(false);
    });

    it('should return true for non-existent keys', () => {
      const cache = getCacheManager();

      expect(cache.isStale('nonexistent', 1000)).toBe(true);
    });
  });

  describe('Cache Statistics', () => {
    it('should track hits and misses', () => {
      const cache = getCacheManager();

      cache.set('key1', 'value1');

      // Hit
      cache.get('key1');

      // Miss
      cache.get('key2');

      // Another hit
      cache.get('key1');

      const stats = cache.getStats();

      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3);
    });

    it('should track cache size', () => {
      const cache = createCacheManager(10);

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      const stats = cache.getStats();

      expect(stats.size).toBe(3);
      expect(stats.maxSize).toBe(10);
    });

    it('should reset stats on clear', () => {
      const cache = getCacheManager();

      cache.set('key1', 'value1');
      cache.get('key1');
      cache.get('key2');

      cache.clear();

      const stats = cache.getStats();

      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.size).toBe(0);
    });
  });

  describe('Helper Functions', () => {
    it('should generate cache key from name and args', () => {
      const key1 = generateCacheKey('fetchUser', [1]);
      const key2 = generateCacheKey('fetchUser', [2]);
      const key3 = generateCacheKey('fetchUser', [1]);

      expect(key1).toBe('fetchUser:[1]');
      expect(key2).toBe('fetchUser:[2]');
      expect(key1).toBe(key3);
    });

    it('should handle empty args', () => {
      const key = generateCacheKey('fetchData', []);

      expect(key).toBe('fetchData');
    });

    it('should handle non-serializable args', () => {
      const circular: any = { a: 1 };
      circular.self = circular;

      const key = generateCacheKey('fn', [circular]);

      expect(key).toContain('fn:');
      expect(typeof key).toBe('string');
    });

    it('should invalidate by prefix', () => {
      const cache = getCacheManager();

      cache.set('user:1', 'user1');
      cache.set('user:2', 'user2');
      cache.set('post:1', 'post1');

      const count = invalidateByPrefix('user:');

      expect(count).toBe(2);
      expect(cache.has('user:1')).toBe(false);
      expect(cache.has('user:2')).toBe(false);
      expect(cache.has('post:1')).toBe(true);
    });

    it('should invalidate all when no pattern provided', () => {
      const cache = getCacheManager();

      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      invalidateCache();

      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(false);
    });

    it('should get global cache stats', () => {
      const cache = getCacheManager();

      cache.set('key1', 'value1');
      cache.get('key1');

      const stats = getCacheStats();

      expect(stats.hits).toBe(1);
      expect(stats.size).toBe(1);
    });
  });

  describe('Singleton Behavior', () => {
    it('should return same instance from getCacheManager', () => {
      const cache1 = getCacheManager();
      const cache2 = getCacheManager();

      cache1.set('key1', 'value1');

      expect(cache2.get('key1')).toBe('value1');
    });

    it('should create independent instances with createCacheManager', () => {
      const cache1 = createCacheManager();
      const cache2 = createCacheManager();

      cache1.set('key1', 'value1');

      expect(cache2.get('key1')).toBeUndefined();
    });

    it('should reset global instance', () => {
      const cache1 = getCacheManager();
      cache1.set('key1', 'value1');

      resetCacheManager();

      const cache2 = getCacheManager();
      expect(cache2.get('key1')).toBeUndefined();
    });
  });
});
