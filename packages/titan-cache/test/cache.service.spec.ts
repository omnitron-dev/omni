/**
 * CacheService Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CacheService } from '../src/cache.service.js';
import type { ICache } from '../src/cache.types.js';
import { DEFAULT_CACHE_NAME } from '../src/cache.tokens.js';

describe('CacheService', () => {
  let service: CacheService;

  beforeEach(() => {
    service = new CacheService({
      maxSize: 100,
      defaultTtl: 60,
      enableStats: true,
    });
  });

  afterEach(async () => {
    await service.dispose();
  });

  describe('constructor', () => {
    it('should create service with default options', () => {
      const defaultService = new CacheService();
      expect(defaultService).toBeDefined();
      expect(defaultService.listCaches()).toContain(DEFAULT_CACHE_NAME);
      defaultService.dispose();
    });

    it('should create default cache on initialization', () => {
      expect(service.listCaches()).toContain(DEFAULT_CACHE_NAME);
    });
  });

  describe('getCache', () => {
    it('should return default cache when no name provided', () => {
      const cache = service.getCache();
      expect(cache).toBeDefined();
    });

    it('should return default cache by name', () => {
      const cache = service.getCache(DEFAULT_CACHE_NAME);
      expect(cache).toBeDefined();
    });

    it('should throw error for non-existent cache', () => {
      expect(() => service.getCache('non-existent')).toThrow("Cache 'non-existent' not found");
    });
  });

  describe('createCache', () => {
    it('should create a new named cache', () => {
      const cache = service.createCache('users', { maxSize: 50 });
      expect(cache).toBeDefined();
      expect(service.listCaches()).toContain('users');
    });

    it('should throw error if cache already exists', () => {
      service.createCache('users');
      expect(() => service.createCache('users')).toThrow("Cache 'users' already exists");
    });

    it('should throw error if service is disposed', async () => {
      await service.dispose();
      expect(() => service.createCache('test')).toThrow('CacheService has been disposed');
    });

    it('should create LFU cache when evictionPolicy is lfu', () => {
      const cache = service.createCache('lfu-cache', { evictionPolicy: 'lfu' });
      expect(cache).toBeDefined();
    });

    it('should create multi-tier cache when multiTier is true', () => {
      const cache = service.createCache('multi', { multiTier: true });
      expect(cache).toBeDefined();
    });
  });

  describe('getOrCreateCache', () => {
    it('should return existing cache', () => {
      const cache1 = service.createCache('users');
      const cache2 = service.getOrCreateCache('users');
      expect(cache1).toBe(cache2);
    });

    it('should create cache if not exists', () => {
      const cache = service.getOrCreateCache('new-cache');
      expect(cache).toBeDefined();
      expect(service.listCaches()).toContain('new-cache');
    });
  });

  describe('listCaches', () => {
    it('should list all cache names', () => {
      service.createCache('cache1');
      service.createCache('cache2');
      const caches = service.listCaches();
      expect(caches).toContain(DEFAULT_CACHE_NAME);
      expect(caches).toContain('cache1');
      expect(caches).toContain('cache2');
      expect(caches.length).toBe(3);
    });
  });

  describe('deleteCache', () => {
    it('should delete a cache', () => {
      service.createCache('to-delete');
      expect(service.listCaches()).toContain('to-delete');
      const result = service.deleteCache('to-delete');
      expect(result).toBe(true);
      expect(service.listCaches()).not.toContain('to-delete');
    });

    it('should return false for non-existent cache', () => {
      const result = service.deleteCache('non-existent');
      expect(result).toBe(false);
    });

    it('should not allow deleting default cache', () => {
      expect(() => service.deleteCache(DEFAULT_CACHE_NAME)).toThrow('Cannot delete the default cache');
    });
  });

  describe('getGlobalStats', () => {
    it('should aggregate stats from all caches', async () => {
      const cache1 = service.getCache();
      const cache2 = service.createCache('cache2');

      await cache1.set('key1', 'value1');
      await cache2.set('key2', 'value2');
      await cache1.get('key1');
      await cache2.get('key2');

      const stats = service.getGlobalStats();
      expect(stats.hits).toBeGreaterThanOrEqual(2);
      expect(stats.size).toBeGreaterThanOrEqual(2);
    });

    it('should always have stats from default cache', async () => {
      const freshService = new CacheService();
      // Default cache always exists, so stats will have at least one cache
      const stats = freshService.getGlobalStats();
      expect(stats).toBeDefined();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      await freshService.dispose();
    });
  });

  describe('events', () => {
    it('should emit events on cache operations', async () => {
      const listener = vi.fn();
      service.on('set', listener);

      service.createCache('event-test');
      // Creation emits 'set' event with cache_created metadata
      expect(listener).toHaveBeenCalled();

      service.off('set', listener);
    });

    it('should emit delete event', () => {
      const listener = vi.fn();
      service.on('delete', listener);

      service.createCache('to-delete');
      service.deleteCache('to-delete');
      expect(listener).toHaveBeenCalled();

      service.off('delete', listener);
    });
  });

  describe('dispose', () => {
    it('should dispose all caches', async () => {
      service.createCache('cache1');
      service.createCache('cache2');

      await service.dispose();

      expect(service.listCaches().length).toBe(0);
    });

    it('should be idempotent', async () => {
      await service.dispose();
      await service.dispose(); // Should not throw
    });
  });

  describe('cache operations', () => {
    it('should get and set values in cache', async () => {
      const cache: ICache<string> = service.getCache();
      await cache.set('key', 'value');
      const result = await cache.get('key');
      expect(result).toBe('value');
    });

    it('should support TTL', async () => {
      const cache: ICache<string> = service.getCache();
      await cache.set('key', 'value', { ttl: 1 });
      const immediate = await cache.get('key');
      expect(immediate).toBe('value');

      // Wait for expiration (TTL is in seconds)
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const afterExpiry = await cache.get('key');
      expect(afterExpiry).toBeUndefined();
    });

    it('should support tags', async () => {
      const cache: ICache<string> = service.getCache();
      await cache.set('user:1', 'Alice', { tags: ['user'] });
      await cache.set('user:2', 'Bob', { tags: ['user'] });
      await cache.set('post:1', 'Hello', { tags: ['post'] });

      const invalidated = await cache.invalidateByTags(['user']);
      expect(invalidated).toBe(2);

      expect(await cache.get('user:1')).toBeUndefined();
      expect(await cache.get('user:2')).toBeUndefined();
      expect(await cache.get('post:1')).toBe('Hello');
    });
  });
});
