/**
 * Performance Benchmarks for HTTP Transport
 * Tests performance of FluentInterface operations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FluentInterface,
  HttpCacheManager,
  RetryManager,
} from '../../../../src/netron/transport/http/fluent-interface/index.js';
import { HttpInterface } from '../../../../src/netron/transport/http/interface.js';
import { HttpTransportClient } from '../../../../src/netron/transport/http/client.js';
import type { Definition } from '../../../../src/netron/definition.js';

interface IUserService {
  getUser(id: string): Promise<{ id: string; name: string }>;
}

/**
 * Best of N runs of a synchronous loop.
 *
 * These budgets are flat wall-clock milliseconds, so they measure the host as
 * much as the code: a preemption landing inside the one measured run — another
 * suite starting, a container coming up — fails a test whose subject did not
 * change. Taking the best run removes that without weakening the bound, which
 * is the only guard here against a genuine regression.
 *
 * Applies to the synchronous construction/configuration loops only; the async
 * call benchmarks below keep their single measurement, since re-running them
 * would re-issue requests and warm caches.
 */
function bestOfRuns(loop: () => void, runs = 3): number {
  let best = Infinity;
  for (let r = 0; r < runs; r++) {
    const start = performance.now();
    loop();
    best = Math.min(best, performance.now() - start);
  }
  return best;
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
          getUser: { name: 'getUser' },
        },
      },
    } as Definition;

    cacheManager = new HttpCacheManager({ maxEntries: 1000 });
    retryManager = new RetryManager();

    // Mock transport invoke
    vi.spyOn(transport, 'invoke').mockResolvedValue({ id: '123', name: 'John' });
  });

  describe('Instance Creation Performance', () => {
    it('should create HttpInterface instances efficiently', () => {
      const duration = bestOfRuns(() => {
        for (let i = 0; i < 1000; i++) {
          new HttpInterface<IUserService>(transport, definition);
        }
      });

      console.log(`HttpInterface creation (1000 instances): ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(500); // Should be fast
    });

    it('should create FluentInterface instances efficiently', () => {
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        new FluentInterface<IUserService>(transport, definition, cacheManager, retryManager);
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
        new HttpInterface<IUserService>(transport, definition);
      }
      const httpDuration = performance.now() - httpStart;

      // Measure FluentInterface
      const fluentStart = performance.now();
      for (let i = 0; i < 1000; i++) {
        new FluentInterface<IUserService>(transport, definition, cacheManager, retryManager);
      }
      const fluentDuration = performance.now() - fluentStart;

      console.log(`HttpInterface: ${httpDuration.toFixed(2)}ms`);
      console.log(`FluentInterface: ${fluentDuration.toFixed(2)}ms`);

      // Both loops finish in well under a millisecond, so a single sample is
      // mostly scheduler noise — this compared two ~0.2ms numbers and failed
      // whenever one of them was preempted. Re-measure with enough work that
      // the timer resolution is irrelevant, best-of-N on each side.
      const bestOf = (build: () => unknown, runs = 5, iterations = 20_000) => {
        for (let i = 0; i < 1_000; i++) build(); // warm up
        let best = Infinity;
        for (let r = 0; r < runs; r++) {
          const start = performance.now();
          for (let i = 0; i < iterations; i++) build();
          best = Math.min(best, performance.now() - start);
        }
        return best;
      };

      const httpBest = bestOf(() => new HttpInterface<IUserService>(transport, definition));
      const fluentBest = bestOf(
        () => new FluentInterface<IUserService>(transport, definition, cacheManager, retryManager)
      );

      // FluentInterface does more per construction, but not multiples more.
      expect(fluentBest).toBeLessThan(httpBest * 3);
    });
  });

  describe('Configuration Chain Performance', () => {
    it('should handle FluentInterface configuration chains efficiently', () => {
      const service = new FluentInterface<IUserService>(transport, definition, cacheManager, retryManager);

      const duration = bestOfRuns(() => {
        for (let i = 0; i < 1000; i++) {
          service.cache(60000).retry(3).timeout(5000);
        }
      });

      console.log(`FluentInterface configuration chains (1000 calls): ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(100);
    });
  });

  describe('Global Configuration Performance', () => {
    it('should handle global configuration efficiently', () => {
      const service = new FluentInterface<IUserService>(transport, definition, cacheManager, retryManager, {
        cache: { maxAge: 60000 },
        retry: { maxAttempts: 3 },
      });

      const duration = bestOfRuns(() => {
        for (let i = 0; i < 1000; i++) {
          service.cache(30000);
        }
      });

      console.log(`Global configuration override (1000 calls): ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(50);
    });

    it('should merge global options efficiently', () => {
      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        new FluentInterface<IUserService>(transport, definition, cacheManager, retryManager, {
          cache: { maxAge: 60000 },
          retry: { maxAttempts: 3 },
          timeout: 5000,
        });
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      console.log(`FluentInterface with global options (1000 instances): ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(500);
    });
  });

  describe('Memory Efficiency', () => {
    it('should not leak memory with repeated configurations', () => {
      const service = new FluentInterface<IUserService>(transport, definition, cacheManager, retryManager);

      // Run many configuration operations
      for (let i = 0; i < 10000; i++) {
        service.cache(60000).retry(3).timeout(5000);
      }

      // If we get here without crashing or massive slowdown, memory is OK
      expect(service).toBeInstanceOf(FluentInterface);
    });

    it('should handle large numbers of global configuration changes', () => {
      const service = new FluentInterface<IUserService>(transport, definition, cacheManager, retryManager, {
        cache: { maxAge: 60000 },
      });

      // Repeatedly override global config
      for (let i = 0; i < 1000; i++) {
        service.cache(i * 1000);
      }

      expect(service).toBeInstanceOf(FluentInterface);
    });
  });

  describe('Execution Performance', () => {
    it('should execute FluentInterface method calls efficiently', async () => {
      const service = new FluentInterface<IUserService>(transport, definition, cacheManager, retryManager);

      const startTime = performance.now();

      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(service.cache(60000).getUser('123'));
      }

      await Promise.all(promises);

      const endTime = performance.now();
      const duration = endTime - startTime;

      console.log(`FluentInterface method calls (100 calls): ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('Cache Performance', () => {
    it('should handle cached requests efficiently', async () => {
      const service = new FluentInterface<IUserService>(transport, definition, cacheManager, retryManager);

      // Prime the cache
      await service.cache(60000).getUser('123');

      const startTime = performance.now();

      // All these should hit cache
      const promises = [];
      for (let i = 0; i < 1000; i++) {
        promises.push(service.cache(60000).getUser('123'));
      }

      await Promise.all(promises);

      const endTime = performance.now();
      const duration = endTime - startTime;

      console.log(`Cached FluentInterface calls (1000 calls): ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(500); // Should be very fast with cache
    });
  });
});
