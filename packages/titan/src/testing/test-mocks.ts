/**
 * Test Mocks
 *
 * Mock implementations for common Titan framework components
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import type { Logger } from 'pino';
import type { ConfigService } from '../modules/config/config.service.js';
import type { RedisManager } from '../modules/redis/redis.manager.js';

/**
 * Create mock logger
 */
export function createMockLogger(): Logger {
  return {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn(() => createMockLogger()),
    level: 'info',
    silent: jest.fn(),
    bindings: jest.fn(() => ({})),
    flush: jest.fn(),
    isLevelEnabled: jest.fn(() => true),
  } as any;
}

/**
 * Create mock ConfigService
 */
export function createMockConfigService(data: Record<string, any> = {}): ConfigService {
  const emitter = new EventEmitter();
  const configData = { ...data };

  return {
    get: jest.fn((path?: string) => {
      if (!path) return configData;

      const keys = path.split('.');
      let result = configData;

      for (const key of keys) {
        result = result?.[key];
        if (result === undefined) return undefined;
      }

      return result;
    }),

    set: jest.fn((path: string, value: any) => {
      const keys = path.split('.');
      const lastKey = keys.pop()!;
      let target = configData;

      for (const key of keys) {
        if (!target[key]) {
          target[key] = {};
        }
        target = target[key];
      }

      target[lastKey] = value;
      emitter.emit('config:changed', { path, value });
    }),

    has: jest.fn((path: string) => {
      const keys = path.split('.');
      let result = configData;

      for (const key of keys) {
        result = result?.[key];
        if (result === undefined) return false;
      }

      return true;
    }),

    delete: jest.fn((path: string) => {
      const keys = path.split('.');
      const lastKey = keys.pop()!;
      let target = configData;

      for (const key of keys) {
        target = target?.[key];
        if (!target) return false;
      }

      if (lastKey in target) {
        delete target[lastKey];
        emitter.emit('config:changed', { path, value: undefined });
        return true;
      }

      return false;
    }),

    watch: jest.fn((path: string, callback: (event: any) => void) => {
      const handler = (event: any) => {
        if (event.path.startsWith(path)) {
          callback(event);
        }
      };
      emitter.on('config:changed', handler);
      return () => emitter.off('config:changed', handler);
    }),

    validate: jest.fn(() => true),
    reload: jest.fn(async () => {}),
    initialize: jest.fn(async () => {}),
    dispose: jest.fn(async () => {}),

    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    emit: emitter.emit.bind(emitter),
    once: emitter.once.bind(emitter),

    // Internal access for testing
    __data: configData,
    __emitter: emitter,
  } as any;
}

/**
 * Create mock RedisManager
 */
export function createMockRedisManager(): RedisManager {
  const clients = new Map<string, any>();
  const emitter = new EventEmitter();

  return {
    getClient: jest.fn((name = 'default') => {
      if (!clients.has(name)) {
        const mockClient = createMockRedisClient();
        clients.set(name, mockClient);
      }
      return clients.get(name);
    }),

    hasClient: jest.fn((name: string) => clients.has(name)),

    addClient: jest.fn((name: string, client: any) => {
      clients.set(name, client);
      emitter.emit('client:added', { name, client });
    }),

    removeClient: jest.fn(async (name: string) => {
      const client = clients.get(name);
      if (client) {
        await client.quit();
        clients.delete(name);
        emitter.emit('client:removed', { name });
      }
    }),

    getAllClients: jest.fn(() => Array.from(clients.entries())),

    connect: jest.fn(async () => {
      for (const [name, client] of clients) {
        await client.connect();
        emitter.emit('client:connected', { name, client });
      }
    }),

    disconnect: jest.fn(async () => {
      for (const [name, client] of clients) {
        await client.disconnect();
        emitter.emit('client:disconnected', { name });
      }
    }),

    isHealthy: jest.fn(async () => true),

    getMetrics: jest.fn(() => ({
      connections: clients.size,
      commands: 0,
      errors: 0,
    })),

    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    emit: emitter.emit.bind(emitter),
    once: emitter.once.bind(emitter),

    // Internal access for testing
    __clients: clients,
    __emitter: emitter,
  } as any;
}

