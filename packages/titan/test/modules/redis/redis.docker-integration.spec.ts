/**
 * Redis Docker Integration Tests
 *
 * These tests demonstrate how to use the RedisTestManager and related utilities
 * for comprehensive Redis testing with Docker containers.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { RedisTestManager } from '../../../src/testing/docker-test-manager.js';
import {
  createDockerRedisFixture,
  createDockerRedisClusterFixture,
  withDockerRedis,
  withDockerRedisCluster,
  buildRedisConnectionString,
  waitForRedisReady,
  flushRedis,
  type DockerRedisTestFixture,
  type DockerRedisClusterFixture,
  isRedisInMockMode,
  isDockerAvailable,
} from './utils/redis-test-utils.js';

// Skip all tests in this file if running in mock mode or CI (check env vars FIRST to avoid slow Docker check)
const skipTests = process.env.USE_MOCK_REDIS === 'true' || process.env.CI === 'true' || isRedisInMockMode();
if (skipTests) {
  console.log('⏭️ Skipping redis.docker-integration.spec.ts - requires Docker');
}
const describeOrSkip = skipTests ? describe.skip : describe;

describeOrSkip('RedisTestManager - Standalone Redis', () => {
  beforeAll(() => {
    if (skipTests) {
      console.log('⏭️  Skipping redis.docker-integration.spec.ts - requires Docker');
    }
  });
  describe('Basic Container Creation', () => {
    it('should create a standalone Redis container', async () => {
      const container = await RedisTestManager.createRedisContainer();

      expect(container).toBeDefined();
      expect(container.id).toBeDefined();
      expect(container.name).toBeDefined();
      expect(container.ports.has(6379)).toBe(true);

      await container.cleanup();
    });

    it('should create Redis with custom port', async () => {
      const container = await RedisTestManager.createRedisContainer({
        port: 'auto',
      });

      const port = container.ports.get(6379);
      expect(port).toBeGreaterThan(0);

      await container.cleanup();
    });

    it('should create Redis with password', async () => {
      const container = await RedisTestManager.createRedisContainer({
        password: 'test-password',
      });

      expect(container).toBeDefined();

      await container.cleanup();
    });
  });

  describe('withRedis Helper', () => {
    it('should run test with auto-cleanup', async () => {
      const result = await RedisTestManager.withRedis(async (container, connectionString) => {
        expect(container).toBeDefined();
        expect(connectionString).toMatch(/^redis:\/\/localhost:\d+\/0$/);

        return 'test-result';
      });

      expect(result).toBe('test-result');
    });

    it('should handle errors and still cleanup', async () => {
      await expect(
        RedisTestManager.withRedis(async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');
    });
  });

  describe('Docker Fixture Usage', () => {
    it('should create fixture with working Redis client', async () => {
      const fixture = await createDockerRedisFixture();

      try {
        // Test basic operations
        await fixture.client.set('test-key', 'test-value');
        const value = await fixture.client.get('test-key');
        expect(value).toBe('test-value');

        // Verify connection string
        expect(fixture.connectionString).toMatch(/^redis:\/\/localhost:\d+\/0$/);
      } finally {
        await fixture.cleanup();
      }
    });

    it('should support multiple databases', async () => {
      const fixture1 = await createDockerRedisFixture({ database: 0 });
      const fixture2 = await createDockerRedisFixture({ database: 1 });

      try {
        await fixture1.client.set('key', 'db0');
        await fixture2.client.set('key', 'db1');

        const value1 = await fixture1.client.get('key');
        const value2 = await fixture2.client.get('key');

        expect(value1).toBe('db0');
        expect(value2).toBe('db1');
      } finally {
        await fixture1.cleanup();
        await fixture2.cleanup();
      }
    });

    it('should work with password-protected Redis', async () => {
      const fixture = await createDockerRedisFixture({
        password: 'secure-password',
      });

      try {
        await fixture.client.set('secure-key', 'secure-value');
        const value = await fixture.client.get('secure-key');
        expect(value).toBe('secure-value');
      } finally {
        await fixture.cleanup();
      }
    });
  });

  describe('Helper Functions', () => {
    let fixture: DockerRedisTestFixture;

    beforeAll(async () => {
      fixture = await createDockerRedisFixture();
    });

    afterAll(async () => {
      await fixture.cleanup();
    });

    it('should wait for Redis to be ready', async () => {
      await expect(waitForRedisReady(fixture.client, 5000)).resolves.not.toThrow();
    });

    it('should flush Redis data', async () => {
      await fixture.client.set('key1', 'value1');
      await fixture.client.set('key2', 'value2');

      await flushRedis(fixture.client);

      const value1 = await fixture.client.get('key1');
      const value2 = await fixture.client.get('key2');

      expect(value1).toBeNull();
      expect(value2).toBeNull();
    });

    it('should build connection strings correctly', () => {
      const connStr1 = buildRedisConnectionString({
        host: 'localhost',
        port: 6379,
        database: 0,
      });
      expect(connStr1).toBe('redis://localhost:6379/0');

      const connStr2 = buildRedisConnectionString({
        host: 'localhost',
        port: 6379,
        password: 'pass123',
        database: 1,
      });
      expect(connStr2).toBe('redis://:pass123@localhost:6379/1');
    });
  });

  describe('withDockerRedis Helper', () => {
    it('should provide isolated test environment', async () => {
      await withDockerRedis(async (fixture) => {
        await fixture.client.set('isolated-key', 'isolated-value');
        const value = await fixture.client.get('isolated-key');
        expect(value).toBe('isolated-value');
      });
    });

    it('should handle concurrent tests', async () => {
      const results = await Promise.all([
        withDockerRedis(async (fixture) => {
          await fixture.client.set('key', 'value1');
          return fixture.client.get('key');
        }),
        withDockerRedis(async (fixture) => {
          await fixture.client.set('key', 'value2');
          return fixture.client.get('key');
        }),
      ]);

      expect(results).toContain('value1');
      expect(results).toContain('value2');
    });
  });
});

describe('RedisTestManager - Redis Cluster', () => {
  // Note: Cluster tests may take longer to set up
  const clusterTimeout = 60000;

  describe('Cluster Creation', () => {
    it(
      'should create a Redis cluster',
      async () => {
        const cluster = await RedisTestManager.createRedisCluster({
          masterCount: 3,
          replicasPerMaster: 1,
        });

        try {
          expect(cluster.masters).toHaveLength(3);
          expect(cluster.replicas).toHaveLength(3);
          expect(cluster.nodes).toHaveLength(6);
          expect(cluster.network).toBeDefined();
        } finally {
          await cluster.cleanup();
        }
      },
      clusterTimeout
    );

    it(
      'should create minimal cluster (3 masters, no replicas)',
      async () => {
        const cluster = await RedisTestManager.createRedisCluster({
          masterCount: 3,
          replicasPerMaster: 0,
        });

        try {
          expect(cluster.masters).toHaveLength(3);
          expect(cluster.replicas).toHaveLength(0);
          expect(cluster.nodes).toHaveLength(3);
        } finally {
          await cluster.cleanup();
        }
      },
      clusterTimeout
    );
  });

  describe('withRedisCluster Helper', () => {
    it(
      'should run test with cluster',
      async () => {
        await RedisTestManager.withRedisCluster(async (cluster) => {
          expect(cluster.masters.length).toBeGreaterThan(0);
          expect(cluster.nodes.length).toBeGreaterThan(0);
        });
      },
      clusterTimeout
    );
  });

  describe('Cluster Operations', () => {
    it(
      'should perform operations on cluster',
      async () => {
        const fixture = await createDockerRedisClusterFixture();

        try {
          // Basic operations
          await fixture.client.set('cluster-key', 'cluster-value');
          const value = await fixture.client.get('cluster-key');
          expect(value).toBe('cluster-value');

          // Hash tags ensure keys go to same slot
          await fixture.client.set('{user:1}:name', 'Alice');
          await fixture.client.set('{user:1}:age', '30');

          const name = await fixture.client.get('{user:1}:name');
          const age = await fixture.client.get('{user:1}:age');

          expect(name).toBe('Alice');
          expect(age).toBe('30');
        } finally {
          await fixture.cleanup();
        }
      },
      clusterTimeout
    );

    it(
      'should handle pipeline operations',
      async () => {
        await withDockerRedisCluster(async (fixture) => {
          const pipeline = fixture.client.pipeline();
          pipeline.set('key1', 'value1');
          pipeline.set('key2', 'value2');
          pipeline.get('key1');
          pipeline.get('key2');

          const results = await pipeline.exec();
          expect(results).toBeDefined();
          expect(results?.length).toBe(4);
        });
      },
      clusterTimeout
    );
  });
});

describe('Connection String Builder', () => {
  it('should build simple connection string', () => {
    const connStr = buildRedisConnectionString({
      host: 'localhost',
      port: 6379,
    });
    expect(connStr).toBe('redis://localhost:6379/0');
  });

  it('should build connection string with password', () => {
    const connStr = buildRedisConnectionString({
      host: 'redis.example.com',
      port: 6380,
      password: 'secret',
      database: 5,
    });
    expect(connStr).toBe('redis://:secret@redis.example.com:6380/5');
  });

  it('should use defaults', () => {
    const connStr = buildRedisConnectionString({});
    expect(connStr).toBe('redis://localhost:6379/0');
  });
});

describe('Integration: Real-world Scenarios', () => {
  it('should support key expiration', async () => {
    await withDockerRedis(async (fixture) => {
      await fixture.client.setex('temp-key', 1, 'temp-value');

      const value1 = await fixture.client.get('temp-key');
      expect(value1).toBe('temp-value');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const value2 = await fixture.client.get('temp-key');
      expect(value2).toBeNull();
    });
  });

  it('should support pub/sub', async () => {
    await withDockerRedis(async (fixture) => {
      const messages: string[] = [];

      const subscriber = fixture.client.duplicate();
      // Note: duplicate() creates an already-connected client, no need to call connect()

      subscriber.on('message', (channel, message) => {
        messages.push(message);
      });

      await subscriber.subscribe('test-channel');

      await fixture.client.publish('test-channel', 'message-1');
      await fixture.client.publish('test-channel', 'message-2');

      // Give time for messages to arrive
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(messages).toContain('message-1');
      expect(messages).toContain('message-2');

      await subscriber.quit();
    });
  });

  it('should support transactions', async () => {
    await withDockerRedis(async (fixture) => {
      const multi = fixture.client.multi();
      multi.set('key1', 'value1');
      multi.set('key2', 'value2');
      multi.incr('counter');

      const results = await multi.exec();
      expect(results).toHaveLength(3);
      expect(results?.[0]?.[1]).toBe('OK');
      expect(results?.[1]?.[1]).toBe('OK');
      expect(results?.[2]?.[1]).toBe(1);
    });
  });

  it('should support sorted sets', async () => {
    await withDockerRedis(async (fixture) => {
      await fixture.client.zadd('leaderboard', 100, 'player1');
      await fixture.client.zadd('leaderboard', 200, 'player2');
      await fixture.client.zadd('leaderboard', 150, 'player3');

      const top = await fixture.client.zrevrange('leaderboard', 0, 1);
      expect(top).toEqual(['player2', 'player3']);

      const score = await fixture.client.zscore('leaderboard', 'player2');
      expect(score).toBe('200');
    });
  });
});
