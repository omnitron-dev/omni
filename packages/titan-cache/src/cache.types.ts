/**
 * Cache Module Types
 *
 * Comprehensive type definitions for high-performance caching with:
 * - LRU/LFU eviction policies
 * - Multi-tier caching (L1/L2)
 * - TTL management with wheel timer
 * - Cache statistics and monitoring
 * - Compression support
 *
 * @module titan/modules/cache
 */

/**
 * Cache eviction policy
 */
export type EvictionPolicy = 'lru' | 'lfu' | 'fifo' | 'random' | 'ttl';

/**
 * Cache tier level
 */
export type CacheTier = 'l1' | 'l2';

/**
 * Cache entry state
 */
export type CacheEntryState = 'fresh' | 'stale' | 'expired';

/**
 * Compression algorithm
 */
export type CompressionAlgorithm = 'gzip' | 'deflate' | 'brotli' | 'lz4' | 'none';

/**
 * Cache statistics interface
 */
export interface ICacheStats {
  /** Total cache hits */
  hits: number;
  /** Total cache misses */
  misses: number;
  /** Hit rate (0-1) */
  hitRate: number;
  /** Total entries in cache */
  size: number;
  /** Memory usage in bytes */
  memoryUsage: number;
  /** Total evictions */
  evictions: number;
  /** Total expirations */
  expirations: number;
  /** Average get latency in microseconds */
  avgGetLatency: number;
  /** Average set latency in microseconds */
  avgSetLatency: number;
  /** Cache creation time */
  createdAt: Date;
  /** Last access time */
  lastAccessAt: Date;
  /** L1 specific stats (if multi-tier) */
  l1?: ICacheStats;
  /** L2 specific stats (if multi-tier) */
  l2?: ICacheStats;
}

/**
 * Cache entry metadata
 */
