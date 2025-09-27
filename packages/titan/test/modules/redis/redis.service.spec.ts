import { describe, it, expect, beforeEach, afterEach, beforeAll } from '@jest/globals';
import { RedisService } from '../../../src/modules/redis/redis.service.js';
import { RedisManager } from '../../../src/modules/redis/redis.manager.js';
import { RedisTestManager, RedisTestContainer } from '../../utils/redis-test-manager.js';
import { RedisFallback } from '../../utils/redis-fallback.js';

// Setup Redis connection before tests are defined
let testContainer: RedisTestContainer | null = null;
let testManager: RedisTestManager | null = null;
let fallbackConnection: any = null;

// Initialize Redis connection immediately
(async () => {
  try {
    console.log('Attempting to create Redis test container...');
    testManager = RedisTestManager.getInstance({ verbose: false });
    testContainer = await testManager.createContainer();
    console.log('Redis test container created successfully:', testContainer.url);
  } catch (error) {
    console.log('Failed to create container:', error);
    // Fallback to local Redis if Docker not available
    fallbackConnection = await RedisFallback.getConnection();
    if (!fallbackConnection) {
      console.warn('Redis not available, skipping tests');
    } else {
      console.log('Using fallback connection:', fallbackConnection.url);
    }
  }
})();

describe('RedisService', () => {
  let service: RedisService;
  let manager: RedisManager;

  beforeAll(async () => {
    // Wait for connection to be established
    const maxWait = 10000;
    const startTime = Date.now();
    while (!testContainer && !fallbackConnection && Date.now() - startTime < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (!testContainer && !fallbackConnection) {
      console.warn('Redis not available after waiting, tests will be skipped');
      return;
    }
  }, 30000);

  beforeEach(async () => {
    if (!testContainer && !fallbackConnection) {
      return;
    }

    const redisConfig = testContainer ? {
      host: testContainer.host,
      port: testContainer.port,
    } : {
      host: '127.0.0.1',
      port: 6379,
    };

    // Create Redis manager with test Redis
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
        }
      ]
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
    if (testContainer) {
      await testContainer.cleanup();
    }
    if (fallbackConnection) {
      await fallbackConnection.cleanup();
    }
  });

  // Helper to conditionally run tests based on Redis availability
  const itWithRedis = (name: string, fn: () => Promise<void>, timeout?: number) => {
    it(name, async () => {
      if (!testContainer && !fallbackConnection) {
        console.log(`Skipping test "${name}" - Redis not available`);
        return;
      }
      await fn();
    }, timeout);
  };

  describe('String Operations', () => {
    itWithRedis('should get and set string values', async () => {
      const result = await service.set('key', 'value');
      expect(result).toBe('OK');

      const value = await service.get('key');
      expect(value).toBe('value');
    });

    itWithRedis('should set with expiration', async () => {
      const result = await service.setex('key', 1, 'value');
      expect(result).toBe('OK');

      const value = await service.get('key');
      expect(value).toBe('value');

      await new Promise(resolve => setTimeout(resolve, 1100));
      const expired = await service.get('key');
      expect(expired).toBeNull();
    });

    itWithRedis('should set if not exists', async () => {
      const result1 = await service.setnx('key', 'value1');
      expect(result1).toBe(1);

      const result2 = await service.setnx('key', 'value2');
      expect(result2).toBe(0);

      const value = await service.get('key');
      expect(value).toBe('value1');
    });

    itWithRedis('should delete keys', async () => {
      await service.set('key', 'value');
      const deleted = await service.del('key');
      expect(deleted).toBe(1);

      const value = await service.get('key');
      expect(value).toBeNull();
    });

    itWithRedis('should check key existence', async () => {
      await service.set('key', 'value');
      const exists = await service.exists('key');
      expect(exists).toBe(1);

      await service.del('key');
      const notExists = await service.exists('key');
      expect(notExists).toBe(0);
    });

    itWithRedis('should increment and decrement', async () => {
      const incr = await service.incr('counter');
      expect(incr).toBe(1);

      const incrby = await service.incrby('counter', 5);
      expect(incrby).toBe(6);

      const decr = await service.decr('counter');
      expect(decr).toBe(5);

      const decrby = await service.decrby('counter', 3);
      expect(decrby).toBe(2);
    });

    itWithRedis('should set expiration', async () => {
      await service.set('key', 'value');
      const result = await service.expire('key', 1);
      expect(result).toBe(1);

      const ttl = await service.ttl('key');
      expect(ttl).toBeGreaterThan(-1);
      expect(ttl).toBeLessThanOrEqual(1);

      await new Promise(resolve => setTimeout(resolve, 1100));
      const expired = await service.exists('key');
      expect(expired).toBe(0);
    });
  });

  describe('Hash Operations', () => {
    itWithRedis('should perform hash operations', async () => {
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
    itWithRedis('should perform set operations', async () => {
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
    itWithRedis('should perform list operations', async () => {
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
    itWithRedis('should perform sorted set operations', async () => {
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
    itWithRedis('should execute pipeline commands', async () => {
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
    itWithRedis('should execute multi commands', async () => {
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
    itWithRedis('should publish messages', async () => {
      const published = await service.publish('channel', 'message');
      expect(published).toBeGreaterThanOrEqual(0);
    });

    itWithRedis('should subscribe and receive messages', async () => {
      const messages: string[] = [];
      const unsubscribe = await service.subscribe('channel', (message) => {
        messages.push(message);
      });

      await new Promise(resolve => setTimeout(resolve, 100));
      await service.publish('channel', 'test-message');
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(messages).toContain('test-message');
      await unsubscribe();
    });
  });

  describe('Script Operations', () => {
    itWithRedis('should load and run Lua scripts', async () => {
      const script = `
        local key = KEYS[1]
        local value = ARGV[1]
        redis.call('SET', key, value)
        return redis.call('GET', key)
      `;

      const sha = await service.scriptLoad(script);
      expect(sha).toBeDefined();
      expect(typeof sha).toBe('string');

      const result = await service.evalsha(sha, 1, 'scriptKey', 'scriptValue');
      expect(result).toBe('scriptValue');
    });

    itWithRedis('should use eval for scripts', async () => {
      const result = await service.eval(
        "return redis.call('SET', KEYS[1], ARGV[1])",
        1,
        'evalKey',
        'evalValue'
      );
      expect(result).toBe('OK');

      const value = await service.get('evalKey');
      expect(value).toBe('evalValue');
    });
  });

  describe('Connection Management', () => {
    itWithRedis('should get client for specific purpose', async () => {
      const cacheClient = service.getClient('cache');
      expect(cacheClient).toBeDefined();

      await cacheClient?.set('test', 'value');
      const value = await cacheClient?.get('cache:test');
      expect(value).toBe('value');
    });

    itWithRedis('should get all clients', async () => {
      const clients = service.getAllClients();
      expect(clients).toBeDefined();
      expect(Object.keys(clients).length).toBeGreaterThan(0);
    });

    itWithRedis('should check if connected', async () => {
      const connected = service.isConnected();
      expect(connected).toBe(true);
    });

    itWithRedis('should get all purposes', async () => {
      const purposes = service.getAllPurposes();
      expect(purposes).toContain('default');
    });

    itWithRedis('should get Redis info', async () => {
      const info = await service.info();
      expect(info).toBeDefined();
      expect(typeof info).toBe('string');
      expect(info).toContain('redis_version');
    });
  });

  describe('Database Operations', () => {
    itWithRedis('should flush database', async () => {
      await service.set('key1', 'value1');
      await service.set('key2', 'value2');

      await service.flushdb();

      const exists1 = await service.exists('key1');
      const exists2 = await service.exists('key2');
      expect(exists1).toBe(0);
      expect(exists2).toBe(0);
    });

    itWithRedis('should flush all databases', async () => {
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