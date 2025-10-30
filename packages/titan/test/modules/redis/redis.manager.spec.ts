import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { RedisManager } from '../../../src/modules/redis/redis.manager.js';
import { RedisModuleOptions } from '../../../src/modules/redis/redis.types.js';
import type { Redis, RedisOptions } from 'ioredis';

/**
 * Mock Redis instance interface with writable status property.
 * Extends the base Redis type with jest mock functions and mutable properties.
 */
interface MockRedisInstance extends Omit<Redis, 'status' | 'options'> {
  connect: jest.Mock<() => Promise<void>>;
  quit: jest.Mock<() => Promise<string>>;
  ping: jest.Mock<() => Promise<string>>;
  script: jest.Mock;
  evalsha: jest.Mock;
  eval: jest.Mock;
  on: jest.Mock;
  once: jest.Mock;
  removeListener: jest.Mock;
  off: jest.Mock;
  duplicate: jest.Mock<() => MockRedisInstance>;
  status: 'ready' | 'wait' | 'end' | 'close' | 'reconnecting' | 'connecting';
  options: Partial<RedisOptions>;
}

// Mock ioredis module
jest.mock('ioredis', () => {
  const mockRedis = jest.fn();
  const mockCluster = jest.fn();

  return {
    Redis: mockRedis,
    Cluster: mockCluster,
    default: { Redis: mockRedis, Cluster: mockCluster },
  };
});

// Get the mocked constructors
const ioredis = jest.requireMock('ioredis');
const mockRedis = ioredis.Redis as jest.Mock;
const mockCluster = ioredis.Cluster as jest.Mock;

// Mock redis.utils - we'll set the implementation in beforeEach
jest.mock('../../../src/modules/redis/redis.utils.js');

