/**
 * Comprehensive Infrastructure Tests for Redis Service
 * Tests all Redis operations, pub/sub, scripts, transactions, and pipelines
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from '@jest/globals';
import { RedisManager } from '../../../../src/modules/redis/redis.manager.js';
import { RedisService } from '../../../../src/modules/redis/redis.service.js';
import { RedisTestManager } from '../../../utils/redis-test-manager.js';
import { delay } from '@omnitron-dev/common';
import { isRedisInMockMode } from '../../redis/utils/redis-test-utils.js';

// Check if running in mock mode
const skipTests = isRedisInMockMode();

if (skipTests) {
  console.log('⏭️  Skipping redis-service-comprehensive.spec.ts - requires real Redis');
}

// Skip all tests if in mock mode - requires real Redis
const describeOrSkip = skipTests ? describe.skip : describe;

describeOrSkip('Redis Service - Infrastructure Tests', () => {
  let testContainer: Awaited<ReturnType<typeof RedisTestManager.prototype.createContainer>>;
  let manager: RedisManager;
  let service: RedisService;

  beforeEach(async () => {
    const redisManager = RedisTestManager.getInstance();
    testContainer = await redisManager.createContainer();

    manager = new RedisManager({
      config: {
        host: testContainer.host,
        port: testContainer.port,
      },
    });
    await manager.init();

    service = new RedisService(manager);
  });

  afterEach(async () => {
    if (manager) {
      await manager.destroy();
    }
    if (testContainer) {
      await testContainer.cleanup();
    }
  });

  describe('Client Management', () => {
    it('should get client successfully', () => {
      const client = service.getClient('default');
      expect(client).toBeDefined();
      expect(client.status).toBe('ready');
    });

    it('should throw error for non-existent client', () => {
      expect(() => service.getOrThrow('nonexistent')).toThrow();
    });

    it('should return null for non-existent client with getOrNil', () => {
      const client = service.getOrNil('nonexistent');
      expect(client).toBeNull();
    });

    it('should check if client is ready', () => {
      const isReady = service.isReady('default');
      expect(isReady).toBe(true);
    });

    it('should ping client successfully', async () => {
      const result = await service.ping('default');
      expect(result).toBe(true);
    });
  });

  describe('String Operations', () => {
    it('should set and get string value', async () => {
      await service.set('test:key', 'value');
      const result = await service.get('test:key');
      expect(result).toBe('value');
    });

    it('should set with TTL', async () => {
      await service.set('test:ttl', 'value', 1);
      const result = await service.get('test:ttl');
      expect(result).toBe('value');

      await delay(1100);
      const expired = await service.get('test:ttl');
      expect(expired).toBeNull();
    });

    it('should use setex for expiration', async () => {
      await service.setex('test:setex', 1, 'value');
      const result = await service.get('test:setex');
      expect(result).toBe('value');

      await delay(1100);
      const expired = await service.get('test:setex');
      expect(expired).toBeNull();
    });

    it('should set if not exists with setnx', async () => {
      const result1 = await service.setnx('test:setnx', 'value1');
      expect(result1).toBe(1);

      const result2 = await service.setnx('test:setnx', 'value2');
      expect(result2).toBe(0);

      const value = await service.get('test:setnx');
      expect(value).toBe('value1');
    });

    it('should delete single key', async () => {
      await service.set('test:del', 'value');
      const deleted = await service.del('test:del');
      expect(deleted).toBe(1);

      const result = await service.get('test:del');
      expect(result).toBeNull();
    });

    it('should delete multiple keys', async () => {
      await service.set('test:del1', 'value');
      await service.set('test:del2', 'value');

      const deleted = await service.del(['test:del1', 'test:del2']);
      expect(deleted).toBe(2);
    });

    it('should check if key exists', async () => {
      await service.set('test:exists', 'value');
      const exists = await service.exists('test:exists');
      expect(exists).toBe(1);

      const notExists = await service.exists('test:notexists');
      expect(notExists).toBe(0);
    });

    it('should check multiple keys existence', async () => {
      await service.set('test:exists1', 'value');
      await service.set('test:exists2', 'value');

      const count = await service.exists(['test:exists1', 'test:exists2']);
      expect(count).toBe(2);
    });

    it('should increment counter', async () => {
      await service.set('test:counter', '0');
      const result1 = await service.incr('test:counter');
      expect(result1).toBe(1);

      const result2 = await service.incr('test:counter');
      expect(result2).toBe(2);
    });

    it('should increment by value', async () => {
      await service.set('test:incrby', '10');
      const result = await service.incrby('test:incrby', 5);
      expect(result).toBe(15);
    });

    it('should decrement counter', async () => {
      await service.set('test:decr', '10');
      const result = await service.decr('test:decr');
      expect(result).toBe(9);
    });

    it('should decrement by value', async () => {
      await service.set('test:decrby', '10');
      const result = await service.decrby('test:decrby', 3);
      expect(result).toBe(7);
    });

    it('should set expiration on key', async () => {
      await service.set('test:expire', 'value');
      await service.expire('test:expire', 1);

      const ttl = await service.ttl('test:expire');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(1);

      await delay(1100);
      const expired = await service.get('test:expire');
      expect(expired).toBeNull();
    });

    it('should get TTL of key', async () => {
      await service.setex('test:ttl', 10, 'value');
      const ttl = await service.ttl('test:ttl');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(10);
    });
  });

  describe('Hash Operations', () => {
    it('should set and get hash field', async () => {
      await service.hset('test:hash', 'field1', 'value1');
      const result = await service.hget('test:hash', 'field1');
      expect(result).toBe('value1');
    });

    it('should get all hash fields', async () => {
      await service.hset('test:hash', 'field1', 'value1');
      await service.hset('test:hash', 'field2', 'value2');

      const result = await service.hgetall('test:hash');
      expect(result['field1']).toBe('value1');
      expect(result['field2']).toBe('value2');
    });

    it('should delete hash field', async () => {
      await service.hset('test:hash', 'field1', 'value1');
      const deleted = await service.hdel('test:hash', 'field1');
      expect(deleted).toBe(1);

      const result = await service.hget('test:hash', 'field1');
      expect(result).toBeNull();
    });

    it('should delete multiple hash fields', async () => {
      await service.hset('test:hash', 'field1', 'value1');
      await service.hset('test:hash', 'field2', 'value2');

      const deleted = await service.hdel('test:hash', ['field1', 'field2']);
      expect(deleted).toBe(2);
    });
  });

  describe('Set Operations', () => {
    it('should add members to set', async () => {
      await service.sadd('test:set', 'member1');
      const members = await service.smembers('test:set');
      expect(members).toContain('member1');
    });

    it('should add multiple members to set', async () => {
      await service.sadd('test:set', ['member1', 'member2']);
      const members = await service.smembers('test:set');
      expect(members).toContain('member1');
      expect(members).toContain('member2');
    });

    it('should check set membership', async () => {
      await service.sadd('test:set', 'member1');
      const isMember = await service.sismember('test:set', 'member1');
      expect(isMember).toBe(1);

      const isNotMember = await service.sismember('test:set', 'member2');
      expect(isNotMember).toBe(0);
    });

    it('should remove member from set', async () => {
      await service.sadd('test:set', 'member1');
      const removed = await service.srem('test:set', 'member1');
      expect(removed).toBe(1);

      const members = await service.smembers('test:set');
      expect(members).not.toContain('member1');
    });

    it('should remove multiple members from set', async () => {
      await service.sadd('test:set', ['member1', 'member2']);
      const removed = await service.srem('test:set', ['member1', 'member2']);
      expect(removed).toBe(2);
    });
  });

  describe('List Operations', () => {
    it('should push to left of list', async () => {
      await service.lpush('test:list', 'value1');
      await service.lpush('test:list', 'value2');

      const result = await service.lrange('test:list', 0, -1);
      expect(result[0]).toBe('value2');
      expect(result[1]).toBe('value1');
    });

    it('should push multiple values to left', async () => {
      await service.lpush('test:list', ['value1', 'value2']);
      const length = await service.llen('test:list');
      expect(length).toBe(2);
    });

    it('should push to right of list', async () => {
      await service.rpush('test:list', 'value1');
      await service.rpush('test:list', 'value2');

      const result = await service.lrange('test:list', 0, -1);
      expect(result[0]).toBe('value1');
      expect(result[1]).toBe('value2');
    });

    it('should push multiple values to right', async () => {
      await service.rpush('test:list', ['value1', 'value2']);
      const length = await service.llen('test:list');
      expect(length).toBe(2);
    });

    it('should pop from left of list', async () => {
      await service.rpush('test:list', ['value1', 'value2']);
      const popped = await service.lpop('test:list');
      expect(popped).toBe('value1');
    });

    it('should pop from right of list', async () => {
      await service.rpush('test:list', ['value1', 'value2']);
      const popped = await service.rpop('test:list');
      expect(popped).toBe('value2');
    });

    it('should get range of list', async () => {
      await service.rpush('test:list', ['v1', 'v2', 'v3', 'v4']);
      const range = await service.lrange('test:list', 1, 2);
      expect(range).toEqual(['v2', 'v3']);
    });

    it('should get list length', async () => {
      await service.rpush('test:list', ['v1', 'v2', 'v3']);
      const length = await service.llen('test:list');
      expect(length).toBe(3);
    });

    it('should trim list', async () => {
      await service.rpush('test:list', ['v1', 'v2', 'v3', 'v4']);
      await service.ltrim('test:list', 1, 2);

      const result = await service.lrange('test:list', 0, -1);
      expect(result).toEqual(['v2', 'v3']);
    });
  });

  describe('Sorted Set Operations', () => {
    it('should add member to sorted set', async () => {
      await service.zadd('test:zset', 1, 'member1');
      const members = await service.zrange('test:zset', 0, -1);
      expect(members).toContain('member1');
    });

    it('should add multiple members to sorted set', async () => {
      await service.zadd('test:zset', 1, 'member1', 2, 'member2');
      const members = await service.zrange('test:zset', 0, -1);
      expect(members).toContain('member1');
      expect(members).toContain('member2');
    });

    it('should get range from sorted set', async () => {
      await service.zadd('test:zset', 1, 'a', 2, 'b', 3, 'c');
      const range = await service.zrange('test:zset', 0, 1);
      expect(range).toEqual(['a', 'b']);
    });

    it('should get reverse range from sorted set', async () => {
      await service.zadd('test:zset', 1, 'a', 2, 'b', 3, 'c');
      const range = await service.zrevrange('test:zset', 0, 1);
      expect(range).toEqual(['c', 'b']);
    });

    it('should get cardinality of sorted set', async () => {
      await service.zadd('test:zset', 1, 'a', 2, 'b', 3, 'c');
      const card = await service.zcard('test:zset');
      expect(card).toBe(3);
    });

    it('should get score of member', async () => {
      await service.zadd('test:zset', 42, 'member');
      const score = await service.zscore('test:zset', 'member');
      expect(score).toBe('42');
    });

    it('should remove member from sorted set', async () => {
      await service.zadd('test:zset', 1, 'member1', 2, 'member2');
      const removed = await service.zrem('test:zset', 'member1');
      expect(removed).toBe(1);

      const members = await service.zrange('test:zset', 0, -1);
      expect(members).not.toContain('member1');
    });

    it('should remove multiple members from sorted set', async () => {
      await service.zadd('test:zset', 1, 'a', 2, 'b', 3, 'c');
      const removed = await service.zrem('test:zset', ['a', 'b']);
      expect(removed).toBe(2);
    });
  });

  describe('Pub/Sub Operations', () => {
    it('should publish and subscribe to channel', async () => {
      const subscriber = service.createSubscriber();
      const messages: string[] = [];

      subscriber.on('message', (channel, message) => {
        messages.push(message);
      });

      await subscriber.subscribe('test:channel');
      await delay(50);

      await service.publish('test:channel', 'test message');
      await delay(100);

      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0]).toBe('test message');

      await subscriber.quit();
    });

    it('should publish JSON data', async () => {
      const subscriber = service.createSubscriber();
      const messages: any[] = [];

      subscriber.on('message', (channel, message) => {
        messages.push(JSON.parse(message));
      });

      await subscriber.subscribe('test:json');
      await delay(50);

      await service.publish('test:json', { foo: 'bar' });
      await delay(100);

      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0].foo).toBe('bar');

      await subscriber.quit();
    });

    it('should create multiple subscribers', async () => {
      const sub1 = service.createSubscriber();
      const sub2 = service.createSubscriber();

      expect(sub1).toBeDefined();
      expect(sub2).toBeDefined();
      expect(sub1).not.toBe(sub2);

      await sub1.quit();
      await sub2.quit();
    });
  });

  describe('Pipeline Operations', () => {
    it('should execute pipeline commands', async () => {
      const pipeline = service.pipeline();

      pipeline.set('test:pipe1', 'value1');
      pipeline.set('test:pipe2', 'value2');
      pipeline.get('test:pipe1');
      pipeline.get('test:pipe2');

      const results = await pipeline.exec();
      expect(results).toBeDefined();
      expect(results?.length).toBe(4);
    });

    it('should handle pipeline errors gracefully', async () => {
      const pipeline = service.pipeline();

      pipeline.set('test:pipe', 'value');
      pipeline.zadd('test:pipe', 1, 'member'); // This will fail - wrong type

      const results = await pipeline.exec();
      expect(results).toBeDefined();
      expect(results?.[0]?.[0]).toBeNull(); // First should succeed
      expect(results?.[1]?.[0]).not.toBeNull(); // Second should have error
    });
  });

  describe('Transaction Operations', () => {
    it('should execute multi/exec transaction', async () => {
      const multi = service.multi();

      multi.set('test:trans1', 'value1');
      multi.set('test:trans2', 'value2');

      const results = await multi.exec();
      expect(results).toBeDefined();
      expect(results?.length).toBe(2);

      const value1 = await service.get('test:trans1');
      const value2 = await service.get('test:trans2');

      expect(value1).toBe('value1');
      expect(value2).toBe('value2');
    });
  });

  describe('Script Operations', () => {
    const testScript = `
      redis.call('SET', KEYS[1], ARGV[1])
      return redis.call('GET', KEYS[1])
    `;

    it('should load and run script', async () => {
      const sha = await service.loadScript('testScript', testScript);
      expect(sha).toBeDefined();
      expect(typeof sha).toBe('string');
    });

    it('should evaluate script directly', async () => {
      const result = await service.eval(testScript, 1, 'test:eval:key', 'test:eval:value');
      expect(result).toBe('test:eval:value');
    });

    it('should evaluate script by SHA', async () => {
      const sha = await service.loadScript('test', testScript);
      const result = await service.evalsha(sha, 1, 'test:evalsha:key', 'test:evalsha:value');
      expect(result).toBe('test:evalsha:value');
    });
  });

  describe('Database Operations', () => {
    it('should flush database', async () => {
      await service.set('test:flush', 'value');
      await service.flushdb();

      const result = await service.get('test:flush');
      expect(result).toBeNull();
    });

    it('should flush all databases', async () => {
      await service.set('test:flushall', 'value');
      await service.flushall();

      const result = await service.get('test:flushall');
      expect(result).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle null values gracefully', async () => {
      const result = await service.get('nonexistent:key');
      expect(result).toBeNull();
    });

    it('should handle empty arrays', async () => {
      const deleted = await service.del([]);
      expect(deleted).toBe(0);
    });

    it('should handle numeric values', async () => {
      await service.set('test:number', 42);
      const result = await service.get('test:number');
      expect(result).toBe('42');
    });

    it('should handle large values', async () => {
      const largeValue = 'x'.repeat(10000);
      await service.set('test:large', largeValue);
      const result = await service.get('test:large');
      expect(result).toBe(largeValue);
    });

    it('should handle special characters in keys', async () => {
      const key = 'test:special:@#$%^&*()';
      await service.set(key, 'value');
      const result = await service.get(key);
      expect(result).toBe('value');
    });
  });
});
