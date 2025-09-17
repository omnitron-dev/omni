import { Redis } from 'ioredis';

import { RedisManager } from '../../../../src/modules/redis/redis.manager.js';
import { RedisService } from '../../../../src/modules/redis/redis.service.js';
import { RedisModuleOptions } from '../../../../src/modules/redis/redis.types.js';

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
        await new Promise(resolve => setTimeout(resolve, 100));
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

/**
 * Redis test decorator - automatically sets up and tears down Redis for tests
 */
export function withRedis(options?: { db?: number }) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const fixture = await createRedisTestFixture(options);

      try {
        // Inject fixture as first argument
        return await originalMethod.call(this, fixture, ...args);
      } finally {
        await cleanupRedisTestFixture(fixture);
      }
    };

    return descriptor;
  };
}

/**
 * Mock Redis client for unit tests
 */
export class MockRedisClient {
  private data = new Map<string, any>();
  private expiries = new Map<string, number>();

  // String operations
  async get(key: string): Promise<string | null> {
    this.checkExpiry(key);
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: string | number): Promise<'OK'> {
    this.data.set(key, String(value));
    return 'OK';
  }

  async setex(key: string, seconds: number, value: string): Promise<'OK'> {
    this.data.set(key, value);
    this.expiries.set(key, Date.now() + seconds * 1000);
    return 'OK';
  }

  async setnx(key: string, value: string): Promise<0 | 1> {
    if (this.data.has(key)) {
      return 0;
    }
    this.data.set(key, value);
    return 1;
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.data.delete(key)) {
        deleted++;
      }
      this.expiries.delete(key);
    }
    return deleted;
  }

  async exists(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      this.checkExpiry(key);
      if (this.data.has(key)) {
        count++;
      }
    }
    return count;
  }

  async incr(key: string): Promise<number> {
    const val = parseInt(this.data.get(key) || '0', 10);
    const newVal = val + 1;
    this.data.set(key, String(newVal));
    return newVal;
  }

  async incrby(key: string, increment: number): Promise<number> {
    const val = parseInt(this.data.get(key) || '0', 10);
    const newVal = val + increment;
    this.data.set(key, String(newVal));
    return newVal;
  }

  async decr(key: string): Promise<number> {
    const val = parseInt(this.data.get(key) || '0', 10);
    const newVal = val - 1;
    this.data.set(key, String(newVal));
    return newVal;
  }

  async decrby(key: string, decrement: number): Promise<number> {
    const val = parseInt(this.data.get(key) || '0', 10);
    const newVal = val - decrement;
    this.data.set(key, String(newVal));
    return newVal;
  }

  async expire(key: string, seconds: number): Promise<0 | 1> {
    if (!this.data.has(key)) {
      return 0;
    }
    this.expiries.set(key, Date.now() + seconds * 1000);
    return 1;
  }

  async ttl(key: string): Promise<number> {
    this.checkExpiry(key);
    if (!this.data.has(key)) {
      return -2;
    }
    const expiry = this.expiries.get(key);
    if (!expiry) {
      return -1;
    }
    return Math.max(0, Math.floor((expiry - Date.now()) / 1000));
  }

  async ping(): Promise<'PONG'> {
    return 'PONG';
  }

  async flushdb(): Promise<'OK'> {
    this.data.clear();
    this.expiries.clear();
    return 'OK';
  }

  async flushall(): Promise<'OK'> {
    this.data.clear();
    this.expiries.clear();
    return 'OK';
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return Array.from(this.data.keys()).filter(key => {
      this.checkExpiry(key);
      return regex.test(key) && this.data.has(key);
    });
  }

  async dbsize(): Promise<number> {
    // Clean expired keys
    for (const key of this.data.keys()) {
      this.checkExpiry(key);
    }
    return this.data.size;
  }

  // Utility methods
  private checkExpiry(key: string): void {
    const expiry = this.expiries.get(key);
    if (expiry && expiry < Date.now()) {
      this.data.delete(key);
      this.expiries.delete(key);
    }
  }

  // Mock connection methods
  connect(): Promise<void> {
    return Promise.resolve();
  }

  disconnect(): void {
    // No-op
  }

  quit(): Promise<'OK'> {
    return Promise.resolve('OK');
  }

  on(event: string, handler: Function): void {
    // No-op for mock
  }

  once(event: string, handler: Function): void {
    // No-op for mock
  }

  off(event: string, handler: Function): void {
    // No-op for mock
  }

  removeListener(event: string, handler: Function): void {
    // No-op for mock
  }

  emit(event: string, ...args: any[]): boolean {
    return true;
  }

  get status(): string {
    return 'ready';
  }
}

/**
 * Create a mock Redis client
 */
export function createMockRedisClient(): MockRedisClient {
  return new MockRedisClient();
}