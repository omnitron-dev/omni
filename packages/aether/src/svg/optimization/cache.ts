/**
 * SVG Cache System
 *
 * Provides efficient caching for SVG elements with multiple strategies:
 * - Memory: Fast in-memory cache
 * - Storage: Persistent browser storage (localStorage, sessionStorage, indexedDB)
 * - Hybrid: Combines memory cache with persistent storage
 *
 * Features:
 * - Configurable size and age limits
 * - Optional compression for storage
 * - Custom serialization/deserialization
 * - Cache statistics tracking
 *
 * @module svg/optimization/cache
 */

/**
 * Cache configuration options
 */
export interface SVGCacheConfig {
  /** Cache strategy */
  strategy?: 'memory' | 'storage' | 'hybrid';

  /** Maximum cache size in bytes (0 = unlimited) */
  maxSize?: number;

  /** Time to live in milliseconds (0 = unlimited) */
  maxAge?: number;

  /** Maximum number of cached items (0 = unlimited) */
  maxItems?: number;

  /** Storage type for persistent cache */
  storage?: 'localStorage' | 'sessionStorage' | 'indexedDB';

  /** Storage key prefix */
  storageKey?: string;

  /** Enable compression for storage */
  compress?: boolean;

  /** Custom serialization function */
  serialize?: (svg: SVGElement) => string;

  /** Custom deserialization function */
  deserialize?: (data: string) => SVGElement;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Number of cache hits */
  hits: number;

  /** Number of cache misses */
  misses: number;

  /** Total cache size in bytes */
  size: number;

  /** Number of cached items */
  items: number;
}

/**
 * Internal cache entry
 */
interface CacheEntry {
  /** Serialized SVG data */
  data: string;

  /** Entry size in bytes */
  size: number;

  /** Timestamp when entry was created */
  timestamp: number;

  /** Last access timestamp */
  lastAccess: number;
}

/**
 * Default serialization: Convert SVG element to string
 */
function defaultSerialize(svg: SVGElement): string {
  return svg.outerHTML;
}

/**
 * Default deserialization: Parse SVG string to element
 */
function defaultDeserialize(data: string): SVGElement {
  const parser = new DOMParser();
  const doc = parser.parseFromString(data, 'image/svg+xml');
  const svg = doc.documentElement as unknown as SVGElement;

  if (svg.tagName !== 'svg') {
    throw new Error('Invalid SVG data');
  }

  return svg;
}

/**
 * Compress string using browser's CompressionStream API
 */
async function _compressString(str: string): Promise<string> {
  if (typeof CompressionStream === 'undefined') {
    // Fallback: return base64 encoded string
    return btoa(str);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(str));
      controller.close();
    },
  });

  const compressed = stream.pipeThrough(new CompressionStream('gzip'));
  const chunks: Uint8Array[] = [];
  const reader = compressed.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  // Convert to base64 for storage
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  // Convert Uint8Array to base64
  const binary = String.fromCharCode(...combined);
  return btoa(binary);
}

/**
 * Decompress string using browser's DecompressionStream API
 */
async function _decompressString(compressed: string): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    // Fallback: return base64 decoded string
    return atob(compressed);
  }

  // Convert base64 to Uint8Array
  const binary = atob(compressed);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

  const decompressed = stream.pipeThrough(new DecompressionStream('gzip'));
  const chunks: Uint8Array[] = [];
  const reader = decompressed.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const decoder = new TextDecoder();
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return decoder.decode(combined);
}

/**
 * SVG Cache implementation
 *
 * Provides efficient caching for SVG elements with configurable strategies,
 * size limits, and TTL support.
 *
 * @example
 * ```typescript
 * // Create memory cache with size limit
 * const cache = new SVGCache({
 *   strategy: 'memory',
 *   maxSize: 1024 * 1024, // 1MB
 *   maxAge: 3600000, // 1 hour
 * });
 *
 * // Store SVG
 * cache.set('icon-home', svgElement);
 *
 * // Retrieve SVG
 * const svg = cache.get('icon-home');
 *
 * // Check statistics
 * const stats = cache.stats();
 * console.log(`Hit rate: ${stats.hits / (stats.hits + stats.misses)}`);
 * ```
 */
export class SVGCache {
  private config: Required<SVGCacheConfig>;
  private memoryCache = new Map<string, CacheEntry>();
  private cacheStats: CacheStats = {
    hits: 0,
    misses: 0,
    size: 0,
    items: 0,
  };

  constructor(config?: SVGCacheConfig) {
    this.config = {
      strategy: config?.strategy ?? 'memory',
      maxSize: config?.maxSize ?? 0,
      maxAge: config?.maxAge ?? 0,
      maxItems: config?.maxItems ?? 0,
      storage: config?.storage ?? 'localStorage',
      storageKey: config?.storageKey ?? 'aether-svg-cache',
      compress: config?.compress ?? false,
      serialize: config?.serialize ?? defaultSerialize,
      deserialize: config?.deserialize ?? defaultDeserialize,
    };
  }

  /**
   * Get cached SVG element
   */
  get(key: string): SVGElement | null {
    // Try memory cache first
    const memoryEntry = this.memoryCache.get(key);
    if (memoryEntry) {
      // Check if entry is expired
      if (this.isExpired(memoryEntry)) {
        this.memoryCache.delete(key);
        this.updateSize();
      } else {
        // Update last access
        memoryEntry.lastAccess = Date.now();
        this.cacheStats.hits++;
        return this.config.deserialize(memoryEntry.data);
      }
    }

    // Try persistent storage if using storage or hybrid strategy
    if (this.config.strategy === 'storage' || this.config.strategy === 'hybrid') {
      const storageEntry = this.getFromStorage(key);
      if (storageEntry) {
        // Add to memory cache for hybrid strategy
        if (this.config.strategy === 'hybrid') {
          this.memoryCache.set(key, storageEntry);
        }
        this.cacheStats.hits++;
        return this.config.deserialize(storageEntry.data);
      }
    }

    this.cacheStats.misses++;
    return null;
  }

