import { RedisService } from '../../../src/modules/redis/redis.service.js';
import { RedisManager } from '../../../src/modules/redis/redis.manager.js';
import { Redis } from 'ioredis';

describe('RedisService', () => {
  let service: RedisService;
  let mockManager: jest.Mocked<RedisManager>;
  let mockRedisClient: jest.Mocked<Redis>;

  beforeEach(() => {
    mockRedisClient = {
      status: 'ready',
      get: jest.fn(),
      set: jest.fn(),
      setex: jest.fn(),
      setnx: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      incr: jest.fn(),
      incrby: jest.fn(),
      decr: jest.fn(),
      decrby: jest.fn(),
      expire: jest.fn(),
      ttl: jest.fn(),
      hget: jest.fn(),
      hset: jest.fn(),
      hgetall: jest.fn(),
      hdel: jest.fn(),
      sadd: jest.fn(),
      srem: jest.fn(),
      smembers: jest.fn(),
      sismember: jest.fn(),
      lpush: jest.fn(),
      rpush: jest.fn(),
      lpop: jest.fn(),
      rpop: jest.fn(),
      lrange: jest.fn(),
      llen: jest.fn(),
      zadd: jest.fn(),
      zrem: jest.fn(),
      zrange: jest.fn(),
      zrevrange: jest.fn(),
      zcard: jest.fn(),
      zscore: jest.fn(),
      publish: jest.fn(),
      pipeline: jest.fn().mockReturnThis(),
      multi: jest.fn().mockReturnThis(),
      duplicate: jest.fn().mockReturnThis(),
      script: jest.fn(),
      eval: jest.fn(),
      evalsha: jest.fn(),
      flushdb: jest.fn(),
      flushall: jest.fn(),
      ping: jest.fn().mockResolvedValue('PONG'),
    } as any;

    mockManager = {
      getClient: jest.fn().mockReturnValue(mockRedisClient),
      isHealthy: jest.fn().mockResolvedValue(true),
      runScript: jest.fn(),
    } as any;

    service = new RedisService(mockManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getClient', () => {
    it('should get client from manager', () => {
      const client = service.getClient();
      expect(client).toBe(mockRedisClient);
      expect(mockManager.getClient).toHaveBeenCalledWith(undefined);
    });

    it('should get client with namespace', () => {
      const client = service.getClient('cache');
      expect(client).toBe(mockRedisClient);
      expect(mockManager.getClient).toHaveBeenCalledWith('cache');
    });
  });

  describe('getOrThrow', () => {
    it('should return client when exists', () => {
      const client = service.getOrThrow();
      expect(client).toBe(mockRedisClient);
    });

    it('should throw error when client not found', () => {
      mockManager.getClient.mockImplementation(() => {
        throw new Error('Client not found');
      });

      expect(() => service.getOrThrow('non-existent')).toThrow();
    });
  });

  describe('getOrNil', () => {
    it('should return client when exists', () => {
      const client = service.getOrNil();
      expect(client).toBe(mockRedisClient);
    });

    it('should return null when client not found', () => {
      mockManager.getClient.mockImplementation(() => {
        throw new Error('Client not found');
      });

      const client = service.getOrNil('non-existent');
      expect(client).toBeNull();
    });
  });

  describe('ping', () => {
    it('should ping redis', async () => {
      const result = await service.ping();
      expect(result).toBe(true);
      expect(mockManager.isHealthy).toHaveBeenCalledWith(undefined);
    });
  });

  describe('isReady', () => {
    it('should check if client is ready', () => {
      const ready = service.isReady();
      expect(ready).toBe(true);
    });

    it('should return false when not ready', () => {
      mockRedisClient.status = 'connecting' as any;
      const ready = service.isReady();
      expect(ready).toBe(false);
    });
  });

  describe('loadScript', () => {
    it('should load script', async () => {
      mockRedisClient.script.mockResolvedValue('sha123');

      const sha = await service.loadScript('test', 'return 1');

      expect(sha).toBe('sha123');
      expect(mockRedisClient.script).toHaveBeenCalledWith('LOAD', 'return 1');
    });
  });

  describe('runScript', () => {
    it('should run script through manager', async () => {
      mockManager.runScript.mockResolvedValue('result');

      const result = await service.runScript('test', ['key1'], ['arg1']);

      expect(result).toBe('result');
      expect(mockManager.runScript).toHaveBeenCalledWith(
        'test',
        ['key1'],
        ['arg1'],
        undefined,
      );
    });
  });

  describe('createSubscriber', () => {
    it('should create subscriber', () => {
      const subscriber = service.createSubscriber();

      expect(subscriber).toBe(mockRedisClient);
      expect(mockRedisClient.duplicate).toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    it('should publish message', async () => {
      mockRedisClient.publish.mockResolvedValue(1);

      const count = await service.publish('channel', { data: 'test' });

      expect(count).toBe(1);
      expect(mockRedisClient.publish).toHaveBeenCalledWith(
        'channel',
        '{"data":"test"}',
      );
    });

    it('should publish string message', async () => {
      mockRedisClient.publish.mockResolvedValue(1);

      const count = await service.publish('channel', 'test');

      expect(count).toBe(1);
      expect(mockRedisClient.publish).toHaveBeenCalledWith('channel', 'test');
    });
  });

  describe('pipeline', () => {
    it('should create pipeline', () => {
      const pipeline = service.pipeline();

      expect(pipeline).toBe(mockRedisClient);
      expect(mockRedisClient.pipeline).toHaveBeenCalled();
    });
  });

  describe('multi', () => {
    it('should create multi', () => {
      const multi = service.multi();

      expect(multi).toBe(mockRedisClient);
      expect(mockRedisClient.multi).toHaveBeenCalled();
    });
  });

  describe('key-value operations', () => {
    it('should get value', async () => {
      mockRedisClient.get.mockResolvedValue('value');

      const value = await service.get('key');

      expect(value).toBe('value');
      expect(mockRedisClient.get).toHaveBeenCalledWith('key');
    });

    it('should set value', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      const result = await service.set('key', 'value');

      expect(result).toBe('OK');
      expect(mockRedisClient.set).toHaveBeenCalledWith('key', 'value');
    });

    it('should set value with TTL', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      const result = await service.set('key', 'value', 60);

      expect(result).toBe('OK');
      expect(mockRedisClient.set).toHaveBeenCalledWith('key', 'value', 'EX', 60);
    });

    it('should setex', async () => {
      mockRedisClient.setex.mockResolvedValue('OK');

      const result = await service.setex('key', 60, 'value');

      expect(result).toBe('OK');
      expect(mockRedisClient.setex).toHaveBeenCalledWith('key', 60, 'value');
    });

    it('should setnx', async () => {
      mockRedisClient.setnx.mockResolvedValue(1);

      const result = await service.setnx('key', 'value');

      expect(result).toBe(1);
      expect(mockRedisClient.setnx).toHaveBeenCalledWith('key', 'value');
    });

    it('should delete key', async () => {
      mockRedisClient.del.mockResolvedValue(1);

      const result = await service.del('key');

      expect(result).toBe(1);
      expect(mockRedisClient.del).toHaveBeenCalledWith('key');
    });

    it('should delete multiple keys', async () => {
      mockRedisClient.del.mockResolvedValue(2);

      const result = await service.del(['key1', 'key2']);

      expect(result).toBe(2);
      expect(mockRedisClient.del).toHaveBeenCalledWith('key1', 'key2');
    });

    it('should check existence', async () => {
      mockRedisClient.exists.mockResolvedValue(1);

      const result = await service.exists('key');

      expect(result).toBe(1);
      expect(mockRedisClient.exists).toHaveBeenCalledWith('key');
    });

    it('should increment', async () => {
      mockRedisClient.incr.mockResolvedValue(2);

      const result = await service.incr('counter');

      expect(result).toBe(2);
      expect(mockRedisClient.incr).toHaveBeenCalledWith('counter');
    });

    it('should increment by value', async () => {
      mockRedisClient.incrby.mockResolvedValue(15);

      const result = await service.incrby('counter', 5);

      expect(result).toBe(15);
      expect(mockRedisClient.incrby).toHaveBeenCalledWith('counter', 5);
    });

    it('should expire key', async () => {
      mockRedisClient.expire.mockResolvedValue(1);

      const result = await service.expire('key', 60);

      expect(result).toBe(1);
      expect(mockRedisClient.expire).toHaveBeenCalledWith('key', 60);
    });

    it('should get TTL', async () => {
      mockRedisClient.ttl.mockResolvedValue(60);

      const result = await service.ttl('key');

      expect(result).toBe(60);
      expect(mockRedisClient.ttl).toHaveBeenCalledWith('key');
    });
  });

  describe('hash operations', () => {
    it('should hget', async () => {
      mockRedisClient.hget.mockResolvedValue('value');

      const result = await service.hget('hash', 'field');

      expect(result).toBe('value');
      expect(mockRedisClient.hget).toHaveBeenCalledWith('hash', 'field');
    });

    it('should hset', async () => {
      mockRedisClient.hset.mockResolvedValue(1);

      const result = await service.hset('hash', 'field', 'value');

      expect(result).toBe(1);
      expect(mockRedisClient.hset).toHaveBeenCalledWith('hash', 'field', 'value');
    });

    it('should hgetall', async () => {
      const data = { field1: 'value1', field2: 'value2' };
      mockRedisClient.hgetall.mockResolvedValue(data);

      const result = await service.hgetall('hash');

      expect(result).toEqual(data);
      expect(mockRedisClient.hgetall).toHaveBeenCalledWith('hash');
    });

    it('should hdel', async () => {
      mockRedisClient.hdel.mockResolvedValue(1);

      const result = await service.hdel('hash', 'field');

      expect(result).toBe(1);
      expect(mockRedisClient.hdel).toHaveBeenCalledWith('hash', 'field');
    });
  });

  describe('set operations', () => {
    it('should sadd', async () => {
      mockRedisClient.sadd.mockResolvedValue(1);

      const result = await service.sadd('set', 'member');

      expect(result).toBe(1);
      expect(mockRedisClient.sadd).toHaveBeenCalledWith('set', 'member');
    });

    it('should srem', async () => {
      mockRedisClient.srem.mockResolvedValue(1);

      const result = await service.srem('set', 'member');

      expect(result).toBe(1);
      expect(mockRedisClient.srem).toHaveBeenCalledWith('set', 'member');
    });

    it('should smembers', async () => {
      mockRedisClient.smembers.mockResolvedValue(['member1', 'member2']);

      const result = await service.smembers('set');

      expect(result).toEqual(['member1', 'member2']);
      expect(mockRedisClient.smembers).toHaveBeenCalledWith('set');
    });

    it('should sismember', async () => {
      mockRedisClient.sismember.mockResolvedValue(1);

      const result = await service.sismember('set', 'member');

      expect(result).toBe(1);
      expect(mockRedisClient.sismember).toHaveBeenCalledWith('set', 'member');
    });
  });

  describe('list operations', () => {
    it('should lpush', async () => {
      mockRedisClient.lpush.mockResolvedValue(1);

      const result = await service.lpush('list', 'value');

      expect(result).toBe(1);
      expect(mockRedisClient.lpush).toHaveBeenCalledWith('list', 'value');
    });

    it('should rpush', async () => {
      mockRedisClient.rpush.mockResolvedValue(1);

      const result = await service.rpush('list', 'value');

      expect(result).toBe(1);
      expect(mockRedisClient.rpush).toHaveBeenCalledWith('list', 'value');
    });

    it('should lpop', async () => {
      mockRedisClient.lpop.mockResolvedValue('value');

      const result = await service.lpop('list');

      expect(result).toBe('value');
      expect(mockRedisClient.lpop).toHaveBeenCalledWith('list');
    });

    it('should rpop', async () => {
      mockRedisClient.rpop.mockResolvedValue('value');

      const result = await service.rpop('list');

      expect(result).toBe('value');
      expect(mockRedisClient.rpop).toHaveBeenCalledWith('list');
    });

    it('should lrange', async () => {
      mockRedisClient.lrange.mockResolvedValue(['value1', 'value2']);

      const result = await service.lrange('list', 0, -1);

      expect(result).toEqual(['value1', 'value2']);
      expect(mockRedisClient.lrange).toHaveBeenCalledWith('list', 0, -1);
    });

    it('should llen', async () => {
      mockRedisClient.llen.mockResolvedValue(5);

      const result = await service.llen('list');

      expect(result).toBe(5);
      expect(mockRedisClient.llen).toHaveBeenCalledWith('list');
    });
  });

  describe('sorted set operations', () => {
    it('should zadd', async () => {
      mockRedisClient.zadd.mockResolvedValue(1);

      const result = await service.zadd('zset', 10, 'member');

      expect(result).toBe(1);
      expect(mockRedisClient.zadd).toHaveBeenCalledWith('zset', 10, 'member');
    });

    it('should zrem', async () => {
      mockRedisClient.zrem.mockResolvedValue(1);

      const result = await service.zrem('zset', 'member');

      expect(result).toBe(1);
      expect(mockRedisClient.zrem).toHaveBeenCalledWith('zset', 'member');
    });

    it('should zrange', async () => {
      mockRedisClient.zrange.mockResolvedValue(['member1', 'member2']);

      const result = await service.zrange('zset', 0, -1);

      expect(result).toEqual(['member1', 'member2']);
      expect(mockRedisClient.zrange).toHaveBeenCalledWith('zset', 0, -1);
    });

    it('should zrevrange', async () => {
      mockRedisClient.zrevrange.mockResolvedValue(['member2', 'member1']);

      const result = await service.zrevrange('zset', 0, -1);

      expect(result).toEqual(['member2', 'member1']);
      expect(mockRedisClient.zrevrange).toHaveBeenCalledWith('zset', 0, -1);
    });

    it('should zcard', async () => {
      mockRedisClient.zcard.mockResolvedValue(10);

      const result = await service.zcard('zset');

      expect(result).toBe(10);
      expect(mockRedisClient.zcard).toHaveBeenCalledWith('zset');
    });

    it('should zscore', async () => {
      mockRedisClient.zscore.mockResolvedValue('10');

      const result = await service.zscore('zset', 'member');

      expect(result).toBe('10');
      expect(mockRedisClient.zscore).toHaveBeenCalledWith('zset', 'member');
    });
  });

  describe('script operations', () => {
    it('should eval script', async () => {
      mockRedisClient.eval.mockResolvedValue('result');

      const result = await service.eval('return 1', 0);

      expect(result).toBe('result');
      expect(mockRedisClient.eval).toHaveBeenCalledWith('return 1', 0);
    });

    it('should evalsha script', async () => {
      mockRedisClient.evalsha.mockResolvedValue('result');

      const result = await service.evalsha('sha123', 1, 'key1');

      expect(result).toBe('result');
      expect(mockRedisClient.evalsha).toHaveBeenCalledWith('sha123', 1, 'key1');
    });
  });

  describe('database operations', () => {
    it('should flushdb', async () => {
      mockRedisClient.flushdb.mockResolvedValue('OK');

      const result = await service.flushdb();

      expect(result).toBe('OK');
      expect(mockRedisClient.flushdb).toHaveBeenCalled();
    });

    it('should flushall', async () => {
      mockRedisClient.flushall.mockResolvedValue('OK');

      const result = await service.flushall();

      expect(result).toBe('OK');
      expect(mockRedisClient.flushall).toHaveBeenCalled();
    });
  });
});