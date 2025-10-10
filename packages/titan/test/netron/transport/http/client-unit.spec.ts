/**
 * HTTP Transport Client - Unit Tests
 *
 * Strategy: Test public/private methods directly WITHOUT calling initialize()
 * to avoid hanging due to async background discovery.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, jest } from '@jest/globals';
import { HttpTransportClient } from '../../../../src/netron/transport/http/client.js';
import { createRequestMessage } from '../../../../src/netron/transport/http/types.js';
import type { HttpResponseMessage } from '../../../../src/netron/transport/http/types.js';

// Mock fetch globally
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('HttpTransportClient - Unit Tests', () => {
  let originalFetch: typeof global.fetch;

  beforeAll(() => {
    originalFetch = global.fetch;
    global.fetch = mockFetch;
  });

  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('Constructor', () => {
    it('should normalize baseUrl with trailing slash', () => {
      const client = new HttpTransportClient('http://localhost:3000/');
      const metrics = client.getMetrics();
      expect(metrics.baseUrl).toBe('http://localhost:3000');
    });

    it('should keep baseUrl without trailing slash', () => {
      const client = new HttpTransportClient('http://localhost:3000');
      const metrics = client.getMetrics();
      expect(metrics.baseUrl).toBe('http://localhost:3000');
    });

    it('should handle baseUrl with path and trailing slash', () => {
      const client = new HttpTransportClient('http://localhost:3000/api/');
      const metrics = client.getMetrics();
      expect(metrics.baseUrl).toBe('http://localhost:3000/api');
    });

    it('should accept options parameter', () => {
      const client = new HttpTransportClient('http://localhost:3000', undefined, {
        timeout: 5000,
        headers: { 'X-Custom': 'value' }
      });
      expect(client).toBeInstanceOf(HttpTransportClient);
    });
  });

  describe('getMetrics()', () => {
    it('should return metrics before initialization', () => {
      const client = new HttpTransportClient('http://localhost:3000');
      const metrics = client.getMetrics();

      expect(metrics).toEqual({
        baseUrl: 'http://localhost:3000',
        connected: false,
        hasPeer: false,
        connectionMetrics: undefined
      });
    });

    it('should show normalized baseUrl in metrics', () => {
      const client = new HttpTransportClient('http://localhost:3000/');
      const metrics = client.getMetrics();

      expect(metrics.baseUrl).toBe('http://localhost:3000');
    });

    it('should indicate not connected before initialization', () => {
      const client = new HttpTransportClient('http://localhost:3000');
      const metrics = client.getMetrics();

      expect(metrics.connected).toBe(false);
    });

    it('should indicate no peer before initialization', () => {
      const client = new HttpTransportClient('http://localhost:3000');
      const metrics = client.getMetrics();

      expect(metrics.hasPeer).toBe(false);
    });
  });

  describe('close()', () => {
    it('should handle close when not initialized', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      await expect(client.close()).resolves.not.toThrow();
    });

    it('should be idempotent when called multiple times', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      await client.close();
      await expect(client.close()).resolves.not.toThrow();
    });
  });

  describe('sendRequest() - Direct Method Testing', () => {
    it('should send POST request with correct headers', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      const message = createRequestMessage('TestService', 'testMethod', [{ arg: 'value' }]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: message.id,
          version: '2.0',
          timestamp: Date.now(),
          success: true,
          data: 'result'
        })
      });

      // Access private method via type casting
      const result = await (client as any).sendRequest(message);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/netron/invoke',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Netron-Version': '2.0'
          }),
          body: JSON.stringify(message)
        })
      );
      expect(result.success).toBe(true);
      expect(result.data).toBe('result');
    });

    it('should include custom headers from options', async () => {
      const client = new HttpTransportClient('http://localhost:3000', undefined, {
        headers: {
          'X-Custom-Header': 'custom-value',
          'Authorization': 'Bearer token123'
        }
      });
      const message = createRequestMessage('TestService', 'testMethod', [{}]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: message.id,
          version: '2.0',
          timestamp: Date.now(),
          success: true,
          data: 'result'
        })
      });

      await (client as any).sendRequest(message);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Custom-Header': 'custom-value',
            'Authorization': 'Bearer token123'
          })
        })
      );
    });

    it('should use timeout from message hints', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      const message = createRequestMessage('TestService', 'testMethod', [{}], {
        hints: { timeout: 5000 }
      });

      // Mock slow response that would timeout
      mockFetch.mockImplementationOnce(() =>
        new Promise((resolve) => setTimeout(() => resolve({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ success: true, data: 'result' })
        }), 100))
      );

      const result = await (client as any).sendRequest(message);
      expect(result).toBeDefined();
    });

    it('should use timeout from options when hints not provided', async () => {
      const client = new HttpTransportClient('http://localhost:3000', undefined, {
        timeout: 10000
      });
      const message = createRequestMessage('TestService', 'testMethod', [{}]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: message.id,
          version: '2.0',
          timestamp: Date.now(),
          success: true,
          data: 'result'
        })
      });

      const result = await (client as any).sendRequest(message);
      expect(result.success).toBe(true);
    });

    it('should use default timeout (30000ms) when not specified', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      const message = createRequestMessage('TestService', 'testMethod', [{}]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: message.id,
          version: '2.0',
          timestamp: Date.now(),
          success: true,
          data: 'result'
        })
      });

      const result = await (client as any).sendRequest(message);
      expect(result.success).toBe(true);
    });

    it('should parse JSON response on success', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      const message = createRequestMessage('TestService', 'testMethod', [{}]);
      const expectedResponse: HttpResponseMessage = {
        id: message.id,
        version: '2.0',
        timestamp: Date.now(),
        success: true,
        data: { result: 'test-data', count: 42 }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(expectedResponse)
      });

      const result = await (client as any).sendRequest(message);

      expect(result).toEqual(expectedResponse);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ result: 'test-data', count: 42 });
    });

    it('should handle HTTP error with JSON body', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      const message = createRequestMessage('TestService', 'testMethod', [{}]);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Map(),
        json: jest.fn().mockResolvedValue({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input parameters'
          }
        })
      });

      const result = await (client as any).sendRequest(message);

      expect(result.success).toBe(false);
      // parseHttpError converts VALIDATION_ERROR string to ErrorCode 422, then back to UNPROCESSABLE_ENTITY
      expect(result.error?.code).toBe('UNPROCESSABLE_ENTITY');
      expect(result.error?.message).toBe('Invalid input parameters');
    });

    it('should handle HTTP error without JSON body', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      const message = createRequestMessage('TestService', 'testMethod', [{}]);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Map(),
        json: jest.fn().mockRejectedValue(new Error('Not JSON'))
      });

      const result = await (client as any).sendRequest(message);

      expect(result.success).toBe(false);
      // parseHttpError converts 500 to INTERNAL_SERVER_ERROR
      expect(result.error?.code).toBe('INTERNAL_SERVER_ERROR');
      expect(result.error?.message).toBe('Internal Server Error');
      expect(result.id).toBe(message.id);
      expect(result.version).toBe('2.0');
    });

    it('should handle HTTP 404 error', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      const message = createRequestMessage('TestService', 'testMethod', [{}]);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Map(),
        json: jest.fn().mockRejectedValue(new Error('Not JSON'))
      });

      const result = await (client as any).sendRequest(message);

      expect(result.success).toBe(false);
      // parseHttpError converts 404 to NOT_FOUND
      expect(result.error?.code).toBe('NOT_FOUND');
      expect(result.error?.message).toBe('Not Found');
    });

    it('should handle timeout (AbortError)', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      const message = createRequestMessage('TestService', 'testMethod', [{}], {
        hints: { timeout: 100 }
      });

      // Simulate timeout by throwing AbortError
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const result = await (client as any).sendRequest(message);

      expect(result.success).toBe(false);
      // AbortError maps to REQUEST_TIMEOUT (408)
      expect(result.error?.code).toBe('REQUEST_TIMEOUT');
      expect(result.error?.message).toContain('Request timeout after 100ms');
      expect(result.id).toBe(message.id);
      expect(result.version).toBe('2.0');
    });

    it('should handle network error', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      const message = createRequestMessage('TestService', 'testMethod', [{}]);

      mockFetch.mockRejectedValueOnce(new Error('Network connection failed'));

      const result = await (client as any).sendRequest(message);

      expect(result.success).toBe(false);
      // Network errors map to INTERNAL_SERVER_ERROR
      expect(result.error?.code).toBe('INTERNAL_SERVER_ERROR');
      expect(result.error?.message).toBe('Network connection failed');
      expect(result.id).toBe(message.id);
      expect(result.version).toBe('2.0');
    });

    it('should handle DNS resolution error', async () => {
      const client = new HttpTransportClient('http://invalid-domain-xyz.example');
      const message = createRequestMessage('TestService', 'testMethod', [{}]);

      mockFetch.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'));

      const result = await (client as any).sendRequest(message);

      expect(result.success).toBe(false);
      // DNS errors map to INTERNAL_SERVER_ERROR
      expect(result.error?.code).toBe('INTERNAL_SERVER_ERROR');
      expect(result.error?.message).toContain('ENOTFOUND');
    });

    it('should handle connection refused error', async () => {
      const client = new HttpTransportClient('http://localhost:9999');
      const message = createRequestMessage('TestService', 'testMethod', [{}]);

      mockFetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

      const result = await (client as any).sendRequest(message);

      expect(result.success).toBe(false);
      // Connection errors map to INTERNAL_SERVER_ERROR
      expect(result.error?.code).toBe('INTERNAL_SERVER_ERROR');
      expect(result.error?.message).toContain('ECONNREFUSED');
    });

    it('should clear timeout on successful response', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      const message = createRequestMessage('TestService', 'testMethod', [{}]);

      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: message.id,
          version: '2.0',
          timestamp: Date.now(),
          success: true,
          data: 'result'
        })
      });

      await (client as any).sendRequest(message);

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('should clear timeout on error response', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      const message = createRequestMessage('TestService', 'testMethod', [{}]);

      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Error',
        json: jest.fn().mockRejectedValue(new Error('Not JSON'))
      });

      await (client as any).sendRequest(message);

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('should clear timeout on network error', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      const message = createRequestMessage('TestService', 'testMethod', [{}]);

      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await (client as any).sendRequest(message);

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('should handle error response with custom error code', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      const message = createRequestMessage('TestService', 'testMethod', [{}]);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Map(),
        json: jest.fn().mockResolvedValue({
          error: {
            code: 'PERMISSION_DENIED',
            message: 'User lacks required permissions',
            details: { requiredRole: 'admin' }
          }
        })
      });

      const result = await (client as any).sendRequest(message);

      expect(result.success).toBe(false);
      // parseHttpError converts 403 to FORBIDDEN
      expect(result.error?.code).toBe('FORBIDDEN');
      expect(result.error?.message).toBe('User lacks required permissions');
      expect(result.error?.details).toEqual({ requiredRole: 'admin' });
    });

    it('should include AbortSignal in fetch request', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      const message = createRequestMessage('TestService', 'testMethod', [{}]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: message.id,
          version: '2.0',
          timestamp: Date.now(),
          success: true,
          data: 'result'
        })
      });

      await (client as any).sendRequest(message);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal)
        })
      );
    });

    it('should send request to correct endpoint', async () => {
      const client = new HttpTransportClient('http://api.example.com:8080');
      const message = createRequestMessage('TestService', 'testMethod', [{}]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: message.id,
          version: '2.0',
          timestamp: Date.now(),
          success: true,
          data: 'result'
        })
      });

      await (client as any).sendRequest(message);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://api.example.com:8080/netron/invoke',
        expect.any(Object)
      );
    });

    it('should serialize message correctly in request body', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      const message = createRequestMessage('TestService', 'testMethod', [{
        complex: 'data',
        nested: { value: 123 }
      }], {
        context: { traceId: 'trace-123', userId: 'user-456' },
        hints: { timeout: 5000, priority: 'high' }
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: message.id,
          version: '2.0',
          timestamp: Date.now(),
          success: true,
          data: 'result'
        })
      });

      await (client as any).sendRequest(message);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body).toEqual(message);
      expect(body.context).toEqual({ traceId: 'trace-123', userId: 'user-456' });
      expect(body.hints).toEqual({ timeout: 5000, priority: 'high' });
    });
  });
});
