import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RedisHealthIndicator } from '../../../src/modules/redis/redis.health.js';
import { RedisManager } from '../../../src/modules/redis/redis.manager.js';
import { TitanError } from '../../../src/errors/core.js';
import Redis from 'ioredis';
import { createDockerRedisFixture, type DockerRedisTestFixture, isRedisInMockMode } from './utils/redis-test-utils.js';
import { createLogger } from '../../utils/test-logger.js';
import { isDockerAvailable } from '../../utils/docker-test-utils.js';

// Skip tests if in CI/mock mode (check env vars first to avoid slow Docker check)
const skipTests = isRedisInMockMode() || !isDockerAvailable();
if (skipTests) {
  console.log('⏭️ Skipping redis.health.spec.ts - requires Docker');
}
const describeOrSkip = skipTests ? describe.skip : describe;

interface _Logger {
  log(message: string): void;
  error(message: string, error?: unknown): void;
  warn(message: string): void;
  debug(message: string): void;
}

interface MockRedisManager {
  isHealthy(namespace?: string): Promise<boolean>;
  healthCheck(): Promise<Record<string, { healthy: boolean; latency: number }>>;
  ping(namespace?: string): Promise<string>;
  getClient(namespace?: string): Redis;
}

interface HealthCheckDetails {
  status: string;
  healthy: boolean;
  namespace?: string;
  latency?: number;
  error?: string;
  ping?: string;
  connected?: boolean;
  clients?: Record<string, { healthy: boolean; latency: number }>;
}

