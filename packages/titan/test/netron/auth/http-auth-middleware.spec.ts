/**
 * HTTP Auth Middleware Integration Tests
 *
 * Tests the createAuthMiddleware factory function with real implementations
 * of PolicyEngine and AuthorizationManager.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'reflect-metadata';
import {
  createAuthMiddleware,
  buildExecutionContext,
  readMethodMetadata,
} from '../../../src/netron/transport/http/middleware/auth.js';
import { PolicyEngine } from '../../../src/netron/auth/policy-engine.js';
import { AuthorizationManager } from '../../../src/netron/auth/authorization-manager.js';
import type { NetronMiddlewareContext } from '../../../src/netron/transport/http/middleware/types.js';
import type { AuthContext, ExecutionContext } from '../../../src/netron/auth/types.js';
import type { ILogger } from '../../../src/modules/logger/logger.types.js';
import { METADATA_KEYS } from '../../../src/decorators/core.js';
import { TitanError, ErrorCode } from '../../../src/errors/index.js';

// -----------------------------------------------------------------------------
// Mock Logger Implementation
// -----------------------------------------------------------------------------

function createMockLogger(): ILogger {
  return {
    child: vi.fn().mockReturnThis(),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    level: 'debug',
    silent: false,
  } as unknown as ILogger;
}

// -----------------------------------------------------------------------------
// Test Helpers
// -----------------------------------------------------------------------------

interface MockPeer {
  id: string;
  getAuthContext?: () => AuthContext | undefined;
}

function createMockPeer(authContext?: AuthContext): MockPeer {
  return {
    id: 'test-peer-id',
    getAuthContext: authContext ? () => authContext : undefined,
  };
}

function createMiddlewareContext(
  options: Partial<NetronMiddlewareContext> & {
    serviceInstance?: object;
    authContext?: AuthContext;
  } = {}
): NetronMiddlewareContext {
  const { serviceInstance, authContext, ...rest } = options;
  const metadata = new Map<string, unknown>();

  if (serviceInstance) {
    metadata.set('serviceInstance', serviceInstance);
  }
  if (authContext) {
    metadata.set('authContext', authContext);
  }
  if (rest.metadata) {
    for (const [key, value] of rest.metadata) {
      metadata.set(key, value);
    }
  }

  // Use 'in' operator to check if property was explicitly passed (even if undefined)
  const hasServiceName = 'serviceName' in options;
  const hasMethodName = 'methodName' in options;

  return {
    peer: createMockPeer(authContext) as any,
    metadata,
    timing: {
      start: Date.now(),
      middlewareTimes: new Map(),
    },
    serviceName: hasServiceName ? rest.serviceName : 'TestService',
    methodName: hasMethodName ? rest.methodName : 'testMethod',
    input: rest.input,
    result: rest.result,
    error: rest.error,
    task: rest.task,
    packet: rest.packet,
    skipRemaining: rest.skipRemaining,
  };
}

// -----------------------------------------------------------------------------
// Test Service Classes
// -----------------------------------------------------------------------------

class TestService {
  publicMethod(): string {
    return 'public';
  }

  protectedMethod(): string {
    return 'protected';
  }

  adminMethod(): string {
    return 'admin';
  }

  anonymousMethod(): string {
    return 'anonymous';
  }

  scopedMethod(): string {
    return 'scoped';
  }

  policyMethod(): string {
    return 'policy';
  }

  multiPolicyMethod(): string {
    return 'multi-policy';
  }

  orPolicyMethod(): string {
    return 'or-policy';
  }

  notPolicyMethod(): string {
    return 'not-policy';
  }
}

function setupMethodMetadata(serviceClass: any, methodName: string, authConfig: boolean | object | undefined): void {
  const prototype = serviceClass.prototype;

  // Mark method as public
  Reflect.defineMetadata('public', true, prototype, methodName);
  Reflect.defineMetadata(METADATA_KEYS.METHOD_ANNOTATION, true, prototype, methodName);

  // Set auth configuration
  if (authConfig !== undefined) {
    const methodOptions = { auth: authConfig };
    Reflect.defineMetadata(METADATA_KEYS.METHOD_OPTIONS, methodOptions, prototype, methodName);
    Reflect.defineMetadata(METADATA_KEYS.METHOD_AUTH, authConfig, prototype, methodName);
  }
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('HTTP Auth Middleware Integration', () => {
  let mockLogger: ILogger;
  let policyEngine: PolicyEngine;
  let authorizationManager: AuthorizationManager;
  let testService: TestService;

  beforeEach(() => {
    mockLogger = createMockLogger();
    policyEngine = new PolicyEngine(mockLogger);
    authorizationManager = new AuthorizationManager(mockLogger);
    testService = new TestService();

    // Clear any existing metadata
    vi.clearAllMocks();
  });

  describe('createAuthMiddleware factory', () => {
    it('should create a middleware function', () => {
      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      expect(typeof middleware).toBe('function');
    });

    it('should accept optional skipServices and skipMethods', () => {
      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
        skipServices: ['HealthService'],
        skipMethods: ['TestService.publicMethod'],
      });

      expect(typeof middleware).toBe('function');
    });
  });

  describe('Middleware Skip Conditions', () => {
    it('should skip when no serviceName is provided', async () => {
      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const ctx = createMiddlewareContext({ serviceName: undefined });
      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
    });

    it('should skip when no methodName is provided', async () => {
      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const ctx = createMiddlewareContext({ methodName: undefined });
      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
    });

    it('should skip when service is in skipServices list', async () => {
      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
        skipServices: ['SkippedService'],
      });

      const ctx = createMiddlewareContext({ serviceName: 'SkippedService' });
      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it('should skip when method is in skipMethods list', async () => {
      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
        skipMethods: ['TestService.testMethod'],
      });

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'testMethod',
      });
      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
    });

    it('should skip when no service instance in metadata', async () => {
      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'testMethod',
      });
      // No serviceInstance set

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
    });

    it('should skip when method has no auth metadata', async () => {
      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      // No metadata set on publicMethod
      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'publicMethod',
        serviceInstance: testService,
      });

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('Boolean Auth Configuration', () => {
    beforeEach(() => {
      setupMethodMetadata(TestService, 'protectedMethod', true);
    });

    it('should require authentication when auth is true', async () => {
      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'protectedMethod',
        serviceInstance: testService,
        // No authContext - unauthenticated
      });

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await expect(middleware(ctx, next)).rejects.toThrow(TitanError);
      await expect(middleware(ctx, next)).rejects.toMatchObject({
        code: ErrorCode.UNAUTHORIZED,
        message: 'Authentication required',
      });
    });

    it('should allow access when auth is true and user is authenticated', async () => {
      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const authContext: AuthContext = {
        userId: 'user-1',
        roles: ['user'],
        permissions: ['read'],
      };

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'protectedMethod',
        serviceInstance: testService,
        authContext,
      });

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
    });

    it('should allow access when auth is false (no auth required)', async () => {
      setupMethodMetadata(TestService, 'publicMethod', false);

      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'publicMethod',
        serviceInstance: testService,
        // No authContext
      });

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('Anonymous Access', () => {
    beforeEach(() => {
      setupMethodMetadata(TestService, 'anonymousMethod', { allowAnonymous: true });
    });

    it('should allow anonymous access when allowAnonymous is true', async () => {
      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'anonymousMethod',
        serviceInstance: testService,
        // No authContext
      });

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it('should also allow authenticated access when allowAnonymous is true', async () => {
      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const authContext: AuthContext = {
        userId: 'user-1',
        roles: ['user'],
        permissions: ['read'],
      };

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'anonymousMethod',
        serviceInstance: testService,
        authContext,
      });

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('Role-Based Access Control (RBAC)', () => {
    beforeEach(() => {
      setupMethodMetadata(TestService, 'adminMethod', { roles: ['admin'] });
    });

    it('should deny access when user lacks required role', async () => {
      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const authContext: AuthContext = {
        userId: 'user-1',
        roles: ['user'], // Not admin
        permissions: ['read'],
      };

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'adminMethod',
        serviceInstance: testService,
        authContext,
      });

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await expect(middleware(ctx, next)).rejects.toThrow(TitanError);
      await expect(middleware(ctx, next)).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
    });

    it('should allow access when user has required role', async () => {
      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const authContext: AuthContext = {
        userId: 'admin-1',
        roles: ['admin'],
        permissions: ['read', 'write'],
      };

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'adminMethod',
        serviceInstance: testService,
        authContext,
      });

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
    });

    it('should allow access when user has any of required roles', async () => {
      setupMethodMetadata(TestService, 'multiRoleMethod', { roles: ['admin', 'moderator'] });

      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const authContext: AuthContext = {
        userId: 'mod-1',
        roles: ['moderator'], // Has moderator but not admin
        permissions: [],
      };

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'multiRoleMethod',
        serviceInstance: testService,
        authContext,
      });

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('Permission-Based Access Control', () => {
    beforeEach(() => {
      setupMethodMetadata(TestService, 'protectedMethod', {
        permissions: ['documents:read', 'documents:write'],
      });
    });

    it('should deny access when user lacks required permissions', async () => {
      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const authContext: AuthContext = {
        userId: 'user-1',
        roles: ['user'],
        permissions: ['documents:read'], // Missing documents:write
      };

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'protectedMethod',
        serviceInstance: testService,
        authContext,
      });

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await expect(middleware(ctx, next)).rejects.toThrow(TitanError);
      await expect(middleware(ctx, next)).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
    });

    it('should allow access when user has all required permissions', async () => {
      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const authContext: AuthContext = {
        userId: 'user-1',
        roles: ['user'],
        permissions: ['documents:read', 'documents:write', 'documents:delete'],
      };

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'protectedMethod',
        serviceInstance: testService,
        authContext,
      });

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('Scope-Based Access Control', () => {
    beforeEach(() => {
      setupMethodMetadata(TestService, 'scopedMethod', {
        scopes: ['api:read', 'api:write'],
      });
    });

    it('should deny access when user lacks required scopes', async () => {
      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const authContext: AuthContext = {
        userId: 'user-1',
        roles: ['user'],
        permissions: [],
        scopes: ['api:read'], // Missing api:write
      };

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'scopedMethod',
        serviceInstance: testService,
        authContext,
      });

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await expect(middleware(ctx, next)).rejects.toThrow(TitanError);
      await expect(middleware(ctx, next)).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
    });

    it('should allow access when user has all required scopes', async () => {
      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const authContext: AuthContext = {
        userId: 'user-1',
        roles: ['user'],
        permissions: [],
        scopes: ['api:read', 'api:write', 'api:delete'],
      };

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'scopedMethod',
        serviceInstance: testService,
        authContext,
      });

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('Policy Evaluation', () => {
    beforeEach(() => {
      // Register test policies
      policyEngine.registerPolicies([
        {
          name: 'allow-all',
          evaluate: () => ({ allowed: true, reason: 'Always allowed' }),
        },
        {
          name: 'deny-all',
          evaluate: () => ({ allowed: false, reason: 'Always denied' }),
        },
        {
          name: 'check-owner',
          evaluate: (ctx: ExecutionContext) => {
            const isOwner = ctx.resource?.owner === ctx.auth?.userId;
            return {
              allowed: isOwner,
              reason: isOwner ? 'User is owner' : 'User is not owner',
            };
          },
        },
        {
          name: 'check-admin',
          evaluate: (ctx: ExecutionContext) => {
            const isAdmin = ctx.auth?.roles.includes('admin');
            return {
              allowed: !!isAdmin,
              reason: isAdmin ? 'User is admin' : 'User is not admin',
            };
          },
        },
      ]);
    });

    describe('Single Policy (Array)', () => {
      beforeEach(() => {
        setupMethodMetadata(TestService, 'policyMethod', {
          policies: ['allow-all'],
        });
      });

      it('should evaluate single policy and allow access', async () => {
        const middleware = createAuthMiddleware({
          policyEngine,
          authorizationManager,
          logger: mockLogger,
        });

        const authContext: AuthContext = {
          userId: 'user-1',
          roles: ['user'],
          permissions: [],
        };

        const ctx = createMiddlewareContext({
          serviceName: 'TestService',
          methodName: 'policyMethod',
          serviceInstance: testService,
          authContext,
        });

        const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

        await middleware(ctx, next);

        expect(next).toHaveBeenCalled();
      });

      it('should deny access when policy fails', async () => {
        setupMethodMetadata(TestService, 'policyMethod', {
          policies: ['deny-all'],
        });

        const middleware = createAuthMiddleware({
          policyEngine,
          authorizationManager,
          logger: mockLogger,
        });

        const authContext: AuthContext = {
          userId: 'user-1',
          roles: ['user'],
          permissions: [],
        };

        const ctx = createMiddlewareContext({
          serviceName: 'TestService',
          methodName: 'policyMethod',
          serviceInstance: testService,
          authContext,
        });

        const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

        await expect(middleware(ctx, next)).rejects.toThrow(TitanError);
        await expect(middleware(ctx, next)).rejects.toMatchObject({
          code: ErrorCode.FORBIDDEN,
        });
      });
    });

    describe('Multiple Policies (AND Logic)', () => {
      beforeEach(() => {
        setupMethodMetadata(TestService, 'multiPolicyMethod', {
          policies: ['allow-all', 'check-admin'],
        });
      });

      it('should require all policies to pass', async () => {
        const middleware = createAuthMiddleware({
          policyEngine,
          authorizationManager,
          logger: mockLogger,
        });

        // User without admin role
        const authContext: AuthContext = {
          userId: 'user-1',
          roles: ['user'],
          permissions: [],
        };

        const ctx = createMiddlewareContext({
          serviceName: 'TestService',
          methodName: 'multiPolicyMethod',
          serviceInstance: testService,
          authContext,
        });

        const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

        await expect(middleware(ctx, next)).rejects.toThrow(TitanError);
      });

      it('should allow when all policies pass', async () => {
        const middleware = createAuthMiddleware({
          policyEngine,
          authorizationManager,
          logger: mockLogger,
        });

        const authContext: AuthContext = {
          userId: 'admin-1',
          roles: ['admin'],
          permissions: [],
        };

        const ctx = createMiddlewareContext({
          serviceName: 'TestService',
          methodName: 'multiPolicyMethod',
          serviceInstance: testService,
          authContext,
        });

        const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

        await middleware(ctx, next);

        expect(next).toHaveBeenCalled();
      });
    });

    describe('Explicit AND Policy', () => {
      beforeEach(() => {
        setupMethodMetadata(TestService, 'multiPolicyMethod', {
          policies: { all: ['allow-all', 'check-admin'] },
        });
      });

      it('should evaluate all policies with AND logic', async () => {
        const middleware = createAuthMiddleware({
          policyEngine,
          authorizationManager,
          logger: mockLogger,
        });

        const authContext: AuthContext = {
          userId: 'admin-1',
          roles: ['admin'],
          permissions: [],
        };

        const ctx = createMiddlewareContext({
          serviceName: 'TestService',
          methodName: 'multiPolicyMethod',
          serviceInstance: testService,
          authContext,
        });

        const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

        await middleware(ctx, next);

        expect(next).toHaveBeenCalled();
      });
    });

    describe('Explicit OR Policy', () => {
      beforeEach(() => {
        setupMethodMetadata(TestService, 'orPolicyMethod', {
          policies: { any: ['check-owner', 'check-admin'] },
        });
      });

      it('should allow when any policy passes (admin-based check)', async () => {
        // Note: The check-owner policy uses context.resource.owner which is not
        // directly available from middleware metadata. Instead, we test with
        // a simpler policy that can be evaluated from auth context alone.

        // Register a policy that checks for a specific user ID
        policyEngine.registerPolicy({
          name: 'check-specific-user',
          evaluate: (ctx: ExecutionContext) => {
            const isSpecificUser = ctx.auth?.userId === 'special-user';
            return {
              allowed: !!isSpecificUser,
              reason: isSpecificUser ? 'User is special user' : 'User is not special user',
            };
          },
        });

        setupMethodMetadata(TestService, 'orPolicyMethod', {
          policies: { any: ['check-specific-user', 'check-admin'] },
        });

        const middleware = createAuthMiddleware({
          policyEngine,
          authorizationManager,
          logger: mockLogger,
        });

        const authContext: AuthContext = {
          userId: 'special-user',
          roles: ['user'],
          permissions: [],
        };

        const ctx = createMiddlewareContext({
          serviceName: 'TestService',
          methodName: 'orPolicyMethod',
          serviceInstance: testService,
          authContext,
        });

        const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

        await middleware(ctx, next);

        expect(next).toHaveBeenCalled();
      });

      it('should allow when any policy passes (admin)', async () => {
        const middleware = createAuthMiddleware({
          policyEngine,
          authorizationManager,
          logger: mockLogger,
        });

        const authContext: AuthContext = {
          userId: 'admin-1',
          roles: ['admin'],
          permissions: [],
        };

        const ctx = createMiddlewareContext({
          serviceName: 'TestService',
          methodName: 'orPolicyMethod',
          serviceInstance: testService,
          authContext,
        });

        const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

        await middleware(ctx, next);

        expect(next).toHaveBeenCalled();
      });

      it('should deny when no policy passes', async () => {
        const middleware = createAuthMiddleware({
          policyEngine,
          authorizationManager,
          logger: mockLogger,
        });

        const authContext: AuthContext = {
          userId: 'user-1',
          roles: ['user'],
          permissions: [],
        };

        const ctx = createMiddlewareContext({
          serviceName: 'TestService',
          methodName: 'orPolicyMethod',
          serviceInstance: testService,
          authContext,
        });
        // No resource set - not owner

        const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

        await expect(middleware(ctx, next)).rejects.toThrow(TitanError);
      });
    });

    describe('Policy Expression (Complex)', () => {
      beforeEach(() => {
        setupMethodMetadata(TestService, 'notPolicyMethod', {
          policies: { not: 'deny-all' },
        });
      });

      it('should evaluate NOT expression', async () => {
        const middleware = createAuthMiddleware({
          policyEngine,
          authorizationManager,
          logger: mockLogger,
        });

        const authContext: AuthContext = {
          userId: 'user-1',
          roles: ['user'],
          permissions: [],
        };

        const ctx = createMiddlewareContext({
          serviceName: 'TestService',
          methodName: 'notPolicyMethod',
          serviceInstance: testService,
          authContext,
        });

        const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

        await middleware(ctx, next);

        expect(next).toHaveBeenCalled();
      });
    });
  });

  describe('Combined Access Control', () => {
    it('should require both roles/permissions AND policy to pass', async () => {
      // Set up method with both roles and policies
      setupMethodMetadata(TestService, 'protectedMethod', {
        roles: ['admin'],
        policies: ['allow-all'],
      });

      policyEngine.registerPolicy({
        name: 'allow-all',
        evaluate: () => ({ allowed: true }),
      });

      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      // User without admin role
      const authContext: AuthContext = {
        userId: 'user-1',
        roles: ['user'],
        permissions: [],
      };

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'protectedMethod',
        serviceInstance: testService,
        authContext,
      });

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      // Should fail at role check before reaching policy
      await expect(middleware(ctx, next)).rejects.toThrow(TitanError);
    });
  });

  describe('Error Handling', () => {
    it('should throw UNAUTHORIZED for missing auth when required', async () => {
      setupMethodMetadata(TestService, 'protectedMethod', {
        roles: ['user'],
      });

      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'protectedMethod',
        serviceInstance: testService,
        // No authContext
      });

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      try {
        await middleware(ctx, next);
        fail('Expected error to be thrown');
      } catch (error) {
        expect(TitanError.isTitanError(error)).toBe(true);
        expect((error as TitanError).code).toBe(ErrorCode.UNAUTHORIZED);
      }
    });

    it('should throw FORBIDDEN for access denied', async () => {
      setupMethodMetadata(TestService, 'adminMethod', {
        roles: ['admin'],
      });

      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const authContext: AuthContext = {
        userId: 'user-1',
        roles: ['user'], // Not admin
        permissions: [],
      };

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'adminMethod',
        serviceInstance: testService,
        authContext,
      });

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      try {
        await middleware(ctx, next);
        fail('Expected error to be thrown');
      } catch (error) {
        expect(TitanError.isTitanError(error)).toBe(true);
        expect((error as TitanError).code).toBe(ErrorCode.FORBIDDEN);
      }
    });

    it('should include service and method in error details', async () => {
      setupMethodMetadata(TestService, 'adminMethod', {
        roles: ['admin'],
      });

      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const authContext: AuthContext = {
        userId: 'user-1',
        roles: ['user'],
        permissions: [],
      };

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'adminMethod',
        serviceInstance: testService,
        authContext,
      });

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      try {
        await middleware(ctx, next);
        fail('Expected error to be thrown');
      } catch (error) {
        const titanError = error as TitanError;
        expect(titanError.details.service).toBe('TestService');
        expect(titanError.details.method).toBe('adminMethod');
      }
    });
  });

  describe('Auth Context Storage', () => {
    it('should store authContext in metadata after successful auth', async () => {
      setupMethodMetadata(TestService, 'protectedMethod', {
        roles: ['user'],
      });

      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const authContext: AuthContext = {
        userId: 'user-1',
        roles: ['user'],
        permissions: ['read'],
      };

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'protectedMethod',
        serviceInstance: testService,
        authContext,
      });

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      // Auth context should be stored in metadata
      const storedContext = ctx.metadata.get('authContext');
      expect(storedContext).toBeDefined();
      expect((storedContext as AuthContext).userId).toBe('user-1');
    });
  });

  describe('buildExecutionContext', () => {
    it('should build execution context from middleware context', () => {
      const authContext: AuthContext = {
        userId: 'user-1',
        roles: ['user'],
        permissions: ['read'],
      };

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'testMethod',
        serviceInstance: testService,
        authContext,
        input: ['arg1', 'arg2'],
      });
      ctx.metadata.set('transport', 'http');
      ctx.metadata.set('clientIp', '192.168.1.1');
      ctx.metadata.set('headers', { 'content-type': 'application/json' });

      const execCtx = buildExecutionContext(ctx, authContext);

      expect(execCtx.auth).toBe(authContext);
      expect(execCtx.service.name).toBe('TestService');
      expect(execCtx.method?.name).toBe('testMethod');
      expect(execCtx.method?.args).toEqual(['arg1', 'arg2']);
      expect(execCtx.environment?.transport).toBe('http');
      expect(execCtx.environment?.ip).toBe('192.168.1.1');
      expect(execCtx.request?.headers?.['content-type']).toBe('application/json');
    });

    it('should handle missing optional fields', () => {
      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: undefined,
      });

      const execCtx = buildExecutionContext(ctx);

      expect(execCtx.auth).toBeUndefined();
      expect(execCtx.service.name).toBe('TestService');
      // When methodName is undefined, method should not be set
      expect(execCtx.method).toBeUndefined();
    });

    it('should extract service version from service metadata', () => {
      // Create a service class with version metadata
      class VersionedService {
        testMethod(): void {}
      }
      Reflect.defineMetadata('netron:service', { version: '2.0.0' }, VersionedService);

      const serviceInstance = new VersionedService();
      const ctx = createMiddlewareContext({
        serviceName: 'VersionedService',
        methodName: 'testMethod',
        serviceInstance,
      });

      const execCtx = buildExecutionContext(ctx);

      expect(execCtx.service.version).toBe('2.0.0');
    });
  });

  describe('readMethodMetadata', () => {
    it('should read method options from metadata', () => {
      setupMethodMetadata(TestService, 'protectedMethod', {
        roles: ['admin'],
        permissions: ['write'],
      });

      const metadata = readMethodMetadata(testService, 'protectedMethod');

      expect(metadata).toBeDefined();
      expect(metadata?.auth).toBeDefined();
      expect((metadata?.auth as any).roles).toEqual(['admin']);
      expect((metadata?.auth as any).permissions).toEqual(['write']);
    });

    it('should return undefined for non-existent method', () => {
      const metadata = readMethodMetadata(testService, 'nonExistentMethod');

      expect(metadata).toBeUndefined();
    });

    it('should return undefined for null service instance', () => {
      const metadata = readMethodMetadata(null, 'testMethod');

      expect(metadata).toBeUndefined();
    });

    it('should return undefined for empty method name', () => {
      const metadata = readMethodMetadata(testService, '');

      expect(metadata).toBeUndefined();
    });

    it('should construct metadata from individual keys when METHOD_OPTIONS not set', () => {
      const prototype = TestService.prototype;
      const methodName = 'individualMetaMethod';

      // Set individual metadata keys without METHOD_OPTIONS
      Reflect.defineMetadata(METADATA_KEYS.METHOD_AUTH, { roles: ['user'] }, prototype, methodName);
      Reflect.defineMetadata(METADATA_KEYS.METHOD_CACHE, { ttl: 5000 }, prototype, methodName);

      const metadata = readMethodMetadata(testService, methodName);

      expect(metadata).toBeDefined();
      expect(metadata?.auth).toEqual({ roles: ['user'] });
      expect(metadata?.cache).toEqual({ ttl: 5000 });
    });
  });

  describe('Logging', () => {
    it('should log debug message when skipping service/method', async () => {
      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
        skipServices: ['SkippedService'],
      });

      const ctx = createMiddlewareContext({ serviceName: 'SkippedService' });
      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ service: 'SkippedService' }),
        expect.stringContaining('Skipping auth')
      );
    });

    it('should log warning when access validation fails', async () => {
      setupMethodMetadata(TestService, 'adminMethod', { roles: ['admin'] });

      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const authContext: AuthContext = {
        userId: 'user-1',
        roles: ['user'],
        permissions: [],
      };

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'adminMethod',
        serviceInstance: testService,
        authContext,
      });

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      try {
        await middleware(ctx, next);
      } catch {
        // Expected
      }

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'Missing required role' }),
        expect.stringContaining('Access validation failed')
      );
    });

    it('should log debug message for policy evaluation success', async () => {
      policyEngine.registerPolicy({
        name: 'test-policy',
        evaluate: () => ({ allowed: true }),
      });

      setupMethodMetadata(TestService, 'policyMethod', { policies: ['test-policy'] });

      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const authContext: AuthContext = {
        userId: 'user-1',
        roles: ['user'],
        permissions: [],
      };

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'policyMethod',
        serviceInstance: testService,
        authContext,
      });

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
        expect.stringContaining('Policy evaluation succeeded')
      );
    });
  });

  describe('Different HTTP Contexts', () => {
    it('should work with request metadata from HTTP transport', async () => {
      setupMethodMetadata(TestService, 'protectedMethod', { roles: ['user'] });

      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const authContext: AuthContext = {
        userId: 'user-1',
        roles: ['user'],
        permissions: [],
      };

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'protectedMethod',
        serviceInstance: testService,
        authContext,
      });

      // Add HTTP-specific metadata
      ctx.metadata.set('transport', 'http');
      ctx.metadata.set('method', 'POST');
      ctx.metadata.set('path', '/api/test');
      ctx.metadata.set('headers', {
        authorization: 'Bearer token123',
        'content-type': 'application/json',
        'user-agent': 'test-client/1.0',
      });
      ctx.metadata.set('clientIp', '10.0.0.1');

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
    });

    it('should work with WebSocket context metadata', async () => {
      setupMethodMetadata(TestService, 'protectedMethod', { roles: ['user'] });

      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const authContext: AuthContext = {
        userId: 'user-1',
        roles: ['user'],
        permissions: [],
      };

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'protectedMethod',
        serviceInstance: testService,
        authContext,
      });

      // Add WebSocket-specific metadata
      ctx.metadata.set('transport', 'websocket');
      ctx.metadata.set('connectionId', 'ws-conn-123');
      ctx.metadata.set('ip', '10.0.0.2');

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('Auth Context from Peer', () => {
    it('should extract auth context from peer.getAuthContext()', async () => {
      setupMethodMetadata(TestService, 'protectedMethod', { roles: ['user'] });

      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const authContext: AuthContext = {
        userId: 'user-from-peer',
        roles: ['user'],
        permissions: [],
      };

      // Create context with peer that has getAuthContext
      const ctx: NetronMiddlewareContext = {
        peer: {
          id: 'peer-1',
          getAuthContext: () => authContext,
        } as any,
        metadata: new Map([['serviceInstance', testService]]),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        serviceName: 'TestService',
        methodName: 'protectedMethod',
      };

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
    });

    it('should fallback to metadata.authContext when peer has no getAuthContext', async () => {
      setupMethodMetadata(TestService, 'protectedMethod', { roles: ['user'] });

      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const authContext: AuthContext = {
        userId: 'user-from-metadata',
        roles: ['user'],
        permissions: [],
      };

      // Create context with peer without getAuthContext
      const ctx: NetronMiddlewareContext = {
        peer: { id: 'peer-1' } as any,
        metadata: new Map([
          ['serviceInstance', testService],
          ['authContext', authContext],
        ]),
        timing: { start: Date.now(), middlewareTimes: new Map() },
        serviceName: 'TestService',
        methodName: 'protectedMethod',
      };

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty roles array in config', async () => {
      setupMethodMetadata(TestService, 'protectedMethod', { roles: [] });

      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const authContext: AuthContext = {
        userId: 'user-1',
        roles: [],
        permissions: [],
      };

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'protectedMethod',
        serviceInstance: testService,
        authContext,
      });

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      // Empty roles should pass (no requirement)
      expect(next).toHaveBeenCalled();
    });

    it('should handle undefined permissions in config', async () => {
      setupMethodMetadata(TestService, 'protectedMethod', { roles: ['user'] });

      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const authContext: AuthContext = {
        userId: 'user-1',
        roles: ['user'],
        permissions: [],
      };

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'protectedMethod',
        serviceInstance: testService,
        authContext,
      });

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      expect(next).toHaveBeenCalled();
    });

    it('should handle non-object service instance in metadata', async () => {
      const middleware = createAuthMiddleware({
        policyEngine,
        authorizationManager,
        logger: mockLogger,
      });

      const ctx = createMiddlewareContext({
        serviceName: 'TestService',
        methodName: 'testMethod',
      });
      ctx.metadata.set('serviceInstance', 'not-an-object');

      const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      await middleware(ctx, next);

      // Should skip when service instance is not an object
      expect(next).toHaveBeenCalled();
    });
  });
});
