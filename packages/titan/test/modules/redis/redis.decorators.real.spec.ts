import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';
import { Redis } from 'ioredis';
import {
  RedisCache,
  RedisLock,
  RedisRateLimit,
  InjectRedis,
  InjectRedisManager,
} from '../../../src/modules/redis/redis.decorators.js';
import { RedisManager } from '../../../src/modules/redis/redis.manager.js';
import {
  createRedisTestFixture,
  cleanupRedisTestFixture,
  type RedisTestFixture,
} from '../../../src/testing/redis-test-utils.js';
import {
  EventListenerTracker,
  withTimeout,
  flushPromises,
  waitForCondition,
} from '../../../src/testing/async-test-utils.js';
import { isRedisInMockMode } from './utils/redis-test-utils.js';

// Skip all tests in this file if running in mock mode - requires real Redis
const SKIP_DOCKER_TESTS = process.env.SKIP_DOCKER_TESTS === 'true' || isRedisInMockMode();
const describeOrSkip = SKIP_DOCKER_TESTS ? describe.skip : describe;

/**
 * Global type extension for Titan Redis Manager
 */
interface GlobalWithRedisManager extends NodeJS.Global {
  __titanRedisManager?: RedisManager;
}

declare const global: GlobalWithRedisManager;

/**
 * Complex data structure for testing serialization
 */
interface ComplexDataStructure {
  id: number;
  nested: {
    value: string;
    array: number[];
  };
  date: string;
  nullValue: null;
  undefinedValue?: undefined;
}

