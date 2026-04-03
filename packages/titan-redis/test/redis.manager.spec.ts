import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { RedisManager } from '../src/redis.manager.js';
import { RedisModuleOptions } from '../src/redis.types.js';
import type { Redis, RedisOptions } from 'ioredis';
import { createMockLogger } from '@omnitron-dev/testing/titan';

/**
 * Mock Redis instance interface with writable status property.
 * Extends the base Redis type with jest mock functions and mutable properties.
 */
interface MockRedisInstance extends Omit<Redis, 'status' | 'options'> {
  connect: vi.Mock<() => Promise<void>>;
  quit: vi.Mock<() => Promise<string>>;
  ping: vi.Mock<() => Promise<string>>;
  script: vi.Mock;
  evalsha: vi.Mock;
  eval: vi.Mock;
  on: vi.Mock;
  once: vi.Mock;
  removeListener: vi.Mock;
  off: vi.Mock;
  duplicate: vi.Mock<() => MockRedisInstance>;
  status: 'ready' | 'wait' | 'end' | 'close' | 'reconnecting' | 'connecting';
  options: Partial<RedisOptions>;
}

// Mock ioredis module
vi.mock('ioredis', () => {
  const mockRedis = vi.fn();
  const mockCluster = vi.fn();

  return {
    Redis: mockRedis,
    Cluster: mockCluster,
    default: { Redis: mockRedis, Cluster: mockCluster },
  };
});

// Get the mocked constructors
const ioredis = vi.importMock('ioredis');
const mockRedis = ioredis.Redis as vi.Mock;
const _mockCluster = ioredis.Cluster as vi.Mock;

// Mock redis.utils - we'll set the implementation in beforeEach
vi.mock('../../../src/modules/redis/redis.utils.js');

// Skip tests - this test uses vi.importMock which doesn't work with ES modules
// TODO: Refactor to use proper ES module mocking or convert to integration test
const skipTests = true;
if (skipTests) {
  console.log('⏭️ Skipping redis.manager.spec.ts - needs ES module mock refactor');
}
const describeOrSkip = skipTests ? describe.skip : describe;

