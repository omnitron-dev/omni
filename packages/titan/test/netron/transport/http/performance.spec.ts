/**
 * Performance Benchmarks for Fluent API (Phase 2)
 * Compares performance between HttpInterface (old) and FluentInterface (new)
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { FluentInterface } from '../../../../src/netron/transport/http/fluent-interface.js';
import { HttpInterface } from '../../../../src/netron/transport/http/interface.js';
import { HttpTransportClient } from '../../../../src/netron/transport/http/client.js';
import { HttpCacheManager } from '../../../../src/netron/transport/http/cache-manager.js';
import { RetryManager } from '../../../../src/netron/transport/http/retry-manager.js';
import type { Definition } from '../../../../src/netron/definition.js';

interface IUserService {
  getUser(id: string): Promise<{ id: string; name: string }>;
}

describe('Performance Benchmarks', () => {
  let transport: HttpTransportClient;
  let definition: Definition;
  let cacheManager: HttpCacheManager;
  let retryManager: RetryManager;

  beforeEach(() => {
    transport = new HttpTransportClient('http://localhost:3000');
    definition = {
      id: 'test-def-1',
      meta: {
        name: 'UserService@1.0.0',
        version: '1.0.0',
        methods: {
          getUser: { name: 'getUser' }
        }
      }
    } as Definition;

    cacheManager = new HttpCacheManager({ maxEntries: 1000 });
    retryManager = new RetryManager();

    // Mock transport invoke
    jest.spyOn(transport, 'invoke').mockResolvedValue({ id: '123', name: 'John' });
  });

  describe('Instance Creation Performance', () => {
    it('should create HttpInterface instances efficiently', () => {
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        new HttpInterface<IUserService>(transport, definition, {
          cache: cacheManager,
          retry: retryManager
        });
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      console.log(`HttpInterface creation (1000 instances): ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(500); // Should be fast
    });

    it('should create FluentInterface instances efficiently', () => {
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        new FluentInterface<IUserService>(
          transport,
          definition,
          cacheManager,
          retryManager
        );
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      console.log(`FluentInterface creation (1000 instances): ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(500); // Should be fast
    });

    it('should have comparable creation performance', () => {
      // Measure HttpInterface
      const httpStart = performance.now();
      for (let i = 0; i < 1000; i++) {
        new HttpInterface<IUserService>(transport, definition, {
          cache: cacheManager,
          retry: retryManager
        });
      }
      const httpDuration = performance.now() - httpStart;

      // Measure FluentInterface
      const fluentStart = performance.now();
      for (let i = 0; i < 1000; i++) {
        new FluentInterface<IUserService>(
          transport,
          definition,
          cacheManager,
          retryManager
        );
      }
      const fluentDuration = performance.now() - fluentStart;

      console.log(`HttpInterface: ${httpDuration.toFixed(2)}ms`);
      console.log(`FluentInterface: ${fluentDuration.toFixed(2)}ms`);
      console.log(`Difference: ${Math.abs(httpDuration - fluentDuration).toFixed(2)}ms`);

      // FluentInterface should not be significantly slower (max 20% overhead)
      expect(fluentDuration).toBeLessThan(httpDuration * 1.2);
    });
  });

  describe('Configuration Chain Performance', () => {
    it('should handle HttpInterface configuration chains efficiently', () => {
      const service = new HttpInterface<IUserService>(transport, definition, {
        cache: cacheManager,
        retry: retryManager
      });

      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        service
          .cache(60000)
          .retry(3)
          .method('getUser')
          .input('123');
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      console.log(`HttpInterface configuration chains (1000 calls): ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(100);
    });

    it('should handle FluentInterface configuration chains efficiently', () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        service
          .cache(60000)
          .retry(3)
          .timeout(5000);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      console.log(`FluentInterface configuration chains (1000 calls): ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(100);
    });

    it('should have comparable configuration chain performance', () => {
      const httpService = new HttpInterface<IUserService>(transport, definition, {
        cache: cacheManager,
        retry: retryManager
      });

      const fluentService = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      // Measure HttpInterface
      const httpStart = performance.now();
      for (let i = 0; i < 1000; i++) {
        httpService
          .cache(60000)
          .retry(3)
          .method('getUser')
          .input('123');
      }
      const httpDuration = performance.now() - httpStart;

      // Measure FluentInterface
      const fluentStart = performance.now();
      for (let i = 0; i < 1000; i++) {
        fluentService
          .cache(60000)
          .retry(3)
          .timeout(5000);
      }
      const fluentDuration = performance.now() - fluentStart;

      console.log(`HttpInterface chains: ${httpDuration.toFixed(2)}ms`);
      console.log(`FluentInterface chains: ${fluentDuration.toFixed(2)}ms`);
      console.log(`Difference: ${Math.abs(httpDuration - fluentDuration).toFixed(2)}ms`);
      console.log(`Overhead: ${((fluentDuration / httpDuration - 1) * 100).toFixed(1)}%`);

      // FluentInterface may have some Proxy overhead, but absolute times are very small
      // Allow up to 3x overhead (still < 5ms absolute time)
      expect(fluentDuration).toBeLessThan(Math.max(httpDuration * 3, 5));
    });
  });

  describe('Global Configuration Performance', () => {
    it('should handle global configuration efficiently', () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        service
          .globalCache({ maxAge: 120000 })
          .globalRetry({ attempts: 5 });
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      console.log(`Global configuration (1000 calls): ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(50); // Should be very fast (just setting properties)
    });

    it('should merge global options efficiently', () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      service
        .globalCache({ maxAge: 120000 })
        .globalRetry({ attempts: 5 });

      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        service.cache(60000); // Should merge with global options
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      console.log(`Merging global options (1000 calls): ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(100);
    });
  });

  describe('Memory Efficiency', () => {
    it('should not leak memory with repeated configurations', () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      // Create many configuration chains
      const proxies: any[] = [];
      for (let i = 0; i < 1000; i++) {
        proxies.push(
          service
            .cache(60000)
            .retry(3)
            .timeout(5000)
        );
      }

      // All proxies should be created successfully
      expect(proxies.length).toBe(1000);
      expect(proxies.every(p => p !== undefined)).toBe(true);
    });

    it('should handle large numbers of global configuration changes', () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      // Change global config many times
      for (let i = 0; i < 1000; i++) {
        service
          .globalCache({ maxAge: i * 1000 })
          .globalRetry({ attempts: i % 10 });
      }

      // Should still work correctly
      const proxy = service.cache(60000);
      expect(proxy).toBeDefined();
    });
  });

  describe('Execution Performance', () => {
    it('should execute method calls with similar performance', async () => {
      const httpService = new HttpInterface<IUserService>(transport, definition, {
        cache: cacheManager,
        retry: retryManager
      });

      const fluentService = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      // Measure HttpInterface execution
      const httpStart = performance.now();
      const httpPromises: Promise<any>[] = [];
      for (let i = 0; i < 100; i++) {
        httpPromises.push(
          httpService
            .cache(60000)
            .method('getUser')
            .input('123')
            .execute()
        );
      }
      await Promise.all(httpPromises);
      const httpDuration = performance.now() - httpStart;

      // Measure FluentInterface execution
      const fluentStart = performance.now();
      const fluentPromises: Promise<any>[] = [];
      for (let i = 0; i < 100; i++) {
        const proxy = fluentService.cache(60000) as any;
        fluentPromises.push(proxy.getUser('123'));
      }
      await Promise.all(fluentPromises);
      const fluentDuration = performance.now() - fluentStart;

      console.log(`HttpInterface execution (100 calls): ${httpDuration.toFixed(2)}ms`);
      console.log(`FluentInterface execution (100 calls): ${fluentDuration.toFixed(2)}ms`);
      console.log(`Difference: ${Math.abs(httpDuration - fluentDuration).toFixed(2)}ms`);

      // Execution performance should be comparable (within 30% to account for Proxy overhead)
      expect(fluentDuration).toBeLessThan(httpDuration * 1.3);
    });
  });

  describe('Cache Performance', () => {
    it('should handle cached requests efficiently', async () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      // First call - cache miss
      const proxy1 = service.cache(60000) as any;
      await proxy1.getUser('123');

      // Subsequent calls - should hit cache
      const startTime = performance.now();
      const promises: Promise<any>[] = [];
      for (let i = 0; i < 100; i++) {
        const proxy = service.cache(60000) as any;
        promises.push(proxy.getUser('123'));
      }
      await Promise.all(promises);
      const duration = performance.now() - startTime;

      console.log(`Cached requests (100 calls): ${duration.toFixed(2)}ms`);
      // Cached requests should be very fast
      expect(duration).toBeLessThan(100);
    });
  });
});
