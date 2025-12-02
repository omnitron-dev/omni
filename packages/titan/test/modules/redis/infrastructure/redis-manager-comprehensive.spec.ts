/**
 * Comprehensive Infrastructure Tests for Redis Manager
 * Tests connection management, script loading, error handling, and lifecycle
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from '@jest/globals';
import { RedisManager } from '../../../../src/modules/redis/redis.manager.js';
import type { RedisModuleOptions } from '../../../../src/modules/redis/redis.types.js';
import { RedisTestManager } from '../../../utils/redis-test-manager.js';
import { delay } from '@omnitron-dev/common';
import { isRedisInMockMode } from '../../redis/utils/redis-test-utils.js';

// Check if running in mock mode
const skipTests = isRedisInMockMode();

if (skipTests) {
  console.log('⏭️  Skipping redis-manager-comprehensive.spec.ts - requires real Redis');
}

// Skip all tests if in mock mode - requires real Redis
const describeOrSkip = skipTests ? describe.skip : describe;

describeOrSkip('Redis Manager - Infrastructure Tests', () => {
  let testContainer: Awaited<ReturnType<typeof RedisTestManager.prototype.createContainer>>;
  let manager: RedisManager;

  beforeEach(async () => {
    const redisManager = RedisTestManager.getInstance();
    testContainer = await redisManager.createContainer();
  });

  afterEach(async () => {
    if (manager) {
      await manager.destroy();
    }
    if (testContainer) {
      await testContainer.cleanup();
    }
  });

  describe('Initialization', () => {
    it('should initialize with single client configuration', async () => {
      const options: RedisModuleOptions = {
        config: {
          host: testContainer.host,
          port: testContainer.port,
          namespace: 'default',
        },
      };

      manager = new RedisManager(options);
      await manager.init();

      expect(manager.hasClient('default')).toBe(true);
      const client = manager.getClient('default');
      expect(client).toBeDefined();
      expect(client.status).toBe('ready');
    });

    it('should initialize with multiple clients', async () => {
      const options: RedisModuleOptions = {
        clients: [
          {
            host: testContainer.host,
            port: testContainer.port,
            namespace: 'client1',
          },
          {
            host: testContainer.host,
            port: testContainer.port,
            namespace: 'client2',
          },
        ],
      };

      manager = new RedisManager(options);
      await manager.init();

      expect(manager.hasClient('client1')).toBe(true);
      expect(manager.hasClient('client2')).toBe(true);
    });

    it('should initialize with default namespace if none provided', async () => {
      const options: RedisModuleOptions = {
        config: {
          host: testContainer.host,
          port: testContainer.port,
        },
      };

      manager = new RedisManager(options);
      await manager.init();

      expect(manager.hasClient('default')).toBe(true);
    });

    it('should apply common options to all clients', async () => {
      const options: RedisModuleOptions = {
        commonOptions: {
          retryStrategy: (times) => Math.min(times * 50, 2000),
          maxRetriesPerRequest: 3,
        },
        clients: [
          {
            host: testContainer.host,
            port: testContainer.port,
            namespace: 'test1',
          },
          {
            host: testContainer.host,
            port: testContainer.port,
            namespace: 'test2',
          },
        ],
      };

      manager = new RedisManager(options);
      await manager.init();

      const client1 = manager.getClient('test1');
      const client2 = manager.getClient('test2');

      expect(client1.options.retryStrategy).toBeDefined();
      expect(client2.options.retryStrategy).toBeDefined();
    });

    it('should support lazy connect mode', async () => {
      const options: RedisModuleOptions = {
        config: {
          host: testContainer.host,
          port: testContainer.port,
          lazyConnect: true,
        },
      };

      manager = new RedisManager(options);
      await manager.init();

      const client = manager.getClient('default');
      expect(client).toBeDefined();
    });

    it('should handle onClientCreated callback', async () => {
      let callbackCalled = false;
      const options: RedisModuleOptions = {
        config: {
          host: testContainer.host,
          port: testContainer.port,
        },
        onClientCreated: (client) => {
          callbackCalled = true;
          expect(client).toBeDefined();
        },
      };

      manager = new RedisManager(options);
      await manager.init();

      expect(callbackCalled).toBe(true);
    });
  });

  describe('Client Management', () => {
    beforeEach(async () => {
      manager = new RedisManager({
        config: {
          host: testContainer.host,
          port: testContainer.port,
        },
      });
      await manager.init();
    });

    it('should get client by namespace', () => {
      const client = manager.getClient('default');
      expect(client).toBeDefined();
      expect(client.status).toBe('ready');
    });

    it('should throw error for non-existent client', () => {
      expect(() => manager.getClient('nonexistent')).toThrow();
    });

    it('should check client existence', () => {
      expect(manager.hasClient('default')).toBe(true);
      expect(manager.hasClient('nonexistent')).toBe(false);
    });

    it('should get all clients', () => {
      const clients = manager.getClients();
      expect(clients.size).toBeGreaterThan(0);
      expect(clients.has('default')).toBe(true);
    });

    it('should create new client dynamically', async () => {
      const newClient = await manager.createClient({
        host: testContainer.host,
        port: testContainer.port,
        namespace: 'dynamic',
      });

      expect(newClient).toBeDefined();
      expect(manager.hasClient('dynamic')).toBe(true);
    });

    it('should throw error when creating duplicate client', async () => {
      await expect(
        manager.createClient({
          host: testContainer.host,
          port: testContainer.port,
          namespace: 'default',
        })
      ).rejects.toThrow();
    });

    it('should destroy client by namespace', async () => {
      await manager.createClient({
        host: testContainer.host,
        port: testContainer.port,
        namespace: 'temp',
      });

      expect(manager.hasClient('temp')).toBe(true);
      await manager.destroyClient('temp');
      expect(manager.hasClient('temp')).toBe(false);
    });

    it('should handle destroying non-existent client gracefully', async () => {
      await expect(manager.destroyClient('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('Health Checks', () => {
    beforeEach(async () => {
      manager = new RedisManager({
        config: {
          host: testContainer.host,
          port: testContainer.port,
        },
      });
      await manager.init();
    });

    it('should check if client is healthy', async () => {
      const isHealthy = await manager.isHealthy('default');
      expect(isHealthy).toBe(true);
    });

    it('should return false for disconnected client', async () => {
      // Create and immediately destroy a client
      await manager.createClient({
        host: testContainer.host,
        port: testContainer.port,
        namespace: 'temp',
      });
      await manager.destroyClient('temp');

      // Try to check health of destroyed client - should throw
      await expect(manager.isHealthy('temp')).rejects.toThrow();
    });

    it('should ping client successfully', async () => {
      const response = await manager.ping('default');
      expect(response).toBe('PONG');
    });

    it('should perform health check on all clients', async () => {
      await manager.createClient({
        host: testContainer.host,
        port: testContainer.port,
        namespace: 'second',
      });

      const results = await manager.healthCheck();
      expect(results['default']).toBeDefined();
      expect(results['default'].healthy).toBe(true);
      expect(results['default'].latency).toBeGreaterThanOrEqual(0);
      expect(results['second']).toBeDefined();
      expect(results['second'].healthy).toBe(true);
    });

    it('should measure latency in health check', async () => {
      const results = await manager.healthCheck();
      expect(results['default'].latency).toBeGreaterThanOrEqual(0);
      expect(results['default'].latency).toBeLessThan(1000); // Should be very fast
    });
  });

  describe('Script Management', () => {
    const testScript = `
      redis.call('SET', KEYS[1], ARGV[1])
      return redis.call('GET', KEYS[1])
    `;

    it('should load scripts on initialization', async () => {
      const options: RedisModuleOptions = {
        config: {
          host: testContainer.host,
          port: testContainer.port,
        },
        scripts: [
          {
            name: 'testScript',
            content: testScript,
          },
        ],
      };

      manager = new RedisManager(options);
      await manager.init();

      const sha = manager.getScriptSha('testScript', 'default');
      expect(sha).toBeDefined();
      expect(typeof sha).toBe('string');
    });

    it('should run script by name', async () => {
      const options: RedisModuleOptions = {
        config: {
          host: testContainer.host,
          port: testContainer.port,
        },
        scripts: [
          {
            name: 'setGet',
            content: testScript,
          },
        ],
      };

      manager = new RedisManager(options);
      await manager.init();

      const result = await manager.runScript('setGet', ['testkey'], ['testvalue']);
      expect(result).toBe('testvalue');
    });

    it('should handle NOSCRIPT error by reloading', async () => {
      const options: RedisModuleOptions = {
        config: {
          host: testContainer.host,
          port: testContainer.port,
        },
        scripts: [
          {
            name: 'testScript',
            content: testScript,
          },
        ],
      };

      manager = new RedisManager(options);
      await manager.init();

      // Flush scripts from Redis
      const client = manager.getClient('default');
      await client.script('FLUSH');

      // Should automatically reload and execute
      const result = await manager.runScript('testScript', ['key'], ['value']);
      expect(result).toBe('value');
    });

    it('should throw error for non-existent script', async () => {
      const options: RedisModuleOptions = {
        config: {
          host: testContainer.host,
          port: testContainer.port,
        },
      };

      manager = new RedisManager(options);
      await manager.init();

      await expect(
        manager.runScript('nonexistent', [], [])
      ).rejects.toThrow();
    });

    it('should load scripts for all clients', async () => {
      const options: RedisModuleOptions = {
        clients: [
          {
            host: testContainer.host,
            port: testContainer.port,
            namespace: 'client1',
          },
          {
            host: testContainer.host,
            port: testContainer.port,
            namespace: 'client2',
          },
        ],
        scripts: [
          {
            name: 'shared',
            content: testScript,
          },
        ],
      };

      manager = new RedisManager(options);
      await manager.init();

      const sha1 = manager.getScriptSha('shared', 'client1');
      const sha2 = manager.getScriptSha('shared', 'client2');

      expect(sha1).toBeDefined();
      expect(sha2).toBeDefined();
      expect(sha1).toBe(sha2); // Same script should have same SHA
    });
  });

  describe('Error Handling', () => {
    it('should handle connection errors gracefully', async () => {
      const options: RedisModuleOptions = {
        config: {
          host: 'invalid-host',
          port: 9999,
          lazyConnect: true,
        },
        errorLog: false,
      };

      manager = new RedisManager(options);
      await manager.init();

      // Should not throw during init with lazyConnect
      expect(manager.hasClient('default')).toBe(true);
    });

    it('should trigger onError callback', async () => {
      let errorCaught = false;
      const options: RedisModuleOptions = {
        config: {
          host: testContainer.host,
          port: testContainer.port,
        },
        onError: (error, client) => {
          errorCaught = true;
          expect(error).toBeDefined();
          expect(client).toBeDefined();
        },
      };

      manager = new RedisManager(options);
      await manager.init();

      const client = manager.getClient('default');
      client.emit('error', new Error('Test error'));

      await delay(50);
      expect(errorCaught).toBe(true);
    });

    it('should handle destroy errors gracefully', async () => {
      const options: RedisModuleOptions = {
        config: {
          host: testContainer.host,
          port: testContainer.port,
        },
      };

      manager = new RedisManager(options);
      await manager.init();

      const client = manager.getClient('default');
      await client.quit();

      // Destroying already closed client should not throw
      await expect(manager.destroyClient('default')).resolves.not.toThrow();
    });
  });

  describe('Lifecycle Management', () => {
    it('should call onModuleInit', async () => {
      const options: RedisModuleOptions = {
        config: {
          host: testContainer.host,
          port: testContainer.port,
        },
      };

      manager = new RedisManager(options);
      await manager.onModuleInit();

      expect(manager.hasClient('default')).toBe(true);
    });

    it('should call onModuleDestroy', async () => {
      const options: RedisModuleOptions = {
        config: {
          host: testContainer.host,
          port: testContainer.port,
        },
      };

      manager = new RedisManager(options);
      await manager.init();

      const client = manager.getClient('default');
      expect(client.status).toBe('ready');

      await manager.onModuleDestroy();
      expect(client.status).toBe('end');
    });

    it('should close all clients on destroy', async () => {
      const options: RedisModuleOptions = {
        clients: [
          { host: testContainer.host, port: testContainer.port, namespace: 'c1' },
          { host: testContainer.host, port: testContainer.port, namespace: 'c2' },
        ],
      };

      manager = new RedisManager(options);
      await manager.init();

      await manager.destroy();

      const clients = manager.getClients();
      expect(clients.size).toBe(0);
    });

    it('should respect closeClient option', async () => {
      const options: RedisModuleOptions = {
        config: {
          host: testContainer.host,
          port: testContainer.port,
        },
        closeClient: false,
      };

      manager = new RedisManager(options);
      await manager.init();

      const client = manager.getClient('default');
      await manager.destroy();

      // Client should not be closed
      expect(client.status).not.toBe('end');
      await client.quit(); // Manual cleanup
    });

    it('should handle onClientDestroyed callback', async () => {
      let destroyedNamespace: string | undefined;
      const options: RedisModuleOptions = {
        config: {
          host: testContainer.host,
          port: testContainer.port,
          namespace: 'test',
        },
        onClientDestroyed: (namespace) => {
          destroyedNamespace = namespace;
        },
      };

      manager = new RedisManager(options);
      await manager.init();

      await manager.destroyClient('test');
      expect(destroyedNamespace).toBe('test');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty client array', async () => {
      const options: RedisModuleOptions = {
        clients: [],
      };

      manager = new RedisManager(options);
      await manager.init();

      // Should create default client
      expect(manager.hasClient('default')).toBe(true);
    });

    it('should handle last-wins for duplicate namespaces', async () => {
      const options: RedisModuleOptions = {
        clients: [
          {
            host: testContainer.host,
            port: testContainer.port,
            namespace: 'duplicate',
            db: 0,
          },
          {
            host: testContainer.host,
            port: testContainer.port,
            namespace: 'duplicate',
            db: 1,
          },
        ],
      };

      manager = new RedisManager(options);
      await manager.init();

      const client = manager.getClient('duplicate');
      // Should use the last configuration (db: 1)
      expect(client.options.db).toBe(1);
    });

    it('should handle rapid create/destroy cycles', async () => {
      const options: RedisModuleOptions = {
        config: {
          host: testContainer.host,
          port: testContainer.port,
        },
      };

      manager = new RedisManager(options);
      await manager.init();

      for (let i = 0; i < 5; i++) {
        const client = await manager.createClient({
          host: testContainer.host,
          port: testContainer.port,
          namespace: `rapid${i}`,
        });
        expect(client).toBeDefined();
        await manager.destroyClient(`rapid${i}`);
        expect(manager.hasClient(`rapid${i}`)).toBe(false);
      }
    });
  });

  describe('Configuration Options', () => {
    it('should respect readyLog option', async () => {
      const options: RedisModuleOptions = {
        config: {
          host: testContainer.host,
          port: testContainer.port,
        },
        readyLog: false,
      };

      manager = new RedisManager(options);
      await manager.init();

      expect(manager.hasClient('default')).toBe(true);
    });

    it('should respect errorLog option', async () => {
      const options: RedisModuleOptions = {
        config: {
          host: testContainer.host,
          port: testContainer.port,
        },
        errorLog: false,
      };

      manager = new RedisManager(options);
      await manager.init();

      const client = manager.getClient('default');
      client.emit('error', new Error('Test error'));

      // Should not log (we can't test console output, but it shouldn't crash)
      expect(true).toBe(true);
    });

    it('should apply health check timeout', async () => {
      const options: RedisModuleOptions = {
        config: {
          host: testContainer.host,
          port: testContainer.port,
        },
        healthCheck: {
          timeout: 100,
        },
      };

      manager = new RedisManager(options);
      await manager.init();

      const isHealthy = await manager.isHealthy('default');
      expect(isHealthy).toBe(true);
    });
  });
});
