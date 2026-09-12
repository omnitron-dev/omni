/**
 * Cache Utility Functions
 *
 * Provides compression, serialization, and size estimation utilities
 *
 * @module titan/modules/cache
 */

import { promisify } from 'node:util';
import { gzip, gunzip, deflate, inflate } from 'node:zlib';
import type { CompressionAlgorithm } from './cache.types.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const deflateAsync = promisify(deflate);
const inflateAsync = promisify(inflate);

/**
 * Compress a value using the specified algorithm
 */
export async function compressValue(value: unknown, algorithm: CompressionAlgorithm): Promise<Buffer> {
  if (algorithm === 'none') {
    return Buffer.from(JSON.stringify(value));
  }

  const serialized = JSON.stringify(value);
  const input = Buffer.from(serialized);

  switch (algorithm) {
    case 'gzip':
      return gzipAsync(input);
    case 'deflate':
      return deflateAsync(input);
    case 'brotli':
      if (typeof (await import('node:zlib')).brotliCompress === 'function') {
        const { brotliCompress } = await import('node:zlib');
        return promisify(brotliCompress)(input);
      }
      return gzipAsync(input);
    case 'lz4':
      return deflateAsync(input);
    default:
      return Buffer.from(serialized);
  }
}

/**
 * Decompress a buffer using the specified algorithm
 */
export async function decompressValue<T>(data: Buffer, algorithm: CompressionAlgorithm): Promise<T> {
  if (algorithm === 'none') {
    return JSON.parse(data.toString()) as T;
  }

  let decompressed: Buffer;

  switch (algorithm) {
    case 'gzip':
      decompressed = await gunzipAsync(data);
      break;
    case 'deflate':
      decompressed = await inflateAsync(data);
      break;
    case 'brotli':
      if (typeof (await import('node:zlib')).brotliDecompress === 'function') {
        const { brotliDecompress } = await import('node:zlib');
        decompressed = await promisify(brotliDecompress)(data);
      } else {
        decompressed = await gunzipAsync(data);
      }
      break;
    case 'lz4':
      decompressed = await inflateAsync(data);
      break;
    default:
      return JSON.parse(data.toString()) as T;
  }

  return JSON.parse(decompressed.toString()) as T;
}

/**
 * A reference we have already counted, and the deepest we will walk.
 *
 * Without the first, an object that points back at itself recurses until the
 * stack ends: `const a = {}; a.self = a` answered
 * `RangeError: Maximum call stack size exceeded`. That is not a theoretical
 * input — a row with a parent/child back-reference is the ordinary shape of a
 * tree node, and this function is reached from `LruCache.set` and
 * `LfuCache.set`, whose promises most callers do not await. A throw there is
 * an unhandled rejection, not a caught error.
 *
 * The depth cap covers the other half: a long enough chain overflows the
 * stack without ever repeating a reference. 128 is far past any value worth
 * caching and far short of the ~10k frames V8 allows.
 */
const MAX_DEPTH = 128;

/** A second sighting of the same object is a reference, so it costs a pointer. */
const REFERENCE_SIZE = 8;

/**
 * Estimate the size of a value in bytes.
 *
 * Cycle-safe and depth-bounded: never throws, for any input.
 */
export function estimateSize(value: unknown): number {
  return estimateSizeInner(value, new WeakSet<object>(), 0);
}

