import { RedisManager } from '../../../src/modules/redis/redis.manager.js';
import { RedisModuleOptions } from '../../../src/modules/redis/redis.types.js';
import type { Redis } from 'ioredis';

// Mock ioredis module
jest.mock('ioredis', () => {
  const mockRedis = jest.fn();
  const mockCluster = jest.fn();

  return {
    Redis: mockRedis,
    Cluster: mockCluster,
    default: { Redis: mockRedis, Cluster: mockCluster }
  };
});

// Get the mocked constructors
const ioredis = jest.requireMock('ioredis');
const mockRedis = ioredis.Redis as jest.Mock;
const mockCluster = ioredis.Cluster as jest.Mock;

describe('RedisManager', () => {
  let manager: RedisManager;
  let mockRedisInstance: jest.Mocked<Redis>;

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
      status: 'ready',
      options: {},
      duplicate: jest.fn().mockReturnThis(),
    } as any;

    mockRedis.mockImplementation(() => mockRedisInstance);
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
        },
      };

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

      expect(Redis).toHaveBeenCalledTimes(2);
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

      expect(() => manager.getClient('non-existent')).toThrow(
        'Redis client "non-existent" not found',
      );
    });
  });

  describe('hasClient', () => {
    it('should check if client exists', async () => {
      const options: RedisModuleOptions = {
        clients: [
          { namespace: 'cache' },
          { namespace: 'sessions' },
        ],
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

      await expect(
        manager.createClient({ namespace: 'test' }),
      ).rejects.toThrow('Redis client with namespace "test" already exists');
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

      await expect(
        manager.destroyClient('non-existent'),
      ).resolves.not.toThrow();
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

      mockRedisInstance.status = 'connecting' as any;
      manager = new RedisManager(options);
      await manager.onModuleInit();

      const healthy = await manager.isHealthy();

      expect(healthy).toBe(false);
    });
  });

  describe('healthCheck', () => {
    it('should check all clients health', async () => {
      const options: RedisModuleOptions = {
        clients: [
          { namespace: 'cache' },
          { namespace: 'sessions' },
        ],
      };

      manager = new RedisManager(options);
      await manager.onModuleInit();

      const results = await manager.healthCheck();

      expect(results.size).toBe(2);
      expect(results.get('cache')).toBe(true);
      expect(results.get('sessions')).toBe(true);
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

      mockRedisInstance.script
        .mockResolvedValueOnce([0])
        .mockResolvedValueOnce('new-sha');
      mockRedisInstance.evalsha.mockRejectedValue(new Error('NOSCRIPT'));
      mockRedisInstance.eval.mockResolvedValue('result');

      manager = new RedisManager(options);
      await manager.onModuleInit();

      const result = await manager.runScript('test-script', ['key1'], []);

      expect(result).toBe('result');
      expect(mockRedisInstance.eval).toHaveBeenCalledWith(
        'return KEYS[1]',
        1,
        'key1',
      );
    });

    it('should throw error for non-existent script', async () => {
      const options: RedisModuleOptions = {
        config: {},
      };

      manager = new RedisManager(options);
      await manager.onModuleInit();

      await expect(
        manager.runScript('non-existent', [], []),
      ).rejects.toThrow('Script "non-existent" not loaded for client "default"');
    });
  });

  describe('onModuleDestroy', () => {
    it('should close all clients on destroy', async () => {
      const options: RedisModuleOptions = {
        clients: [
          { namespace: 'cache' },
          { namespace: 'sessions' },
        ],
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