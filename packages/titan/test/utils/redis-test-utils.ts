import Redis from 'ioredis';
import { RedisManager } from '../../src/modules/redis/redis.manager';
import { RedisService } from '../../src/modules/redis/redis.service';
import { RedisModuleOptions } from '../../src/modules/redis/redis.types';

/**
 * Redis test helper for managing Redis connections in tests
 */
export class RedisTestHelper {
  private clients: Map<string, Redis> = new Map();
  private testDb = 15; // Use database 15 for tests by default

  /**
   * Create a test Redis client
   */
  createClient(namespace = 'default', db?: number): Redis {
    const client = new Redis({
      host: 'localhost',
      port: 6379,
      db: db ?? this.testDb,
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // Don't retry in tests
    });

    this.clients.set(namespace, client);
    return client;
  }

  /**
   * Create a test Redis manager
   */
  createManager(options?: Partial<RedisModuleOptions>): RedisManager {
    const defaultOptions: RedisModuleOptions = {
      clients: [
        {
          namespace: 'default',
          host: 'localhost',
          port: 6379,
          db: this.testDb,
        },
      ],
      ...options,
    };

    return new RedisManager(defaultOptions, null as any);
  }

  /**
   * Create a test Redis service
   */
  createService(manager?: RedisManager): RedisService {
    const testManager = manager || this.createManager();
    return new RedisService(testManager);
  }

  /**
   * Get a client by namespace
   */
  getClient(namespace = 'default'): Redis | undefined {
    return this.clients.get(namespace);
  }

  /**
   * Clean up test data in all databases
   */
  async cleanupData(): Promise<void> {
    for (const client of this.clients.values()) {
      try {
        await client.flushdb();
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
  }

  /**
   * Clean up all connections
   */
  async cleanup(): Promise<void> {
    await this.cleanupData();

    for (const client of this.clients.values()) {
      try {
        await client.quit();
      } catch (error) {
        // Force disconnect if quit fails
        client.disconnect();
      }
    }

    this.clients.clear();
  }

  /**
   * Wait for Redis to be ready
   */
  async waitForRedis(timeout = 5000): Promise<void> {
    const client = new Redis({
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });

    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        await client.ping();
        await client.quit();
        return;
      } catch (error) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    throw new Error('Redis not available');
  }

  /**
   * Create test data
   */
  async setupTestData(client: Redis, data: Record<string, any>): Promise<void> {
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string' || typeof value === 'number') {
        await client.set(key, value);
      } else {
        await client.set(key, JSON.stringify(value));
      }
    }
  }

  /**
   * Verify key exists
   */
  async assertKeyExists(client: Redis, key: string): Promise<void> {
    const exists = await client.exists(key);
    if (!exists) {
      throw new Error(`Key ${key} does not exist`);
    }
  }

  /**
   * Verify key does not exist
   */
  async assertKeyNotExists(client: Redis, key: string): Promise<void> {
    const exists = await client.exists(key);
    if (exists) {
      throw new Error(`Key ${key} should not exist`);
    }
  }

  /**
   * Get all keys matching pattern
   */
  async getKeys(client: Redis, pattern = '*'): Promise<string[]> {
    return client.keys(pattern);
  }

  /**
   * Count keys matching pattern
   */
  async countKeys(client: Redis, pattern = '*'): Promise<number> {
    const keys = await this.getKeys(client, pattern);
    return keys.length;
  }
}

/**
 * Create a Redis test helper
 */
export function createRedisTestHelper(): RedisTestHelper {
  return new RedisTestHelper();
}

/**
 * Redis test fixture
 */
export interface RedisTestFixture {
  helper: RedisTestHelper;
  client: Redis;
  manager?: RedisManager;
  service?: RedisService;
}

/**
 * Create a Redis test fixture
 */
export async function createRedisTestFixture(options?: {
  withManager?: boolean;
  withService?: boolean;
  db?: number;
}): Promise<RedisTestFixture> {
  const helper = createRedisTestHelper();
  await helper.waitForRedis();

  const client = helper.createClient('default', options?.db);

  let manager: RedisManager | undefined;
  let service: RedisService | undefined;

  if (options?.withManager) {
    manager = helper.createManager();
    await manager.init();
  }

  if (options?.withService) {
    if (!manager) {
      manager = helper.createManager();
      await manager.init();
    }
    service = helper.createService(manager);
  }

  return {
    helper,
    client,
    manager,
    service,
  };
}

/**
 * Clean up Redis test fixture
 */
export async function cleanupRedisTestFixture(fixture: RedisTestFixture): Promise<void> {
  if (fixture.manager) {
    await fixture.manager.destroy();
  }
  await fixture.helper.cleanup();
}
