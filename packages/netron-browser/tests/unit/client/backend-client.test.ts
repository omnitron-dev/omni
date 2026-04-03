/**
 * Unit tests for BackendClient
 *
 * Tests the BackendClient class which wraps a single backend connection,
 * providing a unified interface for service access and method invocation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BackendClient, type BackendClientOptions } from '../../../src/client/backend-client.js';
import type { BackendConfig } from '../../../src/types/multi-backend.js';
import { ConnectionState } from '../../../src/types/index.js';

// Mock the client modules before any imports - must be defined as classes
vi.mock('../../../src/client/http-client.js', () => {
  const MockHttpClient = class {
    private url: string;
    private _connected = false;

    constructor(options: any) {
      this.url = options.url;
    }

    connect = vi.fn().mockImplementation(async () => {
      this._connected = true;
    });

    disconnect = vi.fn().mockImplementation(async () => {
      this._connected = false;
    });

    invoke = vi.fn().mockResolvedValue({ result: 'http-success' });

    isConnected = vi.fn().mockImplementation(() => this._connected);

    getMetrics = vi.fn().mockImplementation(() => ({
      id: 'http-client',
      url: this.url,
      state: this._connected ? ConnectionState.CONNECTED : ConnectionState.DISCONNECTED,
      transport: 'http',
      requestsSent: 10,
      responsesReceived: 9,
      errors: 1,
      avgLatency: 50,
    }));

    getState = vi.fn().mockReturnValue('connected');
  };

  return { HttpClient: MockHttpClient };
});

vi.mock('../../../src/client/ws-client.js', () => {
  const MockWebSocketClient = class {
    private url: string;
    private _connected = false;

    constructor(options: any) {
      this.url = options.url;
    }

    connect = vi.fn().mockImplementation(async () => {
      this._connected = true;
    });

    disconnect = vi.fn().mockImplementation(async () => {
      this._connected = false;
    });

    invoke = vi.fn().mockResolvedValue({ result: 'ws-success' });

    isConnected = vi.fn().mockImplementation(() => this._connected);

    getMetrics = vi.fn().mockImplementation(() => ({
      id: 'ws-client',
      url: this.url,
      state: this._connected ? ConnectionState.CONNECTED : ConnectionState.DISCONNECTED,
      transport: 'websocket',
      requestsSent: 5,
      responsesReceived: 5,
      errors: 0,
      avgLatency: 20,
    }));

    getState = vi.fn().mockReturnValue('connected');
  };

  return { WebSocketClient: MockWebSocketClient };
});

describe('BackendClient', () => {
  const baseUrl = 'https://api.example.com';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor and initialization', () => {
    it('should create backend client with HTTP transport (default)', () => {
      const config: BackendConfig = { path: '/core' };
      const options: BackendClientOptions = {
        name: 'core',
        config,
        baseUrl,
      };

      const client = new BackendClient(options);

      expect(client.getName()).toBe('core');
      expect(client.getPath()).toBe('/core');
      expect(client.getTransportType()).toBe('http');
      expect(client.getFullUrl()).toBe('https://api.example.com/core');
    });

    it('should create backend client with WebSocket transport', () => {
      const config: BackendConfig = { path: '/chat', transport: 'websocket' };
      const options: BackendClientOptions = {
        name: 'chat',
        config,
        baseUrl,
      };

      const client = new BackendClient(options);

      expect(client.getName()).toBe('chat');
      expect(client.getPath()).toBe('/chat');
      expect(client.getTransportType()).toBe('websocket');
      expect(client.getFullUrl()).toBe('https://api.example.com/chat');
    });

    it('should normalize base URL by removing trailing slash', () => {
      const config: BackendConfig = { path: '/core' };
      const options: BackendClientOptions = {
        name: 'core',
        config,
        baseUrl: 'https://api.example.com/',
      };

      const client = new BackendClient(options);

      expect(client.getFullUrl()).toBe('https://api.example.com/core');
    });
  });

  describe('service proxy', () => {
    it('should create service proxy with correct methods', async () => {
      const config: BackendConfig = { path: '/core' };
      const options: BackendClientOptions = {
        name: 'core',
        config,
        baseUrl,
      };
      const client = new BackendClient(options);
      await client.connect();

      interface UserService {
        getById(id: string): Promise<{ id: string; name: string }>;
        create(data: { name: string }): Promise<{ id: string }>;
      }

      const userService = client.service<UserService>('users');

      expect(typeof userService.getById).toBe('function');
      expect(typeof userService.create).toBe('function');
    });

    it('should return undefined for symbol properties', async () => {
      const config: BackendConfig = { path: '/core' };
      const client = new BackendClient({ name: 'core', config, baseUrl });
      await client.connect();

      const service = client.service<any>('test');
      const symbolProp = service[Symbol.toStringTag];
      expect(symbolProp).toBeUndefined();
    });
  });

  describe('connection state', () => {
    it('should track connection state', async () => {
      const config: BackendConfig = { path: '/core' };
      const client = new BackendClient({ name: 'core', config, baseUrl });

      expect(client.isConnected()).toBe(false);

      await client.connect();

      expect(client.isConnected()).toBe(true);
    });

    it('should update state after disconnect', async () => {
      const config: BackendConfig = { path: '/core' };
      const client = new BackendClient({ name: 'core', config, baseUrl });

      await client.connect();
      expect(client.isConnected()).toBe(true);

      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    });

    it('should return false when client is not initialized', () => {
      const config: BackendConfig = { path: '/core' };
      const client = new BackendClient({ name: 'core', config, baseUrl });

      expect(client.isConnected()).toBe(false);
      expect(client.getClient()).toBeNull();
    });
  });

  describe('metrics', () => {
    it('should return default metrics when not connected', () => {
      const config: BackendConfig = { path: '/core' };
      const client = new BackendClient({ name: 'core', config, baseUrl });

      const metrics = client.getMetrics();

      expect(metrics.id).toBe('core-not-connected');
      expect(metrics.url).toBe('https://api.example.com/core');
      expect(metrics.state).toBe(ConnectionState.DISCONNECTED);
      expect(metrics.transport).toBe('http');
      expect(metrics.requestsSent).toBe(0);
      expect(metrics.responsesReceived).toBe(0);
      expect(metrics.errors).toBe(0);
    });

    it('should return metrics from underlying client when connected', async () => {
      const config: BackendConfig = { path: '/core' };
      const client = new BackendClient({ name: 'core', config, baseUrl });

      await client.connect();
      const metrics = client.getMetrics();

      expect(metrics.id).toBe('core');
      expect(metrics.state).toBe(ConnectionState.CONNECTED);
    });
  });

  describe('path and transport', () => {
    it('should return correct path prefix', () => {
      const config: BackendConfig = { path: '/api/v1/core' };
      const client = new BackendClient({ name: 'core', config, baseUrl });

      expect(client.getPath()).toBe('/api/v1/core');
    });

    it('should return correct transport type for HTTP', () => {
      const config: BackendConfig = { path: '/core' };
      const client = new BackendClient({ name: 'core', config, baseUrl });

      expect(client.getTransportType()).toBe('http');
    });

    it('should return correct transport type for WebSocket', () => {
      const config: BackendConfig = { path: '/chat', transport: 'websocket' };
      const client = new BackendClient({ name: 'chat', config, baseUrl });

      expect(client.getTransportType()).toBe('websocket');
    });
  });

  describe('getClient', () => {
    it('should return null before initialization', () => {
      const config: BackendConfig = { path: '/core' };
      const client = new BackendClient({ name: 'core', config, baseUrl });

      expect(client.getClient()).toBeNull();
    });

    it('should return underlying client after connection', async () => {
      const config: BackendConfig = { path: '/core' };
      const client = new BackendClient({ name: 'core', config, baseUrl });

      await client.connect();

      expect(client.getClient()).not.toBeNull();
    });
  });

  describe('destroy', () => {
    it('should disconnect and cleanup resources', async () => {
      const config: BackendConfig = { path: '/core' };
      const client = new BackendClient({ name: 'core', config, baseUrl });

      await client.connect();
      expect(client.getClient()).not.toBeNull();

      await client.destroy();

      expect(client.getClient()).toBeNull();
    });

    it('should be safe to call destroy multiple times', async () => {
      const config: BackendConfig = { path: '/core' };
      const client = new BackendClient({ name: 'core', config, baseUrl });

      await client.connect();
      await client.destroy();
      await client.destroy(); // Should not throw

      expect(client.getClient()).toBeNull();
    });

    it('should be safe to call destroy without connecting', async () => {
      const config: BackendConfig = { path: '/core' };
      const client = new BackendClient({ name: 'core', config, baseUrl });

      await client.destroy(); // Should not throw

      expect(client.getClient()).toBeNull();
    });
  });

  describe('WebSocket-specific options', () => {
    it('should use WebSocket transport with options', async () => {
      const config: BackendConfig = {
        path: '/chat',
        transport: 'websocket',
        websocket: {
          protocols: ['netron-v1'],
          reconnect: true,
          reconnectInterval: 2000,
          maxReconnectAttempts: 5,
        },
      };
      const client = new BackendClient({ name: 'chat', config, baseUrl });

      await client.connect();

      expect(client.getTransportType()).toBe('websocket');
    });
  });

  describe('HTTP-specific options', () => {
    it('should use HTTP transport with options', async () => {
      const config: BackendConfig = {
        path: '/core',
        transport: 'http',
        http: {
          retry: true,
          maxRetries: 3,
        },
      };
      const client = new BackendClient({ name: 'core', config, baseUrl });

      await client.connect();

      expect(client.getTransportType()).toBe('http');
    });
  });
});
