import { Redis, Cluster } from 'ioredis';


/**
 * Redis test configuration
 */
export interface RedisTestConfig {
  host?: string;
  port?: number;
  db?: number;
  password?: string;
  namespace?: string;
}

/**
 * Default test configuration
 */
export const DEFAULT_TEST_CONFIG: RedisTestConfig = {
  host: 'localhost',
  port: 6379,
  db: 15, // Use DB 15 for tests
};

/**
 * Redis test client manager
 */
export class RedisTestClient {
  private client: Redis | Cluster;
  private namespace: string;
  private keysCreated = new Set<string>();

  constructor(config: RedisTestConfig = {}) {
    const mergedConfig = { ...DEFAULT_TEST_CONFIG, ...config };
    this.namespace = mergedConfig.namespace || `test:${Date.now()}`;

    if ('cluster' in mergedConfig && (mergedConfig as any).cluster) {
      this.client = new Cluster((mergedConfig as any).nodes || [
        { host: mergedConfig.host, port: mergedConfig.port }
      ]);
    } else {
      this.client = new Redis({
        host: mergedConfig.host,
        port: mergedConfig.port,
        db: mergedConfig.db,
        password: mergedConfig.password,
        lazyConnect: false
      });
    }
  }

  /**
   * Get the underlying Redis client
   */
  getClient(): Redis | Cluster {
    return this.client;
  }

  /**
   * Get namespaced key
   */
  key(key: string): string {
    const fullKey = `${this.namespace}:${key}`;
    this.keysCreated.add(fullKey);
    return fullKey;
  }

  /**
   * Set a value with tracking
   */
  async set(key: string, value: string, ttl?: number): Promise<void> {
    const fullKey = this.key(key);
    if (ttl) {
      await this.client.setex(fullKey, ttl, value);
    } else {
      await this.client.set(fullKey, value);
    }
  }

  /**
   * Get a value
   */
  async get(key: string): Promise<string | null> {
    return this.client.get(this.key(key));
  }

  /**
   * Delete keys
   */
  async del(...keys: string[]): Promise<number> {
    const fullKeys = keys.map(k => this.key(k));
    return this.client.del(...fullKeys);
  }

  /**
   * Clean up all created keys
   */
  async cleanup(): Promise<void> {
    if (this.keysCreated.size > 0) {
      const keys = Array.from(this.keysCreated);

      // Delete in batches to avoid command too long
      const batchSize = 1000;
      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);
        await this.client.del(...batch);
      }

      this.keysCreated.clear();
    }
  }

  /**
   * Flush the test database
   */
  async flushDb(): Promise<void> {
    await this.client.flushdb();
    this.keysCreated.clear();
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    await this.cleanup();
    await this.client.quit();
  }

  /**
   * Check if Redis is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Wait for Redis to be ready
   */
  async waitForReady(timeout = 5000): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      if (await this.isAvailable()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error('Redis not available within timeout');
  }

  /**
   * Execute a pipeline
   */
  pipeline(): any {
    return this.client.pipeline();
  }

  /**
   * Execute a transaction
   */
  multi(): any {
    return this.client.multi();
  }

  /**
   * Subscribe to channels
   */
  async subscribe(...channels: string[]): Promise<void> {
    const prefixedChannels = channels.map(c => `${this.namespace}:${c}`);
    await (this.client as Redis).subscribe(...prefixedChannels);
  }

  /**
   * Publish to a channel
   */
  async publish(channel: string, message: string): Promise<number> {
    return this.client.publish(`${this.namespace}:${channel}`, message);
  }
}

/**
 * Create a Redis test client
 */
export function createRedisTestClient(config?: RedisTestConfig): RedisTestClient {
  return new RedisTestClient(config);
}

/**
 * Redis test fixture
 */
export interface RedisTestFixture {
  client: RedisTestClient;
  cleanup: () => Promise<void>;
}

/**
 * Create a Redis test fixture
 */
