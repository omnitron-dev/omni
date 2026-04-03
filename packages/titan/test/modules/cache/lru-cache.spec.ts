/**
 * LRU Cache Tests
 *
 * Comprehensive tests for the high-performance LRU cache implementation.
 * Tests O(1) operations, eviction behavior, TTL management, and statistics.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LRUCache } from '../../../src/modules/cache/lru-cache.js';

describe('LRUCache', () => {
  let cache: LRUCache<string>;

  afterEach(async () => {
    if (cache) {
      await cache.dispose();
    }
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      cache = new LRUCache();
      const stats = cache.getStats();

      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it('should create with custom options', () => {
      cache = new LRUCache({
        maxSize: 500,
        ttl: 60,
        enableStats: true,
        name: 'test-cache',
      });
      const stats = cache.getStats();

      expect(stats.size).toBe(0);
    });

    it('should accept onEvict callback', async () => {
      const evictedItems: Array<{ key: string; value: unknown; reason: string }> = [];

      cache = new LRUCache({
        maxSize: 2,
        onEvict: (key, value, reason) => {
          evictedItems.push({ key, value, reason });
        },
      });

      await cache.set('a', 'valueA');
      await cache.set('b', 'valueB');
      await cache.set('c', 'valueC'); // Should evict 'a'

      expect(evictedItems.length).toBe(1);
      expect(evictedItems[0]!.key).toBe('a');
      expect(evictedItems[0]!.reason).toBe('capacity');
    });
  });

  describe('set() and get()', () => {
    beforeEach(() => {
      cache = new LRUCache({ maxSize: 100, enableStats: true });
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
      const typedCache = new LRUCache<unknown>({ maxSize: 100 });

      await typedCache.set('string', 'hello');
      await typedCache.set('number', 42);
      await typedCache.set('boolean', true);
      await typedCache.set('object', { nested: { value: 'test' } });
      await typedCache.set('array', [1, 2, 3]);
      await typedCache.set('null', null);

      expect(await typedCache.get('string')).toBe('hello');
      expect(await typedCache.get('number')).toBe(42);
      expect(await typedCache.get('boolean')).toBe(true);
      expect(await typedCache.get('object')).toEqual({ nested: { value: 'test' } });
      expect(await typedCache.get('array')).toEqual([1, 2, 3]);
      expect(await typedCache.get('null')).toBeNull();

      await typedCache.dispose();
    });

    it('should update access time on get', async () => {
      await cache.set('key1', 'value1');
      const entry1 = await cache.getEntry('key1');
      const firstAccess = entry1!.meta.lastAccessAt;

      await new Promise((resolve) => setTimeout(resolve, 10));
      await cache.get('key1');

      const entry2 = await cache.getEntry('key1');
      expect(entry2!.meta.lastAccessAt).toBeGreaterThanOrEqual(firstAccess);
    });

    it('should not update access time when touch is false', async () => {
      await cache.set('key1', 'value1');
      const entry1 = await cache.getEntry('key1');
      const firstAccess = entry1!.meta.accessCount;

      await cache.get('key1', { touch: false });

      const entry2 = await cache.getEntry('key1');
      expect(entry2!.meta.accessCount).toBe(firstAccess);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used item when at capacity', async () => {
      cache = new LRUCache({ maxSize: 3 });

      await cache.set('a', 'valueA');
      await cache.set('b', 'valueB');
      await cache.set('c', 'valueC');

      // 'a' is the oldest, should be evicted
      await cache.set('d', 'valueD');

      expect(await cache.has('a')).toBe(false);
      expect(await cache.has('b')).toBe(true);
      expect(await cache.has('c')).toBe(true);
      expect(await cache.has('d')).toBe(true);
    });

    it('should update LRU order on get', async () => {
      cache = new LRUCache({ maxSize: 3 });

      await cache.set('a', 'valueA');
      await cache.set('b', 'valueB');
      await cache.set('c', 'valueC');

      // Access 'a' to make it most recently used
      await cache.get('a');

      // Now 'b' should be the oldest
      await cache.set('d', 'valueD');

      expect(await cache.has('a')).toBe(true);
      expect(await cache.has('b')).toBe(false);
      expect(await cache.has('c')).toBe(true);
      expect(await cache.has('d')).toBe(true);
    });

    it('should update LRU order on set for existing key', async () => {
      cache = new LRUCache({ maxSize: 3 });

      await cache.set('a', 'valueA');
      await cache.set('b', 'valueB');
      await cache.set('c', 'valueC');

      // Update 'a' to make it most recently used
      await cache.set('a', 'newValueA');

      // Now 'b' should be the oldest
      await cache.set('d', 'valueD');

      expect(await cache.has('a')).toBe(true);
      expect(await cache.get('a')).toBe('newValueA');
      expect(await cache.has('b')).toBe(false);
    });

    it('should correctly track eviction count', async () => {
      cache = new LRUCache({ maxSize: 2, enableStats: true });

      await cache.set('a', 'valueA');
      await cache.set('b', 'valueB');
      await cache.set('c', 'valueC'); // Evicts 'a'
      await cache.set('d', 'valueD'); // Evicts 'b'

      const stats = cache.getStats();
      expect(stats.evictions).toBe(2);
    });

    it('should evict multiple items if needed', async () => {
      cache = new LRUCache({ maxSize: 5 });

      // Fill cache
      for (let i = 0; i < 5; i++) {
        await cache.set(`key${i}`, `value${i}`);
      }

      expect(await cache.size()).toBe(5);

      // Add more items, should evict oldest
      for (let i = 5; i < 10; i++) {
        await cache.set(`key${i}`, `value${i}`);
      }

      expect(await cache.size()).toBe(5);

      // First 5 should be evicted
      for (let i = 0; i < 5; i++) {
        expect(await cache.has(`key${i}`)).toBe(false);
      }

      // Last 5 should remain
      for (let i = 5; i < 10; i++) {
        expect(await cache.has(`key${i}`)).toBe(true);
      }
    });
  });

  describe('TTL expiration', () => {
    beforeEach(() => {
      cache = new LRUCache({ maxSize: 100, enableStats: true });
    });

    it('should expire items after TTL', async () => {
      await cache.set('key1', 'value1', { ttl: 0.1 }); // 100ms

      expect(await cache.get('key1')).toBe('value1');

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(await cache.get('key1')).toBeUndefined();
    });

    it('should use default TTL if set', async () => {
      cache = new LRUCache({ maxSize: 100, ttl: 0.1 });

      await cache.set('key1', 'value1');

      expect(await cache.get('key1')).toBe('value1');

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(await cache.get('key1')).toBeUndefined();
    });

    it('should override default TTL with option', async () => {
      cache = new LRUCache({ maxSize: 100, ttl: 10 }); // 10 seconds default

      await cache.set('key1', 'value1', { ttl: 0.1 }); // Override to 100ms

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

    it('should handle has() with expired items', async () => {
      await cache.set('key1', 'value1', { ttl: 0.05 });

      expect(await cache.has('key1')).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(await cache.has('key1')).toBe(false);
    });

    it('should not expire items with no TTL', async () => {
      await cache.set('key1', 'value1'); // No TTL

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(await cache.get('key1')).toBe('value1');
    });
  });

  describe('has()', () => {
    beforeEach(() => {
      cache = new LRUCache({ maxSize: 100 });
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
      cache = new LRUCache({ maxSize: 100, enableStats: true });
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
  });

  describe('clear()', () => {
    beforeEach(() => {
      cache = new LRUCache({ maxSize: 100 });
    });

    it('should clear all entries', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.set('key3', 'value3');

      await cache.clear();

      expect(await cache.size()).toBe(0);
      expect(await cache.has('key1')).toBe(false);
      expect(await cache.has('key2')).toBe(false);
      expect(await cache.has('key3')).toBe(false);
    });

    it('should clear entries matching pattern (string)', async () => {
      await cache.set('user:1', 'data1');
      await cache.set('user:2', 'data2');
      await cache.set('product:1', 'prod1');

      await cache.clear('user:.*');

      expect(await cache.has('user:1')).toBe(false);
      expect(await cache.has('user:2')).toBe(false);
      expect(await cache.has('product:1')).toBe(true);
    });

    it('should clear entries matching pattern (RegExp)', async () => {
      await cache.set('user:1', 'data1');
      await cache.set('user:2', 'data2');
      await cache.set('product:1', 'prod1');

      await cache.clear(/^user:/);

      expect(await cache.has('user:1')).toBe(false);
      expect(await cache.has('user:2')).toBe(false);
      expect(await cache.has('product:1')).toBe(true);
    });

    it('should call onEvict for each cleared entry', async () => {
      const evictedKeys: string[] = [];

      cache = new LRUCache({
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
      cache = new LRUCache({ maxSize: 100 });
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

    it('should handle multiple tags', async () => {
      await cache.set('item1', 'data1', { tags: ['a'] });
      await cache.set('item2', 'data2', { tags: ['b'] });
      await cache.set('item3', 'data3', { tags: ['c'] });

      const invalidated = await cache.invalidateByTags(['a', 'b']);

      expect(invalidated).toBe(2);
      expect(await cache.has('item1')).toBe(false);
      expect(await cache.has('item2')).toBe(false);
      expect(await cache.has('item3')).toBe(true);
    });

    it('should return 0 when no entries match', async () => {
      await cache.set('item1', 'data1', { tags: ['x'] });

      const invalidated = await cache.invalidateByTags(['nonexistent']);

      expect(invalidated).toBe(0);
    });
  });

  describe('getMany() and setMany()', () => {
    beforeEach(() => {
      cache = new LRUCache({ maxSize: 100 });
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

    it('should set many with options', async () => {
      const entries = new Map([
        ['key1', 'value1'],
        ['key2', 'value2'],
      ]);

      await cache.setMany(entries, { ttl: 0.1 });

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(await cache.get('key1')).toBeUndefined();
      expect(await cache.get('key2')).toBeUndefined();
    });
  });

  describe('keys()', () => {
    beforeEach(() => {
      cache = new LRUCache({ maxSize: 100 });
    });

    it('should return all keys', async () => {
      await cache.set('a', 'valueA');
      await cache.set('b', 'valueB');
      await cache.set('c', 'valueC');

      const keys = await cache.keys();

      expect(keys.sort()).toEqual(['a', 'b', 'c']);
    });

    it('should return keys matching pattern (string)', async () => {
      await cache.set('user:1', 'data1');
      await cache.set('user:2', 'data2');
      await cache.set('product:1', 'prod1');

      const keys = await cache.keys('user:.*');

      expect(keys.sort()).toEqual(['user:1', 'user:2']);
    });

    it('should return keys matching pattern (RegExp)', async () => {
      await cache.set('user:1', 'data1');
      await cache.set('user:2', 'data2');
      await cache.set('product:1', 'prod1');

      const keys = await cache.keys(/^product:/);

      expect(keys).toEqual(['product:1']);
    });
  });

  describe('size()', () => {
    beforeEach(() => {
      cache = new LRUCache({ maxSize: 100 });
    });

    it('should return correct size', async () => {
      expect(await cache.size()).toBe(0);

      await cache.set('key1', 'value1');
      expect(await cache.size()).toBe(1);

      await cache.set('key2', 'value2');
      expect(await cache.size()).toBe(2);

      await cache.delete('key1');
      expect(await cache.size()).toBe(1);
    });
  });

  describe('getEntry()', () => {
    beforeEach(() => {
      cache = new LRUCache({ maxSize: 100 });
    });

    it('should return entry with metadata', async () => {
      await cache.set('key1', 'value1', { tags: ['test'] });

      const entry = await cache.getEntry('key1');

      expect(entry).toBeDefined();
      expect(entry!.key).toBe('key1');
      expect(entry!.value).toBe('value1');
      expect(entry!.meta.createdAt).toBeDefined();
      expect(entry!.meta.lastAccessAt).toBeDefined();
      expect(entry!.meta.accessCount).toBeGreaterThanOrEqual(1);
      expect(entry!.meta.tags).toContain('test');
    });

    it('should return undefined for non-existent key', async () => {
      const entry = await cache.getEntry('nonexistent');
      expect(entry).toBeUndefined();
    });

    it('should return undefined for expired key', async () => {
      await cache.set('key1', 'value1', { ttl: 0.05 });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const entry = await cache.getEntry('key1');
      expect(entry).toBeUndefined();
    });
  });

  describe('statistics', () => {
    beforeEach(() => {
      cache = new LRUCache({ maxSize: 100, enableStats: true });
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
      expect(stats.evictions).toBe(0);
    });

    it('should track memory usage', async () => {
      await cache.set('key1', 'some value here');

      const stats = cache.getStats();
      expect(stats.memoryUsage).toBeGreaterThan(0);
    });
  });

  describe('warm()', () => {
    beforeEach(() => {
      cache = new LRUCache({ maxSize: 100 });
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

    it('should respect strategy priority', async () => {
      const order: string[] = [];

      await cache.warm([
        {
          name: 'low-priority',
          priority: 1,
          loader: async () => {
            order.push('low');
            return new Map([['low', 'value']]);
          },
        },
        {
          name: 'high-priority',
          priority: 10,
          loader: async () => {
            order.push('high');
            return new Map([['high', 'value']]);
          },
        },
      ]);

      expect(order).toEqual(['high', 'low']);
    });

    it('should handle empty strategies', async () => {
      await cache.warm([]);
      await cache.warm(undefined);

      expect(await cache.size()).toBe(0);
    });
  });

  describe('partition()', () => {
    beforeEach(() => {
      cache = new LRUCache({ maxSize: 100 });
    });

    it('should create partitioned view', async () => {
      const userCache = cache.partition('users');
      const productCache = cache.partition('products');

      await userCache.set('1', 'user1');
      await productCache.set('1', 'product1');

      expect(await userCache.get('1')).toBe('user1');
      expect(await productCache.get('1')).toBe('product1');

      // Check underlying keys
      const allKeys = await cache.keys();
      expect(allKeys.sort()).toEqual(['products:1', 'users:1']);
    });

    it('should isolate partition operations', async () => {
      const partition = cache.partition('test');

      await partition.set('key1', 'value1');
      await partition.set('key2', 'value2');
      await cache.set('other', 'otherValue');

      const partitionKeys = await partition.keys();
      expect(partitionKeys.sort()).toEqual(['key1', 'key2']);

      const partitionSize = await partition.size();
      expect(partitionSize).toBe(2);
    });

    it('should support nested partitions', async () => {
      const level1 = cache.partition('level1');
      const level2 = level1.partition('level2');

      await level2.set('key', 'deepValue');

      expect(await level2.get('key')).toBe('deepValue');
      expect(await cache.get('level1:level2:key')).toBe('deepValue');
    });
  });

  describe('edge cases', () => {
    it('should handle empty cache operations', async () => {
      cache = new LRUCache({ maxSize: 100 });

      expect(await cache.get('nonexistent')).toBeUndefined();
      expect(await cache.has('nonexistent')).toBe(false);
      expect(await cache.delete('nonexistent')).toBe(false);
      expect(await cache.size()).toBe(0);
      expect(await cache.keys()).toEqual([]);
    });

    it('should handle maxSize of 1', async () => {
      cache = new LRUCache({ maxSize: 1 });

      await cache.set('a', 'valueA');
      await cache.set('b', 'valueB');

      expect(await cache.size()).toBe(1);
      expect(await cache.has('a')).toBe(false);
      expect(await cache.has('b')).toBe(true);
    });

    it('should handle very large values', async () => {
      cache = new LRUCache({ maxSize: 10 });

      const largeValue = 'x'.repeat(10000);
      await cache.set('large', largeValue);

      expect(await cache.get('large')).toBe(largeValue);
    });

    it('should handle special characters in keys', async () => {
      cache = new LRUCache({ maxSize: 100 });

      await cache.set('key:with:colons', 'value1');
      await cache.set('key/with/slashes', 'value2');
      await cache.set('key with spaces', 'value3');
      await cache.set('key-with-unicode-', 'value4');

      expect(await cache.get('key:with:colons')).toBe('value1');
      expect(await cache.get('key/with/slashes')).toBe('value2');
      expect(await cache.get('key with spaces')).toBe('value3');
      expect(await cache.get('key-with-unicode-')).toBe('value4');
    });

    it('should handle concurrent operations', async () => {
      cache = new LRUCache({ maxSize: 100 });

      const operations = [];
      for (let i = 0; i < 100; i++) {
        operations.push(cache.set(`key${i}`, `value${i}`));
      }

      await Promise.all(operations);

      expect(await cache.size()).toBe(100);
    });
  });

  describe('dispose()', () => {
    it('should clean up resources', async () => {
      cache = new LRUCache({ maxSize: 100 });

      await cache.set('key1', 'value1', { ttl: 60 });
      await cache.set('key2', 'value2');

      await cache.dispose();

      expect(await cache.size()).toBe(0);
    });
  });

  describe('performance', () => {
    it('should handle 10000 operations efficiently', async () => {
      cache = new LRUCache({ maxSize: 5000, enableStats: false });

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

      // Should be reasonably fast (< 1 second for 10000 ops each)
      expect(setTime).toBeLessThan(1000);
      expect(getTime).toBeLessThan(1000);
    });
  });
});
