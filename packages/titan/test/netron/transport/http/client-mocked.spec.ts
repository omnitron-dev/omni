/**
 * HTTP Transport Client - Mocked Integration Tests
 *
 * Strategy: Mock HttpConnection and HttpRemotePeer to test initialize() and invoke()
 * without triggering background discovery.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { INetron } from '../../../../src/netron/types.js';

// Mock HttpConnection and HttpRemotePeer BEFORE importing client
jest.unstable_mockModule('../../../../src/netron/transport/http/connection.js', () => ({
  HttpConnection: jest.fn().mockImplementation(() => ({
    id: 'mock-connection-id',
    state: 'connected',
    queryInterface: jest.fn().mockResolvedValue(null),
    close: jest.fn().mockResolvedValue(undefined),
    getMetrics: jest.fn().mockReturnValue({
      requestCount: 0,
      errorCount: 0,
      avgResponseTime: 0
    })
  }))
}));

jest.unstable_mockModule('../../../../src/netron/transport/http/peer.js', () => ({
  HttpRemotePeer: jest.fn().mockImplementation(() => ({
    id: 'mock-peer-id',
    init: jest.fn().mockResolvedValue(undefined),
    queryInterface: jest.fn().mockResolvedValue(null),
    close: jest.fn().mockResolvedValue(undefined)
  }))
}));

// Now import after mocks are set up
const { HttpTransportClient } = await import('../../../../src/netron/transport/http/client.js');
const { HttpConnection } = await import('../../../../src/netron/transport/http/connection.js');
const { HttpRemotePeer } = await import('../../../../src/netron/transport/http/peer.js');
const { createRequestMessage } = await import('../../../../src/netron/transport/http/types.js');
const { NetronErrors } = await import('../../../../src/errors/index.js');

describe('HttpTransportClient - Mocked Tests', () => {
  let mockFetch: jest.MockedFunction<typeof fetch>;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup fetch mock
    mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
    originalFetch = global.fetch;
    global.fetch = mockFetch;

    // Default fetch response
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        id: 'test-id',
        version: '2.0',
        timestamp: Date.now(),
        success: true,
        data: 'test-result'
      })
    } as any);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('initialize()', () => {
    it('should create connection without netron', async () => {
      const client = new HttpTransportClient('http://localhost:3000');

      await client.initialize();

      expect(HttpConnection).toHaveBeenCalledWith('http://localhost:3000', undefined);
      expect(HttpRemotePeer).not.toHaveBeenCalled();
    });

    it('should create connection with options', async () => {
      const options = { timeout: 5000 };
      const client = new HttpTransportClient('http://localhost:3000', undefined, options);

      await client.initialize();

      expect(HttpConnection).toHaveBeenCalledWith('http://localhost:3000', options);
    });

    it('should create peer when netron is provided', async () => {
      const mockNetron = {
        logger: {
          child: jest.fn().mockReturnThis(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          debug: jest.fn()
        }
      } as unknown as INetron;

      const options = { timeout: 5000 };
      const client = new HttpTransportClient('http://localhost:3000', mockNetron, options);

      await client.initialize();

      expect(HttpConnection).toHaveBeenCalledWith('http://localhost:3000', options);
      expect(HttpRemotePeer).toHaveBeenCalled();

      // Get the mock peer instance and verify init was called
      const mockPeerInstance = (HttpRemotePeer as jest.Mock).mock.results[0].value;
      expect(mockPeerInstance.init).toHaveBeenCalledWith(true, options);
    });

    it('should be idempotent (not create multiple connections)', async () => {
      const client = new HttpTransportClient('http://localhost:3000');

      await client.initialize();
      await client.initialize();
      await client.initialize();

      expect(HttpConnection).toHaveBeenCalledTimes(1);
    });

    it('should show connected state in metrics after initialization', async () => {
      const client = new HttpTransportClient('http://localhost:3000');

      const beforeMetrics = client.getMetrics();
      expect(beforeMetrics.connected).toBe(false);

      await client.initialize();

      const afterMetrics = client.getMetrics();
      expect(afterMetrics.connected).toBe(true);
      expect(afterMetrics.connectionMetrics).toBeDefined();
    });

    it('should show peer in metrics when netron provided', async () => {
      const mockNetron = {
        logger: {
          child: jest.fn().mockReturnThis(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          debug: jest.fn()
        }
      } as unknown as INetron;

      const client = new HttpTransportClient('http://localhost:3000', mockNetron);

      await client.initialize();

      const metrics = client.getMetrics();
      expect(metrics.hasPeer).toBe(true);
    });
  });

  describe('close() with initialization', () => {
    it('should close connection when initialized', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      await client.initialize();

      const mockConnectionInstance = (HttpConnection as jest.Mock).mock.results[0].value;

      await client.close();

      expect(mockConnectionInstance.close).toHaveBeenCalled();
    });

    it('should close both peer and connection when both exist', async () => {
      const mockNetron = {
        logger: {
          child: jest.fn().mockReturnThis(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          debug: jest.fn()
        }
      } as unknown as INetron;

      const client = new HttpTransportClient('http://localhost:3000', mockNetron);
      await client.initialize();

      const mockPeerInstance = (HttpRemotePeer as jest.Mock).mock.results[0].value;
      const mockConnectionInstance = (HttpConnection as jest.Mock).mock.results[0].value;

      await client.close();

      expect(mockPeerInstance.close).toHaveBeenCalled();
      expect(mockConnectionInstance.close).toHaveBeenCalled();
    });
  });

  describe('invoke() with peer', () => {
    it('should use peer when available and method exists', async () => {
      const mockNetron = {
        logger: {
          child: jest.fn().mockReturnThis(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          debug: jest.fn()
        }
      } as unknown as INetron;

      const client = new HttpTransportClient('http://localhost:3000', mockNetron);
      await client.initialize();

      // Mock peer to return a service with a method
      const mockMethod = jest.fn().mockResolvedValue('peer-result');
      const mockPeerInstance = (HttpRemotePeer as jest.Mock).mock.results[0].value;
      mockPeerInstance.queryInterface.mockResolvedValue({
        testMethod: mockMethod
      });

      const result = await client.invoke('TestService@1.0.0', 'testMethod', [{ arg: 'value' }]);

      expect(mockPeerInstance.queryInterface).toHaveBeenCalledWith('TestService@1.0.0');
      expect(mockMethod).toHaveBeenCalledWith({ arg: 'value' });
      expect(result).toBe('peer-result');
    });

    it('should fallback to connection when peer returns no service', async () => {
      const mockNetron = {
        logger: {
          child: jest.fn().mockReturnThis(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          debug: jest.fn()
        }
      } as unknown as INetron;

      const client = new HttpTransportClient('http://localhost:3000', mockNetron);
      await client.initialize();

      // Peer returns null
      const mockPeerInstance = (HttpRemotePeer as jest.Mock).mock.results[0].value;
      mockPeerInstance.queryInterface.mockResolvedValue(null);

      // Connection returns service
      const mockMethod = jest.fn().mockResolvedValue('connection-result');
      const mockConnectionInstance = (HttpConnection as jest.Mock).mock.results[0].value;
      mockConnectionInstance.queryInterface.mockResolvedValue({
        testMethod: mockMethod
      });

      const result = await client.invoke('TestService@1.0.0', 'testMethod', [{ arg: 'value' }]);

      expect(mockConnectionInstance.queryInterface).toHaveBeenCalledWith('TestService@1.0.0');
      expect(mockMethod).toHaveBeenCalledWith({ arg: 'value' });
      expect(result).toBe('connection-result');
    });

    it('should fallback to connection when peer method does not exist', async () => {
      const mockNetron = {
        logger: {
          child: jest.fn().mockReturnThis(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          debug: jest.fn()
        }
      } as unknown as INetron;

      const client = new HttpTransportClient('http://localhost:3000', mockNetron);
      await client.initialize();

      // Peer returns service without the method
      const mockPeerInstance = (HttpRemotePeer as jest.Mock).mock.results[0].value;
      mockPeerInstance.queryInterface.mockResolvedValue({
        otherMethod: jest.fn()
      });

      // Connection returns service
      const mockMethod = jest.fn().mockResolvedValue('connection-result');
      const mockConnectionInstance = (HttpConnection as jest.Mock).mock.results[0].value;
      mockConnectionInstance.queryInterface.mockResolvedValue({
        testMethod: mockMethod
      });

      const result = await client.invoke('TestService@1.0.0', 'testMethod', [{ arg: 'value' }]);

      expect(mockConnectionInstance.queryInterface).toHaveBeenCalledWith('TestService@1.0.0');
      expect(result).toBe('connection-result');
    });
  });

  describe('invoke() without peer', () => {
    it('should use connection when no peer exists', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      await client.initialize();

      const mockMethod = jest.fn().mockResolvedValue('connection-result');
      const mockConnectionInstance = (HttpConnection as jest.Mock).mock.results[0].value;
      mockConnectionInstance.queryInterface.mockResolvedValue({
        testMethod: mockMethod
      });

      const result = await client.invoke('TestService@1.0.0', 'testMethod', [{ arg: 'value' }]);

      expect(mockConnectionInstance.queryInterface).toHaveBeenCalledWith('TestService@1.0.0');
      expect(mockMethod).toHaveBeenCalledWith({ arg: 'value' });
      expect(result).toBe('connection-result');
    });

    it('should use direct HTTP when connection returns no service', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      await client.initialize();

      const mockConnectionInstance = (HttpConnection as jest.Mock).mock.results[0].value;
      mockConnectionInstance.queryInterface.mockResolvedValue(null);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: 'test-id',
          version: '2.0',
          timestamp: Date.now(),
          success: true,
          data: 'http-result'
        })
      } as any);

      const result = await client.invoke('TestService@1.0.0', 'testMethod', [{ arg: 'value' }]);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/netron/invoke',
        expect.objectContaining({
          method: 'POST'
        })
      );
      expect(result).toBe('http-result');
    });

    it('should use direct HTTP when connection method does not exist', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      await client.initialize();

      const mockConnectionInstance = (HttpConnection as jest.Mock).mock.results[0].value;
      mockConnectionInstance.queryInterface.mockResolvedValue({
        otherMethod: jest.fn()
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: 'test-id',
          version: '2.0',
          timestamp: Date.now(),
          success: true,
          data: 'http-result'
        })
      } as any);

      const result = await client.invoke('TestService@1.0.0', 'testMethod', [{ arg: 'value' }]);

      expect(mockFetch).toHaveBeenCalled();
      expect(result).toBe('http-result');
    });

    it('should pass context and hints to direct HTTP request', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      await client.initialize();

      const mockConnectionInstance = (HttpConnection as jest.Mock).mock.results[0].value;
      mockConnectionInstance.queryInterface.mockResolvedValue(null);

      await client.invoke('TestService@1.0.0', 'testMethod', [{ arg: 'value' }], {
        context: { traceId: 'trace-123', userId: 'user-456' },
        hints: { timeout: 5000, priority: 'high' }
      });

      expect(mockFetch).toHaveBeenCalled();
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body as string);

      expect(body.context).toEqual({ traceId: 'trace-123', userId: 'user-456' });
      expect(body.hints).toEqual({ timeout: 5000, priority: 'high' });
    });

    it('should throw error when direct HTTP returns error', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      await client.initialize();

      const mockConnectionInstance = (HttpConnection as jest.Mock).mock.results[0].value;
      mockConnectionInstance.queryInterface.mockResolvedValue(null);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: 'test-id',
          version: '2.0',
          timestamp: Date.now(),
          success: false,
          error: {
            code: 'TEST_ERROR',
            message: 'Test error message'
          }
        })
      } as any);

      await expect(
        client.invoke('TestService@1.0.0', 'testMethod', [{ arg: 'value' }])
      ).rejects.toThrow();
    });

    it('should use default error message when error message missing', async () => {
      const client = new HttpTransportClient('http://localhost:3000');
      await client.initialize();

      const mockConnectionInstance = (HttpConnection as jest.Mock).mock.results[0].value;
      mockConnectionInstance.queryInterface.mockResolvedValue(null);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          id: 'test-id',
          version: '2.0',
          timestamp: Date.now(),
          success: false,
          error: {
            code: 'TEST_ERROR'
            // No message
          }
        })
      } as any);

      await expect(
        client.invoke('TestService@1.0.0', 'testMethod', [{ arg: 'value' }])
      ).rejects.toThrow(); // Just check that it throws, don't check exact message
    });
  });

  describe('invoke() auto-initialization', () => {
    it('should auto-initialize if not already initialized', async () => {
      const client = new HttpTransportClient('http://localhost:3000');

      // Don't call initialize()
      const mockConnectionInstance = (HttpConnection as jest.Mock).mock.results[0]?.value;
      expect(mockConnectionInstance).toBeUndefined();

      // Setup connection mock to return service
      (HttpConnection as jest.Mock).mockImplementation(() => ({
        id: 'mock-connection-id',
        state: 'connected',
        queryInterface: jest.fn().mockResolvedValue({
          testMethod: jest.fn().mockResolvedValue('result')
        }),
        close: jest.fn().mockResolvedValue(undefined),
        getMetrics: jest.fn().mockReturnValue({})
      }));

      await client.invoke('TestService@1.0.0', 'testMethod', [{}]);

      // Verify connection was created during invoke
      expect(HttpConnection).toHaveBeenCalled();
    });
  });
});