export async function createRedisFixture(config?: RedisTestConfig): Promise<RedisTestFixture> {
  const client = createRedisTestClient(config);
  await client.waitForReady();

  return {
    client,
    cleanup: async () => {
      await client.close();
    }
  };
}

/**
 * Run a test with Redis fixture
 */
export async function withRedis<T>(
  fn: (client: RedisTestClient) => T | Promise<T>,
  config?: RedisTestConfig
): Promise<T> {
  const fixture = await createRedisFixture(config);

  try {
    return await fn(fixture.client);
  } finally {
    await fixture.cleanup();
  }
}

/**
 * Mock Redis client for unit tests
 */
export class MockRedisClient {
  private data = new Map<string, any>();
  private expiries = new Map<string, number>();
  private pubsubCallbacks = new Map<string, Set<(...args: any[]) => void>>();

  // String operations
  async get(key: string): Promise<string | null> {
    this.checkExpiry(key);
    return this.data.get(key) || null;
  }

  async set(key: string, value: string): Promise<'OK'> {
    this.data.set(key, value);
    return 'OK';
  }

  async setex(key: string, seconds: number, value: string): Promise<'OK'> {
    this.data.set(key, value);
    this.expiries.set(key, Date.now() + seconds * 1000);
    return 'OK';
  }