describeOrSkip('Redis Decorators with Real Redis', () => {
  let fixture: RedisTestFixture | undefined;
  let eventTracker: EventListenerTracker;
  let manager: RedisManager;
  let client: Redis;
  let testsSkipped = false;

  beforeAll(async () => {
    if (SKIP_DOCKER_TESTS) {
      console.log('⏭️  Skipping redis.decorators.real.spec.ts - requires real Redis (USE_MOCK_REDIS=true or SKIP_DOCKER_TESTS=true)');
      return;
    }
    // Skip if explicitly disabled
    if (SKIP_DOCKER_TESTS) {
      console.warn('⚠️  Skipping Redis decorator tests - SKIP_DOCKER_TESTS is set');
      testsSkipped = true;
      return;
    }

    // Create Docker-based test fixture (no fallback)
    try {
      fixture = await createRedisTestFixture({
        withManager: true,
        withService: true,
        db: 15,
      });

      manager = fixture.manager!;
      client = fixture.client;

      // Set global manager for decorators
      global.__titanRedisManager = manager;
    } catch (error) {
      console.warn('⚠️  Skipping Redis decorator tests - Failed to create Docker fixture:', (error as Error).message);
      testsSkipped = true;
    }
  });

  afterAll(async () => {
    if (fixture) {
      delete global.__titanRedisManager;
      await cleanupRedisTestFixture(fixture);
    }
  });

  beforeEach(async () => {
    if (testsSkipped) {
      return;
    }
    eventTracker = new EventListenerTracker();
  });

  afterEach(async () => {
    if (eventTracker) {
      eventTracker.cleanup();
    }
  });

  describe('@RedisCache', () => {
    it('should cache method results with real Redis', async () => {
      if (testsSkipped) {
        return;
      }

      let callCount = 0;

      class TestService {
        private redisManager = manager;

        @RedisCache({ ttl: 2, key: 'test-method' })
        async getData(id: number): Promise<string> {
          callCount++;
          return `data-${id}`;
        }
      }

      const service = new TestService();

      // First call - should execute method
      const result1 = await service.getData(1);
      expect(result1).toBe('data-1');
      expect(callCount).toBe(1);

      // Second call - should use cache
      const result2 = await service.getData(1);
      expect(result2).toBe('data-1');
      expect(callCount).toBe(1); // Not incremented

      // Verify in Redis
      const cached = await client.get('cache:test-method:1');
      expect(cached).toBe('"data-1"');

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 2100));

      // Third call - cache expired
      const result3 = await service.getData(1);
      expect(result3).toBe('data-1');
      expect(callCount).toBe(2);
    });

    it('should use custom key function', async () => {
      class TestService {
        private redisManager = manager;

        @RedisCache({
          ttl: 60,
          keyFn: (a: number, b: string) => `${b}:${a}`,
        })
        async process(id: number, type: string): Promise<string> {
          return `${type}-${id}`;
        }
      }

      const service = new TestService();
      await service.process(123, 'order');

      const cached = await client.get('cache:order:123');
      expect(cached).toBe('"order-123"');
    });

    it('should handle different namespaces', async () => {
      // Cache namespace already exists from test fixture

      class TestService {
        private redisManager = manager;

        @RedisCache({ ttl: 60, key: 'data', namespace: 'cache' })
        async getData(): Promise<string> {
          return 'cached-data';
        }
      }

      const service = new TestService();
      await service.getData();

      const cacheClient = manager.getClient('cache');
      const cached = await cacheClient.get('cache:data');
      expect(cached).toBe('"cached-data"');

      // Verify not in default namespace
      const defaultCached = await client.get('cache:data');
      expect(defaultCached).toBeNull();

      // Cleanup cache client
      await cacheClient.flushdb();
    });

    it('should handle cache misses and errors gracefully', async () => {
      let callCount = 0;

      class TestService {
        private redisManager = manager;

        @RedisCache({ ttl: 60, key: 'fallback' })
        async getData(): Promise<string> {
          callCount++;
          return 'fallback-data';
        }
      }

      const service = new TestService();

      // Temporarily break Redis connection
      const originalGet = client.get;
      client.get = jest.fn().mockRejectedValue(new Error('Redis error'));

      // Should fall back to method execution
      const result = await service.getData();
      expect(result).toBe('fallback-data');
      expect(callCount).toBe(1);

      // Restore
      client.get = originalGet;
    });

    it('should handle complex data types', async () => {
      class TestService {
        private redisManager = manager;

        @RedisCache({ ttl: 60, key: 'complex' })
        async getComplexData(): Promise<ComplexDataStructure> {
          return {
            id: 1,
            nested: { value: 'test', array: [1, 2, 3] },
            date: new Date('2024-01-01').toISOString(),
            nullValue: null,
            undefinedValue: undefined,
          };
        }
      }

      const service = new TestService();
      const result1 = await service.getComplexData();
      const result2 = await service.getComplexData();

      expect(result1).toEqual(result2);

      // Verify serialization
      const cached = await client.get('cache:complex');
      const parsed = JSON.parse(cached!);
      expect(parsed.id).toBe(1);
      expect(parsed.nested.value).toBe('test');
    });
  });

  describe('@RedisLock', () => {
    it('should acquire and release locks', async () => {
      let executions = 0;

      class TestService {
        private redisManager = manager;

        @RedisLock({ key: 'process', ttl: 1 })
        async process(id: number): Promise<void> {
          executions++;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      const service = new TestService();

      // Execute with same ID concurrently
      const promises = [
        service.process(1).catch(() => 'failed'),
        service.process(1).catch(() => 'failed'), // Should wait for lock
        service.process(2).catch(() => 'failed'), // Different ID, different lock
      ];

      const results = await Promise.allSettled(promises);

      // At least one should succeed for each unique ID
      const succeeded = results.filter((r) => r.status === 'fulfilled');
      expect(succeeded.length).toBeGreaterThanOrEqual(1);

      // Verify locks are released
      await waitForCondition(async () => {
        const lock1 = await client.get('lock:process:1');
        const lock2 = await client.get('lock:process:2');
        return lock1 === null && lock2 === null;
      }, 2000);
    });

    it('should retry acquiring lock', async () => {
      class TestService {
        private redisManager = manager;

        @RedisLock({ key: 'retry', ttl: 1, retries: 3, retryDelay: 100 })
        async process(): Promise<string> {
          return 'processed';
        }
      }

      const service = new TestService();

      // Manually set lock
      await client.setnx('lock:retry', 'manual-lock');
      await client.expire('lock:retry', 1);

      // Start process (will retry)
      const promise = service.process();

      // Release lock after 200ms
      setTimeout(async () => {
        await client.del('lock:retry');
      }, 200);

      const result = await withTimeout(promise, 2000);
      expect(result).toBe('processed');
    });

    it('should handle lock acquisition failure', async () => {
      class TestService {
        private redisManager = manager;

        @RedisLock({ key: 'fail', ttl: 1, retries: 0 })
        async process(): Promise<string> {
          return 'should-not-reach';
        }
      }

      const service = new TestService();

      // Set lock manually
      await client.setnx('lock:fail', 'blocked');
      await client.expire('lock:fail', 5);

      // Should throw
      await expect(service.process()).rejects.toThrow(/timed out after/);

      // Cleanup
      await client.del('lock:fail');
    });

    it('should use custom key function', async () => {
      class TestService {
        private redisManager = manager;

        @RedisLock({
          keyFn: (id: number, type: string) => `${type}-${id}`,
          ttl: 1,
        })
        async process(id: number, type: string): Promise<void> {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      const service = new TestService();

      // Start process
      const promise = service.process(123, 'order');

      // Check lock exists with custom key
      await flushPromises();
      const keys = await client.keys('lock:*');
      expect(keys).toContain('lock:order-123');

      await promise;
    });

    it('should release lock on error', async () => {
      class TestService {
        private redisManager = manager;

        @RedisLock({ key: 'error-lock', ttl: 5 })
        async process(id: number): Promise<void> {
          throw new Error('Process failed');
        }
      }

      const service = new TestService();

      await expect(service.process(1)).rejects.toThrow('Process failed');

      // Lock should be released
      const lockKey = await client.get('lock:error-lock:1');
      expect(lockKey).toBeNull();
    });

    it('should prevent concurrent execution for same key', async () => {
      class TestService {
        private redisManager = manager;
        activeCount = 0;
        maxActive = 0;

        @RedisLock({ key: 'concurrent', ttl: 1, retries: 0 })
        async process(id: number): Promise<void> {
          this.activeCount++;
          this.maxActive = Math.max(this.maxActive, this.activeCount);
          await new Promise((resolve) => setTimeout(resolve, 100));
          this.activeCount--;
        }
      }

      const service = new TestService();

      // Try concurrent execution with same id
      const [result1, result2] = await Promise.allSettled([service.process(1), service.process(1)]);

      // One should succeed, one should fail
      const succeeded = [result1, result2].filter((r) => r.status === 'fulfilled');
      const failed = [result1, result2].filter((r) => r.status === 'rejected');

      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(service.maxActive).toBe(1);
    });
  });

  describe('@RedisRateLimit', () => {
    it('should enforce rate limits', async () => {
      class TestService {
        private redisManager = manager;

        @RedisRateLimit({ key: 'api', limit: 3, window: 1 })
        async callApi(userId: number): Promise<string> {
          return `called-${userId}`;
        }
      }

      const service = new TestService();

      // First 3 calls should succeed
      await expect(service.callApi(1)).resolves.toBe('called-1');
      await expect(service.callApi(1)).resolves.toBe('called-1');
      await expect(service.callApi(1)).resolves.toBe('called-1');

      // Fourth call should fail
      await expect(service.callApi(1)).rejects.toThrow('Too many requests');

      // Different user should work
      await expect(service.callApi(2)).resolves.toBe('called-2');

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should work again
      await expect(service.callApi(1)).resolves.toBe('called-1');
    });

    it('should use custom key function', async () => {
      class TestService {
        private redisManager = manager;

        @RedisRateLimit({
          keyFn: (userId: number, endpoint: string) => `${endpoint}:${userId}`,
          limit: 2,
          window: 60,
        })
        async callEndpoint(userId: number, endpoint: string): Promise<string> {
          return `${endpoint}-${userId}`;
        }
      }

      const service = new TestService();

      // Different endpoints have separate limits
      await service.callEndpoint(1, 'users');
      await service.callEndpoint(1, 'users');
      await service.callEndpoint(1, 'posts'); // Different endpoint

      // Third call to users should fail
      await expect(service.callEndpoint(1, 'users')).rejects.toThrow('Too many requests');

      // Posts should still work
      await expect(service.callEndpoint(1, 'posts')).resolves.toBe('posts-1');
    });

    it('should set TTL only on first request', async () => {
      class TestService {
        private redisManager = manager;

        @RedisRateLimit({ key: 'ttl-test', limit: 10, window: 60 })
        async call(): Promise<void> {}
      }

      const service = new TestService();

      // First call sets TTL
      await service.call();
      const ttl1 = await client.ttl('ttl-test:default');
      expect(ttl1).toBeGreaterThan(0);
      expect(ttl1).toBeLessThanOrEqual(60);

      // Second call doesn't change TTL
      await service.call();
      const ttl2 = await client.ttl('ttl-test:default');
      expect(ttl2).toBeLessThanOrEqual(ttl1);
    });

    it('should handle errors gracefully', async () => {
      class TestService {
        private redisManager = manager;

        @RedisRateLimit({ key: 'error', limit: 5, window: 60 })
        async call(): Promise<string> {
          return 'success';
        }
      }

      const service = new TestService();

      // Break incr temporarily
      const originalIncr = client.incr;
      client.incr = jest.fn().mockRejectedValue(new Error('Redis error'));

      // Should fall back to allowing request
      const result = await service.call();
      expect(result).toBe('success');

      // Restore
      client.incr = originalIncr;
    });

    it('should track rate limits per key', async () => {
      class TestService {
        private redisManager = manager;

        @RedisRateLimit({ key: 'user', limit: 2, window: 60 })
        async action(userId: number): Promise<string> {
          return `user-${userId}`;
        }
      }

      const service = new TestService();

      // User 1 - 2 calls
      await service.action(1);
      await service.action(1);
      await expect(service.action(1)).rejects.toThrow('Too many requests');

      // User 2 - should have separate limit
      await service.action(2);
      await service.action(2);
      await expect(service.action(2)).rejects.toThrow('Too many requests');

      // Check rate limit keys exist
      const keys = await client.keys('user:*');
      expect(keys).toContain('user:1');
      expect(keys).toContain('user:2');
    });
  });

  describe('Multiple Decorators', () => {
    it('should work with multiple decorators', async () => {
      let executions = 0;

      class TestService {
        private redisManager = manager;

        @RedisRateLimit({ key: 'multi', limit: 5, window: 60 })
        @RedisLock({ key: 'multi', ttl: 1 })
        @RedisCache({ ttl: 60, key: 'multi' })
        async complexOperation(id: number): Promise<string> {
          executions++;
          return `result-${id}`;
        }
      }

      const service = new TestService();

      // First call
      const result1 = await service.complexOperation(1);
      expect(result1).toBe('result-1');
      expect(executions).toBe(1);

      // Second call - should use cache
      const result2 = await service.complexOperation(1);
      expect(result2).toBe('result-1');
      expect(executions).toBe(1);

      // Verify rate limit counter (rate limits use sorted sets, not simple keys)
      const rateCount = await client.zcard('multi:1');
      expect(rateCount).toBeGreaterThan(0);

      // Verify cache
      const cacheKey = await client.get('cache:multi:1');
      expect(cacheKey).toBeTruthy();
    });

    it('should work with cache and lock combination', async () => {
      class TestService {
        private redisManager = manager;
        processCount = 0;

        @RedisLock({ key: 'combo', ttl: 1 })
        @RedisCache({ ttl: 60, key: 'combo' })
        async expensiveOperation(id: number): Promise<string> {
          this.processCount++;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return `result-${id}`;
        }
      }

      const service = new TestService();

      // First call - should process
      const result1 = await service.expensiveOperation(1);
      expect(result1).toBe('result-1');
      expect(service.processCount).toBe(1);

      // Second call - should use cache
      const result2 = await service.expensiveOperation(1);
      expect(result2).toBe('result-1');
      expect(service.processCount).toBe(1);

      // Concurrent calls with different id
      const [r1, r2] = await Promise.all([service.expensiveOperation(2), service.expensiveOperation(3)]);

      expect(r1).toBe('result-2');
      expect(r2).toBe('result-3');
      expect(service.processCount).toBe(3);
    });
  });

  describe('Injection Decorators', () => {
    it('@InjectRedis should inject Redis client', () => {
      class TestService {
        @InjectRedis('custom')
        private redis!: Redis;
      }

      // Verify decorator metadata is set
      const metadata = Reflect.getMetadata('design:type', TestService.prototype, 'redis');
      expect(metadata).toBeDefined();
    });

    it('@InjectRedisManager should inject manager', () => {
      class TestService {
        @InjectRedisManager()
        private manager!: RedisManager;
      }

      // Verify decorator metadata is set
      const metadata = Reflect.getMetadata('design:type', TestService.prototype, 'manager');
      expect(metadata).toBeDefined();
    });
  });

  describe('Error Scenarios', () => {
    it('should handle missing manager gracefully', async () => {
      delete global.__titanRedisManager;

      class TestService {
        @RedisCache({ ttl: 60, key: 'no-manager' })
        async getData(): Promise<string> {
          return 'fallback';
        }
      }

      const service = new TestService();

      // Should fall back to executing method
      const result = await service.getData();
      expect(result).toBe('fallback');

      // Restore for cleanup
      global.__titanRedisManager = manager;
    });

    it('should handle invalid namespace', async () => {
      class TestService {
        private redisManager = manager;

        @RedisCache({ ttl: 60, key: 'test', namespace: 'non-existent' })
        async getData(): Promise<string> {
          return 'data';
        }
      }

      const service = new TestService();

      // Should fall back to method execution
      const result = await service.getData();
      expect(result).toBe('data');
    });

    it('should handle Redis connection errors', async () => {
      class TestService {
        private redisManager = manager;
        callCount = 0;

        @RedisCache({ ttl: 60, key: 'conn-error' })
        async getData(): Promise<string> {
          this.callCount++;
          return 'data';
        }
      }

      const service = new TestService();

      // Temporarily break connection
      await client.quit();

      // Should fall back to method execution
      const result = await service.getData();
      expect(result).toBe('data');
      expect(service.callCount).toBe(1);

      // Reconnect for cleanup
      await client.connect();
    });
  });

  describe('Performance', () => {
    it('should handle high concurrency with caching', async () => {
      class TestService {
        private redisManager = manager;
        processCount = 0;

        @RedisCache({ ttl: 60, key: 'perf' })
        async getData(id: number): Promise<string> {
          this.processCount++;
          await new Promise((resolve) => setTimeout(resolve, 50)); // Longer delay
          return `data-${id}`;
        }
      }

      const service = new TestService();

      // First call to populate cache
      await service.getData(1);
      expect(service.processCount).toBe(1);

      // Generate many concurrent requests for same data (should hit cache)
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(service.getData(1));
      }

      const results = await Promise.all(promises);

      // All should return same result
      expect(new Set(results).size).toBe(1);
      expect(results[0]).toBe('data-1');

      // Should not have processed more than the first call (cache hit)
      expect(service.processCount).toBe(1);
    });

    it('should handle burst requests with rate limiting', async () => {
      class TestService {
        private redisManager = manager;

        @RedisRateLimit({ key: 'burst', limit: 10, window: 1 })
        async action(id: number): Promise<number> {
          return id;
        }
      }

      const service = new TestService();

      // Send burst of requests
      const promises = [];
      for (let i = 0; i < 15; i++) {
        promises.push(service.action(1).catch((err) => ({ error: err.message })));
      }

      const results = await Promise.all(promises);

      // Should have 10 successful and 5 failed
      const successful = results.filter((r) => typeof r === 'number');
      const failed = results.filter((r) => r && typeof r === 'object' && 'error' in r);

      expect(successful).toHaveLength(10);
      expect(failed).toHaveLength(5);
    });
  });
});
