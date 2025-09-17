import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing.js';
import { INestApplication } from '@nestjs/common.js';
import { RedisManager } from '../../../src/modules/redis/redis.manager.js';
import { RedisService } from '../../../src/modules/redis/redis.service.js';
import { RedisHealthIndicator } from '../../../src/modules/redis/redis.health.js';
import { TitanRedisModule } from '../../../src/modules/redis/redis.module';
import { RedisCache, RedisLock, RedisRateLimit } from '../../../src/modules/redis/redis.decorators.js';
import { Redis } from 'ioredis';

describe('Redis Module Integration Tests (Real Redis)', () => {
  let app: INestApplication;
  let module: TestingModule;
  let redisManager: RedisManager;
  let redisService: RedisService;
  let healthIndicator: RedisHealthIndicator;
  let testNamespace: string;

  beforeAll(async () => {
    // Check if Redis is available at localhost:6379
    const testConnection = new Redis({
      host: 'localhost',
      port: 6379,
      retryStrategy: () => null,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });

    try {
      await testConnection.connect();
      await testConnection.ping();
      await testConnection.quit();
    } catch (error) {
      console.error('Redis is not available at localhost:6379. Please start Redis before running tests.');
      throw error;
    }

    // Generate unique namespace for this test run
    testNamespace = `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Create test module with multiple Redis clients
    module = await Test.createTestingModule({
      imports: [
        TitanRedisModule.forRoot({
          clients: [
            {
              namespace: 'default',
              host: 'localhost',
              port: 6379,
              db: 15,
              keyPrefix: `${testNamespace}:default:`,
            },
            {
              namespace: 'cache',
              host: 'localhost',
              port: 6379,
              db: 14,
              keyPrefix: `${testNamespace}:cache:`,
              enableOfflineQueue: true,
              maxRetriesPerRequest: 5,
            },
            {
              namespace: 'pubsub',
              host: 'localhost',
              port: 6379,
              db: 13,
              keyPrefix: `${testNamespace}:pubsub:`,
            },
          ],
          scripts: [
            {
              name: 'testScript',
              content: `
                local key = KEYS[1]
                local value = ARGV[1]
                redis.call('SET', key, value)
                return redis.call('GET', key)
              `,
            },
          ],
        }),
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();

    redisManager = module.get<RedisManager>(RedisManager);
    redisService = module.get<RedisService>(RedisService);
    healthIndicator = module.get<RedisHealthIndicator>(RedisHealthIndicator);
  });

  afterAll(async () => {
    // Clean up all test data
    try {
      for (const namespace of ['default', 'cache', 'pubsub']) {
        const client = redisManager.getClient(namespace) as Redis;
        if (client) {
          const keys = await client.keys(`${testNamespace}:*`);
          if (keys.length > 0) {
            await client.del(...keys);
          }
        }
      }
    } catch (error) {
      console.warn('Error cleaning up test data:', error);
    }

    await app?.close();
  });

  beforeEach(async () => {
    // Clean up test data before each test
    try {
      for (const namespace of ['default', 'cache', 'pubsub']) {
        const client = redisManager.getClient(namespace) as Redis;
        if (client) {
          const keys = await client.keys(`${testNamespace}:*`);
          if (keys.length > 0) {
            await client.del(...keys);
          }
        }
      }
    } catch (error) {
      console.warn('Error cleaning up test data:', error);
    }
  });

  describe('Multi-Client Management', () => {
    it('should manage multiple Redis clients with isolation', async () => {
      await redisService.set('key1', 'value1', 'default');
      await redisService.set('key2', 'value2', 'cache');
      await redisService.set('key3', 'value3', 'pubsub');

      const val1 = await redisService.get('key1', 'default');
      const val2 = await redisService.get('key2', 'cache');
      const val3 = await redisService.get('key3', 'pubsub');

      expect(val1).toBe('value1');
      expect(val2).toBe('value2');
      expect(val3).toBe('value3');

      // Verify isolation between namespaces
      expect(await redisService.get('key1', 'cache')).toBeNull();
      expect(await redisService.get('key2', 'pubsub')).toBeNull();
      expect(await redisService.get('key3', 'default')).toBeNull();
    });

    it('should dynamically create and destroy clients', async () => {
      const dynamicClient = await redisManager.createClient({
        namespace: 'dynamic',
        host: 'localhost',
        port: 6379,
        db: 12,
        keyPrefix: `${testNamespace}:dynamic:`,
      });

      expect(dynamicClient).toBeDefined();

      await redisService.set('dynamic-key', 'dynamic-value', 'dynamic');
      const value = await redisService.get('dynamic-key', 'dynamic');
      expect(value).toBe('dynamic-value');

      await redisManager.destroyClient('dynamic');

      expect(() => redisManager.getClient('dynamic')).toThrow();
    });

    it('should handle concurrent operations across multiple clients', async () => {
      const operations = [];
      const concurrency = 100;

      for (let i = 0; i < concurrency; i++) {
        operations.push(
          redisService.set(`concurrent-${i}`, `value-${i}`, 'default'),
          redisService.set(`concurrent-${i}`, `cache-${i}`, 'cache'),
          redisService.incr(`counter-${i}`, 'default')
        );
      }

      await Promise.all(operations);

      // Verify all operations succeeded
      const val50 = await redisService.get('concurrent-50', 'default');
      const cache50 = await redisService.get('concurrent-50', 'cache');
      const counter50 = await redisService.get('counter-50', 'default');

      expect(val50).toBe('value-50');
      expect(cache50).toBe('cache-50');
      expect(counter50).toBe('1');
    });
  });

  describe('Basic Operations', () => {
    it('should perform all string operations', async () => {
      // SET and GET
      await redisService.set('str', 'hello');
      expect(await redisService.get('str')).toBe('hello');

      // SETEX
      await redisService.setex('temp', 2, 'temporary');
      expect(await redisService.get('temp')).toBe('temporary');
      expect(await redisService.ttl('temp')).toBeGreaterThan(0);
      expect(await redisService.ttl('temp')).toBeLessThanOrEqual(2);

      // SETNX
      expect(await redisService.setnx('str', 'world')).toBe(0);
      expect(await redisService.setnx('new', 'value')).toBe(1);

      // INCR/DECR
      await redisService.set('counter', '0');
      expect(await redisService.incr('counter')).toBe(1);
      expect(await redisService.incrby('counter', 5)).toBe(6);
      expect(await redisService.decr('counter')).toBe(5);
      expect(await redisService.decrby('counter', 3)).toBe(2);

      // EXISTS and DEL
      expect(await redisService.exists('str')).toBe(1);
      await redisService.del('str');
      expect(await redisService.exists('str')).toBe(0);

      // EXPIRE
      await redisService.set('expiring', 'value');
      await redisService.expire('expiring', 1);
      expect(await redisService.ttl('expiring')).toBeGreaterThan(0);
    });

    it('should perform all hash operations', async () => {
      await redisService.hset('hash', 'field1', 'value1');
      await redisService.hset('hash', 'field2', 'value2');
      await redisService.hset('hash', 'field3', 'value3');

      expect(await redisService.hget('hash', 'field1')).toBe('value1');

      const allFields = await redisService.hgetall('hash');
      expect(allFields).toEqual({
        field1: 'value1',
        field2: 'value2',
        field3: 'value3',
      });

      await redisService.hdel('hash', 'field2');
      expect(await redisService.hget('hash', 'field2')).toBeNull();

      const remaining = await redisService.hgetall('hash');
      expect(Object.keys(remaining)).toHaveLength(2);
    });

    it('should perform all set operations', async () => {
      await redisService.sadd('set', 'member1', 'member2', 'member3');

      expect(await redisService.sismember('set', 'member1')).toBe(1);
      expect(await redisService.sismember('set', 'member4')).toBe(0);

      const members = await redisService.smembers('set');
      expect(members.sort()).toEqual(['member1', 'member2', 'member3']);

      await redisService.srem('set', 'member2');
      const afterRemoval = await redisService.smembers('set');
      expect(afterRemoval).toHaveLength(2);
      expect(afterRemoval).not.toContain('member2');
    });

    it('should perform all list operations', async () => {
      await redisService.rpush('list', 'first', 'second');
      await redisService.lpush('list', 'zero');
      await redisService.rpush('list', 'third');

      expect(await redisService.llen('list')).toBe(4);
      expect(await redisService.lrange('list', 0, -1)).toEqual([
        'zero',
        'first',
        'second',
        'third',
      ]);

      expect(await redisService.lpop('list')).toBe('zero');
      expect(await redisService.rpop('list')).toBe('third');
      expect(await redisService.llen('list')).toBe(2);
    });

    it('should perform all sorted set operations', async () => {
      await redisService.zadd('zset', 1, 'one', 2, 'two', 3, 'three', 4, 'four');

      expect(await redisService.zcard('zset')).toBe(4);
      expect(await redisService.zscore('zset', 'two')).toBe('2');

      expect(await redisService.zrange('zset', 0, 2)).toEqual(['one', 'two', 'three']);
      expect(await redisService.zrevrange('zset', 0, 1)).toEqual(['four', 'three']);

      await redisService.zrem('zset', 'two');
      expect(await redisService.zcard('zset')).toBe(3);
      expect(await redisService.zscore('zset', 'two')).toBeNull();
    });
  });

  describe('Transactions', () => {
    it('should execute multi/exec transactions', async () => {
      const multi = await redisService.multi();

      multi
        .set('tx1', 'value1')
        .set('tx2', 'value2')
        .incr('tx-counter')
        .sadd('tx-set', 'member1', 'member2')
        .hset('tx-hash', 'field', 'value');

      const results = await multi.exec();

      expect(results).toHaveLength(5);
      expect(results![0][1]).toBe('OK');
      expect(results![1][1]).toBe('OK');
      expect(results![2][1]).toBe(1);
      expect(results![3][1]).toBe(2);
      expect(results![4][1]).toBe(1);

      // Verify transaction results
      expect(await redisService.get('tx1')).toBe('value1');
      expect(await redisService.get('tx2')).toBe('value2');
      expect(await redisService.get('tx-counter')).toBe('1');
      expect(await redisService.smembers('tx-set')).toHaveLength(2);
      expect(await redisService.hget('tx-hash', 'field')).toBe('value');
    });

    it('should handle transaction errors gracefully', async () => {
      await redisService.set('not-a-number', 'string-value');

      const multi = await redisService.multi();
      multi
        .set('tx1', 'value1')
        .incr('not-a-number')  // This will fail
        .set('tx2', 'value2');

      const results = await multi.exec();

      // Redis executes all commands, even if one fails
      expect(results![0][1]).toBe('OK');
      expect(results![1][0]).toBeInstanceOf(Error);
      expect(results![2][1]).toBe('OK');
    });

    it('should support watch/unwatch for optimistic locking', async () => {
      const client1 = redisManager.getClient() as Redis;
      const client2 = redisManager.getClient() as Redis;

      await client1.set('watched', '1');

      // Client 1 watches the key
      await client1.watch('watched');

      // Client 2 modifies the key
      await client2.set('watched', '2');

      // Client 1's transaction should abort
      const multi = client1.multi();
      multi.set('watched', '3');
      const results = await multi.exec();

      expect(results).toBeNull();  // Transaction aborted

      // Verify final value
      expect(await client1.get('watched')).toBe('2');
    });
  });

  describe('Pipeline Operations', () => {
    it('should execute pipeline operations efficiently', async () => {
      const pipeline = await redisService.pipeline();
      const count = 1000;

      for (let i = 0; i < count; i++) {
        pipeline.set(`pipeline-${i}`, `value-${i}`);
      }

      const start = Date.now();
      const results = await pipeline.exec();
      const duration = Date.now() - start;

      expect(results).toHaveLength(count);
      expect(results!.every(r => r[1] === 'OK')).toBe(true);
      expect(duration).toBeLessThan(1000);  // Should complete quickly

      // Verify sample values
      expect(await redisService.get('pipeline-0')).toBe('value-0');
      expect(await redisService.get('pipeline-500')).toBe('value-500');
      expect(await redisService.get('pipeline-999')).toBe('value-999');
    });

    it('should handle mixed operations in pipeline', async () => {
      const pipeline = await redisService.pipeline();

      pipeline
        .set('key1', 'value1')
        .get('key1')
        .incr('counter')
        .hset('hash', 'field', 'value')
        .hget('hash', 'field')
        .sadd('set', 'member1', 'member2')
        .smembers('set')
        .zadd('zset', 1, 'one', 2, 'two')
        .zrange('zset', 0, -1);

      const results = await pipeline.exec();

      expect(results![0][1]).toBe('OK');
      expect(results![1][1]).toBe('value1');
      expect(results![2][1]).toBe(1);
      expect(results![3][1]).toBe(1);
      expect(results![4][1]).toBe('value');
      expect(results![5][1]).toBe(2);
      expect(results![6][1].sort()).toEqual(['member1', 'member2']);
      expect(results![8][1]).toEqual(['one', 'two']);
    });
  });

  describe('Pub/Sub Operations', () => {
    it('should handle pub/sub messaging', async () => {
      const channelName = `${testNamespace}:test-channel`;
      const messages: string[] = [];

      // Create subscriber
      const subscriber = await redisService.createSubscriber('pubsub');

      // Set up promise for message collection
      const messagePromise = new Promise<void>((resolve) => {
        subscriber.on('message', (channel, message) => {
          if (channel === channelName) {
            messages.push(message);
            if (messages.length === 3) {
              resolve();
            }
          }
        });
      });

      await subscriber.subscribe(channelName);

      // Allow subscription to establish
      await new Promise(resolve => setTimeout(resolve, 100));

      // Publish messages
      await redisService.publish(channelName, 'msg1', 'pubsub');
      await redisService.publish(channelName, 'msg2', 'pubsub');
      await redisService.publish(channelName, 'msg3', 'pubsub');

      // Wait for messages with timeout
      await Promise.race([
        messagePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
      ]);

      expect(messages).toEqual(['msg1', 'msg2', 'msg3']);

      await subscriber.unsubscribe();
      await subscriber.quit();
    });

    it('should handle pattern subscriptions', async () => {
      const patternPrefix = `${testNamespace}:pattern`;
      const messages: Array<{ channel: string; message: string }> = [];

      const subscriber = await redisService.createSubscriber('pubsub');

      // Set up promise for message collection
      const messagePromise = new Promise<void>((resolve) => {
        subscriber.on('pmessage', (pattern, channel, message) => {
          if (channel.startsWith(patternPrefix)) {
            const relativeChannel = channel.replace(`${patternPrefix}:`, '');
            messages.push({ channel: relativeChannel, message });
            if (messages.length === 3) {
              resolve();
            }
          }
        });
      });

      await subscriber.psubscribe(
        `${patternPrefix}:user:*`,
        `${patternPrefix}:order:*`
      );

      // Allow subscription to establish
      await new Promise(resolve => setTimeout(resolve, 100));

      // Publish to different channels
      await redisService.publish(`${patternPrefix}:user:1`, 'action1', 'pubsub');
      await redisService.publish(`${patternPrefix}:user:2`, 'action2', 'pubsub');
      await redisService.publish(`${patternPrefix}:order:1`, 'created', 'pubsub');
      await redisService.publish(`${patternPrefix}:other:1`, 'ignored', 'pubsub');

      // Wait for messages with timeout
      await Promise.race([
        messagePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
      ]);

      expect(messages).toEqual([
        { channel: 'user:1', message: 'action1' },
        { channel: 'user:2', message: 'action2' },
        { channel: 'order:1', message: 'created' },
      ]);

      await subscriber.punsubscribe();
      await subscriber.quit();
    });
  });

  describe('Lua Script Execution', () => {
    it('should execute inline Lua scripts', async () => {
      const script = `
        local key = KEYS[1]
        local increment = tonumber(ARGV[1])
        local current = redis.call('GET', key)
        if current then
          return redis.call('INCRBY', key, increment)
        else
          redis.call('SET', key, increment)
          return increment
        end
      `;

      const result1 = await redisService.eval(script, ['lua-counter'], ['10']);
      expect(result1).toBe(10);

      const result2 = await redisService.eval(script, ['lua-counter'], ['5']);
      expect(result2).toBe(15);
    });

    it('should execute cached scripts with EVALSHA', async () => {
      const script = 'return redis.call("GET", KEYS[1])';

      // Load script
      const sha = await redisService.loadScript(script);
      expect(sha).toHaveLength(40);

      // Set test value
      await redisService.set('script-test', 'cached-value');

      // Execute using SHA
      const result = await redisService.evalsha(sha, ['script-test'], []);
      expect(result).toBe('cached-value');
    });

    it('should execute preloaded scripts from module config', async () => {
      // This script was loaded in module configuration
      const result = await redisManager.runScript(
        'testScript',
        ['script-key'],
        ['script-value']
      );

      expect(result).toBe('script-value');

      // Verify value was set
      expect(await redisService.get('script-key')).toBe('script-value');
    });

    it('should handle complex Lua operations', async () => {
      const script = `
        local results = {}
        for i = 1, #KEYS do
          local key = KEYS[i]
          local value = ARGV[i]
          redis.call('SET', key, value)
          table.insert(results, redis.call('GET', key))
        end
        return results
      `;

      const result = await redisService.eval(
        script,
        ['lua1', 'lua2', 'lua3'],
        ['val1', 'val2', 'val3']
      );

      expect(result).toEqual(['val1', 'val2', 'val3']);
    });
  });

  describe('Health Monitoring', () => {
    it('should report health status for all clients', async () => {
      const health = await healthIndicator.checkAll();

      expect(health.redis.status).toBe('up');
      expect(health.redis.clients).toHaveProperty('default');
      expect(health.redis.clients).toHaveProperty('cache');
      expect(health.redis.clients).toHaveProperty('pubsub');

      Object.values(health.redis.clients).forEach((client: any) => {
        expect(client.healthy).toBe(true);
        expect(client.latency).toBeGreaterThanOrEqual(0);
        expect(client.latency).toBeLessThan(100);
      });
    });

    it('should measure latency accurately', async () => {
      const result = await healthIndicator.isHealthy('redis');

      expect(result.redis.status).toBe('up');
      expect(result.redis.healthy).toBe(true);
      expect(result.redis.latency).toBeGreaterThanOrEqual(0);
      expect(result.redis.latency).toBeLessThan(50);  // Should be fast on localhost
    });

    it('should perform ping checks', async () => {
      const result = await healthIndicator.ping();

      expect(result.redis.status).toBe('up');
      expect(result.redis.ping).toBe('PONG');
    });

    it('should check connection status', async () => {
      const result = await healthIndicator.checkConnection();

      expect(result.redis.status).toBe('up');
      expect(result.redis.connected).toBe(true);
    });
  });

  describe('Advanced Features', () => {
    it('should handle binary data', async () => {
      const client = redisManager.getClient() as Redis;
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]);

      await client.set('binary', binaryData);
      const retrieved = await client.getBuffer('binary');

      expect(retrieved).toEqual(binaryData);
      expect(retrieved).toBeInstanceOf(Buffer);
    });

    it('should handle large data efficiently', async () => {
      const largeString = 'x'.repeat(1024 * 1024);  // 1MB string

      const start = Date.now();
      await redisService.set('large', largeString);
      const retrieved = await redisService.get('large');
      const duration = Date.now() - start;

      expect(retrieved).toBe(largeString);
      expect(duration).toBeLessThan(500);  // Should be fast even for 1MB
    });

    it('should handle complex JSON data', async () => {
      const complexData = {
        id: 'test-123',
        timestamp: new Date().toISOString(),
        nested: {
          level1: {
            level2: {
              level3: {
                data: Array.from({ length: 100 }, (_, i) => ({
                  id: i,
                  value: `item-${i}`,
                  metadata: { tags: [`tag-${i}`] },
                })),
              },
            },
          },
        },
        binary: Buffer.from([1, 2, 3, 4, 5]).toString('base64'),
      };

      await redisService.set('complex', JSON.stringify(complexData));
      const retrieved = JSON.parse((await redisService.get('complex'))!);

      expect(retrieved).toEqual(complexData);
    });

    it('should handle high concurrency without data races', async () => {
      const key = 'concurrent-counter';
      const operations = 1000;
      const promises = [];

      await redisService.set(key, '0');

      for (let i = 0; i < operations; i++) {
        promises.push(redisService.incr(key));
      }

      const results = await Promise.all(promises);

      // All increments should be unique
      const uniqueResults = new Set(results);
      expect(uniqueResults.size).toBe(operations);

      // Final value should be exact
      const finalValue = await redisService.get(key);
      expect(finalValue).toBe(operations.toString());
    });

    it('should support scanning large keyspaces', async () => {
      // Create many keys
      const keyCount = 100;
      for (let i = 0; i < keyCount; i++) {
        await redisService.set(`scan-key-${i}`, `value-${i}`);
      }

      const client = redisManager.getClient() as Redis;
      const keys: string[] = [];
      let cursor = '0';

      // Scan through all keys
      do {
        const [newCursor, batch] = await client.scan(cursor, 'MATCH', `${testNamespace}:default:scan-key-*`, 'COUNT', 10);
        cursor = newCursor;
        keys.push(...batch);
      } while (cursor !== '0');

      expect(keys).toHaveLength(keyCount);
    });
  });

  describe('Decorator Integration', () => {
    it('should work with @RedisCache decorator', async () => {
      let callCount = 0;

      class TestService {
        private redisManager = redisManager;

        @RedisCache({ ttl: 2, key: 'decorator-cache' })
        async getData(id: number): Promise<string> {
          callCount++;
          return `data-${id}`;
        }
      }

      const service = new TestService();

      // First call - should execute method
      const result1 = await service.getData(1);
      expect(result1).toBe('data-1');
      expect(callCount).toBe(1);

      // Second call - should use cache
      const result2 = await service.getData(1);
      expect(result2).toBe('data-1');
      expect(callCount).toBe(1);

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 2100));

      // Third call - cache expired, should execute method
      const result3 = await service.getData(1);
      expect(result3).toBe('data-1');
      expect(callCount).toBe(2);
    });

    it('should work with @RedisLock decorator', async () => {
      const executionOrder: number[] = [];

      class TestService {
        private redisManager = redisManager;

        @RedisLock({ key: 'decorator-lock', ttl: 1 })
        async process(id: number): Promise<void> {
          executionOrder.push(id);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      const service = new TestService();

      // Try to execute concurrently with same ID
      const promises = [
        service.process(1),
        service.process(1).catch(() => { }),  // Should fail due to lock
        service.process(2),  // Different ID, should work
      ];

      await Promise.allSettled(promises);

      // Only one call with ID 1 should succeed
      const count1 = executionOrder.filter(id => id === 1).length;
      expect(count1).toBe(1);
      expect(executionOrder).toContain(2);
    });

    it('should work with @RedisRateLimit decorator', async () => {
      let successCount = 0;

      class TestService {
        private redisManager = redisManager;

        @RedisRateLimit({ key: 'decorator-rate', limit: 3, window: 1 })
        async callApi(userId: number): Promise<string> {
          successCount++;
          return `called-${userId}`;
        }
      }

      const service = new TestService();

      // Should allow first 3 calls
      await expect(service.callApi(1)).resolves.toBe('called-1');
      await expect(service.callApi(1)).resolves.toBe('called-1');
      await expect(service.callApi(1)).resolves.toBe('called-1');

      // Fourth call should fail
      await expect(service.callApi(1)).rejects.toThrow('Rate limit exceeded');

      expect(successCount).toBe(3);

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should allow again
      await expect(service.callApi(1)).resolves.toBe('called-1');
      expect(successCount).toBe(4);
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should handle and recover from command errors', async () => {
      const client = redisManager.getClient() as Redis;

      // Try invalid operation
      try {
        await client.eval('invalid lua syntax', 0);
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('ERR');
      }

      // Should still work after error
      await redisService.set('after-error', 'works');
      expect(await redisService.get('after-error')).toBe('works');
    });

    it('should handle memory pressure gracefully', async () => {
      const promises = [];
      const keyCount = 10000;

      // Try to create many keys
      for (let i = 0; i < keyCount; i++) {
        promises.push(
          redisService.set(`memory-test-${i}`, 'x'.repeat(100))
            .catch(() => null)  // Ignore errors if memory limit hit
        );
      }

      const results = await Promise.all(promises);
      const successCount = results.filter(r => r !== null).length;

      // Should have created at least some keys
      expect(successCount).toBeGreaterThan(0);

      // Clean up
      const client = redisManager.getClient() as Redis;
      const keys = await client.keys(`${testNamespace}:default:memory-test-*`);
      if (keys.length > 0) {
        await client.del(...keys);
      }

      // Should still be operational
      await redisService.set('after-memory-test', 'ok');
      expect(await redisService.get('after-memory-test')).toBe('ok');
    });

    it('should handle network interruptions', async () => {
      // Create a client with aggressive timeout
      const tempClient = await redisManager.createClient({
        namespace: 'timeout-test',
        host: 'localhost',
        port: 6379,
        db: 12,
        commandTimeout: 1,  // 1ms timeout - will likely timeout
        retryStrategy: () => null,
      });

      // Try operation that might timeout
      try {
        await tempClient.get('test');
      } catch (error: any) {
        // Expected to potentially timeout
      }

      // Clean up
      await redisManager.destroyClient('timeout-test');

      // Main clients should still work
      await redisService.set('after-timeout', 'ok');
      expect(await redisService.get('after-timeout')).toBe('ok');
    });
  });

  describe('Module Configuration', () => {
    it('should support async configuration', async () => {
      const asyncModule = await Test.createTestingModule({
        imports: [
          TitanRedisModule.forRootAsync({
            useFactory: async () => ({
              clients: [
                {
                  namespace: 'async-config',
                  host: 'localhost',
                  port: 6379,
                  db: 10,
                  keyPrefix: `${testNamespace}:async:`,
                },
              ],
            }),
          }),
        ],
      }).compile();

      const asyncApp = asyncModule.createNestApplication();
      await asyncApp.init();

      const asyncService = asyncApp.get<RedisService>(RedisService);
      await asyncService.set('async-key', 'async-value', 'async-config');
      const value = await asyncService.get('async-key', 'async-config');
      expect(value).toBe('async-value');

      // Clean up
      const asyncManager = asyncApp.get<RedisManager>(RedisManager);
      const client = asyncManager.getClient('async-config') as Redis;
      const keys = await client.keys(`${testNamespace}:async:*`);
      if (keys.length > 0) {
        await client.del(...keys);
      }

      await asyncApp.close();
    });

    it('should support feature modules', async () => {
      const featureModule = await Test.createTestingModule({
        imports: [
          TitanRedisModule.forRoot({
            clients: [
              {
                namespace: 'feature',
                host: 'localhost',
                port: 6379,
                db: 9,
                keyPrefix: `${testNamespace}:feature:`,
              },
            ],
          }),
          TitanRedisModule.forFeature(['feature']),
        ],
      }).compile();

      const featureApp = featureModule.createNestApplication();
      await featureApp.init();

      const featureService = featureApp.get<RedisService>(RedisService);
      await featureService.set('feature-key', 'feature-value', 'feature');
      const value = await featureService.get('feature-key', 'feature');
      expect(value).toBe('feature-value');

      // Clean up
      const featureManager = featureApp.get<RedisManager>(RedisManager);
      const client = featureManager.getClient('feature') as Redis;
      const keys = await client.keys(`${testNamespace}:feature:*`);
      if (keys.length > 0) {
        await client.del(...keys);
      }

      await featureApp.close();
    });
  });

  describe('Performance Benchmarks', () => {
    it('should handle high-throughput operations', async () => {
      const operations = 5000;
      const start = Date.now();

      const promises = [];
      for (let i = 0; i < operations; i++) {
        promises.push(redisService.set(`perf-${i}`, `value-${i}`));
      }

      await Promise.all(promises);
      const writeTime = Date.now() - start;

      const readStart = Date.now();
      const readPromises = [];
      for (let i = 0; i < operations; i++) {
        readPromises.push(redisService.get(`perf-${i}`));
      }

      const results = await Promise.all(readPromises);
      const readTime = Date.now() - readStart;

      // Verify correctness
      expect(results[0]).toBe('value-0');
      expect(results[operations - 1]).toBe(`value-${operations - 1}`);

      // Performance expectations
      expect(writeTime).toBeLessThan(5000);  // 5000 writes in < 5s
      expect(readTime).toBeLessThan(5000);   // 5000 reads in < 5s

      console.log(`Performance: ${operations} writes in ${writeTime}ms, ${operations} reads in ${readTime}ms`);
    });

    it('should efficiently handle batched operations', async () => {
      const batchSize = 1000;
      const pipeline = await redisService.pipeline();

      for (let i = 0; i < batchSize; i++) {
        pipeline.set(`batch-${i}`, `value-${i}`);
        pipeline.expire(`batch-${i}`, 60);
      }

      const start = Date.now();
      const results = await pipeline.exec();
      const duration = Date.now() - start;

      expect(results).toHaveLength(batchSize * 2);
      expect(duration).toBeLessThan(500);  // Should be very fast

      console.log(`Batch performance: ${batchSize * 2} operations in ${duration}ms`);
    });
  });
});