  async setnx(key: string, value: string): Promise<number> {
    if (this.data.has(key)) {
      return 0;
    }
    this.data.set(key, value);
    return 1;
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.data.delete(key)) {
        count++;
      }
      this.expiries.delete(key);
    }
    return count;
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
    const value = parseInt(this.data.get(key) || '0');
    const newValue = value + 1;
    this.data.set(key, String(newValue));
    return newValue;
  }

  async decr(key: string): Promise<number> {
    const value = parseInt(this.data.get(key) || '0');
    const newValue = value - 1;
    this.data.set(key, String(newValue));
    return newValue;
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (!this.data.has(key)) {
      return 0;
    }
    this.expiries.set(key, Date.now() + seconds * 1000);
    return 1;
  }

  async ttl(key: string): Promise<number> {
    const expiry = this.expiries.get(key);
    if (!expiry) {
      return this.data.has(key) ? -1 : -2;
    }
    const remaining = Math.floor((expiry - Date.now()) / 1000);
    return remaining > 0 ? remaining : -2;
  }

  // Hash operations
  async hset(key: string, field: string, value: string): Promise<number> {
    const hash = this.data.get(key) || new Map();
    if (!(hash instanceof Map)) {
      throw new Error('WRONGTYPE');
    }
    const isNew = !hash.has(field);
    hash.set(field, value);
    this.data.set(key, hash);
    return isNew ? 1 : 0;
  }

  async hget(key: string, field: string): Promise<string | null> {
    const hash = this.data.get(key);
    if (!hash || !(hash instanceof Map)) {
      return null;
    }
    return hash.get(field) || null;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const hash = this.data.get(key);
    if (!hash || !(hash instanceof Map)) {
      return {};
    }
    return Object.fromEntries(hash);
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    const hash = this.data.get(key);
    if (!hash || !(hash instanceof Map)) {
      return 0;
    }
    let count = 0;
    for (const field of fields) {
      if (hash.delete(field)) {
        count++;
      }
    }
    return count;
  }

  // Set operations
  async sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.data.get(key) || new Set();
    if (!(set instanceof Set)) {
      throw new Error('WRONGTYPE');
    }
    let count = 0;
    for (const member of members) {
      if (!set.has(member)) {
        set.add(member);
        count++;
      }
    }
    this.data.set(key, set);
    return count;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const set = this.data.get(key);
    if (!set || !(set instanceof Set)) {
      return 0;
    }
    let count = 0;
    for (const member of members) {
      if (set.delete(member)) {
        count++;
      }
    }
    return count;
  }

  async smembers(key: string): Promise<string[]> {
    const set = this.data.get(key);
    if (!set || !(set instanceof Set)) {
      return [];
    }
    return Array.from(set);
  }

  async sismember(key: string, member: string): Promise<number> {
    const set = this.data.get(key);
    if (!set || !(set instanceof Set)) {
      return 0;
    }
    return set.has(member) ? 1 : 0;
  }

  // List operations
  async lpush(key: string, ...values: string[]): Promise<number> {
    const list = this.data.get(key) || [];
    if (!Array.isArray(list)) {
      throw new Error('WRONGTYPE');
    }
    list.unshift(...values.reverse());
    this.data.set(key, list);
    return list.length;
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    const list = this.data.get(key) || [];
    if (!Array.isArray(list)) {
      throw new Error('WRONGTYPE');
    }
    list.push(...values);
    this.data.set(key, list);
    return list.length;
  }

  async lpop(key: string): Promise<string | null> {
    const list = this.data.get(key);
    if (!list || !Array.isArray(list)) {
      return null;
    }
    const value = list.shift();
    if (list.length === 0) {
      this.data.delete(key);
    }
    return value || null;
  }

  async rpop(key: string): Promise<string | null> {
    const list = this.data.get(key);
    if (!list || !Array.isArray(list)) {
      return null;
    }
    const value = list.pop();
    if (list.length === 0) {
      this.data.delete(key);
    }
    return value || null;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.data.get(key);
    if (!list || !Array.isArray(list)) {
      return [];
    }

    // Handle negative indices
    if (start < 0) start = list.length + start;
    if (stop < 0) stop = list.length + stop;

    return list.slice(start, stop + 1);
  }

  async llen(key: string): Promise<number> {
    const list = this.data.get(key);
    if (!list || !Array.isArray(list)) {
      return 0;
    }
    return list.length;
  }

  // Utility methods
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
    this.pubsubCallbacks.clear();
    return 'OK';
  }

  // Pub/Sub
  async subscribe(...channels: string[]): Promise<void> {
    for (const channel of channels) {
      if (!this.pubsubCallbacks.has(channel)) {
        this.pubsubCallbacks.set(channel, new Set());
      }
    }
  }

  async publish(channel: string, message: string): Promise<number> {
    const callbacks = this.pubsubCallbacks.get(channel);
    if (!callbacks) {
      return 0;
    }

    for (const callback of callbacks) {
      callback(channel, message);
    }

    return callbacks.size;
  }

  on(event: string, callback: (...args: any[]) => void): void {
    // Simple event emitter simulation
    if (event === 'message') {
      for (const [channel, callbacks] of this.pubsubCallbacks) {
        callbacks.add(callback);
      }
    }
  }

  // Helper methods
  private checkExpiry(key: string): void {
    const expiry = this.expiries.get(key);
    if (expiry && expiry < Date.now()) {
      this.data.delete(key);
      this.expiries.delete(key);
    }
  }

  // Pipeline/Multi simulation
  pipeline(): this {
    return this;
  }

  multi(): this {
    return this;
  }

  async exec(): Promise<Array<[Error | null, any]>> {
    // Simplified - just return success for all commands
    return [[null, 'OK']];
  }

  // Status
  status = 'ready';

  async quit(): Promise<'OK'> {
    this.status = 'end';
    return 'OK';
  }

  async disconnect(): Promise<void> {
    this.status = 'disconnecting';
  }
}

/**
 * Create a mock Redis client
 */
export function createMockRedis(): MockRedisClient {
  return new MockRedisClient();
}

/**
 * Skip test if Redis is not available
 */
export async function skipIfNoRedis(): Promise<void> {
  const client = createRedisTestClient();
  const available = await client.isAvailable();
  await client.close();

  if (!available) {
    if (typeof test !== 'undefined' && test.skip) {
      test.skip('Redis not available', () => { });
    }
    throw new Error('Redis not available - skipping test');
  }
}