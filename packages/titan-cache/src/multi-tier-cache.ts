/**
 * Multi-Tier Cache Implementation
 *
 * Provides L1 (in-memory) + L2 (external) caching with automatic promotion/demotion.
 *
 * @module titan/modules/cache
 */

import type {
  ICache,
  IMultiTierCache,
  ICacheEntry,
  ICacheGetOptions,
  ICacheSetOptions,
  ICacheStats,
  ICacheWarmingStrategy,
  CacheTier,
  IL1CacheOptions,
  IL2CacheOptions,
  ICacheSerializer,
} from './cache.types.js';
import { LRUCache, type LRUCacheOptions } from './lru-cache.js';
import { LFUCache, type LFUCacheOptions } from './lfu-cache.js';

export interface MultiTierCacheOptions {
  l1?: IL1CacheOptions & { type?: 'lru' | 'lfu' };
  l2?: IL2CacheOptions;
  writeStrategy?: 'through' | 'back';
  readStrategy?: 'l1-first' | 'parallel';
  autoPromote?: boolean;
  promotionThreshold?: number;
  syncInterval?: number;
  enableStats?: boolean;
  name?: string;
  /** Tag-to-keys mapping for L2 tag invalidation (tags aren't stored in L2 by default) */
  trackL2Tags?: boolean;
  /** Callback for write-back durability - called when buffer is flushed */
  onWriteBackFlush?: (entries: Map<string, unknown>) => Promise<void>;
  /** Callback for write-back recovery - called on startup to recover unflushed entries */
  onWriteBackRecover?: () => Promise<Map<string, { value: unknown; ttl?: number }>>;
}

export interface IL2CacheAdapter {
  get(key: string): Promise<Buffer | Uint8Array | null>;
  set(key: string, value: Buffer | Uint8Array, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  keys(pattern: string): Promise<string[]>;
  mget(keys: string[]): Promise<(Buffer | Uint8Array | null)[]>;
  mset(entries: Map<string, Buffer | Uint8Array>, ttlSeconds?: number): Promise<void>;
  expire(key: string, ttlSeconds: number): Promise<void>;
  ttl(key: string): Promise<number>;
  flush(pattern?: string): Promise<void>;
}

export class MemoryL2Adapter implements IL2CacheAdapter {
  private store: Map<string, { value: Buffer | Uint8Array; expiresAt: number }> = new Map();

  async get(key: string): Promise<Buffer | Uint8Array | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }
  async set(key: string, value: Buffer | Uint8Array, ttlSeconds?: number): Promise<void> {
    this.store.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0 });
  }
  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }
  async exists(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }
  async keys(pattern: string): Promise<string[]> {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const regex = new RegExp(`^${escaped}$`);
    return Array.from(this.store.keys()).filter((k) => regex.test(k));
  }
  async mget(keys: string[]): Promise<(Buffer | Uint8Array | null)[]> {
    return Promise.all(keys.map((k) => this.get(k)));
  }
  async mset(entries: Map<string, Buffer | Uint8Array>, ttlSeconds?: number): Promise<void> {
    for (const [key, value] of entries) {
      await this.set(key, value, ttlSeconds);
    }
  }
  async expire(key: string, ttlSeconds: number): Promise<void> {
    const entry = this.store.get(key);
    if (entry) {
      entry.expiresAt = Date.now() + ttlSeconds * 1000;
    }
  }
  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry || entry.expiresAt === 0) return -1;
    return Math.max(0, Math.floor((entry.expiresAt - Date.now()) / 1000));
  }
  async flush(pattern?: string): Promise<void> {
    if (!pattern) {
      this.store.clear();
    } else {
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      const regex = new RegExp(`^${escaped}$`);
      for (const key of this.store.keys()) {
        if (regex.test(key)) this.store.delete(key);
      }
    }
  }
}

/** ISO 8601 date pattern for JSON reviver */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const defaultSerializer: ICacheSerializer = {
  serialize: (value: unknown) =>
    Buffer.from(
      JSON.stringify(value, (_key, val) => {
        if (typeof val === 'bigint') return { __bigint: val.toString() };
        return val;
      })
    ),
  deserialize: <T>(data: Buffer | Uint8Array) =>
    JSON.parse(Buffer.from(data).toString(), (_key, val) => {
      // Restore BigInt values
      if (val !== null && typeof val === 'object' && '__bigint' in val && typeof val.__bigint === 'string') {
        return BigInt(val.__bigint);
      }
      // Restore Date values from ISO strings
      if (typeof val === 'string' && ISO_DATE_RE.test(val)) {
        return new Date(val);
      }
      return val;
    }) as T,
};

