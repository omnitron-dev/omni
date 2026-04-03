/**
 * Unit tests for MultiBackendClient
 *
 * Tests the MultiBackendClient class which orchestrates multiple backend
 * connections with service routing and shared middleware.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MultiBackendClient, createMultiBackendClient } from '../../../src/client/multi-backend-client.js';
import type { BackendConfig, MultiBackendClientOptions } from '../../../src/types/multi-backend.js';
import { ConnectionState } from '../../../src/types/index.js';

// Create mock for BackendClient
const createMockBackendClient = (name: string, config: BackendConfig, baseUrl: string) => {
  let connected = false;

  return {
    name,
    connect: vi.fn().mockImplementation(async () => {
      connected = true;
    }),
    disconnect: vi.fn().mockImplementation(async () => {
      connected = false;
    }),
    destroy: vi.fn().mockImplementation(async () => {
      connected = false;
    }),
    isConnected: vi.fn().mockImplementation(() => connected),
    getMetrics: vi.fn().mockImplementation(() => ({
      id: name,
      url: `${baseUrl}${config.path}`,
      state: connected ? ConnectionState.CONNECTED : ConnectionState.DISCONNECTED,
      transport: config.transport || 'http',
      requestsSent: 10,
      responsesReceived: 9,
      errors: 1,
      avgLatency: 50,
    })),
    getPath: vi.fn().mockReturnValue(config.path),
    getTransportType: vi.fn().mockReturnValue(config.transport || 'http'),
    getName: vi.fn().mockReturnValue(name),
    service: vi.fn().mockImplementation((serviceName: string) => {
      return new Proxy(
        {},
        {
          get: (_target, method: string) => {
            if (typeof method === 'symbol') return undefined;
            return vi.fn().mockResolvedValue({
              backend: name,
              service: serviceName,
              method,
              result: 'success',
            });
          },
        }
      );
    }),
    invoke: vi.fn().mockResolvedValue({ result: 'success' }),
  };
};

// Mock BackendClient module as a class
vi.mock('../../../src/client/backend-client.js', () => {
  const MockBackendClient = class {
    private name: string;
    private config: any;
    private baseUrl: string;
    private _connected = false;

    constructor(options: any) {
      this.name = options.name;
      this.config = options.config;
      this.baseUrl = options.baseUrl;
    }

    connect = vi.fn().mockImplementation(async () => {
      this._connected = true;
    });

    disconnect = vi.fn().mockImplementation(async () => {
      this._connected = false;
    });

    destroy = vi.fn().mockImplementation(async () => {
      this._connected = false;
    });

    isConnected = vi.fn().mockImplementation(() => this._connected);

    getMetrics = vi.fn().mockImplementation(() => ({
      id: this.name,
      url: `${this.baseUrl}${this.config.path}`,
      state: this._connected ? 'connected' : 'disconnected',
      transport: this.config.transport || 'http',
      requestsSent: 10,
      responsesReceived: 9,
      errors: 1,
      avgLatency: 50,
    }));

    getPath = vi.fn().mockImplementation(() => this.config.path);
    getTransportType = vi.fn().mockImplementation(() => this.config.transport || 'http');
    getName = vi.fn().mockImplementation(() => this.name);

    service = vi.fn().mockImplementation((serviceName: string) => {
      const self = this;
      return new Proxy(
        {},
        {
          get: (_target, method: string | symbol) => {
            if (typeof method === 'symbol') return undefined;
            return vi.fn().mockResolvedValue({
              backend: self.name,
              service: serviceName,
              method,
              result: 'success',
            });
          },
        }
      );
    });

    invoke = vi.fn().mockResolvedValue({ result: 'success' });
  };

  return { BackendClient: MockBackendClient };
});

// Mock MiddlewarePipeline as a class
vi.mock('../../../src/middleware/pipeline.js', () => {
  const MockMiddlewarePipeline = class {
    use = vi.fn();
    execute = vi.fn().mockResolvedValue(undefined);
    clear = vi.fn();
    getMetrics = vi.fn().mockReturnValue({ executions: 0, errors: 0, avgTime: 0 });
  };
  return { MiddlewarePipeline: MockMiddlewarePipeline };
});

describe('MultiBackendClient', () => {
  const baseUrl = 'https://api.example.com';
  const backends: Record<string, BackendConfig> = {
    core: { path: '/core' },
    storage: { path: '/storage' },
    chat: { path: '/chat', transport: 'websocket' as const },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create with valid config', () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
      });

      expect(client.getBaseUrl()).toBe('https://api.example.com');
      expect(client.getBackendNames()).toEqual(['core', 'storage', 'chat']);
    });

    it('should use first backend as default if not specified', () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
      });

      expect(client.getDefaultBackend()).toBe('core');
    });

    it('should use specified default backend', () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
        defaultBackend: 'storage' as any,
      });

      expect(client.getDefaultBackend()).toBe('storage');
    });

    it('should throw error for invalid default backend', () => {
      expect(() => {
        new MultiBackendClient({
          baseUrl,
          backends,
          defaultBackend: 'unknown' as any,
        });
      }).toThrow("Default backend 'unknown' not found in backends configuration");
    });

    it('should normalize base URL by removing trailing slash', () => {
      const client = new MultiBackendClient({
        baseUrl: 'https://api.example.com/',
        backends,
      });

      expect(client.getBaseUrl()).toBe('https://api.example.com');
    });
  });

  describe('backend', () => {
    it('should get backend by name', () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
      });

      const coreBackend = client.backend('core' as any);

      expect(coreBackend).toBeDefined();
    });

    it('should throw for unknown backend', () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
      });

      expect(() => client.backend('unknown' as any)).toThrow("Backend 'unknown' not found in pool");
    });
  });

  describe('service routing', () => {
    it('should route service to correct backend via explicit mapping', () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
        defaultBackend: 'core' as any,
        routing: {
          services: {
            UserService: 'core',
            FileService: 'storage',
          },
          patterns: [
            { pattern: /^storage\./, backend: 'storage' },
            { pattern: 'chat', backend: 'chat' },
          ],
        },
      });

      const router = client.getRouter();

      expect(router.resolve('UserService')).toBe('core');
      expect(router.resolve('FileService')).toBe('storage');
    });

    it('should route service to correct backend via pattern', () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
        defaultBackend: 'core' as any,
        routing: {
          patterns: [
            { pattern: /^storage\./, backend: 'storage' },
            { pattern: 'chat', backend: 'chat' },
          ],
        },
      });

      const router = client.getRouter();

      expect(router.resolve('storage.files')).toBe('storage');
      expect(router.resolve('chatService')).toBe('chat');
    });

    it('should fall back to default backend', () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
        defaultBackend: 'core' as any,
      });

      const router = client.getRouter();

      expect(router.resolve('UnknownService')).toBe('core');
    });
  });

  describe('service proxy', () => {
    it('should get service with automatic backend routing', () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
        defaultBackend: 'core' as any,
      });

      interface UserService {
        getById(id: string): Promise<any>;
      }

      const service = client.service<UserService>('users');

      expect(service).toBeDefined();
      expect(typeof service.getById).toBe('function');
    });

    it('should invoke service method correctly', async () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
        defaultBackend: 'core' as any,
      });

      interface UserService {
        getById(id: string): Promise<any>;
      }

      const service = client.service<UserService>('users');
      const result = await service.getById('123');

      expect(result).toBeDefined();
    });
  });

  describe('invoke', () => {
    it('should invoke method with explicit backend', async () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
      });

      const result = await client.invoke('core', 'users', 'getById', ['123']);

      expect(result).toEqual({ result: 'success' });
    });

    it('should pass invoke options correctly', async () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
      });

      const result = await client.invoke('core', 'users', 'getById', ['123'], {
        timeout: 5000,
        context: { userId: 'user-1' },
      });

      expect(result).toEqual({ result: 'success' });
    });
  });

  describe('connect', () => {
    it('should connect to specific backend', async () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
      });

      await client.connect('core');

      expect(client.isConnected('core')).toBe(true);
    });

    it('should connect to all backends', async () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
      });

      await client.connect();

      // All backends should be connected
      expect(client.isConnected('core')).toBe(true);
      expect(client.isConnected('storage')).toBe(true);
      expect(client.isConnected('chat')).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('should disconnect from specific backend', async () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
      });

      await client.connect('core');
      await client.disconnect('core');

      expect(client.isConnected('core')).toBe(false);
    });

    it('should disconnect from all backends', async () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
      });

      await client.connect();
      await client.disconnect();

      expect(client.isConnected('core')).toBe(false);
      expect(client.isConnected('storage')).toBe(false);
      expect(client.isConnected('chat')).toBe(false);
    });
  });

  describe('isConnected', () => {
    it('should check specific backend connection', async () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
      });

      expect(client.isConnected('core')).toBe(false);

      await client.connect('core');

      expect(client.isConnected('core')).toBe(true);
    });

    it('should check all backends connection when no name provided', async () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
      });

      expect(client.isConnected()).toBe(false);

      await client.connect();

      expect(client.isConnected()).toBe(true);
    });
  });

  describe('metrics', () => {
    it('should aggregate metrics from all backends', async () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
      });

      await client.connect();

      const metrics = client.getMetrics();

      expect(metrics.totalRequestsSent).toBeDefined();
      expect(metrics.totalResponsesReceived).toBeDefined();
      expect(metrics.totalErrors).toBeDefined();
      expect(metrics.avgLatency).toBeDefined();
    });
  });

  describe('middleware', () => {
    it('should return shared middleware manager', () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
      });

      const middleware = client.getMiddleware();

      expect(middleware).toBeDefined();
      expect(typeof middleware.use).toBe('function');
    });

    it('should allow adding middleware via use()', () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
      });

      const middleware = vi.fn();
      const result = client.use(middleware);

      expect(result).toBe(client); // Returns this for chaining
    });
  });

  describe('health', () => {
    it('should get health status of all backends', async () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
      });

      const health = await client.getHealth();

      expect(health).toBeInstanceOf(Map);
    });

    it('should return healthy backends', () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
      });

      const healthy = client.getHealthyBackends();

      expect(Array.isArray(healthy)).toBe(true);
    });

    it('should return unhealthy backends', () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
      });

      const unhealthy = client.getUnhealthyBackends();

      expect(Array.isArray(unhealthy)).toBe(true);
    });
  });

  describe('destroy', () => {
    it('should destroy client and release resources', async () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
      });

      await client.destroy();

      // Should complete without throwing
      expect(true).toBe(true);
    });
  });

  describe('getRouter', () => {
    it('should return the service router', () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
      });

      const router = client.getRouter();

      expect(router).toBeDefined();
      expect(typeof router.resolve).toBe('function');
    });
  });

  describe('getPool', () => {
    it('should return the backend pool', () => {
      const client = new MultiBackendClient({
        baseUrl,
        backends,
      });

      const pool = client.getPool();

      expect(pool).toBeDefined();
      expect(typeof pool.get).toBe('function');
    });
  });
});

describe('createMultiBackendClient', () => {
  const baseUrl = 'https://api.example.com';
  const backends: Record<string, BackendConfig> = {
    core: { path: '/core' },
    storage: { path: '/storage' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create client with factory function', () => {
    const client = createMultiBackendClient({
      baseUrl,
      backends,
    });

    expect(client).toBeDefined();
    expect(client.getBackendNames()).toEqual(['core', 'storage']);
  });

  describe('property access via Proxy', () => {
    it('should support property access via Proxy (client.core)', () => {
      const client = createMultiBackendClient({
        baseUrl,
        backends,
      });

      // Access backend via property
      const coreProxy = (client as any).core;

      expect(coreProxy).toBeDefined();
    });

    it('should support service access via Proxy (client.core.users)', async () => {
      const client = createMultiBackendClient({
        baseUrl,
        backends,
      });

      // Access service via property chain
      const usersService = (client as any).core.users;

      expect(usersService).toBeDefined();
    });

    it('should return undefined for unknown backends', () => {
      const client = createMultiBackendClient({
        baseUrl,
        backends,
      });

      const unknown = (client as any).unknownBackend;

      expect(unknown).toBeUndefined();
    });

    it('should preserve actual method access', () => {
      const client = createMultiBackendClient({
        baseUrl,
        backends,
      });

      expect(client.getBackendNames).toBeDefined();
      expect(typeof client.getBackendNames).toBe('function');
      expect(client.getBackendNames()).toEqual(['core', 'storage']);
    });

    it('should return undefined for symbol properties on service proxy', () => {
      const client = createMultiBackendClient({
        baseUrl,
        backends,
      });

      const coreProxy = (client as any).core;
      const symbolProp = coreProxy[Symbol.toStringTag];

      expect(symbolProp).toBeUndefined();
    });
  });

  describe('typed backend schema', () => {
    interface MyBackendSchema {
      core: {
        users: {
          getById(id: string): Promise<{ id: string; name: string }>;
          list(): Promise<Array<{ id: string; name: string }>>;
        };
        auth: {
          login(credentials: { email: string; password: string }): Promise<{ token: string }>;
        };
      };
      storage: {
        files: {
          upload(file: File): Promise<{ url: string }>;
        };
      };
    }

    it('should support typed backend schema', () => {
      const client = createMultiBackendClient<MyBackendSchema>({
        baseUrl,
        backends: {
          core: { path: '/core' },
          storage: { path: '/storage' },
        },
      });

      // Type-safe backend access
      const coreBackend = client.backend('core');
      expect(coreBackend).toBeDefined();
    });
  });
});
