import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { RedisHealthIndicator, HealthCheckError } from '../../../src/modules/redis/redis.health.js';
import { RedisManager } from '../../../src/modules/redis/redis.manager.js';
import Redis from 'ioredis';
import {
  createRedisTestHelper,
  RedisTestHelper
} from '../../utils/redis-test-utils.js';

describe('RedisHealthIndicator', () => {
  let healthIndicator: RedisHealthIndicator;
  let manager: RedisManager;
  let helper: RedisTestHelper;
  let testClient: Redis;
  let namespace: string;
  let defaultNamespace: string;
  let secondaryNamespace: string;

  beforeEach(async () => {
    helper = createRedisTestHelper();
    await helper.waitForRedis();

    namespace = `health-test-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    testClient = helper.createClient('test', 15);

    // Create real manager with unique namespaces
    const uniqueId = Math.random().toString(36).substring(7);
    defaultNamespace = `default-${uniqueId}`;
    secondaryNamespace = `secondary-${uniqueId}`;

    manager = new RedisManager({
      clients: [
        {
          namespace: defaultNamespace,
          host: 'localhost',
          port: 6379,
          db: 15,
        },
        {
          namespace: secondaryNamespace,
          host: 'localhost',
          port: 6379,
          db: 14,
        }
      ]
    });

    // Initialize manager manually
    await manager.init();
    healthIndicator = new RedisHealthIndicator(manager);
  });

  afterEach(async () => {
    await helper.cleanupData();
    if (manager) {
      await manager.destroy();
    }
    await helper.cleanup();
  });

  describe('isHealthy', () => {
    it('should return healthy status for connected Redis', async () => {
      const result = await healthIndicator.isHealthy('redis', defaultNamespace);

      expect(result).toHaveProperty('redis');
      expect(result.redis.status).toBe('up');
      expect(result.redis.healthy).toBe(true);
      expect(result.redis.namespace).toBe(defaultNamespace);
    });

    it('should check specific namespace', async () => {
      const result = await healthIndicator.isHealthy('redis-secondary', secondaryNamespace);

      expect(result).toHaveProperty('redis-secondary');
      expect(result['redis-secondary'].status).toBe('up');
      expect(result['redis-secondary'].healthy).toBe(true);
    });

    it('should throw HealthCheckError when manager reports unhealthy', async () => {
      // Create a manager with invalid config
      const badManager = new RedisManager({
        clients: [{
          namespace: 'bad',
          host: 'invalid-host',
          port: 6379,
          retryStrategy: () => null,
        }]
      }, null as any);

      const badHealthIndicator = new RedisHealthIndicator(badManager);

      await expect(badHealthIndicator.isHealthy('redis', 'bad'))
        .rejects.toThrow(HealthCheckError);
    });

    it('should include error details in HealthCheckError', async () => {
      // Mock manager to throw error
      const errorManager = {
        isHealthy: jest.fn().mockRejectedValue(new Error('Connection timeout'))
      } as any;

      const errorHealthIndicator = new RedisHealthIndicator(errorManager);

      try {
        await errorHealthIndicator.isHealthy('redis');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(HealthCheckError);
        const healthError = error as HealthCheckError;
        expect(healthError.causes).toHaveProperty('redis');
        expect(healthError.causes['redis'].status).toBe('down');
        expect(healthError.causes['redis'].error).toBe('Connection timeout');
      }
    });
  });

  describe('checkAll', () => {
    it('should check health of all Redis clients', async () => {
      const result = await healthIndicator.checkAll();

      expect(result).toHaveProperty('redis');
      expect(result.redis.status).toBe('up');
      expect(result.redis.clients).toHaveProperty(defaultNamespace);
      expect(result.redis.clients).toHaveProperty(secondaryNamespace);

      expect(result.redis.clients[defaultNamespace].healthy).toBe(true);
      expect(result.redis.clients[defaultNamespace].latency).toBeGreaterThanOrEqual(0);
      expect(result.redis.clients[secondaryNamespace].healthy).toBe(true);
      expect(result.redis.clients[secondaryNamespace].latency).toBeGreaterThanOrEqual(0);
    });

    it('should throw HealthCheckError if any client is unhealthy', async () => {
      // Create manager with one bad client
      const mixedManager = new RedisManager({
        clients: [
          {
            namespace: 'good',
            host: 'localhost',
            port: 6379,
            db: 15,
          },
          {
            namespace: 'bad',
            host: 'invalid-host',
            port: 6379,
            retryStrategy: () => null,
          }
        ]
      }, null as any);

      const mixedHealthIndicator = new RedisHealthIndicator(mixedManager);

      await expect(mixedHealthIndicator.checkAll()).rejects.toThrow(HealthCheckError);
    });

    it('should include unhealthy clients in error', async () => {
      // Mock manager with mixed health
      const mockManager = {
        healthCheck: jest.fn().mockResolvedValue({
          good: { healthy: true, latency: 1 },
          bad1: { healthy: false, latency: -1 },
          bad2: { healthy: false, latency: -1 },
        })
      } as any;

      const mockHealthIndicator = new RedisHealthIndicator(mockManager);

      try {
        await mockHealthIndicator.checkAll();
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(HealthCheckError);
        const healthError = error as HealthCheckError;
        expect(healthError.causes['redis'].unhealthy).toEqual(['bad1', 'bad2']);
      }
    });
  });

  describe('ping', () => {
    it('should return PONG when Redis responds', async () => {
      const result = await healthIndicator.ping();

      expect(result).toHaveProperty('redis');
      expect(result.redis.status).toBe('up');
      expect(result.redis.ping).toBe('PONG');
    });

    it('should ping specific namespace', async () => {
      const result = await healthIndicator.ping(secondaryNamespace);

      expect(result).toHaveProperty('redis');
      expect(result.redis.status).toBe('up');
      expect(result.redis.ping).toBe('PONG');
    });

    it('should throw HealthCheckError when ping fails', async () => {
      // Mock manager with client that fails ping
      const mockClient = {
        ping: jest.fn().mockRejectedValue(new Error('Network error'))
      };

      const mockManager = {
        getClient: jest.fn().mockReturnValue(mockClient)
      } as any;

      const mockHealthIndicator = new RedisHealthIndicator(mockManager);

      await expect(mockHealthIndicator.ping()).rejects.toThrow(HealthCheckError);
    });

    it('should throw HealthCheckError when client not found', async () => {
      const mockManager = {
        getClient: jest.fn().mockReturnValue(undefined)
      } as any;

      const mockHealthIndicator = new RedisHealthIndicator(mockManager);

      await expect(mockHealthIndicator.ping('nonexistent')).rejects.toThrow(HealthCheckError);
    });
  });

  describe('checkConnection', () => {
    it('should return connected status for ready client', async () => {
      const result = await healthIndicator.checkConnection();

      expect(result).toHaveProperty('redis');
      expect(result.redis.status).toBe('up');
      expect(result.redis.connected).toBe(true);
    });

    it('should check connection for specific namespace', async () => {
      const result = await healthIndicator.checkConnection(secondaryNamespace);

      expect(result).toHaveProperty('redis');
      expect(result.redis.status).toBe('up');
      expect(result.redis.connected).toBe(true);
    });

    it('should throw HealthCheckError for disconnected client', async () => {
      const disconnectedClient = new Redis({
        host: 'localhost',
        port: 6379,
        lazyConnect: true,
      });

      const mockManager = {
        getClient: jest.fn().mockReturnValue(disconnectedClient)
      } as any;

      const mockHealthIndicator = new RedisHealthIndicator(mockManager);

      await expect(mockHealthIndicator.checkConnection()).rejects.toThrow(HealthCheckError);

      await disconnectedClient.quit();
    });

    it('should handle cluster connections', async () => {
      const mockCluster = {
        status: 'ready'
      };

      const mockManager = {
        getClient: jest.fn().mockReturnValue(mockCluster)
      } as any;

      const mockHealthIndicator = new RedisHealthIndicator(mockManager);

      const result = await mockHealthIndicator.checkConnection();

      expect(result).toHaveProperty('redis');
      expect(result.redis.status).toBe('up');
      expect(result.redis.connected).toBe(true);
    });

    it('should throw when client not found', async () => {
      const mockManager = {
        getClient: jest.fn().mockReturnValue(null)
      } as any;

      const mockHealthIndicator = new RedisHealthIndicator(mockManager);

      await expect(mockHealthIndicator.checkConnection()).rejects.toThrow(HealthCheckError);
    });
  });

  describe('Error Handling', () => {
    it('should handle non-Error objects in catch', async () => {
      const mockManager = {
        isHealthy: jest.fn().mockRejectedValue('String error')
      } as any;

      const mockHealthIndicator = new RedisHealthIndicator(mockManager);

      try {
        await mockHealthIndicator.isHealthy('redis');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(HealthCheckError);
        const healthError = error as HealthCheckError;
        expect(healthError.causes['redis'].error).toBe('String error');
      }
    });

    it('should handle undefined error messages', async () => {
      const error = new Error();
      error.message = undefined as any;

      const mockManager = {
        isHealthy: jest.fn().mockRejectedValue(error)
      } as any;

      const mockHealthIndicator = new RedisHealthIndicator(mockManager);

      try {
        await mockHealthIndicator.isHealthy('redis');
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(HealthCheckError);
        const healthError = err as HealthCheckError;
        expect(healthError.causes['redis'].error).toBe('Unknown error');
      }
    });
  });

  describe('Real Redis Integration', () => {
    it('should perform comprehensive health checks with real Redis', async () => {
      // Test all health check methods with real Redis
      const healthResult = await healthIndicator.isHealthy('test');
      expect(healthResult.test.healthy).toBe(true);

      const allResult = await healthIndicator.checkAll();
      expect(allResult.redis.status).toBe('up');

      const pingResult = await healthIndicator.ping();
      expect(pingResult.redis.ping).toBe('PONG');

      const connResult = await healthIndicator.checkConnection();
      expect(connResult.redis.connected).toBe(true);
    });

    it('should measure accurate latency', async () => {
      const result = await healthIndicator.isHealthy('latency-test');

      expect(result['latency-test'].latency).toBeGreaterThanOrEqual(0);
      expect(result['latency-test'].latency).toBeLessThan(50); // Should be fast on localhost
    });

    it('should handle multiple concurrent health checks', async () => {
      const promises = [
        healthIndicator.isHealthy('concurrent1'),
        healthIndicator.isHealthy('concurrent2'),
        healthIndicator.ping(),
        healthIndicator.checkConnection(),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(4);
      expect(results[0]).toHaveProperty('concurrent1');
      expect(results[1]).toHaveProperty('concurrent2');
      expect(results[2]).toHaveProperty('redis');
      expect(results[3]).toHaveProperty('redis');
    });
  });
});