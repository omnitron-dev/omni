/**
 * Test Helper Utilities
 *
 * Common utilities for testing Titan framework components
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import type { IConfigModuleOptions as ConfigModuleOptions } from '../modules/config/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Errors } from '../errors/factories.js';

/**
 * Create a temporary directory for tests
 */
export function createTempDir(prefix = 'titan-test-'): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return tempDir;
}

/**
 * Clean up temporary directory
 */
export function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Create test configuration options
 */
export function createTestConfig(overrides?: Partial<ConfigModuleOptions>): ConfigModuleOptions {
  return {
    sources: [
      {
        type: 'object',
        data: {
          app: {
            name: 'test-app',
            port: 3000,
            env: 'test',
          },
          database: {
            host: 'localhost',
            port: 5432,
            name: 'testdb',
          },
          redis: {
            host: 'localhost',
            port: 6379,
          },
        },
      },
    ],
    ...overrides,
  };
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw Errors.timeout('waitFor', timeout);
}

/**
 * Wait for event to be emitted
 */
export async function waitForEvent<T = any>(
  emitter: EventEmitter,
  event: string,
  timeout = 5000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Errors.timeout('event: ' + event, timeout));
    }, timeout);

    emitter.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

/**
 * Collect events emitted during test
 */
export class EventCollector<T = any> {
  private events: Array<{ event: string; data: T; timestamp: number }> = [];
  private listeners = new Map<string, (...args: any[]) => void>();

  constructor(private emitter: EventEmitter) {}

  /**
   * Start collecting events
   */
  collect(eventNames: string | string[]): this {
    const events = Array.isArray(eventNames) ? eventNames : [eventNames];

    for (const event of events) {
      const listener = (data: T) => {
        this.events.push({
          event,
          data,
          timestamp: Date.now(),
        });
      };

      this.emitter.on(event, listener);
      this.listeners.set(event, listener);
    }

    return this;
  }

  /**
   * Get collected events
   */
  getEvents(eventName?: string): Array<{ event: string; data: T; timestamp: number }> {
    if (eventName) {
      return this.events.filter(e => e.event === eventName);
    }
    return [...this.events];
  }

  /**
   * Get event data only
   */
  getData(eventName?: string): T[] {
    return this.getEvents(eventName).map(e => e.data);
  }

  /**
   * Clear collected events
   */
  clear(): void {
    this.events = [];
  }

  /**
   * Stop collecting and cleanup
   */
  stop(): void {
    for (const [event, listener] of this.listeners) {
      this.emitter.off(event, listener);
    }
    this.listeners.clear();
    this.clear();
  }
}

/**
 * Create a mock Redis client for testing
 */
export function createMockRedisClient(): any {
  const data = new Map<string, any>();
  const subscribers = new Map<string, Set<(...args: any[]) => void>>();
  const emitter = new EventEmitter();

  return {
    data, // Expose for testing
    connected: true,

    // Basic operations
    get: jest.fn(async (key: string) => data.get(key) ?? null),
    set: jest.fn(async (key: string, value: any) => {
      data.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (...keys: string[]) => {
      let deleted = 0;
      for (const key of keys) {
        if (data.delete(key)) deleted++;
      }
      return deleted;
    }),
    exists: jest.fn(async (...keys: string[]) => keys.filter(k => data.has(k)).length),
    keys: jest.fn(async (pattern: string) => {
      if (pattern === '*') return Array.from(data.keys());
      // Simple pattern matching
      const regex = new RegExp(pattern.replace('*', '.*'));
      return Array.from(data.keys()).filter(k => regex.test(k));
    }),

    // Hash operations
    hget: jest.fn(async (key: string, field: string) => {
      const hash = data.get(key);
      return hash?.[field] ?? null;
    }),
    hset: jest.fn(async (key: string, field: string, value: any) => {
      const hash = data.get(key) || {};
      hash[field] = value;
      data.set(key, hash);
      return 1;
    }),
    hgetall: jest.fn(async (key: string) => data.get(key) || {}),

    // List operations
    lpush: jest.fn(async (key: string, ...values: any[]) => {
      const list = data.get(key) || [];
      list.unshift(...values);
      data.set(key, list);
      return list.length;
    }),
    rpush: jest.fn(async (key: string, ...values: any[]) => {
      const list = data.get(key) || [];
      list.push(...values);
      data.set(key, list);
      return list.length;
    }),
    lpop: jest.fn(async (key: string) => {
      const list = data.get(key) || [];
      return list.shift() ?? null;
    }),
    lrange: jest.fn(async (key: string, start: number, stop: number) => {
      const list = data.get(key) || [];
      return list.slice(start, stop + 1);
    }),

    // Pub/Sub
    subscribe: jest.fn(async (...channels: string[]) => {
      for (const channel of channels) {
        if (!subscribers.has(channel)) {
          subscribers.set(channel, new Set());
        }
      }
      return channels.length;
    }),
    unsubscribe: jest.fn(async (...channels: string[]) => {
      for (const channel of channels) {
        subscribers.delete(channel);
      }
      return channels.length;
    }),
    publish: jest.fn(async (channel: string, message: string) => {
      const subs = subscribers.get(channel);
      if (subs) {
        for (const callback of subs) {
          callback(channel, message);
        }
      }
      emitter.emit(`message:${channel}`, message);
      return subs?.size ?? 0;
    }),
    on: jest.fn((event: string, callback: (...args: any[]) => void) => {
      if (event === 'message') {
        // Handle pub/sub message events
        emitter.on('message', callback);
      } else {
        emitter.on(event, callback);
      }
    }),
    off: jest.fn((event: string, callback: (...args: any[]) => void) => {
      emitter.off(event, callback);
    }),

    // Connection management
    connect: jest.fn(async () => {
      emitter.emit('connect');
      emitter.emit('ready');
    }),
    disconnect: jest.fn(() => {
      emitter.emit('close');
      emitter.emit('end');
    }),
    quit: jest.fn(async () => {
      emitter.emit('close');
      emitter.emit('end');
    }),

    // Pipeline/Multi
    pipeline: jest.fn((): any => {
      const commands: any[] = [];
      const pipeline: any = {
        get: (key: string) => {
          commands.push(['get', key]);
          return pipeline;
        },
        set: (key: string, value: any) => {
          commands.push(['set', key, value]);
          return pipeline;
        },
        exec: jest.fn(async () => {
          const results = [];
          for (const [cmd, ...args] of commands) {
            // @ts-expect-error - Redis command methods are dynamically accessed
            results.push([null, await client[cmd](...args)]);
          }
          return results;
        }),
      };
      return pipeline;
    }),

    multi: jest.fn((): any => ({
        exec: jest.fn(async () => []),
      })),

    // Utility
    ping: jest.fn(async () => 'PONG'),
    flushall: jest.fn(async () => {
      data.clear();
      return 'OK';
    }),
    flushdb: jest.fn(async () => {
      data.clear();
      return 'OK';
    }),

    // Expose emitter for testing
    __emitter: emitter,
    duplicate: jest.fn((): any => createMockRedisClient()),
  };
}

/**
 * Create deferred promise for testing async flows
 */
export function createDeferred<T = void>() {
  let resolve: (value: T) => void;
  let reject: (error: any) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve: resolve!,
    reject: reject!,
  };
}

/**
 * Suppress console output during tests
 */
export function suppressConsole() {
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    info: console.info,
  };

  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
  console.debug = jest.fn();
  console.info = jest.fn();

  return () => {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.debug = originalConsole.debug;
    console.info = originalConsole.info;
  };
}