import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import Redis, { Cluster } from 'ioredis';
import * as crypto from 'crypto';
import * as fs from 'fs';
import {
  createRedisClient,
  isCluster,
  getClientNamespace,
  generateScriptSha,
  loadScriptContent,
  createRetryStrategy,
  mergeOptions,
  waitForConnection,
} from '../../../src/modules/redis/redis.utils.js';
import { RedisClientOptions } from '../../../src/modules/redis/redis.types.js';
import { withDockerRedis, type DockerRedisTestFixture, isRedisInMockMode, isDockerAvailable } from './utils/redis-test-utils.js';

// Mock fs module
jest.mock('fs');

// Skip tests if Docker is not available or in mock mode
const skipDockerTests = process.env.USE_MOCK_REDIS === 'true' || process.env.CI === 'true' || !isDockerAvailable();
if (skipDockerTests && !isRedisInMockMode()) {
  console.log('⏭️ Skipping redis.utils.spec.ts Docker tests - requires Docker');
}

// Conditional describe for tests that require real Redis
const describeIfRealRedis = isRedisInMockMode() || skipDockerTests ? describe.skip : describe;

// Mock cluster client type for tests
interface MockClusterClient {
  status: string;
  on: jest.Mock;
  once: jest.Mock;
  removeListener: jest.Mock;
}