function estimateSizeInner(value: unknown, seen: WeakSet<object>, depth: number): number {
  if (value === null || value === undefined) {
    return 8;
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return REFERENCE_SIZE;
    if (depth >= MAX_DEPTH) return REFERENCE_SIZE;
    seen.add(value);
  }

  switch (typeof value) {
    case 'boolean':
      return 4;
    case 'number':
      return 8;
    case 'bigint':
      return 8 + String(value).length;
    case 'string':
      return value.length * 2 + 16;
    case 'symbol':
      return 8 + (value.description?.length ?? 0) * 2;
    case 'function':
      return 0;
    case 'object':
      if (Buffer.isBuffer(value)) {
        return value.length + 16;
      }
      if (value instanceof Date) {
        return 24;
      }
      if (value instanceof RegExp) {
        return value.source.length * 2 + 24;
      }
      if (Array.isArray(value)) {
        let size = 24 + value.length * 8;
        for (const item of value) {
          size += estimateSizeInner(item, seen, depth + 1);
        }
        return size;
      }
      if (value instanceof Map) {
        let size = 48;
        for (const [k, v] of value) {
          size += estimateSizeInner(k, seen, depth + 1) + estimateSizeInner(v, seen, depth + 1);
        }
        return size;
      }
      if (value instanceof Set) {
        let size = 48;
        for (const item of value) {
          size += estimateSizeInner(item, seen, depth + 1);
        }
        return size;
      }
      {
        let objSize = 16;
        for (const key in value) {
          if (Object.prototype.hasOwnProperty.call(value, key)) {
            objSize += key.length * 2 + 8;
            objSize += estimateSizeInner((value as Record<string, unknown>)[key], seen, depth + 1);
          }
        }
        return objSize;
      }
    default:
      return 8;
  }
}

/**
 * Get exact size by serializing, falling back to the estimate.
 *
 * The catch exists for one input above all: a circular structure, which is
 * what makes `JSON.stringify` throw. Until `estimateSize` grew its cycle
 * guard, the fallback was itself the crash path — a clean
 * `TypeError: Converting circular structure to JSON` became
 * `RangeError: Maximum call stack size exceeded`, which is the one outcome
 * a fallback must never produce.
 */
export function getExactSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return estimateSize(value);
  }
}

/**
 * Deep clone a value
 */
export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Fall through
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Hash a key for partitioning (FNV-1a)
 */
export function hashKey(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Generate a cache key from components
 */
export function generateCacheKey(...parts: (string | number | boolean | undefined | null)[]): string {
  return parts
    .filter((p) => p !== undefined && p !== null)
    .map((p) => String(p))
    .join(':');
}

/**
 * Parse a cache key into components
 */
export function parseCacheKey(key: string): string[] {
  return key.split(':');
}

/**
 * Check if a value is serializable
 */
export function isSerializable(value: unknown): boolean {
  if (value === null || value === undefined) return true;

  switch (typeof value) {
    case 'boolean':
    case 'number':
    case 'string':
      return true;
    case 'bigint':
    case 'symbol':
    case 'function':
      return false;
    case 'object':
      if (value instanceof Date || value instanceof RegExp) {
        return true;
      }
      if (Array.isArray(value)) {
        return value.every(isSerializable);
      }
      if (value instanceof Map || value instanceof Set) {
        return false;
      }
      for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          if (!isSerializable((value as Record<string, unknown>)[key])) {
            return false;
          }
        }
      }
      return true;
    default:
      return false;
  }
}

/**
 * Format bytes for display
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let size = bytes;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return size.toFixed(2) + ' ' + units[unitIndex];
}

/**
 * Calculate hit rate percentage
 */
export function calculateHitRate(hits: number, misses: number): string {
  const total = hits + misses;
  if (total === 0) return '0.00%';
  return ((hits / total) * 100).toFixed(2) + '%';
}

/**
 * Create a TTL calculator with jitter to prevent cache stampedes
 */
export function createTtlCalculator(baseTtl: number, jitterPercent: number = 10): () => number {
  const jitterRange = baseTtl * (jitterPercent / 100);

  return () => {
    const jitter = Math.random() * jitterRange * 2 - jitterRange;
    return Math.max(1, Math.round(baseTtl + jitter));
  };
}

/**
 * Debounce function for batch operations
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, wait);
  };
}

/**
 * Throttle function for rate limiting
 */
export function throttle<T extends (...args: unknown[]) => unknown>(fn: T, limit: number): T {
  let lastCall = 0;
  let lastResult: ReturnType<T>;

  return ((...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall >= limit) {
      lastCall = now;
      lastResult = fn(...args) as ReturnType<T>;
    }
    return lastResult;
  }) as T;
}

/**
 * MessagePack-based serializer factory
 */
