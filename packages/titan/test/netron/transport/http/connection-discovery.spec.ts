/**
 * HttpConnection Service Discovery tests
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HttpConnection } from '../../../../src/netron/transport/http/connection.js';
import { ConnectionState } from '../../../../src/netron/transport/types.js';

// Mock fetch globally
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

describe('HttpConnection - Service Discovery', () => {
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
  });

  afterEach(async () => {
    if (connection && connection.state !== ConnectionState.DISCONNECTED) {
      await connection.close();
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  it('should discover services on initialization', async () => {
    mockFetch.mockImplementation((url: any) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/netron/discovery')) {
        return Promise.resolve(createMockResponse({
          version: '2.0',
          services: {
            UserService: {
              version: '1.0.0',
              methods: ['getUser', 'createUser'],
              metadata: {}
            }
          },
          contracts: {}
        }));
      }

      return Promise.resolve(createMockResponse({ success: true, data: {} }));
    });

    connection = new HttpConnection(baseUrl);

    // Wait for discovery to complete
    await new Promise(resolve => setTimeout(resolve, 150));

    const metrics = connection.getMetrics();
    expect(metrics.services).toContain('UserService');
  });

  it('should handle discovery failure gracefully', async () => {
    mockFetch.mockImplementation((url: any) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/netron/discovery')) {
        return Promise.reject(new Error('Discovery failed'));
      }

      return Promise.resolve(createMockResponse({ success: true, data: {} }));
    });

    connection = new HttpConnection(baseUrl);

    // Wait for discovery attempt
    await new Promise(resolve => setTimeout(resolve, 150));

    // Connection should still work
    expect(connection.state).toBe(ConnectionState.CONNECTED);
  });

  it('should cache discovered services', async () => {
    mockFetch.mockImplementation((url: any) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/netron/discovery')) {
        return Promise.resolve(createMockResponse({
          version: '2.0',
          services: {
            Calculator: {
              version: '1.0.0',
              methods: ['add', 'subtract'],
              metadata: {}
            }
          },
          contracts: {}
        }));
      }

      return Promise.resolve(createMockResponse({ success: true, data: {} }));
    });

    connection = new HttpConnection(baseUrl);

    // Wait for initialization and discovery
    await new Promise(resolve => setTimeout(resolve, 300));

    // Check that discovery was called exactly once during initialization
    const discoveryCallCount = mockFetch.mock.calls.filter(call =>
      (typeof call[0] === 'string' ? call[0] : call[0].toString()).includes('/netron/discovery')
    ).length;

    expect(discoveryCallCount).toBe(1);

    // Verify service was discovered
    const metrics = connection.getMetrics();
    expect(metrics.services).toContain('Calculator');
  });
});