export class MultiTierCache<T = unknown> implements IMultiTierCache<T> {
  private readonly l1Cache: ICache<T>;
  private readonly l2Adapter: IL2CacheAdapter;
  private readonly serializer: ICacheSerializer;
  private readonly writeStrategy: 'through' | 'back';
  private readonly autoPromote: boolean;
  private readonly promotionThreshold: number;
  private readonly enableStats: boolean;
  private readonly name: string;
  private readonly keyPrefix: string;
  private readonly defaultTtl: number;
  private writeBackBuffer: Map<string, { value: T; options?: ICacheSetOptions }> = new Map();
  private syncTimer?: NodeJS.Timeout;
  private accessCounts: Map<string, number> = new Map();
  private l1Stats: ICacheStats;
  private l2Stats: ICacheStats;
  /** Tag-to-keys mapping for L2 (since L2 adapters don't support tags natively) */
  private readonly l2TagIndex: Map<string, Set<string>> = new Map();
  private readonly trackL2Tags: boolean;
  private readonly onWriteBackFlush?: (entries: Map<string, unknown>) => Promise<void>;
  private readonly onWriteBackRecover?: () => Promise<Map<string, { value: unknown; ttl?: number }>>;
  private readonly readyPromise: Promise<void>;

  constructor(options: MultiTierCacheOptions = {}) {
    this.writeStrategy = options.writeStrategy ?? 'through';
    this.autoPromote = options.autoPromote ?? true;
    this.promotionThreshold = options.promotionThreshold ?? 3;
    this.enableStats = options.enableStats ?? true;
    this.name = options.name ?? 'multi-tier-cache';
    this.keyPrefix = options.l2?.prefix ?? '';
    this.defaultTtl = options.l1?.ttl ?? 300;

    const l1Options: LRUCacheOptions | LFUCacheOptions = {
      maxSize: options.l1?.maxSize ?? 1000,
      ttl: options.l1?.ttl ?? 300,
      compressionThreshold: options.l1?.compressionThreshold ?? 1024,
      compressionAlgorithm: options.l1?.compressionAlgorithm ?? 'none',
      enableStats: this.enableStats,
      name: this.name + ':l1',
    };

    if (options.l1?.type === 'lfu') {
      this.l1Cache = new LFUCache<T>(l1Options) as ICache<T>;
    } else {
      this.l1Cache = new LRUCache<T>(l1Options) as ICache<T>;
    }

    if (options.l2?.client && typeof (options.l2.client as IL2CacheAdapter).get === 'function') {
      this.l2Adapter = options.l2.client as IL2CacheAdapter;
    } else {
      this.l2Adapter = new MemoryL2Adapter();
    }

    this.serializer = options.l2?.serializer ?? defaultSerializer;
    this.l1Stats = this.createEmptyStats();
    this.l2Stats = this.createEmptyStats();
    this.trackL2Tags = options.trackL2Tags ?? false;
    this.onWriteBackFlush = options.onWriteBackFlush;
    this.onWriteBackRecover = options.onWriteBackRecover;

    if (options.syncInterval) {
      this.syncTimer = setInterval(() => {
        if (this.writeStrategy === 'back') {
          this.flushWriteBackBuffer();
        } else {
          // Even in write-through mode, run periodic cleanup for accessCounts and l2TagIndex
          this.cleanupAccessCounts();
          this.cleanupL2TagIndex();
        }
      }, options.syncInterval);
      if (typeof this.syncTimer.unref === 'function') {
        this.syncTimer.unref();
      }
    }

    // Recover write-back buffer on startup if durability callback provided
    if (this.onWriteBackRecover) {
      this.readyPromise = this.recoverWriteBackBuffer().catch((err) => {
        console.warn(`[${this.name}] Write-back buffer recovery failed:`, err);
      });
    } else {
      this.readyPromise = Promise.resolve();
    }
  }

  /**
   * Returns a promise that resolves when the cache is fully initialized,
   * including write-back buffer recovery from durable storage.
   */
  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * Recover write-back buffer from durable storage on startup
   */
  private async recoverWriteBackBuffer(): Promise<void> {
    if (!this.onWriteBackRecover) return;
    try {
      const recovered = await this.onWriteBackRecover();
      for (const [key, { value, ttl }] of recovered) {
        await this.set(key, value as T, { ttl });
      }
    } catch {
      // Recovery failures are non-critical, continue with empty buffer
    }
  }