export async function createMessagePackSerializer(): Promise<{
  serialize: (value: unknown) => Buffer;
  deserialize: <T>(data: Buffer) => T;
}> {
  try {
    const { pack, unpack } = await import('msgpackr');
    return {
      serialize: (value: unknown) => pack(value) as Buffer,
      deserialize: <T>(data: Buffer) => unpack(data) as T,
    };
  } catch {
    return {
      serialize: (value: unknown) => Buffer.from(JSON.stringify(value)),
      deserialize: <T>(data: Buffer) => JSON.parse(data.toString()) as T,
    };
  }
}

/**
 * Singleflight - Prevents cache stampede by deduplicating concurrent requests
 *
 * When multiple concurrent requests are made for the same key while a fetch is in progress,
 * only one fetch is performed and all waiters receive the same result.
 *
 * @example
 * ```typescript
 * const singleflight = new Singleflight<User>();
 *
 * // All concurrent calls with same key share one fetch
 * const user = await singleflight.do('user:123', async () => {
 *   return await fetchUserFromDb(123);
 * });
 * ```
 */
export class Singleflight<T = unknown> {
  private readonly inflight: Map<string, Promise<T>> = new Map();

  /**
   * Execute a function, deduplicating concurrent calls for the same key.
   *
   * @param key - Unique key identifying the operation
   * @param fn - Function to execute if no inflight request exists
   * @returns Promise resolving to the function result
   */
  async do(key: string, fn: () => Promise<T>): Promise<T> {
    // Check if there's already an inflight request for this key
    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }

    // Create new promise and store it
    const promise = fn().finally(() => {
      // Clean up after completion (success or failure)
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }

  /**
   * Check if there's an inflight request for a key
   */
  has(key: string): boolean {
    return this.inflight.has(key);
  }

  /**
   * Get the number of inflight requests
   */
  get size(): number {
    return this.inflight.size;
  }

  /**
   * Clear all inflight requests (use with caution - does not cancel promises)
   */
  clear(): void {
    this.inflight.clear();
  }
}

/**
 * Create a cache-aware getOrSet function with stampede protection
 *
 * @example
 * ```typescript
 * import { createCacheGetOrSet } from '@omnitron-dev/titan/module/cache';
 *
 * const getOrSet = createCacheGetOrSet(myCache);
 *
 * // Safe from stampede - concurrent calls share one fetch
 * const user = await getOrSet('user:123', async () => {
 *   return await fetchUserFromDb(123);
 * }, { ttl: 300 });
 * ```
 */
export function createCacheGetOrSet<T>(
  cache: {
    get: (key: string) => Promise<T | undefined>;
    set: (key: string, value: T, options?: { ttl?: number }) => Promise<void>;
  },
  singleflight: Singleflight<T> = new Singleflight<T>()
): (key: string, factory: () => Promise<T>, options?: { ttl?: number }) => Promise<T> {
  return async (key: string, factory: () => Promise<T>, options?: { ttl?: number }): Promise<T> => {
    // Check cache first
    const cached = await cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    // Use singleflight to prevent stampede
    return singleflight.do(key, async () => {
      // Double-check cache (another request might have populated it)
      const cached2 = await cache.get(key);
      if (cached2 !== undefined) {
        return cached2;
      }

      // Fetch and cache
      const value = await factory();
      await cache.set(key, value, options);
      return value;
    });
  };
}

/**
 * AsyncMutex - Simple async mutex for protecting critical sections
 *
 * Useful for preventing race conditions in cache eviction and other operations.
 *
 * @example
 * ```typescript
 * const mutex = new AsyncMutex();
 *
 * await mutex.runExclusive(async () => {
 *   // This code runs exclusively
 *   await performCriticalOperation();
 * });
 * ```
 */
export class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  /**
   * Acquire the mutex lock
   */
  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  /**
   * Release the mutex lock
   */
  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    } else {
      this.locked = false;
    }
  }

  /**
   * Run a function exclusively (with automatic lock/unlock)
   */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Check if the mutex is currently locked
   */
  isLocked(): boolean {
    return this.locked;
  }

  /**
   * Get the number of waiters in the queue
   */
  get waitersCount(): number {
    return this.queue.length;
  }
}
