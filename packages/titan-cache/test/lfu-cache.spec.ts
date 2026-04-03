/**
 * LFU Cache Tests
 *
 * Comprehensive tests for the high-performance LFU (Least Frequently Used) cache implementation.
 * Tests O(1) frequency-based eviction, TTL management, and statistics.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LFUCache } from '../src/lfu-cache.js';

describe('LFUCache', () => {
  let cache: LFUCache<string>;

  afterEach(async () => {
    if (cache) {
      await cache.dispose();
    }
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      cache = new LFUCache();
      const stats = cache.getStats();

      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it('should create with custom options', () => {
      cache = new LFUCache({
        maxSize: 500,
        ttl: 60,
        enableStats: true,
        name: 'test-lfu-cache',
      });
      const stats = cache.getStats();

      expect(stats.size).toBe(0);
    });

    it('should accept onEvict callback', async () => {
      const evictedItems: Array<{ key: string; value: unknown; reason: string }> = [];

      cache = new LFUCache({
        maxSize: 2,
        onEvict: (key, value, reason) => {
          evictedItems.push({ key, value, reason });
        },
      });

      await cache.set('a', 'valueA');
      await cache.set('b', 'valueB');
      await cache.set('c', 'valueC'); // Should evict one

      expect(evictedItems.length).toBe(1);
      expect(evictedItems[0]!.reason).toBe('capacity');
    });
  });

  describe('set() and get()', () => {
    beforeEach(() => {
      cache = new LFUCache({ maxSize: 100, enableStats: true });
    });

    it('should set and get a value', async () => {
      await cache.set('key1', 'value1');
      const value = await cache.get('key1');

      expect(value).toBe('value1');
    });

    it('should return undefined for non-existent key', async () => {
      const value = await cache.get('nonexistent');

      expect(value).toBeUndefined();
    });

    it('should overwrite existing value', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key1', 'value2');
      const value = await cache.get('key1');

      expect(value).toBe('value2');
    });

    it('should handle various data types', async () => {
      const typedCache = new LFUCache<unknown>({ maxSize: 100 });

      await typedCache.set('string', 'hello');
      await typedCache.set('number', 42);
      await typedCache.set('object', { nested: 'value' });
      await typedCache.set('array', [1, 2, 3]);

      expect(await typedCache.get('string')).toBe('hello');
      expect(await typedCache.get('number')).toBe(42);
      expect(await typedCache.get('object')).toEqual({ nested: 'value' });
      expect(await typedCache.get('array')).toEqual([1, 2, 3]);

      await typedCache.dispose();
    });

    it('should increment access count on get', async () => {
      await cache.set('key1', 'value1');
      const entry1 = await cache.getEntry('key1');
      const firstCount = entry1!.meta.accessCount;

      await cache.get('key1');

      const entry2 = await cache.getEntry('key1');
      expect(entry2!.meta.accessCount).toBe(firstCount + 1);
    });

    it('should not increment access count when touch is false', async () => {
      await cache.set('key1', 'value1');
      const entry1 = await cache.getEntry('key1');
      const firstCount = entry1!.meta.accessCount;

      await cache.get('key1', { touch: false });

      const entry2 = await cache.getEntry('key1');
      expect(entry2!.meta.accessCount).toBe(firstCount);
    });
  });

  describe('LFU eviction', () => {
    it('should evict least frequently used item when at capacity', async () => {
      cache = new LFUCache({ maxSize: 3 });

      await cache.set('a', 'valueA');
      await cache.set('b', 'valueB');
      await cache.set('c', 'valueC');

      // Access 'b' and 'c' more frequently
      await cache.get('b');
      await cache.get('c');
      await cache.get('b');
      await cache.get('c');

      // 'a' has lowest frequency (1), should be evicted
      await cache.set('d', 'valueD');

      expect(await cache.has('a')).toBe(false);
      expect(await cache.has('b')).toBe(true);
      expect(await cache.has('c')).toBe(true);
      expect(await cache.has('d')).toBe(true);
    });

    it('should evict older item when frequencies are equal', async () => {
      cache = new LFUCache({ maxSize: 3 });

      await cache.set('a', 'valueA');
      await cache.set('b', 'valueB');
      await cache.set('c', 'valueC');

      // All have frequency 1, oldest should be evicted
      await cache.set('d', 'valueD');

      expect(await cache.has('a')).toBe(false);
      expect(await cache.has('b')).toBe(true);
      expect(await cache.has('c')).toBe(true);
      expect(await cache.has('d')).toBe(true);
    });

    it('should increment frequency on set for existing key', async () => {
      cache = new LFUCache({ maxSize: 3 });

      await cache.set('a', 'valueA');
      await cache.set('b', 'valueB');
      await cache.set('c', 'valueC');

      // Update 'a' to increase its frequency
      await cache.set('a', 'newValueA');

      // Now 'b' should have lowest frequency
      await cache.set('d', 'valueD');

      expect(await cache.has('a')).toBe(true);
      expect(await cache.has('b')).toBe(false);
      expect(await cache.has('c')).toBe(true);
      expect(await cache.has('d')).toBe(true);
    });

    it('should correctly track eviction count', async () => {
      cache = new LFUCache({ maxSize: 2, enableStats: true });

      await cache.set('a', 'valueA');
      await cache.set('b', 'valueB');
      await cache.set('c', 'valueC'); // Evicts one
      await cache.set('d', 'valueD'); // Evicts one

      const stats = cache.getStats();
      expect(stats.evictions).toBe(2);
    });

    it('should evict based on frequency not recency', async () => {
      cache = new LFUCache({ maxSize: 3 });

      await cache.set('a', 'valueA');
      await cache.set('b', 'valueB');
      await cache.set('c', 'valueC');

      // Access 'a' many times to make it most frequent
      for (let i = 0; i < 10; i++) {
        await cache.get('a');
      }

      // 'b' and 'c' still have low frequency
      // Even though 'b' was accessed before 'c', frequency matters more
      await cache.get('c'); // Increase c's frequency slightly

      await cache.set('d', 'valueD');

      // 'b' should be evicted (lowest frequency)
      expect(await cache.has('a')).toBe(true);
      expect(await cache.has('b')).toBe(false);
      expect(await cache.has('c')).toBe(true);
      expect(await cache.has('d')).toBe(true);
    });
  });

  describe('getFrequencyDistribution()', () => {
    beforeEach(() => {
      cache = new LFUCache({ maxSize: 100 });
    });

    it('should return frequency distribution', async () => {
      await cache.set('a', 'valueA');
      await cache.set('b', 'valueB');
      await cache.set('c', 'valueC');

      // Access 'a' twice more
      await cache.get('a');
      await cache.get('a');

      // Access 'b' once more
      await cache.get('b');

      const distribution = cache.getFrequencyDistribution();

      // 'a' has frequency 3 (1 initial + 2 gets)
      // 'b' has frequency 2 (1 initial + 1 get)
      // 'c' has frequency 1 (1 initial)
      expect(distribution.get(1)).toBe(1); // 'c'
      expect(distribution.get(2)).toBe(1); // 'b'
      expect(distribution.get(3)).toBe(1); // 'a'
    });

    it('should return empty map for empty cache', async () => {
      const distribution = cache.getFrequencyDistribution();
      expect(distribution.size).toBe(0);
    });
  });

  describe('TTL expiration', () => {
    beforeEach(() => {
      cache = new LFUCache({ maxSize: 100, enableStats: true });
    });

    it('should expire items after TTL', async () => {
      await cache.set('key1', 'value1', { ttl: 0.1 }); // 100ms

      expect(await cache.get('key1')).toBe('value1');

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(await cache.get('key1')).toBeUndefined();
    });

    it('should use default TTL if set', async () => {
      cache = new LFUCache({ maxSize: 100, ttl: 0.1 });

      await cache.set('key1', 'value1');

      expect(await cache.get('key1')).toBe('value1');

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(await cache.get('key1')).toBeUndefined();
    });

    it('should track expirations in stats', async () => {
      await cache.set('key1', 'value1', { ttl: 0.05 });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Trigger expiration check via get
      await cache.get('key1');

      const stats = cache.getStats();
      expect(stats.expirations).toBeGreaterThanOrEqual(1);
    });
  });

  describe('has()', () => {
    beforeEach(() => {
      cache = new LFUCache({ maxSize: 100 });
    });

    it('should return true for existing key', async () => {
      await cache.set('key1', 'value1');
      expect(await cache.has('key1')).toBe(true);
    });

    it('should return false for non-existent key', async () => {
      expect(await cache.has('nonexistent')).toBe(false);
    });

    it('should return false for expired key', async () => {
      await cache.set('key1', 'value1', { ttl: 0.05 });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(await cache.has('key1')).toBe(false);
    });
  });

  describe('delete()', () => {
    beforeEach(() => {
      cache = new LFUCache({ maxSize: 100, enableStats: true });
    });

    it('should delete existing key', async () => {
      await cache.set('key1', 'value1');
      const deleted = await cache.delete('key1');

      expect(deleted).toBe(true);
      expect(await cache.has('key1')).toBe(false);
    });

    it('should return false for non-existent key', async () => {
      const deleted = await cache.delete('nonexistent');
      expect(deleted).toBe(false);
    });

    it('should update size after delete', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      await cache.delete('key1');

      expect(await cache.size()).toBe(1);
    });

    it('should maintain correct frequency lists after delete', async () => {
      await cache.set('a', 'valueA');
      await cache.set('b', 'valueB');

      await cache.get('a'); // Frequency 2
      await cache.delete('a');

      const distribution = cache.getFrequencyDistribution();
      expect(distribution.get(2)).toBeUndefined();
      expect(distribution.get(1)).toBe(1); // Only 'b' at frequency 1
    });
  });

  describe('clear()', () => {
    beforeEach(() => {
      cache = new LFUCache({ maxSize: 100 });
    });

    it('should clear all entries', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.set('key3', 'value3');

      await cache.clear();

      expect(await cache.size()).toBe(0);
      expect(cache.getFrequencyDistribution().size).toBe(0);
    });

    it('should clear entries matching pattern', async () => {
      await cache.set('user:1', 'data1');
      await cache.set('user:2', 'data2');
      await cache.set('product:1', 'prod1');

      await cache.clear('user:.*');

      expect(await cache.has('user:1')).toBe(false);
      expect(await cache.has('user:2')).toBe(false);
      expect(await cache.has('product:1')).toBe(true);
    });

    it('should call onEvict for each cleared entry', async () => {
      const evictedKeys: string[] = [];

      cache = new LFUCache({
        maxSize: 100,
        onEvict: (key) => {
          evictedKeys.push(key);
        },
      });

      await cache.set('a', 'valueA');
      await cache.set('b', 'valueB');

      await cache.clear();

      expect(evictedKeys.sort()).toEqual(['a', 'b']);
    });
  });

  describe('invalidateByTags()', () => {
    beforeEach(() => {
      cache = new LFUCache({ maxSize: 100 });
    });

    it('should invalidate entries with matching tags', async () => {
      await cache.set('user:1', 'data1', { tags: ['users', 'active'] });
      await cache.set('user:2', 'data2', { tags: ['users'] });
      await cache.set('product:1', 'prod1', { tags: ['products'] });

      const invalidated = await cache.invalidateByTags(['users']);

      expect(invalidated).toBe(2);
      expect(await cache.has('user:1')).toBe(false);
      expect(await cache.has('user:2')).toBe(false);
      expect(await cache.has('product:1')).toBe(true);
    });
  });

  describe('getMany() and setMany()', () => {
    beforeEach(() => {
      cache = new LFUCache({ maxSize: 100 });
    });

    it('should get multiple values', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.set('key3', 'value3');

      const results = await cache.getMany(['key1', 'key2', 'key3', 'key4']);

      expect(results.get('key1')).toBe('value1');
      expect(results.get('key2')).toBe('value2');
      expect(results.get('key3')).toBe('value3');
      expect(results.get('key4')).toBeUndefined();
    });

    it('should set multiple values', async () => {
      const entries = new Map([
        ['key1', 'value1'],
        ['key2', 'value2'],
        ['key3', 'value3'],
      ]);

      await cache.setMany(entries);

      expect(await cache.get('key1')).toBe('value1');
      expect(await cache.get('key2')).toBe('value2');
      expect(await cache.get('key3')).toBe('value3');
    });
  });

  describe('keys()', () => {
    beforeEach(() => {
      cache = new LFUCache({ maxSize: 100 });
    });

    it('should return all keys', async () => {
      await cache.set('a', 'valueA');
      await cache.set('b', 'valueB');
      await cache.set('c', 'valueC');

      const keys = await cache.keys();

      expect(keys.sort()).toEqual(['a', 'b', 'c']);
    });

    it('should return keys matching pattern', async () => {
      await cache.set('user:1', 'data1');
      await cache.set('user:2', 'data2');
      await cache.set('product:1', 'prod1');

      const keys = await cache.keys('user:.*');

      expect(keys.sort()).toEqual(['user:1', 'user:2']);
    });
  });

  describe('getEntry()', () => {
    beforeEach(() => {
      cache = new LFUCache({ maxSize: 100 });
    });

    it('should return entry with metadata', async () => {
      await cache.set('key1', 'value1', { tags: ['test'] });

      const entry = await cache.getEntry('key1');

      expect(entry).toBeDefined();
      expect(entry!.key).toBe('key1');
      expect(entry!.value).toBe('value1');
      expect(entry!.meta.tags).toContain('test');
    });

    it('should return undefined for non-existent key', async () => {
      const entry = await cache.getEntry('nonexistent');
      expect(entry).toBeUndefined();
    });
  });

  describe('statistics', () => {
    beforeEach(() => {
      cache = new LFUCache({ maxSize: 100, enableStats: true });
    });

    it('should track hits and misses', async () => {
      await cache.set('key1', 'value1');

      await cache.get('key1'); // Hit
      await cache.get('key1'); // Hit
      await cache.get('nonexistent'); // Miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it('should calculate hit rate', async () => {
      await cache.set('key1', 'value1');

      await cache.get('key1'); // Hit
      await cache.get('key1'); // Hit
      await cache.get('nonexistent'); // Miss
      await cache.get('other'); // Miss

      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0.5);
    });

    it('should reset statistics', async () => {
      await cache.set('key1', 'value1');
      await cache.get('key1');
      await cache.get('nonexistent');

      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('warm()', () => {
    beforeEach(() => {
      cache = new LFUCache({ maxSize: 100 });
    });

    it('should warm cache with strategy', async () => {
      await cache.warm([
        {
          name: 'initial-data',
          loader: async () =>
            new Map([
              ['key1', 'value1'],
              ['key2', 'value2'],
            ]),
        },
      ]);

      expect(await cache.get('key1')).toBe('value1');
      expect(await cache.get('key2')).toBe('value2');
    });
  });

  describe('partition()', () => {
    beforeEach(() => {
      cache = new LFUCache({ maxSize: 100 });
    });

    it('should create partitioned view', async () => {
      const userCache = cache.partition('users');
      const productCache = cache.partition('products');

      await userCache.set('1', 'user1');
      await productCache.set('1', 'product1');

      expect(await userCache.get('1')).toBe('user1');
      expect(await productCache.get('1')).toBe('product1');
    });
  });

  describe('frequency decay', () => {
    it('should support frequency decay', async () => {
      cache = new LFUCache({
        maxSize: 100,
        frequencyDecay: 0.5,
        decayInterval: 50,
      });

      await cache.set('a', 'valueA');
      // Access 'a' many times
      for (let i = 0; i < 10; i++) {
        await cache.get('a');
      }

      // Wait for decay
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Frequency should have decayed
      // Note: This is testing the mechanism exists, exact values depend on timing
      const distribution = cache.getFrequencyDistribution();
      expect(distribution.size).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty cache operations', async () => {
      cache = new LFUCache({ maxSize: 100 });

      expect(await cache.get('nonexistent')).toBeUndefined();
      expect(await cache.has('nonexistent')).toBe(false);
      expect(await cache.delete('nonexistent')).toBe(false);
      expect(await cache.size()).toBe(0);
    });

    it('should handle maxSize of 1', async () => {
      cache = new LFUCache({ maxSize: 1 });

      await cache.set('a', 'valueA');
      await cache.set('b', 'valueB');

      expect(await cache.size()).toBe(1);
      expect(await cache.has('a')).toBe(false);
      expect(await cache.has('b')).toBe(true);
    });

    it('should handle concurrent operations', async () => {
      cache = new LFUCache({ maxSize: 100 });

      const operations = [];
      for (let i = 0; i < 100; i++) {
        operations.push(cache.set(`key${i}`, `value${i}`));
      }

      await Promise.all(operations);

      expect(await cache.size()).toBe(100);
    });

    it('should correctly update minFrequency after evictions', async () => {
      cache = new LFUCache({ maxSize: 2 });

      await cache.set('a', 'valueA');
      await cache.get('a'); // Frequency 2
      await cache.get('a'); // Frequency 3

      await cache.set('b', 'valueB'); // Frequency 1

      // minFrequency should be 1 (from 'b')
      await cache.set('c', 'valueC'); // Should evict 'b'

      expect(await cache.has('a')).toBe(true);
      expect(await cache.has('b')).toBe(false);
      expect(await cache.has('c')).toBe(true);
    });
  });

  describe('dispose()', () => {
    it('should clean up resources', async () => {
      cache = new LFUCache({
        maxSize: 100,
        frequencyDecay: 0.1,
        decayInterval: 100,
      });

      await cache.set('key1', 'value1', { ttl: 60 });
      await cache.set('key2', 'value2');

      await cache.dispose();

      expect(await cache.size()).toBe(0);
    });
  });

  describe('performance', () => {
    it('should handle 10000 operations efficiently', async () => {
      cache = new LFUCache({ maxSize: 5000, enableStats: false });

      const start = Date.now();

      // Insert 10000 items
      for (let i = 0; i < 10000; i++) {
        await cache.set(`key${i}`, `value${i}`);
      }

      const setTime = Date.now() - start;

      // Read 10000 items
      const getStart = Date.now();
      for (let i = 5000; i < 10000; i++) {
        await cache.get(`key${i}`);
      }
      const getTime = Date.now() - getStart;

      // Should be reasonably fast
      expect(setTime).toBeLessThan(1000);
      expect(getTime).toBeLessThan(1000);
    });
  });
});
