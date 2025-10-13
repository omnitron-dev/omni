/**
 * Tests for Persistent Cache
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PersistentCache, createPersistentCache } from '../../src/build/persistent-cache.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('PersistentCache', () => {
  let cache: PersistentCache;
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = path.join(os.tmpdir(), `aether-cache-test-${Date.now()}`);
    cache = new PersistentCache({
      dir: cacheDir,
      compression: 'none', // Disable compression for easier testing
      enableMemoryCache: true,
    });
    await cache.init();
  });

  afterEach(async () => {
    await cache.clear();
    try {
      await fs.rm(cacheDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('Basic Operations', () => {
    it('should initialize cache', async () => {
      expect(cache).toBeDefined();
      const stats = await cache.getStats();
      expect(stats.entries).toBe(0);
    });

    it('should store and retrieve data', async () => {
      const data = { value: 'test data', number: 42 };
      await cache.set('test-key', data);

      const retrieved = await cache.get('test-key');
      expect(retrieved).toEqual(data);
    });

    it('should return null for missing keys', async () => {
      const result = await cache.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should handle various data types', async () => {
      const testData = [
        { key: 'string', value: 'hello world' },
        { key: 'number', value: 12345 },
        { key: 'boolean', value: true },
        { key: 'array', value: [1, 2, 3] },
        { key: 'object', value: { nested: { deep: 'value' } } },
        { key: 'null', value: null },
      ];

      for (const { key, value } of testData) {
        await cache.set(key, value);
      }

      for (const { key, value } of testData) {
        const retrieved = await cache.get(key);
        expect(retrieved).toEqual(value);
      }
    });
  });

  describe('Dependencies', () => {
    it('should track dependencies', async () => {
      await cache.set(
        'module-a',
        { code: 'a' },
        {
          dependencies: ['lib-1', 'lib-2'],
        }
      );

      const data = await cache.get('module-a');
      expect(data).toBeDefined();
    });

    it('should invalidate dependent modules', async () => {
      await cache.set(
        'module-a',
        { code: 'a' },
        {
          dependencies: ['lib-1'],
        }
      );

      await cache.set(
        'module-b',
        { code: 'b' },
        {
          dependencies: ['lib-1', 'lib-2'],
        }
      );

      const invalidated = await cache.invalidateDependencies('lib-1');

      expect(invalidated).toContain('module-a');
      expect(invalidated).toContain('module-b');
    });
  });

  describe('Change Detection', () => {
    it('should detect changed content', async () => {
      const content1 = 'original content';
      const content2 = 'modified content';

      await cache.set(
        'module.js',
        { code: content1 },
        {
          source: 'module.js',
        }
      );

      const hasChanged = await cache.hasChanged('module.js', content2);
      expect(hasChanged).toBe(true);
    });

    it('should detect unchanged content', async () => {
      const content = 'same content';

      await cache.set(
        'module.js',
        { code: content },
        {
          source: 'module.js',
        }
      );

      const hasChanged = await cache.hasChanged('module.js', content);
      expect(hasChanged).toBe(false);
    });
  });

  describe('Invalidation', () => {
    it('should invalidate single entry', async () => {
      await cache.set('test-key', { value: 'test' });
      await cache.invalidate('test-key');

      const result = await cache.get('test-key');
      expect(result).toBeNull();
    });

    it('should invalidate by pattern', async () => {
      await cache.set('module-1.js', { code: '1' });
      await cache.set('module-2.js', { code: '2' });
      await cache.set('style.css', { code: 'css' });

      const count = await cache.invalidatePattern(/module-.*\.js/);

      expect(count).toBeGreaterThanOrEqual(2);
      expect(await cache.get('module-1.js')).toBeNull();
      expect(await cache.get('module-2.js')).toBeNull();
      expect(await cache.get('style.css')).not.toBeNull();
    });

    it('should clear all cache', async () => {
      await cache.set('key1', { value: '1' });
      await cache.set('key2', { value: '2' });
      await cache.set('key3', { value: '3' });

      await cache.clear();

      const stats = await cache.getStats();
      expect(stats.entries).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should track cache hits and misses', async () => {
      await cache.set('key1', { value: 'test' });

      // Hit
      await cache.get('key1');
      // Miss
      await cache.get('nonexistent');

      const stats = await cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.5);
    });

    it('should calculate cache size', async () => {
      await cache.set('key1', { value: 'test data 1' });
      await cache.set('key2', { value: 'test data 2' });

      const stats = await cache.getStats();
      expect(stats.totalSize).toBeGreaterThan(0);
    });

    it('should count entries correctly', async () => {
      await cache.set('key1', { value: '1' });
      await cache.set('key2', { value: '2' });
      await cache.set('key3', { value: '3' });

      const stats = await cache.getStats();
      expect(stats.entries).toBe(3);
    });
  });

  describe('TTL and Expiration', () => {
    it('should expire old entries', async () => {
      await cache.set(
        'expired-key',
        { value: 'test' },
        {
          ttl: 1, // 1ms TTL
        }
      );

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await cache.get('expired-key');
      expect(result).toBeNull();
    });

    it('should not expire fresh entries', async () => {
      await cache.set(
        'fresh-key',
        { value: 'test' },
        {
          ttl: 60000, // 60 seconds
        }
      );

      const result = await cache.get('fresh-key');
      expect(result).toEqual({ value: 'test' });
    });
  });

  describe('Include/Exclude Patterns', () => {
    it('should respect exclude patterns', async () => {
      const excludeCache = new PersistentCache({
        dir: cacheDir,
        exclude: [/node_modules/, '.test.'],
      });
      await excludeCache.init();

      await excludeCache.set('app.js', { code: 'app' });
      await excludeCache.set('node_modules/lib.js', { code: 'lib' });
      await excludeCache.set('app.test.js', { code: 'test' });

      const stats = await excludeCache.getStats();
      // Only app.js should be cached
      expect(stats.entries).toBeLessThanOrEqual(1);
    });

    it('should respect include patterns', async () => {
      const includeCache = new PersistentCache({
        dir: cacheDir,
        include: [/\.js$/, /\.ts$/],
      });
      await includeCache.init();

      await includeCache.set('app.js', { code: 'js' });
      await includeCache.set('app.ts', { code: 'ts' });
      await includeCache.set('style.css', { code: 'css' });

      const exported = await includeCache.export();
      const keys = Object.keys(exported);

      expect(keys).toContain('app.js');
      expect(keys).toContain('app.ts');
      expect(keys).not.toContain('style.css');
    });
  });

  describe('Export and Prune', () => {
    it('should export all cache data', async () => {
      await cache.set('key1', { value: '1' });
      await cache.set('key2', { value: '2' });
      await cache.set('key3', { value: '3' });

      const exported = await cache.export();

      expect(Object.keys(exported)).toHaveLength(3);
      expect(exported['key1']).toBeDefined();
      expect(exported['key2']).toBeDefined();
      expect(exported['key3']).toBeDefined();
    });

    it('should prune expired entries', async () => {
      await cache.set('expired1', { value: '1' }, { ttl: 1 });
      await cache.set('expired2', { value: '2' }, { ttl: 1 });
      await cache.set('fresh', { value: '3' }, { ttl: 60000 });

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await cache.prune();

      expect(result.removed).toBe(2);
      expect(result.freedBytes).toBeGreaterThan(0);
    });
  });

  describe('Memory Cache', () => {
    it('should use memory cache for repeated access', async () => {
      await cache.set('hot-key', { value: 'hot data' });

      // First access - from disk
      const first = await cache.get('hot-key');
      // Second access - from memory
      const second = await cache.get('hot-key');

      expect(first).toEqual(second);
    });

    it('should respect memory cache size limits', async () => {
      const limitedCache = new PersistentCache({
        dir: cacheDir,
        memoryCacheMaxEntries: 2,
      });
      await limitedCache.init();

      await limitedCache.set('key1', { value: '1' });
      await limitedCache.set('key2', { value: '2' });
      await limitedCache.set('key3', { value: '3' }); // Should evict key1

      const stats = await limitedCache.getStats();
      expect(stats.memoryEntries).toBeLessThanOrEqual(2);
    });
  });

  describe('Compression', () => {
    it('should work with gzip compression', async () => {
      const gzipCache = new PersistentCache({
        dir: path.join(cacheDir, 'gzip'),
        compression: 'gzip',
      });
      await gzipCache.init();

      const data = { value: 'test data with gzip compression' };
      await gzipCache.set('compressed-key', data);

      const retrieved = await gzipCache.get('compressed-key');
      expect(retrieved).toEqual(data);

      await gzipCache.clear();
    });

    it('should work with brotli compression', async () => {
      const brotliCache = new PersistentCache({
        dir: path.join(cacheDir, 'brotli'),
        compression: 'brotli',
      });
      await brotliCache.init();

      const data = { value: 'test data with brotli compression' };
      await brotliCache.set('compressed-key', data);

      const retrieved = await brotliCache.get('compressed-key');
      expect(retrieved).toEqual(data);

      await brotliCache.clear();
    });
  });

  describe('Size Limits', () => {
    it('should enforce max size', async () => {
      const smallCache = new PersistentCache({
        dir: cacheDir,
        maxSize: 0.001, // Very small: 1KB
      });
      await smallCache.init();

      // Add entries until size limit is hit
      for (let i = 0; i < 100; i++) {
        await smallCache.set(`key-${i}`, {
          value: 'a'.repeat(100), // 100 bytes each
        });
      }

      const stats = await smallCache.getStats();
      // Should have removed old entries
      expect(stats.entries).toBeLessThan(100);
    });
  });

  describe('createPersistentCache factory', () => {
    it('should create cache instance', () => {
      const factoryCache = createPersistentCache({
        dir: cacheDir,
      });

      expect(factoryCache).toBeInstanceOf(PersistentCache);
    });

    it('should use default configuration', () => {
      const factoryCache = createPersistentCache();

      expect(factoryCache).toBeInstanceOf(PersistentCache);
    });
  });

  describe('Metadata', () => {
    it('should store and retrieve metadata', async () => {
      const metadata = {
        compiler: 'esbuild',
        version: '1.0.0',
        flags: ['--minify'],
      };

      await cache.set(
        'module.js',
        { code: 'test' },
        {
          metadata,
        }
      );

      const exported = await cache.export();
      expect(exported['module.js']?.metadata).toEqual(metadata);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty data', async () => {
      await cache.set('empty', {});

      const result = await cache.get('empty');
      expect(result).toEqual({});
    });

    it('should handle large data', async () => {
      const largeData = {
        content: 'x'.repeat(10000), // 10KB (reduced to avoid memory issues)
      };

      await cache.set('large', largeData);

      const result = await cache.get('large');
      expect(result).toEqual(largeData);
    });

    it('should handle special characters in keys', async () => {
      const specialKeys = ['file with spaces.js', 'file-with-dashes.js', 'file_with_underscores.js', 'file@version.js'];

      for (const key of specialKeys) {
        await cache.set(key, { value: key });
      }

      for (const key of specialKeys) {
        const result = await cache.get(key);
        expect(result).toEqual({ value: key });
      }
    });
  });
});