describeOrSkip('RedisHealthIndicator', () => {
  let healthIndicator: RedisHealthIndicator;
  let manager: RedisManager;
  let dockerFixture: DockerRedisTestFixture;
  let dockerFixture2: DockerRedisTestFixture;
  let defaultNamespace: string;
  let secondaryNamespace: string;

  beforeEach(async () => {
    dockerFixture = await createDockerRedisFixture({ database: 0 });
    dockerFixture2 = await createDockerRedisFixture({ database: 1 });

    const uniqueId = Math.random().toString(36).substring(7);
    defaultNamespace = `default-${uniqueId}`;
    secondaryNamespace = `secondary-${uniqueId}`;

    manager = new RedisManager(
      {
        clients: [
          {
            namespace: defaultNamespace,
            host: 'localhost',
            port: dockerFixture.port,
            db: 0,
            lazyConnect: false,
          },
          {
            namespace: secondaryNamespace,
            host: 'localhost',
            port: dockerFixture2.port,
            db: 1,
            lazyConnect: false,
          },
        ],
      },
      createLogger() as any
    );

    await manager.init();
    healthIndicator = new RedisHealthIndicator(manager);
  });

  afterEach(async () => {
    if (manager) {
      await manager.destroy();
    }
    if (dockerFixture) {
      await dockerFixture.cleanup();
    }
    if (dockerFixture2) {
      await dockerFixture2.cleanup();
    }
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

    it('should throw TitanError when manager reports unhealthy', async () => {
      const tempFixture = await createDockerRedisFixture();
      try {
        const badManager = new RedisManager(
          {
            clients: [
              {
                namespace: 'bad',
                host: 'invalid-host',
                port: 6379,
                retryStrategy: () => null,
                connectTimeout: 100,
              },
            ],
          },
          createLogger() as any
        );

        const badHealthIndicator = new RedisHealthIndicator(badManager);

        await expect(badHealthIndicator.isHealthy('redis', 'bad')).rejects.toThrow(TitanError);
      } finally {
        await tempFixture.cleanup();
      }
    });

    it('should include error details in TitanError', async () => {
      const errorManager: MockRedisManager = {
        isHealthy: vi.fn().mockRejectedValue(new Error('Connection timeout')),
        healthCheck: vi.fn(),
        ping: vi.fn(),
        getClient: vi.fn(),
      };

      const errorHealthIndicator = new RedisHealthIndicator(errorManager as unknown as RedisManager);

      try {
        await errorHealthIndicator.isHealthy('redis');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TitanError);
        const healthError = error as TitanError;
        expect(healthError.details.causes).toHaveLength(1);
        expect(healthError.details.causes[0]).toHaveProperty('redis');
        expect(healthError.details.causes[0]['redis'].status).toBe('down');
        expect(healthError.details.causes[0]['redis'].error).toBe('Connection timeout');
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

    it('should throw TitanError if any client is unhealthy', async () => {
      const tempFixture = await createDockerRedisFixture();
      let mixedManager: RedisManager | undefined;
      try {
        mixedManager = new RedisManager(
          {
            clients: [
              {
                namespace: 'good',
                host: 'localhost',
                port: tempFixture.port,
                db: 0,
                lazyConnect: false,
              },
              {
                namespace: 'bad',
                host: 'invalid-host',
                port: 6379,
                retryStrategy: () => null,
                connectTimeout: 100,
                lazyConnect: false,
              },
            ],
          },
          createLogger() as any
        );

        // Note: init() will throw for the bad client, so we catch it
        try {
          await mixedManager.init();
        } catch {
          // Expected - bad client will fail to connect
        }

        const mixedHealthIndicator = new RedisHealthIndicator(mixedManager);

        await expect(mixedHealthIndicator.checkAll()).rejects.toThrow(TitanError);
      } finally {
        if (mixedManager) {
          await mixedManager.destroy();
        }
        await tempFixture.cleanup();
      }
    });

    it('should include unhealthy clients in error', async () => {
      const mockManager: MockRedisManager = {
        healthCheck: vi.fn().mockResolvedValue({
          good: { healthy: true, latency: 1 },
          bad1: { healthy: false, latency: -1 },
          bad2: { healthy: false, latency: -1 },
        }),
        isHealthy: vi.fn(),
        ping: vi.fn(),
        getClient: vi.fn(),
      };

      const mockHealthIndicator = new RedisHealthIndicator(mockManager as unknown as RedisManager);

      try {
        await mockHealthIndicator.checkAll();
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TitanError);
        const healthError = error as TitanError;
        expect(healthError.details.causes).toHaveLength(1);
        expect(healthError.details.causes[0]).toHaveProperty('redis');
        const redisStatus = healthError.details.causes[0]['redis'] as HealthCheckDetails;
        expect(redisStatus.clients?.bad1.healthy).toBe(false);
        expect(redisStatus.clients?.bad2.healthy).toBe(false);
      }
    });
  });

  describe('ping', () => {
    it('should return PONG when Redis responds', async () => {
      const result = await healthIndicator.ping(defaultNamespace);

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

    it('should throw TitanError when ping fails', async () => {
      const mockClient = {
        ping: vi.fn().mockRejectedValue(new Error('Network error')),
      };

      const mockManager: MockRedisManager = {
        getClient: vi.fn().mockReturnValue(mockClient),
        ping: vi.fn().mockRejectedValue(new Error('Network error')),
        isHealthy: vi.fn(),
        healthCheck: vi.fn(),
      };

      const mockHealthIndicator = new RedisHealthIndicator(mockManager as unknown as RedisManager);

      await expect(mockHealthIndicator.ping()).rejects.toThrow(TitanError);
    });

    it('should throw TitanError when client not found', async () => {
      const mockManager: MockRedisManager = {
        ping: vi.fn().mockRejectedValue(new Error('Client not found')),
        isHealthy: vi.fn(),
        healthCheck: vi.fn(),
        getClient: vi.fn(),
      };

      const mockHealthIndicator = new RedisHealthIndicator(mockManager as unknown as RedisManager);

      await expect(mockHealthIndicator.ping('nonexistent')).rejects.toThrow(TitanError);
    });
  });

  describe('checkConnection', () => {
    it('should return connected status for ready client', async () => {
      const result = await healthIndicator.checkConnection(defaultNamespace);
      const key = `redis-${defaultNamespace}`;

      expect(result).toHaveProperty(key);
      expect(result[key].status).toBe('up');
      expect(result[key].healthy).toBe(true);
    });

    it('should check connection for specific namespace', async () => {
      const result = await healthIndicator.checkConnection(secondaryNamespace);
      const key = `redis-${secondaryNamespace}`;

      expect(result).toHaveProperty(key);
      expect(result[key].status).toBe('up');
      expect(result[key].healthy).toBe(true);
    });

    it('should throw TitanError for disconnected client', async () => {
      const mockManager: MockRedisManager = {
        isHealthy: vi.fn().mockResolvedValue(false),
        healthCheck: vi.fn(),
        ping: vi.fn(),
        getClient: vi.fn(),
      };

      const mockHealthIndicator = new RedisHealthIndicator(mockManager as unknown as RedisManager);

      await expect(mockHealthIndicator.checkConnection()).rejects.toThrow(TitanError);
    });

    it('should handle cluster connections', async () => {
      const mockManager: MockRedisManager = {
        isHealthy: vi.fn().mockResolvedValue(true),
        healthCheck: vi.fn(),
        ping: vi.fn(),
        getClient: vi.fn(),
      };

      const mockHealthIndicator = new RedisHealthIndicator(mockManager as unknown as RedisManager);

      const result = await mockHealthIndicator.checkConnection();

      expect(result).toHaveProperty('redis-default');
      expect(result['redis-default'].status).toBe('up');
      expect(result['redis-default'].healthy).toBe(true);
    });

    it('should throw when client not found', async () => {
      const mockManager: MockRedisManager = {
        isHealthy: vi.fn().mockRejectedValue(new Error('Client not found')),
        healthCheck: vi.fn(),
        ping: vi.fn(),
        getClient: vi.fn(),
      };

      const mockHealthIndicator = new RedisHealthIndicator(mockManager as unknown as RedisManager);

      await expect(mockHealthIndicator.checkConnection()).rejects.toThrow(TitanError);
    });
  });

  describe('Error Handling', () => {
    it('should handle non-Error objects in catch', async () => {
      const mockManager: MockRedisManager = {
        isHealthy: vi.fn().mockRejectedValue('String error'),
        healthCheck: vi.fn(),
        ping: vi.fn(),
        getClient: vi.fn(),
      };

      const mockHealthIndicator = new RedisHealthIndicator(mockManager as unknown as RedisManager);

      try {
        await mockHealthIndicator.isHealthy('redis');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(TitanError);
        const healthError = error as TitanError;
        expect(healthError.details.causes[0]['redis'].error).toBe('String error');
      }
    });

    it('should handle undefined error messages', async () => {
      const errorWithoutMessage = Object.create(Error.prototype);
      Object.defineProperty(errorWithoutMessage, 'message', {
        value: undefined,
        writable: true,
        enumerable: true,
        configurable: true,
      });

      const mockManager: MockRedisManager = {
        isHealthy: vi.fn().mockRejectedValue(errorWithoutMessage),
        healthCheck: vi.fn(),
        ping: vi.fn(),
        getClient: vi.fn(),
      };

      const mockHealthIndicator = new RedisHealthIndicator(mockManager as unknown as RedisManager);

      try {
        await mockHealthIndicator.isHealthy('redis');
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TitanError);
        const healthError = err as TitanError;
        expect(healthError.details.causes[0]['redis'].error).toBeDefined();
      }
    });
  });

  describe('Real Redis Integration', () => {
    it('should perform comprehensive health checks with real Redis', async () => {
      const healthResult = await healthIndicator.isHealthy('test', defaultNamespace);
      expect(healthResult.test.healthy).toBe(true);

      const allResult = await healthIndicator.checkAll();
      expect(allResult.redis.status).toBe('up');

      const pingResult = await healthIndicator.ping(defaultNamespace);
      expect(pingResult.redis.ping).toBe('PONG');

      const connResult = await healthIndicator.checkConnection(defaultNamespace);
      const key = `redis-${defaultNamespace}`;
      expect(connResult[key].status).toBe('up');
    });

    it('should measure accurate latency', async () => {
      const result = await healthIndicator.isHealthy('latency-test', defaultNamespace);

      expect(result['latency-test'].latency).toBeGreaterThanOrEqual(0);
      expect(result['latency-test'].latency).toBeLessThan(100);
    });

    it('should handle multiple concurrent health checks', async () => {
      const promises = [
        healthIndicator.isHealthy('concurrent1', defaultNamespace),
        healthIndicator.isHealthy('concurrent2', defaultNamespace),
        healthIndicator.ping(defaultNamespace),
        healthIndicator.checkConnection(defaultNamespace),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(4);
      expect(results[0]).toHaveProperty('concurrent1');
      expect(results[1]).toHaveProperty('concurrent2');
      expect(results[2]).toHaveProperty('redis');
      expect(results[3]).toHaveProperty(`redis-${defaultNamespace}`);
    });
  });
});
