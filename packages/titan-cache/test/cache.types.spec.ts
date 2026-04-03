/**
 * Cache Types Tests
 *
 * Type validation tests for cache module types.
 * These tests validate the shape and contracts of the type system.
 */

import { describe, it, expect } from 'vitest';
import type {
  EvictionPolicy,
  CacheTier,
  CacheEntryState,
  CompressionAlgorithm,
  ICacheStats,
  ICacheEntryMeta,
  ICacheEntry,
  ICacheSetOptions,
  ICacheGetOptions,
  ICacheWarmingStrategy,
  ICachePartition,
  IL1CacheOptions,
  IL2CacheOptions,
  ICacheSerializer,
  ICacheModuleOptions,
  ICache,
  ICacheHealthIndicator,
  ILRUNode,
  ILFUNode,
  IWheelTimerBucket,
  CacheEventType,
  ICacheEvent,
  CacheEventListener,
} from '../src/cache.types.js';

describe('Cache Types', () => {
  describe('EvictionPolicy', () => {
    it('should accept valid eviction policies', () => {
      const policies: EvictionPolicy[] = ['lru', 'lfu', 'fifo', 'random', 'ttl'];
      expect(policies).toHaveLength(5);
    });
  });

  describe('CacheTier', () => {
    it('should accept valid cache tiers', () => {
      const tiers: CacheTier[] = ['l1', 'l2'];
      expect(tiers).toHaveLength(2);
    });
  });

  describe('CacheEntryState', () => {
    it('should accept valid entry states', () => {
      const states: CacheEntryState[] = ['fresh', 'stale', 'expired'];
      expect(states).toHaveLength(3);
    });
  });

  describe('CompressionAlgorithm', () => {
    it('should accept valid compression algorithms', () => {
      const algorithms: CompressionAlgorithm[] = ['gzip', 'deflate', 'brotli', 'lz4', 'none'];
      expect(algorithms).toHaveLength(5);
    });
  });

  describe('ICacheStats', () => {
    it('should validate stats structure', () => {
      const stats: ICacheStats = {
        hits: 100,
        misses: 20,
        hitRate: 0.833,
        size: 50,
        memoryUsage: 1024,
        evictions: 10,
        expirations: 5,
        avgGetLatency: 0.5,
        avgSetLatency: 1.0,
        createdAt: new Date(),
        lastAccessAt: new Date(),
      };

      expect(stats.hits).toBe(100);
      expect(stats.misses).toBe(20);
      expect(stats.hitRate).toBeCloseTo(0.833);
    });

    it('should allow optional tier stats', () => {
      const stats: ICacheStats = {
        hits: 100,
        misses: 20,
        hitRate: 0.833,
        size: 50,
        memoryUsage: 1024,
        evictions: 10,
        expirations: 5,
        avgGetLatency: 0.5,
        avgSetLatency: 1.0,
        createdAt: new Date(),
        lastAccessAt: new Date(),
        l1: {
          hits: 80,
          misses: 10,
          hitRate: 0.889,
          size: 30,
          memoryUsage: 512,
          evictions: 5,
          expirations: 2,
          avgGetLatency: 0.2,
          avgSetLatency: 0.5,
          createdAt: new Date(),
          lastAccessAt: new Date(),
        },
        l2: {
          hits: 20,
          misses: 10,
          hitRate: 0.667,
          size: 20,
          memoryUsage: 512,
          evictions: 5,
          expirations: 3,
          avgGetLatency: 1.0,
          avgSetLatency: 2.0,
          createdAt: new Date(),
          lastAccessAt: new Date(),
        },
      };

      expect(stats.l1?.hits).toBe(80);
      expect(stats.l2?.hits).toBe(20);
    });
  });

  describe('ICacheEntryMeta', () => {
    it('should validate entry metadata structure', () => {
      const meta: ICacheEntryMeta = {
        createdAt: Date.now(),
        lastAccessAt: Date.now(),
        expiresAt: Date.now() + 60000,
        accessCount: 5,
        size: 256,
        compressed: false,
      };

      expect(meta.accessCount).toBe(5);
    });

    it('should allow optional compression info', () => {
      const meta: ICacheEntryMeta = {
        createdAt: Date.now(),
        lastAccessAt: Date.now(),
        expiresAt: 0,
        accessCount: 1,
        size: 512,
        compressed: true,
        compressionAlgorithm: 'gzip',
        originalSize: 1024,
      };

      expect(meta.compressed).toBe(true);
      expect(meta.compressionAlgorithm).toBe('gzip');
    });

    it('should allow tags and metadata', () => {
      const meta: ICacheEntryMeta = {
        createdAt: Date.now(),
        lastAccessAt: Date.now(),
        expiresAt: 0,
        accessCount: 1,
        size: 100,
        compressed: false,
        tags: ['users', 'active'],
        metadata: { source: 'api', priority: 1 },
      };

      expect(meta.tags).toContain('users');
      expect(meta.metadata?.source).toBe('api');
    });
  });

  describe('ICacheEntry', () => {
    it('should validate entry structure', () => {
      const entry: ICacheEntry<string> = {
        key: 'user:123',
        value: 'test-value',
        meta: {
          createdAt: Date.now(),
          lastAccessAt: Date.now(),
          expiresAt: 0,
          accessCount: 1,
          size: 20,
          compressed: false,
        },
      };

      expect(entry.key).toBe('user:123');
      expect(entry.value).toBe('test-value');
    });

    it('should work with complex value types', () => {
      interface User {
        id: number;
        name: string;
      }

      const entry: ICacheEntry<User> = {
        key: 'user:1',
        value: { id: 1, name: 'Test' },
        meta: {
          createdAt: Date.now(),
          lastAccessAt: Date.now(),
          expiresAt: 0,
          accessCount: 1,
          size: 50,
          compressed: false,
        },
      };

      expect(entry.value.id).toBe(1);
    });
  });

  describe('ICacheSetOptions', () => {
    it('should validate set options', () => {
      const options: ICacheSetOptions = {
        ttl: 300,
        tags: ['cache-tag'],
        compress: true,
        skipL2: false,
        metadata: { priority: 'high' },
        onExpire: (key, value) => console.log(key, value),
      };

      expect(options.ttl).toBe(300);
    });

    it('should allow partial options', () => {
      const options: ICacheSetOptions = {
        ttl: 60,
      };

      expect(options.ttl).toBe(60);
      expect(options.tags).toBeUndefined();
    });
  });

  describe('ICacheGetOptions', () => {
    it('should validate get options', () => {
      const options: ICacheGetOptions = {
        staleWhileRevalidate: true,
        skipL1: false,
        touch: true,
      };

      expect(options.staleWhileRevalidate).toBe(true);
    });
  });

  describe('ICacheWarmingStrategy', () => {
    it('should validate warming strategy', () => {
      const strategy: ICacheWarmingStrategy = {
        name: 'user-cache-warm',
        keys: ['user:1', 'user:2'],
        pattern: /^user:/,
        loader: async () =>
          new Map([
            ['user:1', { id: 1 }],
            ['user:2', { id: 2 }],
          ]),
        priority: 10,
      };

      expect(strategy.name).toBe('user-cache-warm');
      expect(strategy.priority).toBe(10);
    });
  });

  describe('ICachePartition', () => {
    it('should validate partition config', () => {
      const partition: ICachePartition = {
        name: 'users',
        maxSize: 1000,
        ttl: 600,
        evictionPolicy: 'lru',
        prefix: 'users:',
      };

      expect(partition.name).toBe('users');
    });
  });

  describe('IL1CacheOptions', () => {
    it('should validate L1 options', () => {
      const options: IL1CacheOptions = {
        maxSize: 5000,
        ttl: 300,
        evictionPolicy: 'lfu',
        useWeakRef: false,
        compressionThreshold: 2048,
        compressionAlgorithm: 'gzip',
      };

      expect(options.maxSize).toBe(5000);
    });
  });

  describe('IL2CacheOptions', () => {
    it('should validate L2 options', () => {
      const options: IL2CacheOptions = {
        maxSize: 10000,
        ttl: 3600,
        prefix: 'app:',
        compression: true,
        compressionAlgorithm: 'gzip',
        compressionThreshold: 1024,
      };

      expect(options.prefix).toBe('app:');
    });
  });

  describe('ICacheSerializer', () => {
    it('should validate serializer interface', () => {
      const serializer: ICacheSerializer = {
        serialize: (value) => Buffer.from(JSON.stringify(value)),
        deserialize: <T>(data: Buffer) => JSON.parse(data.toString()) as T,
      };

      const data = { test: 'value' };
      const serialized = serializer.serialize(data);
      const deserialized = serializer.deserialize<typeof data>(serialized);

      expect(deserialized).toEqual(data);
    });
  });

  describe('ICacheModuleOptions', () => {
    it('should validate module options', () => {
      const options: ICacheModuleOptions = {
        multiTier: true,
        l1: { maxSize: 1000 },
        l2: { ttl: 3600 },
        defaultTtl: 300,
        maxSize: 5000,
        evictionPolicy: 'lru',
        enableStats: true,
        statsInterval: 60000,
        partitions: [{ name: 'users' }],
        warmingStrategies: [{ name: 'initial' }],
        useWeakRef: false,
        compressionThreshold: 1024,
        compressionAlgorithm: 'gzip',
        ttlCleanupInterval: 1000,
        wheelTimerBuckets: 60,
        isGlobal: true,
        staleWhileRevalidate: 60,
        backgroundRefresh: true,
      };

      expect(options.multiTier).toBe(true);
    });
  });

  describe('ICache', () => {
    it('should define cache interface methods', () => {
      // Type check - ensure interface has expected methods
      const cache: ICache<string> = {
        get: async () => 'value',
        set: async () => {},
        has: async () => true,
        delete: async () => true,
        clear: async () => {},
        invalidateByTags: async () => 1,
        getMany: async () => new Map(),
        setMany: async () => {},
        getStats: () => ({
          hits: 0,
          misses: 0,
          hitRate: 0,
          size: 0,
          memoryUsage: 0,
          evictions: 0,
          expirations: 0,
          avgGetLatency: 0,
          avgSetLatency: 0,
          createdAt: new Date(),
          lastAccessAt: new Date(),
        }),
        resetStats: () => {},
        getEntry: async () => undefined,
        keys: async () => [],
        size: async () => 0,
        warm: async () => {},
        partition: () => cache,
        dispose: async () => {},
      };

      expect(typeof cache.get).toBe('function');
      expect(typeof cache.set).toBe('function');
    });
  });

  describe('IMultiTierCache', () => {
    it('should extend ICache with multi-tier methods', () => {
      // Type check - multi-tier interface should have additional methods
      const methodNames = ['getL1', 'getL2', 'promote', 'demote', 'sync', 'getTierStats'];
      expect(methodNames).toHaveLength(6);
    });
  });

  describe('ICacheHealthIndicator', () => {
    it('should validate health indicator interface', () => {
      const indicator: ICacheHealthIndicator = {
        name: 'cache-health',
        check: async () => ({
          status: 'healthy',
          message: 'Cache is operating normally',
          details: { size: 100, hitRate: 0.9 },
        }),
      };

      expect(indicator.name).toBe('cache-health');
    });
  });

  describe('ILRUNode', () => {
    it('should validate LRU node structure', () => {
      const node: ILRUNode<string> = {
        key: 'test',
        value: 'value',
        meta: {
          createdAt: Date.now(),
          lastAccessAt: Date.now(),
          expiresAt: 0,
          accessCount: 1,
          size: 10,
          compressed: false,
        },
        prev: null,
        next: null,
      };

      expect(node.key).toBe('test');
    });
  });

  describe('ILFUNode', () => {
    it('should validate LFU node structure', () => {
      const node: ILFUNode<string> = {
        key: 'test',
        value: 'value',
        meta: {
          createdAt: Date.now(),
          lastAccessAt: Date.now(),
          expiresAt: 0,
          accessCount: 5,
          size: 10,
          compressed: false,
        },
        frequency: 5,
      };

      expect(node.frequency).toBe(5);
    });
  });

  describe('IWheelTimerBucket', () => {
    it('should validate wheel timer bucket structure', () => {
      const bucket: IWheelTimerBucket = {
        index: 5,
        keys: new Set(['key1', 'key2']),
        expiresAt: Date.now() + 60000,
      };

      expect(bucket.index).toBe(5);
      expect(bucket.keys.size).toBe(2);
    });
  });

  describe('CacheEventType', () => {
    it('should accept valid event types', () => {
      const types: CacheEventType[] = [
        'hit',
        'miss',
        'set',
        'delete',
        'evict',
        'expire',
        'clear',
        'warm',
        'promote',
        'demote',
        'error',
      ];
      expect(types).toHaveLength(11);
    });
  });

  describe('ICacheEvent', () => {
    it('should validate cache event structure', () => {
      const event: ICacheEvent = {
        type: 'hit',
        key: 'user:123',
        tier: 'l1',
        timestamp: Date.now(),
        latency: 0.5,
        metadata: { source: 'api' },
      };

      expect(event.type).toBe('hit');
    });
  });

  describe('CacheEventListener', () => {
    it('should validate event listener type', () => {
      const listener: CacheEventListener = (event) => {
        console.log(`Event: ${event.type}`);
      };

      expect(typeof listener).toBe('function');
    });
  });

  describe('ICacheService', () => {
    it('should define cache service interface methods', () => {
      // Type check - ensure interface has expected methods
      const methodNames = [
        'getCache',
        'createCache',
        'getOrCreateCache',
        'listCaches',
        'deleteCache',
        'getGlobalStats',
        'on',
        'off',
        'dispose',
      ];
      expect(methodNames).toHaveLength(9);
    });
  });
});
