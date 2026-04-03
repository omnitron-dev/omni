/**
 * Test Mocks
 *
 * Mock implementations for common Titan framework components
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import type { Logger } from 'pino';
import type { ConfigService } from '@omnitron-dev/titan/module/config';
import type { RedisManager } from '@omnitron-dev/titan-redis';

/**
 * Create mock logger
 */
export function createMockLogger(): Logger {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => createMockLogger()),
    level: 'info',
    silent: vi.fn(),
    bindings: vi.fn(() => ({})),
    flush: vi.fn(),
    isLevelEnabled: vi.fn(() => true),
  } as any;
}

/**
 * Create mock ConfigService
 */
export function createMockConfigService(data: Record<string, any> = {}): ConfigService {
  const emitter = new EventEmitter();
  const configData = { ...data };

  return {
    get: vi.fn((path?: string) => {
      if (!path) return configData;

      const keys = path.split('.');
      let result = configData;

      for (const key of keys) {
        result = result?.[key];
        if (result === undefined) return undefined;
      }

      return result;
    }),

    set: vi.fn((path: string, value: any) => {
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

    has: vi.fn((path: string) => {
      const keys = path.split('.');
      let result = configData;

      for (const key of keys) {
        result = result?.[key];
        if (result === undefined) return false;
      }

      return true;
    }),

    delete: vi.fn((path: string) => {
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

    watch: vi.fn((path: string, callback: (event: any) => void) => {
      const handler = (event: any) => {
        if (event.path.startsWith(path)) {
          callback(event);
        }
      };
      emitter.on('config:changed', handler);
      return () => emitter.off('config:changed', handler);
    }),

    validate: vi.fn(() => true),
    reload: vi.fn(async () => {}),
    initialize: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),

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
    getClient: vi.fn((name = 'default') => {
      if (!clients.has(name)) {
        const mockClient = createMockRedisClient();
        clients.set(name, mockClient);
      }
      return clients.get(name);
    }),

    hasClient: vi.fn((name: string) => clients.has(name)),

    addClient: vi.fn((name: string, client: any) => {
      clients.set(name, client);
      emitter.emit('client:added', { name, client });
    }),

    removeClient: vi.fn(async (name: string) => {
      const client = clients.get(name);
      if (client) {
        await client.quit();
        clients.delete(name);
        emitter.emit('client:removed', { name });
      }
    }),

    getAllClients: vi.fn(() => Array.from(clients.entries())),

    connect: vi.fn(async () => {
      for (const [name, client] of clients) {
        await client.connect();
        emitter.emit('client:connected', { name, client });
      }
    }),

    disconnect: vi.fn(async () => {
      for (const [name, client] of clients) {
        await client.disconnect();
        emitter.emit('client:disconnected', { name });
      }
    }),

    isHealthy: vi.fn(async () => true),

    getMetrics: vi.fn(() => ({
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
export function createMockRedisClient(): any {
  const data = new Map<string, any>();
  const emitter = new EventEmitter();

  return {
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    set: vi.fn(async (key: string, value: any) => {
      data.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (data.delete(key)) count++;
      }
      return count;
    }),
    exists: vi.fn(async (...keys: string[]) => keys.filter((k) => data.has(k)).length),
    ping: vi.fn(async () => 'PONG'),
    connect: vi.fn(async () => {
      emitter.emit('connect');
      emitter.emit('ready');
    }),
    disconnect: vi.fn(() => {
      emitter.emit('close');
    }),
    quit: vi.fn(async () => {
      emitter.emit('close');
    }),
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    duplicate: vi.fn((): any => createMockRedisClient()),
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
    schedule: vi.fn((name: string, pattern: string, handler: () => void) => {
      jobs.set(name, { pattern, handler, enabled: true });
      emitter.emit('job:scheduled', { name, pattern });
      return name;
    }),

    unschedule: vi.fn((name: string) => {
      if (jobs.delete(name)) {
        emitter.emit('job:unscheduled', { name });
        return true;
      }
      return false;
    }),

    getJob: vi.fn((name: string) => jobs.get(name)),
    getAllJobs: vi.fn(() => Array.from(jobs.entries())),

    start: vi.fn(() => {
      emitter.emit('scheduler:started');
    }),

    stop: vi.fn(() => {
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
    emit: vi.fn(async (event: string, data?: any) => {
      emitter.emit(event, data);
      const eventHandlers = handlers.get(event);
      if (eventHandlers) {
        for (const handler of eventHandlers) {
          await handler(data);
        }
      }
    }),

    on: vi.fn((event: string, handler: (...args: any[]) => any) => {
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

    once: vi.fn((event: string, handler: (...args: any[]) => any) => {
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

    off: vi.fn((event: string, handler: (...args: any[]) => any) => {
      handlers.get(event)?.delete(handler);
      emitter.off(event, handler);
    }),

    // Test helpers
    __emitter: emitter,
    __handlers: handlers,
    __getHandlerCount: (event: string) => handlers.get(event)?.size ?? 0,
  };
}
