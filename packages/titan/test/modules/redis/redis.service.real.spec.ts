import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { RedisService } from '../../../src/modules/redis/redis.service.js';
import { RedisManager } from '../../../src/modules/redis/redis.manager.js';
import {
  createRedisTestHelper,
  RedisTestHelper
} from '../../utils/redis-test-utils.js';

describe('RedisService with Real Redis', () => {
  let service: RedisService;
  let manager: RedisManager;
  let helper: RedisTestHelper;

  beforeEach(async () => {
    helper = createRedisTestHelper();
    await helper.waitForRedis();

    manager = new RedisManager({
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
    }, null as any);

    await manager.init();
    service = new RedisService(manager);
  });

  afterEach(async () => {
    await helper.cleanupData();
    await manager.destroy();
    await helper.cleanup();
  });

  describe('String Operations', () => {
    it('should perform all string operations', async () => {
      // Set and get
      await service.set('key1', 'value1');
      expect(await service.get('key1')).toBe('value1');

      // Setex (with expiry)
      await service.setex('expiring', 2, 'temp');
      expect(await service.get('expiring')).toBe('temp');
      const ttl = await service.ttl('expiring');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(2);

      // Setnx (set if not exists)
      expect(await service.setnx('new', 'value')).toBe(1);
      expect(await service.setnx('new', 'other')).toBe(0);

      // Increment operations
      await service.set('counter', '5');
      expect(await service.incr('counter')).toBe(6);
      expect(await service.incrby('counter', 4)).toBe(10);
      expect(await service.decr('counter')).toBe(9);
      expect(await service.decrby('counter', 3)).toBe(6);

      // Delete and exists
      expect(await service.exists('counter')).toBe(1);
      expect(await service.del('counter')).toBe(1);
      expect(await service.exists('counter')).toBe(0);

      // Expire
      await service.set('temp', 'value');
      expect(await service.expire('temp', 1)).toBe(1);
      const tempTtl = await service.ttl('temp');
      expect(tempTtl).toBe(1);
    });

    it('should work with different namespaces', async () => {
      await service.set('key', 'default-value');
      await service.set('key', 'cache-value', 'cache');

      expect(await service.get('key')).toBe('default-value');
      expect(await service.get('key', 'cache')).toBe('cache-value');
    });
  });

  describe('Hash Operations', () => {
    it('should perform all hash operations', async () => {
      const hash = 'user:1';

      // Set and get fields
      await service.hset(hash, 'name', 'John');
      await service.hset(hash, 'age', '30');
      await service.hset(hash, 'city', 'NYC');

      expect(await service.hget(hash, 'name')).toBe('John');
      expect(await service.hget(hash, 'age')).toBe('30');

      // Get all fields
      const all = await service.hgetall(hash);
      expect(all).toEqual({
        name: 'John',
        age: '30',
        city: 'NYC',
      });

      // Delete field
      expect(await service.hdel(hash, 'city')).toBe(1);
      expect(await service.hget(hash, 'city')).toBeNull();
    });
  });

  describe('Set Operations', () => {
    it('should perform all set operations', async () => {
      const set = 'tags';

      // Add members
      expect(await service.sadd(set, 'tag1', 'tag2', 'tag3')).toBe(3);
      expect(await service.sadd(set, 'tag2')).toBe(0); // Already exists

      // Check membership
      expect(await service.sismember(set, 'tag1')).toBe(1);
      expect(await service.sismember(set, 'tag4')).toBe(0);

      // Get members
      const members = await service.smembers(set);
      expect(members.sort()).toEqual(['tag1', 'tag2', 'tag3']);

      // Remove member
      expect(await service.srem(set, 'tag2')).toBe(1);
      expect(await service.sismember(set, 'tag2')).toBe(0);
    });
  });

  describe('List Operations', () => {
    it('should perform all list operations', async () => {
      const list = 'queue';

      // Push elements
      expect(await service.lpush(list, 'first')).toBe(1);
      expect(await service.rpush(list, 'last')).toBe(2);
      expect(await service.lpush(list, 'new-first')).toBe(3);

      // Get length
      expect(await service.llen(list)).toBe(3);

      // Get range
      const range = await service.lrange(list, 0, -1);
      expect(range).toEqual(['new-first', 'first', 'last']);

      // Pop elements
      expect(await service.lpop(list)).toBe('new-first');
      expect(await service.rpop(list)).toBe('last');
      expect(await service.llen(list)).toBe(1);
    });
  });

  describe('Sorted Set Operations', () => {
    it('should perform all sorted set operations', async () => {
      const zset = 'scores';

      // Add members with scores
      expect(await service.zadd(zset, 10, 'alice', 20, 'bob', 15, 'charlie')).toBe(3);

      // Get cardinality
      expect(await service.zcard(zset)).toBe(3);

      // Get score
      expect(await service.zscore(zset, 'bob')).toBe('20');
      expect(await service.zscore(zset, 'unknown')).toBeNull();

      // Range operations
      expect(await service.zrange(zset, 0, -1)).toEqual(['alice', 'charlie', 'bob']);
      expect(await service.zrevrange(zset, 0, 1)).toEqual(['bob', 'charlie']);

      // Remove member
      expect(await service.zrem(zset, 'charlie')).toBe(1);
      expect(await service.zcard(zset)).toBe(2);
    });
  });

  describe('Lua Script Operations', () => {
    it('should execute Lua scripts', async () => {
      const script = `
        local key = KEYS[1]
        local value = ARGV[1]
        redis.call('set', key, value)
        return redis.call('get', key)
      `;

      const result = await service.eval(script, ['script-key'], ['script-value']);
      expect(result).toBe('script-value');

      // Verify the key was set
      expect(await service.get('script-key')).toBe('script-value');
    });

    it('should load and execute scripts with SHA', async () => {
      const script = 'return redis.call("incr", KEYS[1])';

      // Load script
      const sha = await service.loadScript(script);
      expect(sha).toHaveLength(40);

      // Set initial value
      await service.set('counter', '10');

      // Execute using SHA
      const result = await service.evalsha(sha, ['counter'], []);
      expect(result).toBe(11);
    });

    it('should run named scripts', async () => {
      // This requires scripts to be loaded via manager
      const managerWithScripts = new RedisManager({
        clients: [{
          namespace: 'default',
          host: 'localhost',
          port: 6379,
          db: 15,
        }],
        scripts: [
          {
            name: 'multiply',
            content: 'return ARGV[1] * ARGV[2]',
          },
        ],
      }, null as any);

      await managerWithScripts.init();
      const serviceWithScripts = new RedisService(managerWithScripts);

      const result = await serviceWithScripts.runScript('multiply', [], [6, 7]);
      expect(result).toBe(42);

      await managerWithScripts.destroy();
    });
  });

  describe('Pub/Sub Operations', () => {
    it('should publish messages', async () => {
      const result = await service.publish('channel', 'message');
      expect(result).toBe(0); // No subscribers
    });

    it('should create subscriber', async () => {
      const subscriber = await service.createSubscriber();
      expect(subscriber).toBeDefined();
      expect(subscriber.status).toBe('ready');

      await subscriber.quit();
    });

    it('should handle pub/sub messaging', async (done) => {
      const subscriber = await service.createSubscriber();
      const messages: string[] = [];

      subscriber.on('message', (channel, message) => {
        messages.push(message);
        if (messages.length === 3) {
          expect(messages).toEqual(['msg1', 'msg2', 'msg3']);
          subscriber.quit();
          done();
        }
      });

      await subscriber.subscribe('test-channel');

      // Publish messages
      setTimeout(async () => {
        await service.publish('test-channel', 'msg1');
        await service.publish('test-channel', 'msg2');
        await service.publish('test-channel', 'msg3');
      }, 50);
    }, 5000);
  });

  describe('Pipeline Operations', () => {
    it('should execute pipeline operations', async () => {
      const pipeline = await service.pipeline();

      pipeline
        .set('p1', 'v1')
        .set('p2', 'v2')
        .set('p3', 'v3')
        .get('p1')
        .get('p2')
        .get('p3');

      const results = await pipeline.exec();
      expect(results).toHaveLength(6);

      // Check set results
      expect(results![0][1]).toBe('OK');
      expect(results![1][1]).toBe('OK');
      expect(results![2][1]).toBe('OK');

      // Check get results
      expect(results![3][1]).toBe('v1');
      expect(results![4][1]).toBe('v2');
      expect(results![5][1]).toBe('v3');
    });

    it('should handle pipeline errors', async () => {
      const pipeline = await service.pipeline();

      pipeline
        .set('valid', 'value')
        .incr('valid') // This will fail - not a number
        .set('another', 'value');

      const results = await pipeline.exec();
      expect(results![0][0]).toBeNull(); // No error for set
      expect(results![1][0]).toBeInstanceOf(Error); // Error for incr
      expect(results![2][0]).toBeNull(); // No error for set
    });
  });

  describe('Multi/Transaction Operations', () => {
    it('should execute transactions', async () => {
      const multi = await service.multi();

      multi
        .set('tx1', 'val1')
        .set('tx2', 'val2')
        .incr('tx-counter')
        .get('tx1');

      const results = await multi.exec();
      expect(results).toHaveLength(4);
      expect(results![0][1]).toBe('OK');
      expect(results![1][1]).toBe('OK');
      expect(results![2][1]).toBe(1);
      expect(results![3][1]).toBe('val1');
    });
  });

  describe('Database Operations', () => {
    it('should flush database', async () => {
      await service.set('key1', 'value1');
      await service.set('key2', 'value2');

      await service.flushdb();

      expect(await service.get('key1')).toBeNull();
      expect(await service.get('key2')).toBeNull();
    });

    it('should flush all databases', async () => {
      await service.set('key', 'value');
      await service.set('key', 'cache-value', 'cache');

      await service.flushall();

      expect(await service.get('key')).toBeNull();
      expect(await service.get('key', 'cache')).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid namespace', async () => {
      await expect(service.get('key', 'non-existent')).rejects.toThrow(
        'Redis client with namespace "non-existent" not found'
      );
    });

    it('should handle operation errors', async () => {
      // Try to increment a non-numeric value
      await service.set('text', 'not-a-number');
      await expect(service.incr('text')).rejects.toThrow();
    });
  });
});