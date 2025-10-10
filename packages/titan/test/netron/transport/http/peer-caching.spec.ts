/**
 * Phase 1 Optimization Tests: JWT-scoped caching with TTL for HTTP peer
 *
 * Tests comprehensive caching behavior including:
 * - Cache hit/miss scenarios
 * - TTL expiration
 * - JWT-scoped caching (different users get different definitions)
 * - Unauthenticated requests use shared cache
 * - Cache invalidation
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HttpRemotePeer } from '../../../../src/netron/transport/http/peer.js';
import { Definition } from '../../../../src/netron/definition.js';
import type { INetron } from '../../../../src/netron/types.js';
import type { ITransportConnection } from '../../../../src/netron/transport/types.js';
import { ErrorCode } from '../../../../src/errors/index.js';

// Mock logger
const createMockLogger = () => ({
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
  child: jest.fn(() => createMockLogger()),
  level: 'info'
});

// Mock Netron instance
const createMockNetron = (): INetron => ({
  logger: createMockLogger() as any,
  expose: jest.fn(),
  unexpose: jest.fn(),
  queryInterface: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  getServiceNames: jest.fn(),
  useTransport: jest.fn(),
  getPeerById: jest.fn(),
  getAllPeers: jest.fn(),
  container: {} as any
});

// Mock connection
const createMockConnection = (): ITransportConnection => ({
  id: 'test-connection',
  send: jest.fn(),
  close: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
  isConnected: true
} as any);

// Helper to create a JWT token
const createJWT = (payload: any): string => {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const signature = 'mock-signature';
  return `${header}.${body}.${signature}`;
};

// Helper to create a mock Definition
const createMockDefinition = (serviceName: string, version: string = '1.0.0'): Definition => ({
  id: `${serviceName}-${Date.now()}`,
  meta: {
    name: serviceName,
    version,
    methods: {
      testMethod: {
        name: 'testMethod',
        visibility: 'public' as const,
        parameters: [],
        returnType: 'any'
      }
    },
    properties: {},
    events: {}
  },
  originalInstance: null
});

describe('HttpRemotePeer - Phase 1 Caching Optimizations', () => {
  let peer: HttpRemotePeer;
  let mockNetron: INetron;
  let mockConnection: ITransportConnection;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    mockNetron = createMockNetron();
    mockConnection = createMockConnection();

    // Mock global fetch
    fetchMock = jest.fn() as jest.Mock;
    global.fetch = fetchMock;

    peer = new HttpRemotePeer(
      mockConnection,
      mockNetron,
      'http://localhost:3000',
      { requestTimeout: 5000 }
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Cache Hit/Miss Behavior', () => {
    it('should fetch definition on first request (cache miss)', async () => {
      const definition = createMockDefinition('UserService', '1.0.0');

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: definition }),
        headers: new Map()
      });

      const result = await (peer as any).queryInterfaceRemote('UserService@1.0.0');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual(definition);
      expect(result.id).toBe(definition.id);
    });

    it('should use cached definition on second request (cache hit)', async () => {
      const definition = createMockDefinition('UserService', '1.0.0');

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: definition }),
        headers: new Map()
      });

      // First request - should fetch
      await (peer as any).queryInterfaceRemote('UserService@1.0.0');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second request - should use cache
      const result = await (peer as any).queryInterfaceRemote('UserService@1.0.0');
      expect(fetchMock).toHaveBeenCalledTimes(1); // Still 1, not 2
      expect(result).toEqual(definition);
    });

    it('should track cache hits in debug logs', async () => {
      const definition = createMockDefinition('UserService', '1.0.0');

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: definition }),
        headers: new Map()
      });

      await (peer as any).queryInterfaceRemote('UserService@1.0.0');
      await (peer as any).queryInterfaceRemote('UserService@1.0.0');

      const logger = mockNetron.logger.child as jest.Mock;
      const childLogger = logger.mock.results[0]?.value;
      expect(childLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceName: 'UserService@1.0.0',
          cacheKey: 'UserService@1.0.0'
        }),
        'Using cached definition (not expired)'
      );
    });
  });

  describe('TTL-based Cache Expiration', () => {
    it('should expire cache after configured TTL', async () => {
      const definition = createMockDefinition('UserService', '1.0.0');

      // Create peer with short TTL (100ms)
      peer = new HttpRemotePeer(
        mockConnection,
        mockNetron,
        'http://localhost:3000',
        { requestTimeout: 5000 }
      );
      (peer as any).defaultOptions.definitionCacheTtl = 100;

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ result: definition }),
        headers: new Map()
      });

      // First request
      await (peer as any).queryInterfaceRemote('UserService@1.0.0');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second request immediately - should use cache
      await (peer as any).queryInterfaceRemote('UserService@1.0.0');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Third request after expiration - should fetch again
      await (peer as any).queryInterfaceRemote('UserService@1.0.0');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should use default TTL of 5 minutes when not configured', async () => {
      const definition = createMockDefinition('UserService', '1.0.0');

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: definition }),
        headers: new Map()
      });

      await (peer as any).queryInterfaceRemote('UserService@1.0.0');

      // Check that the cache entry has the default TTL
      const cacheKey = 'UserService@1.0.0';
      const cacheEntry = (peer as any).definitions.get(cacheKey);
      expect(cacheEntry).toBeDefined();
      expect(cacheEntry.ttl).toBe(300000); // 5 minutes in ms
    });

    it('should log cache expiration in debug logs', async () => {
      const definition = createMockDefinition('UserService', '1.0.0');

      // Create new mock netron for this test with proper logger tracking
      const testMockNetron = createMockNetron();
      const testPeer = new HttpRemotePeer(
        mockConnection,
        testMockNetron,
        'http://localhost:3000',
        { requestTimeout: 5000 }
      );
      (testPeer as any).defaultOptions.definitionCacheTtl = 50;

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ result: definition }),
        headers: new Map()
      });

      await (testPeer as any).queryInterfaceRemote('UserService@1.0.0');
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Clear previous debug calls
      const childLogger = (testMockNetron.logger.child as jest.Mock).mock.results[0]?.value;
      (childLogger.debug as jest.Mock).mockClear();

      await (testPeer as any).queryInterfaceRemote('UserService@1.0.0');

      // Check that debug was called with expired flag
      expect(childLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceName: 'UserService@1.0.0',
          expired: true
        }),
        'Cache miss or expired, fetching from server'
      );
    });
  });

  describe('JWT-scoped Caching', () => {
    it('should scope cache by user ID from JWT token', async () => {
      const definition1 = createMockDefinition('AdminService', '1.0.0');
      const definition2 = createMockDefinition('AdminService', '1.0.0');

      // Create peer with JWT for user1
      const peer1 = new HttpRemotePeer(
        mockConnection,
        mockNetron,
        'http://localhost:3000',
        {
          requestTimeout: 5000,
          headers: {
            Authorization: `Bearer ${createJWT({ sub: 'user1' })}`
          }
        }
      );

      // Create peer with JWT for user2
      const peer2 = new HttpRemotePeer(
        mockConnection,
        mockNetron,
        'http://localhost:3000',
        {
          requestTimeout: 5000,
          headers: {
            Authorization: `Bearer ${createJWT({ sub: 'user2' })}`
          }
        }
      );

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: definition1 }),
          headers: new Map()
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: definition2 }),
          headers: new Map()
        });

      // Both users query the same service
      await (peer1 as any).queryInterfaceRemote('AdminService@1.0.0');
      await (peer2 as any).queryInterfaceRemote('AdminService@1.0.0');

      // Should have made 2 separate requests (not sharing cache)
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Check that cache keys are different
      const cache1Keys = Array.from((peer1 as any).definitions.keys());
      const cache2Keys = Array.from((peer2 as any).definitions.keys());
      expect(cache1Keys).toContain('user1:AdminService@1.0.0');
      expect(cache2Keys).toContain('user2:AdminService@1.0.0');
    });

    it('should extract user ID from different JWT payload fields', async () => {
      const testCases = [
        { sub: 'user-from-sub' },
        { userId: 'user-from-userId' },
        { id: 'user-from-id' }
      ];

      for (const payload of testCases) {
        const peer = new HttpRemotePeer(
          mockConnection,
          mockNetron,
          'http://localhost:3000',
          {
            headers: {
              Authorization: `Bearer ${createJWT(payload)}`
            }
          }
        );

        const userId = (peer as any).extractUserIdFromToken();
        expect(userId).toBe(Object.values(payload)[0]);
      }
    });

    it('should handle invalid JWT tokens gracefully', async () => {
      const peer = new HttpRemotePeer(
        mockConnection,
        mockNetron,
        'http://localhost:3000',
        {
          headers: {
            Authorization: 'Bearer invalid-token-format'
          }
        }
      );

      const userId = (peer as any).extractUserIdFromToken();
      expect(userId).toBeNull();
    });

    it('should prevent authorization cache poisoning', async () => {
      const adminDefinition = createMockDefinition('AdminService', '1.0.0');
      const userDefinition = createMockDefinition('AdminService', '1.0.0');

      // Simulate admin getting full access
      const adminPeer = new HttpRemotePeer(
        mockConnection,
        mockNetron,
        'http://localhost:3000',
        {
          headers: {
            Authorization: `Bearer ${createJWT({ sub: 'admin', role: 'admin' })}`
          }
        }
      );

      // Simulate regular user getting restricted access
      const userPeer = new HttpRemotePeer(
        mockConnection,
        mockNetron,
        'http://localhost:3000',
        {
          headers: {
            Authorization: `Bearer ${createJWT({ sub: 'user1', role: 'user' })}`
          }
        }
      );

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: adminDefinition }),
          headers: new Map()
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: userDefinition }),
          headers: new Map()
        });

      await (adminPeer as any).queryInterfaceRemote('AdminService@1.0.0');
      await (userPeer as any).queryInterfaceRemote('AdminService@1.0.0');

      // Should have made 2 separate requests (each user gets their own definition)
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Verify cache keys are different
      const adminCacheKey = 'admin:AdminService@1.0.0';
      const userCacheKey = 'user1:AdminService@1.0.0';
      expect((adminPeer as any).definitions.has(adminCacheKey)).toBe(true);
      expect((userPeer as any).definitions.has(userCacheKey)).toBe(true);
    });
  });

  describe('Unauthenticated Requests', () => {
    it('should use shared cache for unauthenticated requests', async () => {
      const definition = createMockDefinition('PublicService', '1.0.0');

      // Create two peers without authentication
      const peer1 = new HttpRemotePeer(
        mockConnection,
        mockNetron,
        'http://localhost:3000'
      );

      const peer2 = new HttpRemotePeer(
        mockConnection,
        mockNetron,
        'http://localhost:3000'
      );

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: definition }),
        headers: new Map()
      });

      // Both peers query the same service
      await (peer1 as any).queryInterfaceRemote('PublicService@1.0.0');

      // Peer2 should be able to query but will make its own request (different instances)
      // Note: In a real scenario with shared cache, this would be cached
      // But since these are separate instances, each has its own cache
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: definition }),
        headers: new Map()
      });
      await (peer2 as any).queryInterfaceRemote('PublicService@1.0.0');

      // Check that both use the same cache key (no user ID prefix)
      const cache1Keys = Array.from((peer1 as any).definitions.keys());
      const cache2Keys = Array.from((peer2 as any).definitions.keys());
      expect(cache1Keys).toContain('PublicService@1.0.0');
      expect(cache2Keys).toContain('PublicService@1.0.0');
    });

    it('should return null user ID when no Authorization header', async () => {
      const peer = new HttpRemotePeer(
        mockConnection,
        mockNetron,
        'http://localhost:3000'
      );

      const userId = (peer as any).extractUserIdFromToken();
      expect(userId).toBeNull();
    });

    it('should return null user ID when Authorization is not Bearer', async () => {
      const peer = new HttpRemotePeer(
        mockConnection,
        mockNetron,
        'http://localhost:3000',
        {
          headers: {
            Authorization: 'Basic dXNlcjpwYXNz'
          }
        }
      );

      const userId = (peer as any).extractUserIdFromToken();
      expect(userId).toBeNull();
    });
  });

  describe('Public API Compatibility', () => {
    it('should maintain queryInterface() signature unchanged', async () => {
      const definition = createMockDefinition('UserService', '1.0.0');

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: definition }),
        headers: new Map()
      });

      // Public API should work as before
      const service = await peer.queryInterface('UserService@1.0.0');

      expect(service).toBeDefined();
      expect(typeof service).toBe('object');
    });

    it('should maintain queryFluentInterface() signature unchanged', async () => {
      const definition = createMockDefinition('UserService', '1.0.0');

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: definition }),
        headers: new Map()
      });

      // Public API should work as before
      const service = await peer.queryFluentInterface('UserService@1.0.0');

      expect(service).toBeDefined();
      expect(typeof service).toBe('object');
    });
  });

  describe('Cache Invalidation', () => {
    it('should clear all cache entries when invalidateDefinitionCache is called without pattern', async () => {
      const definition1 = createMockDefinition('Service1', '1.0.0');
      const definition2 = createMockDefinition('Service2', '1.0.0');

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: definition1 }),
          headers: new Map()
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: definition2 }),
          headers: new Map()
        });

      await (peer as any).queryInterfaceRemote('Service1@1.0.0');
      await (peer as any).queryInterfaceRemote('Service2@1.0.0');

      expect((peer as any).definitions.size).toBeGreaterThan(0);

      peer.invalidateDefinitionCache();

      expect((peer as any).definitions.size).toBe(0);
      expect((peer as any).services.size).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should throw error when service is not found', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null }),
        headers: new Map()
      });

      await expect((peer as any).queryInterfaceRemote('NonExistent@1.0.0')).rejects.toThrow(
        "Service 'NonExistent@1.0.0' not found on remote peer"
      );
    });

    it('should handle network errors gracefully', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      await expect((peer as any).queryInterfaceRemote('UserService@1.0.0')).rejects.toThrow(
        'Network error'
      );
    });

    it('should handle HTTP error responses', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({}),
        headers: new Map()
      });

      await expect((peer as any).queryInterfaceRemote('UserService@1.0.0')).rejects.toThrow();
    });
  });

  describe('Cache Entry Structure', () => {
    it('should store cache entries with correct metadata', async () => {
      const definition = createMockDefinition('UserService', '1.0.0');

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: definition }),
        headers: new Map()
      });

      await (peer as any).queryInterfaceRemote('UserService@1.0.0');

      const cacheKey = 'UserService@1.0.0';
      const cacheEntry = (peer as any).definitions.get(cacheKey);

      expect(cacheEntry).toBeDefined();
      expect(cacheEntry).toHaveProperty('definition');
      expect(cacheEntry).toHaveProperty('timestamp');
      expect(cacheEntry).toHaveProperty('ttl');
      expect(cacheEntry.definition).toEqual(definition);
      expect(typeof cacheEntry.timestamp).toBe('number');
      expect(typeof cacheEntry.ttl).toBe('number');
    });

    it('should update timestamp on cache refresh', async () => {
      const definition = createMockDefinition('UserService', '1.0.0');

      peer = new HttpRemotePeer(
        mockConnection,
        mockNetron,
        'http://localhost:3000'
      );
      (peer as any).defaultOptions.definitionCacheTtl = 50;

      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ result: definition }),
        headers: new Map()
      });

      await (peer as any).queryInterfaceRemote('UserService@1.0.0');
      const firstEntry = (peer as any).definitions.get('UserService@1.0.0');
      const firstTimestamp = firstEntry.timestamp;

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Fetch again (should update cache)
      await (peer as any).queryInterfaceRemote('UserService@1.0.0');
      const secondEntry = (peer as any).definitions.get('UserService@1.0.0');
      const secondTimestamp = secondEntry.timestamp;

      expect(secondTimestamp).toBeGreaterThan(firstTimestamp);
    });
  });
});
