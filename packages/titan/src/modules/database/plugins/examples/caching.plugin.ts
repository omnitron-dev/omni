/**
 * Caching Plugin
 *
 * Provides query result caching with TTL and invalidation
 */

import { createHash } from 'crypto';
import type { ITitanPlugin } from '../plugin.types.js';

export interface CacheOptions {
  /**
   * Default TTL in seconds
   */
  ttl?: number;

  /**
   * Maximum cache size (number of entries)
   */
  maxSize?: number;

  /**
   * Cache key prefix
   */
  prefix?: string;

  /**
   * Tables to cache (defaults to all)
   */
  tables?: string[];

  /**
   * Query types to cache
   */
  operations?: Array<'find' | 'findOne' | 'findById' | 'count' | 'aggregate'>;

  /**
   * Cache implementation
   */
  cache?: ICache;

  /**
   * Enable cache statistics
   */
  enableStats?: boolean;
}

/**
 * Cache interface
 */
export interface ICache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(pattern?: string): Promise<void>;
  has(key: string): Promise<boolean>;
}

/**
 * In-memory cache implementation
 */
export class MemoryCache implements ICache {
  private store: Map<string, { value: any; expires: number }> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expires) {
      this.store.delete(key);
      this.timers.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttl: number = 3600): Promise<void> {
    // Clear existing timer
    const existingTimer = this.timers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const expires = Date.now() + ttl * 1000;
    this.store.set(key, { value, expires });

    // Set cleanup timer
    const timer = setTimeout(() => {
      this.store.delete(key);
      this.timers.delete(key);
    }, ttl * 1000);

    this.timers.set(key, timer);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  async clear(pattern?: string): Promise<void> {
    if (pattern) {
      const regex = new RegExp(pattern);
      for (const key of this.store.keys()) {
        if (regex.test(key)) {
          await this.delete(key);
        }
      }
    } else {
      for (const timer of this.timers.values()) {
        clearTimeout(timer);
      }
      this.store.clear();
      this.timers.clear();
    }
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== undefined;
  }

  get size(): number {
    return this.store.size;
  }
}

/**
 * Cache statistics
 */
interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  hitRate: number;
}

/**
 * Create caching plugin
 */
export function cachingPlugin(options: CacheOptions = {}): ITitanPlugin {
  const ttl = options.ttl || 300; // 5 minutes default
  const maxSize = options.maxSize || 1000;
  const prefix = options.prefix || 'db:cache:';
  const cache = options.cache || new MemoryCache();
  const operations = options.operations || ['find', 'findOne', 'findById', 'count'];

  // Statistics
  const stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    hitRate: 0,
  };

  // Generate cache key
  const generateKey = (table: string, operation: string, args: any[]): string => {
    const hash = createHash('sha256').update(JSON.stringify({ table, operation, args })).digest('hex');
    return `${prefix}${table}:${operation}:${hash}`;
  };

  // Update hit rate
  const updateHitRate = () => {
    const total = stats.hits + stats.misses;
    stats.hitRate = total > 0 ? stats.hits / total : 0;
  };

  return {
    name: 'caching',
    version: '1.0.0',
    metadata: {
      description: 'Query result caching with automatic invalidation',
      category: 'caching',
      author: 'Titan Framework',
      compatibility: {
        dialects: ['postgres', 'mysql', 'sqlite'],
      },
    },

    extendRepository(repository: any) {
      // Store original methods
      const originalMethods: Record<string, Function> = {};
      const cacheableMethods = ['find', 'findAll', 'findOne', 'findById', 'count'];

      for (const method of cacheableMethods) {
        if (repository[method]) {
          originalMethods[method] = repository[method];
        }
      }

      // Mutation methods that should invalidate cache
      const mutationMethods = ['create', 'update', 'delete', 'createMany', 'updateMany', 'deleteMany'];
      const originalMutations: Record<string, Function> = {};

      for (const method of mutationMethods) {
        if (repository[method]) {
          originalMutations[method] = repository[method];
        }
      }

      // Override cacheable methods
      for (const [method, original] of Object.entries(originalMethods)) {
        if (!operations.includes(method as any)) {
          continue;
        }

        repository[method] = async function (...args: any[]) {
          // Check if caching is enabled for this table
          if (options.tables && !options.tables.includes(this.tableName)) {
            return original.call(this, ...args);
          }

          const key = generateKey(this.tableName, method, args);

          // Try to get from cache
          const cached = await cache.get(key);
          if (cached !== undefined) {
            if (options.enableStats) {
              stats.hits++;
              updateHitRate();
            }
            return cached;
          }

          // Cache miss - execute query
          if (options.enableStats) {
            stats.misses++;
            updateHitRate();
          }

          const result = await original.call(this, ...args);

          // Store in cache
          await cache.set(key, result, ttl);
          if (options.enableStats) {
            stats.sets++;
          }

          return result;
        };
      }

      // Override mutation methods to invalidate cache
      for (const [method, original] of Object.entries(originalMutations)) {
        repository[method] = async function (...args: any[]) {
          const result = await original.call(this, ...args);

          // Invalidate cache for this table
          await cache.clear(`${prefix}${this.tableName}:.*`);
          if (options.enableStats) {
            stats.deletes++;
          }

          return result;
        };
      }

      // Add cache management methods
      repository.clearCache = async function (pattern?: string) {
        const fullPattern = pattern ? `${prefix}${this.tableName}:${pattern}` : `${prefix}${this.tableName}:.*`;
        await cache.clear(fullPattern);
      };

      repository.getCacheStats = function (): CacheStats {
        return { ...stats };
      };

      repository.resetCacheStats = function () {
        stats.hits = 0;
        stats.misses = 0;
        stats.sets = 0;
        stats.deletes = 0;
        stats.hitRate = 0;
      };

      repository.setCacheTTL = function (seconds: number) {
        repository._cacheTTL = seconds;
      };

      // Add method to bypass cache
      repository.fresh = function () {
        const freshRepo = { ...this };

        // Temporarily restore original methods
        for (const [method, original] of Object.entries(originalMethods)) {
          freshRepo[method] = original;
        }

        return freshRepo;
      };

      return repository;
    },

    async init() {
      // Clear cache on init
      await cache.clear(`${prefix}*`);
    },

    async onDestroy() {
      // Clear all cache on destroy
      await cache.clear(`${prefix}*`);
    },

    afterTransaction(result: 'commit' | 'rollback') {
      if (result === 'commit') {
        // Clear cache after successful transaction
        cache.clear(`${prefix}*`).catch((err) => {
          console.error('Failed to clear cache after transaction:', err);
        });
      }
    },
  };
}

/**
 * Create Redis cache implementation
 */
export function createRedisCache(redisClient: any): ICache {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const value = await redisClient.get(key);
      return value ? JSON.parse(value) : undefined;
    },

    async set<T>(key: string, value: T, ttl?: number): Promise<void> {
      const serialized = JSON.stringify(value);
      if (ttl) {
        await redisClient.setex(key, ttl, serialized);
      } else {
        await redisClient.set(key, serialized);
      }
    },

    async delete(key: string): Promise<void> {
      await redisClient.del(key);
    },

    async clear(pattern?: string): Promise<void> {
      if (pattern) {
        const keys = await redisClient.keys(pattern);
        if (keys.length > 0) {
          await redisClient.del(...keys);
        }
      } else {
        await redisClient.flushdb();
      }
    },

    async has(key: string): Promise<boolean> {
      return (await redisClient.exists(key)) > 0;
    },
  };
}

// Default export
export default cachingPlugin;
