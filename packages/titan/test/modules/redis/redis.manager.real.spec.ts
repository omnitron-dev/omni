import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { RedisManager } from '../../../src/modules/redis/redis.manager';
import { RedisModuleOptions } from '../../../src/modules/redis/redis.types';
import {
  createRedisTestHelper,
  RedisTestHelper
} from '../../utils/redis-test-utils';

describe('RedisManager with Real Redis', () => {
  let manager: RedisManager;
  let helper: RedisTestHelper;

  beforeEach(async () => {
    helper = createRedisTestHelper();
    await helper.waitForRedis();
  });

  afterEach(async () => {
    if (manager) {
      await manager.destroy();
    }
    await helper.cleanup();
  });

  describe('Client Management', () => {
    it('should create and manage single client', async () => {
      const options: RedisModuleOptions = {
        clients: [{
          namespace: 'default',
          host: 'localhost',
          port: 6379,
          db: 15,
        }],
      };

      manager = new RedisManager(options, null as any);
      await manager.init();

      const client = manager.getClient();
      expect(client).toBeDefined();

      // Test client is working
      await client.set('test-key', 'test-value');
      const value = await client.get('test-key');
      expect(value).toBe('test-value');
    });

    it('should create and manage multiple clients', async () => {
      const options: RedisModuleOptions = {
        clients: [
          {
            namespace: 'default',
            host: 'localhost',
            port: 6379,
            db: 15,
          },
          {
            namespace: 'cache',
            host: 'localhost',
            port: 6379,
            db: 14,
          },
          {
            namespace: 'pubsub',
            host: 'localhost',
            port: 6379,
            db: 13,
          },
        ],
      };

      manager = new RedisManager(options, null as any);
      await manager.init();

      // Check all clients are created
      const defaultClient = manager.getClient('default');
      const cacheClient = manager.getClient('cache');
      const pubsubClient = manager.getClient('pubsub');

      expect(defaultClient).toBeDefined();
      expect(cacheClient).toBeDefined();
      expect(pubsubClient).toBeDefined();

      // Test isolation between clients
      await defaultClient.set('key', 'default-value');
      await cacheClient.set('key', 'cache-value');
      await pubsubClient.set('key', 'pubsub-value');

      expect(await defaultClient.get('key')).toBe('default-value');
      expect(await cacheClient.get('key')).toBe('cache-value');
      expect(await pubsubClient.get('key')).toBe('pubsub-value');
    });

    it('should dynamically create new clients', async () => {
      const options: RedisModuleOptions = {
        clients: [{
          namespace: 'default',
          host: 'localhost',
          port: 6379,
          db: 15,
        }],
      };

      manager = new RedisManager(options, null as any);
      await manager.init();

      // Create new client dynamically
      const dynamicClient = await manager.createClient({
        namespace: 'dynamic',
        host: 'localhost',
        port: 6379,
        db: 12,
      });

      expect(dynamicClient).toBeDefined();
      expect(manager.getClient('dynamic')).toBe(dynamicClient);

      // Test new client works
      await dynamicClient.set('dynamic-key', 'dynamic-value');
      expect(await dynamicClient.get('dynamic-key')).toBe('dynamic-value');
    });

    it('should destroy specific client', async () => {
      const options: RedisModuleOptions = {
        clients: [
          {
            namespace: 'default',
            host: 'localhost',
            port: 6379,
            db: 15,
          },
          {
            namespace: 'temp',
            host: 'localhost',
            port: 6379,
            db: 14,
          },
        ],
      };

      manager = new RedisManager(options, null as any);
      await manager.init();

      // Destroy specific client
      await manager.destroyClient('temp');

      // Check client is removed
      expect(() => manager.getClient('temp')).toThrow();

      // Default client should still work
      const defaultClient = manager.getClient('default');
      await defaultClient.set('test', 'value');
      expect(await defaultClient.get('test')).toBe('value');
    });
  });

  describe('Health Checks', () => {
    it('should check health of all clients', async () => {
      const options: RedisModuleOptions = {
        clients: [
          {
            namespace: 'default',
            host: 'localhost',
            port: 6379,
            db: 15,
          },
          {
            namespace: 'cache',
            host: 'localhost',
            port: 6379,
            db: 14,
          },
        ],
      };

      manager = new RedisManager(options, null as any);
      await manager.init();

      const health = await manager.healthCheck();

      expect(health).toHaveProperty('default');
      expect(health).toHaveProperty('cache');
      expect(health.default.healthy).toBe(true);
      expect(health.cache.healthy).toBe(true);
      expect(health.default.latency).toBeGreaterThanOrEqual(0);
      expect(health.cache.latency).toBeGreaterThanOrEqual(0);
    });

    it('should report unhealthy client', async () => {
      const options: RedisModuleOptions = {
        clients: [
          {
            namespace: 'default',
            host: 'localhost',
            port: 6379,
            db: 15,
          },
          {
            namespace: 'broken',
            host: 'invalid-host',
            port: 6379,
            retryStrategy: () => null,
          },
        ],
      };

      manager = new RedisManager(options, null as any);

      // Don't wait for init to complete - broken client won't connect
      manager.init().catch(() => {}); // Ignore error

      // Give it a moment
      await new Promise(resolve => setTimeout(resolve, 100));

      const health = await manager.healthCheck();

      expect(health.default.healthy).toBe(true);
      // Broken client will be undefined or unhealthy
      if (health.broken) {
        expect(health.broken.healthy).toBe(false);
      }
    });
  });

  describe('Script Management', () => {
    it('should load and execute Lua scripts', async () => {
      const options: RedisModuleOptions = {
        clients: [{
          namespace: 'default',
          host: 'localhost',
          port: 6379,
          db: 15,
        }],
        scripts: [
          {
            name: 'increment',
            content: 'return redis.call("incrby", KEYS[1], ARGV[1])',
          },
          {
            name: 'getAndSet',
            content: `
              local old = redis.call("get", KEYS[1])
              redis.call("set", KEYS[1], ARGV[1])
              return old
            `,
          },
        ],
      };

      manager = new RedisManager(options, null as any);
      await manager.init();

      // Execute increment script
      const client = manager.getClient();
      const testId = Date.now();
      const counterKey = `counter-${testId}`;
      const testKey = `mykey-${testId}`;

      await client.set(counterKey, '10');
      const result1 = await manager.runScript('increment', [counterKey], ['5']);
      expect(result1).toBe(15);

      // Execute getAndSet script
      const result2 = await manager.runScript('getAndSet', [testKey], ['newvalue']);
      expect(result2).toBe(null); // First time returns null

      const result3 = await manager.runScript('getAndSet', [testKey], ['newervalue']);
      expect(result3).toBe('newvalue');

      expect(await client.get(testKey)).toBe('newervalue');
    });

    it('should handle script errors', async () => {
      const options: RedisModuleOptions = {
        clients: [{
          namespace: 'default',
          host: 'localhost',
          port: 6379,
          db: 15,
        }],
        scripts: [
          {
            name: 'bad-script',
            content: 'invalid lua code',
          },
        ],
      };

      manager = new RedisManager(options, null as any);

      // Should throw error during init due to invalid script
      await expect(manager.init()).rejects.toThrow();
    });
  });

  describe('Lifecycle Management', () => {
    it('should handle init and destroy lifecycle', async () => {
      const options: RedisModuleOptions = {
        clients: [{
          namespace: 'default',
          host: 'localhost',
          port: 6379,
          db: 15,
        }],
      };

      manager = new RedisManager(options, null as any);

      // Before init, client should not exist
      expect(() => manager.getClient()).toThrow();

      // Init
      await manager.init();

      // After init, client should work
      const client = manager.getClient();
      await client.set('test', 'value');
      expect(await client.get('test')).toBe('value');

      // Destroy
      await manager.destroy();

      // After destroy, client operations should fail
      await expect(client.get('test')).rejects.toThrow();
    });

    it('should handle onModuleInit and onModuleDestroy hooks', async () => {
      const options: RedisModuleOptions = {
        clients: [{
          namespace: 'default',
          host: 'localhost',
          port: 6379,
          db: 15,
        }],
      };

      manager = new RedisManager(options, null as any);

      // Test NestJS-style lifecycle hooks
      await manager.onModuleInit();

      const client = manager.getClient();
      await client.set('hook-test', 'value');
      expect(await client.get('hook-test')).toBe('value');

      await manager.onModuleDestroy();

      // Client should be disconnected
      await expect(client.get('hook-test')).rejects.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle connection errors gracefully', async () => {
      const options: RedisModuleOptions = {
        clients: [{
          namespace: 'fail',
          host: 'invalid-host',
          port: 6379,
          retryStrategy: () => null,
        }],
      };

      manager = new RedisManager(options, null as any);

      // Init should not throw but client won't be healthy
      await manager.init().catch(() => {}); // Catch init error

      const health = await manager.isHealthy('fail');
      expect(health).toBe(false);
    });

    it('should throw when accessing non-existent client', async () => {
      const options: RedisModuleOptions = {
        clients: [{
          namespace: 'default',
          host: 'localhost',
          port: 6379,
          db: 15,
        }],
      };

      manager = new RedisManager(options, null as any);
      await manager.init();

      expect(() => manager.getClient('non-existent')).toThrow(
        'Redis client with namespace "non-existent" not found'
      );
    });

    it('should handle duplicate namespaces', async () => {
      const options: RedisModuleOptions = {
        clients: [
          {
            namespace: 'duplicate',
            host: 'localhost',
            port: 6379,
            db: 15,
          },
          {
            namespace: 'duplicate',
            host: 'localhost',
            port: 6379,
            db: 14,
          },
        ],
      };

      manager = new RedisManager(options, null as any);
      await manager.init();

      // Should only have one client with the namespace (last one wins)
      const client = manager.getClient('duplicate');
      expect(client).toBeDefined();

      // Verify it's using the second database (db: 14)
      await client.set('duplicate-test', 'value');

      // Create a client directly to db 15 to check it's not there
      const db15Client = helper.createClient('check-db15', 15);
      const valueInDb15 = await db15Client.get('duplicate-test');
      expect(valueInDb15).toBeNull();

      // Clean up test key
      await client.del('duplicate-test');
    });
  });

  describe('Performance', () => {
    it('should handle concurrent operations efficiently', async () => {
      const options: RedisModuleOptions = {
        clients: [{
          namespace: 'default',
          host: 'localhost',
          port: 6379,
          db: 15,
        }],
      };

      manager = new RedisManager(options, null as any);
      await manager.init();

      const client = manager.getClient();
      const operations = [];

      // Execute 1000 operations concurrently
      for (let i = 0; i < 1000; i++) {
        operations.push(
          client.set(`key-${i}`, `value-${i}`).then(() =>
            client.get(`key-${i}`)
          )
        );
      }

      const start = Date.now();
      const results = await Promise.all(operations);
      const duration = Date.now() - start;

      // All operations should complete
      expect(results).toHaveLength(1000);
      expect(results[500]).toBe('value-500');

      // Should be reasonably fast (< 5 seconds for 1000 ops)
      expect(duration).toBeLessThan(5000);
    });
  });
});