/**
 * Cache Service Implementation
 *
 * Central service for managing multiple cache instances with:
 * - Named cache creation and retrieval
 * - Global statistics aggregation
 * - Event emission for cache operations
 * - Lifecycle management
 *
 * @module titan/modules/cache
 */

import { Injectable } from '@omnitron-dev/titan/decorators';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { LRUCache, type LRUCacheOptions } from './lru-cache.js';
import { LFUCache, type LFUCacheOptions } from './lfu-cache.js';
import { MultiTierCache, type MultiTierCacheOptions, type IL2CacheAdapter } from './multi-tier-cache.js';
import type {
  ICache,
  ICacheService,
  ICacheModuleOptions,
  ICacheStats,
  CacheEventType,
  CacheEventListener,
  ICacheEvent,
  EvictionPolicy,
} from './cache.types.js';
import { DEFAULT_CACHE_NAME } from './cache.tokens.js';

/**
 * Cache creation options with type selection
 */
export interface CacheCreateOptions extends ICacheModuleOptions {
  /** Cache type: 'lru', 'lfu', or 'multi-tier' */
  type?: 'lru' | 'lfu' | 'multi-tier';
  /** L2 adapter for multi-tier cache */
  l2Adapter?: IL2CacheAdapter;
}

/**
 * Cache Service
 *
 * Manages multiple named cache instances with centralized configuration.
 */
@Injectable()
export class CacheService implements ICacheService {
  private readonly caches: Map<string, ICache<unknown>> = new Map();
  private readonly eventEmitter: EventEmitter = new EventEmitter();
  private readonly defaultOptions: ICacheModuleOptions;
  private disposed: boolean = false;

  constructor(options: ICacheModuleOptions = {}) {
    this.defaultOptions = {
      maxSize: 1000,
      defaultTtl: 300,
      evictionPolicy: 'lru',
      enableStats: true,
      compressionThreshold: 1024,
      compressionAlgorithm: 'none',
      ...options,
    };

    // Create default cache
    this.createCache(DEFAULT_CACHE_NAME, this.defaultOptions);
  }

  /**
   * Get a cache instance by name
   * Returns the default cache if no name provided
   */
  getCache<T = unknown>(name?: string): ICache<T> {
    const cacheName = name ?? DEFAULT_CACHE_NAME;
    const cache = this.caches.get(cacheName);

    if (!cache) {
      throw new Error(`Cache '${cacheName}' not found. Use createCache() or getOrCreateCache() first.`);
    }

    return cache as ICache<T>;
  }

  /**
   * Create a new named cache instance
   */
  createCache<T = unknown>(name: string, options?: CacheCreateOptions): ICache<T> {
    if (this.disposed) {
      throw new Error('CacheService has been disposed');
    }

    if (this.caches.has(name)) {
      throw new Error(`Cache '${name}' already exists. Use getOrCreateCache() instead.`);
    }

    const mergedOptions = { ...this.defaultOptions, ...options };
    const cache = this.createCacheInstance<T>(name, mergedOptions);

    this.caches.set(name, cache as ICache<unknown>);
    this.emitEvent({ type: 'set', key: name, timestamp: Date.now(), metadata: { action: 'cache_created' } });

    return cache;
  }

  /**
   * Get or create a cache instance
   */
  getOrCreateCache<T = unknown>(name: string, options?: CacheCreateOptions): ICache<T> {
    if (this.caches.has(name)) {
      return this.caches.get(name) as ICache<T>;
    }
    return this.createCache<T>(name, options);
  }

  /**
   * List all cache names
   */
  listCaches(): string[] {
    return Array.from(this.caches.keys());
  }

  /**
   * Delete a cache instance
   */
  deleteCache(name: string): boolean {
    if (name === DEFAULT_CACHE_NAME) {
      throw new Error('Cannot delete the default cache');
    }

    const cache = this.caches.get(name);
    if (!cache) {
      return false;
    }

    cache.dispose().catch(() => {
      // Silently handle disposal errors
    });
    this.caches.delete(name);
    this.emitEvent({ type: 'delete', key: name, timestamp: Date.now(), metadata: { action: 'cache_deleted' } });

    return true;
  }

  /**
   * Get aggregated statistics across all caches
   */
  getGlobalStats(): ICacheStats {
    const allStats = Array.from(this.caches.values()).map((cache) => cache.getStats());

    if (allStats.length === 0) {
      return this.createEmptyStats();
    }

    const aggregated: ICacheStats = {
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
      lastAccessAt: new Date(0),
    };

    let totalGetLatency = 0;
    let totalSetLatency = 0;
    let earliestCreated = Date.now();
    let latestAccess = 0;

    for (const stats of allStats) {
      aggregated.hits += stats.hits;
      aggregated.misses += stats.misses;
      aggregated.size += stats.size;
      aggregated.memoryUsage += stats.memoryUsage;
      aggregated.evictions += stats.evictions;
      aggregated.expirations += stats.expirations;
      totalGetLatency += stats.avgGetLatency;
      totalSetLatency += stats.avgSetLatency;

      if (stats.createdAt.getTime() < earliestCreated) {
        earliestCreated = stats.createdAt.getTime();
      }
      if (stats.lastAccessAt.getTime() > latestAccess) {
        latestAccess = stats.lastAccessAt.getTime();
      }
    }

    const total = aggregated.hits + aggregated.misses;
    aggregated.hitRate = total > 0 ? aggregated.hits / total : 0;
    aggregated.avgGetLatency = allStats.length > 0 ? totalGetLatency / allStats.length : 0;
    aggregated.avgSetLatency = allStats.length > 0 ? totalSetLatency / allStats.length : 0;
    aggregated.createdAt = new Date(earliestCreated);
    aggregated.lastAccessAt = new Date(latestAccess);

    return aggregated;
  }

