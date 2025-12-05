/**
 * Unit Tests - Metrics Service
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetricsService } from '../../../src/modules/metrics/metrics.service.js';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
    service.reset();
  });

  describe('recordPriceUpdate', () => {
    it('should increment price update counter', () => {
      service.recordPriceUpdate();
      service.recordPriceUpdate();
      service.recordPriceUpdate();

      const metrics = service.getMetrics();
      expect(metrics.priceUpdates).toBe(3);
    });
  });

  describe('recordDbQuery', () => {
    it('should record database query count and time', () => {
      service.recordDbQuery(10);
      service.recordDbQuery(20);
      service.recordDbQuery(30);

      const metrics = service.getMetrics();
      expect(metrics.dbQueries).toBe(3);
      expect(metrics.dbQueryTime).toBe(20); // Average: (10 + 20 + 30) / 3
    });

    it('should handle single query correctly', () => {
      service.recordDbQuery(15.5);

      const metrics = service.getMetrics();
      expect(metrics.dbQueries).toBe(1);
      expect(metrics.dbQueryTime).toBe(15.5);
    });

    it('should return 0 average when no queries', () => {
      const metrics = service.getMetrics();
      expect(metrics.dbQueries).toBe(0);
      expect(metrics.dbQueryTime).toBe(0);
    });
  });

  describe('recordRedisOp', () => {
    it('should increment redis operations counter', () => {
      service.recordRedisOp();
      service.recordRedisOp();

      const metrics = service.getMetrics();
      expect(metrics.redisOps).toBe(2);
    });
  });

  describe('cache metrics', () => {
    it('should record cache hits', () => {
      service.recordCacheHit();
      service.recordCacheHit();
      service.recordCacheHit();

      const metrics = service.getMetrics();
      expect(metrics.cacheHits).toBe(3);
    });

    it('should record cache misses', () => {
      service.recordCacheMiss();
      service.recordCacheMiss();

      const metrics = service.getMetrics();
      expect(metrics.cacheMisses).toBe(2);
    });

    it('should calculate cache hit rate correctly', () => {
      service.recordCacheHit();
      service.recordCacheHit();
      service.recordCacheHit();
      service.recordCacheMiss();

      const hitRate = service.getCacheHitRate();
      expect(hitRate).toBe(0.75); // 3 hits / 4 total = 0.75
    });

    it('should return 0 hit rate when no cache operations', () => {
      const hitRate = service.getCacheHitRate();
      expect(hitRate).toBe(0);
    });

    it('should handle 100% hit rate', () => {
      service.recordCacheHit();
      service.recordCacheHit();

      const hitRate = service.getCacheHitRate();
      expect(hitRate).toBe(1.0);
    });

    it('should handle 0% hit rate', () => {
      service.recordCacheMiss();
      service.recordCacheMiss();

      const hitRate = service.getCacheHitRate();
      expect(hitRate).toBe(0);
    });
  });

  describe('setExchangeStatus', () => {
    it('should set exchange connection status', () => {
      service.setExchangeStatus('binance', true);
      service.setExchangeStatus('kraken', false);

      const metrics = service.getMetrics();
      expect(metrics.exchangeStatus.binance).toBe(true);
      expect(metrics.exchangeStatus.kraken).toBe(false);
    });

    it('should update existing exchange status', () => {
      service.setExchangeStatus('binance', true);
      service.setExchangeStatus('binance', false);

      const metrics = service.getMetrics();
      expect(metrics.exchangeStatus.binance).toBe(false);
    });

    it('should handle multiple exchanges', () => {
      service.setExchangeStatus('binance', true);
      service.setExchangeStatus('kraken', true);
      service.setExchangeStatus('coinbase', false);

      const metrics = service.getMetrics();
      expect(Object.keys(metrics.exchangeStatus)).toHaveLength(3);
    });
  });

  describe('collectSystemMetrics', () => {
    it('should collect memory metrics', () => {
      service.collectSystemMetrics();

      const metrics = service.getMetrics();
      expect(metrics.system.memoryUsage).toBeGreaterThan(0);
      expect(metrics.system.memoryTotal).toBeGreaterThan(0);
      expect(metrics.system.memoryUsage).toBeLessThanOrEqual(
        metrics.system.memoryTotal
      );
    });

    it('should collect CPU metrics', () => {
      service.collectSystemMetrics();

      const metrics = service.getMetrics();
      expect(metrics.system.cpuUsage).toBeGreaterThanOrEqual(0);
    });

    it('should update metrics on subsequent calls', () => {
      service.collectSystemMetrics();
      const metrics1 = service.getMetrics();

      service.collectSystemMetrics();
      const metrics2 = service.getMetrics();

      // Metrics should be updated (values may differ)
      expect(metrics2.system.memoryUsage).toBeGreaterThan(0);
    });
  });

  describe('getMetrics', () => {
    it('should return complete metrics snapshot', () => {
      service.recordPriceUpdate();
      service.recordDbQuery(10);
      service.recordRedisOp();
      service.recordCacheHit();
      service.setExchangeStatus('binance', true);
      service.collectSystemMetrics();

      const metrics = service.getMetrics();

      expect(metrics).toHaveProperty('priceUpdates');
      expect(metrics).toHaveProperty('dbQueries');
      expect(metrics).toHaveProperty('dbQueryTime');
      expect(metrics).toHaveProperty('redisOps');
      expect(metrics).toHaveProperty('cacheHits');
      expect(metrics).toHaveProperty('cacheMisses');
      expect(metrics).toHaveProperty('exchangeStatus');
      expect(metrics).toHaveProperty('system');
      expect(metrics).toHaveProperty('timestamp');
    });

    it('should include ISO timestamp', () => {
      const metrics = service.getMetrics();

      expect(metrics.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(() => new Date(metrics.timestamp)).not.toThrow();
    });

    it('should return independent copies of data', () => {
      service.setExchangeStatus('binance', true);
      const metrics1 = service.getMetrics();

      metrics1.exchangeStatus.binance = false;

      const metrics2 = service.getMetrics();
      expect(metrics2.exchangeStatus.binance).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset all counters', () => {
      service.recordPriceUpdate();
      service.recordDbQuery(10);
      service.recordRedisOp();
      service.recordCacheHit();
      service.recordCacheMiss();
      service.setExchangeStatus('binance', true);

      service.reset();

      const metrics = service.getMetrics();
      expect(metrics.priceUpdates).toBe(0);
      expect(metrics.dbQueries).toBe(0);
      expect(metrics.dbQueryTime).toBe(0);
      expect(metrics.redisOps).toBe(0);
      expect(metrics.cacheHits).toBe(0);
      expect(metrics.cacheMisses).toBe(0);
      expect(Object.keys(metrics.exchangeStatus)).toHaveLength(0);
    });

    it('should allow recording after reset', () => {
      service.recordPriceUpdate();
      service.reset();
      service.recordPriceUpdate();

      const metrics = service.getMetrics();
      expect(metrics.priceUpdates).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('should handle very large numbers', () => {
      for (let i = 0; i < 1000000; i++) {
        service.recordPriceUpdate();
      }

      const metrics = service.getMetrics();
      expect(metrics.priceUpdates).toBe(1000000);
    });

    it('should handle very small query times', () => {
      service.recordDbQuery(0.001);
      service.recordDbQuery(0.002);

      const metrics = service.getMetrics();
      expect(metrics.dbQueryTime).toBeCloseTo(0.0015, 4);
    });

    it('should handle zero query time', () => {
      service.recordDbQuery(0);

      const metrics = service.getMetrics();
      expect(metrics.dbQueryTime).toBe(0);
    });
  });

  describe('integration scenario', () => {
    it('should track realistic usage pattern', () => {
      // Simulate price updates
      for (let i = 0; i < 100; i++) {
        service.recordPriceUpdate();
      }

      // Simulate database queries
      service.recordDbQuery(5.2);
      service.recordDbQuery(3.8);
      service.recordDbQuery(12.1);

      // Simulate Redis operations
      for (let i = 0; i < 500; i++) {
        service.recordRedisOp();
      }

      // Simulate cache operations (80% hit rate)
      for (let i = 0; i < 80; i++) {
        service.recordCacheHit();
      }
      for (let i = 0; i < 20; i++) {
        service.recordCacheMiss();
      }

      // Set exchange statuses
      service.setExchangeStatus('binance', true);
      service.setExchangeStatus('kraken', true);
      service.setExchangeStatus('coinbase', false);

      // Collect system metrics
      service.collectSystemMetrics();

      const metrics = service.getMetrics();

      expect(metrics.priceUpdates).toBe(100);
      expect(metrics.dbQueries).toBe(3);
      expect(metrics.dbQueryTime).toBeCloseTo(7.03, 2);
      expect(metrics.redisOps).toBe(500);
      expect(service.getCacheHitRate()).toBe(0.8);
      expect(Object.keys(metrics.exchangeStatus)).toHaveLength(3);
      expect(metrics.system.memoryUsage).toBeGreaterThan(0);
    });
  });
});