describe('RedisManager', () => {
  let manager: RedisManager;
  let mockRedisInstance: MockRedisInstance;

  beforeEach(() => {
    mockRedisInstance = {
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue('OK'),
      ping: jest.fn().mockResolvedValue('PONG'),
      script: jest.fn(),
      evalsha: jest.fn(),
      eval: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
      removeListener: jest.fn(),
      off: jest.fn(),
      status: 'ready',
      options: { lazyConnect: true },
      duplicate: jest.fn().mockReturnThis(),
    } as MockRedisInstance;

    mockRedis.mockImplementation(() => mockRedisInstance);

    // Set up redis.utils mocks
    const redisUtils = jest.requireMock('../../../src/modules/redis/redis.utils.js');
    redisUtils.createRedisClient = jest.fn(() => mockRedisInstance);
    redisUtils.waitForConnection = jest.fn(async () => {});
    redisUtils.mergeOptions = jest.fn((a, b) => ({ ...a, ...b }));
    redisUtils.generateScriptSha = jest.fn((content: string) => createHash('sha1').update(content).digest('hex'));
    redisUtils.loadScriptContent = jest.fn(() => 'mock-script');
    redisUtils.getClientNamespace = jest.fn((client, fallback = 'default') => fallback);
    redisUtils.createRetryStrategy = jest.fn(() => (times: number) => Math.min(times * 50, 2000));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create manager with options', () => {
      const options: RedisModuleOptions = {
        config: {
          host: 'localhost',
          port: 6379,
        },
      };

      manager = new RedisManager(options);
      expect(manager).toBeDefined();
    });
  });

  describe('onModuleInit', () => {
    it('should initialize clients on module init', async () => {
      const options: RedisModuleOptions = {
        config: {
          host: 'localhost',
          port: 6379,
          lazyConnect: false, // Force non-lazy connect for this test
        },
      };

      // Update mock to reflect non-lazy connect and set up event simulation
      mockRedisInstance.options = { lazyConnect: false };
      mockRedisInstance.status = 'wait'; // Not ready yet

      // Simulate ready event after connect is called
      mockRedisInstance.connect.mockImplementation(async () => {
        mockRedisInstance.status = 'ready';
        // Simulate the ready event
        const readyHandler = (mockRedisInstance.on as jest.Mock).mock.calls.find((call) => call[0] === 'ready')?.[1];
        if (readyHandler) {
          setTimeout(() => readyHandler(), 0);
        }
      });

      manager = new RedisManager(options);
      await manager.onModuleInit();

      expect(mockRedisInstance.connect).toHaveBeenCalled();
    });

    it('should initialize multiple clients', async () => {
      const options: RedisModuleOptions = {
        clients: [
          { namespace: 'cache', db: 0 },
          { namespace: 'sessions', db: 1 },
        ],
      };

      manager = new RedisManager(options);
      await manager.onModuleInit();

      expect(mockRedis).toHaveBeenCalledTimes(2);
    });

    it('should load scripts on initialization', async () => {
      const options: RedisModuleOptions = {
        config: {},
        scripts: [
          {
            name: 'test-script',
            content: 'return 1',
          },
        ],
      };

      mockRedisInstance.script.mockResolvedValue([0]);

      manager = new RedisManager(options);
      await manager.onModuleInit();

      expect(mockRedisInstance.script).toHaveBeenCalledWith('EXISTS', expect.any(String));
      expect(mockRedisInstance.script).toHaveBeenCalledWith('LOAD', 'return 1');
    });
  });

  describe('getClient', () => {
    it('should return client by namespace', async () => {
      const options: RedisModuleOptions = {
        config: {
          namespace: 'test',
        },
      };

      manager = new RedisManager(options);
      await manager.onModuleInit();

      const client = manager.getClient('test');
      expect(client).toBeDefined();
    });

    it('should return default client when no namespace provided', async () => {
      const options: RedisModuleOptions = {
        config: {},
      };

      manager = new RedisManager(options);
      await manager.onModuleInit();

      const client = manager.getClient();
      expect(client).toBeDefined();
    });

    it('should throw error for non-existent client', async () => {
      const options: RedisModuleOptions = {
        config: {},
      };

      manager = new RedisManager(options);
      await manager.onModuleInit();

      expect(() => manager.getClient('non-existent')).toThrow('Redis client with namespace "non-existent" not found');
    });
  });

  describe('hasClient', () => {
    it('should check if client exists', async () => {
      const options: RedisModuleOptions = {
        clients: [{ namespace: 'cache' }, { namespace: 'sessions' }],
      };

      manager = new RedisManager(options);
      await manager.onModuleInit();

      expect(manager.hasClient('cache')).toBe(true);
      expect(manager.hasClient('sessions')).toBe(true);
      expect(manager.hasClient('non-existent')).toBe(false);
    });
  });

  describe('createClient', () => {
    it('should create new client dynamically', async () => {
      const options: RedisModuleOptions = {
        config: {},
      };

      manager = new RedisManager(options);
      await manager.onModuleInit();

      const newClient = await manager.createClient({
        namespace: 'dynamic',
        db: 2,
      });

      expect(newClient).toBeDefined();
      expect(manager.hasClient('dynamic')).toBe(true);
    });

    it('should throw error for duplicate namespace', async () => {
      const options: RedisModuleOptions = {
        config: {
          namespace: 'test',
        },
      };

      manager = new RedisManager(options);
      await manager.onModuleInit();

      await expect(manager.createClient({ namespace: 'test' })).rejects.toThrow(
        'Redis client with namespace "test" already exists'
      );
    });
  });

  describe('destroyClient', () => {
    it('should destroy client by namespace', async () => {
      const options: RedisModuleOptions = {
        config: {
          namespace: 'test',
        },
      };

      manager = new RedisManager(options);
      await manager.onModuleInit();

      await manager.destroyClient('test');

      expect(mockRedisInstance.quit).toHaveBeenCalled();
      expect(manager.hasClient('test')).toBe(false);
    });

    it('should handle non-existent client gracefully', async () => {
      const options: RedisModuleOptions = {
        config: {},
      };

      manager = new RedisManager(options);
      await manager.onModuleInit();

      await expect(manager.destroyClient('non-existent')).resolves.not.toThrow();
    });
  });

  describe('isHealthy', () => {
    it('should check client health', async () => {
      const options: RedisModuleOptions = {
        config: {},
      };

      manager = new RedisManager(options);
      await manager.onModuleInit();

      const healthy = await manager.isHealthy();

      expect(healthy).toBe(true);
      expect(mockRedisInstance.ping).toHaveBeenCalled();
    });

    it('should return false for unhealthy client', async () => {
      const options: RedisModuleOptions = {
        config: {},
      };

      // Mock ping to reject, simulating unhealthy client
      mockRedisInstance.ping = jest.fn().mockRejectedValue(new Error('Connection error'));

      manager = new RedisManager(options);
      await manager.onModuleInit();

      const healthy = await manager.isHealthy();

      expect(healthy).toBe(false);
    });
  });

  describe('healthCheck', () => {
    it('should check all clients health', async () => {
      const options: RedisModuleOptions = {
        clients: [{ namespace: 'cache' }, { namespace: 'sessions' }],
      };

      manager = new RedisManager(options);
      await manager.onModuleInit();

      const results = await manager.healthCheck();

      expect(Object.keys(results).length).toBe(2);
      expect(results.cache?.healthy).toBe(true);
      expect(results.sessions?.healthy).toBe(true);
    });
  });

  describe('runScript', () => {
    it('should execute loaded script', async () => {
      const options: RedisModuleOptions = {
        config: {},
        scripts: [
          {
            name: 'test-script',
            content: 'return KEYS[1]',
          },
        ],
      };

      mockRedisInstance.script.mockResolvedValue([0]);
      mockRedisInstance.evalsha.mockResolvedValue('result');

      manager = new RedisManager(options);
      await manager.onModuleInit();

      const result = await manager.runScript('test-script', ['key1'], []);

      expect(result).toBe('result');
      expect(mockRedisInstance.evalsha).toHaveBeenCalled();
    });

    it('should fallback to eval on NOSCRIPT error', async () => {
      const options: RedisModuleOptions = {
        config: {},
        scripts: [
          {
            name: 'test-script',
            content: 'return KEYS[1]',
          },
        ],
      };

      mockRedisInstance.script.mockResolvedValueOnce([0]).mockResolvedValueOnce('new-sha');
      mockRedisInstance.evalsha.mockRejectedValue(new Error('NOSCRIPT'));
      mockRedisInstance.eval.mockResolvedValue('result');

      manager = new RedisManager(options);
      await manager.onModuleInit();

      const result = await manager.runScript('test-script', ['key1'], []);

      expect(result).toBe('result');
      expect(mockRedisInstance.eval).toHaveBeenCalledWith('return KEYS[1]', 1, 'key1');
    });

    it('should throw error for non-existent script', async () => {
      const options: RedisModuleOptions = {
        config: {},
      };

      manager = new RedisManager(options);
      await manager.onModuleInit();

      await expect(manager.runScript('non-existent', [], [])).rejects.toThrow(
        'Script "non-existent" not loaded for client "default"'
      );
    });
  });

  describe('onModuleDestroy', () => {
    it('should close all clients on destroy', async () => {
      const options: RedisModuleOptions = {
        clients: [{ namespace: 'cache' }, { namespace: 'sessions' }],
      };

      manager = new RedisManager(options);
      await manager.onModuleInit();
      await manager.onModuleDestroy();

      expect(mockRedisInstance.quit).toHaveBeenCalledTimes(2);
    });

    it('should skip closing when closeClient is false', async () => {
      const options: RedisModuleOptions = {
        config: {},
        closeClient: false,
      };

      manager = new RedisManager(options);
      await manager.onModuleInit();
      await manager.onModuleDestroy();

      expect(mockRedisInstance.quit).not.toHaveBeenCalled();
    });
  });
});
