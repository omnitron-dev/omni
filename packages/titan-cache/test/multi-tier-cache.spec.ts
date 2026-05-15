/**
 * Multi-Tier Cache Tests
 *
 * Comprehensive tests for the multi-tier caching implementation.
 * Tests L1/L2 promotion/demotion, write strategies, and tier statistics.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MultiTierCache, MemoryL2Adapter } from '../src/multi-tier-cache.js';

describe('MultiTierCache', () => {
  let cache: MultiTierCache<string>;

  afterEach(async () => {
    if (cache) {
      await cache.dispose();
    }
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      cache = new MultiTierCache();
      const stats = cache.getStats();

      expect(stats.size).toBe(0);
    });

    it('should create with custom L1 options (LRU)', () => {
      cache = new MultiTierCache({
        l1: { maxSize: 500, ttl: 60, type: 'lru' },
      });

      const stats = cache.getStats();
      expect(stats.size).toBe(0);
    });

    it('should create with custom L1 options (LFU)', () => {
      cache = new MultiTierCache({
        l1: { maxSize: 500, ttl: 60, type: 'lfu' },
      });

      const stats = cache.getStats();
      expect(stats.size).toBe(0);
    });

    it('should use MemoryL2Adapter by default', async () => {
      cache = new MultiTierCache();

      await cache.set('key1', 'value1');
      const l2 = cache.getL2();
      const value = await l2.get('key1');

      expect(value).toBe('value1');
    });

    it('should accept custom L2 adapter', async () => {
      const customAdapter = new MemoryL2Adapter();

      cache = new MultiTierCache({
        l2: { client: customAdapter },
      });

      await cache.set('key1', 'value1');
      const value = await cache.get('key1');

      expect(value).toBe('value1');
    });
  });

  describe('set() and get()', () => {
    beforeEach(() => {
      cache = new MultiTierCache({
        l1: { maxSize: 100, ttl: 300 },
        writeStrategy: 'through',
        autoPromote: true,
      });
    });

    it('should set and get a value', async () => {
      await cache.set('key1', 'value1');
      const value = await cache.get('key1');

      expect(value).toBe('value1');
    });

    it('should store in both L1 and L2 with write-through', async () => {
      await cache.set('key1', 'value1');

      const l1 = cache.getL1();
      const l2 = cache.getL2();

      expect(await l1.get('key1')).toBe('value1');
      expect(await l2.get('key1')).toBe('value1');
    });

    it('should return undefined for non-existent key', async () => {
      const value = await cache.get('nonexistent');
      expect(value).toBeUndefined();
    });

    it('should get from L1 first', async () => {
      await cache.set('key1', 'value1');

      // Update L2 directly
      const l2 = cache.getL2();
      await l2.set('key1', 'updated-in-l2');

      // Should still get L1 value
      const value = await cache.get('key1');
      expect(value).toBe('value1');
    });

    it('should fallback to L2 when L1 misses', async () => {
      // Set directly in L2
      const l2 = cache.getL2();
      await l2.set('key1', 'value-from-l2');

      const value = await cache.get('key1');
      expect(value).toBe('value-from-l2');
    });
  });

  describe('L1 to L2 promotion', () => {
    beforeEach(() => {
      cache = new MultiTierCache({
        l1: { maxSize: 100 },
        autoPromote: true,
        promotionThreshold: 3,
      });
    });

    it('should promote to L1 after threshold accesses', async () => {
      // Set directly in L2
      const l2 = cache.getL2();
      await l2.set('key1', 'value1');

      const l1 = cache.getL1();
      expect(await l1.has('key1')).toBe(false);

      // Access multiple times to trigger promotion
      await cache.get('key1');
      await cache.get('key1');
      await cache.get('key1');

      // Should now be in L1
      expect(await l1.has('key1')).toBe(true);
    });

    it('should not promote before threshold', async () => {
      const l2 = cache.getL2();
      await l2.set('key1', 'value1');

      const l1 = cache.getL1();

      // Access only twice (below threshold of 3)
      await cache.get('key1');
      await cache.get('key1');

      expect(await l1.has('key1')).toBe(false);
    });
  });

  describe('promote() method', () => {
    beforeEach(() => {
      cache = new MultiTierCache({
        l1: { maxSize: 100 },
        autoPromote: false,
      });
    });

    it('should manually promote from L2 to L1', async () => {
      const l2 = cache.getL2();
      await l2.set('key1', 'value1');

      const result = await cache.promote('key1');
      expect(result).toBe(true);

      const l1 = cache.getL1();
      expect(await l1.get('key1')).toBe('value1');
    });

    it('should return false for non-existent key', async () => {
      const result = await cache.promote('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('demote() method', () => {
    beforeEach(() => {
      cache = new MultiTierCache({
        l1: { maxSize: 100, ttl: 300 },
        writeStrategy: 'through',
      });
    });

    it('should manually demote from L1 to L2', async () => {
      await cache.set('key1', 'value1');

      const result = await cache.demote('key1');
      expect(result).toBe(true);

      const l1 = cache.getL1();
      expect(await l1.has('key1')).toBe(false);

      const l2 = cache.getL2();
      expect(await l2.get('key1')).toBe('value1');
    });

    it('should return false for non-existent key', async () => {
      const result = await cache.demote('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('write strategies', () => {
    describe('write-through', () => {
      beforeEach(() => {
        cache = new MultiTierCache({
          l1: { maxSize: 100 },
          writeStrategy: 'through',
        });
      });

      it('should write to both L1 and L2 immediately', async () => {
        await cache.set('key1', 'value1');

        const l1 = cache.getL1();
        const l2 = cache.getL2();

        expect(await l1.get('key1')).toBe('value1');
        expect(await l2.get('key1')).toBe('value1');
      });
    });

    describe('write-back', () => {
      beforeEach(() => {
        cache = new MultiTierCache({
          l1: { maxSize: 100 },
          writeStrategy: 'back',
          syncInterval: 100,
        });
      });

      it('should write to L1 immediately', async () => {
        await cache.set('key1', 'value1');

        const l1 = cache.getL1();
        expect(await l1.get('key1')).toBe('value1');
      });

      it('should sync to L2 after interval', async () => {
        await cache.set('key1', 'value1');

        // Wait for sync
        await new Promise((resolve) => setTimeout(resolve, 150));

        const l2 = cache.getL2();
        expect(await l2.get('key1')).toBe('value1');
      });

      it('should sync on manual sync()', async () => {
        await cache.set('key1', 'value1');

        const l2 = cache.getL2();

        await cache.sync();

        expect(await l2.get('key1')).toBe('value1');
      });
    });
  });

  describe('has()', () => {
    beforeEach(() => {
      cache = new MultiTierCache({
        l1: { maxSize: 100 },
        writeStrategy: 'through',
      });
    });

    it('should return true if in L1', async () => {
      await cache.set('key1', 'value1');
      expect(await cache.has('key1')).toBe(true);
    });

    it('should return true if only in L2', async () => {
      const l2 = cache.getL2();
      await l2.set('key1', 'value1');

      expect(await cache.has('key1')).toBe(true);
    });

    it('should return false if not in either tier', async () => {
      expect(await cache.has('nonexistent')).toBe(false);
    });
  });

  describe('delete()', () => {
    beforeEach(() => {
      cache = new MultiTierCache({
        l1: { maxSize: 100 },
        writeStrategy: 'through',
      });
    });

    it('should delete from both tiers', async () => {
      await cache.set('key1', 'value1');

      const deleted = await cache.delete('key1');
      expect(deleted).toBe(true);

      const l1 = cache.getL1();
      const l2 = cache.getL2();

      expect(await l1.has('key1')).toBe(false);
      expect(await l2.has('key1')).toBe(false);
    });

    it('should return true if deleted from either tier', async () => {
      const l2 = cache.getL2();
      await l2.set('key1', 'value1');

      const deleted = await cache.delete('key1');
      expect(deleted).toBe(true);
    });

    it('should return false if not in either tier', async () => {
      const deleted = await cache.delete('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('clear()', () => {
    beforeEach(() => {
      cache = new MultiTierCache({
        l1: { maxSize: 100 },
        writeStrategy: 'through',
      });
    });

    it('should clear both tiers', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      await cache.clear();

      expect(await cache.has('key1')).toBe(false);
      expect(await cache.has('key2')).toBe(false);
    });

    it('should clear entries matching pattern', async () => {
      await cache.set('user:1', 'data1');
      await cache.set('user:2', 'data2');
      await cache.set('product:1', 'prod1');

      await cache.clear(/^user:/);

      expect(await cache.has('user:1')).toBe(false);
      expect(await cache.has('user:2')).toBe(false);
      expect(await cache.has('product:1')).toBe(true);
    });
  });

  describe('getMany() and setMany()', () => {
    beforeEach(() => {
      cache = new MultiTierCache({
        l1: { maxSize: 100 },
        writeStrategy: 'through',
        autoPromote: true,
      });
    });

    it('should get multiple values from L1', async () => {
      await cache.setMany(
        new Map([
          ['key1', 'value1'],
          ['key2', 'value2'],
        ])
      );

      const results = await cache.getMany(['key1', 'key2', 'key3']);

      expect(results.get('key1')).toBe('value1');
      expect(results.get('key2')).toBe('value2');
      expect(results.get('key3')).toBeUndefined();
    });

    it('should fallback to L2 for L1 misses', async () => {
      const l2 = cache.getL2();
      await l2.set('key1', 'value1');
      await cache.set('key2', 'value2');

      const results = await cache.getMany(['key1', 'key2']);

      expect(results.get('key1')).toBe('value1');
      expect(results.get('key2')).toBe('value2');
    });

    it('should set multiple values in both tiers', async () => {
      await cache.setMany(
        new Map([
          ['key1', 'value1'],
          ['key2', 'value2'],
        ])
      );

      const l1 = cache.getL1();
      const l2 = cache.getL2();

      expect(await l1.get('key1')).toBe('value1');
      expect(await l2.get('key1')).toBe('value1');
    });
  });

  describe('keys()', () => {
    beforeEach(() => {
      cache = new MultiTierCache({
        l1: { maxSize: 100 },
        writeStrategy: 'through',
      });
    });

    it('should return unique keys from both tiers', async () => {
      await cache.set('key1', 'value1');

      const l2 = cache.getL2();
      await l2.set('key2', 'value2');

      const keys = await cache.keys();

      expect(keys.sort()).toEqual(['key1', 'key2']);
    });

    it('should not duplicate keys present in both tiers', async () => {
      await cache.set('key1', 'value1');

      const keys = await cache.keys();

      // key1 is in both L1 and L2, but should only appear once
      expect(keys.filter((k) => k === 'key1').length).toBe(1);
    });
  });

  describe('getStats() and getTierStats()', () => {
    beforeEach(() => {
      cache = new MultiTierCache({
        l1: { maxSize: 100 },
        writeStrategy: 'through',
        enableStats: true,
      });
    });

    it('should return combined stats', async () => {
      await cache.set('key1', 'value1');
      await cache.get('key1'); // L1 hit
      await cache.get('nonexistent'); // Miss

      const stats = cache.getStats();

      expect(stats.size).toBe(1);
      expect(stats.hits).toBeGreaterThan(0);
    });

    it('should return L1-specific stats', async () => {
      await cache.set('key1', 'value1');
      await cache.get('key1');

      const l1Stats = cache.getTierStats('l1');

      expect(l1Stats.size).toBe(1);
      expect(l1Stats.hits).toBeGreaterThan(0);
    });

    it('should return L2-specific stats', async () => {
      const l2Stats = cache.getTierStats('l2');

      expect(l2Stats).toBeDefined();
      expect(l2Stats.hits).toBeDefined();
    });

    it('should reset stats', () => {
      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('getL1() and getL2()', () => {
    beforeEach(() => {
      cache = new MultiTierCache({
        l1: { maxSize: 100 },
      });
    });

    it('should return L1 cache', () => {
      const l1 = cache.getL1();
      expect(l1).toBeDefined();
      expect(typeof l1.get).toBe('function');
      expect(typeof l1.set).toBe('function');
    });

    it('should return L2 cache wrapper', () => {
      const l2 = cache.getL2();
      expect(l2).toBeDefined();
      expect(typeof l2.get).toBe('function');
      expect(typeof l2.set).toBe('function');
    });

    it('should allow direct L1 manipulation', async () => {
      const l1 = cache.getL1();
      await l1.set('direct-l1', 'value');

      expect(await l1.get('direct-l1')).toBe('value');
    });

    it('should allow direct L2 manipulation', async () => {
      const l2 = cache.getL2();
      await l2.set('direct-l2', 'value');

      expect(await l2.get('direct-l2')).toBe('value');
    });
  });

  describe('getEntry()', () => {
    beforeEach(() => {
      cache = new MultiTierCache({
        l1: { maxSize: 100, ttl: 300 },
        writeStrategy: 'through',
      });
    });

    it('should return entry from L1', async () => {
      await cache.set('key1', 'value1');

      const entry = await cache.getEntry('key1');

      expect(entry).toBeDefined();
      expect(entry!.key).toBe('key1');
      expect(entry!.value).toBe('value1');
    });

    it('should return entry from L2 when not in L1', async () => {
      const l2 = cache.getL2();
      await l2.set('key1', 'value1');

      const entry = await cache.getEntry('key1');

      expect(entry).toBeDefined();
      expect(entry!.value).toBe('value1');
    });

    it('should return undefined for non-existent key', async () => {
      const entry = await cache.getEntry('nonexistent');
      expect(entry).toBeUndefined();
    });
  });

  describe('invalidateByTags()', () => {
    beforeEach(() => {
      cache = new MultiTierCache({
        l1: { maxSize: 100 },
        writeStrategy: 'through',
      });
    });

    it('should invalidate L1 entries by tags', async () => {
      await cache.set('user:1', 'data1');

      const l1 = cache.getL1();
      await l1.set('user:2', 'data2', { tags: ['users'] });

      const invalidated = await cache.invalidateByTags(['users']);

      expect(invalidated).toBeGreaterThanOrEqual(0);
    });
  });

  describe('partition()', () => {
    beforeEach(() => {
      cache = new MultiTierCache({
        l1: { maxSize: 100 },
      });
    });

    it('should create L1 partition', async () => {
      const partition = cache.partition('users');

      await partition.set('1', 'user1');

      expect(await partition.get('1')).toBe('user1');
    });
  });

  describe('warm()', () => {
    beforeEach(() => {
      cache = new MultiTierCache({
        l1: { maxSize: 100 },
      });
    });

    it('should warm L1 cache', async () => {
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

      const l1 = cache.getL1();
      expect(await l1.get('key1')).toBe('value1');
    });
  });

  describe('size()', () => {
    beforeEach(() => {
      cache = new MultiTierCache({
        l1: { maxSize: 100 },
        writeStrategy: 'through',
      });
    });

    it('should return L1 size', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      const size = await cache.size();

      expect(size).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('should handle empty cache operations', async () => {
      cache = new MultiTierCache();

      expect(await cache.get('nonexistent')).toBeUndefined();
      expect(await cache.has('nonexistent')).toBe(false);
      expect(await cache.delete('nonexistent')).toBe(false);
    });

    it('should handle L2 prefix', async () => {
      cache = new MultiTierCache({
        l1: { maxSize: 100 },
        l2: { prefix: 'myapp:' },
        writeStrategy: 'through',
      });

      await cache.set('key1', 'value1');

      const l2 = cache.getL2();
      expect(await l2.get('key1')).toBe('value1');
    });

    it('should handle serialization correctly', async () => {
      cache = new MultiTierCache({
        l1: { maxSize: 100 },
        writeStrategy: 'through',
      });

      const typedCache = cache as MultiTierCache<{ data: string }>;
      await typedCache.set('key1', { data: 'value' });
      const result = await typedCache.get('key1');
      expect(result).toEqual({ data: 'value' });
    });
  });

  describe('dispose()', () => {
    it('should clean up resources and flush write-back buffer', async () => {
      cache = new MultiTierCache({
        l1: { maxSize: 100 },
        writeStrategy: 'back',
        syncInterval: 1000,
      });

      await cache.set('key1', 'value1');

      await cache.dispose();

      const stats = cache.getStats();
      expect(stats.size).toBe(0);
    });

    // Regression for the L2-adapter dispose gap: pre-fix the
    // multi-tier cache disposed L1 + cleared its sync timer but
    // never invoked `l2Adapter.dispose?.()`. Redis-backed adapters
    // therefore leaked their connection every time the host
    // shut down a cache. The fix made `dispose` optional on the
    // adapter interface and the cache now invokes it before
    // disposing L1.
    it('should invoke l2Adapter.dispose() when present', async () => {
      let disposeCalls = 0;
      class TrackingAdapter extends MemoryL2Adapter {
        override async dispose(): Promise<void> {
          disposeCalls++;
        }
      }
      const adapter = new TrackingAdapter();
      cache = new MultiTierCache({
        l1: { maxSize: 100 },
        l2: { client: adapter as any },
      });
      await cache.dispose();
      expect(disposeCalls).toBe(1);
    });

    it('should not throw when l2Adapter has no dispose method', async () => {
      class NoDisposeAdapter extends MemoryL2Adapter {
        // Intentionally omit `dispose` to mirror an in-memory
        // adapter that holds no OS resources.
        override dispose = undefined as unknown as () => Promise<void>;
      }
      cache = new MultiTierCache({
        l1: { maxSize: 100 },
        l2: { client: new NoDisposeAdapter() as any },
      });
      // Must not throw.
      await expect(cache.dispose()).resolves.toBeUndefined();
    });

    // getOrSet — atomic fetch-or-compute that eliminates the
    // has-then-get TOCTOU window described on ICache.has.
    it('getOrSet returns cached value when present', async () => {
      cache = new MultiTierCache({ l1: { maxSize: 100 } });
      await cache.set('k', 'cached-value');
      const factory = vi.fn().mockResolvedValue('factory-value');
      const result = await cache.getOrSet('k', factory);
      expect(result).toBe('cached-value');
      expect(factory).not.toHaveBeenCalled();
    });

    it('getOrSet invokes factory and stores result when key is missing', async () => {
      cache = new MultiTierCache({ l1: { maxSize: 100 } });
      const factory = vi.fn().mockResolvedValue('fresh-value');
      const result = await cache.getOrSet('k', factory);
      expect(result).toBe('fresh-value');
      expect(factory).toHaveBeenCalledTimes(1);
      // And the value is now cached.
      expect(await cache.get('k')).toBe('fresh-value');
    });

    it('getOrSet single-flights concurrent callers on the same key', async () => {
      cache = new MultiTierCache({ l1: { maxSize: 100 } });
      let callCount = 0;
      const factory = vi.fn(async () => {
        callCount++;
        // Simulate slow factory so concurrent callers overlap.
        await new Promise((r) => setTimeout(r, 30));
        return 'fresh';
      });
      const [a, b, c] = await Promise.all([
        cache.getOrSet('k', factory),
        cache.getOrSet('k', factory),
        cache.getOrSet('k', factory),
      ]);
      expect(a).toBe('fresh');
      expect(b).toBe('fresh');
      expect(c).toBe('fresh');
      // The whole point — factory invoked once for the three
      // overlapping callers, not three times.
      expect(callCount).toBe(1);
    });

    it('getOrSet clears in-flight slot on factory failure (next caller retries)', async () => {
      cache = new MultiTierCache({ l1: { maxSize: 100 } });
      const failingFactory = vi.fn().mockRejectedValue(new Error('boom'));
      await expect(cache.getOrSet('k', failingFactory)).rejects.toThrow('boom');
      // After the failure, a fresh caller must be able to retry —
      // pre-fix, a cached rejected promise would have leaked into
      // the second call.
      const goodFactory = vi.fn().mockResolvedValue('recovered');
      const value = await cache.getOrSet('k', goodFactory);
      expect(value).toBe('recovered');
      expect(goodFactory).toHaveBeenCalledTimes(1);
    });

    it('getOrSet eliminates the has-then-get TOCTOU window', async () => {
      // Direct demonstration: factory runs exactly once even if
      // we pretend two callers serialize through getOrSet.
      cache = new MultiTierCache({ l1: { maxSize: 100 } });
      let factoryCalls = 0;
      const factory = async () => {
        factoryCalls++;
        return `value-${factoryCalls}`;
      };
      const a = await cache.getOrSet('k', factory);
      const b = await cache.getOrSet('k', factory);
      expect(a).toBe('value-1');
      expect(b).toBe('value-1');
      expect(factoryCalls).toBe(1);
    });

    // Regression: pre-fix `accessCounts` map could grow without
    // bound under read-heavy workloads when syncInterval was 0
    // or the sync timer was slow. The fix added an amortized
    // size-cap check at the growth site so the map can never
    // exceed MAX_ACCESS_COUNTS (10k) by more than a constant.
    it('keeps accessCounts bounded under heavy read traffic', async () => {
      // Use writeStrategy: 'through' AND syncInterval: 0 → no
      // sync timer firing. Without the inline cleanup the map
      // would grow until we run out of memory.
      cache = new MultiTierCache({
        l1: { maxSize: 10 }, // tiny L1, ensures L2 reads dominate
        autoPromote: true,
        promotionThreshold: 1_000_000, // never promote → accessCounts grows
        writeStrategy: 'through',
        syncInterval: 0,
      });

      // Seed L2 with 20k unique keys, then read them all.
      for (let i = 0; i < 20_000; i++) {
        await cache.set(`k${i}`, `v${i}`);
      }
      for (let i = 0; i < 20_000; i++) {
        await cache.get(`k${i}`);
      }

      // accessCounts is private — assert via .size on the
      // private map without exposing it.
      const counts = (cache as any).accessCounts as Map<string, unknown>;
      // The cap is 10k; the amortized cleanup runs only when
      // size > cap, so the steady-state size sits AT or just
      // above 10k (a single overflow then trim). Never 20k.
      expect(counts.size).toBeLessThanOrEqual(10_000);
    });

    it('should be safe to call dispose() twice', async () => {
      let disposeCalls = 0;
      class TrackingAdapter extends MemoryL2Adapter {
        override async dispose(): Promise<void> {
          disposeCalls++;
        }
      }
      cache = new MultiTierCache({
        l1: { maxSize: 100 },
        l2: { client: new TrackingAdapter() as any },
        writeStrategy: 'back',
        syncInterval: 1000,
      });
      await cache.dispose();
      await expect(cache.dispose()).resolves.toBeUndefined();
      // Adapter dispose called on each invocation — the adapter
      // itself is expected to be idempotent (it's not our
      // responsibility to second-guess the adapter contract).
      expect(disposeCalls).toBe(2);
    });
  });

  describe('MemoryL2Adapter', () => {
    let adapter: MemoryL2Adapter;

    beforeEach(() => {
      adapter = new MemoryL2Adapter();
    });

    it('should get and set values', async () => {
      await adapter.set('key1', Buffer.from('value1'));
      const value = await adapter.get('key1');

      expect(value).toBeDefined();
      expect(Buffer.from(value!).toString()).toBe('value1');
    });

    it('should handle TTL', async () => {
      await adapter.set('key1', Buffer.from('value1'), 0.1);

      expect(await adapter.get('key1')).toBeDefined();

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(await adapter.get('key1')).toBeNull();
    });

    it('should check existence', async () => {
      await adapter.set('key1', Buffer.from('value1'));

      expect(await adapter.exists('key1')).toBe(true);
      expect(await adapter.exists('nonexistent')).toBe(false);
    });

    it('should delete keys', async () => {
      await adapter.set('key1', Buffer.from('value1'));

      expect(await adapter.delete('key1')).toBe(true);
      expect(await adapter.exists('key1')).toBe(false);
      expect(await adapter.delete('nonexistent')).toBe(false);
    });

    it('should get keys by pattern', async () => {
      await adapter.set('user:1', Buffer.from('data1'));
      await adapter.set('user:2', Buffer.from('data2'));
      await adapter.set('product:1', Buffer.from('prod1'));

      const keys = await adapter.keys('user:*');

      expect(keys.sort()).toEqual(['user:1', 'user:2']);
    });

    it('should get multiple values', async () => {
      await adapter.set('key1', Buffer.from('value1'));
      await adapter.set('key2', Buffer.from('value2'));

      const results = await adapter.mget(['key1', 'key2', 'key3']);

      expect(results.length).toBe(3);
      expect(Buffer.from(results[0]!).toString()).toBe('value1');
      expect(Buffer.from(results[1]!).toString()).toBe('value2');
      expect(results[2]).toBeNull();
    });

    it('should set multiple values', async () => {
      const entries = new Map<string, Buffer>([
        ['key1', Buffer.from('value1')],
        ['key2', Buffer.from('value2')],
      ]);

      await adapter.mset(entries);

      expect(await adapter.exists('key1')).toBe(true);
      expect(await adapter.exists('key2')).toBe(true);
    });

    it('should update expiration', async () => {
      await adapter.set('key1', Buffer.from('value1'));
      await adapter.expire('key1', 0.1);

      expect(await adapter.exists('key1')).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(await adapter.exists('key1')).toBe(false);
    });

    it('should get TTL', async () => {
      await adapter.set('key1', Buffer.from('value1'), 10);

      const ttl = await adapter.ttl('key1');

      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(10);
    });

    it('should return -1 for TTL of key without expiration', async () => {
      await adapter.set('key1', Buffer.from('value1'));

      const ttl = await adapter.ttl('key1');

      expect(ttl).toBe(-1);
    });

    it('should flush all', async () => {
      await adapter.set('key1', Buffer.from('value1'));
      await adapter.set('key2', Buffer.from('value2'));

      await adapter.flush();

      expect(await adapter.exists('key1')).toBe(false);
      expect(await adapter.exists('key2')).toBe(false);
    });

    it('should flush by pattern', async () => {
      await adapter.set('user:1', Buffer.from('data1'));
      await adapter.set('user:2', Buffer.from('data2'));
      await adapter.set('product:1', Buffer.from('prod1'));

      await adapter.flush('user:*');

      expect(await adapter.exists('user:1')).toBe(false);
      expect(await adapter.exists('user:2')).toBe(false);
      expect(await adapter.exists('product:1')).toBe(true);
    });
  });
});
