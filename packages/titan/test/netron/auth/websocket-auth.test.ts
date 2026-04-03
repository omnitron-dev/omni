/**
 * Comprehensive integration tests for WebSocket Authentication Handler
 *
 * Tests the WebSocketAuthHandler class with real implementations of:
 * - AuthenticationManager
 * - AuthorizationManager
 * - PolicyEngine
 *
 * Only the logger is mocked to prevent noisy output.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { WebSocketAuthHandler, createWebSocketAuthHandler } from '../../../src/netron/transport/websocket/auth.js';
import { AuthenticationManager } from '../../../src/netron/auth/authentication-manager.js';
import { AuthorizationManager } from '../../../src/netron/auth/authorization-manager.js';
import { PolicyEngine } from '../../../src/netron/auth/policy-engine.js';
import { Public, Service } from '../../../src/decorators/core.js';
import type { AuthContext, ExecutionContext } from '../../../src/netron/auth/types.js';
import type { ILogger, LogLevel } from '../../../src/types/logger.js';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Mock logger implementing ILogger interface
 * Captures log calls for assertion if needed
 */
function createMockLogger(): ILogger & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {
    trace: [],
    debug: [],
    info: [],
    warn: [],
    error: [],
    fatal: [],
  };

  const noop = () => {};
  let currentLevel: LogLevel = 'debug';

  const logger: ILogger & { calls: Record<string, unknown[][]> } = {
    calls,
    trace: (...args: unknown[]) => {
      calls.trace.push(args);
    },
    debug: (...args: unknown[]) => {
      calls.debug.push(args);
    },
    info: (...args: unknown[]) => {
      calls.info.push(args);
    },
    warn: (...args: unknown[]) => {
      calls.warn.push(args);
    },
    error: (...args: unknown[]) => {
      calls.error.push(args);
    },
    fatal: (...args: unknown[]) => {
      calls.fatal.push(args);
    },
    child: () => logger,
    time: () => noop,
    isLevelEnabled: (level: LogLevel) => {
      const levels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
      return levels.indexOf(level) >= levels.indexOf(currentLevel);
    },
    setLevel: (level: LogLevel) => {
      currentLevel = level;
    },
    getLevel: () => currentLevel,
  };

  return logger;
}

/**
 * Create a mock IncomingMessage for WebSocket upgrade requests
 */
function createMockRequest(options: {
  authorization?: string;
  customHeader?: { name: string; value: string };
  url?: string;
}): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);

  req.headers = {};

  if (options.authorization) {
    req.headers['authorization'] = options.authorization;
  }

  if (options.customHeader) {
    req.headers[options.customHeader.name.toLowerCase()] = options.customHeader.value;
  }

  req.url = options.url || '/ws';

  return req;
}

/**
 * Create test AuthContext
 */
function createAuthContext(overrides?: Partial<AuthContext>): AuthContext {
  return {
    userId: 'test-user-123',
    roles: ['user'],
    permissions: ['read:documents'],
    scopes: ['api:read'],
    ...overrides,
  };
}

/**
 * Create a test service class with @Public decorated methods
 */
@Service('TestService@1.0.0')
class TestService {
  @Public()
  publicMethod(): string {
    return 'public';
  }

  @Public({ auth: true })
  authenticatedMethod(): string {
    return 'authenticated';
  }

  @Public({ auth: { roles: ['admin'] } })
  adminOnlyMethod(): string {
    return 'admin only';
  }

  @Public({ auth: { permissions: ['write:documents'] } })
  writePermissionMethod(): string {
    return 'write permission';
  }

  @Public({ auth: { scopes: ['api:write'] } })
  writeScopeMethod(): string {
    return 'write scope';
  }

  @Public({
    auth: {
      roles: ['user'],
      permissions: ['read:documents'],
      scopes: ['api:read'],
    },
  })
  combinedAuthMethod(): string {
    return 'combined auth';
  }

  @Public({ auth: { allowAnonymous: true } })
  anonymousAllowedMethod(): string {
    return 'anonymous allowed';
  }

  @Public({ auth: { policies: ['canAccessResource'] } })
  policyProtectedMethod(): string {
    return 'policy protected';
  }

  @Public({ auth: { policies: { all: ['isOwner', 'isActive'] } } })
  allPoliciesMethod(): string {
    return 'all policies';
  }

