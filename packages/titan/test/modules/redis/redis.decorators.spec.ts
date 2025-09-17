import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  RedisCache,
  RedisLock,
  RedisRateLimit,
  InjectRedis,
  InjectRedisManager
} from '../../../src/modules/redis/redis.decorators';
import { RedisManager } from '../../../src/modules/redis/redis.manager';
// Redis test utilities removed - using direct Redis connections
import { Redis } from 'ioredis';

describe('Redis Decorators', () => {
  let testClient: Redis;
  let redisManager: RedisManager;
  let namespace: string;

  beforeEach(async () => {
    namespace = `decorators-test-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    testClient = new Redis({
      host: 'localhost',
      port: 6379,
      db: 15,
      keyPrefix: namespace + ':'
    });
    await testClient.ping();

    // Create real Redis manager
    redisManager = new RedisManager({
      clients: [{
        namespace: 'default',
        host: 'localhost',
        port: 6379,
        db: 15,
      }]
    }, null as any);

    await redisManager.init();

    // Set global manager for decorators
    (global as any).__titanRedisManager = redisManager;
  });

  afterEach(async () => {
    delete (global as any).__titanRedisManager;
    await testClient.flushdb();
    await testClient.quit();
    await redisManager.destroy();
  });

  describe('@RedisCache', () => {
    it('should cache method results', async () => {
      class TestService {
        callCount = 0;

        @RedisCache({ ttl: 2, key: 'test-cache' })
        async getData(id: number): Promise<string> {
          this.callCount++;
          return `data-${id}`;
        }

        redisManager = redisManager;
      }

      const service = new TestService();

      // First call - should execute method
      const result1 = await service.getData(1);
      expect(result1).toBe('data-1');
      expect(service.callCount).toBe(1);

      // Second call - should return cached value
      const result2 = await service.getData(1);
      expect(result2).toBe('data-1');
      expect(service.callCount).toBe(1); // Not incremented

      // Different argument - should execute method
      const result3 = await service.getData(2);
      expect(result3).toBe('data-2');
      expect(service.callCount).toBe(2);
    });

    it('should respect TTL', async () => {
      class TestService {
        callCount = 0;

        @RedisCache({ ttl: 1, key: 'ttl-test' })
        async getData(): Promise<number> {
          return ++this.callCount;
        }

        redisManager = redisManager;
      }

      const service = new TestService();

      const result1 = await service.getData();
      expect(result1).toBe(1);

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      const result2 = await service.getData();
      expect(result2).toBe(2); // Should call method again
    });

    it('should use custom key function', async () => {
      class TestService {
        @RedisCache({
          ttl: 60,
          keyFn: (id: number, type: string) => `custom:${type}:${id}`
        })
        async getData(id: number, type: string): Promise<string> {
          return `${type}-${id}`;
        }

        redisManager = redisManager;
      }

      const service = new TestService();
      const client = redisManager.getClient() as Redis;

      await service.getData(1, 'user');

      // Check that custom key was used
      const cachedValue = await client.get(`cache:custom:user:1`);
      expect(JSON.parse(cachedValue!)).toBe('user-1');
    });

    it('should handle complex data types', async () => {
      class TestService {
        @RedisCache({ ttl: 60, key: 'complex' })
        async getComplexData(): Promise<{ id: number; items: string[] }> {
          return {
            id: 1,
            items: ['a', 'b', 'c']
          };
        }

        redisManager = redisManager;
      }

      const service = new TestService();

      const result1 = await service.getComplexData();
      expect(result1).toEqual({ id: 1, items: ['a', 'b', 'c'] });

      // Second call should return cached object
      const result2 = await service.getComplexData();
      expect(result2).toEqual({ id: 1, items: ['a', 'b', 'c'] });
    });

    it('should fall back to method execution on cache error', async () => {
      class TestService {
        callCount = 0;

        @RedisCache({ ttl: 60, key: 'error-test' })
        async getData(): Promise<string> {
          this.callCount++;
          return 'fallback-data';
        }

        redisManager = redisManager;
      }

      const service = new TestService();

      // Mock get to throw error
      const client = redisManager.getClient() as Redis;
      const originalGet = client.get.bind(client);
      client.get = jest.fn().mockRejectedValue(new Error('Redis error'));

      const result = await service.getData();
      expect(result).toBe('fallback-data');
      expect(service.callCount).toBe(1);

      // Restore
      client.get = originalGet;
    });

    it('should work without redisManager', async () => {
      class TestService {
        @RedisCache({ ttl: 60, key: 'no-manager' })
        async getData(): Promise<string> {
          return 'direct-data';
        }
      }

      const service = new TestService();
      const result = await service.getData();
      expect(result).toBe('direct-data');
    });
  });

  describe('@RedisLock', () => {
    it('should acquire lock before method execution', async () => {
      class TestService {
        executionCount = 0;

        @RedisLock({ key: 'test-lock', ttl: 2 })
        async process(id: number): Promise<string> {
          this.executionCount++;
          await new Promise(resolve => setTimeout(resolve, 50));
          return `processed-${id}`;
        }

        redisManager = redisManager;
      }

      const service = new TestService();

      const result = await service.process(1);
      expect(result).toBe('processed-1');
      expect(service.executionCount).toBe(1);

      // Verify lock was released
      const client = redisManager.getClient() as Redis;
      const lockKey = await client.get('lock:test-lock:1');
      expect(lockKey).toBeNull();
    });

    it('should prevent concurrent execution', async () => {
      class TestService {
        executionOrder: number[] = [];
        counter = 0;

        @RedisLock({ key: 'concurrent-lock', ttl: 2, retries: 0 })
        async process(id: number): Promise<void> {
          this.executionOrder.push(id);
          await new Promise(resolve => setTimeout(resolve, 100));
          this.counter++;
        }

        redisManager = redisManager;
      }

      const service = new TestService();

      // Start two concurrent calls with same ID
      const promise1 = service.process(1);
      const promise2 = service.process(1);

      const results = await Promise.allSettled([promise1, promise2]);

      // One should succeed, one should fail
      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      expect(succeeded).toBe(1);
      expect(failed).toBe(1);
      expect(service.counter).toBe(1);
    });

    it('should retry acquiring lock', async () => {
      class TestService {
        @RedisLock({ key: 'retry-lock', ttl: 1, retries: 3, retryDelay: 100 })
        async process(id: number): Promise<string> {
          return `done-${id}`;
        }

        redisManager = redisManager;
      }

      const service = new TestService();
      const client = redisManager.getClient() as Redis;

      // Manually set lock
      await client.set('lock:retry-lock:1', 'locked', 'EX', 1);

      // Should retry and eventually succeed after lock expires
      const start = Date.now();
      const result = await service.process(1);
      const duration = Date.now() - start;

      expect(result).toBe('done-1');
      expect(duration).toBeGreaterThanOrEqual(1000); // Waited for lock to expire
    });

    it('should use custom key function', async () => {
      class TestService {
        @RedisLock({
          keyFn: (user: string, action: string) => `${user}:${action}`,
          ttl: 2
        })
        async perform(user: string, action: string): Promise<string> {
          return `${user}-${action}`;
        }

        redisManager = redisManager;
      }

      const service = new TestService();
      const client = redisManager.getClient() as Redis;

      await service.perform('user1', 'action1');

      // Check that custom key was used during execution
      // Note: Lock should be released after method completes
      const lockKey = await client.get('lock:user1:action1');
      expect(lockKey).toBeNull();
    });

    it('should release lock even if method throws', async () => {
      class TestService {
        @RedisLock({ key: 'error-lock', ttl: 2 })
        async failingProcess(id: number): Promise<void> {
          throw new Error('Process failed');
        }

        redisManager = redisManager;
      }

      const service = new TestService();
      const client = redisManager.getClient() as Redis;

      await expect(service.failingProcess(1)).rejects.toThrow('Process failed');

      // Lock should still be released
      const lockKey = await client.get('lock:error-lock:1');
      expect(lockKey).toBeNull();
    });

    it('should handle lock acquisition timeout', async () => {
      class TestService {
        @RedisLock({ key: 'timeout-lock', ttl: 5, retries: 2, retryDelay: 50 })
        async process(id: number): Promise<string> {
          return `result-${id}`;
        }

        redisManager = redisManager;
      }

      const service = new TestService();
      const client = redisManager.getClient() as Redis;

      // Set a lock that won't expire during retries
      await client.set('lock:timeout-lock:1', 'locked', 'EX', 10);

      await expect(service.process(1)).rejects.toThrow('Failed to acquire lock');

      // Clean up
      await client.del('lock:timeout-lock:1');
    });
  });

  describe('@RedisRateLimit', () => {
    it('should allow requests within rate limit', async () => {
      class TestService {
        callCount = 0;

        @RedisRateLimit({ key: 'api', limit: 5, window: 2 })
        async callApi(userId: number): Promise<string> {
          this.callCount++;
          return `api-${userId}`;
        }

        redisManager = redisManager;
      }

      const service = new TestService();

      // Make 5 calls (within limit)
      for (let i = 0; i < 5; i++) {
        const result = await service.callApi(1);
        expect(result).toBe('api-1');
      }

      expect(service.callCount).toBe(5);
    });

    it('should reject requests exceeding rate limit', async () => {
      class TestService {
        @RedisRateLimit({ key: 'limited', limit: 3, window: 2 })
        async limitedApi(userId: number): Promise<string> {
          return `limited-${userId}`;
        }

        redisManager = redisManager;
      }

      const service = new TestService();

      // Make 3 calls (at limit)
      for (let i = 0; i < 3; i++) {
        await service.limitedApi(1);
      }

      // 4th call should fail
      await expect(service.limitedApi(1)).rejects.toThrow('Rate limit exceeded');
    });

    it('should reset after window expires', async () => {
      class TestService {
        callCount = 0;

        @RedisRateLimit({ key: 'window', limit: 2, window: 1 })
        async windowApi(userId: number): Promise<string> {
          this.callCount++;
          return `window-${userId}`;
        }

        redisManager = redisManager;
      }

      const service = new TestService();

      // Use up the limit
      await service.windowApi(1);
      await service.windowApi(1);

      // Should fail
      await expect(service.windowApi(1)).rejects.toThrow('Rate limit exceeded');

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should work again
      const result = await service.windowApi(1);
      expect(result).toBe('window-1');
      expect(service.callCount).toBe(3);
    });

    it('should use custom key function', async () => {
      class TestService {
        @RedisRateLimit({
          keyFn: (userId: number, endpoint: string) => `${endpoint}:${userId}`,
          limit: 2,
          window: 60
        })
        async apiCall(userId: number, endpoint: string): Promise<string> {
          return `${endpoint}-${userId}`;
        }

        redisManager = redisManager;
      }

      const service = new TestService();

      // Different endpoints should have separate limits
      await service.apiCall(1, 'users');
      await service.apiCall(1, 'users');
      await service.apiCall(1, 'posts'); // Different endpoint
      await service.apiCall(1, 'posts');

      // Both should be at their limits
      await expect(service.apiCall(1, 'users')).rejects.toThrow('Rate limit exceeded');
      await expect(service.apiCall(1, 'posts')).rejects.toThrow('Rate limit exceeded');
    });

    it('should handle different users independently', async () => {
      class TestService {
        @RedisRateLimit({ key: 'user-api', limit: 2, window: 60 })
        async userApi(userId: number): Promise<string> {
          return `user-${userId}`;
        }

        redisManager = redisManager;
      }

      const service = new TestService();

      // User 1 uses their limit
      await service.userApi(1);
      await service.userApi(1);
      await expect(service.userApi(1)).rejects.toThrow('Rate limit exceeded');

      // User 2 should still be able to call
      await service.userApi(2);
      await service.userApi(2);
      await expect(service.userApi(2)).rejects.toThrow('Rate limit exceeded');
    });

    it('should fall back on Redis error', async () => {
      class TestService {
        @RedisRateLimit({ key: 'fallback', limit: 10, window: 60 })
        async fallbackApi(): Promise<string> {
          return 'fallback-result';
        }

        redisManager = redisManager;
      }

      const service = new TestService();
      const client = redisManager.getClient() as Redis;

      // Mock incr to throw error
      const originalIncr = client.incr.bind(client);
      client.incr = jest.fn().mockRejectedValue(new Error('Redis error'));

      const result = await service.fallbackApi();
      expect(result).toBe('fallback-result'); // Should fall back to method execution

      // Restore
      client.incr = originalIncr;
    });
  });

  describe('Multiple Decorators', () => {
    it('should work with multiple decorators on same method', async () => {
      class TestService {
        callCount = 0;

        @RedisRateLimit({ key: 'multi', limit: 10, window: 60 })
        @RedisLock({ key: 'multi', ttl: 5 })
        @RedisCache({ ttl: 60, key: 'multi' })
        async complexOperation(id: number): Promise<string> {
          this.callCount++;
          await new Promise(resolve => setTimeout(resolve, 50));
          return `complex-${id}`;
        }

        redisManager = redisManager;
      }

      const service = new TestService();

      // First call - should execute method with lock
      const result1 = await service.complexOperation(1);
      expect(result1).toBe('complex-1');
      expect(service.callCount).toBe(1);

      // Second call - should use cache
      const result2 = await service.complexOperation(1);
      expect(result2).toBe('complex-1');
      expect(service.callCount).toBe(1); // Not incremented

      // Different argument - should execute with lock again
      const result3 = await service.complexOperation(2);
      expect(result3).toBe('complex-2');
      expect(service.callCount).toBe(2);
    });

    it('should handle errors in decorator chain', async () => {
      class TestService {
        @RedisRateLimit({ key: 'error-chain', limit: 1, window: 60 })
        @RedisLock({ key: 'error-chain', ttl: 5 })
        async errorOperation(): Promise<void> {
          throw new Error('Operation failed');
        }

        redisManager = redisManager;
      }

      const service = new TestService();

      // First call should acquire lock, increment rate limit, then fail
      await expect(service.errorOperation()).rejects.toThrow('Operation failed');

      // Second call should fail on rate limit
      await expect(service.errorOperation()).rejects.toThrow('Rate limit exceeded');
    });
  });

  describe('Injection Decorators', () => {
    it('should inject Redis client with @InjectRedis', () => {
      const mockClient = {} as Redis;

      class TestService {
        @InjectRedis()
        redis!: Redis;

        @InjectRedis('cache')
        cacheRedis!: Redis;
      }

      const metadata = Reflect.getMetadata('custom:inject', TestService.prototype, 'redis');
      expect(metadata).toEqual({ token: 'REDIS_CLIENT:default' });

      const cacheMetadata = Reflect.getMetadata('custom:inject', TestService.prototype, 'cacheRedis');
      expect(cacheMetadata).toEqual({ token: 'REDIS_CLIENT:cache' });
    });

    it('should inject RedisManager with @InjectRedisManager', () => {
      class TestService {
        @InjectRedisManager()
        manager!: RedisManager;
      }

      const metadata = Reflect.getMetadata('custom:inject', TestService.prototype, 'manager');
      expect(metadata).toEqual({ token: 'REDIS_MANAGER' });
    });
  });

  describe('Real Redis Integration', () => {
    it('should handle high concurrency with decorators', async () => {
      class TestService {
        @RedisRateLimit({ key: 'concurrent', limit: 100, window: 5 })
        @RedisCache({ ttl: 5, key: 'concurrent' })
        async concurrentApi(id: number): Promise<string> {
          return `concurrent-${id}`;
        }

        redisManager = redisManager;
      }

      const service = new TestService();

      // Make many concurrent calls
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(service.concurrentApi(i % 10)); // 10 unique IDs
      }

      const results = await Promise.all(promises);
      expect(results).toHaveLength(50);

      // All results should be valid
      results.forEach((result, index) => {
        expect(result).toBe(`concurrent-${index % 10}`);
      });
    });

    it('should handle decorator cleanup properly', async () => {
      class TestService {
        @RedisCache({ ttl: 1, key: 'cleanup' })
        @RedisLock({ key: 'cleanup', ttl: 1 })
        async cleanupOperation(): Promise<string> {
          return 'cleanup-result';
        }

        redisManager = redisManager;
      }

      const service = new TestService();
      const client = redisManager.getClient() as Redis;

      await service.cleanupOperation();

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Check that keys are cleaned up
      const cacheKey = await client.get('cache:cleanup');
      const lockKey = await client.get('lock:cleanup');

      expect(cacheKey).toBeNull();
      expect(lockKey).toBeNull();
    });
  });
});