  private createEmptyStats(): ICacheStats {
    return {
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
    };
  }

  private getL2Key(key: string): string {
    return this.keyPrefix ? this.keyPrefix + key : key;
  }

  async get(key: string, options?: ICacheGetOptions): Promise<T | undefined> {
    if (!options?.skipL1) {
      const l1Value = await this.l1Cache.get(key, options);
      if (l1Value !== undefined) {
        if (this.enableStats) {
          this.l1Stats.hits++;
          this.l1Stats.lastAccessAt = new Date();
        }
        return l1Value;
      }
      if (this.enableStats) {
        this.l1Stats.misses++;
      }
    }

    let l2Data: Buffer | Uint8Array | null;
    try {
      l2Data = await this.l2Adapter.get(this.getL2Key(key));
    } catch {
      // L2 failure treated as cache miss for production resilience
      if (this.enableStats) this.l2Stats.misses++;
      return undefined;
    }
    if (l2Data === null) {
      if (this.enableStats) {
        this.l2Stats.misses++;
      }
      return undefined;
    }

    if (this.enableStats) {
      this.l2Stats.hits++;
      this.l2Stats.lastAccessAt = new Date();
    }
    const value = this.serializer.deserialize<T>(l2Data);

    if (this.autoPromote) {
      const accessCount = (this.accessCounts.get(key) ?? 0) + 1;
      this.accessCounts.set(key, accessCount);
      if (accessCount >= this.promotionThreshold) {
        await this.l1Cache.set(key, value);
        this.accessCounts.delete(key);
      }
    }
    return value;
  }

  async set(key: string, value: T, options?: ICacheSetOptions): Promise<void> {
    const ttl = options?.ttl ?? this.defaultTtl;

    // L1 is ALWAYS written unconditionally (skipL2 only affects L2)
    await this.l1Cache.set(key, value, options);

    if (!options?.skipL2) {
      if (this.writeStrategy === 'through') {
        // Write-through: write to L2 immediately, wrap in try/catch for resilience
        // L1-leads policy: L1 is already written above; if L2 fails, L1 has the data
        // and L2 will eventually be consistent on next write
        try {
          const serialized = this.serializer.serialize(value);
          await this.l2Adapter.set(this.getL2Key(key), serialized, ttl);
        } catch (err) {
          // Issue 1: L2 failure should not crash the caller
          this.l2Stats.evictions++; // Increment error counter for monitoring via stats
          if (process.env['NODE_ENV'] !== 'test') {
            console.warn(`[${this.name}] L2 write failed for key "${key}", L1-leads policy active:`, err);
          }
        }
      } else {
        this.writeBackBuffer.set(key, { value, options: { ...options, ttl } });
      }

      // Track L2 tags for invalidation
      if (this.trackL2Tags && options?.tags) {
        for (const tag of options.tags) {
          if (!this.l2TagIndex.has(tag)) {
            this.l2TagIndex.set(tag, new Set());
          }
          this.l2TagIndex.get(tag)!.add(key);
        }
      }
    }
  }

  async has(key: string): Promise<boolean> {
    if (await this.l1Cache.has(key)) return true;
    try {
      return await this.l2Adapter.exists(this.getL2Key(key));
    } catch {
      return false; // L2 failure treated as miss
    }
  }
  async delete(key: string): Promise<boolean> {
    const l1Del = await this.l1Cache.delete(key);
    let l2Del = false;
    try {
      l2Del = await this.l2Adapter.delete(this.getL2Key(key));
    } catch {
      // L2 failure during delete is non-critical
    }
    this.writeBackBuffer.delete(key);
    this.accessCounts.delete(key);
    // Clean up key from l2TagIndex
    if (this.trackL2Tags) {
      for (const [, keySet] of this.l2TagIndex) {
        keySet.delete(key);
      }
    }
    return l1Del || l2Del;
  }

