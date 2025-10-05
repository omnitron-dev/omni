/**
 * Tests for HTTP Connection implementation (v2.0 Native Protocol)
 * This test suite covers the HTTP client connection that uses native JSON messaging
 * without packet protocol for improved performance
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HttpConnection } from '../../../../src/netron/transport/http/connection.js';
import { ConnectionState } from '../../../../src/netron/transport/types.js';
import { EventEmitter } from '@omnitron-dev/eventemitter';

describe('HttpConnection (v2.0 Native Protocol)', () => {
  let connection: HttpConnection;
  const baseUrl = 'http://localhost:3000';
  let mockFetch: any;

  beforeEach(() => {
    // Mock global fetch
    mockFetch = jest.fn();
    global.fetch = mockFetch;

    // Default successful discovery response
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: jest.fn((name: string) => {
          if (name === 'Content-Type') return 'application/json';
          if (name === 'X-Netron-Version') return '2.0';
          return null;
        })
      },
      json: jest.fn().mockResolvedValue({
        server: {
          version: '2.0.0',
          protocol: '2.0',
          features: ['batch', 'discovery'],
          metadata: {}
        },
        services: {
          'Calculator@1.0.0': {
            name: 'Calculator@1.0.0',
            version: '1.0.0',
            methods: ['add', 'subtract', 'multiply', 'divide']
          }
        },
        contracts: {},
        timestamp: Date.now()
      })
    });
  });

  afterEach(async () => {
    if (connection) {
      await connection.close();
    }
    delete (global as any).fetch;

    // Wait for any pending setImmediate callbacks
    await new Promise(resolve => setImmediate(resolve));
  });

  describe('Connection Interface Implementation', () => {
    it('should implement ITransportConnection interface', () => {
      connection = new HttpConnection(baseUrl);

      expect(connection).toHaveProperty('id');
      expect(connection).toHaveProperty('state');
      expect(connection).toHaveProperty('send');
      expect(connection).toHaveProperty('close');
      expect(connection).toHaveProperty('remoteAddress');
    });

    it('should extend EventEmitter', () => {
      connection = new HttpConnection(baseUrl);

      expect(connection).toBeInstanceOf(EventEmitter);
      expect(connection.on).toBeDefined();
      expect(connection.emit).toBeDefined();
      expect(connection.once).toBeDefined();
    });

    it('should have unique connection ID', () => {
      const conn1 = new HttpConnection(baseUrl);
      const conn2 = new HttpConnection(baseUrl);

      expect(conn1.id).toBeDefined();
      expect(conn2.id).toBeDefined();
      expect(conn1.id).not.toBe(conn2.id);

      conn1.close();
      conn2.close();
    });

    it('should initialize with CONNECTED state (HTTP is stateless)', () => {
      connection = new HttpConnection(baseUrl);
      // HTTP connections transition immediately to CONNECTED since they're stateless
      expect(connection.state).toBe(ConnectionState.CONNECTED);
    });

    it('should have correct remote address', () => {
      connection = new HttpConnection(baseUrl);
      expect(connection.remoteAddress).toBe(baseUrl);
    });

    it('should strip trailing slash from base URL', () => {
      connection = new HttpConnection('http://localhost:3000/');
      expect(connection.remoteAddress).toBe('http://localhost:3000');
    });
  });

  describe('Options Handling', () => {
    it('should accept timeout option', () => {
      connection = new HttpConnection(baseUrl, {
        timeout: 10000
      });

      expect(connection).toBeDefined();
    });

    it('should accept custom headers', () => {
      connection = new HttpConnection(baseUrl, {
        headers: {
          'Authorization': 'Bearer token',
          'X-Custom': 'value'
        }
      });

      expect(connection).toBeDefined();
    });

    it('should accept reconnect option', () => {
      connection = new HttpConnection(baseUrl, {
        reconnect: false
      });

      expect(connection).toBeDefined();
    });
  });

  describe('Service Discovery', () => {
    it('should attempt service discovery on connection', async () => {
      connection = new HttpConnection(baseUrl);

      // Wait for async initialization
      await new Promise(resolve => setTimeout(resolve, 150));

      // Verify discovery request was made
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/netron/discovery'),
        expect.any(Object)
      );
    });

    it('should cache discovered services in metrics', async () => {
      connection = new HttpConnection(baseUrl);

      // Wait for discovery
      await new Promise(resolve => setTimeout(resolve, 150));

      const metrics = connection.getMetrics();
      expect(metrics.services).toBeDefined();
      expect(Array.isArray(metrics.services)).toBe(true);
      expect(metrics.services).toContain('Calculator@1.0.0');
    });

    it('should handle discovery errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      connection = new HttpConnection(baseUrl);

      // Should still transition to CONNECTED even if discovery fails
      await new Promise(resolve => setTimeout(resolve, 150));

      // Connection should still be usable
      expect(connection.state).toBe(ConnectionState.CONNECTED);
    });

    it('should handle 404 on discovery endpoint', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: {
          get: jest.fn()
        },
        json: jest.fn().mockRejectedValue(new Error('Not found'))
      });

      connection = new HttpConnection(baseUrl);

      await new Promise(resolve => setTimeout(resolve, 150));

      expect(connection.state).toBe(ConnectionState.CONNECTED);
    });
  });

  describe('Connection Lifecycle', () => {
    it('should emit connect event', (done) => {
      connection = new HttpConnection(baseUrl);

      connection.once('connect', () => {
        expect(connection.state).toBe(ConnectionState.CONNECTED);
        done();
      });
    });

    it('should emit disconnect event on close', (done) => {
      connection = new HttpConnection(baseUrl);

      connection.once('connect', async () => {
        connection.once('disconnect', () => {
          expect(connection.state).toBe(ConnectionState.DISCONNECTED);
          done();
        });

        await connection.close();
      });
    });

    it('should transition to DISCONNECTED state on close', async () => {
      connection = new HttpConnection(baseUrl);

      await new Promise(resolve => connection.once('connect', resolve));

      await connection.close();

      expect(connection.state).toBe(ConnectionState.DISCONNECTED);
    });
  });

  describe('Metrics', () => {
    it('should provide connection metrics', () => {
      connection = new HttpConnection(baseUrl);

      const metrics = connection.getMetrics();

      expect(metrics).toHaveProperty('state');
      expect(metrics).toHaveProperty('baseUrl'); // Metrics use baseUrl instead of remoteAddress
      expect(metrics).toHaveProperty('services');
    });

    it('should include state in metrics', () => {
      connection = new HttpConnection(baseUrl);

      const metrics = connection.getMetrics();
      expect(metrics.state).toBe(ConnectionState.CONNECTED);
    });

    it('should include base URL in metrics', () => {
      connection = new HttpConnection(baseUrl);

      const metrics = connection.getMetrics();
      expect(metrics.baseUrl).toBe(baseUrl);
    });

    it('should include service list after discovery', async () => {
      connection = new HttpConnection(baseUrl);

      await new Promise(resolve => setTimeout(resolve, 150));

      const metrics = connection.getMetrics();
      expect(metrics.services).toBeDefined();
      expect(Array.isArray(metrics.services)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors during initialization', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      connection = new HttpConnection(baseUrl);

      // Should not throw, but handle gracefully
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(connection).toBeDefined();
      expect(connection.state).toBe(ConnectionState.CONNECTED);
    });

    it('should handle malformed discovery response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: jest.fn()
        },
        json: jest.fn().mockRejectedValue(new Error('Invalid JSON'))
      });

      connection = new HttpConnection(baseUrl);

      await new Promise(resolve => setTimeout(resolve, 150));

      // Should still be connected despite invalid response
      expect(connection.state).toBe(ConnectionState.CONNECTED);
    });

    it('should handle server errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: {
          get: jest.fn()
        }
      });

      connection = new HttpConnection(baseUrl);

      await new Promise(resolve => setTimeout(resolve, 150));

      expect(connection.state).toBe(ConnectionState.CONNECTED);
    });
  });

  describe('Send Method', () => {
    it('should have send method', () => {
      connection = new HttpConnection(baseUrl);
      expect(typeof connection.send).toBe('function');
    });

    it('should accept Buffer data', async () => {
      connection = new HttpConnection(baseUrl);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: jest.fn()
        },
        json: jest.fn().mockResolvedValue({
          id: 'msg-1',
          version: '2.0',
          success: true,
          data: 'processed'
        })
      });

      const message = Buffer.from(JSON.stringify({
        id: 'msg-1',
        version: '2.0',
        timestamp: Date.now(),
        service: 'Test@1.0.0',
        method: 'test',
        input: {}
      }));

      await expect(connection.send(message)).resolves.not.toThrow();
    });

    it('should accept ArrayBuffer data', async () => {
      connection = new HttpConnection(baseUrl);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: jest.fn()
        },
        json: jest.fn().mockResolvedValue({
          id: 'msg-1',
          version: '2.0',
          success: true,
          data: 'processed'
        })
      });

      const buffer = new TextEncoder().encode(JSON.stringify({
        id: 'msg-1',
        version: '2.0',
        timestamp: Date.now(),
        service: 'Test@1.0.0',
        method: 'test',
        input: {}
      }));

      await expect(connection.send(buffer.buffer)).resolves.not.toThrow();
    });
  });

  describe('Close Behavior', () => {
    it('should prevent operations after close', async () => {
      connection = new HttpConnection(baseUrl);

      await new Promise(resolve => connection.once('connect', resolve));
      await connection.close();

      expect(connection.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should be idempotent', async () => {
      connection = new HttpConnection(baseUrl);

      await new Promise(resolve => connection.once('connect', resolve));

      await connection.close();
      await connection.close(); // Should not throw

      expect(connection.state).toBe(ConnectionState.DISCONNECTED);
    });
  });

  describe('State Transitions', () => {
    it('should be CONNECTED and emit connect event', (done) => {
      connection = new HttpConnection(baseUrl);

      // HTTP connections are immediately CONNECTED
      expect(connection.state).toBe(ConnectionState.CONNECTED);

      connection.once('connect', () => {
        expect(connection.state).toBe(ConnectionState.CONNECTED);
        done();
      });
    });

    it('should transition CONNECTED -> DISCONNECTED on close', async () => {
      connection = new HttpConnection(baseUrl);

      await new Promise(resolve => connection.once('connect', resolve));
      expect(connection.state).toBe(ConnectionState.CONNECTED);

      await connection.close();
      expect(connection.state).toBe(ConnectionState.DISCONNECTED);
    });
  });
});
