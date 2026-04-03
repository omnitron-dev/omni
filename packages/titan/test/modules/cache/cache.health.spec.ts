/**
 * Cache Health Indicator Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CacheHealthIndicator,
  MultiTierCacheHealthIndicator,
  createCacheHealthIndicator,
  createMultiTierCacheHealthIndicator,
} from '../../../src/modules/cache/cache.health.js';
import { CacheService } from '../../../src/modules/cache/cache.service.js';
import type { ICacheService } from '../../../src/modules/cache/cache.types.js';

describe('CacheHealthIndicator', () => {
  let cacheService: ICacheService;
  let healthIndicator: CacheHealthIndicator;

  beforeEach(() => {
    cacheService = new CacheService({
      maxSize: 100,
      defaultTtl: 60,
      enableStats: true,
    });
    healthIndicator = new CacheHealthIndicator(cacheService);
  });

  afterEach(async () => {
    await cacheService.dispose();
  });

  describe('check', () => {
    it('should return healthy status with minimal operations', async () => {
      const result = await healthIndicator.check();
      expect(result.status).toBe('healthy');
      expect(result.details).toBeDefined();
    });

    it('should include cache names in details', async () => {
      cacheService.createCache('users');
      cacheService.createCache('products');

      const result = await healthIndicator.check();
      expect(result.details?.caches).toContain('default');
      expect(result.details?.caches).toContain('users');
      expect(result.details?.caches).toContain('products');
    });

    it('should include statistics in details', async () => {
      const cache = cacheService.getCache();
      await cache.set('key1', 'value1');
      await cache.get('key1');
      await cache.get('key2'); // miss

      const result = await healthIndicator.check();
      expect(result.details?.hits).toBeGreaterThanOrEqual(1);
      expect(result.details?.misses).toBeGreaterThanOrEqual(1);
      expect(result.details?.totalEntries).toBeGreaterThanOrEqual(1);
    });

    it('should report degraded status on low hit rate', async () => {
      // Create health indicator with low minHitRate threshold
      const strictIndicator = new CacheHealthIndicator(cacheService, {
        minHitRate: 0.9,
        minOperations: 5,
      });

      const cache = cacheService.getCache();

      // Generate many misses
      for (let i = 0; i < 10; i++) {
        await cache.get(`nonexistent-${i}`);
      }
      // One hit
      await cache.set('key', 'value');
      await cache.get('key');

      const result = await strictIndicator.check();
      // Hit rate is 1/11 ≈ 9%, should be degraded or unhealthy
      expect(['degraded', 'unhealthy']).toContain(result.status);
    });

    it('should check memory usage threshold', async () => {
      const lowMemoryIndicator = new CacheHealthIndicator(cacheService, {
        maxMemoryUsage: 1, // 1 byte - will trigger warning
      });

      const cache = cacheService.getCache();
      await cache.set('key', 'some value that takes more than 1 byte');

      const result = await lowMemoryIndicator.check();
      expect(['degraded', 'unhealthy']).toContain(result.status);
    });

    it('should format bytes correctly in details', async () => {
      const cache = cacheService.getCache();
      await cache.set('key', 'value');

      const result = await healthIndicator.check();
      expect(result.details?.memoryUsageFormatted).toMatch(/\d+(\.\d+)?\s*(B|KB|MB|GB)/);
    });

    it('should include thresholds in details', async () => {
      const result = await healthIndicator.check();
      expect(result.details?.thresholds).toBeDefined();
      expect(result.details?.thresholds).toHaveProperty('minHitRate');
      expect(result.details?.thresholds).toHaveProperty('maxMemoryUsage');
    });
  });

  describe('name', () => {
    it('should have correct name', () => {
      expect(healthIndicator.name).toBe('cache');
    });
  });
});

describe('MultiTierCacheHealthIndicator', () => {
  let cacheService: ICacheService;
  let healthIndicator: MultiTierCacheHealthIndicator;

  beforeEach(() => {
    cacheService = new CacheService({
      maxSize: 100,
      defaultTtl: 60,
      enableStats: true,
      multiTier: true,
    });
    healthIndicator = new MultiTierCacheHealthIndicator(cacheService);
  });

  afterEach(async () => {
    await cacheService.dispose();
  });

  describe('check', () => {
    it('should return healthy status', async () => {
      const result = await healthIndicator.check();
      expect(result.status).toBe('healthy');
    });

    it('should include overall stats in details', async () => {
      const result = await healthIndicator.check();
      expect(result.details?.overall).toBeDefined();
      expect(result.details?.overall).toHaveProperty('hitRate');
      expect(result.details?.overall).toHaveProperty('size');
    });
  });

  describe('name', () => {
    it('should have correct name', () => {
      expect(healthIndicator.name).toBe('cache:multi-tier');
    });
  });
});

describe('Factory functions', () => {
  let cacheService: ICacheService;

  beforeEach(() => {
    cacheService = new CacheService({
      maxSize: 100,
      defaultTtl: 60,
    });
  });

  afterEach(async () => {
    await cacheService.dispose();
  });

  describe('createCacheHealthIndicator', () => {
    it('should create a CacheHealthIndicator', () => {
      const indicator = createCacheHealthIndicator(cacheService);
      expect(indicator).toBeInstanceOf(CacheHealthIndicator);
    });

    it('should accept custom thresholds', () => {
      const indicator = createCacheHealthIndicator(cacheService, {
        minHitRate: 0.8,
        maxMemoryUsage: 1024 * 1024,
      });
      expect(indicator).toBeInstanceOf(CacheHealthIndicator);
    });
  });

  describe('createMultiTierCacheHealthIndicator', () => {
    it('should create a MultiTierCacheHealthIndicator', () => {
      const indicator = createMultiTierCacheHealthIndicator(cacheService);
      expect(indicator).toBeInstanceOf(MultiTierCacheHealthIndicator);
    });

    it('should accept custom timeout', () => {
      const indicator = createMultiTierCacheHealthIndicator(cacheService, {}, 10000);
      expect(indicator).toBeInstanceOf(MultiTierCacheHealthIndicator);
    });
  });
});