/**
 * Create mock Redis client (simplified version)
 */
function createMockRedisClient(): any {
  const data = new Map<string, any>();
  const emitter = new EventEmitter();

  return {
    get: jest.fn(async (key: string) => data.get(key) ?? null),
    set: jest.fn(async (key: string, value: any) => {
      data.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (data.delete(key)) count++;
      }
      return count;
    }),
    exists: jest.fn(async (...keys: string[]) => keys.filter((k) => data.has(k)).length),
    ping: jest.fn(async () => 'PONG'),
    connect: jest.fn(async () => {
      emitter.emit('connect');
      emitter.emit('ready');
    }),
    disconnect: jest.fn(() => {
      emitter.emit('close');
    }),
    quit: jest.fn(async () => {
      emitter.emit('close');
    }),
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    duplicate: jest.fn((): any => createMockRedisClient()),
    __data: data,
    __emitter: emitter,
  };
}

/**
 * Create mock scheduler service
 */
export function createMockSchedulerService() {
  const jobs = new Map<string, any>();
  const emitter = new EventEmitter();

  return {
    schedule: jest.fn((name: string, pattern: string, handler: () => void) => {
      jobs.set(name, { pattern, handler, enabled: true });
      emitter.emit('job:scheduled', { name, pattern });
      return name;
    }),

    unschedule: jest.fn((name: string) => {
      if (jobs.delete(name)) {
        emitter.emit('job:unscheduled', { name });
        return true;
      }
      return false;
    }),

    getJob: jest.fn((name: string) => jobs.get(name)),
    getAllJobs: jest.fn(() => Array.from(jobs.entries())),

    start: jest.fn(() => {
      emitter.emit('scheduler:started');
    }),

    stop: jest.fn(() => {
      emitter.emit('scheduler:stopped');
    }),

    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),

    // Test helpers
    __jobs: jobs,
    __emitter: emitter,
    __trigger: (name: string) => {
      const job = jobs.get(name);
      if (job?.enabled) {
        job.handler();
        emitter.emit('job:executed', { name });
      }
    },
  };
}

/**
 * Create mock event bus
 */
export function createMockEventBus() {
  const emitter = new EventEmitter();
  const handlers = new Map<string, Set<(...args: any[]) => any>>();

  return {
    emit: jest.fn(async (event: string, data?: any) => {
      emitter.emit(event, data);
      const eventHandlers = handlers.get(event);
      if (eventHandlers) {
        for (const handler of eventHandlers) {
          await handler(data);
        }
      }
    }),

    on: jest.fn((event: string, handler: (...args: any[]) => any) => {
      if (!handlers.has(event)) {
        handlers.set(event, new Set());
      }
      handlers.get(event)!.add(handler);
      emitter.on(event, handler);
      return () => {
        handlers.get(event)?.delete(handler);
        emitter.off(event, handler);
      };
    }),

    once: jest.fn((event: string, handler: (...args: any[]) => any) => {
      const wrapper = (...args: any[]) => {
        handlers.get(event)?.delete(wrapper);
        return handler(...args);
      };

      if (!handlers.has(event)) {
        handlers.set(event, new Set());
      }
      handlers.get(event)!.add(wrapper);
      emitter.once(event, wrapper);
    }),

    off: jest.fn((event: string, handler: (...args: any[]) => any) => {
      handlers.get(event)?.delete(handler);
      emitter.off(event, handler);
    }),

    // Test helpers
    __emitter: emitter,
    __handlers: handlers,
    __getHandlerCount: (event: string) => handlers.get(event)?.size ?? 0,
  };
}
