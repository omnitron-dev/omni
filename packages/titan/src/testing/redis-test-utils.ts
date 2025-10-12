/**
 * Redis Test Utilities
 *
 * Enterprise-grade testing utilities for Redis-based components
 * Provides comprehensive fixtures and helpers for testing Redis functionality
 */

import { Redis, RedisOptions } from 'ioredis';
import { RedisManager } from '../modules/redis/redis.manager.js';
import { RedisService } from '../modules/redis/redis.service.js';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { Errors } from '../errors/factories.js';

/**
 * Redis test fixture configuration
 */
export interface RedisTestFixtureOptions {
  withManager?: boolean;
  withService?: boolean;
  db?: number;
  host?: string;
  port?: number;
  namespace?: string;
  password?: string;
  lazyConnect?: boolean;
  enableReadyCheck?: boolean;
  maxRetriesPerRequest?: number;
  retryStrategy?: () => null;
}

/**
 * Redis test fixture containing all necessary components
 */
export interface RedisTestFixture {
  client: Redis;
  manager?: RedisManager;
  service?: RedisService;
  cleanup: () => Promise<void>;
  options: RedisOptions;
}

/**
 * Create a Redis test fixture with proper cleanup
 */
export async function createRedisTestFixture(options: RedisTestFixtureOptions = {}): Promise<RedisTestFixture> {
  const {
    withManager = false,
    withService = false,
    db = 15, // Use test database
    host = 'localhost',
    port = 6379,
    namespace = 'test',
    lazyConnect = false,
    enableReadyCheck = true,
    maxRetriesPerRequest = 1,
    retryStrategy = () => null, // Disable retries in tests
  } = options;

  const redisOptions: RedisOptions = {
    host,
    port,
    db,
    password: options.password,
    lazyConnect,
    enableReadyCheck,
    maxRetriesPerRequest,
    retryStrategy,
  };

  // Create primary client
  const client = new Redis(redisOptions);

  // Wait for connection if not lazy
  if (!lazyConnect) {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.removeAllListeners();
        reject(Errors.timeout('Redis connection in test fixture', 10000));
      }, 10000); // 10 second timeout

      client.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
      client.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      // Ensure connection starts
      if (client.status === 'wait') {
        client.connect().catch(reject);
      }
    });
  }

  let manager: RedisManager | undefined;
  let service: RedisService | undefined;

  // Create manager if requested
  if (withManager) {
    manager = new RedisManager({
      // Create both default and test/cache clients for decorator tests
      clients: [
        {
          namespace: 'default',
          ...redisOptions,
          db: redisOptions.db, // Use the test DB
        },
        {
          namespace,
          ...redisOptions,
          db: redisOptions.db, // Use the test DB
        },
        ...(namespace !== 'cache'
          ? [
              {
                namespace: 'cache',
                ...redisOptions,
                db: 14, // Use different DB for cache namespace
              },
            ]
          : []),
      ],
    });
    await manager.onModuleInit();
  }

  // Create service if requested
  if (withService && manager) {
    service = new RedisService(manager);
  }

  // Cleanup function
  const cleanup = async () => {
    try {
      // Clear all data in test database
      await client.flushdb();

      // Cleanup manager
      if (manager) {
        await manager.onModuleDestroy();
      }

      // Close client
      client.disconnect();

      // Remove all listeners
      client.removeAllListeners();
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  };

  return {
    client,
    manager,
    service,
    cleanup,
    options: redisOptions,
  };
}

/**
 * Cleanup Redis test fixture
 */
export async function cleanupRedisTestFixture(fixture: RedisTestFixture): Promise<void> {
  if (fixture && fixture.cleanup) {
    await fixture.cleanup();
  }
}

/**
 * Wait for Redis operation to complete
 */
export async function waitForRedis(operation: () => Promise<any>, timeout = 5000): Promise<any> {
  return Promise.race([
    operation(),
    new Promise((_, reject) => setTimeout(() => reject(Errors.timeout('Redis operation', timeout)), timeout)),
  ]);
}

/**
 * Create mock Redis client for unit tests
 */