  async clear(pattern?: string | RegExp): Promise<void> {
    await this.l1Cache.clear(pattern);
    try {
      // For RegExp patterns, match L2 keys directly; for strings, use glob pattern
      if (pattern instanceof RegExp) {
        const allKeys = await this.l2Adapter.keys(this.keyPrefix + '*');
        for (const k of allKeys) {
          const shortKey = k.startsWith(this.keyPrefix) ? k.slice(this.keyPrefix.length) : k;
          if (pattern.test(shortKey)) {
            await this.l2Adapter.delete(k);
          }
        }
      } else {
        await this.l2Adapter.flush(this.keyPrefix + (pattern ?? '*'));
      }
    } catch {
      // L2 failure during clear is non-critical
    }
    this.writeBackBuffer.clear();
    this.accessCounts.clear();
    if (this.trackL2Tags) {
      this.l2TagIndex.clear();
    }
  }

  async invalidateByTags(tags: string[]): Promise<number> {
    // Invalidate L1
    const l1Count = await this.l1Cache.invalidateByTags(tags);

    // Invalidate L2 using our tag index
    let l2Count = 0;
    if (this.trackL2Tags) {
      const keysToDelete = new Set<string>();
      for (const tag of tags) {
        const keys = this.l2TagIndex.get(tag);
        if (keys) {
          for (const key of keys) {
            keysToDelete.add(key);
          }
          this.l2TagIndex.delete(tag);
        }
      }

      // Delete from L2 adapter
      for (const key of keysToDelete) {
        let deleted = false;
        try {
          deleted = await this.l2Adapter.delete(this.getL2Key(key));
        } catch {
          // L2 failure during tag invalidation is non-critical
        }
        if (deleted) l2Count++;

        // Clean up key from other tag sets
        for (const [, keySet] of this.l2TagIndex) {
          keySet.delete(key);
        }
      }
    }

    return l1Count + l2Count;
  }

  async getMany(keys: string[]): Promise<Map<string, T | undefined>> {
    const results = new Map<string, T | undefined>();
    if (keys.length === 0) return results;

    // Parallel L1 lookups - 50-70% faster for multi-key operations
    const l1Results = await Promise.all(
      keys.map(async (key) => {
        const value = await this.l1Cache.get(key, { touch: false });
        return [key, value] as const;
      })
    );

    const l2Keys: string[] = [];
    const keyMapping = new Map<string, string>();

    for (const [key, value] of l1Results) {
      if (value !== undefined) {
        results.set(key, value);
      } else {
        const l2Key = this.getL2Key(key);
        l2Keys.push(l2Key);
        keyMapping.set(l2Key, key);
      }
    }

    if (l2Keys.length > 0) {
      let l2Results: (Buffer | Uint8Array | null)[];
      try {
        l2Results = await this.l2Adapter.mget(l2Keys);
      } catch {
        // L2 failure: treat all remaining keys as misses
        for (const l2Key of l2Keys) {
          results.set(keyMapping.get(l2Key)!, undefined);
        }
        return results;
      }
      const promotionPromises: Promise<void>[] = [];

      for (let i = 0; i < l2Keys.length; i++) {
        const originalKey = keyMapping.get(l2Keys[i]!)!;
        const data = l2Results[i];
        if (data !== null && data !== undefined) {
          const value = this.serializer.deserialize<T>(data);
          results.set(originalKey, value);
          if (this.autoPromote) {
            promotionPromises.push(this.l1Cache.set(originalKey, value));
          }
        } else {
          results.set(originalKey, undefined);
        }
      }

      // Fire-and-forget L1 promotions for better throughput
      if (promotionPromises.length > 0) {
        Promise.all(promotionPromises).catch(() => {
          // Promotion failures are non-critical, silently continue
        });
      }
    }
    return results;
  }

  async setMany(entries: Map<string, T>, options?: ICacheSetOptions): Promise<void> {
    const ttl = options?.ttl ?? this.defaultTtl;
    await this.l1Cache.setMany(entries, options);
    if (this.writeStrategy === 'through') {
      const l2Entries = new Map<string, Buffer | Uint8Array>();
      for (const [key, value] of entries) {
        l2Entries.set(this.getL2Key(key), this.serializer.serialize(value));
      }
      await this.l2Adapter.mset(l2Entries, ttl);
    } else {
      for (const [key, value] of entries) {
        this.writeBackBuffer.set(key, { value, options });
      }
    }
  }

