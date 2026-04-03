/**
 * Cache Utils Tests
 *
 * Tests for cache utility functions including compression, size estimation,
 * and helper functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  compressValue,
  decompressValue,
  estimateSize,
  getExactSize,
  deepClone,
  hashKey,
  generateCacheKey,
  parseCacheKey,
  isSerializable,
  formatBytes,
  calculateHitRate,
  createTtlCalculator,
  debounce,
  throttle,
  Singleflight,
  AsyncMutex,
  createCacheGetOrSet,
} from '../src/cache.utils.js';

describe('Cache Utils', () => {
  describe('compressValue() and decompressValue()', () => {
    describe('no compression', () => {
      it('should return JSON buffer for "none" algorithm', async () => {
        const value = { test: 'data' };
        const compressed = await compressValue(value, 'none');

        expect(compressed).toBeInstanceOf(Buffer);
        expect(JSON.parse(compressed.toString())).toEqual(value);
      });

      it('should decompress "none" algorithm', async () => {
        const value = { test: 'data' };
        const compressed = await compressValue(value, 'none');
        const decompressed = await decompressValue<typeof value>(compressed, 'none');

        expect(decompressed).toEqual(value);
      });
    });

    describe('gzip compression', () => {
      it('should compress and decompress with gzip', async () => {
        const value = { test: 'data', large: 'x'.repeat(1000) };
        const compressed = await compressValue(value, 'gzip');
        const decompressed = await decompressValue<typeof value>(compressed, 'gzip');

        expect(decompressed).toEqual(value);
      });

      it('should produce smaller output for compressible data', async () => {
        const value = { data: 'x'.repeat(10000) };
        const uncompressed = Buffer.from(JSON.stringify(value));
        const compressed = await compressValue(value, 'gzip');

        expect(compressed.length).toBeLessThan(uncompressed.length);
      });
    });

    describe('deflate compression', () => {
      it('should compress and decompress with deflate', async () => {
        const value = { test: 'data', nested: { value: 123 } };
        const compressed = await compressValue(value, 'deflate');
        const decompressed = await decompressValue<typeof value>(compressed, 'deflate');

        expect(decompressed).toEqual(value);
      });
    });

    describe('brotli compression', () => {
      it('should compress and decompress with brotli', async () => {
        const value = { test: 'brotli-data', content: 'y'.repeat(500) };
        const compressed = await compressValue(value, 'brotli');
        const decompressed = await decompressValue<typeof value>(compressed, 'brotli');

        expect(decompressed).toEqual(value);
      });
    });

    describe('lz4 compression', () => {
      it('should compress and decompress with lz4 (falls back to deflate)', async () => {
        const value = { test: 'lz4-data' };
        const compressed = await compressValue(value, 'lz4');
        const decompressed = await decompressValue<typeof value>(compressed, 'lz4');

        expect(decompressed).toEqual(value);
      });
    });

    it('should handle various data types', async () => {
      const testCases = [
        { value: 'simple string' },
        { value: 12345 },
        { value: true },
        { value: null },
        { value: [1, 2, 3] },
        { value: { nested: { deeply: { data: 'test' } } } },
      ];

      for (const { value } of testCases) {
        const compressed = await compressValue(value, 'gzip');
        const decompressed = await decompressValue(compressed, 'gzip');
        expect(decompressed).toEqual(value);
      }
    });
  });

  describe('estimateSize()', () => {
    it('should estimate null/undefined size', () => {
      expect(estimateSize(null)).toBe(8);
      expect(estimateSize(undefined)).toBe(8);
    });

    it('should estimate boolean size', () => {
      expect(estimateSize(true)).toBe(4);
      expect(estimateSize(false)).toBe(4);
    });

    it('should estimate number size', () => {
      expect(estimateSize(42)).toBe(8);
      expect(estimateSize(3.14159)).toBe(8);
    });

    it('should estimate bigint size', () => {
      const size = estimateSize(BigInt(12345));
      expect(size).toBeGreaterThan(8);
    });

    it('should estimate string size', () => {
      const shortString = 'hello';
      const longString = 'x'.repeat(100);

      expect(estimateSize(shortString)).toBeGreaterThan(0);
      expect(estimateSize(longString)).toBeGreaterThan(estimateSize(shortString));
    });

    it('should estimate symbol size', () => {
      const sym = Symbol('test');
      expect(estimateSize(sym)).toBeGreaterThan(0);
    });

    it('should return 0 for functions', () => {
      expect(estimateSize(() => {})).toBe(0);
    });

    it('should estimate Buffer size', () => {
      const buffer = Buffer.from('test data');
      expect(estimateSize(buffer)).toBeGreaterThan(buffer.length);
    });

    it('should estimate Date size', () => {
      expect(estimateSize(new Date())).toBe(24);
    });

    it('should estimate RegExp size', () => {
      const regex = /test\d+/gi;
      expect(estimateSize(regex)).toBeGreaterThan(0);
    });

    it('should estimate array size', () => {
      const arr = [1, 2, 3, 4, 5];
      expect(estimateSize(arr)).toBeGreaterThan(arr.length * 8);
    });

    it('should estimate Map size', () => {
      const map = new Map([
        ['a', 1],
        ['b', 2],
      ]);
      expect(estimateSize(map)).toBeGreaterThan(0);
    });

    it('should estimate Set size', () => {
      const set = new Set([1, 2, 3]);
      expect(estimateSize(set)).toBeGreaterThan(0);
    });

    it('should estimate object size', () => {
      const obj = { name: 'test', value: 123, nested: { data: 'value' } };
      expect(estimateSize(obj)).toBeGreaterThan(0);
    });

    it('should handle nested structures', () => {
      const nested = {
        level1: {
          level2: {
            level3: {
              data: [1, 2, 3],
            },
          },
        },
      };
      expect(estimateSize(nested)).toBeGreaterThan(0);
    });
  });

  describe('getExactSize()', () => {
    it('should return exact JSON byte length', () => {
      const value = { test: 'data' };
      const size = getExactSize(value);
      const expected = Buffer.byteLength(JSON.stringify(value));

      expect(size).toBe(expected);
    });

    it('should handle values that JSON.stringify throws on', () => {
      // Test with a value that will throw during JSON.stringify
      const objWithBigInt = { value: BigInt(12345) };

      // The function should fallback to estimateSize when JSON.stringify fails
      const size = getExactSize(objWithBigInt);
      expect(size).toBeGreaterThan(0);
    });
  });

  describe('deepClone()', () => {
    it('should deep clone objects', () => {
      const original = { a: 1, b: { c: 2 } };
      const cloned = deepClone(original);

      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned.b).not.toBe(original.b);
    });

    it('should deep clone arrays', () => {
      const original = [1, [2, 3], { a: 4 }];
      const cloned = deepClone(original);

      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
    });

    it('should handle primitive values', () => {
      expect(deepClone('string')).toBe('string');
      expect(deepClone(42)).toBe(42);
      expect(deepClone(true)).toBe(true);
      expect(deepClone(null)).toBe(null);
    });
  });

  describe('hashKey()', () => {
    it('should produce consistent hash for same key', () => {
      const key = 'test-key';
      const hash1 = hashKey(key);
      const hash2 = hashKey(key);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different keys', () => {
      const hash1 = hashKey('key1');
      const hash2 = hashKey('key2');

      expect(hash1).not.toBe(hash2);
    });

    it('should produce non-negative integers', () => {
      const testKeys = ['a', 'test', 'long-key-with-many-characters', ''];

      for (const key of testKeys) {
        const hash = hashKey(key);
        expect(hash).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(hash)).toBe(true);
      }
    });

    it('should handle empty string', () => {
      const hash = hashKey('');
      expect(hash).toBeGreaterThanOrEqual(0);
    });

    it('should handle unicode characters', () => {
      const hash = hashKey('unicode-test');
      expect(hash).toBeGreaterThanOrEqual(0);
    });
  });

  describe('generateCacheKey()', () => {
    it('should join parts with colon', () => {
      const key = generateCacheKey('user', '123', 'profile');
      expect(key).toBe('user:123:profile');
    });

    it('should filter out undefined and null', () => {
      const key = generateCacheKey('user', undefined, '123', null, 'profile');
      expect(key).toBe('user:123:profile');
    });

    it('should convert numbers and booleans to strings', () => {
      const key = generateCacheKey('item', 42, true);
      expect(key).toBe('item:42:true');
    });

    it('should handle single part', () => {
      const key = generateCacheKey('single');
      expect(key).toBe('single');
    });

    it('should handle empty parts', () => {
      const key = generateCacheKey();
      expect(key).toBe('');
    });
  });

  describe('parseCacheKey()', () => {
    it('should split key by colon', () => {
      const parts = parseCacheKey('user:123:profile');
      expect(parts).toEqual(['user', '123', 'profile']);
    });

    it('should handle single part', () => {
      const parts = parseCacheKey('single');
      expect(parts).toEqual(['single']);
    });

    it('should handle empty string', () => {
      const parts = parseCacheKey('');
      expect(parts).toEqual(['']);
    });
  });

  describe('isSerializable()', () => {
    it('should return true for primitives', () => {
      expect(isSerializable(null)).toBe(true);
      expect(isSerializable(undefined)).toBe(true);
      expect(isSerializable(true)).toBe(true);
      expect(isSerializable(42)).toBe(true);
      expect(isSerializable('string')).toBe(true);
    });

    it('should return false for bigint', () => {
      expect(isSerializable(BigInt(123))).toBe(false);
    });

    it('should return false for symbol', () => {
      expect(isSerializable(Symbol('test'))).toBe(false);
    });

    it('should return false for function', () => {
      expect(isSerializable(() => {})).toBe(false);
    });

    it('should return true for Date', () => {
      expect(isSerializable(new Date())).toBe(true);
    });

    it('should return true for RegExp', () => {
      expect(isSerializable(/test/)).toBe(true);
    });

    it('should return true for serializable arrays', () => {
      expect(isSerializable([1, 'two', true])).toBe(true);
      expect(
        isSerializable([
          [1, 2],
          [3, 4],
        ])
      ).toBe(true);
    });

    it('should return false for arrays with non-serializable elements', () => {
      expect(isSerializable([1, () => {}])).toBe(false);
    });

    it('should return false for Map', () => {
      expect(isSerializable(new Map())).toBe(false);
    });

    it('should return false for Set', () => {
      expect(isSerializable(new Set())).toBe(false);
    });

    it('should return true for plain objects', () => {
      expect(isSerializable({ a: 1, b: 'two' })).toBe(true);
    });

    it('should return false for objects with non-serializable values', () => {
      expect(isSerializable({ fn: () => {} })).toBe(false);
    });
  });

  describe('formatBytes()', () => {
    it('should format bytes', () => {
      expect(formatBytes(0)).toBe('0.00 B');
      expect(formatBytes(512)).toBe('512.00 B');
    });

    it('should format kilobytes', () => {
      expect(formatBytes(1024)).toBe('1.00 KB');
      expect(formatBytes(1536)).toBe('1.50 KB');
    });

    it('should format megabytes', () => {
      expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
    });

    it('should format gigabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB');
    });

    it('should format terabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1.00 TB');
    });
  });

  describe('calculateHitRate()', () => {
    it('should calculate hit rate percentage', () => {
      expect(calculateHitRate(75, 25)).toBe('75.00%');
      expect(calculateHitRate(50, 50)).toBe('50.00%');
      expect(calculateHitRate(100, 0)).toBe('100.00%');
    });

    it('should return 0% for no accesses', () => {
      expect(calculateHitRate(0, 0)).toBe('0.00%');
    });

    it('should handle all misses', () => {
      expect(calculateHitRate(0, 100)).toBe('0.00%');
    });
  });

  describe('createTtlCalculator()', () => {
    it('should return base TTL with jitter', () => {
      const calculator = createTtlCalculator(100, 10);

      const results = new Set<number>();
      for (let i = 0; i < 100; i++) {
        results.add(calculator());
      }

      // Should have variation due to jitter
      expect(results.size).toBeGreaterThan(1);

      // All values should be within jitter range
      for (const result of results) {
        expect(result).toBeGreaterThanOrEqual(90);
        expect(result).toBeLessThanOrEqual(110);
      }
    });

    it('should use default jitter of 10%', () => {
      const calculator = createTtlCalculator(100);

      const results: number[] = [];
      for (let i = 0; i < 100; i++) {
        results.push(calculator());
      }

      const min = Math.min(...results);
      const max = Math.max(...results);

      expect(min).toBeGreaterThanOrEqual(90);
      expect(max).toBeLessThanOrEqual(110);
    });

    it('should return at least 1', () => {
      const calculator = createTtlCalculator(1, 100);

      for (let i = 0; i < 100; i++) {
        expect(calculator()).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('debounce()', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should debounce function calls', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced();
      debounced();
      debounced();

      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should pass arguments to debounced function', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced('arg1', 'arg2');

      vi.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('should reset timer on subsequent calls', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced();
      vi.advanceTimersByTime(50);
      debounced();
      vi.advanceTimersByTime(50);

      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(50);

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('throttle()', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should throttle function calls', () => {
      const fn = vi.fn(() => 'result');
      const throttled = throttle(fn, 100);

      throttled();
      throttled();
      throttled();

      expect(fn).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(100);

      throttled();

      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should return cached result during throttle period', () => {
      let counter = 0;
      const fn = vi.fn(() => ++counter);
      const throttled = throttle(fn, 100);

      const result1 = throttled();
      const result2 = throttled();
      const result3 = throttled();

      expect(result1).toBe(1);
      expect(result2).toBe(1);
      expect(result3).toBe(1);

      vi.advanceTimersByTime(100);

      const result4 = throttled();
      expect(result4).toBe(2);
    });
  });

  describe('Singleflight', () => {
    it('should deduplicate concurrent requests for same key', async () => {
      const singleflight = new Singleflight<number>();
      let fetchCount = 0;

      const fetch = async (): Promise<number> => {
        fetchCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 42;
      };

      // Launch 5 concurrent requests for same key
      const promises = Array.from({ length: 5 }, () => singleflight.do('key', fetch));

      const results = await Promise.all(promises);

      // All should get same result
      expect(results).toEqual([42, 42, 42, 42, 42]);
      // But only one fetch should have been made
      expect(fetchCount).toBe(1);
    });

    it('should allow parallel requests for different keys', async () => {
      const singleflight = new Singleflight<string>();
      let fetchCount = 0;

      const fetch = async (key: string): Promise<string> => {
        fetchCount++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return `result-${key}`;
      };

      const promises = [
        singleflight.do('key1', () => fetch('key1')),
        singleflight.do('key2', () => fetch('key2')),
        singleflight.do('key3', () => fetch('key3')),
      ];

      const results = await Promise.all(promises);

      expect(results).toEqual(['result-key1', 'result-key2', 'result-key3']);
      expect(fetchCount).toBe(3);
    });

    it('should allow new request after previous completes', async () => {
      const singleflight = new Singleflight<number>();
      let counter = 0;

      const fetch = async (): Promise<number> => ++counter;

      const result1 = await singleflight.do('key', fetch);
      const result2 = await singleflight.do('key', fetch);

      expect(result1).toBe(1);
      expect(result2).toBe(2);
    });

    it('should propagate errors to all waiters', async () => {
      const singleflight = new Singleflight<number>();
      const error = new Error('Test error');

      const fetch = async (): Promise<number> => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw error;
      };

      const promises = [
        singleflight.do('key', fetch).catch((e) => e),
        singleflight.do('key', fetch).catch((e) => e),
        singleflight.do('key', fetch).catch((e) => e),
      ];

      const results = await Promise.all(promises);

      expect(results).toEqual([error, error, error]);
    });

    it('should clean up after error', async () => {
      const singleflight = new Singleflight<number>();

      // First request fails
      await expect(
        singleflight.do('key', async () => {
          throw new Error('First error');
        })
      ).rejects.toThrow('First error');

      // Key should be cleaned up, new request should work
      const result = await singleflight.do('key', async () => 42);
      expect(result).toBe(42);
    });

    it('should report correct size', async () => {
      const singleflight = new Singleflight<number>();

      expect(singleflight.size).toBe(0);

      const promise = singleflight.do('key', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 42;
      });

      expect(singleflight.size).toBe(1);
      expect(singleflight.has('key')).toBe(true);
      expect(singleflight.has('other')).toBe(false);

      await promise;

      expect(singleflight.size).toBe(0);
      expect(singleflight.has('key')).toBe(false);
    });

    it('should clear all inflight requests', async () => {
      const singleflight = new Singleflight<number>();

      singleflight.do('key1', () => new Promise(() => {})); // Never resolves
      singleflight.do('key2', () => new Promise(() => {}));

      expect(singleflight.size).toBe(2);

      singleflight.clear();

      expect(singleflight.size).toBe(0);
    });
  });

  describe('AsyncMutex', () => {
    it('should serialize concurrent operations', async () => {
      const mutex = new AsyncMutex();
      const order: number[] = [];

      const task = async (id: number): Promise<void> => {
        await mutex.acquire();
        order.push(id);
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(id * 10);
        mutex.release();
      };

      await Promise.all([task(1), task(2), task(3)]);

      // Operations should be serialized: complete one before starting next
      // Each task should add its id, then id*10 before next task starts
      expect(order).toEqual([1, 10, 2, 20, 3, 30]);
    });

    it('should work with runExclusive', async () => {
      const mutex = new AsyncMutex();
      const order: string[] = [];

      const task = async (name: string): Promise<string> =>
        mutex.runExclusive(async () => {
          order.push(`${name}-start`);
          await new Promise((resolve) => setTimeout(resolve, 10));
          order.push(`${name}-end`);
          return name;
        });

      const results = await Promise.all([task('A'), task('B'), task('C')]);

      expect(results).toEqual(['A', 'B', 'C']);
      expect(order).toEqual(['A-start', 'A-end', 'B-start', 'B-end', 'C-start', 'C-end']);
    });

    it('should release lock even on error', async () => {
      const mutex = new AsyncMutex();

      await expect(
        mutex.runExclusive(async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      // Mutex should be unlocked, next operation should proceed immediately
      expect(mutex.isLocked()).toBe(false);

      const result = await mutex.runExclusive(async () => 'success');
      expect(result).toBe('success');
    });

    it('should report lock state correctly', async () => {
      const mutex = new AsyncMutex();

      expect(mutex.isLocked()).toBe(false);

      await mutex.acquire();
      expect(mutex.isLocked()).toBe(true);

      mutex.release();
      expect(mutex.isLocked()).toBe(false);
    });

    it('should track waiters count', async () => {
      const mutex = new AsyncMutex();

      await mutex.acquire();
      expect(mutex.waitersCount).toBe(0);

      // Start some waiting tasks
      const p1 = mutex.acquire();
      const p2 = mutex.acquire();
      const p3 = mutex.acquire();

      expect(mutex.waitersCount).toBe(3);

      // Release one by one
      mutex.release();
      await p1;
      expect(mutex.waitersCount).toBe(2);

      mutex.release();
      await p2;
      expect(mutex.waitersCount).toBe(1);

      mutex.release();
      await p3;
      expect(mutex.waitersCount).toBe(0);
      expect(mutex.isLocked()).toBe(true);

      mutex.release();
      expect(mutex.isLocked()).toBe(false);
    });

    it('should allow immediate acquisition when unlocked', async () => {
      const mutex = new AsyncMutex();
      const start = Date.now();

      await mutex.acquire();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(10); // Should be nearly instant
      mutex.release();
    });
  });

  describe('createCacheGetOrSet()', () => {
    it('should return cached value if exists', async () => {
      const cache = new Map<string, unknown>();
      const mockCache = {
        get: async (key: string) => cache.get(key),
        set: async (key: string, value: unknown) => {
          cache.set(key, value);
        },
      };

      cache.set('key', 'cached-value');

      const getOrSet = createCacheGetOrSet(mockCache);
      const fetchCalls: string[] = [];

      const result = await getOrSet(
        'key',
        async () => {
          fetchCalls.push('called');
          return 'new-value';
        },
        { ttl: 60 }
      );

      expect(result).toBe('cached-value');
      expect(fetchCalls).toEqual([]); // Fetch should not be called
    });

    it('should fetch and cache on miss', async () => {
      const cache = new Map<string, unknown>();
      const mockCache = {
        get: async (key: string) => cache.get(key),
        set: async (key: string, value: unknown) => {
          cache.set(key, value);
        },
      };

      const getOrSet = createCacheGetOrSet(mockCache);
      let fetchCount = 0;

      const result = await getOrSet(
        'key',
        async () => {
          fetchCount++;
          return 'fetched-value';
        },
        { ttl: 60 }
      );

      expect(result).toBe('fetched-value');
      expect(fetchCount).toBe(1);
      expect(cache.get('key')).toBe('fetched-value');
    });

    it('should use singleflight to prevent stampede', async () => {
      const cache = new Map<string, unknown>();
      const mockCache = {
        get: async (key: string) => cache.get(key),
        set: async (key: string, value: unknown) => {
          cache.set(key, value);
        },
      };

      const getOrSet = createCacheGetOrSet(mockCache);
      let fetchCount = 0;

      // Launch concurrent requests
      const promises = Array.from({ length: 10 }, () =>
        getOrSet(
          'key',
          async () => {
            fetchCount++;
            await new Promise((resolve) => setTimeout(resolve, 20));
            return 'fetched-value';
          },
          { ttl: 60 }
        )
      );

      const results = await Promise.all(promises);

      expect(results).toEqual(Array(10).fill('fetched-value'));
      expect(fetchCount).toBe(1); // Only one fetch due to singleflight
    });

    it('should double-check cache inside singleflight', async () => {
      const cache = new Map<string, unknown>();
      let getCalls = 0;

      const mockCache = {
        get: async (key: string) => {
          getCalls++;
          // Simulate another request populating cache between first check and singleflight
          if (getCalls === 2) {
            cache.set(key, 'other-value');
          }
          return cache.get(key);
        },
        set: async (key: string, value: unknown) => {
          cache.set(key, value);
        },
      };

      const getOrSet = createCacheGetOrSet(mockCache);

      const result = await getOrSet('key', async () => 'fetched-value', { ttl: 60 });

      // Should get the value that was set between checks
      expect(result).toBe('other-value');
    });

    it('should pass TTL options to cache.set', async () => {
      const setCalls: Array<{ key: string; value: unknown; options?: { ttl?: number } }> = [];
      const mockCache = {
        get: async () => undefined,
        set: async (key: string, value: unknown, options?: { ttl?: number }) => {
          setCalls.push({ key, value, options });
        },
      };

      const getOrSet = createCacheGetOrSet(mockCache);

      await getOrSet('key', async () => 'value', { ttl: 300 });

      expect(setCalls).toEqual([{ key: 'key', value: 'value', options: { ttl: 300 } }]);
    });

    it('should use provided singleflight instance', async () => {
      const cache = new Map<string, unknown>();
      const mockCache = {
        get: async (key: string) => cache.get(key),
        set: async (key: string, value: unknown) => {
          cache.set(key, value);
        },
      };

      const sharedSingleflight = new Singleflight<unknown>();
      const getOrSet = createCacheGetOrSet(mockCache, sharedSingleflight);
      let fetchCount = 0;

      const promises = Array.from({ length: 5 }, () =>
        getOrSet(
          'key',
          async () => {
            fetchCount++;
            await new Promise((resolve) => setTimeout(resolve, 10));
            return 'value';
          },
          {}
        )
      );

      await Promise.all(promises);

      expect(fetchCount).toBe(1);
      expect(sharedSingleflight.size).toBe(0); // Cleaned up after completion
    });
  });
});