export function createMockRedis(): any {
  const data = new Map<string, any>();
  const pubsub = new EventEmitter();
  const locks = new Map<string, { token: string; ttl: number }>();

  const mock = {
    // Connection
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockImplementation(() => {
      mock.emit('close');
    }),
    quit: jest.fn().mockResolvedValue('OK'),
    ping: jest.fn().mockResolvedValue('PONG'),

    // Basic operations
    get: jest.fn().mockImplementation(async (key: string) => data.get(key) ?? null),

    set: jest.fn().mockImplementation(async (key: string, value: any, ...args: any[]) => {
      data.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));

      // Handle TTL
      if (args[0] === 'EX' && args[1]) {
        setTimeout(() => data.delete(key), args[1] * 1000);
      } else if (args[0] === 'PX' && args[1]) {
        setTimeout(() => data.delete(key), args[1]);
      }

      return 'OK';
    }),

    setex: jest.fn().mockImplementation(async (key: string, ttl: number, value: any) => {
      data.set(key, String(value));
      setTimeout(() => data.delete(key), ttl * 1000);
      return 'OK';
    }),

    del: jest.fn().mockImplementation(async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (data.delete(key)) count++;
      }
      return count;
    }),

    exists: jest.fn().mockImplementation(async (...keys: string[]) => keys.filter((k) => data.has(k)).length),

    expire: jest.fn().mockImplementation(async (key: string, ttl: number) => {
      if (data.has(key)) {
        setTimeout(() => data.delete(key), ttl * 1000);
        return 1;
      }
      return 0;
    }),

    ttl: jest.fn().mockImplementation(async (key: string) => (data.has(key) ? -1 : -2)),

    keys: jest.fn().mockImplementation(async (pattern: string) => {
      if (pattern === '*') return Array.from(data.keys());
      const regex = new RegExp(pattern.replace('*', '.*'));
      return Array.from(data.keys()).filter((k) => regex.test(k));
    }),

    // Hash operations
    hget: jest.fn().mockImplementation(async (key: string, field: string) => {
      const hash = data.get(key);
      if (!hash || typeof hash !== 'object') return null;
      return hash[field] ?? null;
    }),

    hset: jest.fn().mockImplementation(async (key: string, field: string, value: any) => {
      let hash = data.get(key);
      if (!hash || typeof hash !== 'object') {
        hash = {};
        data.set(key, hash);
      }
      const isNew = !(field in hash);
      hash[field] = value;
      return isNew ? 1 : 0;
    }),

    hgetall: jest.fn().mockImplementation(async (key: string) => {
      const hash = data.get(key);
      return hash && typeof hash === 'object' ? hash : {};
    }),

    // List operations
    lpush: jest.fn().mockImplementation(async (key: string, ...values: any[]) => {
      let list = data.get(key);
      if (!Array.isArray(list)) {
        list = [];
        data.set(key, list);
      }
      list.unshift(...values);
      return list.length;
    }),

    rpush: jest.fn().mockImplementation(async (key: string, ...values: any[]) => {
      let list = data.get(key);
      if (!Array.isArray(list)) {
        list = [];
        data.set(key, list);
      }
      list.push(...values);
      return list.length;
    }),

    lpop: jest.fn().mockImplementation(async (key: string) => {
      const list = data.get(key);
      if (!Array.isArray(list) || list.length === 0) return null;
      return list.shift();
    }),

    rpop: jest.fn().mockImplementation(async (key: string) => {
      const list = data.get(key);
      if (!Array.isArray(list) || list.length === 0) return null;
      return list.pop();
    }),

    lrange: jest.fn().mockImplementation(async (key: string, start: number, stop: number) => {
      const list = data.get(key);
      if (!Array.isArray(list)) return [];
      return list.slice(start, stop + 1);
    }),

    // Set operations
    sadd: jest.fn().mockImplementation(async (key: string, ...members: any[]) => {
      let set = data.get(key);
      if (!set || !(set instanceof Set)) {
        set = new Set();
        data.set(key, set);
      }
      let added = 0;
      for (const member of members) {
        if (!set.has(member)) {
          set.add(member);
          added++;
        }
      }
      return added;
    }),

    smembers: jest.fn().mockImplementation(async (key: string) => {
      const set = data.get(key);
      if (!set || !(set instanceof Set)) return [];
      return Array.from(set);
    }),

    sismember: jest.fn().mockImplementation(async (key: string, member: any) => {
      const set = data.get(key);
      if (!set || !(set instanceof Set)) return 0;
      return set.has(member) ? 1 : 0;
    }),

    // Pub/Sub
    subscribe: jest.fn().mockImplementation(async (...channels: string[]) => {
      for (const channel of channels) {
        pubsub.on(channel, () => {});
      }
      return channels.length;
    }),

    unsubscribe: jest.fn().mockImplementation(async (...channels: string[]) => {
      for (const channel of channels) {
        pubsub.removeAllListeners(channel);
      }
      return channels.length;
    }),

    publish: jest.fn().mockImplementation(async (channel: string, message: string) => {
      const listeners = pubsub.listenerCount(channel);
      pubsub.emit(channel, message);
      return listeners;
    }),

    // Transactions
    multi: jest.fn().mockImplementation(() => {
      const commands: any[] = [];
      const multi = {
        get: (key: string) => {
          commands.push(['get', key]);
          return multi;
        },
        set: (key: string, value: any) => {
          commands.push(['set', key, value]);
          return multi;
        },
        del: (...keys: string[]) => {
          commands.push(['del', ...keys]);
          return multi;
        },
        exec: jest.fn().mockImplementation(async () => {
          const results = [];
          for (const [cmd, ...args] of commands) {
            try {
              const result = await (mock as any)[cmd](...args);
              results.push([null, result]);
            } catch (error) {
              results.push([error, null]);
            }
          }
          return results;
        }),
      };
      return multi;
    }),

    // Lock operations (for RedisLock decorator)
    eval: jest.fn().mockImplementation(async (script: string, ...args: any[]) => {
      // Simple lock implementation
      const [numKeys, ...params] = args;
      const keys = params.slice(0, numKeys);
      const values = params.slice(numKeys);

      if (script.includes('redis.call("set"')) {
        // Lock acquisition script
        const [key] = keys;
        const [token, ttl] = values;

        if (locks.has(key)) {
          return 0; // Lock already held
        }

        locks.set(key, { token, ttl: parseInt(ttl) });
        setTimeout(() => {
          const lock = locks.get(key);
          if (lock && lock.token === token) {
            locks.delete(key);
          }
        }, parseInt(ttl));

        return 1; // Lock acquired
      } else if (script.includes('redis.call("del"')) {
        // Lock release script
        const [key] = keys;
        const [token] = values;

        const lock = locks.get(key);
        if (lock && lock.token === token) {
          locks.delete(key);
          return 1; // Lock released
        }

        return 0; // Lock not held or wrong token
      }

      return null;
    }),

    // Utility
    flushdb: jest.fn().mockImplementation(async () => {
      data.clear();
      locks.clear();
      return 'OK';
    }),

    flushall: jest.fn().mockImplementation(async () => {
      data.clear();
      locks.clear();
      return 'OK';
    }),

    // Event emitter methods
    on: jest.fn().mockImplementation((event: string, handler: (...args: any[]) => any) => {
      pubsub.on(event, handler);
      return mock;
    }),

    once: jest.fn().mockImplementation((event: string, handler: (...args: any[]) => any) => {
      pubsub.once(event, handler);
      return mock;
    }),

    off: jest.fn().mockImplementation((event: string, handler: (...args: any[]) => any) => {
      pubsub.off(event, handler);
      return mock;
    }),

    emit: jest.fn().mockImplementation((event: string, ...args: any[]) => {
      pubsub.emit(event, ...args);
      return true;
    }),

    removeAllListeners: jest.fn().mockImplementation((event?: string) => {
      if (event) {
        pubsub.removeAllListeners(event);
      } else {
        pubsub.removeAllListeners();
      }
      return mock;
    }),

    // Duplicate for creating subscriber clients
    duplicate: jest.fn().mockImplementation(() => createMockRedis()),

    // Status
    status: 'ready',

    // Internal access for testing
    __data: data,
    __locks: locks,
    __pubsub: pubsub,
  };

  // Emit ready event on next tick
  process.nextTick(() => {
    mock.emit('ready');
  });

  return mock;
}

/**
 * Redis performance testing utilities
 */
export class RedisPerformanceTester {
  private metrics: Map<string, { count: number; totalTime: number }> = new Map();

  async measure<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const start = process.hrtime.bigint();
    try {
      const result = await fn();
      const end = process.hrtime.bigint();
      const duration = Number(end - start) / 1_000_000; // Convert to ms

      const metric = this.metrics.get(operation) || { count: 0, totalTime: 0 };
      metric.count++;
      metric.totalTime += duration;
      this.metrics.set(operation, metric);

      return result;
    } catch (error) {
      const end = process.hrtime.bigint();
      const duration = Number(end - start) / 1_000_000;

      const metric = this.metrics.get(operation) || { count: 0, totalTime: 0 };
      metric.count++;
      metric.totalTime += duration;
      this.metrics.set(operation, metric);

      throw error;
    }
  }

  getMetrics() {
    const results: Record<string, any> = {};

    for (const [operation, metric] of this.metrics) {
      results[operation] = {
        count: metric.count,
        totalTime: metric.totalTime,
        avgTime: metric.totalTime / metric.count,
      };
    }

    return results;
  }

  reset() {
    this.metrics.clear();
  }
}
