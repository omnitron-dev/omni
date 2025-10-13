/**
 * Persistent Caching System
 * File-based cache with compression, multi-level caching, and intelligent invalidation
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createGzip, createGunzip, createBrotliCompress, createBrotliDecompress } from 'zlib';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

/**
 * Configuration for persistent cache
 */
export interface PersistentCacheConfig {
  /**
   * Cache directory
   * @default '.aether/cache'
   */
  dir?: string;

  /**
   * Compression algorithm
   * @default 'gzip'
   */
  compression?: 'gzip' | 'brotli' | 'none';

  /**
   * Maximum cache size in MB
   * @default 500
   */
  maxSize?: number;

  /**
   * Maximum age in days
   * @default 30
   */
  maxAge?: number;

  /**
   * Cache invalidation strategy
   * @default 'hybrid'
   */
  strategy?: 'content' | 'timestamp' | 'hybrid';

  /**
   * Patterns to include in cache
   */
  include?: (string | RegExp)[];

  /**
   * Patterns to exclude from cache
   */
  exclude?: (string | RegExp)[];

  /**
   * Enable memory cache
   * @default true
   */
  enableMemoryCache?: boolean;

  /**
   * Memory cache max entries
   * @default 1000
   */
  memoryCacheMaxEntries?: number;
}

/**
 * Cache entry metadata
 */
export interface CacheEntry<T = any> {
  /** Content hash for validation */
  hash: string;
  /** Cached data */
  data: T;
  /** Dependencies */
  dependencies: string[];
  /** Creation timestamp */
  timestamp: number;
  /** Time to live in ms */
  ttl: number;
  /** Source file path */
  source: string;
  /** Original size in bytes */
  originalSize: number;
  /** Compressed size in bytes */
  compressedSize?: number;
  /** Metadata */
  metadata?: Record<string, any>;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Total entries in cache */
  entries: number;
  /** Memory cache entries */
  memoryEntries: number;
  /** Disk cache entries */
  diskEntries: number;
  /** Total size in bytes */
  totalSize: number;
  /** Memory size in bytes */
  memorySize: number;
  /** Disk size in bytes */
  diskSize: number;
  /** Hit rate */
  hitRate: number;
  /** Total hits */
  hits: number;
  /** Total misses */
  misses: number;
}

/**
 * Persistent cache implementation with multi-level caching and compression
 */
export class PersistentCache {
  private config: Required<PersistentCacheConfig>;
  private memoryCache: Map<string, CacheEntry> = new Map();
  private stats = {
    hits: 0,
    misses: 0,
  };
  private initialized = false;

  constructor(config: PersistentCacheConfig = {}) {
    this.config = {
      dir: config.dir || '.aether/cache',
      compression: config.compression || 'gzip',
      maxSize: config.maxSize || 500,
      maxAge: config.maxAge || 30,
      strategy: config.strategy || 'hybrid',
      include: config.include || [],
      exclude: config.exclude || [],
      enableMemoryCache: config.enableMemoryCache !== false,
      memoryCacheMaxEntries: config.memoryCacheMaxEntries || 1000,
    };
  }

  /**
   * Initialize cache directory and load metadata
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(this.config.dir, { recursive: true });
    await this.loadMetadata();
    await this.cleanExpired();

    this.initialized = true;
  }

  /**
   * Get cached entry
   */
  async get<T = any>(key: string): Promise<T | null> {
    await this.ensureInitialized();

    // Check memory cache first
    if (this.config.enableMemoryCache) {
      const memEntry = this.memoryCache.get(key);
      if (memEntry && !this.isExpired(memEntry)) {
        this.stats.hits++;
        return memEntry.data as T;
      }
    }

    // Check disk cache
    try {
      const entry = await this.loadFromDisk<T>(key);
      if (entry && !this.isExpired(entry)) {
        // Warm memory cache
        if (this.config.enableMemoryCache) {
          this.addToMemoryCache(key, entry);
        }
        this.stats.hits++;
        return entry.data;
      }
    } catch {
      // Cache miss
    }

    this.stats.misses++;
    return null;
  }