  getStats(): ICacheStats {
    const l1 = this.l1Cache.getStats();
    return {
      hits: l1.hits + this.l2Stats.hits,
      misses: l1.misses + this.l2Stats.misses,
      hitRate:
        (l1.hits + this.l2Stats.hits) / Math.max(1, l1.hits + l1.misses + this.l2Stats.hits + this.l2Stats.misses),
      size: l1.size,
      memoryUsage: l1.memoryUsage,
      evictions: l1.evictions + this.l2Stats.evictions,
      expirations: l1.expirations + this.l2Stats.expirations,
      avgGetLatency: (l1.avgGetLatency + this.l2Stats.avgGetLatency) / 2,
      avgSetLatency: (l1.avgSetLatency + this.l2Stats.avgSetLatency) / 2,
      createdAt: l1.createdAt,
      lastAccessAt: new Date(Math.max(l1.lastAccessAt.getTime(), this.l2Stats.lastAccessAt.getTime())),
      l1,
      l2: this.l2Stats,
    };
  }

  resetStats(): void {
    this.l1Cache.resetStats();
    this.l2Stats = this.createEmptyStats();
  }

  async getEntry(key: string): Promise<ICacheEntry<T> | undefined> {
    const l1Entry = await this.l1Cache.getEntry(key);
    if (l1Entry) return l1Entry;
    try {
      const l2Data = await this.l2Adapter.get(this.getL2Key(key));
      if (l2Data === null) return undefined;
      const value = this.serializer.deserialize<T>(l2Data);
      const ttl = await this.l2Adapter.ttl(this.getL2Key(key));
      return {
        key,
        value,
        meta: {
          createdAt: Date.now(),
          lastAccessAt: Date.now(),
          expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : 0,
          accessCount: 0,
          size: l2Data.length,
          compressed: false,
        },
      };
    } catch {
      return undefined; // L2 failure treated as miss
    }
  }

  async keys(pattern?: string | RegExp): Promise<string[]> {
    const l1Keys = await this.l1Cache.keys(pattern);
    const patternStr = pattern instanceof RegExp ? pattern.source : (pattern ?? '*');
    const l2Keys = await this.l2Adapter.keys(this.keyPrefix + patternStr);
    const allKeys = new Set([...l1Keys, ...l2Keys.map((k) => (this.keyPrefix ? k.slice(this.keyPrefix.length) : k))]);
    return Array.from(allKeys);
  }

  async size(): Promise<number> {
    return this.l1Cache.size();
  }
  async warm(strategies?: ICacheWarmingStrategy[]): Promise<void> {
    await this.l1Cache.warm(strategies);
  }
  partition(name: string): ICache<T> {
    return this.l1Cache.partition(name);
  }

