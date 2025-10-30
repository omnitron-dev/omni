import { Redis, Cluster } from 'ioredis';

import { RedisManager } from '../../../../src/modules/redis/redis.manager.js';
import { RedisService } from '../../../../src/modules/redis/redis.service.js';
import { RedisModuleOptions } from '../../../../src/modules/redis/redis.types.js';
import {
  RedisTestManager,
  type DockerContainer,
  type RedisClusterContainers,
  type RedisSentinelContainers,
  type RedisContainerOptions,
  type RedisClusterOptions,
  type RedisSentinelOptions,
} from '../../../../src/testing/docker-test-manager.js';

/**
 * Type for decorator target
 */
type DecoratorTarget = Record<string, unknown>;

/**
 * Type for test data values
 */
type TestDataValue = string | number | boolean | null | Record<string, unknown> | unknown[];

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

    return new RedisManager(defaultOptions, undefined);
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
  async setupTestData(client: Redis, data: Record<string, TestDataValue>): Promise<void> {
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
  return function (target: DecoratorTarget, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
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
  private data = new Map<string, string>();
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
    return Array.from(this.data.keys()).filter((key) => {
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

  on(event: string, handler: (...args: unknown[]) => void): void {
    // No-op for mock
  }

  once(event: string, handler: (...args: unknown[]) => void): void {
    // No-op for mock
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    // No-op for mock
  }

  removeListener(event: string, handler: (...args: unknown[]) => void): void {
    // No-op for mock
  }

  emit(event: string, ...args: unknown[]): boolean {
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

/**
 * Docker-based Redis test fixture
 * Provides a complete Redis environment with Docker containers
 */
export interface DockerRedisTestFixture {
  container: DockerContainer;
  client: Redis;
  connectionString: string;
  port: number;
  cleanup: () => Promise<void>;
}

/**
 * Create a Docker-based Redis test fixture
 * This provides a real Redis instance running in Docker for integration tests
 */
export async function createDockerRedisFixture(options?: RedisContainerOptions): Promise<DockerRedisTestFixture> {
  const container = await RedisTestManager.createRedisContainer(options);
  const port = container.ports.get(6379)!;
  const password = options?.password;
  const database = options?.database ?? 0;

  let connectionString = `redis://`;
  if (password) {
    connectionString += `:${password}@`;
  }
  connectionString += `localhost:${port}/${database}`;

  const client = new Redis({
    host: 'localhost',
    port,
    password,
    db: database,
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => {
      if (times > 3) return null;
      return Math.min(times * 100, 1000);
    },
  });

  // Wait for connection
  await client.ping();

  return {
    container,
    client,
    connectionString,
    port,
    cleanup: async () => {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
      await container.cleanup();
    },
  };
}

/**
 * Docker-based Redis cluster test fixture
 */
export interface DockerRedisClusterFixture {
  cluster: RedisClusterContainers;
  client: Cluster;
  nodes: Array<{ host: string; port: number }>;
  cleanup: () => Promise<void>;
}

/**
 * Create a Docker-based Redis cluster test fixture
 */
export async function createDockerRedisClusterFixture(
  options?: RedisClusterOptions
): Promise<DockerRedisClusterFixture> {
  const cluster = await RedisTestManager.createRedisCluster(options);
  const password = options?.password;

  const client = new Cluster(cluster.nodes, {
    redisOptions: password ? { password } : undefined,
    clusterRetryStrategy: (times: number) => {
      if (times > 3) return null;
      return Math.min(times * 100, 1000);
    },
  });

  // Wait for cluster to be ready
  await client.ping();

  return {
    cluster,
    client,
    nodes: cluster.nodes,
    cleanup: async () => {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
      await cluster.cleanup();
    },
  };
}

/**
 * Docker-based Redis Sentinel test fixture
 */
export interface DockerRedisSentinelFixture {
  sentinel: RedisSentinelContainers;
  masterClient: Redis;
  sentinels: Array<{ host: string; port: number }>;
  masterName: string;
  cleanup: () => Promise<void>;
}

/**
 * Create a Docker-based Redis Sentinel test fixture
 */
export async function createDockerRedisSentinelFixture(
  options?: RedisSentinelOptions
): Promise<DockerRedisSentinelFixture> {
  const sentinel = await RedisTestManager.createRedisSentinel(options);
  const password = options?.password;
  const masterName = options?.masterName || 'mymaster';

  const sentinels = sentinel.sentinelPorts.map((port) => ({
    host: 'localhost',
    port,
  }));

  const masterClient = new Redis({
    sentinels,
    name: masterName,
    password,
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => {
      if (times > 3) return null;
      return Math.min(times * 100, 1000);
    },
  });

  // Wait for connection
  await masterClient.ping();

  return {
    sentinel,
    masterClient,
    sentinels,
    masterName,
    cleanup: async () => {
      try {
        await masterClient.quit();
      } catch {
        masterClient.disconnect();
      }
      await sentinel.cleanup();
    },
  };
}

/**
 * Build Redis connection string
 */
export function buildRedisConnectionString(options: {
  host?: string;
  port?: number;
  password?: string;
  database?: number;
}): string {
  const host = options.host || 'localhost';
  const port = options.port || 6379;
  const database = options.database ?? 0;

  let connectionString = `redis://`;
  if (options.password) {
    connectionString += `:${options.password}@`;
  }
  connectionString += `${host}:${port}/${database}`;

  return connectionString;
}

/**
 * Wait for Redis connection to be ready
 */
export async function waitForRedisReady(client: Redis | Cluster, timeout = 10000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      await client.ping();
      return;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(`Redis not ready within ${timeout}ms`);
}

/**
 * Flush all data from Redis instance
 */
export async function flushRedis(client: Redis | Cluster): Promise<void> {
  await client.flushall();
}

/**
 * Create a unique test database number (0-15)
 */
export function createTestDatabase(): number {
  return Math.floor(Math.random() * 16);
}

/**
 * Helper to run a test with a fresh Redis instance
 */
export async function withDockerRedis<T>(
  testFn: (fixture: DockerRedisTestFixture) => Promise<T>,
  options?: RedisContainerOptions
): Promise<T> {
  const fixture = await createDockerRedisFixture(options);
  try {
    return await testFn(fixture);
  } finally {
    await fixture.cleanup();
  }
}

/**
 * Helper to run a test with a fresh Redis cluster
 */
export async function withDockerRedisCluster<T>(
  testFn: (fixture: DockerRedisClusterFixture) => Promise<T>,
  options?: RedisClusterOptions
): Promise<T> {
  const fixture = await createDockerRedisClusterFixture(options);
  try {
    return await testFn(fixture);
  } finally {
    await fixture.cleanup();
  }
}

/**
 * Helper to run a test with a fresh Redis Sentinel setup
 */
export async function withDockerRedisSentinel<T>(
  testFn: (fixture: DockerRedisSentinelFixture) => Promise<T>,
  options?: RedisSentinelOptions
): Promise<T> {
  const fixture = await createDockerRedisSentinelFixture(options);
  try {
    return await testFn(fixture);
  } finally {
    await fixture.cleanup();
  }
}