describeOrSkip('RedisManager', () => {
  let manager: RedisManager;
  let mockRedisInstance: MockRedisInstance;

  beforeEach(() => {
    mockRedisInstance = {
      connect: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn().mockResolvedValue('OK'),
      ping: vi.fn().mockResolvedValue('PONG'),
      script: vi.fn(),
      evalsha: vi.fn(),
      eval: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      removeListener: vi.fn(),
      off: vi.fn(),
      status: 'ready',
      options: { lazyConnect: true },
      duplicate: vi.fn().mockReturnThis(),
    } as MockRedisInstance;

    mockRedis.mockImplementation(() => mockRedisInstance);

    // Set up redis.utils mocks
    const redisUtils = vi.importMock('../../../src/modules/redis/redis.utils.js');
    redisUtils.createRedisClient = vi.fn(() => mockRedisInstance);
    redisUtils.waitForConnection = vi.fn(async () => {});
    redisUtils.mergeOptions = vi.fn((a, b) => ({ ...a, ...b }));
    redisUtils.generateScriptSha = vi.fn((content: string) => createHash('sha1').update(content).digest('hex'));
    redisUtils.loadScriptContent = vi.fn(() => 'mock-script');
    redisUtils.getClientNamespace = vi.fn((client, fallback = 'default') => fallback);
    redisUtils.createRetryStrategy = vi.fn(() => (times: number) => Math.min(times * 50, 2000));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create manager with options', () => {
      const options: RedisModuleOptions = {
        config: {
          host: 'localhost',
          port: 6379,
        },
      };

      const mockLogger = createMockLogger();
      manager = new RedisManager(options, mockLogger);
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
        const readyHandler = (mockRedisInstance.on as vi.Mock).mock.calls.find((call) => call[0] === 'ready')?.[1];
        if (readyHandler) {
          setTimeout(() => readyHandler(), 0);
        }
      });

      const mockLogger = createMockLogger();
      manager = new RedisManager(options, mockLogger);
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

      const mockLogger = createMockLogger();
      manager = new RedisManager(options, mockLogger);
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

      const mockLogger = createMockLogger();
      manager = new RedisManager(options, mockLogger);
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

      const mockLogger = createMockLogger();
      manager = new RedisManager(options, mockLogger);
      await manager.onModuleInit();

      const client = manager.getClient('test');
      expect(client).toBeDefined();
    });

    it('should return default client when no namespace provided', async () => {
      const options: RedisModuleOptions = {
        config: {},
      };

      const mockLogger = createMockLogger();
      manager = new RedisManager(options, mockLogger);
      await manager.onModuleInit();

      const client = manager.getClient();
      expect(client).toBeDefined();
    });

    it('should throw error for non-existent client', async () => {
      const options: RedisModuleOptions = {
        config: {},
      };

      const mockLogger = createMockLogger();
      manager = new RedisManager(options, mockLogger);
      await manager.onModuleInit();

      expect(() => manager.getClient('non-existent')).toThrow('Redis client with namespace "non-existent" not found');
    });
  });

  describe('hasClient', () => {
    it('should check if client exists', async () => {
      const options: RedisModuleOptions = {
        clients: [{ namespace: 'cache' }, { namespace: 'sessions' }],
      };

      const mockLogger = createMockLogger();
      manager = new RedisManager(options, mockLogger);
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

      const mockLogger = createMockLogger();
      manager = new RedisManager(options, mockLogger);
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

      const mockLogger = createMockLogger();
      manager = new RedisManager(options, mockLogger);
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

      const mockLogger = createMockLogger();
      manager = new RedisManager(options, mockLogger);
      await manager.onModuleInit();

      await manager.destroyClient('test');

      expect(mockRedisInstance.quit).toHaveBeenCalled();
      expect(manager.hasClient('test')).toBe(false);
    });

    it('should handle non-existent client gracefully', async () => {
      const options: RedisModuleOptions = {
        config: {},
      };

      const mockLogger = createMockLogger();
      manager = new RedisManager(options, mockLogger);
      await manager.onModuleInit();

      await expect(manager.destroyClient('non-existent')).resolves.not.toThrow();
    });
  });

  describe('isHealthy', () => {
    it('should check client health', async () => {
      const options: RedisModuleOptions = {
        config: {},
      };

      const mockLogger = createMockLogger();
      manager = new RedisManager(options, mockLogger);
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
      mockRedisInstance.ping = vi.fn().mockRejectedValue(new Error('Connection error'));

      const mockLogger = createMockLogger();
      manager = new RedisManager(options, mockLogger);
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

      const mockLogger = createMockLogger();
      manager = new RedisManager(options, mockLogger);
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

      const mockLogger = createMockLogger();
      manager = new RedisManager(options, mockLogger);
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

      const mockLogger = createMockLogger();
      manager = new RedisManager(options, mockLogger);
      await manager.onModuleInit();

      const result = await manager.runScript('test-script', ['key1'], []);

      expect(result).toBe('result');
      expect(mockRedisInstance.eval).toHaveBeenCalledWith('return KEYS[1]', 1, 'key1');
    });

    it('should throw error for non-existent script', async () => {
      const options: RedisModuleOptions = {
        config: {},
      };

      const mockLogger = createMockLogger();
      manager = new RedisManager(options, mockLogger);
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

      const mockLogger = createMockLogger();
      manager = new RedisManager(options, mockLogger);
      await manager.onModuleInit();
      await manager.onModuleDestroy();

      expect(mockRedisInstance.quit).toHaveBeenCalledTimes(2);
    });

    it('should skip closing when closeClient is false', async () => {
      const options: RedisModuleOptions = {
        config: {},
        closeClient: false,
      };

      const mockLogger = createMockLogger();
      manager = new RedisManager(options, mockLogger);
      await manager.onModuleInit();
      await manager.onModuleDestroy();

      expect(mockRedisInstance.quit).not.toHaveBeenCalled();
    });
  });
});
