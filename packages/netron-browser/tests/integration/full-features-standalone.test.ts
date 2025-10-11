/**
 * Standalone integration test for netron-browser features
 *
 * Tests client-side features without requiring a full Titan server:
 * 1. Authentication client with token management
 * 2. Middleware pipeline system
 * 3. Cache management
 * 4. Type safety and exports
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthenticationClient, MemoryTokenStorage, LocalTokenStorage } from '../../src/auth/index.js';
import {
  MiddlewarePipeline,
  MiddlewareStage,
  createAuthMiddleware,
  createLoggingMiddleware,
  createTimingMiddleware,
  createErrorTransformMiddleware,
  SimpleTokenProvider,
  InMemoryMetricsCollector,
  type ClientMiddlewareContext,
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
import type { AuthResult, AuthCredentials } from '../../src/auth/types.js';

describe('Netron Browser Features - Standalone', () => {
  describe('Authentication Client', () => {
    let authClient: AuthenticationClient;

    beforeEach(() => {
      authClient = new AuthenticationClient({
        storage: new MemoryTokenStorage(),
        autoRefresh: true,
        refreshThreshold: 5 * 60 * 1000,
      });
    });

    afterEach(() => {
      authClient.destroy();
    });

    it('should initialize with default state', () => {
      expect(authClient.isAuthenticated()).toBe(false);
      expect(authClient.getToken()).toBeUndefined();
      expect(authClient.getContext()).toBeUndefined();
    });

    it('should set authentication context and token', () => {
      const authResult: AuthResult = {
        success: true,
        context: {
          userId: 'user-123',
          username: 'testuser',
          roles: ['user'],
          token: {
            type: 'bearer',
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
          metadata: {
            token: 'test-jwt-token-123',
          },
        },
      };

      authClient.setAuth(authResult);

      expect(authClient.isAuthenticated()).toBe(true);
      expect(authClient.getToken()).toBe('test-jwt-token-123');

      const context = authClient.getContext();
      expect(context?.userId).toBe('user-123');
      expect(context?.username).toBe('testuser');
      expect(context?.roles).toContain('user');
    });

    it('should generate auth headers correctly', () => {
      const authResult: AuthResult = {
        success: true,
        context: {
          userId: 'user-456',
          username: 'admin',
          roles: ['admin'],
          token: {
            type: 'bearer',
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
          metadata: {
            token: 'admin-jwt-token-456',
          },
        },
      };

      authClient.setAuth(authResult);

      const headers = authClient.getAuthHeaders();
      expect(headers.Authorization).toBe('Bearer admin-jwt-token-456');
    });

    it('should clear authentication properly', () => {
      const authResult: AuthResult = {
        success: true,
        context: {
          userId: 'user-789',
          username: 'guest',
          roles: ['guest'],
          token: {
            type: 'bearer',
          },
          metadata: {
            token: 'guest-token',
          },
        },
      };

      authClient.setAuth(authResult);
      expect(authClient.isAuthenticated()).toBe(true);

      authClient.clearAuth();
      expect(authClient.isAuthenticated()).toBe(false);
      expect(authClient.getToken()).toBeUndefined();
    });

    it('should emit authentication events', (done) => {
      let eventFired = false;

      authClient.on('authenticated', (data) => {
        eventFired = true;
        expect(data.context).toBeDefined();
        expect(data.context.userId).toBe('user-event');
        done();
      });

      const authResult: AuthResult = {
        success: true,
        context: {
          userId: 'user-event',
          username: 'eventuser',
          roles: [],
          token: { type: 'bearer' },
          metadata: { token: 'event-token' },
        },
      };

      authClient.setAuth(authResult);
      expect(eventFired).toBe(true);
    });

    it('should detect token expiration', () => {
      const authResult: AuthResult = {
        success: true,
        context: {
          userId: 'user-expired',
          username: 'expireduser',
          roles: [],
          token: {
            type: 'bearer',
            expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
          },
          metadata: { token: 'expired-token' },
        },
      };

      authClient.setAuth(authResult);
      expect(authClient.isTokenExpired()).toBe(true);
    });

    it('should detect when token needs refresh', () => {
      const authResult: AuthResult = {
        success: true,
        context: {
          userId: 'user-refresh',
          username: 'refreshuser',
          roles: [],
          token: {
            type: 'bearer',
            expiresAt: new Date(Date.now() + 2 * 60 * 1000), // Expires in 2 minutes
          },
          metadata: { token: 'refresh-token' },
        },
      };

      authClient.setAuth(authResult);
      // Should need refresh since expires in 2min and threshold is 5min
      expect(authClient.needsRefresh()).toBe(true);
    });

    it('should work with LocalTokenStorage', () => {
      const storage = new LocalTokenStorage('test_key');
      const client = new AuthenticationClient({ storage });

      const authResult: AuthResult = {
        success: true,
        context: {
          userId: 'user-local',
          username: 'localuser',
          roles: [],
          token: { type: 'bearer' },
          metadata: { token: 'local-token' },
        },
      };

      client.setAuth(authResult);
      expect(client.getToken()).toBe('local-token');

      // Verify token was stored
      const storedToken = storage.getToken();
      expect(storedToken).toBe('local-token');

      client.destroy();
      storage.removeToken();
    });
  });

  describe('Middleware Pipeline', () => {
    let pipeline: MiddlewarePipeline;
    let ctx: ClientMiddlewareContext;

    beforeEach(() => {
      pipeline = new MiddlewarePipeline();
      ctx = {
        service: 'TestService@1.0.0',
        method: 'testMethod',
        args: [1, 2, 3],
        timing: {
          start: performance.now(),
          middlewareTimes: new Map(),
        },
        metadata: new Map(),
        transport: 'http' as const,
      };
    });

    it('should execute middleware in order', async () => {
      const order: number[] = [];

      pipeline.use(
        async (ctx, next) => {
          order.push(1);
          await next();
          order.push(4);
        },
        { name: 'middleware-1', priority: 1 }
      );

      pipeline.use(
        async (ctx, next) => {
          order.push(2);
          await next();
          order.push(3);
        },
        { name: 'middleware-2', priority: 2 }
      );

      await pipeline.execute(ctx, MiddlewareStage.PRE_REQUEST);

      expect(order).toEqual([1, 2, 3, 4]);
    });

    it('should respect priority ordering', async () => {
      const order: string[] = [];

      pipeline.use(
        async (ctx, next) => {
          order.push('low');
          await next();
        },
        { name: 'low-priority', priority: 100 }
      );

      pipeline.use(
        async (ctx, next) => {
          order.push('high');
          await next();
        },
        { name: 'high-priority', priority: 1 }
      );

      await pipeline.execute(ctx, MiddlewareStage.PRE_REQUEST);

      expect(order).toEqual(['high', 'low']);
    });

    it('should track metrics for middleware execution', async () => {
      pipeline.use(async (ctx, next) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        await next();
      });

      await pipeline.execute(ctx, MiddlewareStage.PRE_REQUEST);

      const metrics = pipeline.getMetrics();
      expect(metrics.executions).toBe(1);
      expect(metrics.avgTime).toBeGreaterThan(0);
      expect(metrics.errors).toBe(0);
    });

    it('should allow conditional middleware execution', async () => {
      const executed: string[] = [];

      pipeline.use(
        async (ctx, next) => {
          executed.push('always');
          await next();
        },
        { name: 'always' }
      );

      pipeline.use(
        async (ctx, next) => {
          executed.push('conditional');
          await next();
        },
        {
          name: 'conditional',
          condition: (ctx) => ctx.service === 'OtherService',
        }
      );

      await pipeline.execute(ctx, MiddlewareStage.PRE_REQUEST);

      expect(executed).toEqual(['always']);
      expect(executed).not.toContain('conditional');
    });
  });

  describe('Auth Middleware Integration', () => {
    it('should inject bearer token into request context', async () => {
      const tokenProvider = new SimpleTokenProvider('my-auth-token-123');
      const middleware = createAuthMiddleware({ tokenProvider });

      const ctx: ClientMiddlewareContext = {
        service: 'TestService',
        method: 'testMethod',
        args: [],
        timing: {
          start: performance.now(),
          middlewareTimes: new Map(),
        },
        metadata: new Map(),
        transport: 'http' as const,
      };

      await middleware(ctx, async () => {});

      expect(ctx.request?.headers?.['Authorization']).toBe('Bearer my-auth-token-123');
    });

    it('should skip services in skip list', async () => {
      const tokenProvider = new SimpleTokenProvider('test-token');
      const middleware = createAuthMiddleware({
        tokenProvider,
        skipServices: ['PublicService'],
      });

      const ctx: ClientMiddlewareContext = {
        service: 'PublicService',
        method: 'getPublicData',
        args: [],
        timing: {
          start: performance.now(),
          middlewareTimes: new Map(),
        },
        metadata: new Map(),
        transport: 'http' as const,
      };

      await middleware(ctx, async () => {});

      expect(ctx.request?.headers?.['Authorization']).toBeUndefined();
    });

    it('should use custom header name and prefix', async () => {
      const tokenProvider = new SimpleTokenProvider('custom-token');
      const middleware = createAuthMiddleware({
        tokenProvider,
        headerName: 'X-Custom-Auth',
        tokenPrefix: 'Token ',
      });

      const ctx: ClientMiddlewareContext = {
        service: 'TestService',
        method: 'test',
        args: [],
        timing: {
          start: performance.now(),
          middlewareTimes: new Map(),
        },
        metadata: new Map(),
        transport: 'http' as const,
      };

      await middleware(ctx, async () => {});

      expect(ctx.request?.headers?.['X-Custom-Auth']).toBe('Token custom-token');
    });
  });

  describe('Timing Middleware Integration', () => {
    it('should collect timing metrics', async () => {
      const collector = new InMemoryMetricsCollector();
      const middleware = createTimingMiddleware({ collector });

      const ctx: ClientMiddlewareContext = {
        service: 'TestService',
        method: 'testMethod',
        args: [],
        timing: {
          start: performance.now(),
          middlewareTimes: new Map(),
        },
        metadata: new Map(),
        transport: 'http' as const,
      };

      await middleware(ctx, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const metrics = collector.getMetrics();
      expect(metrics.length).toBe(1);
      expect(metrics[0].service).toBe('TestService');
      expect(metrics[0].method).toBe('testMethod');
      expect(metrics[0].duration).toBeGreaterThan(0);
    });

    it('should detect slow requests', async () => {
      const slowRequests: any[] = [];
      const middleware = createTimingMiddleware({
        slowThreshold: 5,
        onSlowRequest: (metrics) => slowRequests.push(metrics),
      });

      const ctx: ClientMiddlewareContext = {
        service: 'SlowService',
        method: 'slowMethod',
        args: [],
        timing: {
          start: performance.now(),
          middlewareTimes: new Map(),
        },
        metadata: new Map(),
        transport: 'http' as const,
      };

      await middleware(ctx, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(slowRequests.length).toBe(1);
      expect(slowRequests[0].service).toBe('SlowService');
    });

    it('should calculate average duration', async () => {
      const collector = new InMemoryMetricsCollector();
      const middleware = createTimingMiddleware({ collector });

      const ctx: ClientMiddlewareContext = {
        service: 'TestService',
        method: 'testMethod',
        args: [],
        timing: {
          start: performance.now(),
          middlewareTimes: new Map(),
        },
        metadata: new Map(),
        transport: 'http' as const,
      };

      // Execute multiple times
      for (let i = 0; i < 3; i++) {
        await middleware({ ...ctx }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      }

      const avgDuration = collector.getAverageDuration('TestService', 'testMethod');
      expect(avgDuration).toBeGreaterThan(0);
    });
  });

  describe('Logging Middleware Integration', () => {
    it('should log request and response', async () => {
      const logs: any[] = [];
      const logger = {
        debug: vi.fn(),
        info: (msg: string, data: any) => logs.push({ level: 'info', msg, data }),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const middleware = createLoggingMiddleware({ logger });

      const ctx: ClientMiddlewareContext = {
        service: 'TestService',
        method: 'testMethod',
        args: [1, 2, 3],
        timing: {
          start: performance.now(),
          middlewareTimes: new Map(),
        },
        metadata: new Map(),
        transport: 'http' as const,
      };

      await middleware(ctx, async () => {
        ctx.response = { data: 'result' };
      });

      expect(logs.length).toBe(2);
      expect(logs[0].msg).toBe('RPC Request');
      expect(logs[1].msg).toBe('RPC Response');
    });

    it('should log errors', async () => {
      const logs: any[] = [];
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: (msg: string, data: any) => logs.push({ level: 'error', msg, data }),
      };

      const middleware = createLoggingMiddleware({ logger });

      const ctx: ClientMiddlewareContext = {
        service: 'TestService',
        method: 'errorMethod',
        args: [],
        timing: {
          start: performance.now(),
          middlewareTimes: new Map(),
        },
        metadata: new Map(),
        transport: 'http' as const,
      };

      await expect(
        middleware(ctx, async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      expect(logs.length).toBe(1);
      expect(logs[0].level).toBe('error');
      expect(logs[0].msg).toBe('RPC Error');
    });
  });

  describe('Full Middleware Stack Integration', () => {
    it('should execute auth, logging, and timing middleware together', async () => {
      const pipeline = new MiddlewarePipeline();
      const tokenProvider = new SimpleTokenProvider('stack-test-token');
      const collector = new InMemoryMetricsCollector();
      const logs: any[] = [];
      const logger = {
        debug: vi.fn(),
        info: (msg: string, data: any) => logs.push({ msg, data }),
        warn: vi.fn(),
        error: vi.fn(),
      };

      // Add all middleware with proper priority
      pipeline.use(createAuthMiddleware({ tokenProvider }), { priority: 1 });
      pipeline.use(createLoggingMiddleware({ logger }), { priority: 2 });
      pipeline.use(createTimingMiddleware({ collector }), { priority: 3 });

      const ctx: ClientMiddlewareContext = {
        service: 'StackTestService',
        method: 'stackTestMethod',
        args: ['arg1', 'arg2'],
        timing: {
          start: performance.now(),
          middlewareTimes: new Map(),
        },
        metadata: new Map(),
        transport: 'http' as const,
      };

      await pipeline.execute(ctx, MiddlewareStage.PRE_REQUEST);

      // Verify auth header was injected
      expect(ctx.request?.headers?.['Authorization']).toBe('Bearer stack-test-token');

      // Verify logging occurred
      expect(logs.length).toBeGreaterThan(0);

      // Verify metrics were collected
      const metrics = collector.getMetrics();
      expect(metrics.length).toBe(1);
      expect(metrics[0].service).toBe('StackTestService');
      expect(metrics[0].method).toBe('stackTestMethod');
    });
  });

  describe('Core Tasks Type Safety', () => {
    it('should create and validate query interface requests', () => {
      const request = createQueryInterfaceRequest('UserService@1.0.0');
      expect(request.serviceName).toBe('UserService@1.0.0');

      // Test with auth
      const requestWithAuth = createQueryInterfaceRequest('UserService@1.0.0', 'Bearer token-123');
      expect(requestWithAuth.serviceName).toBe('UserService@1.0.0');
      expect(requestWithAuth.authToken).toBe('Bearer token-123');
    });

    it('should create and validate authenticate requests', () => {
      const credentials: AuthCredentials = {
        username: 'testuser',
        password: 'testpass',
      };

      const request = createAuthenticateRequest(credentials);
      expect(request.username).toBe('testuser');
      expect(request.password).toBe('testpass');
    });

    it('should create and validate cache invalidation requests', () => {
      const request1 = createInvalidateCacheRequest();
      expect(request1.pattern).toBeUndefined();
      expect(request1.cacheType).toBe('all');

      const request2 = createInvalidateCacheRequest('UserService*');
      expect(request2.pattern).toBe('UserService*');
      expect(request2.cacheType).toBe('all');

      const request3 = createInvalidateCacheRequest(undefined, 'service');
      expect(request3.pattern).toBeUndefined();
      expect(request3.cacheType).toBe('service');
    });

    it('should validate response types with type guards', () => {
      // Valid auth response
      const authResponse = {
        success: true,
        context: {
          userId: 'user-123',
          username: 'test',
          roles: [],
          token: { type: 'bearer' as const },
        },
      };
      expect(isAuthenticateResponse(authResponse)).toBe(true);

      // Invalid auth response
      expect(isAuthenticateResponse({ success: true })).toBe(false);
      expect(isAuthenticateResponse(null)).toBe(false);

      // Valid cache invalidation response
      const cacheResponse = { count: 5 };
      expect(isInvalidateCacheResponse(cacheResponse)).toBe(true);

      // Invalid cache response
      expect(isInvalidateCacheResponse({ count: '5' })).toBe(false);
      expect(isInvalidateCacheResponse({})).toBe(false);
    });
  });

  describe('Feature Integration Summary', () => {
    it('should demonstrate all features working together', async () => {
      // 1. Create authentication client
      const authClient = new AuthenticationClient({
        storage: new MemoryTokenStorage(),
        autoRefresh: true,
      });

      // 2. Simulate authentication
      const authResult: AuthResult = {
        success: true,
        context: {
          userId: 'integration-user',
          username: 'integrationtest',
          roles: ['user'],
          token: {
            type: 'bearer',
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
          metadata: {
            token: 'integration-test-token',
          },
        },
      };

      authClient.setAuth(authResult);
      expect(authClient.isAuthenticated()).toBe(true);

      // 3. Create middleware pipeline with all middleware
      const pipeline = new MiddlewarePipeline();
      const tokenProvider = new SimpleTokenProvider(authClient.getToken()!);
      const collector = new InMemoryMetricsCollector();
      const logs: any[] = [];
      const logger = {
        debug: vi.fn(),
        info: (msg: string, data: any) => logs.push({ msg, data }),
        warn: vi.fn(),
        error: vi.fn(),
      };

      pipeline.use(createAuthMiddleware({ tokenProvider }), { priority: 1 });
      pipeline.use(createLoggingMiddleware({ logger }), { priority: 2 });
      pipeline.use(createTimingMiddleware({ collector }), { priority: 3 });

      // 4. Execute middleware pipeline
      const ctx: ClientMiddlewareContext = {
        service: 'IntegrationService@1.0.0',
        method: 'integrationMethod',
        args: ['test-data'],
        timing: {
          start: performance.now(),
          middlewareTimes: new Map(),
        },
        metadata: new Map(),
        transport: 'http' as const,
      };

      await pipeline.execute(ctx, MiddlewareStage.PRE_REQUEST);

      // 5. Verify all features worked
      expect(ctx.request?.headers?.['Authorization']).toBe('Bearer integration-test-token');
      expect(logs.length).toBeGreaterThan(0);
      expect(collector.getMetrics().length).toBeGreaterThan(0);

      // 6. Get pipeline metrics
      const pipelineMetrics = pipeline.getMetrics();
      expect(pipelineMetrics.executions).toBeGreaterThan(0);

      // 7. Cleanup
      authClient.clearAuth();
      authClient.destroy();

      expect(authClient.isAuthenticated()).toBe(false);
    });
  });
});
