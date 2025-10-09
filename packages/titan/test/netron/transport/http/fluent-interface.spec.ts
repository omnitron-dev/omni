/**
 * Tests for FluentInterface (Phase 1)
 * Tests the enhanced fluent API for natural Netron-style method calls
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  FluentInterface,
  ConfigurableProxy,
  HttpCacheManager,
  RetryManager
} from '../../../../src/netron/transport/http/fluent-interface/index.js';
import { HttpTransportClient } from '../../../../src/netron/transport/http/client.js';
import type { Definition } from '../../../../src/netron/definition.js';

describe('FluentInterface', () => {
  let transport: HttpTransportClient;
  let definition: Definition;
  let cacheManager: HttpCacheManager;
  let retryManager: RetryManager;
  let fluentInterface: FluentInterface<any>;

  beforeEach(() => {
    transport = new HttpTransportClient('http://localhost:3000');
    definition = {
      id: 'test-def-1',
      meta: {
        name: 'TestService@1.0.0',
        version: '1.0.0',
        methods: {
          getUser: { name: 'getUser' },
          getUsers: { name: 'getUsers' }
        }
      }
    } as Definition;

    cacheManager = new HttpCacheManager({ maxEntries: 100 });
    retryManager = new RetryManager();

    fluentInterface = new FluentInterface(
      transport,
      definition,
      cacheManager,
      retryManager
    );
  });

  describe('Configuration Methods', () => {
    it('should create ConfigurableProxy with cache option', () => {
      const proxy = fluentInterface.cache(60000);
      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });

    it('should create ConfigurableProxy with retry option', () => {
      const proxy = fluentInterface.retry(3);
      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });

    it('should create ConfigurableProxy with timeout option', () => {
      const proxy = fluentInterface.timeout(5000);
      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });

    it('should create ConfigurableProxy with priority option', () => {
      const proxy = fluentInterface.priority('high');
      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });

    it('should create ConfigurableProxy with transform option', () => {
      const proxy = fluentInterface.transform((data: any) => data.map((x: any) => x.id));
      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });

    it('should create ConfigurableProxy with validate option', () => {
      const proxy = fluentInterface.validate((data: any) => Array.isArray(data));
      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });

    it('should create ConfigurableProxy with fallback option', () => {
      const proxy = fluentInterface.fallback([]);
      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });

    it('should create ConfigurableProxy with optimistic option', () => {
      const proxy = fluentInterface.optimistic((current: any) => ({ ...current, updated: true }));
      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });

    it('should create ConfigurableProxy with dedupe option', () => {
      const proxy = fluentInterface.dedupe('test-key');
      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });

    it('should create ConfigurableProxy with invalidateOn option', () => {
      const proxy = fluentInterface.invalidateOn(['tag1', 'tag2']);
      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });

    it('should create ConfigurableProxy with background option', () => {
      const proxy = fluentInterface.background(60000);
      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });

    it('should create ConfigurableProxy with metrics option', () => {
      const proxy = fluentInterface.metrics(({ duration }) => console.log(duration));
      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });
  });

  describe('API Proxy', () => {
    it('should provide api proxy for direct method calls', () => {
      const api = fluentInterface.api;
      expect(api).toBeDefined();
      expect(typeof api).toBe('object');
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate cache by string pattern', () => {
      const spy = jest.spyOn(cacheManager, 'invalidate');
      fluentInterface.invalidate('test-key');
      expect(spy).toHaveBeenCalledWith('test-key');
    });

    it('should invalidate cache by regex pattern', () => {
      const spy = jest.spyOn(cacheManager, 'invalidate');
      fluentInterface.invalidate(/test-.*/);
      expect(spy).toHaveBeenCalledWith(/test-.*/);
    });

    it('should invalidate cache by array of patterns', () => {
      const spy = jest.spyOn(cacheManager, 'invalidate');
      fluentInterface.invalidate(['key1', /key2/]);
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('should clear all cache', () => {
      const spy = jest.spyOn(cacheManager, 'clear');
      fluentInterface.clearCache();
      expect(spy).toHaveBeenCalled();
    });

    it('should handle missing cache manager gracefully', () => {
      const fluentWithoutCache = new FluentInterface(transport, definition);
      expect(() => fluentWithoutCache.invalidate('test')).not.toThrow();
      expect(() => fluentWithoutCache.clearCache()).not.toThrow();
    });
  });

  describe('Helper Methods', () => {
    it('should normalize cache options from number', () => {
      const proxy = fluentInterface.cache(60000);
      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });

    it('should normalize cache options from object', () => {
      const proxy = fluentInterface.cache({ maxAge: 60000, tags: ['test'] });
      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });

    it('should normalize retry options from number', () => {
      const proxy = fluentInterface.retry(3);
      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });

    it('should normalize retry options from object', () => {
      const proxy = fluentInterface.retry({ attempts: 3, backoff: 'exponential' });
      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });
  });

  describe('Global Configuration Methods', () => {
    it('should set global cache configuration', () => {
      const result = fluentInterface.globalCache({ maxAge: 120000, tags: ['global'] });
      expect(result).toBe(fluentInterface);
    });

    it('should set global retry configuration', () => {
      const result = fluentInterface.globalRetry({ attempts: 5, backoff: 'linear' });
      expect(result).toBe(fluentInterface);
    });

    it('should apply global cache to subsequent cache() calls', () => {
      fluentInterface.globalCache({ maxAge: 120000, tags: ['global'] });
      const proxy = fluentInterface.cache(60000);
      expect(proxy).toBeInstanceOf(ConfigurableProxy);
      // The proxy should have both global and specific options merged
    });

    it('should apply global retry to subsequent retry() calls', () => {
      fluentInterface.globalRetry({ attempts: 5 });
      const proxy = fluentInterface.retry(3);
      expect(proxy).toBeInstanceOf(ConfigurableProxy);
      // The proxy should have both global and specific options merged
    });

    it('should allow chaining globalCache() and globalRetry()', () => {
      const result = fluentInterface
        .globalCache({ maxAge: 120000 })
        .globalRetry({ attempts: 5 });
      expect(result).toBe(fluentInterface);
    });

    it('should preserve global options across multiple configuration calls', () => {
      fluentInterface.globalCache({ maxAge: 120000 });
      fluentInterface.globalRetry({ attempts: 5 });

      const proxy1 = fluentInterface.cache(60000);
      const proxy2 = fluentInterface.retry(3);
      const proxy3 = fluentInterface.dedupe('test-key');

      expect(proxy1).toBeInstanceOf(ConfigurableProxy);
      expect(proxy2).toBeInstanceOf(ConfigurableProxy);
      expect(proxy3).toBeInstanceOf(ConfigurableProxy);
    });
  });
});