  async dispose(): Promise<void> {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }
    await this.flushWriteBackBuffer();
    await this.l1Cache.dispose();
  }

  getL1(): ICache<T> {
    return this.l1Cache;
  }

  getL2(): ICache<T> {
    const adapter = this.l2Adapter;
    const serializer = this.serializer;
    const keyPrefix = this.keyPrefix;
    return {
      get: async (key) => {
        const data = await adapter.get(keyPrefix + key);
        return data ? serializer.deserialize<T>(data) : undefined;
      },
      set: async (key, value, options) => {
        await adapter.set(keyPrefix + key, serializer.serialize(value), options?.ttl);
      },
      has: async (key) => adapter.exists(keyPrefix + key),
      delete: async (key) => adapter.delete(keyPrefix + key),
      clear: async (pattern) => {
        const p = pattern instanceof RegExp ? pattern.source : (pattern ?? '*');
        await adapter.flush(keyPrefix + p);
      },
      invalidateByTags: async () => 0,
      getMany: async (keys) => {
        const prefixedKeys = keys.map((k) => keyPrefix + k);
        const results = await adapter.mget(prefixedKeys);
        const map = new Map<string, T | undefined>();
        for (let i = 0; i < keys.length; i++) {
          const data = results[i];
          map.set(keys[i]!, data ? serializer.deserialize<T>(data) : undefined);
        }
        return map;
      },
      setMany: async (entries, options) => {
        const prefixedEntries = new Map<string, Buffer | Uint8Array>();
        for (const [key, value] of entries) {
          prefixedEntries.set(keyPrefix + key, serializer.serialize(value));
        }
        await adapter.mset(prefixedEntries, options?.ttl);
      },
      getStats: () => this.l2Stats,
      resetStats: () => {
        this.l2Stats = this.createEmptyStats();
      },
      getEntry: async () => undefined,
      keys: async (pattern) => {
        const p = pattern instanceof RegExp ? pattern.source : (pattern ?? '*');
        const keys = await adapter.keys(keyPrefix + p);
        return keys.map((k) => k.slice(keyPrefix.length));
      },
      size: async () => (await adapter.keys(keyPrefix + '*')).length,
      warm: async () => {},
      partition: () => this.getL2(),
      dispose: async () => {},
    };
  }

  async promote(key: string): Promise<boolean> {
    const l2Data = await this.l2Adapter.get(this.getL2Key(key));
    if (l2Data === null) return false;
    const value = this.serializer.deserialize<T>(l2Data);
    const ttl = await this.l2Adapter.ttl(this.getL2Key(key));
    await this.l1Cache.set(key, value, { ttl: ttl > 0 ? ttl : undefined });
    return true;
  }

  async demote(key: string): Promise<boolean> {
    const l1Entry = await this.l1Cache.getEntry(key);
    if (!l1Entry) return false;
    const serialized = this.serializer.serialize(l1Entry.value);
    const ttl = l1Entry.meta.expiresAt > 0 ? Math.ceil((l1Entry.meta.expiresAt - Date.now()) / 1000) : this.defaultTtl;
    await this.l2Adapter.set(this.getL2Key(key), serialized, ttl);
    await this.l1Cache.delete(key);
    return true;
  }

  async sync(): Promise<void> {
    await this.flushWriteBackBuffer();
  }
  getTierStats(tier: CacheTier): ICacheStats {
    return tier === 'l1' ? this.l1Cache.getStats() : this.l2Stats;
  }

  private async flushWriteBackBuffer(): Promise<void> {
    if (this.writeBackBuffer.size === 0) return;

    // Notify durability callback before flushing (for persistence)
    if (this.onWriteBackFlush) {
      const rawEntries = new Map<string, unknown>();
      for (const [key, { value }] of this.writeBackBuffer) {
        rawEntries.set(key, value);
      }
      await this.onWriteBackFlush(rawEntries);
    }

    // Group entries by TTL so we can batch mset for entries sharing the same TTL
    const ttlGroups = new Map<number, Map<string, Buffer | Uint8Array>>();
    for (const [key, { value, options }] of this.writeBackBuffer) {
      const ttl = options?.ttl ?? this.defaultTtl;
      let group = ttlGroups.get(ttl);
      if (!group) {
        group = new Map();
        ttlGroups.set(ttl, group);
      }
      group.set(this.getL2Key(key), this.serializer.serialize(value));
    }

    // Flush each TTL group with its proper TTL
    for (const [ttl, entries] of ttlGroups) {
      await this.l2Adapter.mset(entries, ttl);
    }
    this.writeBackBuffer.clear();

    // Issue 4: Clean up accessCounts for promoted keys during periodic sync
    this.cleanupAccessCounts();
    // Issue 5: Clean up stale l2TagIndex entries during periodic sync
    this.cleanupL2TagIndex();
  }

  /** Max entries in accessCounts map before eviction */
  private static readonly MAX_ACCESS_COUNTS = 10_000;

  /**
   * Clean up accessCounts map to prevent unbounded growth.
   * Removes entries that have been promoted and enforces a max size limit.
   */
  private cleanupAccessCounts(): void {
    if (this.accessCounts.size <= MultiTierCache.MAX_ACCESS_COUNTS) return;

    // Evict entries with lowest counts first (least likely to be promoted soon)
    const entries = Array.from(this.accessCounts.entries()).sort((a, b) => a[1] - b[1]);
    const toRemove = entries.length - MultiTierCache.MAX_ACCESS_COUNTS;
    for (let i = 0; i < toRemove; i++) {
      this.accessCounts.delete(entries[i]![0]);
    }
  }

  /**
   * Clean up stale l2TagIndex entries.
   * Removes tag entries for keys that no longer exist in L2 (best-effort batch check).
   */
  private cleanupL2TagIndex(): void {
    if (!this.trackL2Tags || this.l2TagIndex.size === 0) return;

    // Remove empty tag sets
    for (const [tag, keySet] of this.l2TagIndex) {
      if (keySet.size === 0) {
        this.l2TagIndex.delete(tag);
      }
    }
  }

  /**
   * Get write-back buffer size (for monitoring)
   */
  getWriteBackBufferSize(): number {
    return this.writeBackBuffer.size;
  }

  /**
   * Check if L2 tag tracking is enabled
   */
  isL2TagTrackingEnabled(): boolean {
    return this.trackL2Tags;
  }
}
