/**
 * Basic HttpConnection tests - Constructor, initialization, and state management
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HttpConnection } from '../../../../src/netron/transport/http/connection.js';
import { ConnectionState } from '../../../../src/netron/transport/types.js';

// Mock fetch globally
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

describe('HttpConnection - Basic Functionality', () => {
  let connection: HttpConnection;
  const baseUrl = 'http://localhost:3000';

  // Helper to create mock Response
  const createMockResponse = (data: any, ok = true, status = 200) => ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: jest.fn().mockResolvedValue(data),
    headers: {
      get: jest.fn((name: string) => {
        if (name === 'Content-Type') return 'application/json';
        return null;
      })
    }
  } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockClear();

    // Mock discovery endpoint by default
    mockFetch.mockImplementation((url: any) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/netron/discovery')) {
        return Promise.resolve(createMockResponse({
          version: '2.0',
          services: {},
          contracts: {}
        }));
      }

      return Promise.resolve(createMockResponse({
        id: '1',
        version: '2.0',
        timestamp: Date.now(),
        success: true,
        data: { result: 'success' }
      }));
    });
  });

  afterEach(async () => {
    if (connection && connection.state !== ConnectionState.DISCONNECTED) {
      await connection.close();
    }
    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  describe('Constructor and Initialization', () => {
    it('should create connection with base URL', async () => {
      connection = new HttpConnection(baseUrl);

      expect(connection).toBeInstanceOf(HttpConnection);
      expect(connection.id).toBeDefined();
      expect(connection.remoteAddress).toBe(baseUrl);

      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should remove trailing slash from base URL', async () => {
      connection = new HttpConnection('http://localhost:3000/');

      expect(connection.remoteAddress).toBe('http://localhost:3000');

      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should have unique connection ID', async () => {
      const conn1 = new HttpConnection(baseUrl);
      const conn2 = new HttpConnection(baseUrl);

      expect(conn1.id).toBeDefined();
      expect(conn2.id).toBeDefined();
      expect(conn1.id).not.toBe(conn2.id);

      // Clean up both connections
      await conn2.close();
      await conn1.close();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Set connection to null to skip afterEach cleanup
      connection = null as any;
    });

    it('should start in CONNECTING state and transition to CONNECTED', async () => {
      connection = new HttpConnection(baseUrl);

      // Initially CONNECTING or CONNECTED (due to async initialization)
      expect([ConnectionState.CONNECTING, ConnectionState.CONNECTED]).toContain(connection.state);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(connection.state).toBe(ConnectionState.CONNECTED);
    });

    it('should emit connect event', async () => {
      const connectPromise = new Promise<void>((resolve) => {
        const conn = new HttpConnection(baseUrl);
        conn.on('connect', () => {
          connection = conn;
          resolve();
        });
      });

      await connectPromise;
      expect(connection).toBeDefined();
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should accept transport options', async () => {
      connection = new HttpConnection(baseUrl, {
        timeout: 5000,
        headers: { 'X-Api-Key': 'test123' }
      });

      expect(connection).toBeInstanceOf(HttpConnection);
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should have undefined localAddress for HTTP client', async () => {
      connection = new HttpConnection(baseUrl);

      expect(connection.localAddress).toBeUndefined();
      await new Promise(resolve => setTimeout(resolve, 100));
    });
  });

  describe('Connection State', () => {
    it('should check if connection is alive', async () => {
      connection = new HttpConnection(baseUrl);
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(connection.isAlive()).toBe(true);
    });

    it('should return false for isAlive() after close', async () => {
      connection = new HttpConnection(baseUrl);
      await new Promise(resolve => setTimeout(resolve, 100));

      await connection.close();

      expect(connection.isAlive()).toBe(false);
    });
  });

  describe('Connection Metrics', () => {
    it('should return connection metrics', async () => {
      connection = new HttpConnection(baseUrl);
      await new Promise(resolve => setTimeout(resolve, 100));

      const metrics = connection.getMetrics();

      expect(metrics).toHaveProperty('id');
      expect(metrics).toHaveProperty('state');
      expect(metrics).toHaveProperty('baseUrl');
      expect(metrics).toHaveProperty('services');
      expect(metrics).toHaveProperty('pendingRequests');

      expect(metrics.id).toBe(connection.id);
      expect(metrics.state).toBe(connection.state);
      expect(metrics.baseUrl).toBe(baseUrl);
    });

    it('should track services in metrics', async () => {
      mockFetch.mockImplementation((url: any) => {
        const urlStr = typeof url === 'string' ? url : url.toString();

        if (urlStr.includes('/netron/discovery')) {
          return Promise.resolve(createMockResponse({
            version: '2.0',
            services: {
              ServiceA: { version: '1.0.0', methods: [], metadata: {} },
              ServiceB: { version: '1.0.0', methods: [], metadata: {} }
            },
            contracts: {}
          }));
        }

        return Promise.resolve(createMockResponse({ success: true }));
      });

      connection = new HttpConnection(baseUrl);
      await new Promise(resolve => setTimeout(resolve, 150));

      const metrics = connection.getMetrics();

      expect(metrics.services).toContain('ServiceA');
      expect(metrics.services).toContain('ServiceB');
    });
  });
});
