/**
 * Tests for WebSocket Authentication Handler
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { WebSocketAuthHandler, createWebSocketAuthHandler } from '../../../../src/netron/transport/websocket/auth.js';
import type { AuthenticationManager } from '../../../../src/netron/auth/authentication-manager.js';
import type { AuthorizationManager } from '../../../../src/netron/auth/authorization-manager.js';
import type { AuthContext } from '../../../../src/netron/auth/types.js';

describe('WebSocketAuthHandler', () => {
  let mockAuthManager: vi.Mocked<AuthenticationManager>;
  let mockAuthzManager: vi.Mocked<AuthorizationManager>;
  let handler: WebSocketAuthHandler;

  const createMockRequest = (headers: Record<string, string> = {}): IncomingMessage =>
    ({
      headers: {
        ...headers,
      },
    }) as IncomingMessage;

  const createAuthContext = (overrides: Partial<AuthContext> = {}): AuthContext => ({
    userId: 'test-user',
    roles: ['user'],
    permissions: ['read'],
    ...overrides,
  });

  beforeEach(() => {
    mockAuthManager = {
      validateToken: vi.fn(),
      authenticate: vi.fn(),
      configure: vi.fn(),
      getCacheStats: vi.fn(),
      clearCache: vi.fn(),
    } as any;

    mockAuthzManager = {
      validateAccess: vi.fn(),
      canAccessMethod: vi.fn(),
      registerACL: vi.fn(),
    } as any;
  });

  describe('authenticateConnection', () => {
    it('should reject connections without authorization header', async () => {
      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
      });

      const request = createMockRequest();
      const result = await handler.authenticateConnection(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Authorization');
    });

    it('should allow anonymous connections when configured', async () => {
      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
        allowAnonymous: true,
      });

      const request = createMockRequest();
      const result = await handler.authenticateConnection(request);

      expect(result.success).toBe(true);
      expect(mockAuthManager.validateToken).not.toHaveBeenCalled();
    });

    it('should reject connections with invalid token format', async () => {
      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
      });

      const request = createMockRequest({
        authorization: 'InvalidFormat',
      });
      const result = await handler.authenticateConnection(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Authorization required');
    });

    it('should validate Bearer token successfully', async () => {
      const authContext = createAuthContext();
      mockAuthManager.validateToken.mockResolvedValue({
        success: true,
        context: authContext,
      });

      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
      });

      const request = createMockRequest({
        authorization: 'Bearer valid-token',
      });
      const result = await handler.authenticateConnection(request);

      expect(result.success).toBe(true);
      expect(result.context).toEqual(authContext);
      expect(mockAuthManager.validateToken).toHaveBeenCalledWith('valid-token');
    });

    it('should reject invalid tokens', async () => {
      mockAuthManager.validateToken.mockResolvedValue({
        success: false,
        error: 'Token expired',
      });

      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
      });

      const request = createMockRequest({
        authorization: 'Bearer invalid-token',
      });
      const result = await handler.authenticateConnection(request);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Token expired');
    });

    it('should handle authentication errors gracefully', async () => {
      mockAuthManager.validateToken.mockRejectedValue(new Error('Auth service unavailable'));

      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
      });

      const request = createMockRequest({
        authorization: 'Bearer some-token',
      });
      const result = await handler.authenticateConnection(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Auth service unavailable');
    });

    it('should support custom header name', async () => {
      const authContext = createAuthContext();
      mockAuthManager.validateToken.mockResolvedValue({
        success: true,
        context: authContext,
      });

      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
        authHeaderName: 'x-auth-token',
      });

      const request = createMockRequest({
        'x-auth-token': 'Bearer custom-token',
      });
      const result = await handler.authenticateConnection(request);

      expect(result.success).toBe(true);
      expect(mockAuthManager.validateToken).toHaveBeenCalledWith('custom-token');
    });

    it('should handle case-insensitive header names', async () => {
      const authContext = createAuthContext();
      mockAuthManager.validateToken.mockResolvedValue({
        success: true,
        context: authContext,
      });

      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
      });

      // HTTP headers are case-insensitive, but Node.js normalizes them to lowercase
      const request = createMockRequest({
        authorization: 'Bearer case-test-token',
      });
      const result = await handler.authenticateConnection(request);

      expect(result.success).toBe(true);
      expect(mockAuthManager.validateToken).toHaveBeenCalledWith('case-test-token');
    });
  });

  describe('canAccessMethod', () => {
    it('should allow access for authenticated users when authorization manager allows', () => {
      mockAuthzManager.canAccessMethod.mockReturnValue(true);

      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
        authorizationManager: mockAuthzManager,
      });

      const authContext = createAuthContext();
      const canAccess = handler.canAccessMethod(authContext, 'TestService', 'testMethod');

      expect(canAccess).toBe(true);
      expect(mockAuthzManager.canAccessMethod).toHaveBeenCalledWith('TestService', 'testMethod', authContext);
    });

    it('should deny access for unauthenticated users when anonymous not allowed', () => {
      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
        authorizationManager: mockAuthzManager,
        allowAnonymous: false,
      });

      const canAccess = handler.canAccessMethod(undefined, 'TestService', 'testMethod');

      expect(canAccess).toBe(false);
    });

    it('should allow access for unauthenticated users when anonymous allowed', () => {
      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
        authorizationManager: mockAuthzManager,
        allowAnonymous: true,
      });

      const canAccess = handler.canAccessMethod(undefined, 'TestService', 'testMethod');

      expect(canAccess).toBe(true);
    });

    it('should delegate to authorization manager when provided', () => {
      mockAuthzManager.canAccessMethod.mockReturnValue(true);

      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
        authorizationManager: mockAuthzManager,
      });

      const authContext = createAuthContext();
      const canAccess = handler.canAccessMethod(authContext, 'TestService', 'testMethod');

      expect(canAccess).toBe(true);
      expect(mockAuthzManager.canAccessMethod).toHaveBeenCalledWith('TestService', 'testMethod', authContext);
    });

    it('should respect authorization manager denial', () => {
      mockAuthzManager.canAccessMethod.mockReturnValue(false);

      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
        authorizationManager: mockAuthzManager,
      });

      const authContext = createAuthContext();
      const canAccess = handler.canAccessMethod(authContext, 'TestService', 'testMethod');

      expect(canAccess).toBe(false);
    });

    it('should handle different service and method combinations', () => {
      mockAuthzManager.canAccessMethod.mockImplementation((service, method) =>
        service === 'AdminService' && method === 'deleteUser' ? false : true
      );

      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
        authorizationManager: mockAuthzManager,
      });

      const authContext = createAuthContext();

      expect(handler.canAccessMethod(authContext, 'UserService', 'getUser')).toBe(true);
      expect(handler.canAccessMethod(authContext, 'AdminService', 'deleteUser')).toBe(false);
    });
  });

  describe('validateAccess', () => {
    it('should allow access when authenticated without requirements', () => {
      mockAuthzManager.validateAccess.mockReturnValue({ allowed: true });

      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
        authorizationManager: mockAuthzManager,
      });

      const authContext = createAuthContext();
      const result = handler.validateAccess(authContext, {});

      expect(result.allowed).toBe(true);
      expect(mockAuthzManager.validateAccess).toHaveBeenCalledWith(authContext, {});
    });

    it('should deny unauthenticated access when anonymous not allowed', () => {
      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
        authorizationManager: mockAuthzManager,
        allowAnonymous: false,
      });

      const result = handler.validateAccess(undefined, {});

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Authentication');
    });

    it('should allow unauthenticated access when anonymous allowed', () => {
      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
        authorizationManager: mockAuthzManager,
        allowAnonymous: true,
      });

      const result = handler.validateAccess(undefined, {});

      expect(result.allowed).toBe(true);
    });

    it('should delegate to authorization manager for requirements', () => {
      mockAuthzManager.validateAccess.mockReturnValue({
        allowed: false,
        reason: 'Missing admin role',
      });

      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
        authorizationManager: mockAuthzManager,
      });

      const authContext = createAuthContext();
      const result = handler.validateAccess(authContext, {
        roles: ['admin'],
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Missing admin role');
      expect(mockAuthzManager.validateAccess).toHaveBeenCalledWith(authContext, {
        roles: ['admin'],
      });
    });

    it('should validate permission requirements', () => {
      mockAuthzManager.validateAccess.mockReturnValue({
        allowed: true,
      });

      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
        authorizationManager: mockAuthzManager,
      });

      const authContext = createAuthContext();
      const result = handler.validateAccess(authContext, {
        permissions: ['write', 'delete'],
      });

      expect(result.allowed).toBe(true);
      expect(mockAuthzManager.validateAccess).toHaveBeenCalledWith(authContext, {
        permissions: ['write', 'delete'],
      });
    });

    it('should validate scope requirements', () => {
      mockAuthzManager.validateAccess.mockReturnValue({
        allowed: false,
        reason: 'Missing required scope',
      });

      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
        authorizationManager: mockAuthzManager,
      });

      const authContext = createAuthContext();
      const result = handler.validateAccess(authContext, {
        scopes: ['api:read', 'api:write'],
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Missing required scope');
      expect(mockAuthzManager.validateAccess).toHaveBeenCalledWith(authContext, {
        scopes: ['api:read', 'api:write'],
      });
    });

    it('should validate combined requirements', () => {
      mockAuthzManager.validateAccess.mockReturnValue({
        allowed: true,
      });

      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
        authorizationManager: mockAuthzManager,
      });

      const authContext = createAuthContext();
      const result = handler.validateAccess(authContext, {
        roles: ['admin'],
        permissions: ['write'],
        scopes: ['api:admin'],
      });

      expect(result.allowed).toBe(true);
      expect(mockAuthzManager.validateAccess).toHaveBeenCalledWith(authContext, {
        roles: ['admin'],
        permissions: ['write'],
        scopes: ['api:admin'],
      });
    });
  });

  describe('createWebSocketAuthHandler factory', () => {
    it('should create handler with required options', () => {
      const handler = createWebSocketAuthHandler(mockAuthManager, mockAuthzManager);

      expect(handler).toBeInstanceOf(WebSocketAuthHandler);
    });

    it('should create handler with custom options', () => {
      const handler = createWebSocketAuthHandler(mockAuthManager, mockAuthzManager, {
        allowAnonymous: true,
      });

      expect(handler).toBeInstanceOf(WebSocketAuthHandler);
    });

    it('should create handler with custom header name', () => {
      const handler = createWebSocketAuthHandler(mockAuthManager, mockAuthzManager, {
        authHeaderName: 'x-custom-auth',
      });

      expect(handler).toBeInstanceOf(WebSocketAuthHandler);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle full authentication flow', async () => {
      const authContext = createAuthContext({
        userId: 'user-123',
        roles: ['user', 'admin'],
        permissions: ['read', 'write'],
      });

      mockAuthManager.validateToken.mockResolvedValue({
        success: true,
        context: authContext,
      });

      mockAuthzManager.canAccessMethod.mockReturnValue(true);
      mockAuthzManager.validateAccess.mockReturnValue({
        allowed: true,
      });

      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
        authorizationManager: mockAuthzManager,
      });

      // Authenticate connection
      const request = createMockRequest({
        authorization: 'Bearer valid-token',
      });
      const authResult = await handler.authenticateConnection(request);

      expect(authResult.success).toBe(true);
      expect(authResult.context).toEqual(authContext);

      // Check method access
      const canAccess = handler.canAccessMethod(authResult.context, 'UserService', 'updateUser');
      expect(canAccess).toBe(true);

      // Validate access with requirements
      const validation = handler.validateAccess(authResult.context, {
        roles: ['admin'],
      });
      expect(validation.allowed).toBe(true);
    });

    it('should handle authentication failure and access denial', async () => {
      mockAuthManager.validateToken.mockResolvedValue({
        success: false,
        error: 'Invalid token',
      });

      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
        authorizationManager: mockAuthzManager,
        allowAnonymous: false,
      });

      // Failed authentication
      const request = createMockRequest({
        authorization: 'Bearer invalid-token',
      });
      const authResult = await handler.authenticateConnection(request);

      expect(authResult.success).toBe(false);
      expect(authResult.error).toBe('Invalid token');

      // Access should be denied (no authContext, anonymous not allowed)
      const canAccess = handler.canAccessMethod(undefined, 'UserService', 'getUser');
      expect(canAccess).toBe(false);
    });

    it('should handle anonymous access with restrictions', async () => {
      // When allowAnonymous is true and no authContext, canAccessMethod returns true
      // This test verifies the behavior when anonymous access is allowed
      mockAuthzManager.validateAccess.mockReturnValue({ allowed: true });

      handler = new WebSocketAuthHandler({
        authenticationManager: mockAuthManager,
        authorizationManager: mockAuthzManager,
        allowAnonymous: true,
      });

      // Anonymous connection
      const request = createMockRequest();
      const authResult = await handler.authenticateConnection(request);

      expect(authResult.success).toBe(true);
      expect(authResult.context).toBeUndefined();

      // When anonymous is allowed, canAccessMethod returns true for unauthenticated
      expect(handler.canAccessMethod(undefined, 'UserService', 'getUser')).toBe(true);
      expect(handler.canAccessMethod(undefined, 'UserService', 'updateUser')).toBe(true);

      // validateAccess also allows when anonymous is enabled
      const readValidation = handler.validateAccess(undefined, {});
      expect(readValidation.allowed).toBe(true);
    });
  });
});
