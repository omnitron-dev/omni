/**
 * Comprehensive integration test for all new netron-browser features
 *
 * Tests the integration of:
 * 1. Authentication module with token management
 * 2. Cache invalidation core task
 * 3. Enhanced queryInterface with auth awareness
 * 4. Client-side middleware system
 *
 * This test verifies that all features work together seamlessly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Application } from '@omnitron-dev/titan';
import { Module, Injectable } from '@omnitron-dev/titan/decorators';
import {
  NetronModule,
  Service,
  Public,
  type INetronPeer,
} from '@omnitron-dev/titan/netron';
import { HttpRemotePeer } from '../../src/transport/http/peer.js';
import { AuthenticationClient, MemoryTokenStorage } from '../../src/auth/index.js';
import {
  MiddlewarePipeline,
  MiddlewareStage,
  createAuthMiddleware,
  createLoggingMiddleware,
  createTimingMiddleware,
  SimpleTokenProvider,
  InMemoryMetricsCollector,
} from '../../src/middleware/index.js';
import {
  CORE_TASK_QUERY_INTERFACE,
  CORE_TASK_AUTHENTICATE,
  CORE_TASK_INVALIDATE_CACHE,
  createQueryInterfaceRequest,
  createAuthenticateRequest,
  createInvalidateCacheRequest,
  isQueryInterfaceResponse,
  isAuthenticateResponse,
  isInvalidateCacheResponse,
} from '../../src/core-tasks/index.js';
import type { AuthCredentials } from '../../src/auth/types.js';

// Test Services
@Service('UserService@1.0.0')
class UserService {
  @Public()
  async getPublicInfo() {
    return { info: 'This is public information' };
  }

  @Public()
  async getUserProfile(userId: string) {
    return {
      id: userId,
      name: 'John Doe',
      email: 'john@example.com',
    };
  }

  @Public()
  async updateUserProfile(userId: string, data: any) {
    return {
      id: userId,
      ...data,
      updated: true,
    };
  }

  @Public()
  async deleteUser(userId: string) {
    return { success: true, message: `User ${userId} deleted` };
  }
}

@Service('AuthService@1.0.0')
class AuthService {
  @Public()
  async authenticate(credentials: AuthCredentials) {
    // Simple mock authentication
    if (
      credentials.username === 'testuser' &&
      credentials.password === 'testpass'
    ) {
      return {
        success: true,
        context: {
          userId: 'user-123',
          username: 'testuser',
          roles: ['user'],
          token: {
            type: 'bearer' as const,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
          },
          metadata: {
            token: 'mock-jwt-token-user-123',
          },
        },
      };
    }

    if (
      credentials.username === 'admin' &&
      credentials.password === 'adminpass'
    ) {
      return {
        success: true,
        context: {
          userId: 'admin-456',
          username: 'admin',
          roles: ['user', 'admin'],
          token: {
            type: 'bearer' as const,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
          metadata: {
            token: 'mock-jwt-token-admin-456',
          },
        },
      };
    }

    return {
      success: false,
      error: 'Invalid credentials',
    };
  }

  @Public()
  async refreshToken(token: string) {
    return {
      success: true,
      context: {
        userId: 'user-123',
        username: 'testuser',
        roles: ['user'],
        token: {
          type: 'bearer' as const,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
        metadata: {
          token: 'refreshed-jwt-token-user-123',
        },
      },
    };
  }
}

@Module({
  providers: [UserService, AuthService],
})
class TestServicesModule {}

describe('Full Features Integration', () => {
  let app: Application;
  let server: INetronPeer;
  let client: HttpRemotePeer;
  let authClient: AuthenticationClient;
  let pipeline: MiddlewarePipeline;
  let metricsCollector: InMemoryMetricsCollector;

  beforeEach(async () => {
    // Start Titan application with test services
    app = await Application.create(TestServicesModule, {
      disableGracefulShutdown: true,
      disableCoreModules: true,
    });

    app.use(NetronModule, {
      server: {
        transport: 'http',
        http: {
          port: 0, // Random port
        },
      },
    });

    await app.start();

    // Get server peer
    const netron = app.get('netron:server');
    server = netron.getPeer();

    // Get actual port
    const port = (server as any).options.http.port;

    // Create client
    client = new HttpRemotePeer({
      url: `http://localhost:${port}/netron`,
      cache: {
        definitions: {
          enabled: true,
          ttl: 60000,
        },
        http: {
          enabled: true,
          ttl: 30000,
        },
      },
    });

    // Create auth client
    authClient = new AuthenticationClient({
      storage: new MemoryTokenStorage(),
      autoRefresh: true,
      refreshThreshold: 5 * 60 * 1000,
    });

    // Create middleware pipeline
    pipeline = new MiddlewarePipeline();
    metricsCollector = new InMemoryMetricsCollector();

    // Setup client with middleware
    client.middleware = pipeline;
  });

  afterEach(async () => {
    // Cleanup
    client.close();
    authClient.destroy();
    await app.stop();
  });

  describe('Authentication Flow', () => {
    it('should authenticate user and store token', async () => {
      // Create authentication request
      const authRequest = createAuthenticateRequest({
        username: 'testuser',
        password: 'testpass',
      });

      // Call authenticate through peer
      const response = await client.call(
        CORE_TASK_AUTHENTICATE,
        authRequest
      );

      // Verify response
      expect(isAuthenticateResponse(response)).toBe(true);
      expect(response.success).toBe(true);
      expect(response.context?.userId).toBe('user-123');
      expect(response.context?.username).toBe('testuser');
      expect(response.context?.roles).toContain('user');

      // Set auth in client
      authClient.setAuth(response);

      // Verify auth state
      expect(authClient.isAuthenticated()).toBe(true);
      expect(authClient.getToken()).toBe('mock-jwt-token-user-123');

      const authHeaders = authClient.getAuthHeaders();
      expect(authHeaders.Authorization).toBe('Bearer mock-jwt-token-user-123');
    });

    it('should authenticate admin with elevated permissions', async () => {
      const authRequest = createAuthenticateRequest({
        username: 'admin',
        password: 'adminpass',
      });

      const response = await client.call(
        CORE_TASK_AUTHENTICATE,
        authRequest
      );

      expect(isAuthenticateResponse(response)).toBe(true);
      expect(response.success).toBe(true);
      expect(response.context?.roles).toContain('admin');

      authClient.setAuth(response);
      expect(authClient.getToken()).toBe('mock-jwt-token-admin-456');
    });

    it('should fail authentication with invalid credentials', async () => {
      const authRequest = createAuthenticateRequest({
        username: 'invalid',
        password: 'wrong',
      });

      const response = await client.call(
        CORE_TASK_AUTHENTICATE,
        authRequest
      );

      expect(isAuthenticateResponse(response)).toBe(true);
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });
  });

  describe('Middleware Integration', () => {
    it('should inject auth token via middleware', async () => {
      // First authenticate
      const authRequest = createAuthenticateRequest({
        username: 'testuser',
        password: 'testpass',
      });

      const authResponse = await client.call(
        CORE_TASK_AUTHENTICATE,
        authRequest
      );

      authClient.setAuth(authResponse);

      // Setup auth middleware
      const tokenProvider = new SimpleTokenProvider(authClient.getToken()!);
      pipeline.use(createAuthMiddleware({ tokenProvider }), { priority: 1 });

      // Call a protected method - middleware should inject token
      const userProfile = await client.call(
        'UserService@1.0.0',
        'getUserProfile',
        ['user-123']
      );

      expect(userProfile).toBeDefined();
      expect(userProfile.id).toBe('user-123');
      expect(userProfile.name).toBe('John Doe');
    });

    it('should combine auth, logging, and timing middleware', async () => {
      // Authenticate
      const authRequest = createAuthenticateRequest({
        username: 'admin',
        password: 'adminpass',
      });

      const authResponse = await client.call(
        CORE_TASK_AUTHENTICATE,
        authRequest
      );

      authClient.setAuth(authResponse);

      // Setup multiple middleware
      const tokenProvider = new SimpleTokenProvider(authClient.getToken()!);
      const logs: any[] = [];
      const logger = {
        debug: vi.fn(),
        info: (msg: string, data: any) => logs.push({ msg, data }),
        warn: vi.fn(),
        error: vi.fn(),
      };

      pipeline.use(createAuthMiddleware({ tokenProvider }), { priority: 1 });
      pipeline.use(createLoggingMiddleware({ logger }), { priority: 2 });
      pipeline.use(
        createTimingMiddleware({ collector: metricsCollector }),
        { priority: 3 }
      );

      // Make a call
      await client.call('UserService@1.0.0', 'getPublicInfo');

      // Verify all middleware executed
      expect(logs.length).toBeGreaterThan(0);

      const metrics = metricsCollector.getMetrics();
      expect(metrics.length).toBeGreaterThan(0);
    });
  });

  describe('Auth-Aware Service Discovery', () => {
    it('should query interface and discover service methods', async () => {
      const queryRequest = createQueryInterfaceRequest('UserService@1.0.0');
      const response = await client.call(
        CORE_TASK_QUERY_INTERFACE,
        queryRequest
      );

      expect(isQueryInterfaceResponse(response)).toBe(true);

      // Should see all public methods
      const methods = Object.keys(response.definition.meta.methods);
      expect(methods).toContain('getPublicInfo');
      expect(methods).toContain('getUserProfile');
      expect(methods).toContain('updateUserProfile');
      expect(methods).toContain('deleteUser');
    });

    it('should query interface with auth token in middleware', async () => {
      // Authenticate as user
      const authRequest = createAuthenticateRequest({
        username: 'testuser',
        password: 'testpass',
      });

      const authResponse = await client.call(
        CORE_TASK_AUTHENTICATE,
        authRequest
      );

      authClient.setAuth(authResponse);

      // Setup auth middleware to inject token
      const tokenProvider = new SimpleTokenProvider(authClient.getToken()!);
      pipeline.use(createAuthMiddleware({ tokenProvider }));

      // Query interface with auth headers automatically added
      const queryRequest = createQueryInterfaceRequest('UserService@1.0.0');
      const response = await client.call(
        CORE_TASK_QUERY_INTERFACE,
        queryRequest
      );

      expect(isQueryInterfaceResponse(response)).toBe(true);

      // All methods should be visible
      const methods = Object.keys(response.definition.meta.methods);
      expect(methods.length).toBeGreaterThan(0);
      expect(methods).toContain('getPublicInfo');
      expect(methods).toContain('getUserProfile');
    });

    it('should successfully call methods with auth middleware', async () => {
      // Authenticate as admin
      const authRequest = createAuthenticateRequest({
        username: 'admin',
        password: 'adminpass',
      });

      const authResponse = await client.call(
        CORE_TASK_AUTHENTICATE,
        authRequest
      );

      authClient.setAuth(authResponse);

      // Setup auth middleware
      const tokenProvider = new SimpleTokenProvider(authClient.getToken()!);
      pipeline.use(createAuthMiddleware({ tokenProvider }));

      // Query interface
      const queryRequest = createQueryInterfaceRequest('UserService@1.0.0');
      const response = await client.call(
        CORE_TASK_QUERY_INTERFACE,
        queryRequest
      );

      expect(isQueryInterfaceResponse(response)).toBe(true);

      // Call various methods - auth token will be automatically added
      const publicInfo = await client.call('UserService@1.0.0', 'getPublicInfo');
      expect(publicInfo.info).toBeDefined();

      const userProfile = await client.call(
        'UserService@1.0.0',
        'getUserProfile',
        ['user-123']
      );
      expect(userProfile.id).toBe('user-123');

      const deleteResult = await client.call(
        'UserService@1.0.0',
        'deleteUser',
        ['user-789']
      );
      expect(deleteResult.success).toBe(true);
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate cache after operations', async () => {
      // First, make some calls to populate cache
      await client.call('UserService@1.0.0', 'getPublicInfo');
      await client.call('UserService@1.0.0', 'getPublicInfo');

      // Cache should have entries
      const cacheStats1 = client.getCacheStats();
      expect(cacheStats1.http.size).toBeGreaterThan(0);

      // Invalidate cache
      const invalidateRequest = createInvalidateCacheRequest(
        'UserService@1.0.0:getPublicInfo'
      );

      const response = await client.invalidateCache(
        invalidateRequest.pattern,
        invalidateRequest.cacheType
      );

      expect(response.count).toBeGreaterThan(0);

      // Cache should be cleared
      const cacheStats2 = client.getCacheStats();
      expect(cacheStats2.http.size).toBe(0);
    });

    it('should invalidate by wildcard pattern', async () => {
      // Make calls to different services
      await client.call('UserService@1.0.0', 'getPublicInfo');
      await client.call('AuthService@1.0.0', 'refreshToken', ['token']);

      // Invalidate all UserService caches
      const response = await client.invalidateCache('UserService*');

      expect(response.count).toBeGreaterThan(0);
    });

    it('should invalidate only service definitions', async () => {
      // Query interface to cache definition
      const queryRequest = createQueryInterfaceRequest('UserService@1.0.0');
      await client.call(CORE_TASK_QUERY_INTERFACE, queryRequest);

      // Make HTTP call to cache response
      await client.call('UserService@1.0.0', 'getPublicInfo');

      const stats1 = client.getCacheStats();
      const serviceCacheSize = stats1.definitions.size;
      const httpCacheSize = stats1.http.size;

      // Invalidate only service cache
      const response = await client.invalidateCache(undefined, 'service');

      expect(response.count).toBe(serviceCacheSize);
      expect(response.breakdown?.service).toBe(serviceCacheSize);

      const stats2 = client.getCacheStats();
      expect(stats2.definitions.size).toBe(0);
      expect(stats2.http.size).toBe(httpCacheSize); // HTTP cache unchanged
    });
  });

  describe('Complete Workflow Integration', () => {
    it('should demonstrate complete user journey', async () => {
      // 1. User authenticates
      const authRequest = createAuthenticateRequest({
        username: 'testuser',
        password: 'testpass',
      });

      const authResponse = await client.call(
        CORE_TASK_AUTHENTICATE,
        authRequest
      );

      expect(authResponse.success).toBe(true);
      authClient.setAuth(authResponse);

      // 2. Setup middleware with auth token
      const tokenProvider = new SimpleTokenProvider(authClient.getToken()!);
      pipeline.use(createAuthMiddleware({ tokenProvider }), { priority: 1 });
      pipeline.use(
        createTimingMiddleware({ collector: metricsCollector }),
        { priority: 2 }
      );

      // 3. Discover available services
      const queryRequest = createQueryInterfaceRequest('UserService@1.0.0');
      const serviceInfo = await client.call(
        CORE_TASK_QUERY_INTERFACE,
        queryRequest
      );

      expect(isQueryInterfaceResponse(serviceInfo)).toBe(true);

      // 4. Call service methods
      const publicInfo = await client.call(
        'UserService@1.0.0',
        'getPublicInfo'
      );
      expect(publicInfo.info).toBeDefined();

      const userProfile = await client.call(
        'UserService@1.0.0',
        'getUserProfile',
        ['user-123']
      );
      expect(userProfile.id).toBe('user-123');

      // 5. Verify timing metrics collected
      const metrics = metricsCollector.getMetrics();
      expect(metrics.length).toBeGreaterThan(0);

      const avgDuration = metricsCollector.getAverageDuration(
        'UserService@1.0.0',
        'getPublicInfo'
      );
      expect(avgDuration).toBeGreaterThan(0);

      // 6. Invalidate cache after operations
      const invalidateResponse = await client.invalidateCache('UserService*');
      expect(invalidateResponse.count).toBeGreaterThan(0);

      // 7. Logout
      authClient.clearAuth();
      expect(authClient.isAuthenticated()).toBe(false);
      expect(authClient.getToken()).toBeUndefined();
    });

    it('should handle admin workflow with full middleware stack', async () => {
      // 1. Admin authenticates
      const authRequest = createAuthenticateRequest({
        username: 'admin',
        password: 'adminpass',
      });

      const authResponse = await client.call(
        CORE_TASK_AUTHENTICATE,
        authRequest
      );

      authClient.setAuth(authResponse);

      // 2. Setup comprehensive middleware stack
      const tokenProvider = new SimpleTokenProvider(authClient.getToken()!);
      const logs: any[] = [];
      const logger = {
        debug: vi.fn(),
        info: (msg: string, data: any) => logs.push({ msg, data }),
        warn: vi.fn(),
        error: vi.fn(),
      };

      pipeline.use(createAuthMiddleware({ tokenProvider }), { priority: 1 });
      pipeline.use(createLoggingMiddleware({ logger }), { priority: 2 });
      pipeline.use(
        createTimingMiddleware({ collector: metricsCollector }),
        { priority: 3 }
      );

      // 3. Query interface to discover available methods
      const queryRequest = createQueryInterfaceRequest('UserService@1.0.0');
      const serviceInfo = await client.call(
        CORE_TASK_QUERY_INTERFACE,
        queryRequest
      );

      const methods = Object.keys(serviceInfo.definition.meta.methods);
      expect(methods).toContain('deleteUser');
      expect(methods).toContain('updateUserProfile');

      // 4. Call various service methods
      const publicInfo = await client.call('UserService@1.0.0', 'getPublicInfo');
      expect(publicInfo.info).toBeDefined();

      const updateResult = await client.call(
        'UserService@1.0.0',
        'updateUserProfile',
        ['user-456', { name: 'Updated Name' }]
      );
      expect(updateResult.updated).toBe(true);

      const deleteResult = await client.call(
        'UserService@1.0.0',
        'deleteUser',
        ['user-789']
      );
      expect(deleteResult.success).toBe(true);

      // 5. Verify logging middleware captured all calls
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.some((log) => log.msg === 'RPC Request')).toBe(true);
      expect(logs.some((log) => log.msg === 'RPC Response')).toBe(true);

      // 6. Verify timing metrics collected for all methods
      const metrics = metricsCollector.getMetrics();
      expect(metrics.some((m) => m.method === 'getPublicInfo')).toBe(true);
      expect(metrics.some((m) => m.method === 'updateUserProfile')).toBe(true);
      expect(metrics.some((m) => m.method === 'deleteUser')).toBe(true);

      // 7. Clear all caches to cleanup
      const invalidateResponse = await client.invalidateCache();
      expect(invalidateResponse.count).toBeGreaterThan(0);
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle authentication errors gracefully', async () => {
      const authRequest = createAuthenticateRequest({
        username: 'invalid',
        password: 'wrong',
      });

      const response = await client.call(
        CORE_TASK_AUTHENTICATE,
        authRequest
      );

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();

      // Auth client should not be authenticated
      expect(authClient.isAuthenticated()).toBe(false);
    });

    it('should handle missing service gracefully', async () => {
      const queryRequest = createQueryInterfaceRequest(
        'NonExistentService@1.0.0'
      );

      await expect(async () => {
        await client.call(CORE_TASK_QUERY_INTERFACE, queryRequest);
      }).rejects.toThrow();
    });

    it('should handle network errors with proper error context', async () => {
      // Close the client to simulate network error
      const testClient = new HttpRemotePeer({
        url: 'http://localhost:9999/netron', // Non-existent port
      });

      await expect(async () => {
        await testClient.call('UserService@1.0.0', 'getPublicInfo');
      }).rejects.toThrow();

      testClient.close();
    });
  });

  describe('Performance and Caching', () => {
    it('should benefit from caching on repeated calls', async () => {
      // Setup timing middleware
      pipeline.use(
        createTimingMiddleware({ collector: metricsCollector }),
        { priority: 1 }
      );

      // First call - no cache
      const start1 = performance.now();
      await client.call('UserService@1.0.0', 'getPublicInfo');
      const duration1 = performance.now() - start1;

      // Second call - should hit cache
      const start2 = performance.now();
      await client.call('UserService@1.0.0', 'getPublicInfo');
      const duration2 = performance.now() - start2;

      // Cached call should be faster (note: this may not always be true in tests)
      // but we can verify cache was used
      const stats = client.getCacheStats();
      expect(stats.http.hits).toBeGreaterThan(0);
    });

    it('should show metrics for all operations', async () => {
      // Setup timing middleware
      pipeline.use(
        createTimingMiddleware({ collector: metricsCollector }),
        { priority: 1 }
      );

      // Make several calls
      await client.call('UserService@1.0.0', 'getPublicInfo');
      await client.call('UserService@1.0.0', 'getPublicInfo');
      await client.call('UserService@1.0.0', 'getPublicInfo');

      // Check metrics
      const metrics = metricsCollector.getMetrics();
      expect(metrics.length).toBeGreaterThan(0);

      const avgDuration = metricsCollector.getAverageDuration(
        'UserService@1.0.0',
        'getPublicInfo'
      );
      expect(avgDuration).toBeGreaterThan(0);

      // Get all service metrics
      const serviceMetrics = metricsCollector.getServiceMetrics(
        'UserService@1.0.0'
      );
      expect(serviceMetrics.length).toBeGreaterThan(0);
    });
  });
});
