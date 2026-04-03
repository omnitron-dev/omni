/**
 * LRU Cache Unit Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LRUCache, DEFAULT_LRU_CACHE_OPTIONS } from '../../src/utils/lru-cache.js';

describe('LRUCache', () => {
  let cache: LRUCache<string, number>;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new LRUCache<string, number>({
      maxSize: 3,
      ttl: 5000,
      cleanupInterval: 1000,
    });
  });

  afterEach(() => {
    cache.dispose();
    vi.useRealTimers();
  });

  describe('basic operations', () => {
    it('should set and get values', () => {
      cache.set('key1', 100);
      expect(cache.get('key1')).toBe(100);
    });

    it('should return undefined for missing keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should check if key exists', () => {
      cache.set('key1', 100);
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should delete values', () => {
      cache.set('key1', 100);
      expect(cache.delete('key1')).toBe(true);
      expect(cache.has('key1')).toBe(false);
    });

    it('should clear all values', () => {
      cache.set('key1', 100);
      cache.set('key2', 200);
      cache.clear();
      expect(cache.size).toBe(0);
    });

    it('should track size correctly', () => {
      expect(cache.size).toBe(0);
      cache.set('key1', 100);
      expect(cache.size).toBe(1);
      cache.set('key2', 200);
      expect(cache.size).toBe(2);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used when full', () => {
      cache.set('key1', 1);
      cache.set('key2', 2);
      cache.set('key3', 3);
      // Cache is now full (maxSize = 3)
      cache.set('key4', 4); // This should evict key1

      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(true);
      expect(cache.has('key3')).toBe(true);
      expect(cache.has('key4')).toBe(true);
    });

    it('should promote accessed items', () => {
      cache.set('key1', 1);
      cache.set('key2', 2);
      cache.set('key3', 3);

      // Access key1 to promote it to most recently used
      cache.get('key1');

      // Add new item, should evict key2 (now least recently used)
      cache.set('key4', 4);

      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(false);
      expect(cache.has('key3')).toBe(true);
      expect(cache.has('key4')).toBe(true);
    });

    it('should update existing keys without eviction', () => {
      cache.set('key1', 1);
      cache.set('key2', 2);
      cache.set('key3', 3);
      cache.set('key1', 100); // Update existing

      expect(cache.size).toBe(3);
      expect(cache.get('key1')).toBe(100);
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      // Create a cache with short TTL for testing
      vi.useRealTimers(); // Use real timers for this test
      const shortCache = new LRUCache<string, number>({ maxSize: 10, ttl: 50, cleanupInterval: 20 });

      shortCache.set('key1', 100);
      expect(shortCache.get('key1')).toBe(100);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(shortCache.get('key1')).toBeUndefined();
      shortCache.dispose();
      vi.useFakeTimers();
    });

    it('should not expire fresh entries', async () => {
      vi.useRealTimers();
      const shortCache = new LRUCache<string, number>({ maxSize: 10, ttl: 100, cleanupInterval: 50 });

      shortCache.set('key1', 100);

      // Wait less than TTL
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(shortCache.get('key1')).toBe(100);
      shortCache.dispose();
      vi.useFakeTimers();
    });

    it('should cleanup expired entries', async () => {
      vi.useRealTimers();
      const shortCache = new LRUCache<string, number>({ maxSize: 10, ttl: 20, cleanupInterval: 5 });

      shortCache.set('key1', 100);
      shortCache.set('key2', 200);

      // Wait for entries to expire - wait longer than TTL
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Trigger cleanup
      const removed = shortCache.cleanupExpired();
      expect(removed).toBeGreaterThanOrEqual(0); // May have been auto-cleaned
      expect(shortCache.size).toBe(0);
      shortCache.dispose();
      vi.useFakeTimers();
    });
  });

  describe('statistics', () => {
    it('should track hits and misses', () => {
      cache.set('key1', 100);

      cache.get('key1'); // hit
      cache.get('key1'); // hit
      cache.get('nonexistent'); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(66.67, 1);
    });

    it('should track evictions', () => {
      cache.set('key1', 1);
      cache.set('key2', 2);
      cache.set('key3', 3);
      cache.set('key4', 4); // Evicts key1

      const stats = cache.getStats();
      expect(stats.sizeEvictions).toBe(1);
    });

    it('should reset statistics', () => {
      cache.set('key1', 100);
      cache.get('key1');
      cache.get('nonexistent');

      cache.resetStats();
      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('iteration', () => {
    it('should iterate over keys', () => {
      cache.set('key1', 1);
      cache.set('key2', 2);

      const keys = Array.from(cache.keys());
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
    });

    it('should iterate over values', () => {
      cache.set('key1', 1);
      cache.set('key2', 2);

      const values = Array.from(cache.values());
      expect(values).toContain(1);
      expect(values).toContain(2);
    });

    it('should iterate over entries', () => {
      cache.set('key1', 1);
      cache.set('key2', 2);

      const entries = Array.from(cache.entries());
      expect(entries).toContainEqual(['key1', 1]);
      expect(entries).toContainEqual(['key2', 2]);
    });

    it('should support forEach', () => {
      cache.set('key1', 1);
      cache.set('key2', 2);

      const collected: [string, number][] = [];
      cache.forEach((value, key) => {
        collected.push([key, value]);
      });

      expect(collected).toHaveLength(2);
    });
  });

  describe('eviction callback', () => {
    it('should call onEvict when entry is evicted', () => {
      const onEvict = vi.fn();
      const callbackCache = new LRUCache<string, number>({
        maxSize: 2,
        onEvict,
      });

      callbackCache.set('key1', 1);
      callbackCache.set('key2', 2);
      callbackCache.set('key3', 3); // Evicts key1

      expect(onEvict).toHaveBeenCalledWith('key1', 1, 'size');

      callbackCache.dispose();
    });

    it('should call onEvict on manual delete', () => {
      const onEvict = vi.fn();
      const callbackCache = new LRUCache<string, number>({
        maxSize: 10,
        onEvict,
      });

      callbackCache.set('key1', 1);
      callbackCache.delete('key1');

      expect(onEvict).toHaveBeenCalledWith('key1', 1, 'manual');

      callbackCache.dispose();
    });
  });

  describe('default options', () => {
    it('should use default options', () => {
      expect(DEFAULT_LRU_CACHE_OPTIONS.maxSize).toBe(500);
      expect(DEFAULT_LRU_CACHE_OPTIONS.ttl).toBe(5 * 60 * 1000);
      expect(DEFAULT_LRU_CACHE_OPTIONS.cleanupInterval).toBe(60 * 1000);
    });
  });
});