  /**
   * Subscribe to cache events
   */
  on(event: CacheEventType, listener: CacheEventListener): void {
    this.eventEmitter.on(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Unsubscribe from cache events
   */
  off(event: CacheEventType, listener: CacheEventListener): void {
    this.eventEmitter.off(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Dispose all caches and cleanup resources
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;

    this.disposed = true;
    const disposePromises = Array.from(this.caches.values()).map((cache) => cache.dispose());
    await Promise.all(disposePromises);
    this.caches.clear();
    this.eventEmitter.removeAllListeners();
  }

  /**
   * Create a cache instance based on options
   */
  private createCacheInstance<T>(name: string, options: CacheCreateOptions): ICache<T> {
    const cacheType = this.determineCacheType(options);

    switch (cacheType) {
      case 'multi-tier':
        return this.createMultiTierCache<T>(name, options);
      case 'lfu':
        return this.createLFUCache<T>(name, options);
      case 'lru':
      default:
        return this.createLRUCache<T>(name, options);
    }
  }

  /**
   * Determine cache type from options
   */
  private determineCacheType(options: CacheCreateOptions): 'lru' | 'lfu' | 'multi-tier' {
    if (options.type) {
      return options.type;
    }

    if (options.multiTier || options.l2) {
      return 'multi-tier';
    }

    const policy: EvictionPolicy = options.evictionPolicy ?? 'lru';
    return policy === 'lfu' ? 'lfu' : 'lru';
  }

  /**
   * Create LRU cache instance
   */
  private createLRUCache<T>(name: string, options: CacheCreateOptions): ICache<T> {
    const lruOptions: LRUCacheOptions = {
      name,
      maxSize: options.maxSize,
      ttl: options.defaultTtl,
      compressionThreshold: options.compressionThreshold,
      compressionAlgorithm: options.compressionAlgorithm,
      enableStats: options.enableStats,
      useWeakRef: options.useWeakRef,
      ttlCleanupInterval: options.ttlCleanupInterval,
      wheelTimerBuckets: options.wheelTimerBuckets,
      onEvict: (key, _value, reason) => {
        this.emitEvent({
          type: reason === 'capacity' ? 'evict' : reason === 'ttl' ? 'expire' : 'delete',
          key,
          timestamp: Date.now(),
        });
      },
    };

    return new LRUCache<T>(lruOptions) as ICache<T>;
  }

  /**
   * Create LFU cache instance
   */
  private createLFUCache<T>(name: string, options: CacheCreateOptions): ICache<T> {
    const lfuOptions: LFUCacheOptions = {
      name,
      maxSize: options.maxSize,
      ttl: options.defaultTtl,
      compressionThreshold: options.compressionThreshold,
      compressionAlgorithm: options.compressionAlgorithm,
      enableStats: options.enableStats,
      onEvict: (key, _value, reason) => {
        this.emitEvent({
          type: reason === 'capacity' ? 'evict' : reason === 'ttl' ? 'expire' : 'delete',
          key,
          timestamp: Date.now(),
        });
      },
    };

    return new LFUCache<T>(lfuOptions) as ICache<T>;
  }

  /**
   * Create multi-tier cache instance
   */
  private createMultiTierCache<T>(name: string, options: CacheCreateOptions): ICache<T> {
    const multiTierOptions: MultiTierCacheOptions = {
      name,
      l1: {
        type: options.evictionPolicy === 'lfu' ? 'lfu' : 'lru',
        maxSize: options.l1?.maxSize ?? options.maxSize,
        ttl: options.l1?.ttl ?? options.defaultTtl,
        compressionThreshold: options.l1?.compressionThreshold ?? options.compressionThreshold,
        compressionAlgorithm: options.l1?.compressionAlgorithm ?? options.compressionAlgorithm,
      },
      l2: options.l2
        ? {
            client: options.l2Adapter ?? options.l2.client,
            prefix: options.l2.prefix,
            ttl: options.l2.ttl,
            serializer: options.l2.serializer,
            compression: options.l2.compression,
            compressionAlgorithm: options.l2.compressionAlgorithm,
            compressionThreshold: options.l2.compressionThreshold,
          }
        : undefined,
      writeStrategy: 'through',
      autoPromote: true,
      promotionThreshold: 3,
      enableStats: options.enableStats,
    };

    return new MultiTierCache<T>(multiTierOptions) as ICache<T>;
  }

  /**
   * Emit a cache event
   */
  private emitEvent(event: ICacheEvent): void {
    this.eventEmitter.emit(event.type, event);
  }

  /**
   * Create empty stats object
   */
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
}