export interface ICacheEntryMeta {
  /** Entry creation timestamp */
  createdAt: number;
  /** Last access timestamp */
  lastAccessAt: number;
  /** Expiration timestamp (0 = never) */
  expiresAt: number;
  /** Access count (for LFU) */
  accessCount: number;
  /** Size in bytes */
  size: number;
  /** Whether the value is compressed */
  compressed: boolean;
  /** Compression algorithm used */
  compressionAlgorithm?: CompressionAlgorithm;
  /** Original size before compression */
  originalSize?: number;
  /** Tags for grouped invalidation */
  tags?: string[];
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Cache entry with value and metadata
 */
export interface ICacheEntry<T = unknown> {
  /** Cache key */
  key: string;
  /** Cached value */
  value: T;
  /** Entry metadata */
  meta: ICacheEntryMeta;
}

/**
 * Cache set options
 */
export interface ICacheSetOptions {
  /** TTL in seconds (overrides default) */
  ttl?: number;
  /** Tags for grouped invalidation */
  tags?: string[];
  /** Force compression regardless of size */
  compress?: boolean;
  /** Skip L2 cache (for multi-tier) */
  skipL2?: boolean;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
  /** Callback when entry expires */
  onExpire?: (key: string, value: unknown) => void;
}

/**
 * Cache get options
 */
export interface ICacheGetOptions {
  /** Return stale value while refreshing */
  staleWhileRevalidate?: boolean;
  /** Skip L1 and go directly to L2 */
  skipL1?: boolean;
  /** Update access time (default: true) */
  touch?: boolean;
}

/**
 * Cache warming strategy
 */
export interface ICacheWarmingStrategy {
  /** Strategy name */
  name: string;
  /** Keys to preload */
  keys?: string[];
  /** Pattern to match keys */
  pattern?: RegExp;
  /** Custom loader function */
  loader?: () => Promise<Map<string, unknown>>;
  /** Priority (higher = load first) */
  priority?: number;
}

/**
 * Cache partition configuration
 */
export interface ICachePartition {
  /** Partition name */
  name: string;
  /** Maximum size for this partition */
  maxSize?: number;
  /** TTL override for this partition */
  ttl?: number;
  /** Eviction policy override */
  evictionPolicy?: EvictionPolicy;
  /** Key prefix */
  prefix?: string;
}

/**
 * L1 cache options (in-memory)
 */
export interface IL1CacheOptions {
  /** Maximum number of entries */
  maxSize?: number;
  /** Default TTL in seconds */
  ttl?: number;
  /** Eviction policy */
  evictionPolicy?: EvictionPolicy;
  /** Enable WeakRef for GC-friendly caching */
  useWeakRef?: boolean;
  /** Minimum size in bytes to compress */
  compressionThreshold?: number;
  /** Compression algorithm */
  compressionAlgorithm?: CompressionAlgorithm;
}

/**
 * L2 cache options (external, e.g., Redis)
 */
export interface IL2CacheOptions {
  /** Redis client or adapter */
  client?: unknown;
  /** Maximum number of entries */
  maxSize?: number;
  /** Default TTL in seconds */
  ttl?: number;
  /** Key prefix */
  prefix?: string;
  /** Serializer */
  serializer?: ICacheSerializer;
  /** Enable compression */
  compression?: boolean;
  /** Compression algorithm */
  compressionAlgorithm?: CompressionAlgorithm;
  /** Compression threshold in bytes */
  compressionThreshold?: number;
}

/**
 * Cache serializer interface
 */
export interface ICacheSerializer {
  /** Serialize value to buffer */
  serialize(value: unknown): Buffer | Uint8Array;
  /** Deserialize buffer to value */
  deserialize<T>(data: Buffer | Uint8Array): T;
}

/**
 * Cache module options
 */
export interface ICacheModuleOptions {
  /** Enable multi-tier caching */
  multiTier?: boolean;
  /** L1 cache options */
  l1?: IL1CacheOptions;
  /** L2 cache options */
  l2?: IL2CacheOptions;
  /** Default TTL in seconds */
  defaultTtl?: number;
  /** Maximum entries (for single-tier) */
  maxSize?: number;
  /** Default eviction policy */
  evictionPolicy?: EvictionPolicy;
  /** Enable statistics collection */
  enableStats?: boolean;
  /** Stats collection interval in ms */
  statsInterval?: number;
  /** Cache partitions */
  partitions?: ICachePartition[];
  /** Warming strategies */
  warmingStrategies?: ICacheWarmingStrategy[];
  /** Enable WeakRef for optional GC */
  useWeakRef?: boolean;
  /** Compression threshold in bytes */
  compressionThreshold?: number;
  /** Compression algorithm */
  compressionAlgorithm?: CompressionAlgorithm;
  /** TTL cleanup interval in ms (wheel timer bucket size) */
  ttlCleanupInterval?: number;
  /** Number of wheel timer buckets */
  wheelTimerBuckets?: number;
  /** Make module global */
  isGlobal?: boolean;
  /** Stale-while-revalidate window in seconds */
  staleWhileRevalidate?: number;
  /** Background refresh enabled */
  backgroundRefresh?: boolean;
}

/**
 * Async module options
 */
export interface ICacheModuleAsyncOptions {
  /** Factory function */
  useFactory?: (...args: unknown[]) => Promise<ICacheModuleOptions> | ICacheModuleOptions;
  /** Inject tokens */
  inject?: unknown[];
  /** Module imports */
  imports?: unknown[];
  /** Make global */
  isGlobal?: boolean;
}

/**
 * Cache interface
 */
export interface ICache<T = unknown> {
  /** Get value by key */
  get(key: string, options?: ICacheGetOptions): Promise<T | undefined>;
  /** Set value with key */
  set(key: string, value: T, options?: ICacheSetOptions): Promise<void>;
  /** Check if key exists */
  has(key: string): Promise<boolean>;
  /** Delete key */
  delete(key: string): Promise<boolean>;
  /** Clear all entries or by pattern */
  clear(pattern?: string | RegExp): Promise<void>;
  /** Invalidate by tags */
  invalidateByTags(tags: string[]): Promise<number>;
  /** Get multiple values */
  getMany(keys: string[]): Promise<Map<string, T | undefined>>;
  /** Set multiple values */
  setMany(entries: Map<string, T>, options?: ICacheSetOptions): Promise<void>;
  /** Get cache stats */
  getStats(): ICacheStats;
  /** Reset stats */
  resetStats(): void;
  /** Get entry with metadata */
  getEntry(key: string): Promise<ICacheEntry<T> | undefined>;
  /** Get all keys */
  keys(pattern?: string | RegExp): Promise<string[]>;
  /** Get size */
  size(): Promise<number>;
  /** Warm cache with strategies */
  warm(strategies?: ICacheWarmingStrategy[]): Promise<void>;
  /** Create a partition view */
  partition(name: string): ICache<T>;
  /** Dispose and cleanup */
  dispose(): Promise<void>;
}

/**
 * Multi-tier cache interface
 */
export interface IMultiTierCache<T = unknown> extends ICache<T> {
  /** Get L1 cache */
  getL1(): ICache<T>;
  /** Get L2 cache */
  getL2(): ICache<T>;
  /** Promote entry from L2 to L1 */
  promote(key: string): Promise<boolean>;
  /** Demote entry from L1 to L2 */
  demote(key: string): Promise<boolean>;
  /** Sync L1 with L2 */
  sync(): Promise<void>;
  /** Get tier-specific stats */
  getTierStats(tier: CacheTier): ICacheStats;
}

/**
 * Cache health indicator interface
 */
export interface ICacheHealthIndicator {
  /** Health indicator name */
  readonly name: string;
  /** Check health */
  check(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    message?: string;
    details?: Record<string, unknown>;
  }>;
}

/**
 * LRU node for doubly-linked list implementation
 */
export interface ILRUNode<T = unknown> {
  key: string;
  value: T;
  meta: ICacheEntryMeta;
  prev: ILRUNode<T> | null;
  next: ILRUNode<T> | null;
}

/**
 * LFU node with frequency tracking
 */
export interface ILFUNode<T = unknown> {
  key: string;
  value: T;
  meta: ICacheEntryMeta;
  frequency: number;
}

/**
 * Wheel timer bucket for efficient TTL management
 */
export interface IWheelTimerBucket {
  /** Bucket index */
  index: number;
  /** Keys expiring in this bucket */
  keys: Set<string>;
  /** Bucket expiration timestamp */
  expiresAt: number;
}

/**
 * Cache event types
 */
export type CacheEventType =
  | 'hit'
  | 'miss'
  | 'set'
  | 'delete'
  | 'evict'
  | 'expire'
  | 'clear'
  | 'warm'
  | 'promote'
  | 'demote'
  | 'error';

/**
 * Cache event data
 */
export interface ICacheEvent {
  type: CacheEventType;
  key?: string;
  tier?: CacheTier;
  timestamp: number;
  latency?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Cache event listener
 */
export type CacheEventListener = (event: ICacheEvent) => void;

/**
 * Cache service interface
 */
export interface ICacheService {
  /** Get the default cache instance */
  getCache<T = unknown>(name?: string): ICache<T>;
  /** Create a new cache instance */
  createCache<T = unknown>(name: string, options?: ICacheModuleOptions): ICache<T>;
  /** Get or create a cache */
  getOrCreateCache<T = unknown>(name: string, options?: ICacheModuleOptions): ICache<T>;
  /** List all cache names */
  listCaches(): string[];
  /** Delete a cache */
  deleteCache(name: string): boolean;
  /** Get global stats across all caches */
  getGlobalStats(): ICacheStats;
  /** Subscribe to cache events */
  on(event: CacheEventType, listener: CacheEventListener): void;
  /** Unsubscribe from cache events */
  off(event: CacheEventType, listener: CacheEventListener): void;
  /** Dispose all caches */
  dispose(): Promise<void>;
}