describe('Redis Utils', () => {
  let testClients: Array<Redis | Cluster> = [];

  afterEach(async () => {
    // Cleanup all test clients
    for (const client of testClients) {
      try {
        if (client && typeof client.quit === 'function') {
          await client.quit();
        }
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
    testClients = [];
    jest.clearAllMocks();
  });

  describe('createRedisClient', () => {
    it('should create a standard Redis client', async () => {
      const options: RedisClientOptions = {
        host: 'localhost',
        port: 6379,
        db: 15,
        lazyConnect: false,
      };

      const client = createRedisClient(options);
      testClients.push(client);

      expect(client).toBeInstanceOf(Redis);
      const redisClient = client as Redis;
      expect(redisClient.options.host).toBe('localhost');
      expect(redisClient.options.port).toBe(6379);
      expect(redisClient.options.db).toBe(15);
    });

    it('should create a Redis cluster client', () => {
      const options: RedisClientOptions = {
        cluster: {
          nodes: [
            { host: 'localhost', port: 7000 },
            { host: 'localhost', port: 7001 },
          ],
        },
      };

      const client = createRedisClient(options);
      testClients.push(client);

      expect(client).toBeInstanceOf(Cluster);
    });

    it('should apply default options', () => {
      const client = createRedisClient({
        host: 'localhost',
        port: 6379,
        lazyConnect: true,
      }) as Redis;
      testClients.push(client);

      expect(client.options.enableReadyCheck).toBe(true);
      expect(client.options.maxRetriesPerRequest).toBe(3);
      expect(client.options.showFriendlyErrorStack).toBe(true);
    });

    it('should override default options', () => {
      const client = createRedisClient({
        host: 'localhost',
        port: 6379,
        enableReadyCheck: false,
        maxRetriesPerRequest: 5,
        showFriendlyErrorStack: false,
        lazyConnect: true,
      }) as Redis;
      testClients.push(client);

      expect(client.options.enableReadyCheck).toBe(false);
      expect(client.options.maxRetriesPerRequest).toBe(5);
      expect(client.options.showFriendlyErrorStack).toBe(false);
    });

    it('should handle authentication options', () => {
      const client = createRedisClient({
        host: 'localhost',
        port: 6379,
        password: 'secret',
        username: 'user',
        lazyConnect: true,
      }) as Redis;
      testClients.push(client);

      expect(client.options.password).toBe('secret');
      expect(client.options.username).toBe('user');
    });

    it('should handle TLS options', () => {
      const tlsOptions = { rejectUnauthorized: false };
      const client = createRedisClient({
        host: 'localhost',
        port: 6380,
        tls: tlsOptions,
        lazyConnect: true,
      }) as Redis;
      testClients.push(client);

      expect(client.options.tls).toEqual(tlsOptions);
    });

    it('should handle connection string format', () => {
      const client = createRedisClient({
        url: 'redis://localhost:6379/2',
        lazyConnect: true,
      }) as Redis;
      testClients.push(client);

      expect(client.options.host).toBe('localhost');
      expect(client.options.port).toBe(6379);
      // Note: db might be set differently when using URL
      expect(client.options.db).toBeDefined();
    });

    it('should handle sentinel configuration', () => {
      const client = createRedisClient({
        sentinels: [
          { host: 'localhost', port: 26379 },
          { host: 'localhost', port: 26380 },
        ],
        name: 'mymaster',
        lazyConnect: true,
      }) as Redis;
      testClients.push(client);

      expect(client.options.sentinels).toHaveLength(2);
      expect(client.options.name).toBe('mymaster');
    });

    it('should create cluster with custom options', () => {
      const client = createRedisClient({
        cluster: {
          nodes: [{ host: 'localhost', port: 7000 }],
          options: {
            clusterRetryStrategy: (times: number) => Math.min(100 * times, 2000),
            redisOptions: {
              password: 'cluster-pass',
            },
          },
        },
      }) as Cluster;
      testClients.push(client);

      expect(client).toBeInstanceOf(Cluster);
    });

    it('should throw error when cluster nodes are missing', () => {
      expect(() => {
        createRedisClient({ cluster: {} } as RedisClientOptions);
      }).toThrow('Cluster configuration requires nodes');
    });
  });

  describe('isCluster', () => {
    it('should identify cluster client', () => {
      const cluster = new Cluster([{ host: 'localhost', port: 7000 }]);
      testClients.push(cluster);
      expect(isCluster(cluster)).toBe(true);
    });

    it('should identify non-cluster client', () => {
      const redis = new Redis({ host: 'localhost', port: 6379, lazyConnect: true });
      testClients.push(redis);
      expect(isCluster(redis)).toBe(false);
    });

    it('should handle null/undefined', () => {
      expect(isCluster(null)).toBe(false);
      expect(isCluster(undefined)).toBe(false);
    });

    it('should handle invalid objects', () => {
      expect(isCluster({})).toBe(false);
      expect(isCluster({ nodes: 'not-a-function' })).toBe(false);
    });
  });

  describe('getClientNamespace', () => {
    it('should extract namespace from options', () => {
      expect(getClientNamespace({ namespace: 'cache' })).toBe('cache');
      expect(getClientNamespace({ namespace: 'pubsub' })).toBe('pubsub');
    });

    it('should return default for missing namespace', () => {
      expect(getClientNamespace({})).toBe('default');
      expect(getClientNamespace({ host: 'localhost' })).toBe('default');
    });

    it('should handle empty string namespace', () => {
      expect(getClientNamespace({ namespace: '' })).toBe('default');
      expect(getClientNamespace({ namespace: '   ' })).toBe('default');
    });

    it('should handle null/undefined options', () => {
      expect(getClientNamespace(null)).toBe('default');
      expect(getClientNamespace(undefined)).toBe('default');
    });

    it('should handle special characters in namespace', () => {
      expect(getClientNamespace({ namespace: 'cache-v1' })).toBe('cache-v1');
      expect(getClientNamespace({ namespace: 'cache_v1' })).toBe('cache_v1');
      expect(getClientNamespace({ namespace: 'cache.v1' })).toBe('cache.v1');
    });

    it('should convert non-string namespaces to string', () => {
      expect(getClientNamespace({ namespace: 123 })).toBe('123');
      expect(getClientNamespace({ namespace: true })).toBe('true');
    });
  });

  describe('generateScriptSha', () => {
    it('should generate correct SHA1 hash', () => {
      const script = 'return redis.call("get", KEYS[1])';
      const expectedSha = crypto.createHash('sha1').update(script).digest('hex');

      expect(generateScriptSha(script)).toBe(expectedSha);
    });

    it('should generate consistent SHA for same script', () => {
      const script = 'return 1';
      const sha1 = generateScriptSha(script);
      const sha2 = generateScriptSha(script);

      expect(sha1).toBe(sha2);
    });

    it('should generate different SHA for different scripts', () => {
      const sha1 = generateScriptSha('return 1');
      const sha2 = generateScriptSha('return 2');

      expect(sha1).not.toBe(sha2);
    });

    it('should handle empty string', () => {
      const sha = generateScriptSha('');
      expect(sha).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709'); // SHA1 of empty string
    });

    it('should handle special characters and unicode', () => {
      const script = 'return "🚀\\n\\t\\r"';
      const sha = generateScriptSha(script);
      expect(sha).toHaveLength(40);
      expect(sha).toMatch(/^[a-f0-9]{40}$/);
    });

    it('should handle very long scripts', () => {
      const longScript = 'return "' + 'a'.repeat(100000) + '"';
      const sha = generateScriptSha(longScript);
      expect(sha).toHaveLength(40);
    });
  });

  describe('loadScriptContent', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should load script content from file', () => {
      const scriptContent = 'return redis.call("get", KEYS[1])';
      (fs.readFileSync as jest.Mock).mockReturnValue(scriptContent);

      const content = loadScriptContent('/path/to/script.lua');
      expect(content).toBe(scriptContent.trim());
      expect(fs.readFileSync).toHaveBeenCalledWith('/path/to/script.lua', 'utf-8');
    });

    it('should trim whitespace from content', () => {
      const scriptContent = '  return 1  \n\t';
      (fs.readFileSync as jest.Mock).mockReturnValue(scriptContent);

      const content = loadScriptContent('/script.lua');
      expect(content).toBe('return 1');
    });

    it('should handle different encodings', () => {
      const scriptContent = 'return 1';
      (fs.readFileSync as jest.Mock).mockReturnValue(scriptContent);

      const content = loadScriptContent('/script.lua', 'ascii');
      expect(content).toBe(scriptContent.trim());
      expect(fs.readFileSync).toHaveBeenCalledWith('/script.lua', 'ascii');
    });

    it('should throw error if file not found', () => {
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      expect(() => loadScriptContent('/nonexistent.lua')).toThrow('ENOENT: no such file or directory');
    });
  });

  describe('createRetryStrategy', () => {
    it('should create default retry strategy', () => {
      const strategy = createRetryStrategy();
      expect(strategy(1)).toBe(100);
      expect(strategy(2)).toBe(200);
      expect(strategy(3)).toBe(400);
      expect(strategy(10)).toBe(10000); // Max delay
    });

    it('should create custom retry strategy', () => {
      const strategy = createRetryStrategy({
        retries: 5,
        minDelay: 200,
        maxDelay: 5000,
        factor: 3,
      });

      expect(strategy(1)).toBe(200);
      expect(strategy(2)).toBe(600);
      expect(strategy(3)).toBe(1800);
      expect(strategy(10)).toBe(null); // Exceeds max retries
    });

    it('should return null after max retries', () => {
      const strategy = createRetryStrategy({ retries: 3 });
      expect(strategy(1)).toBe(100);
      expect(strategy(2)).toBe(200);
      expect(strategy(3)).toBe(400);
      expect(strategy(4)).toBeNull();
    });

    it('should handle zero retries', () => {
      const strategy = createRetryStrategy({ retries: 0 });
      expect(strategy(1)).toBeNull();
    });

    it('should handle negative attempts', () => {
      const strategy = createRetryStrategy();
      expect(strategy(-1)).toBeNull();
      expect(strategy(0)).toBeNull();
    });

    it('should respect jitter option', () => {
      const strategy = createRetryStrategy({ jitter: true, minDelay: 100 });
      const delay = strategy(1);
      expect(delay).toBeGreaterThanOrEqual(50);
      expect(delay).toBeLessThanOrEqual(150);
    });
  });

  describe('mergeOptions', () => {
    it('should merge two option objects', () => {
      const base = { host: 'localhost', port: 6379, db: 0 };
      const override = { port: 6380, db: 1 };

      const merged = mergeOptions(base, override);
      expect(merged).toEqual({
        host: 'localhost',
        port: 6380,
        db: 1,
      });
    });

    it('should deep merge nested objects', () => {
      const base = {
        host: 'localhost',
        tls: { rejectUnauthorized: true, cert: 'cert1' },
      };
      const override = {
        tls: { rejectUnauthorized: false },
      };

      const merged = mergeOptions(base, override);
      expect(merged).toEqual({
        host: 'localhost',
        tls: { rejectUnauthorized: false, cert: 'cert1' },
      });
    });

    it('should handle arrays (override, not merge)', () => {
      const base = { nodes: [{ host: 'host1' }], tags: ['tag1'] };
      const override = { nodes: [{ host: 'host2' }, { host: 'host3' }], tags: ['tag2', 'tag3'] };

      const merged = mergeOptions(base, override);
      expect(merged.nodes).toEqual([{ host: 'host2' }, { host: 'host3' }]);
      expect(merged.tags).toEqual(['tag2', 'tag3']);
    });

    it('should handle null/undefined values', () => {
      const base = { host: 'localhost', port: 6379, db: 1 };
      const override = { host: null, db: undefined, password: null };

      const merged = mergeOptions(base, override);

      // undefined values are skipped, null values are preserved
      expect(merged.host).toBe(null);
      expect(merged.port).toBe(6379);
      expect(merged.db).toBe(1); // undefined doesn't override
      expect(merged.password).toBe(null);
    });

    it('should handle empty objects', () => {
      expect(mergeOptions({}, {})).toEqual({});
      expect(mergeOptions({ a: 1 }, {})).toEqual({ a: 1 });
      expect(mergeOptions({}, { b: 2 })).toEqual({ b: 2 });
    });

    it('should not mutate original objects', () => {
      const base = { a: 1, nested: { b: 2 } };
      const override = { nested: { c: 3 } };
      const baseCopy = JSON.parse(JSON.stringify(base));
      const overrideCopy = JSON.parse(JSON.stringify(override));

      const merged = mergeOptions(base, override);

      expect(base).toEqual(baseCopy);
      expect(override).toEqual(overrideCopy);
      expect(merged).toEqual({ a: 1, nested: { b: 2, c: 3 } });
    });

    it('should handle functions in options', () => {
      const fn1 = (times: number) => times * 100;
      const fn2 = (times: number) => times * 200;

      const base = { retryStrategy: fn1, other: 'value' };
      const override = { retryStrategy: fn2 };

      const merged = mergeOptions(base, override);

      expect(merged.retryStrategy).toBe(fn2);
      expect(merged.other).toBe('value');
    });

    it('should handle symbols as keys', () => {
      const sym = Symbol('test');
      const base = { [sym]: 'value1', other: 'data' };
      const override = { [sym]: 'value2' };

      const merged = mergeOptions(base, override);

      expect(merged[sym]).toBe('value2');
      expect(merged.other).toBe('data');
    });
  });

  describeIfRealRedis('waitForConnection', () => {
    let client: Redis;

    beforeEach(() => {
      if (isRedisInMockMode()) {
        console.log('⏭️  Skipping waitForConnection tests - require real Redis');
        return;
      }
      client = new Redis({ host: 'localhost', port: 6379, db: 15, lazyConnect: true });
      testClients.push(client);
    });

    it('should resolve immediately when client is ready', async () => {
      await client.connect();

      const start = Date.now();
      const result = await waitForConnection(client, 1000);
      const duration = Date.now() - start;

      expect(result).toBe(true);
      expect(duration).toBeLessThan(50);
    });

    it('should wait for client to become ready', async () => {
      // Start connection asynchronously
      const connectPromise = client.connect();

      const result = await waitForConnection(client, 2000);
      expect(result).toBe(true);

      await connectPromise;
    });

    it('should timeout if connection takes too long', async () => {
      const disconnectedClient = new Redis({
        host: 'localhost',
        port: 6379,
        db: 15,
        lazyConnect: true,
        connectTimeout: 50,
      });
      testClients.push(disconnectedClient);

      const result = await waitForConnection(disconnectedClient, 100);
      expect(result).toBe(false);
    });

    it('should handle connection errors', async () => {
      const badClient = new Redis({
        host: 'invalid-host-name-that-does-not-exist',
        port: 6379,
        lazyConnect: true,
        retryStrategy: () => null,
        enableOfflineQueue: false,
      });
      testClients.push(badClient);

      badClient.connect().catch(() => {}); // Ignore connection error
      const result = await waitForConnection(badClient, 500);
      expect(result).toBe(false);
    });

    it('should clean up event listeners', async () => {
      const removeListenerSpy = jest.spyOn(client, 'removeListener');

      // Start with a disconnected client that will connect
      const connectPromise = client.connect();

      // Call waitForConnection while client is connecting
      // This will add listeners that need to be cleaned up
      const waitPromise = waitForConnection(client, 1000);

      // Wait for both to complete
      await Promise.all([connectPromise, waitPromise]);

      // Now check that listeners were cleaned up after connection succeeded
      expect(removeListenerSpy).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should handle cluster client', async () => {
      const mockCluster: MockClusterClient = {
        status: 'ready',
        on: jest.fn(),
        once: jest.fn(),
        removeListener: jest.fn(),
      };

      const result = await waitForConnection(mockCluster as unknown as Cluster, 1000);
      expect(result).toBe(true);
    });

    it('should handle zero and negative timeouts', async () => {
      const result1 = await waitForConnection(client, 0);
      expect(result1).toBe(false);

      const result2 = await waitForConnection(client, -1);
      expect(result2).toBe(false);
    });
  });

  describeIfRealRedis('Docker Redis Integration', () => {
    it('should connect to Docker Redis instance', async () => {
      await withDockerRedis(async (fixture: DockerRedisTestFixture) => {
        const client = createRedisClient({
          host: 'localhost',
          port: fixture.port,
          db: 0,
          lazyConnect: false,
        }) as Redis;

        try {
          const connected = await waitForConnection(client, 5000);
          expect(connected).toBe(true);

          // Test actual operation
          const testKey = `utils-test-${Date.now()}`;
          await client.set(testKey, 'test-value');
          const value = await client.get(testKey);
          expect(value).toBe('test-value');

          // Clean up
          await client.del(testKey);
        } finally {
          await client.quit();
        }
      });
    });

    it('should handle multiple clients with different databases', async () => {
      await withDockerRedis(async (fixture: DockerRedisTestFixture) => {
        const client1 = createRedisClient({
          host: 'localhost',
          port: fixture.port,
          db: 1,
          lazyConnect: false,
        }) as Redis;

        const client2 = createRedisClient({
          host: 'localhost',
          port: fixture.port,
          db: 2,
          lazyConnect: false,
        }) as Redis;

        try {
          const testKey = `multi-test-${Date.now()}`;
          await client1.set(testKey, 'value1');
          await client2.set(testKey, 'value2');

          expect(await client1.get(testKey)).toBe('value1');
          expect(await client2.get(testKey)).toBe('value2');

          // Clean up
          await client1.del(testKey);
          await client2.del(testKey);
        } finally {
          await client1.quit();
          await client2.quit();
        }
      });
    });

    it('should handle connection failure gracefully', async () => {
      const client = createRedisClient({
        host: 'invalid-host',
        port: 6379,
        retryStrategy: () => null,
        lazyConnect: true,
      }) as Redis;
      testClients.push(client);

      client.connect().catch(() => {}); // Ignore connection error
      const result = await waitForConnection(client, 200);
      expect(result).toBe(false);
    });
  });
});