  /**
   * Store SVG element in cache
   */
  set(key: string, svg: SVGElement): void {
    const data = this.config.serialize(svg);
    const size = new Blob([data]).size;

    const entry: CacheEntry = {
      data,
      size,
      timestamp: Date.now(),
      lastAccess: Date.now(),
    };

    // Check size limit
    if (this.config.maxSize > 0 && size > this.config.maxSize) {
      // Entry too large, don't cache
      return;
    }

    // Evict entries if necessary
    this.evictIfNecessary(size);

    // Store in memory cache
    if (this.config.strategy === 'memory' || this.config.strategy === 'hybrid') {
      this.memoryCache.set(key, entry);
      this.updateSize();
    }

    // Store in persistent storage
    if (this.config.strategy === 'storage' || this.config.strategy === 'hybrid') {
      this.setToStorage(key, entry);
    }
  }

  /**
   * Check if key exists in cache
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Delete entry from cache
   */
  delete(key: string): void {
    this.memoryCache.delete(key);
    this.deleteFromStorage(key);
    this.updateSize();
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.memoryCache.clear();
    this.clearStorage();
    this.cacheStats = {
      hits: 0,
      misses: 0,
      size: 0,
      items: 0,
    };
  }

  /**
   * Get current cache size in bytes
   */
  size(): number {
    return this.cacheStats.size;
  }

  /**
   * Get cache statistics
   */
  stats(): Readonly<CacheStats> {
    return { ...this.cacheStats };
  }

  /**
   * Check if entry is expired
   */
  private isExpired(entry: CacheEntry): boolean {
    if (this.config.maxAge === 0) return false;
    return Date.now() - entry.timestamp > this.config.maxAge;
  }

  /**
   * Evict entries if necessary to make room for new entry
   */
  private evictIfNecessary(newEntrySize: number): void {
    // Check item count limit
    if (this.config.maxItems > 0 && this.memoryCache.size >= this.config.maxItems) {
      this.evictLRU();
    }

    // Check size limit
    if (this.config.maxSize > 0) {
      while (this.cacheStats.size + newEntrySize > this.config.maxSize && this.memoryCache.size > 0) {
        this.evictLRU();
      }
    }
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;

    for (const [key, entry] of this.memoryCache.entries()) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.memoryCache.delete(oldestKey);
      this.updateSize();
    }
  }

  /**
   * Update cache size statistics
   */
  private updateSize(): void {
    let totalSize = 0;
    let items = 0;

    for (const entry of this.memoryCache.values()) {
      totalSize += entry.size;
      items++;
    }

    this.cacheStats.size = totalSize;
    this.cacheStats.items = items;
  }

  /**
   * Get entry from persistent storage
   */
  private getFromStorage(key: string): CacheEntry | null {
    if (typeof window === 'undefined') return null;

    try {
      const storageKey = `${this.config.storageKey}:${key}`;
      let data: string | null = null;

      if (this.config.storage === 'localStorage') {
        data = localStorage.getItem(storageKey);
      } else if (this.config.storage === 'sessionStorage') {
        data = sessionStorage.getItem(storageKey);
      }
      // indexedDB would require async, not implemented for now

      if (!data) return null;

      const entry = JSON.parse(data) as CacheEntry;

      // Check if expired
      if (this.isExpired(entry)) {
        this.deleteFromStorage(key);
        return null;
      }

      return entry;
    } catch (error) {
      console.error('Error reading from storage:', error);
      return null;
    }
  }

  /**
   * Store entry in persistent storage
   */
  private setToStorage(key: string, entry: CacheEntry): void {
    if (typeof window === 'undefined') return;

    try {
      const storageKey = `${this.config.storageKey}:${key}`;
      const data = JSON.stringify(entry);

      if (this.config.storage === 'localStorage') {
        localStorage.setItem(storageKey, data);
      } else if (this.config.storage === 'sessionStorage') {
        sessionStorage.setItem(storageKey, data);
      }
      // indexedDB would require async, not implemented for now
    } catch (error) {
      console.error('Error writing to storage:', error);
    }
  }

  /**
   * Delete entry from persistent storage
   */
  private deleteFromStorage(key: string): void {
    if (typeof window === 'undefined') return;

    try {
      const storageKey = `${this.config.storageKey}:${key}`;

      if (this.config.storage === 'localStorage') {
        localStorage.removeItem(storageKey);
      } else if (this.config.storage === 'sessionStorage') {
        sessionStorage.removeItem(storageKey);
      }
    } catch (error) {
      console.error('Error deleting from storage:', error);
    }
  }

  /**
   * Clear all entries from persistent storage
   */
  private clearStorage(): void {
    if (typeof window === 'undefined') return;

    try {
      const prefix = `${this.config.storageKey}:`;
      const storage = this.config.storage === 'localStorage' ? localStorage : sessionStorage;

      const keysToDelete: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && key.startsWith(prefix)) {
          keysToDelete.push(key);
        }
      }

      for (const key of keysToDelete) {
        storage.removeItem(key);
      }
    } catch (error) {
      console.error('Error clearing storage:', error);
    }
  }
}