  /**
   * Set cache entry
   */
  async set<T = any>(
    key: string,
    data: T,
    options: {
      dependencies?: string[];
      ttl?: number;
      source?: string;
      metadata?: Record<string, any>;
    } = {}
  ): Promise<void> {
    await this.ensureInitialized();

    if (!this.shouldCache(key)) {
      return;
    }

    const content = JSON.stringify(data);
    const entry: CacheEntry<T> = {
      hash: this.hash(content),
      data,
      dependencies: options.dependencies || [],
      timestamp: Date.now(),
      ttl: options.ttl || this.config.maxAge * 24 * 60 * 60 * 1000,
      source: options.source || key,
      originalSize: Buffer.byteLength(content, 'utf-8'),
      metadata: options.metadata,
    };

    // Add to memory cache
    if (this.config.enableMemoryCache) {
      this.addToMemoryCache(key, entry);
    }

    // Save to disk
    await this.saveToDisk(key, entry);

    // Enforce size limits
    await this.enforceSizeLimits();
  }

  /**
   * Check if content has changed
   */
  async hasChanged(key: string, content: string): Promise<boolean> {
    const entry = await this.get(key);
    if (!entry) return true;

    const currentHash = this.hash(content);
    return entry.hash !== currentHash;
  }

  /**
   * Invalidate cache entry
   */
  async invalidate(key: string): Promise<void> {
    await this.ensureInitialized();

    this.memoryCache.delete(key);

    try {
      const diskPath = this.getDiskPath(key);
      await fs.unlink(diskPath);
    } catch {
      // Ignore errors
    }
  }

  /**
   * Invalidate entries matching pattern
   */
  async invalidatePattern(pattern: RegExp): Promise<number> {
    await this.ensureInitialized();

    let count = 0;

    // Invalidate memory cache
    for (const key of this.memoryCache.keys()) {
      if (pattern.test(key)) {
        this.memoryCache.delete(key);
        count++;
      }
    }

    // Invalidate disk cache
    try {
      const files = await fs.readdir(this.config.dir);
      for (const file of files) {
        const key = this.keyFromFilename(file);
        if (pattern.test(key)) {
          await fs.unlink(path.join(this.config.dir, file));
          count++;
        }
      }
    } catch {
      // Ignore errors
    }

    return count;
  }

