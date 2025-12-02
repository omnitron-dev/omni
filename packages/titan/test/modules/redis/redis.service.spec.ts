import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import { RedisService } from '../../../src/modules/redis/redis.service.js';
import { RedisManager } from '../../../src/modules/redis/redis.manager.js';
import { createDockerRedisFixture, type DockerRedisTestFixture, isDockerAvailable } from './utils/redis-test-utils.js';

/**
 * RedisService Test Suite
 *
 * Production-ready tests using Docker fixtures exclusively.
 * All tests run against real Redis instances in isolated Docker containers.
 */

// Skip tests if Docker is not available or in CI/mock mode
const skipTests = process.env.USE_MOCK_REDIS === 'true' || process.env.CI === 'true' || !isDockerAvailable();
if (skipTests) {
  console.log('⏭️ Skipping redis.service.spec.ts - requires Docker');
}
const describeOrSkip = skipTests ? describe.skip : describe;

describeOrSkip('RedisService', () => {
  let service: RedisService;
  let manager: RedisManager;
  let dockerFixture: DockerRedisTestFixture;

  beforeAll(async () => {
    // Create Docker Redis container for all tests
    dockerFixture = await createDockerRedisFixture();
  }, 30000);

  beforeEach(async () => {
    const redisConfig = {
      host: 'localhost',
      port: dockerFixture.port,
    };

    // Create Redis manager with Docker Redis
    const redisOptions = {
      config: {
        ...redisConfig,
        db: 0,
        retryStrategy: (times: number) => {
          if (times > 3) return null;
          return Math.min(times * 100, 2000);
        },
        enableOfflineQueue: false,
      },
      clients: [
        {
          name: 'cache',
          ...redisConfig,
          db: 1,
          keyPrefix: 'cache:',
        },
        {
          name: 'pubsub',
          ...redisConfig,
          db: 2,
        },
      ],
    };

    manager = new RedisManager(redisOptions);
    await manager.init();
    service = new RedisService(manager);

    // Clear all data before each test
    const client = service.getClient();
    if (client) {
      await client.flushall();
    }
  });

  afterEach(async () => {
    if (manager) {
      await manager.destroy();
    }
  });

  afterAll(async () => {
    if (dockerFixture) {
      await dockerFixture.cleanup();
    }
  });

  describe('String Operations', () => {
    it('should get and set string values', async () => {
      const result = await service.set('key', 'value');
      expect(result).toBe('OK');

      const value = await service.get('key');
      expect(value).toBe('value');
    });

    it('should set with expiration', async () => {
      const result = await service.setex('key', 1, 'value');
      expect(result).toBe('OK');

      const value = await service.get('key');
      expect(value).toBe('value');

      await new Promise((resolve) => setTimeout(resolve, 1100));
      const expired = await service.get('key');
      expect(expired).toBeNull();
    });

    it('should set if not exists', async () => {
      const result1 = await service.setnx('key', 'value1');
      expect(result1).toBe(1);

      const result2 = await service.setnx('key', 'value2');
      expect(result2).toBe(0);

      const value = await service.get('key');
      expect(value).toBe('value1');
    });

    it('should delete keys', async () => {
      await service.set('key', 'value');
      const deleted = await service.del('key');
      expect(deleted).toBe(1);

      const value = await service.get('key');
      expect(value).toBeNull();
    });

    it('should check key existence', async () => {
      await service.set('key', 'value');
      const exists = await service.exists('key');
      expect(exists).toBe(1);

      await service.del('key');
      const notExists = await service.exists('key');
      expect(notExists).toBe(0);
    });

    it('should increment and decrement', async () => {
      const incr = await service.incr('counter');
      expect(incr).toBe(1);

      const incrby = await service.incrby('counter', 5);
      expect(incrby).toBe(6);

      const decr = await service.decr('counter');
      expect(decr).toBe(5);

      const decrby = await service.decrby('counter', 3);
      expect(decrby).toBe(2);
    });

    it('should set expiration', async () => {
      await service.set('key', 'value');
      const result = await service.expire('key', 1);
      expect(result).toBe(1);

      const ttl = await service.ttl('key');
      expect(ttl).toBeGreaterThan(-1);
      expect(ttl).toBeLessThanOrEqual(1);

      await new Promise((resolve) => setTimeout(resolve, 1100));
      const expired = await service.exists('key');
      expect(expired).toBe(0);
    });
  });

  describe('Hash Operations', () => {
    it('should perform hash operations', async () => {
      const hset = await service.hset('hash', 'field1', 'value1');
      expect(hset).toBe(1);

      const hget = await service.hget('hash', 'field1');
      expect(hget).toBe('value1');

      await service.hset('hash', 'field2', 'value2');
      const hgetall = await service.hgetall('hash');
      expect(hgetall).toEqual({ field1: 'value1', field2: 'value2' });

      const hdel = await service.hdel('hash', 'field1');
      expect(hdel).toBe(1);
    });
  });

  describe('Set Operations', () => {
    it('should perform set operations', async () => {
      const sadd = await service.sadd('set', 'member1');
      expect(sadd).toBe(1);

      await service.sadd('set', 'member2');
      const smembers = await service.smembers('set');
      expect(smembers.sort()).toEqual(['member1', 'member2']);

      const sismember = await service.sismember('set', 'member1');
      expect(sismember).toBe(1);

      const srem = await service.srem('set', 'member1');
      expect(srem).toBe(1);
    });
  });

  describe('List Operations', () => {
    it('should perform list operations', async () => {
      const lpush = await service.lpush('list', 'item1');
      expect(lpush).toBe(1);

      const rpush = await service.rpush('list', 'item2');
      expect(rpush).toBe(2);

      const lrange = await service.lrange('list', 0, -1);
      expect(lrange).toEqual(['item1', 'item2']);

      const llen = await service.llen('list');
      expect(llen).toBe(2);

      const lpop = await service.lpop('list');
      expect(lpop).toBe('item1');

      const rpop = await service.rpop('list');
      expect(rpop).toBe('item2');
    });
  });

  describe('Sorted Set Operations', () => {
    it('should perform sorted set operations', async () => {
      const zadd = await service.zadd('zset', 1, 'member1');
      expect(zadd).toBe(1);

      await service.zadd('zset', 2, 'member2');
      const zrange = await service.zrange('zset', 0, -1);
      expect(zrange).toEqual(['member1', 'member2']);

      const zrevrange = await service.zrevrange('zset', 0, -1);
      expect(zrevrange).toEqual(['member2', 'member1']);

      const zcard = await service.zcard('zset');
      expect(zcard).toBe(2);

      const zscore = await service.zscore('zset', 'member1');
      expect(zscore).toBe('1');

      const zrem = await service.zrem('zset', 'member1');
      expect(zrem).toBe(1);
    });
  });

  describe('Pipeline Operations', () => {
    it('should execute pipeline commands', async () => {
      const pipeline = service.pipeline();
      pipeline.set('key1', 'value1');
      pipeline.set('key2', 'value2');
      pipeline.get('key1');
      pipeline.get('key2');

      const results = await pipeline.exec();
      expect(results).toBeDefined();
      expect(results?.length).toBe(4);
      expect(results?.[0]?.[1]).toBe('OK');
      expect(results?.[1]?.[1]).toBe('OK');
      expect(results?.[2]?.[1]).toBe('value1');
      expect(results?.[3]?.[1]).toBe('value2');
    });
  });

  describe('Transaction Operations', () => {
    it('should execute multi commands', async () => {
      const multi = service.multi();
      multi.set('key1', 'value1');
      multi.set('key2', 'value2');
      multi.get('key1');
      multi.get('key2');

      const results = await multi.exec();
      expect(results).toBeDefined();
      expect(results?.length).toBe(4);
      expect(results?.[0]?.[1]).toBe('OK');
      expect(results?.[1]?.[1]).toBe('OK');
      expect(results?.[2]?.[1]).toBe('value1');
      expect(results?.[3]?.[1]).toBe('value2');
    });
  });

  describe('Pub/Sub Operations', () => {
    it('should publish messages', async () => {
      const published = await service.publish('channel', 'message');
      expect(published).toBeGreaterThanOrEqual(0);
    });

    it('should create subscriber and receive messages', async () => {
      const messages: string[] = [];
      const subscriber = service.createSubscriber();

      subscriber.on('message', (channel: string, message: string) => {
        messages.push(message);
      });

      await subscriber.subscribe('test-channel');
      await new Promise((resolve) => setTimeout(resolve, 100));

      await service.publish('test-channel', 'test-message');
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(messages).toContain('test-message');
      await subscriber.quit();
    });
  });

  describe('Script Operations', () => {
    it('should load and run Lua scripts', async () => {
      const script = `
        local key = KEYS[1]
        local value = ARGV[1]
        redis.call('SET', key, value)
        return redis.call('GET', key)
      `;

      const sha = await service.loadScript('test-script', script);
      expect(sha).toBeDefined();
      expect(typeof sha).toBe('string');

      const result = await service.evalsha(sha, 1, 'scriptKey', 'scriptValue');
      expect(result).toBe('scriptValue');
    });

    it('should use eval for scripts', async () => {
      const result = await service.eval("return redis.call('SET', KEYS[1], ARGV[1])", 1, 'evalKey', 'evalValue');
      expect(result).toBe('OK');

      const value = await service.get('evalKey');
      expect(value).toBe('evalValue');
    });
  });

  describe('Connection Management', () => {
    it('should get client for specific purpose', async () => {
      const cacheClient = service.getClient('cache');
      expect(cacheClient).toBeDefined();

      await cacheClient?.set('test', 'value');
      const value = await cacheClient?.get('cache:test');
      expect(value).toBe('value');
    });

    it('should check if client is ready', async () => {
      const isReady = service.isReady();
      expect(isReady).toBe(true);
    });

    it('should ping Redis', async () => {
      const pingResult = await service.ping();
      expect(pingResult).toBe(true);
    });

    it('should create subscriber client', async () => {
      const subscriber = service.createSubscriber();
      expect(subscriber).toBeDefined();
      await subscriber.quit();
    });
  });

  describe('Database Operations', () => {
    it('should flush database', async () => {
      await service.set('key1', 'value1');
      await service.set('key2', 'value2');

      await service.flushdb();

      const exists1 = await service.exists('key1');
      const exists2 = await service.exists('key2');
      expect(exists1).toBe(0);
      expect(exists2).toBe(0);
    });

    it('should flush all databases', async () => {
      await service.set('key', 'value');

      const cacheClient = service.getClient('cache');
      await cacheClient?.set('cacheKey', 'cacheValue');

      await service.flushall();

      const exists1 = await service.exists('key');
      const exists2 = await cacheClient?.exists('cache:cacheKey');
      expect(exists1).toBe(0);
      expect(exists2).toBe(0);
    });
  });
});
