/**
 * Tests for CacheService
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { Container } from '@omnitron-dev/nexus';
import { CacheService } from '../src/services/cache.service.js';
import { LoggerService } from '../src/services/logger.service.js';
import { TEMPLATE_MODULE_OPTIONS, TEMPLATE_LOGGER } from '../src/constants.js';
import type { TemplateModuleOptions } from '../src/types.js';
import { delay } from '../src/utils.js';

describe('CacheService', () => {
  let container: Container;
  let service: CacheService;
  let options: TemplateModuleOptions;

  beforeEach(() => {
    // Create container
    container = new Container();

    // Create options
    options = {
      debug: false,
      prefix: 'test',
      enableCache: true,
      cacheTTL: 1, // 1 second for testing
    };

    // Register dependencies
    container.register(TEMPLATE_MODULE_OPTIONS, { useValue: options });
    container.register(TEMPLATE_LOGGER, { useClass: LoggerService });
    container.register(CacheService, { useClass: CacheService });

    // Resolve service
    service = container.resolve(CacheService);
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await service.initialize();
      expect(service.size()).toBe(0);
    });

    it('should handle multiple initialization calls', async () => {
      await service.initialize();
      await service.initialize(); // Should not throw
      expect(service.size()).toBe(0);
    });
  });

  describe('get/set', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should set and get a value', async () => {
      await service.set('key1', { value: 'test' });
      const result = await service.get('key1');

      expect(result).toEqual({ value: 'test' });
    });

    it('should return null for non-existent key', async () => {
      const result = await service.get('non-existent');
      expect(result).toBeNull();
    });

    it('should handle different data types', async () => {
      await service.set('string', 'value');
      await service.set('number', 42);
      await service.set('boolean', true);
      await service.set('array', [1, 2, 3]);
      await service.set('object', { nested: { value: true } });

      expect(await service.get('string')).toBe('value');
      expect(await service.get('number')).toBe(42);
      expect(await service.get('boolean')).toBe(true);
      expect(await service.get('array')).toEqual([1, 2, 3]);
      expect(await service.get('object')).toEqual({ nested: { value: true } });
    });
  });

  describe('TTL expiration', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should expire entries after TTL', async () => {
      await service.set('expiring', 'value', 0.1); // 100ms TTL

      // Should exist immediately
      expect(await service.get('expiring')).toBe('value');

      // Wait for expiration
      await delay(150);

      // Should be expired
      expect(await service.get('expiring')).toBeNull();
    });

    it('should use default TTL when not specified', async () => {
      await service.set('default-ttl', 'value');

      // Should exist immediately
      expect(await service.get('default-ttl')).toBe('value');

      // Wait for default TTL (1 second in test config)
      await delay(1100);

      // Should be expired
      expect(await service.get('default-ttl')).toBeNull();
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should delete an existing key', async () => {
      await service.set('to-delete', 'value');
      expect(await service.get('to-delete')).toBe('value');

      const result = await service.delete('to-delete');
      expect(result).toBe(true);
      expect(await service.get('to-delete')).toBeNull();
    });

    it('should return false when deleting non-existent key', async () => {
      const result = await service.delete('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('has', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should return true for existing key', async () => {
      await service.set('exists', 'value');
      expect(await service.has('exists')).toBe(true);
    });

    it('should return false for non-existent key', async () => {
      expect(await service.has('non-existent')).toBe(false);
    });

    it('should return false for expired key', async () => {
      await service.set('expiring', 'value', 0.1);
      expect(await service.has('expiring')).toBe(true);

      await delay(150);
      expect(await service.has('expiring')).toBe(false);
    });
  });

  describe('clear', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should clear all cache entries', async () => {
      await service.set('key1', 'value1');
      await service.set('key2', 'value2');
      await service.set('key3', 'value3');

      expect(service.size()).toBe(3);

      await service.clear();
      expect(service.size()).toBe(0);
      expect(await service.get('key1')).toBeNull();
      expect(await service.get('key2')).toBeNull();
      expect(await service.get('key3')).toBeNull();
    });
  });

  describe('size', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should return the number of cache entries', async () => {
      expect(service.size()).toBe(0);

      await service.set('key1', 'value1');
      expect(service.size()).toBe(1);

      await service.set('key2', 'value2');
      expect(service.size()).toBe(2);

      await service.delete('key1');
      expect(service.size()).toBe(1);
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should return cache statistics', async () => {
      await service.set('key1', 'value1');
      await service.set('key2', 'value2', 0.1); // Short TTL
      await delay(150); // Let one expire
      await service.set('key3', 'value3');

      const stats = service.getStats();

      expect(stats.size).toBe(3); // Including expired
      expect(stats.expired).toBe(1);
      expect(stats.avgAge).toBeGreaterThan(0);
      expect(stats.enabled).toBe(true);
    });
  });

  describe('healthCheck', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should pass health check', async () => {
      const result = await service.healthCheck();
      expect(result).toBe(true);
    });
  });

  describe('cache disabled', () => {
    beforeEach(() => {
      // Recreate with cache disabled
      options.enableCache = false;
      container.register(TEMPLATE_MODULE_OPTIONS, { useValue: options });
      service = new CacheService(options, container.resolve(TEMPLATE_LOGGER));
    });

    it('should return null when cache is disabled', async () => {
      await service.set('key', 'value');
      const result = await service.get('key');
      expect(result).toBeNull();
    });

    it('should return false for has() when cache is disabled', async () => {
      await service.set('key', 'value');
      const result = await service.has('key');
      expect(result).toBe(false);
    });

    it('should return false for delete() when cache is disabled', async () => {
      const result = await service.delete('key');
      expect(result).toBe(false);
    });
  });
});
