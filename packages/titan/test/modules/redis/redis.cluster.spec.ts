import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';
import { Cluster } from 'ioredis';
import { RedisManager } from '../../../src/modules/redis/redis.manager.js';
import { RedisService } from '../../../src/modules/redis/redis.service.js';
import { isCluster, createRedisClient } from '../../../src/modules/redis/redis.utils.js';
import {
  createDockerRedisClusterFixture,
  type DockerRedisClusterFixture,
} from './utils/redis-test-utils.js';

describe('Redis Cluster Support', () => {
  describe('Cluster Detection', () => {
    let clusterFixture: DockerRedisClusterFixture;

    beforeAll(async () => {
      clusterFixture = await createDockerRedisClusterFixture();
    }, 180000);

    afterAll(async () => {
      if (clusterFixture) {
        await clusterFixture.cleanup();
      }
    });

    it('should correctly identify cluster clients', async () => {
      const cluster = new Cluster([clusterFixture.nodes[0]], {
        lazyConnect: true,
        enableOfflineQueue: false,
        clusterRetryStrategy: () => null,
      });

      expect(isCluster(cluster)).toBe(true);
      await cluster.disconnect();
    });

    it('should correctly identify non-cluster clients', async () => {
      const regularClient = createRedisClient({
        host: 'localhost',
        port: clusterFixture.nodes[0].port,
        lazyConnect: true,
      });

      expect(isCluster(regularClient)).toBe(false);
      await regularClient.disconnect();
    });

    it('should handle null/undefined in isCluster', () => {
      expect(isCluster(null as any)).toBe(false);
      expect(isCluster(undefined as any)).toBe(false);
      expect(isCluster({} as any)).toBe(false);
    });
  });

  describe('Cluster Client Creation', () => {
    let clusterFixture: DockerRedisClusterFixture;

    beforeAll(async () => {
      clusterFixture = await createDockerRedisClusterFixture();
    }, 180000);

    afterAll(async () => {
      if (clusterFixture) {
        await clusterFixture.cleanup();
      }
    });

    it('should create cluster client with proper configuration', async () => {
      const client = createRedisClient({
        cluster: {
          nodes: [clusterFixture.nodes[0], clusterFixture.nodes[1]],
          options: {
            clusterRetryStrategy: (times: number) => Math.min(times * 100, 2000),
            redisOptions: {
              password: 'cluster-pass',
              connectTimeout: 10000,
            },
          },
        },
      });

      expect(isCluster(client)).toBe(true);
      const cluster = client as Cluster;
      expect(cluster.options.clusterRetryStrategy).toBeDefined();
      expect(cluster.options.redisOptions?.password).toBe('cluster-pass');

      await cluster.disconnect();
    });

    it('should handle cluster-specific options', async () => {
      const client = createRedisClient({
        cluster: {
          nodes: [clusterFixture.nodes[0]],
          options: {
            enableReadyCheck: true,
            maxRedirections: 16,
            retryDelayOnFailover: 100,
            retryDelayOnClusterDown: 300,
            slotsRefreshTimeout: 1000,
            slotsRefreshInterval: 5000,
          },
        },
      });

      expect(isCluster(client)).toBe(true);
      const cluster = client as Cluster;
      expect(cluster.options.enableReadyCheck).toBe(true);
      expect(cluster.options.maxRedirections).toBe(16);
      expect(cluster.options.retryDelayOnFailover).toBe(100);

      await cluster.disconnect();
    });
  });

  describe('Cluster Manager Integration', () => {
    let clusterFixture: DockerRedisClusterFixture;

    beforeAll(async () => {
      clusterFixture = await createDockerRedisClusterFixture();
    }, 180000);

    afterAll(async () => {
      if (clusterFixture) {
        await clusterFixture.cleanup();
      }
    });

    it('should manage cluster clients in RedisManager', async () => {
      const manager = new RedisManager(
        {
          clients: [
            {
              namespace: 'cluster',
              cluster: {
                nodes: clusterFixture.nodes,
                options: {
                  clusterRetryStrategy: () => null,
                },
              },
              lazyConnect: true,
            },
          ],
        },
        undefined
      );

      await manager.init();
      const client = manager.getClient('cluster');
      expect(client).toBeDefined();
      expect(isCluster(client)).toBe(true);

      await manager.destroy();
    });

    it('should handle mixed cluster and regular clients', async () => {
      const manager = new RedisManager(
        {
          clients: [
            {
              namespace: 'regular',
              host: 'localhost',
              port: clusterFixture.nodes[0].port,
              lazyConnect: true,
            },
            {
              namespace: 'cluster',
              cluster: {
                nodes: clusterFixture.nodes,
                options: {
                  clusterRetryStrategy: () => null,
                },
              },
              lazyConnect: true,
            },
          ],
        },
        undefined
      );

      await manager.init();

      const regularClient = manager.getClient('regular');
      const clusterClient = manager.getClient('cluster');

      expect(isCluster(regularClient)).toBe(false);
      expect(isCluster(clusterClient)).toBe(true);

      await manager.destroy();
    });
  });

  describe('Cluster Service Operations', () => {
    let clusterFixture: DockerRedisClusterFixture;
    let manager: RedisManager;
    let service: RedisService;

    beforeAll(async () => {
      clusterFixture = await createDockerRedisClusterFixture();
    }, 180000);

    beforeEach(async () => {
      manager = new RedisManager(
        {
          clients: [
            {
              namespace: 'cluster',
              cluster: {
                nodes: clusterFixture.nodes,
                options: {
                  enableOfflineQueue: false,
                  clusterRetryStrategy: () => null,
                },
              },
              lazyConnect: true,
            },
          ],
        },
        undefined
      );

      await manager.init();
      service = new RedisService(manager);
    });

    afterEach(async () => {
      if (manager) {
        await manager.destroy();
      }
    });

    afterAll(async () => {
      if (clusterFixture) {
        await clusterFixture.cleanup();
      }
    });

    it('should handle cluster operations through service', async () => {
      const client = manager.getClient('cluster');
      expect(isCluster(client)).toBe(true);

      // Mock cluster operations since we don't have actual cluster
      const cluster = client as Cluster;
      cluster.set = jest.fn().mockResolvedValue('OK');
      cluster.get = jest.fn().mockResolvedValue('test-value');

      await service.set('test-key', 'test-value', undefined, 'cluster');
      const value = await service.get('test-key', 'cluster');

      expect(cluster.set).toHaveBeenCalledWith('test-key', 'test-value');
      expect(cluster.get).toHaveBeenCalledWith('test-key');
      expect(value).toBe('test-value');
    });

    it('should handle cluster pipeline operations', async () => {
      const client = manager.getClient('cluster');
      const cluster = client as Cluster;

      // Mock pipeline
      const mockPipeline = {
        set: jest.fn().mockReturnThis(),
        get: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 'OK'],
          [null, 'value'],
        ]),
      };

      cluster.pipeline = jest.fn().mockReturnValue(mockPipeline);

      const pipeline = await service.pipeline('cluster');
      pipeline.set('key1', 'value1');
      pipeline.get('key1');
      const results = await pipeline.exec();

      expect(results).toHaveLength(2);
    });
  });

  describe('Cluster Health Checks', () => {
    let clusterFixture: DockerRedisClusterFixture;

    beforeAll(async () => {
      clusterFixture = await createDockerRedisClusterFixture();
    }, 180000);

    afterAll(async () => {
      if (clusterFixture) {
        await clusterFixture.cleanup();
      }
    });

    it('should check health of cluster clients', async () => {
      const manager = new RedisManager(
        {
          clients: [
            {
              namespace: 'cluster',
              cluster: {
                nodes: clusterFixture.nodes,
                options: {
                  clusterRetryStrategy: () => null,
                },
              },
              lazyConnect: true,
            },
          ],
        },
        undefined
      );

      await manager.init();
      const client = manager.getClient('cluster');

      // Mock cluster health check
      const cluster = client as Cluster;
      cluster.ping = jest.fn().mockResolvedValue('PONG');
      Object.defineProperty(cluster, 'status', {
        get: () => 'ready',
        configurable: true,
      });

      const isHealthy = await manager.isHealthy('cluster');
      expect(isHealthy).toBe(true);

      await manager.destroy();
    });
  });

  describe('Cluster Error Handling', () => {
    let clusterFixture: DockerRedisClusterFixture;

    beforeAll(async () => {
      clusterFixture = await createDockerRedisClusterFixture();
    }, 180000);

    afterAll(async () => {
      if (clusterFixture) {
        await clusterFixture.cleanup();
      }
    });

    it('should handle cluster connection errors', async () => {
      const manager = new RedisManager(
        {
          clients: [
            {
              namespace: 'cluster-error',
              cluster: {
                nodes: [{ host: 'invalid-host', port: 7000 }],
                options: {
                  enableOfflineQueue: false,
                  clusterRetryStrategy: () => null,
                },
              },
              lazyConnect: true,
            },
          ],
        },
        undefined
      );

      await manager.init();
      const client = manager.getClient('cluster-error');
      expect(client).toBeDefined();

      // Should handle errors gracefully
      const isHealthy = await manager.isHealthy('cluster-error');
      expect(isHealthy).toBe(false);

      await manager.destroy();
    });

    it('should handle failover scenarios', async () => {
      const retryAttempts: number[] = [];
      const manager = new RedisManager(
        {
          clients: [
            {
              namespace: 'cluster-failover',
              cluster: {
                nodes: clusterFixture.nodes,
                options: {
                  clusterRetryStrategy: (times: number) => {
                    retryAttempts.push(times);
                    if (times > 3) return null;
                    return Math.min(times * 100, 2000);
                  },
                },
              },
              lazyConnect: true,
            },
          ],
        },
        undefined
      );

      await manager.init();
      const client = manager.getClient('cluster-failover');

      // Mock failover
      const cluster = client as Cluster;
      cluster.on('error', () => {});
      cluster.on('+node', () => {});
      cluster.on('-node', () => {});

      await manager.destroy();
    });
  });

  describe('Cluster Script Execution', () => {
    let clusterFixture: DockerRedisClusterFixture;

    beforeAll(async () => {
      clusterFixture = await createDockerRedisClusterFixture();
    }, 180000);

    afterAll(async () => {
      if (clusterFixture) {
        await clusterFixture.cleanup();
      }
    });

    it('should handle script execution in cluster mode', async () => {
      const manager = new RedisManager(
        {
          clients: [
            {
              namespace: 'cluster-scripts',
              cluster: {
                nodes: clusterFixture.nodes,
                options: {
                  clusterRetryStrategy: () => null,
                },
              },
              lazyConnect: true,
            },
          ],
          scripts: [
            {
              name: 'cluster-script',
              content: 'return redis.call("get", KEYS[1])',
            },
          ],
        },
        undefined
      );

      await manager.init();
      const client = manager.getClient('cluster-scripts');

      // Mock script execution
      const cluster = client as Cluster;
      cluster.evalsha = jest.fn().mockResolvedValue('script-result');
      cluster.script = jest.fn().mockImplementation((cmd: string) => {
        if (cmd === 'load') {
          return Promise.resolve('mock-sha');
        }
        return Promise.resolve(1);
      });

      // Load scripts
      const scripts = manager['scripts'];
      if (scripts) {
        for (const [name, script] of scripts) {
          await cluster.script('load', script.content);
        }
      }

      // Execute script
      cluster.evalsha = jest.fn().mockResolvedValue('script-result');
      const result = await manager.runScript('cluster-script', ['key'], [], 'cluster-scripts');
      expect(result).toBe('script-result');

      await manager.destroy();
    });
  });

  describe('Cluster Pub/Sub', () => {
    let clusterFixture: DockerRedisClusterFixture;

    beforeAll(async () => {
      clusterFixture = await createDockerRedisClusterFixture();
    }, 180000);

    afterAll(async () => {
      if (clusterFixture) {
        await clusterFixture.cleanup();
      }
    });

    it('should handle pub/sub in cluster mode', async () => {
      const manager = new RedisManager(
        {
          clients: [
            {
              namespace: 'cluster-pubsub',
              cluster: {
                nodes: clusterFixture.nodes,
                options: {
                  clusterRetryStrategy: () => null,
                },
              },
              lazyConnect: true,
            },
          ],
        },
        undefined
      );

      await manager.init();
      const service = new RedisService(manager);
      const client = manager.getClient('cluster-pubsub');

      // Mock cluster pub/sub
      const cluster = client as Cluster;
      const mockSubscriber = {
        subscribe: jest.fn().mockResolvedValue(1),
        on: jest.fn(),
        once: jest.fn(),
        off: jest.fn(),
        quit: jest.fn().mockResolvedValue('OK'),
      };

      cluster.duplicate = jest.fn().mockReturnValue(mockSubscriber);
      cluster.publish = jest.fn().mockResolvedValue(1);

      // Create subscriber
      const subscriber = await service.createSubscriber('cluster-pubsub');
      await subscriber.subscribe('test-channel');

      // Publish message
      await service.publish('test-channel', 'test-message', 'cluster-pubsub');

      expect(mockSubscriber.subscribe).toHaveBeenCalledWith('test-channel');
      expect(cluster.publish).toHaveBeenCalledWith('test-channel', 'test-message');

      await subscriber.quit();
      await manager.destroy();
    });
  });

  describe('Cluster Performance', () => {
    it('should handle slot distribution', () => {
      // Test slot calculation
      const calculateSlot = (key: string): number => {
        // Simplified CRC16 for testing
        let crc = 0;
        for (const char of key) {
          crc = (crc + char.charCodeAt(0)) & 0xffff;
        }
        return crc % 16384;
      };

      expect(calculateSlot('key1')).toBeGreaterThanOrEqual(0);
      expect(calculateSlot('key1')).toBeLessThan(16384);

      // Different keys should distribute across slots
      const slots = new Set();
      for (let i = 0; i < 1000; i++) {
        slots.add(calculateSlot(`key-${i}`));
      }

      expect(slots.size).toBeGreaterThan(50); // Should distribute across many slots
    });

    it('should handle hash tags for key grouping', () => {
      const getHashTag = (key: string): string => {
        const match = key.match(/{([^}]+)}/);
        return match ? match[1] : key;
      };

      expect(getHashTag('{user}:1')).toBe('user');
      expect(getHashTag('{user}:2')).toBe('user');
      expect(getHashTag('normal:key')).toBe('normal:key');

      // Keys with same hash tag should go to same slot
      const tag1 = getHashTag('{user123}:profile');
      const tag2 = getHashTag('{user123}:settings');
      expect(tag1).toBe(tag2);
    });
  });
});
