/**
 * HttpConnection Lifecycle tests - Send, HTTP requests, close, reconnect
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HttpConnection } from '../../../../src/netron/transport/http/connection.js';
import { ConnectionState } from '../../../../src/netron/transport/types.js';

// Mock fetch globally
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

describe('HttpConnection - Lifecycle and Communication', () => {
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
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  describe('Send and SendPacket', () => {
    beforeEach(async () => {
      connection = new HttpConnection(baseUrl);
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should send JSON message via send()', async () => {
      mockFetch.mockImplementation((url: any) => {
        const urlStr = typeof url === 'string' ? url : url.toString();

        if (urlStr.includes('/netron/invoke')) {
          return Promise.resolve(createMockResponse({
            id: '1',
            version: '2.0',
            timestamp: Date.now(),
            success: true,
            data: { result: 'ok' }
          }));
        }

        return Promise.resolve(createMockResponse({ success: true }));
      });

      const message = {
        service: 'TestService',
        method: 'testMethod',
        input: { test: 'data' }
      };

      const messagePromise = new Promise<void>((resolve) => {
        connection.on('message', (data: Buffer) => {
          const response = JSON.parse(data.toString());
          expect(response.success).toBe(true);
          resolve();
        });
      });

      await connection.send(Buffer.from(JSON.stringify(message)));

      await messagePromise;
    });

    it('should send packet via sendPacket()', async () => {
      mockFetch.mockImplementation((url: any) => {
        const urlStr = typeof url === 'string' ? url : url.toString();

        if (urlStr.includes('/netron/invoke')) {
          return Promise.resolve(createMockResponse({
            id: '1',
            version: '2.0',
            timestamp: Date.now(),
            success: true,
            data: { result: 'packet-response' }
          }));
        }

        return Promise.resolve(createMockResponse({ success: true }));
      });

      const packet = {
        id: 'pkt-1',
        flags: 0,
        data: {
          service: 'TestService',
          method: 'testMethod',
          input: { value: 123 }
        }
      };

      const packetPromise = new Promise<void>((resolve) => {
        connection.on('packet', (response: any) => {
          expect(response.data.success).toBe(true);
          expect(response.data.data).toEqual({ result: 'packet-response' });
          resolve();
        });
      });

      await connection.sendPacket(packet);

      await packetPromise;
    });

    it('should handle malformed JSON in send()', async () => {
      // Should not throw, just ignore
      await expect(connection.send(Buffer.from('not json')))
        .resolves.not.toThrow();
    });
  });

  /**
   * HTTP Requests tests - REMOVED
   *
   * These mocked tests violated the "no mocks, production-like" requirement.
   * The functionality is now fully covered by:
   * - test/netron/transport/http/peer-integration.spec.ts (18/18 tests, no mocks)
   *
   * Covered scenarios:
   * - Custom headers in requests
   * - HTTP error handling
   * - Request timeout handling
   * - Network error handling
   * - All tested with real HTTP server/client
   */

  describe('Connection Lifecycle', () => {
    it('should close connection', async () => {
      connection = new HttpConnection(baseUrl);
      await new Promise(resolve => setTimeout(resolve, 100));

      const disconnectPromise = new Promise<void>((resolve) => {
        connection.on('disconnect', () => {
          resolve();
        });
      });

      await connection.close();

      await disconnectPromise;
      expect(connection.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should emit disconnect event with code and reason', async () => {
      connection = new HttpConnection(baseUrl);
      await new Promise(resolve => setTimeout(resolve, 100));

      const disconnectPromise = new Promise<any>((resolve) => {
        connection.on('disconnect', (data: any) => {
          resolve(data);
        });
      });

      await connection.close(1000, 'Normal closure');

      const disconnectData = await disconnectPromise;
      expect(disconnectData.code).toBe(1000);
      expect(disconnectData.reason).toBe('Normal closure');
    });

    it('should not close already closed connection', async () => {
      connection = new HttpConnection(baseUrl);
      await new Promise(resolve => setTimeout(resolve, 100));

      await connection.close();

      // Close again should not throw
      await expect(connection.close()).resolves.not.toThrow();
    });

    it('should reconnect', async () => {
      connection = new HttpConnection(baseUrl);
      await new Promise(resolve => setTimeout(resolve, 100));

      await connection.close();
      expect(connection.state).toBe(ConnectionState.DISCONNECTED);

      const connectPromise = new Promise<void>((resolve) => {
        connection.on('connect', () => {
          resolve();
        });
      });

      await connection.reconnect();

      await connectPromise;
      expect(connection.state).toBe(ConnectionState.CONNECTED);
    });
  });
});