  /**
   * Invalidate dependencies
   */
  async invalidateDependencies(sourcePath: string): Promise<string[]> {
    await this.ensureInitialized();

    const invalidated: string[] = [];

    // Find all entries that depend on the source
    for (const [key, entry] of this.memoryCache.entries()) {
      if (entry.dependencies.includes(sourcePath)) {
        await this.invalidate(key);
        invalidated.push(key);
      }
    }

    // Check disk cache
    try {
      const files = await fs.readdir(this.config.dir);
      for (const file of files) {
        const key = this.keyFromFilename(file);
        if (!this.memoryCache.has(key)) {
          try {
            const entry = await this.loadFromDisk(key);
            if (entry && entry.dependencies.includes(sourcePath)) {
              await this.invalidate(key);
              invalidated.push(key);
            }
          } catch {
            // Skip invalid entries
          }
        }
      }
    } catch {
      // Ignore errors
    }

    return invalidated;
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();

    this.memoryCache.clear();

    try {
      const files = await fs.readdir(this.config.dir);
      await Promise.all(files.map((file) => fs.unlink(path.join(this.config.dir, file))));
    } catch {
      // Ignore errors
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    await this.ensureInitialized();

    const diskEntries = await this.getDiskEntryCount();
    const diskSize = await this.getDiskSize();

    return {
      entries: this.memoryCache.size + diskEntries,
      memoryEntries: this.memoryCache.size,
      diskEntries,
      totalSize: this.getMemorySize() + diskSize,
      memorySize: this.getMemorySize(),
      diskSize,
      hitRate: this.stats.hits + this.stats.misses > 0 ? this.stats.hits / (this.stats.hits + this.stats.misses) : 0,
      hits: this.stats.hits,
      misses: this.stats.misses,
    };
  }

  /**
   * Export cache data for analysis
   */
  async export(): Promise<Record<string, CacheEntry>> {
    await this.ensureInitialized();

    const exported: Record<string, CacheEntry> = {};

    // Export memory cache
    for (const [key, entry] of this.memoryCache.entries()) {
      exported[key] = entry;
    }

    // Export disk cache
    try {
      const files = await fs.readdir(this.config.dir);
      for (const file of files) {
        const key = this.keyFromFilename(file);
        if (!exported[key]) {
          try {
            const entry = await this.loadFromDisk(key);
            if (entry) {
              exported[key] = entry;
            }
          } catch {
            // Skip invalid entries
          }
        }
      }
    } catch {
      // Ignore errors
    }

    return exported;
  }

  /**
   * Prune cache by removing old and large entries
   */
  async prune(): Promise<{ removed: number; freedBytes: number }> {
    await this.ensureInitialized();

    let removed = 0;
    let freedBytes = 0;

    const entries = await this.export();
    const sortedEntries = Object.entries(entries).sort((a, b) => a[1].timestamp - b[1].timestamp);

    for (const [key, entry] of sortedEntries) {
      if (this.isExpired(entry)) {
        await this.invalidate(key);
        removed++;
        freedBytes += entry.compressedSize || entry.originalSize;
      }
    }

    return { removed, freedBytes };
  }

  /**
   * Ensure cache is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  /**
   * Load entry from disk
   */
  private async loadFromDisk<T = any>(key: string): Promise<CacheEntry<T> | null> {
    const diskPath = this.getDiskPath(key);

    try {
      let content: string;

      if (this.config.compression === 'none') {
        content = await fs.readFile(diskPath, 'utf-8');
      } else {
        // Decompress
        const compressed = await fs.readFile(diskPath);
        content = await this.decompress(compressed);
      }

      const entry: CacheEntry<T> = JSON.parse(content);
      return entry;
    } catch {
      return null;
    }
  }

  /**
   * Save entry to disk
   */
  private async saveToDisk(key: string, entry: CacheEntry): Promise<void> {
    const diskPath = this.getDiskPath(key);
    await fs.mkdir(path.dirname(diskPath), { recursive: true });

    const content = JSON.stringify(entry);

    if (this.config.compression === 'none') {
      await fs.writeFile(diskPath, content, 'utf-8');
    } else {
      // Compress
      const compressed = await this.compress(content);
      entry.compressedSize = compressed.length;
      await fs.writeFile(diskPath, compressed);
    }
  }

  /**
   * Compress data
   */
  private async compress(data: string): Promise<Buffer> {
    const buffer = Buffer.from(data, 'utf-8');

    if (this.config.compression === 'gzip') {
      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        createGzip()
          .on('data', (chunk) => chunks.push(chunk))
          .on('end', () => resolve(Buffer.concat(chunks)))
          .on('error', reject)
          .end(buffer);
      });
    } else if (this.config.compression === 'brotli') {
      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        createBrotliCompress()
          .on('data', (chunk) => chunks.push(chunk))
          .on('end', () => resolve(Buffer.concat(chunks)))
          .on('error', reject)
          .end(buffer);
      });
    }

    return buffer;
  }

  /**
   * Decompress data
   */
  private async decompress(data: Buffer): Promise<string> {
    if (this.config.compression === 'gzip') {
      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        createGunzip()
          .on('data', (chunk) => chunks.push(chunk))
          .on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
          .on('error', reject)
          .end(data);
      });
    } else if (this.config.compression === 'brotli') {
      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        createBrotliDecompress()
          .on('data', (chunk) => chunks.push(chunk))
          .on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
          .on('error', reject)
          .end(data);
      });
    }

    return data.toString('utf-8');
  }

  /**
   * Add entry to memory cache
   */
  private addToMemoryCache(key: string, entry: CacheEntry): void {
    // Enforce max entries
    if (this.memoryCache.size >= this.config.memoryCacheMaxEntries) {
      // Remove oldest entry
      const oldestKey = this.memoryCache.keys().next().value;
      if (oldestKey) {
        this.memoryCache.delete(oldestKey);
      }
    }

    this.memoryCache.set(key, entry);
  }

  /**
   * Check if entry should be cached
   */
  private shouldCache(key: string): boolean {
    // Check exclude patterns
    for (const pattern of this.config.exclude) {
      if (typeof pattern === 'string') {
        if (key.includes(pattern)) return false;
      } else if (pattern.test(key)) {
        return false;
      }
    }

    // Check include patterns (if any specified)
    if (this.config.include.length > 0) {
      let included = false;
      for (const pattern of this.config.include) {
        if (typeof pattern === 'string') {
          if (key.includes(pattern)) {
            included = true;
            break;
          }
        } else if (pattern.test(key)) {
          included = true;
          break;
        }
      }
      return included;
    }

    return true;
  }

  /**
   * Check if entry is expired
   */
  private isExpired(entry: CacheEntry): boolean {
    if (this.config.strategy === 'timestamp' || this.config.strategy === 'hybrid') {
      return Date.now() - entry.timestamp > entry.ttl;
    }
    return false;
  }

  /**
   * Get disk path for key
   */
  private getDiskPath(key: string): string {
    const hash = this.hash(key);
    const ext = this.config.compression === 'none' ? 'json' : 'cache';
    return path.join(this.config.dir, `${hash}.${ext}`);
  }

  /**
   * Get key from filename
   */
  private keyFromFilename(filename: string): string {
    return filename.replace(/\.(json|cache)$/, '');
  }

  /**
   * Hash string
   */
  private hash(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Get memory cache size
   */
  private getMemorySize(): number {
    let size = 0;
    for (const entry of this.memoryCache.values()) {
      size += entry.originalSize;
    }
    return size;
  }

  /**
   * Get disk cache size
   */
  private async getDiskSize(): Promise<number> {
    try {
      const files = await fs.readdir(this.config.dir);
      let totalSize = 0;

      for (const file of files) {
        try {
          const stats = await fs.stat(path.join(this.config.dir, file));
          totalSize += stats.size;
        } catch {
          // Skip files that can't be read
        }
      }

      return totalSize;
    } catch {
      return 0;
    }
  }

  /**
   * Get disk entry count
   */
  private async getDiskEntryCount(): Promise<number> {
    try {
      const files = await fs.readdir(this.config.dir);
      return files.length;
    } catch {
      return 0;
    }
  }

  /**
   * Enforce cache size limits
   */
  private async enforceSizeLimits(): Promise<void> {
    const stats = await this.getStats();
    const maxBytes = this.config.maxSize * 1024 * 1024;

    if (stats.totalSize > maxBytes) {
      const entries = await this.export();
      const sortedEntries = Object.entries(entries).sort((a, b) => a[1].timestamp - b[1].timestamp);

      let currentSize = stats.totalSize;
      for (const [key, entry] of sortedEntries) {
        if (currentSize <= maxBytes * 0.9) break; // Keep 90% of max

        await this.invalidate(key);
        currentSize -= entry.compressedSize || entry.originalSize;
      }
    }
  }

  /**
   * Clean expired entries
   */
  private async cleanExpired(): Promise<void> {
    const entries = await this.export();

    for (const [key, entry] of Object.entries(entries)) {
      if (this.isExpired(entry)) {
        await this.invalidate(key);
      }
    }
  }

  /**
   * Load cache metadata
   */
  private async loadMetadata(): Promise<void> {
    // Load any persisted metadata if needed
    // This can be extended to store cache index, etc.
  }
}

/**
 * Create a persistent cache instance
 */
export function createPersistentCache(config: PersistentCacheConfig = {}): PersistentCache {
  return new PersistentCache(config);
}
