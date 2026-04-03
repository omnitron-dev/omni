/**
 * Tests for Auth Middleware
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createAuthMiddleware,
  buildExecutionContext,
  readMethodMetadata,
  type AuthMiddlewareOptions,
} from '../../../src/netron/transport/http/middleware/auth.js';
import { PolicyEngine } from '../../../src/netron/auth/policy-engine.js';
import { AuthorizationManager } from '../../../src/netron/auth/authorization-manager.js';
import type { NetronMiddlewareContext } from '../../../src/netron/transport/http/middleware/types.js';
import type { AuthContext } from '../../../src/netron/auth/types.js';
import type { MethodOptions } from '../../../src/decorators/types.js';
import { METADATA_KEYS } from '../../../src/decorators/core.js';
import { ErrorCode } from '../../../src/errors/index.js';
import 'reflect-metadata';

describe('Auth Middleware', () => {
  let mockLogger: any;
  let mockPolicyEngine: any;
  let mockAuthorizationManager: AuthorizationManager;
  let mockContext: NetronMiddlewareContext;
  let authContext: AuthContext;

  beforeEach(() => {
    mockLogger = {
      child: vi.fn().mockReturnThis(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    authContext = {
      userId: 'user123',
      roles: ['user'],
      permissions: ['read:documents'],
      scopes: ['read:documents'],
    };

    mockPolicyEngine = {
      evaluateAll: vi.fn().mockResolvedValue({ allowed: true }),
      evaluateAny: vi.fn().mockResolvedValue({ allowed: true }),
      evaluateExpression: vi.fn().mockResolvedValue({ allowed: true }),
    } as unknown as PolicyEngine;

    // Create real AuthorizationManager for accurate validation
    mockAuthorizationManager = new AuthorizationManager(mockLogger);

    mockContext = {
      peer: {
        getAuthContext: vi.fn().mockReturnValue(authContext),
      } as any,
      serviceName: 'testService',
      methodName: 'testMethod',
      metadata: new Map([
        ['serviceInstance', {}],
        ['transport', 'ws'],
        ['clientIp', '192.168.1.1'],
      ]),
      timing: {
        start: Date.now(),
        middlewareTimes: new Map(),
      },
    };
  });

  describe('buildExecutionContext', () => {
    it('should build execution context from middleware context', () => {
      const execCtx = buildExecutionContext(mockContext, authContext);

      expect(execCtx.auth).toBe(authContext);
      expect(execCtx.service.name).toBe('testService');
      expect(execCtx.method?.name).toBe('testMethod');
      expect(execCtx.environment?.transport).toBe('ws');
      expect(execCtx.environment?.ip).toBe('192.168.1.1');
    });

    it('should handle missing auth context', () => {
      const execCtx = buildExecutionContext(mockContext);

      expect(execCtx.auth).toBeUndefined();
      expect(execCtx.service.name).toBe('testService');
    });

    it('should extract method args from input', () => {
      mockContext.input = ['arg1', 'arg2'];

      const execCtx = buildExecutionContext(mockContext, authContext);

      expect(execCtx.method?.args).toEqual(['arg1', 'arg2']);
    });
  });

  describe('readMethodMetadata', () => {
    it('should read METHOD_OPTIONS metadata', () => {
      const options: MethodOptions = {
        auth: {
          roles: ['admin'],
        },
      };

      class TestService {
        testMethod() {}
      }

      Reflect.defineMetadata(METADATA_KEYS.METHOD_OPTIONS, options, TestService.prototype, 'testMethod');

      const result = readMethodMetadata(new TestService(), 'testMethod');

      expect(result).toEqual(options);
    });

    it('should fallback to individual metadata keys', () => {
      class TestService {
        testMethod() {}
      }

      Reflect.defineMetadata(METADATA_KEYS.METHOD_AUTH, { roles: ['user'] }, TestService.prototype, 'testMethod');

      const result = readMethodMetadata(new TestService(), 'testMethod');

      expect(result?.auth).toEqual({ roles: ['user'] });
    });

    it('should return undefined when no metadata exists', () => {
      class TestService {
        testMethod() {}
      }

      const result = readMethodMetadata(new TestService(), 'testMethod');

      expect(result).toBeUndefined();
    });
  });

  describe('createAuthMiddleware', () => {
    let middleware: ReturnType<typeof createAuthMiddleware>;
    let next: vi.Mock;

    beforeEach(() => {
      const options: AuthMiddlewareOptions = {
        policyEngine: mockPolicyEngine,
        authorizationManager: mockAuthorizationManager,
        logger: mockLogger,
      };

      middleware = createAuthMiddleware(options);
      next = vi.fn();
    });

    it('should skip auth when no service/method specified', async () => {
      mockContext.serviceName = undefined;

      await middleware(mockContext, next);

      expect(next).toHaveBeenCalled();
    });

    it('should skip auth when service is in skip list', async () => {
      const options: AuthMiddlewareOptions = {
        policyEngine: mockPolicyEngine,
        authorizationManager: mockAuthorizationManager,
        logger: mockLogger,
        skipServices: ['testService'],
      };

      middleware = createAuthMiddleware(options);

      await middleware(mockContext, next);

      expect(next).toHaveBeenCalled();
    });

    it('should skip auth when no service instance in context', async () => {
      mockContext.metadata?.delete('serviceInstance');

      await middleware(mockContext, next);

      expect(next).toHaveBeenCalled();
    });

    it('should skip auth when no auth metadata on method', async () => {
      class TestService {
        testMethod() {}
      }

      mockContext.metadata?.set('serviceInstance', new TestService());

      await middleware(mockContext, next);

      expect(next).toHaveBeenCalled();
    });

    it('should require authentication when auth: true', async () => {
      class TestService {
        testMethod() {}
      }

      Reflect.defineMetadata(METADATA_KEYS.METHOD_AUTH, true, TestService.prototype, 'testMethod');

      mockContext.metadata?.set('serviceInstance', new TestService());
      (mockContext.peer as any).getAuthContext = vi.fn().mockReturnValue(undefined);

      await expect(middleware(mockContext, next)).rejects.toThrow('Authentication required');
    });

    it('should pass when auth: true and user is authenticated', async () => {
      class TestService {
        testMethod() {}
      }

      Reflect.defineMetadata(METADATA_KEYS.METHOD_AUTH, true, TestService.prototype, 'testMethod');

      mockContext.metadata?.set('serviceInstance', new TestService());

      await middleware(mockContext, next);

      expect(next).toHaveBeenCalled();
    });

    it('should allow anonymous access when configured', async () => {
      class TestService {
        testMethod() {}
      }

      Reflect.defineMetadata(METADATA_KEYS.METHOD_AUTH, { allowAnonymous: true }, TestService.prototype, 'testMethod');

      mockContext.metadata?.set('serviceInstance', new TestService());
      (mockContext.peer as any).getAuthContext = vi.fn().mockReturnValue(undefined);

      await middleware(mockContext, next);

      expect(next).toHaveBeenCalled();
    });

    it('should check roles and pass when user has required role', async () => {
      class TestService {
        testMethod() {}
      }

      Reflect.defineMetadata(METADATA_KEYS.METHOD_AUTH, { roles: ['user'] }, TestService.prototype, 'testMethod');

      mockContext.metadata?.set('serviceInstance', new TestService());

      await middleware(mockContext, next);

      expect(next).toHaveBeenCalled();
    });

    it('should check roles and fail when user lacks required role', async () => {
      class TestService {
        testMethod() {}
      }

      Reflect.defineMetadata(METADATA_KEYS.METHOD_AUTH, { roles: ['admin'] }, TestService.prototype, 'testMethod');

      mockContext.metadata?.set('serviceInstance', new TestService());

      await expect(middleware(mockContext, next)).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
    });

    it('should check permissions and pass when user has all permissions', async () => {
      class TestService {
        testMethod() {}
      }

      Reflect.defineMetadata(
        METADATA_KEYS.METHOD_AUTH,
        { permissions: ['read:documents'] },
        TestService.prototype,
        'testMethod'
      );

      mockContext.metadata?.set('serviceInstance', new TestService());

      await middleware(mockContext, next);

      expect(next).toHaveBeenCalled();
    });

    it('should check permissions and fail when user lacks permissions', async () => {
      class TestService {
        testMethod() {}
      }

      Reflect.defineMetadata(
        METADATA_KEYS.METHOD_AUTH,
        { permissions: ['write:documents', 'delete:documents'] },
        TestService.prototype,
        'testMethod'
      );

      mockContext.metadata?.set('serviceInstance', new TestService());

      await expect(middleware(mockContext, next)).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
    });

    it('should check OAuth2 scopes and pass when user has all scopes', async () => {
      class TestService {
        testMethod() {}
      }

      Reflect.defineMetadata(
        METADATA_KEYS.METHOD_AUTH,
        { scopes: ['read:documents'] },
        TestService.prototype,
        'testMethod'
      );

      mockContext.metadata?.set('serviceInstance', new TestService());

      await middleware(mockContext, next);

      expect(next).toHaveBeenCalled();
    });

    it('should check OAuth2 scopes and fail when user lacks scopes', async () => {
      class TestService {
        testMethod() {}
      }

      Reflect.defineMetadata(
        METADATA_KEYS.METHOD_AUTH,
        { scopes: ['write:documents'] },
        TestService.prototype,
        'testMethod'
      );

      mockContext.metadata?.set('serviceInstance', new TestService());

      await expect(middleware(mockContext, next)).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
    });

    it('should evaluate policies array (AND logic)', async () => {
      class TestService {
        testMethod() {}
      }

      Reflect.defineMetadata(
        METADATA_KEYS.METHOD_AUTH,
        { policies: ['policy1', 'policy2'] },
        TestService.prototype,
        'testMethod'
      );

      mockContext.metadata?.set('serviceInstance', new TestService());

      await middleware(mockContext, next);

      expect(mockPolicyEngine.evaluateAll).toHaveBeenCalledWith(['policy1', 'policy2'], expect.any(Object));
      expect(next).toHaveBeenCalled();
    });

    it('should evaluate policies with explicit all (AND logic)', async () => {
      class TestService {
        testMethod() {}
      }

      Reflect.defineMetadata(
        METADATA_KEYS.METHOD_AUTH,
        { policies: { all: ['policy1', 'policy2'] } },
        TestService.prototype,
        'testMethod'
      );

      mockContext.metadata?.set('serviceInstance', new TestService());

      await middleware(mockContext, next);

      expect(mockPolicyEngine.evaluateAll).toHaveBeenCalledWith(['policy1', 'policy2'], expect.any(Object));
      expect(next).toHaveBeenCalled();
    });

    it('should evaluate policies with any (OR logic)', async () => {
      class TestService {
        testMethod() {}
      }

      Reflect.defineMetadata(
        METADATA_KEYS.METHOD_AUTH,
        { policies: { any: ['resource:owner', 'role:admin'] } },
        TestService.prototype,
        'testMethod'
      );

      mockContext.metadata?.set('serviceInstance', new TestService());

      await middleware(mockContext, next);

      expect(mockPolicyEngine.evaluateAny).toHaveBeenCalledWith(['resource:owner', 'role:admin'], expect.any(Object));
      expect(next).toHaveBeenCalled();
    });

    it('should evaluate complex policy expressions', async () => {
      class TestService {
        testMethod() {}
      }

      const expression = {
        and: ['policy1', { or: ['policy2', 'policy3'] }],
      };

      Reflect.defineMetadata(METADATA_KEYS.METHOD_AUTH, { policies: expression }, TestService.prototype, 'testMethod');

      mockContext.metadata?.set('serviceInstance', new TestService());

      await middleware(mockContext, next);

      expect(mockPolicyEngine.evaluateExpression).toHaveBeenCalledWith(expression, expect.any(Object));
      expect(next).toHaveBeenCalled();
    });

    it('should fail when policy evaluation fails', async () => {
      class TestService {
        testMethod() {}
      }

      Reflect.defineMetadata(METADATA_KEYS.METHOD_AUTH, { policies: ['policy1'] }, TestService.prototype, 'testMethod');

      mockContext.metadata?.set('serviceInstance', new TestService());
      mockPolicyEngine.evaluateAll.mockResolvedValue({
        allowed: false,
        reason: 'Policy denied',
      });

      await expect(middleware(mockContext, next)).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        message: 'Policy denied',
      });
    });

    it('should combine roles, permissions, scopes, and policies', async () => {
      class TestService {
        testMethod() {}
      }

      Reflect.defineMetadata(
        METADATA_KEYS.METHOD_AUTH,
        {
          roles: ['user'],
          permissions: ['read:documents'],
          scopes: ['read:documents'],
          policies: ['policy1'],
        },
        TestService.prototype,
        'testMethod'
      );

      mockContext.metadata?.set('serviceInstance', new TestService());

      await middleware(mockContext, next);

      expect(mockPolicyEngine.evaluateAll).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('should handle missing auth context for non-anonymous methods', async () => {
      class TestService {
        testMethod() {}
      }

      Reflect.defineMetadata(METADATA_KEYS.METHOD_AUTH, { roles: ['user'] }, TestService.prototype, 'testMethod');

      mockContext.metadata?.set('serviceInstance', new TestService());
      (mockContext.peer as any).getAuthContext = vi.fn().mockReturnValue(undefined);

      await expect(middleware(mockContext, next)).rejects.toMatchObject({
        code: ErrorCode.UNAUTHORIZED,
      });
    });
  });
});
