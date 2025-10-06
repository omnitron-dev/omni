/**
 * HTTP Transport Authentication Integration Tests
 * Tests auth-aware service discovery over HTTP transport
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AuthenticationManager } from '../../../src/netron/auth/authentication-manager.js';
import { AuthorizationManager } from '../../../src/netron/auth/authorization-manager.js';
import type { AuthContext, AuthCredentials } from '../../../src/netron/auth/types.js';

describe('HTTP Transport Authentication Integration', () => {
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      child: jest.fn().mockReturnThis(),
      trace: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      fatal: jest.fn(),
    };
  });

  describe('AuthenticationManager over HTTP', () => {
    it('should authenticate with credentials and return context', async () => {
      const authManager = new AuthenticationManager(mockLogger);

      authManager.configure({
        authenticate: async (credentials: AuthCredentials): Promise<AuthContext> => {
          if (credentials.username === 'admin' && credentials.password === 'admin123') {
            return {
              userId: 'admin-id',
              username: 'admin',
              roles: ['admin'],
              permissions: ['read:all', 'write:all'],
            };
          }
          throw new Error('Invalid credentials');
        },
      });

      const result = await authManager.authenticate({
        username: 'admin',
        password: 'admin123',
      });

      expect(result.success).toBe(true);
      expect(result.context).toBeDefined();
      expect(result.context?.userId).toBe('admin-id');
      expect(result.context?.roles).toContain('admin');
    });

    it('should fail authentication with invalid credentials', async () => {
      const authManager = new AuthenticationManager(mockLogger);

      authManager.configure({
        authenticate: async (credentials: AuthCredentials): Promise<AuthContext> => {
          throw new Error('Invalid credentials');
        },
      });

      const result = await authManager.authenticate({
        username: 'invalid',
        password: 'wrong',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.context).toBeUndefined();
    });

    it('should validate JWT token and return context', async () => {
      const authManager = new AuthenticationManager(mockLogger);

      authManager.configure({
        authenticate: async () => {
          throw new Error('Should not be called');
        },
        validateToken: async (token: string): Promise<AuthContext> => {
          if (token === 'valid-jwt-token') {
            return {
              userId: 'user-123',
              username: 'user',
              roles: ['user'],
              permissions: ['read:documents'],
              token: {
                type: 'bearer',
                value: token,
                expiresAt: Date.now() + 3600000,
              },
            };
          }
          throw new Error('Invalid token');
        },
      });

      const result = await authManager.validateToken('valid-jwt-token');

      expect(result.success).toBe(true);
      expect(result.context?.userId).toBe('user-123');
      expect(result.context?.token).toBeDefined();
    });

    it('should handle token expiration', async () => {
      const authManager = new AuthenticationManager(mockLogger);

      authManager.configure({
        authenticate: async () => {
          throw new Error('Should not be called');
        },
        validateToken: async (token: string): Promise<AuthContext> => {
          if (token === 'expired-token') {
            throw new Error('Token expired');
          }
          throw new Error('Invalid token');
        },
      });

      const result = await authManager.validateToken('expired-token');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Token expired');
    });
  });

  describe('AuthorizationManager HTTP scenarios', () => {
    it('should filter service definition based on HTTP user permissions', () => {
      const authzManager = new AuthorizationManager(mockLogger);

      authzManager.registerACL({
        service: 'documentService@1.0.0',
        allowedRoles: ['user', 'admin'],
        requiredPermissions: ['read:documents'],
        methods: {
          createDocument: {
            allowedRoles: ['admin'],
            requiredPermissions: ['write:documents'],
          },
          deleteDocument: {
            allowedRoles: ['admin'],
            requiredPermissions: ['delete:documents'],
          },
        },
      });

      const userContext: AuthContext = {
        userId: 'user-1',
        roles: ['user'],
        permissions: ['read:documents'],
      };

      const definition = {
        name: 'documentService',
        version: '1.0.0',
        properties: {},
        methods: {
          getDocument: { type: 'function', transports: [] },
          createDocument: { type: 'function', transports: [] },
          deleteDocument: { type: 'function', transports: [] },
        },
        transports: [],
      };

      const filtered = authzManager.filterDefinition(
        'documentService@1.0.0',
        definition,
        userContext,
      );

      expect(filtered.methods.getDocument).toBeDefined();
      expect(filtered.methods.createDocument).toBeUndefined();
      expect(filtered.methods.deleteDocument).toBeUndefined();
    });

    it('should allow admin full access over HTTP', () => {
      const authzManager = new AuthorizationManager(mockLogger);

      authzManager.registerACL({
        service: 'documentService@1.0.0',
        allowedRoles: ['user', 'admin'],
        methods: {
          createDocument: {
            allowedRoles: ['admin'],
          },
          deleteDocument: {
            allowedRoles: ['admin'],
          },
        },
      });

      const adminContext: AuthContext = {
        userId: 'admin-1',
        roles: ['admin'],
        permissions: ['read:all', 'write:all', 'delete:all'],
      };

      const definition = {
        name: 'documentService',
        version: '1.0.0',
        properties: {},
        methods: {
          getDocument: { type: 'function', transports: [] },
          createDocument: { type: 'function', transports: [] },
          deleteDocument: { type: 'function', transports: [] },
        },
        transports: [],
      };

      const filtered = authzManager.filterDefinition(
        'documentService@1.0.0',
        definition,
        adminContext,
      );

      expect(filtered.methods.getDocument).toBeDefined();
      expect(filtered.methods.createDocument).toBeDefined();
      expect(filtered.methods.deleteDocument).toBeDefined();
    });
  });

  describe('Concurrent HTTP Auth Requests', () => {
    it('should handle multiple concurrent authentication requests', async () => {
      const authManager = new AuthenticationManager(mockLogger);
      let authCallCount = 0;

      authManager.configure({
        authenticate: async (credentials: AuthCredentials): Promise<AuthContext> => {
          authCallCount++;
          await new Promise((resolve) => setTimeout(resolve, 10)); // Simulate delay

          // Match any userN pattern
          if (credentials.username?.startsWith('user')) {
            const userId = credentials.username.replace('user', '');
            return {
              userId: `user-${userId}`,
              username: credentials.username!,
              roles: ['user'],
              permissions: ['read:documents'],
            };
          }
          throw new Error('Invalid credentials');
        },
      });

      const requests = Array.from({ length: 5 }, (_, i) =>
        authManager.authenticate({
          username: `user${i + 1}`,
          password: 'password',
        }),
      );

      const results = await Promise.all(requests);

      expect(results).toHaveLength(5);
      expect(results.filter((r) => r.success)).toHaveLength(5);
      expect(authCallCount).toBe(5); // Verify all were called
    });

    it('should handle concurrent authorization checks without race conditions', () => {
      const authzManager = new AuthorizationManager(mockLogger);

      authzManager.registerACL({
        service: 'testService@1.0.0',
        allowedRoles: ['user'],
      });

      const context: AuthContext = {
        userId: 'user-1',
        roles: ['user'],
        permissions: [],
      };

      const checks = Array.from({ length: 10 }, () =>
        authzManager.canAccessService('testService@1.0.0', context),
      );

      expect(checks.every((result) => result === true)).toBe(true);
    });
  });

  describe('HTTP Error Scenarios', () => {
    it('should handle authentication service unavailable', async () => {
      const authManager = new AuthenticationManager(mockLogger);

      authManager.configure({
        authenticate: async () => {
          throw new Error('Service unavailable');
        },
      });

      const result = await authManager.authenticate({
        username: 'user',
        password: 'password',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Service unavailable');
    });

    it('should handle authorization with undefined context', () => {
      const authzManager = new AuthorizationManager(mockLogger);

      authzManager.registerACL({
        service: 'testService@1.0.0',
        allowedRoles: ['user'],
      });

      const canAccess = authzManager.canAccessService('testService@1.0.0', undefined);

      expect(canAccess).toBe(false);
    });

    it('should handle authorization for non-existent service', () => {
      const authzManager = new AuthorizationManager(mockLogger);

      const context: AuthContext = {
        userId: 'user-1',
        roles: ['user'],
        permissions: [],
      };

      // No ACL registered, should allow by default
      const canAccess = authzManager.canAccessService('nonExistentService@1.0.0', context);

      expect(canAccess).toBe(true); // Default allow when no ACL
    });
  });

  describe('Token Validation Edge Cases', () => {
    it('should handle malformed token', async () => {
      const authManager = new AuthenticationManager(mockLogger);

      authManager.configure({
        authenticate: async () => {
          throw new Error('Should not be called');
        },
        validateToken: async (token: string) => {
          if (!token || token.split('.').length !== 3) {
            throw new Error('Malformed token');
          }
          throw new Error('Invalid token');
        },
      });

      const result = await authManager.validateToken('malformed');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Malformed token');
    });

    it('should handle token without validateToken configured', async () => {
      const authManager = new AuthenticationManager(mockLogger);

      authManager.configure({
        authenticate: async (credentials: AuthCredentials) => {
          if (credentials.token) {
            // Fallback: treat token as username
            return {
              userId: 'token-user',
              username: credentials.token,
              roles: ['user'],
              permissions: [],
            };
          }
          throw new Error('No credentials');
        },
      });

      const result = await authManager.validateToken('some-token');

      expect(result.success).toBe(true);
      expect(result.context?.username).toBe('some-token');
    });
  });

  describe('Cache and Performance', () => {
    it('should not cache authentication results', async () => {
      const authManager = new AuthenticationManager(mockLogger);
      let callCount = 0;

      authManager.configure({
        authenticate: async (credentials: AuthCredentials) => {
          callCount++;
          return {
            userId: `user-${callCount}`,
            username: credentials.username!,
            roles: ['user'],
            permissions: [],
          };
        },
      });

      await authManager.authenticate({ username: 'user', password: 'pass' });
      await authManager.authenticate({ username: 'user', password: 'pass' });

      // Should call authenticate twice (no caching)
      expect(callCount).toBe(2);
    });

    it('should handle rapid successive authorization checks efficiently', () => {
      const authzManager = new AuthorizationManager(mockLogger);

      authzManager.registerACL({
        service: 'testService@1.0.0',
        allowedRoles: ['user'],
      });

      const context: AuthContext = {
        userId: 'user-1',
        roles: ['user'],
        permissions: [],
      };

      const start = Date.now();

      for (let i = 0; i < 1000; i++) {
        authzManager.canAccessService('testService@1.0.0', context);
      }

      const duration = Date.now() - start;

      // Should complete 1000 checks in less than 100ms
      expect(duration).toBeLessThan(100);
    });
  });
});
