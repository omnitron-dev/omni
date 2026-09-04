/**
 * In-memory ICacheService for HttpCacheAdapter tests.
 *
 * `HttpCacheAdapter` deliberately declares its cache dependency structurally —
 * see the "Minimal cache interfaces inlined to avoid circular dep on
 * titan-cache" note in cache-adapter.ts. titan must not depend on
 * @omnitron-dev/titan-cache, so the test supplies its own conforming
 * implementation rather than importing the concrete CacheService (whose old
 * path, src/modules/cache, disappeared when the module was extracted — that
 * dead import is what left this suite reporting "0 test").
 *
 * This is a real cache, not a stub: it honours TTL and tags and reports
 * hit/miss stats, so the adapter's freshness, stale-while-revalidate and
 * tag-invalidation logic is genuinely exercised.
 */

export interface MemoryCacheSetOptions {
  /** Time to live in SECONDS — the unit HttpCacheAdapter passes. */
  ttl?: number;
  tags?: string[];
  partition?: string;
}

export interface MemoryCacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}

interface Entry {
  value: unknown;
  expiresAt: number;
  tags: string[];
}

export class MemoryCache<T = unknown> {
  private readonly entries = new Map<string, Entry>();
  private hits = 0;
  private misses = 0;

  async get(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.value as T;
  }

  async set(key: string, value: T, options?: MemoryCacheSetOptions): Promise<void> {
    const ttlSeconds = options?.ttl ?? 60;
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
      tags: options?.tags ?? [],
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.entries.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }

  async invalidateByTags(tags: string[]): Promise<number> {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.tags.some((tag) => tags.includes(tag))) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  getStats(): MemoryCacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.entries.size,
      hitRate: total > 0 ? (this.hits / total) * 100 : 0,
    };
  }
}

export class MemoryCacheService {
  private readonly caches = new Map<string, MemoryCache>();

  getCache(name: string): MemoryCache {
    return this.getOrCreateCache(name);
  }

  getOrCreateCache(name: string, _options?: Record<string, unknown>): MemoryCache {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new MemoryCache();
      this.caches.set(name, cache);
    }
    return cache;
  }

  async dispose(): Promise<void> {
    for (const cache of this.caches.values()) {
      await cache.clear();
    }
    this.caches.clear();
  }
}