  @Public({ auth: { policies: { any: ['isAdmin', 'isOwner'] } } })
  anyPolicyMethod(): string {
    return 'any policy';
  }

  @Public({ auth: { policies: { and: ['policy1', { or: ['policy2', 'policy3'] }] } } })
  expressionPolicyMethod(): string {
    return 'expression policy';
  }

  privateMethod(): string {
    return 'private';
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('WebSocketAuthHandler', () => {
  let mockLogger: ILogger & { calls: Record<string, unknown[][]> };
  let authManager: AuthenticationManager;
  let authzManager: AuthorizationManager;
  let policyEngine: PolicyEngine;
  let testService: TestService;

  beforeEach(() => {
    mockLogger = createMockLogger();
    authManager = new AuthenticationManager(mockLogger);
    authzManager = new AuthorizationManager(mockLogger);
    policyEngine = new PolicyEngine(mockLogger);
    testService = new TestService();
  });

  afterEach(() => {
    // Clean up
    authzManager.clearACLs();
    policyEngine.clearCache();
  });

  describe('createWebSocketAuthHandler factory function', () => {
    it('should create a WebSocketAuthHandler instance', () => {
      const handler = createWebSocketAuthHandler(authManager, authzManager);

      expect(handler).toBeInstanceOf(WebSocketAuthHandler);
    });

    it('should create handler with all options', () => {
      const handler = createWebSocketAuthHandler(authManager, authzManager, {
        policyEngine,
        logger: mockLogger,
        allowAnonymous: true,
        authHeaderName: 'X-Custom-Auth',
      });

      expect(handler).toBeInstanceOf(WebSocketAuthHandler);
    });

    it('should pass options correctly to handler', async () => {
      const handler = createWebSocketAuthHandler(authManager, authzManager, {
        allowAnonymous: true,
      });

      // Test anonymous access is allowed
      const request = createMockRequest({});
      const result = await handler.authenticateConnection(request);

      expect(result.success).toBe(true);
    });
  });

  describe('authenticateConnection', () => {
    describe('token extraction', () => {
      it('should extract Bearer token from authorization header', async () => {
        const validToken = 'valid-jwt-token-12345';
        const authContext = createAuthContext();

        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn().mockResolvedValue(authContext),
        });

        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          logger: mockLogger,
        });

        const request = createMockRequest({
          authorization: `Bearer ${validToken}`,
        });

        const result = await handler.authenticateConnection(request);

        expect(result.success).toBe(true);
        expect(result.context).toEqual(authContext);
      });

      it('should use custom auth header name when configured', async () => {
        const validToken = 'custom-token-xyz';
        const authContext = createAuthContext();

        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn().mockResolvedValue(authContext),
        });

        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          logger: mockLogger,
          authHeaderName: 'X-Custom-Token',
        });

        const request = createMockRequest({
          customHeader: { name: 'X-Custom-Token', value: `Bearer ${validToken}` },
        });

        const result = await handler.authenticateConnection(request);

        expect(result.success).toBe(true);
        expect(result.context).toEqual(authContext);
      });

      it('should fail when no authorization header is provided', async () => {
        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          logger: mockLogger,
        });

        const request = createMockRequest({});

        const result = await handler.authenticateConnection(request);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Authorization required');
      });

      it('should fail for non-Bearer token format', async () => {
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn(),
        });

        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          logger: mockLogger,
        });

        const request = createMockRequest({
          authorization: 'Basic dXNlcjpwYXNz',
        });

        const result = await handler.authenticateConnection(request);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Authorization required');
      });

      it('should fail for malformed Bearer header', async () => {
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn(),
        });

        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          logger: mockLogger,
        });

        const request = createMockRequest({
          authorization: 'Bearer',
        });

        const result = await handler.authenticateConnection(request);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Authorization required');
      });
    });

    describe('anonymous connections', () => {
      it('should allow anonymous connections when allowAnonymous is true', async () => {
        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          logger: mockLogger,
          allowAnonymous: true,
        });

        const request = createMockRequest({});

        const result = await handler.authenticateConnection(request);

        expect(result.success).toBe(true);
        expect(result.context).toBeUndefined();
      });

      it('should reject anonymous connections when allowAnonymous is false (default)', async () => {
        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          logger: mockLogger,
        });

        const request = createMockRequest({});

        const result = await handler.authenticateConnection(request);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Authorization required');
      });
    });

    describe('authentication flow', () => {
      it('should successfully authenticate valid token', async () => {
        const authContext = createAuthContext({
          userId: 'authenticated-user',
          roles: ['admin', 'user'],
          permissions: ['read', 'write'],
        });

        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn().mockResolvedValue(authContext),
        });

        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          logger: mockLogger,
        });

        const request = createMockRequest({
          authorization: 'Bearer valid-token',
        });

        const result = await handler.authenticateConnection(request);

        expect(result.success).toBe(true);
        expect(result.context).toEqual(authContext);
        expect(result.context?.userId).toBe('authenticated-user');
        expect(result.context?.roles).toContain('admin');
      });

      it('should fail authentication for invalid token', async () => {
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn().mockRejectedValue(new Error('Token expired')),
        });

        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          logger: mockLogger,
        });

        const request = createMockRequest({
          authorization: 'Bearer expired-token',
        });

        const result = await handler.authenticateConnection(request);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Token expired');
      });

      it('should handle authentication manager returning unsuccessful result', async () => {
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn().mockResolvedValue(null),
        });

        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          logger: mockLogger,
        });

        const request = createMockRequest({
          authorization: 'Bearer token-with-no-context',
        });

        const result = await handler.authenticateConnection(request);

        // AuthenticationManager returns {success: false} when context is null
        expect(result.success).toBe(false);
      });
    });

    describe('error handling', () => {
      it('should handle unexpected errors during authentication', async () => {
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn().mockImplementation(() => {
            throw new Error('Unexpected internal error');
          }),
        });

        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          logger: mockLogger,
        });

        const request = createMockRequest({
          authorization: 'Bearer valid-token',
        });

        const result = await handler.authenticateConnection(request);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Unexpected internal error');
      });

      it('should handle non-Error exceptions', async () => {
        authManager.configure({
          authenticate: vi.fn(),
          validateToken: vi.fn().mockImplementation(() => {
            throw 'String error';
          }),
        });

        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          logger: mockLogger,
        });

        const request = createMockRequest({
          authorization: 'Bearer valid-token',
        });

        const result = await handler.authenticateConnection(request);

        expect(result.success).toBe(false);
        // AuthenticationManager returns "Token validation failed" for non-Error exceptions
        expect(result.error).toBe('Token validation failed');
      });
    });
  });

  describe('canAccessMethod', () => {
    it('should allow access when no ACL is defined', () => {
      const handler = new WebSocketAuthHandler({
        authenticationManager: authManager,
        authorizationManager: authzManager,
        logger: mockLogger,
      });

      const authContext = createAuthContext();
      const canAccess = handler.canAccessMethod(authContext, 'TestService', 'someMethod');

      expect(canAccess).toBe(true);
    });

    it('should allow access for authenticated user with correct roles', () => {
      authzManager.registerACL({
        service: 'TestService',
        allowedRoles: ['user', 'admin'],
      });

      const handler = new WebSocketAuthHandler({
        authenticationManager: authManager,
        authorizationManager: authzManager,
        logger: mockLogger,
      });

      const authContext = createAuthContext({ roles: ['user'] });
      const canAccess = handler.canAccessMethod(authContext, 'TestService', 'someMethod');

      expect(canAccess).toBe(true);
    });

    it('should deny access for user without required roles', () => {
      authzManager.registerACL({
        service: 'TestService',
        allowedRoles: ['admin'],
      });

      const handler = new WebSocketAuthHandler({
        authenticationManager: authManager,
        authorizationManager: authzManager,
        logger: mockLogger,
      });

      const authContext = createAuthContext({ roles: ['user'] });
      const canAccess = handler.canAccessMethod(authContext, 'TestService', 'someMethod');

      expect(canAccess).toBe(false);
    });

    it('should deny access for anonymous user when ACL exists', () => {
      authzManager.registerACL({
        service: 'TestService',
        allowedRoles: ['user'],
      });

      const handler = new WebSocketAuthHandler({
        authenticationManager: authManager,
        authorizationManager: authzManager,
        logger: mockLogger,
      });

      const canAccess = handler.canAccessMethod(undefined, 'TestService', 'someMethod');

      expect(canAccess).toBe(false);
    });

    it('should allow anonymous access when allowAnonymous is true and no ACL', () => {
      const handler = new WebSocketAuthHandler({
        authenticationManager: authManager,
        authorizationManager: authzManager,
        logger: mockLogger,
        allowAnonymous: true,
      });

      const canAccess = handler.canAccessMethod(undefined, 'TestService', 'someMethod');

      expect(canAccess).toBe(true);
    });

    it('should respect method-level ACL overrides', () => {
      authzManager.registerACL({
        service: 'TestService',
        allowedRoles: ['user'],
        methods: {
          adminMethod: {
            allowedRoles: ['admin'],
            __override: true,
          },
        },
      });

      const handler = new WebSocketAuthHandler({
        authenticationManager: authManager,
        authorizationManager: authzManager,
        logger: mockLogger,
      });

      const userContext = createAuthContext({ roles: ['user'] });
      const adminContext = createAuthContext({ roles: ['admin'] });

      // Regular method - user role sufficient
      expect(handler.canAccessMethod(userContext, 'TestService', 'regularMethod')).toBe(true);

      // Admin method - user role not sufficient
      expect(handler.canAccessMethod(userContext, 'TestService', 'adminMethod')).toBe(false);

      // Admin method - admin role works
      expect(handler.canAccessMethod(adminContext, 'TestService', 'adminMethod')).toBe(true);
    });

    it('should grant access to superadmin regardless of ACL', () => {
      authzManager.registerACL({
        service: 'TestService',
        allowedRoles: ['admin'],
        requiredPermissions: ['special:permission'],
      });

      const handler = new WebSocketAuthHandler({
        authenticationManager: authManager,
        authorizationManager: authzManager,
        logger: mockLogger,
      });

      const superAdminContext = createAuthContext({
        roles: ['superadmin'],
        permissions: [],
      });

      const canAccess = handler.canAccessMethod(superAdminContext, 'TestService', 'anyMethod');

      expect(canAccess).toBe(true);
    });
  });

  describe('validateAccess', () => {
    it('should allow access when all requirements are met', () => {
      const handler = new WebSocketAuthHandler({
        authenticationManager: authManager,
        authorizationManager: authzManager,
        logger: mockLogger,
      });

      const authContext = createAuthContext({
        roles: ['admin', 'user'],
        permissions: ['read:documents', 'write:documents'],
        scopes: ['api:read', 'api:write'],
      });

      const result = handler.validateAccess(authContext, {
        roles: ['admin'],
        permissions: ['read:documents'],
        scopes: ['api:read'],
      });

      expect(result.allowed).toBe(true);
    });

    it('should deny access when role requirement is not met', () => {
      const handler = new WebSocketAuthHandler({
        authenticationManager: authManager,
        authorizationManager: authzManager,
        logger: mockLogger,
      });

      const authContext = createAuthContext({
        roles: ['user'],
        permissions: ['read:documents'],
        scopes: ['api:read'],
      });

      const result = handler.validateAccess(authContext, {
        roles: ['admin'],
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Missing required role');
      expect(result.details?.missingRoles).toContain('admin');
    });

    it('should deny access when permission requirement is not met', () => {
      const handler = new WebSocketAuthHandler({
        authenticationManager: authManager,
        authorizationManager: authzManager,
        logger: mockLogger,
      });

      const authContext = createAuthContext({
        roles: ['user'],
        permissions: ['read:documents'],
        scopes: ['api:read'],
      });

      const result = handler.validateAccess(authContext, {
        permissions: ['write:documents'],
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Missing required permissions');
      expect(result.details?.missingPermissions).toContain('write:documents');
    });

    it('should deny access when scope requirement is not met', () => {
      const handler = new WebSocketAuthHandler({
        authenticationManager: authManager,
        authorizationManager: authzManager,
        logger: mockLogger,
      });

      const authContext = createAuthContext({
        roles: ['user'],
        permissions: ['read:documents'],
        scopes: ['api:read'],
      });

      const result = handler.validateAccess(authContext, {
        scopes: ['api:write'],
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Missing required scopes');
      expect(result.details?.missingScopes).toContain('api:write');
    });

    it('should require authentication when no auth context and anonymous not allowed', () => {
      const handler = new WebSocketAuthHandler({
        authenticationManager: authManager,
        authorizationManager: authzManager,
        logger: mockLogger,
        allowAnonymous: false,
      });

      const result = handler.validateAccess(undefined, {
        roles: ['user'],
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Authentication required');
    });

    it('should allow anonymous access when allowAnonymous is true', () => {
      const handler = new WebSocketAuthHandler({
        authenticationManager: authManager,
        authorizationManager: authzManager,
        logger: mockLogger,
        allowAnonymous: true,
      });

      const result = handler.validateAccess(undefined, {});

      expect(result.allowed).toBe(true);
    });
  });

  describe('authorizeMessage', () => {
    describe('decorator-based authorization', () => {
      it('should allow access to method without auth config', async () => {
        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          logger: mockLogger,
        });

        const result = await handler.authorizeMessage(createAuthContext(), 'TestService', 'publicMethod', testService);

        expect(result.allowed).toBe(true);
      });

      it('should require auth for method with auth: true', async () => {
        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          logger: mockLogger,
        });

        // With auth context
        const result1 = await handler.authorizeMessage(
          createAuthContext(),
          'TestService',
          'authenticatedMethod',
          testService
        );
        expect(result1.allowed).toBe(true);

        // Without auth context
        const result2 = await handler.authorizeMessage(undefined, 'TestService', 'authenticatedMethod', testService);
        expect(result2.allowed).toBe(false);
        expect(result2.reason).toBe('Authentication required');
      });

      it('should check role requirements from decorator', async () => {
        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          logger: mockLogger,
        });

        // User without admin role
        const result1 = await handler.authorizeMessage(
          createAuthContext({ roles: ['user'] }),
          'TestService',
          'adminOnlyMethod',
          testService
        );
        expect(result1.allowed).toBe(false);
        expect(result1.reason).toBe('Missing required role');

        // User with admin role
        const result2 = await handler.authorizeMessage(
          createAuthContext({ roles: ['admin'] }),
          'TestService',
          'adminOnlyMethod',
          testService
        );
        expect(result2.allowed).toBe(true);
      });

      it('should check permission requirements from decorator', async () => {
        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          logger: mockLogger,
        });

        // User without write permission
        const result1 = await handler.authorizeMessage(
          createAuthContext({ permissions: ['read:documents'] }),
          'TestService',
          'writePermissionMethod',
          testService
        );
        expect(result1.allowed).toBe(false);
        expect(result1.reason).toBe('Missing required permissions');

        // User with write permission
        const result2 = await handler.authorizeMessage(
          createAuthContext({ permissions: ['write:documents'] }),
          'TestService',
          'writePermissionMethod',
          testService
        );
        expect(result2.allowed).toBe(true);
      });

      it('should check scope requirements from decorator', async () => {
        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          logger: mockLogger,
        });

        // User without write scope
        const result1 = await handler.authorizeMessage(
          createAuthContext({ scopes: ['api:read'] }),
          'TestService',
          'writeScopeMethod',
          testService
        );
        expect(result1.allowed).toBe(false);
        expect(result1.reason).toBe('Missing required scopes');

        // User with write scope
        const result2 = await handler.authorizeMessage(
          createAuthContext({ scopes: ['api:write'] }),
          'TestService',
          'writeScopeMethod',
          testService
        );
        expect(result2.allowed).toBe(true);
      });

      it('should check combined auth requirements', async () => {
        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          logger: mockLogger,
        });

        // User meeting all requirements
        const result1 = await handler.authorizeMessage(
          createAuthContext({
            roles: ['user'],
            permissions: ['read:documents'],
            scopes: ['api:read'],
          }),
          'TestService',
          'combinedAuthMethod',
          testService
        );
        expect(result1.allowed).toBe(true);

        // User missing role
        const result2 = await handler.authorizeMessage(
          createAuthContext({
            roles: ['guest'],
            permissions: ['read:documents'],
            scopes: ['api:read'],
          }),
          'TestService',
          'combinedAuthMethod',
          testService
        );
        expect(result2.allowed).toBe(false);
      });

      it('should allow anonymous when decorator specifies allowAnonymous', async () => {
        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          logger: mockLogger,
        });

        const result = await handler.authorizeMessage(undefined, 'TestService', 'anonymousAllowedMethod', testService);

        expect(result.allowed).toBe(true);
      });
    });

    describe('policy evaluation', () => {
      it('should evaluate array of policies (AND logic)', async () => {
        policyEngine.registerPolicy({
          name: 'canAccessResource',
          evaluate: async (ctx: ExecutionContext) => ({
            allowed: ctx.auth?.roles.includes('user') ?? false,
          }),
        });

        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          policyEngine,
          logger: mockLogger,
        });

        // User with correct role
        const result1 = await handler.authorizeMessage(
          createAuthContext({ roles: ['user'] }),
          'TestService',
          'policyProtectedMethod',
          testService
        );
        expect(result1.allowed).toBe(true);

        // Clear cache before testing with different user context
        // PolicyEngine caches successful evaluations
        policyEngine.clearCache();

        // User without correct role
        const result2 = await handler.authorizeMessage(
          createAuthContext({ roles: ['guest'] }),
          'TestService',
          'policyProtectedMethod',
          testService
        );
        expect(result2.allowed).toBe(false);
      });

      it('should evaluate policies with { all: [...] } (explicit AND)', async () => {
        policyEngine.registerPolicy({
          name: 'isOwner',
          evaluate: async (ctx: ExecutionContext) => ({
            allowed: ctx.auth?.userId === 'owner-123',
          }),
        });

        policyEngine.registerPolicy({
          name: 'isActive',
          evaluate: async (ctx: ExecutionContext) => ({
            allowed: ctx.auth?.metadata?.active === true,
          }),
        });

        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          policyEngine,
          logger: mockLogger,
        });

        // Both policies pass
        const result1 = await handler.authorizeMessage(
          createAuthContext({
            userId: 'owner-123',
            metadata: { active: true },
          }),
          'TestService',
          'allPoliciesMethod',
          testService
        );
        expect(result1.allowed).toBe(true);

        // Clear cache before testing with different user context
        policyEngine.clearCache();

        // Only one policy passes
        const result2 = await handler.authorizeMessage(
          createAuthContext({
            userId: 'owner-123',
            metadata: { active: false },
          }),
          'TestService',
          'allPoliciesMethod',
          testService
        );
        expect(result2.allowed).toBe(false);
      });

      it('should evaluate policies with { any: [...] } (OR logic)', async () => {
        policyEngine.registerPolicy({
          name: 'isAdmin',
          evaluate: async (ctx: ExecutionContext) => ({
            allowed: ctx.auth?.roles.includes('admin') ?? false,
          }),
        });

        policyEngine.registerPolicy({
          name: 'isOwner',
          evaluate: async (ctx: ExecutionContext) => ({
            allowed: ctx.auth?.userId === 'owner-123',
          }),
        });

        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          policyEngine,
          logger: mockLogger,
        });

        // First policy passes (admin)
        const result1 = await handler.authorizeMessage(
          createAuthContext({ roles: ['admin'] }),
          'TestService',
          'anyPolicyMethod',
          testService
        );
        expect(result1.allowed).toBe(true);

        // Second policy passes (owner)
        const result2 = await handler.authorizeMessage(
          createAuthContext({ userId: 'owner-123', roles: ['user'] }),
          'TestService',
          'anyPolicyMethod',
          testService
        );
        expect(result2.allowed).toBe(true);

        // Neither policy passes
        const result3 = await handler.authorizeMessage(
          createAuthContext({ userId: 'other-user', roles: ['user'] }),
          'TestService',
          'anyPolicyMethod',
          testService
        );
        expect(result3.allowed).toBe(false);
      });

      it('should evaluate complex policy expressions', async () => {
        policyEngine.registerPolicy({
          name: 'policy1',
          evaluate: async () => ({ allowed: true }),
        });

        policyEngine.registerPolicy({
          name: 'policy2',
          evaluate: async () => ({ allowed: false }),
        });

        policyEngine.registerPolicy({
          name: 'policy3',
          evaluate: async () => ({ allowed: true }),
        });

        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          policyEngine,
          logger: mockLogger,
        });

        // policy1 AND (policy2 OR policy3)
        // true AND (false OR true) = true
        const result = await handler.authorizeMessage(
          createAuthContext(),
          'TestService',
          'expressionPolicyMethod',
          testService
        );
        expect(result.allowed).toBe(true);
      });

      it('should handle policy evaluation errors', async () => {
        policyEngine.registerPolicy({
          name: 'canAccessResource',
          evaluate: async () => {
            throw new Error('Policy service unavailable');
          },
        });

        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          policyEngine,
          logger: mockLogger,
        });

        const result = await handler.authorizeMessage(
          createAuthContext(),
          'TestService',
          'policyProtectedMethod',
          testService
        );

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('Policy service unavailable');
      });

      it('should log warning when policies defined but no PolicyEngine configured', async () => {
        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          // No policyEngine provided
          logger: mockLogger,
        });

        await handler.authorizeMessage(createAuthContext(), 'TestService', 'policyProtectedMethod', testService);

        // Check that a warning was logged
        const warnCalls = mockLogger.calls.warn;
        expect(warnCalls.some((call) => String(call).includes('PolicyEngine not configured'))).toBe(true);
      });
    });

    describe('execution context building', () => {
      it('should build correct execution context with metadata', async () => {
        let capturedContext: ExecutionContext | null = null;

        policyEngine.registerPolicy({
          name: 'canAccessResource',
          evaluate: async (ctx: ExecutionContext) => {
            capturedContext = ctx;
            return { allowed: true };
          },
        });

        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          policyEngine,
          logger: mockLogger,
        });

        const metadata = new Map<string, unknown>([
          ['clientIp', '192.168.1.100'],
          ['userAgent', 'TestClient/1.0'],
        ]);

        await handler.authorizeMessage(
          createAuthContext({ userId: 'test-user' }),
          'TestService',
          'policyProtectedMethod',
          testService,
          ['arg1', 'arg2'],
          metadata
        );

        expect(capturedContext).not.toBeNull();
        expect(capturedContext!.service.name).toBe('TestService');
        expect(capturedContext!.method?.name).toBe('policyProtectedMethod');
        expect(capturedContext!.method?.args).toEqual(['arg1', 'arg2']);
        expect(capturedContext!.environment?.transport).toBe('websocket');
        expect(capturedContext!.environment?.ip).toBe('192.168.1.100');
        expect(capturedContext!.auth?.userId).toBe('test-user');
      });
    });

    describe('edge cases', () => {
      it('should handle null service instance gracefully', async () => {
        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          logger: mockLogger,
        });

        const result = await handler.authorizeMessage(createAuthContext(), 'TestService', 'someMethod', null as any);

        // No metadata means no auth config, so allowed
        expect(result.allowed).toBe(true);
      });

      it('should handle undefined service instance', async () => {
        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          logger: mockLogger,
        });

        const result = await handler.authorizeMessage(createAuthContext(), 'TestService', 'someMethod', undefined);

        expect(result.allowed).toBe(true);
      });

      it('should handle method with no decorator metadata', async () => {
        const handler = new WebSocketAuthHandler({
          authenticationManager: authManager,
          authorizationManager: authzManager,
          logger: mockLogger,
        });

        const result = await handler.authorizeMessage(
          createAuthContext(),
          'TestService',
          'privateMethod', // This method has no @Public decorator
          testService
        );

        expect(result.allowed).toBe(true);
      });
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete auth flow: connect -> authorize multiple messages', async () => {
      const authContext = createAuthContext({
        userId: 'ws-user-1',
        roles: ['user', 'editor'],
        permissions: ['read:documents', 'write:documents'],
        scopes: ['api:read', 'api:write'],
      });

      authManager.configure({
        authenticate: vi.fn(),
        validateToken: vi.fn().mockResolvedValue(authContext),
      });

      policyEngine.registerPolicy({
        name: 'canAccessResource',
        evaluate: async (ctx: ExecutionContext) => ({
          allowed: ctx.auth?.roles.includes('user') ?? false,
        }),
      });

      const handler = new WebSocketAuthHandler({
        authenticationManager: authManager,
        authorizationManager: authzManager,
        policyEngine,
        logger: mockLogger,
      });

      // Step 1: Authenticate connection
      const request = createMockRequest({
        authorization: 'Bearer valid-token',
      });
      const connResult = await handler.authenticateConnection(request);
      expect(connResult.success).toBe(true);

      const connAuthContext = connResult.context!;

      // Step 2: Authorize various messages
      const msg1 = await handler.authorizeMessage(connAuthContext, 'TestService', 'publicMethod', testService);
      expect(msg1.allowed).toBe(true);

      const msg2 = await handler.authorizeMessage(connAuthContext, 'TestService', 'authenticatedMethod', testService);
      expect(msg2.allowed).toBe(true);

      const msg3 = await handler.authorizeMessage(connAuthContext, 'TestService', 'adminOnlyMethod', testService);
      expect(msg3.allowed).toBe(false); // User doesn't have admin role

      const msg4 = await handler.authorizeMessage(connAuthContext, 'TestService', 'writePermissionMethod', testService);
      expect(msg4.allowed).toBe(true); // User has write:documents

      const msg5 = await handler.authorizeMessage(connAuthContext, 'TestService', 'policyProtectedMethod', testService);
      expect(msg5.allowed).toBe(true); // Policy passes for user role
    });

    it('should handle service ACL combined with decorator auth', async () => {
      // Register service-level ACL
      authzManager.registerACL({
        service: 'RestrictedService',
        allowedRoles: ['premium'],
        methods: {
          specialMethod: {
            allowedRoles: ['vip'],
            __override: true,
          },
        },
      });

      const handler = new WebSocketAuthHandler({
        authenticationManager: authManager,
        authorizationManager: authzManager,
        logger: mockLogger,
      });

      const premiumUser = createAuthContext({ roles: ['premium'] });
      const vipUser = createAuthContext({ roles: ['vip'] });
      const freeUser = createAuthContext({ roles: ['free'] });

      // Premium user can access service
      expect(handler.canAccessMethod(premiumUser, 'RestrictedService', 'normalMethod')).toBe(true);

      // Premium user cannot access special method (needs vip)
      expect(handler.canAccessMethod(premiumUser, 'RestrictedService', 'specialMethod')).toBe(false);

      // VIP user can access special method
      expect(handler.canAccessMethod(vipUser, 'RestrictedService', 'specialMethod')).toBe(true);

      // Free user cannot access anything
      expect(handler.canAccessMethod(freeUser, 'RestrictedService', 'normalMethod')).toBe(false);
    });

    it('should handle concurrent authorization requests', async () => {
      policyEngine.registerPolicy({
        name: 'canAccessResource',
        evaluate: async (ctx: ExecutionContext) => {
          // Simulate async operation
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { allowed: ctx.auth?.roles.includes('user') ?? false };
        },
      });

      const handler = new WebSocketAuthHandler({
        authenticationManager: authManager,
        authorizationManager: authzManager,
        policyEngine,
        logger: mockLogger,
      });

      const authContext = createAuthContext({ roles: ['user'] });

      // Fire multiple concurrent authorization requests
      const promises = Array.from({ length: 50 }, (_, i) =>
        handler.authorizeMessage(authContext, 'TestService', 'policyProtectedMethod', testService, [i])
      );

      const results = await Promise.all(promises);

      // All should succeed
      results.forEach((result) => {
        expect(result.allowed).toBe(true);
      });
    });
  });

  describe('logging behavior', () => {
    it('should log debug messages for successful authentication', async () => {
      const authContext = createAuthContext();

      authManager.configure({
        authenticate: vi.fn(),
        validateToken: vi.fn().mockResolvedValue(authContext),
      });

      const handler = new WebSocketAuthHandler({
        authenticationManager: authManager,
        authorizationManager: authzManager,
        logger: mockLogger,
      });

      const request = createMockRequest({
        authorization: 'Bearer valid-token',
      });

      await handler.authenticateConnection(request);

      const debugCalls = mockLogger.calls.debug;
      expect(debugCalls.length).toBeGreaterThan(0);
    });

    it('should return error for failed authentication (no authorization header)', async () => {
      const handler = new WebSocketAuthHandler({
        authenticationManager: authManager,
        authorizationManager: authzManager,
        logger: mockLogger,
      });

      const request = createMockRequest({});

      const result = await handler.authenticateConnection(request);

      // Without authorization header, auth should fail
      expect(result.success).toBe(false);
      expect(result.error).toContain('Authorization required');
    });

    it('should log warn messages for access validation failures', async () => {
      const handler = new WebSocketAuthHandler({
        authenticationManager: authManager,
        authorizationManager: authzManager,
        logger: mockLogger,
      });

      await handler.authorizeMessage(
        createAuthContext({ roles: ['user'] }),
        'TestService',
        'adminOnlyMethod',
        testService
      );

      const warnCalls = mockLogger.calls.warn;
      expect(warnCalls.some((call) => String(call).includes('Access validation failed'))).toBe(true);
    });
  });
});
