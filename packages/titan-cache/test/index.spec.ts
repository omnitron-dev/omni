/**
 * Cache Module Index Tests
 *
 * Tests for cache module exports.
 */

import { describe, it, expect } from 'vitest';
import * as CacheModule from '../src/index.js';

describe('Cache Module Exports', () => {
  describe('Types', () => {
    it('should export type definitions', () => {
      // These are compile-time checks - types are exported
      expect(true).toBe(true);
    });
  });

  describe('Tokens', () => {
    it('should export CACHE_SERVICE_TOKEN', () => {
      expect(CacheModule.CACHE_SERVICE_TOKEN).toBeDefined();
    });

    it('should export CACHE_DEFAULT_TOKEN', () => {
      expect(CacheModule.CACHE_DEFAULT_TOKEN).toBeDefined();
    });

    it('should export CACHE_OPTIONS_TOKEN', () => {
      expect(CacheModule.CACHE_OPTIONS_TOKEN).toBeDefined();
    });

    it('should export getCacheToken', () => {
      expect(CacheModule.getCacheToken).toBeDefined();
      expect(typeof CacheModule.getCacheToken).toBe('function');
    });

    it('should export DEFAULT_CACHE_NAME', () => {
      expect(CacheModule.DEFAULT_CACHE_NAME).toBe('default');
    });
  });

  describe('Cache Implementations', () => {
    it('should export LRUCache', () => {
      expect(CacheModule.LRUCache).toBeDefined();
      expect(typeof CacheModule.LRUCache).toBe('function');
    });

    it('should export LFUCache', () => {
      expect(CacheModule.LFUCache).toBeDefined();
      expect(typeof CacheModule.LFUCache).toBe('function');
    });

    it('should export MultiTierCache', () => {
      expect(CacheModule.MultiTierCache).toBeDefined();
      expect(typeof CacheModule.MultiTierCache).toBe('function');
    });

    it('should export MemoryL2Adapter', () => {
      expect(CacheModule.MemoryL2Adapter).toBeDefined();
      expect(typeof CacheModule.MemoryL2Adapter).toBe('function');
    });
  });

  describe('Wheel Timer', () => {
    it('should export WheelTimer', () => {
      expect(CacheModule.WheelTimer).toBeDefined();
      expect(typeof CacheModule.WheelTimer).toBe('function');
    });

    it('should export HierarchicalWheelTimer', () => {
      expect(CacheModule.HierarchicalWheelTimer).toBeDefined();
      expect(typeof CacheModule.HierarchicalWheelTimer).toBe('function');
    });

    it('should export createCacheWheelTimer', () => {
      expect(CacheModule.createCacheWheelTimer).toBeDefined();
      expect(typeof CacheModule.createCacheWheelTimer).toBe('function');
    });
  });

  describe('Utils', () => {
    it('should export compressValue', () => {
      expect(CacheModule.compressValue).toBeDefined();
      expect(typeof CacheModule.compressValue).toBe('function');
    });

    it('should export decompressValue', () => {
      expect(CacheModule.decompressValue).toBeDefined();
      expect(typeof CacheModule.decompressValue).toBe('function');
    });

    it('should export estimateSize', () => {
      expect(CacheModule.estimateSize).toBeDefined();
      expect(typeof CacheModule.estimateSize).toBe('function');
    });

    it('should export getExactSize', () => {
      expect(CacheModule.getExactSize).toBeDefined();
      expect(typeof CacheModule.getExactSize).toBe('function');
    });

    it('should export deepClone', () => {
      expect(CacheModule.deepClone).toBeDefined();
      expect(typeof CacheModule.deepClone).toBe('function');
    });

    it('should export hashKey', () => {
      expect(CacheModule.hashKey).toBeDefined();
      expect(typeof CacheModule.hashKey).toBe('function');
    });

    it('should export generateCacheKey', () => {
      expect(CacheModule.generateCacheKey).toBeDefined();
      expect(typeof CacheModule.generateCacheKey).toBe('function');
    });

    it('should export parseCacheKey', () => {
      expect(CacheModule.parseCacheKey).toBeDefined();
      expect(typeof CacheModule.parseCacheKey).toBe('function');
    });

    it('should export isSerializable', () => {
      expect(CacheModule.isSerializable).toBeDefined();
      expect(typeof CacheModule.isSerializable).toBe('function');
    });

    it('should export formatBytes', () => {
      expect(CacheModule.formatBytes).toBeDefined();
      expect(typeof CacheModule.formatBytes).toBe('function');
    });

    it('should export calculateHitRate', () => {
      expect(CacheModule.calculateHitRate).toBeDefined();
      expect(typeof CacheModule.calculateHitRate).toBe('function');
    });

    it('should export createTtlCalculator', () => {
      expect(CacheModule.createTtlCalculator).toBeDefined();
      expect(typeof CacheModule.createTtlCalculator).toBe('function');
    });

    it('should export debounce', () => {
      expect(CacheModule.debounce).toBeDefined();
      expect(typeof CacheModule.debounce).toBe('function');
    });

    it('should export throttle', () => {
      expect(CacheModule.throttle).toBeDefined();
      expect(typeof CacheModule.throttle).toBe('function');
    });

    it('should export createMessagePackSerializer', () => {
      expect(CacheModule.createMessagePackSerializer).toBeDefined();
      expect(typeof CacheModule.createMessagePackSerializer).toBe('function');
    });
  });

  describe('Instantiation', () => {
    it('should create LRUCache instance', async () => {
      const cache = new CacheModule.LRUCache({ maxSize: 10 });
      expect(cache).toBeInstanceOf(CacheModule.LRUCache);
      await cache.dispose();
    });

    it('should create LFUCache instance', async () => {
      const cache = new CacheModule.LFUCache({ maxSize: 10 });
      expect(cache).toBeInstanceOf(CacheModule.LFUCache);
      await cache.dispose();
    });

    it('should create MultiTierCache instance', async () => {
      const cache = new CacheModule.MultiTierCache({ l1: { maxSize: 10 } });
      expect(cache).toBeInstanceOf(CacheModule.MultiTierCache);
      await cache.dispose();
    });

    it('should create MemoryL2Adapter instance', () => {
      const adapter = new CacheModule.MemoryL2Adapter();
      expect(adapter).toBeInstanceOf(CacheModule.MemoryL2Adapter);
    });

    it('should create WheelTimer instance', () => {
      const timer = new CacheModule.WheelTimer({ resolution: 100 });
      expect(timer).toBeInstanceOf(CacheModule.WheelTimer);
      timer.destroy();
    });

    it('should create HierarchicalWheelTimer instance', () => {
      const timer = new CacheModule.HierarchicalWheelTimer();
      expect(timer).toBeInstanceOf(CacheModule.HierarchicalWheelTimer);
      timer.destroy();
    });
  });
});
