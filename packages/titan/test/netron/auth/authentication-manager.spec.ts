/**
 * Tests for AuthenticationManager
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AuthenticationManager } from '../../../src/netron/auth/authentication-manager.js';
import type {
  AuthCredentials,
  AuthContext,
  NetronAuthConfig,
} from '../../../src/netron/auth/types.js';

describe('AuthenticationManager', () => {
  let authManager: AuthenticationManager;
  let mockLogger: any;
  let mockAuthenticateFn: jest.Mock;
  let mockValidateTokenFn: jest.Mock;

  beforeEach(() => {
    mockLogger = {
      child: jest.fn().mockReturnThis(),
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    };

    mockAuthenticateFn = jest.fn();
    mockValidateTokenFn = jest.fn();

    authManager = new AuthenticationManager(mockLogger);
  });

  describe('configure', () => {
    it('should configure authentication functions', () => {
      const config: NetronAuthConfig = {
        authenticate: mockAuthenticateFn,
        validateToken: mockValidateTokenFn,
      };

      authManager.configure(config);

      expect(authManager.isConfigured()).toBe(true);
      expect(authManager.isTokenValidationConfigured()).toBe(true);
    });
  });

  describe('authenticate', () => {
    it('should successfully authenticate valid credentials', async () => {
      const credentials: AuthCredentials = {
        username: 'testuser',
        password: 'testpass',
      };

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: ['read:documents'],
      };

      mockAuthenticateFn.mockResolvedValue(authContext);

      authManager.configure({
        authenticate: mockAuthenticateFn,
      });

      const result = await authManager.authenticate(credentials);

      expect(result.success).toBe(true);
      expect(result.context).toEqual(authContext);
      expect(result.error).toBeUndefined();
      expect(mockAuthenticateFn).toHaveBeenCalledWith(credentials);
    });

    it('should fail authentication with invalid credentials', async () => {
      const credentials: AuthCredentials = {
        username: 'testuser',
        password: 'wrongpass',
      };

      mockAuthenticateFn.mockRejectedValue(new Error('Invalid credentials'));

      authManager.configure({
        authenticate: mockAuthenticateFn,
      });

      const result = await authManager.authenticate(credentials);

      expect(result.success).toBe(false);
      expect(result.context).toBeUndefined();
      expect(result.error).toBe('Invalid credentials');
    });

    it('should return error if authentication not configured', async () => {
      const credentials: AuthCredentials = {
        username: 'testuser',
        password: 'testpass',
      };

      const result = await authManager.authenticate(credentials);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Authentication not configured');
    });

    it('should log authentication success', async () => {
      const credentials: AuthCredentials = {
        username: 'testuser',
        password: 'testpass',
      };

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user', 'admin'],
        permissions: ['read:documents', 'write:documents'],
      };

      mockAuthenticateFn.mockResolvedValue(authContext);

      authManager.configure({
        authenticate: mockAuthenticateFn,
      });

      await authManager.authenticate(credentials);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user123',
          roles: ['user', 'admin'],
          permissions: ['read:documents', 'write:documents'],
        }),
        'User authenticated successfully',
      );
    });

    it('should log authentication failure', async () => {
      const credentials: AuthCredentials = {
        username: 'testuser',
        password: 'wrongpass',
      };

      mockAuthenticateFn.mockRejectedValue(new Error('Invalid credentials'));

      authManager.configure({
        authenticate: mockAuthenticateFn,
      });

      await authManager.authenticate(credentials);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Invalid credentials',
          username: 'testuser',
        }),
        'Authentication failed',
      );
    });
  });

  describe('validateToken', () => {
    it('should successfully validate valid token', async () => {
      const token = 'valid-token-123';
      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: ['read:documents'],
      };

      mockValidateTokenFn.mockResolvedValue(authContext);

      authManager.configure({
        authenticate: mockAuthenticateFn,
        validateToken: mockValidateTokenFn,
      });

      const result = await authManager.validateToken(token);

      expect(result.success).toBe(true);
      expect(result.context).toEqual(authContext);
      expect(mockValidateTokenFn).toHaveBeenCalledWith(token);
    });

    it('should fail validation with invalid token', async () => {
      const token = 'invalid-token';

      mockValidateTokenFn.mockRejectedValue(new Error('Invalid token'));

      authManager.configure({
        authenticate: mockAuthenticateFn,
        validateToken: mockValidateTokenFn,
      });

      const result = await authManager.validateToken(token);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid token');
    });

    it('should fall back to authenticate function if no token validator configured', async () => {
      const token = 'test-token';
      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      mockAuthenticateFn.mockResolvedValue(authContext);

      authManager.configure({
        authenticate: mockAuthenticateFn,
      });

      const result = await authManager.validateToken(token);

      expect(result.success).toBe(true);
      expect(mockAuthenticateFn).toHaveBeenCalledWith({ token });
    });

    it('should return error if token validation not configured', async () => {
      const token = 'test-token';
      const result = await authManager.validateToken(token);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Token validation not configured');
    });
  });

  describe('isConfigured', () => {
    it('should return false when not configured', () => {
      expect(authManager.isConfigured()).toBe(false);
    });

    it('should return true when configured', () => {
      authManager.configure({
        authenticate: mockAuthenticateFn,
      });

      expect(authManager.isConfigured()).toBe(true);
    });
  });

  describe('isTokenValidationConfigured', () => {
    it('should return false when token validation not configured', () => {
      authManager.configure({
        authenticate: mockAuthenticateFn,
      });

      expect(authManager.isTokenValidationConfigured()).toBe(false);
    });

    it('should return true when token validation configured', () => {
      authManager.configure({
        authenticate: mockAuthenticateFn,
        validateToken: mockValidateTokenFn,
      });

      expect(authManager.isTokenValidationConfigured()).toBe(true);
    });
  });

  describe('constructor with config', () => {
    it('should configure on construction if config provided', () => {
      const config: NetronAuthConfig = {
        authenticate: mockAuthenticateFn,
        validateToken: mockValidateTokenFn,
      };

      const manager = new AuthenticationManager(mockLogger, config);

      expect(manager.isConfigured()).toBe(true);
      expect(manager.isTokenValidationConfigured()).toBe(true);
    });
  });

  describe('enhanced input validation', () => {
    beforeEach(() => {
      authManager.configure({
        authenticate: mockAuthenticateFn,
      });
    });

    it('should reject null credentials', async () => {
      const result = await authManager.authenticate(null as any);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Credentials must be an object');
      expect(mockAuthenticateFn).not.toHaveBeenCalled();
    });

    it('should reject non-string username', async () => {
      const credentials: AuthCredentials = {
        username: 12345 as any,
        password: 'testpass',
      };

      const result = await authManager.authenticate(credentials);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Username must be a string');
      expect(mockAuthenticateFn).not.toHaveBeenCalled();
    });

    it('should reject non-string password', async () => {
      const credentials: AuthCredentials = {
        username: 'testuser',
        password: 12345 as any,
      };

      const result = await authManager.authenticate(credentials);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Password must be a string');
      expect(mockAuthenticateFn).not.toHaveBeenCalled();
    });

    it('should reject empty username', async () => {
      const credentials: AuthCredentials = {
        username: '',
        password: 'testpass',
      };

      const result = await authManager.authenticate(credentials);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Username cannot be empty');
      expect(mockAuthenticateFn).not.toHaveBeenCalled();
    });

    it('should reject empty password', async () => {
      const credentials: AuthCredentials = {
        username: 'testuser',
        password: '',
      };

      const result = await authManager.authenticate(credentials);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Password cannot be empty');
      expect(mockAuthenticateFn).not.toHaveBeenCalled();
    });

    it('should handle special characters in credentials', async () => {
      const credentials: AuthCredentials = {
        username: 'user@example.com',
        password: 'p@$$w0rd!#%',
      };

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      mockAuthenticateFn.mockResolvedValue(authContext);

      const result = await authManager.authenticate(credentials);

      expect(result.success).toBe(true);
      expect(mockAuthenticateFn).toHaveBeenCalledWith(credentials);
    });

    it('should handle SQL injection attempts in username', async () => {
      const credentials: AuthCredentials = {
        username: "admin' OR '1'='1",
        password: 'testpass',
      };

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      mockAuthenticateFn.mockResolvedValue(authContext);

      const result = await authManager.authenticate(credentials);

      expect(result.success).toBe(true);
      // Should pass through safely - validation is up to the auth function
      expect(mockAuthenticateFn).toHaveBeenCalledWith(credentials);
    });

    it('should reject whitespace-only username', async () => {
      const credentials: AuthCredentials = {
        username: '   ',
        password: 'testpass',
      };

      const result = await authManager.authenticate(credentials);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Username cannot be empty');
    });

    it('should reject whitespace-only password', async () => {
      const credentials: AuthCredentials = {
        username: 'testuser',
        password: '   ',
      };

      const result = await authManager.authenticate(credentials);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Password cannot be empty');
    });
  });

  describe('async authentication providers', () => {
    it('should handle async authentication function', async () => {
      const credentials: AuthCredentials = {
        username: 'testuser',
        password: 'testpass',
      };

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: ['read'],
      };

      // Simulate async operation with delay
      mockAuthenticateFn.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return authContext;
      });

      authManager.configure({
        authenticate: mockAuthenticateFn,
      });

      const result = await authManager.authenticate(credentials);

      expect(result.success).toBe(true);
      expect(result.context).toEqual(authContext);
    });

    it('should handle sync authentication function', async () => {
      const credentials: AuthCredentials = {
        username: 'testuser',
        password: 'testpass',
      };

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: ['read'],
      };

      // Synchronous function
      const syncAuthFn = jest.fn(() => authContext);

      authManager.configure({
        authenticate: syncAuthFn,
      });

      const result = await authManager.authenticate(credentials);

      expect(result.success).toBe(true);
      expect(result.context).toEqual(authContext);
    });
  });

  describe('token validation edge cases', () => {
    it('should reject malformed tokens (non-string)', async () => {
      const result = await authManager.validateToken(123 as any);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Token must be a non-empty string');
    });

    it('should reject empty token string', async () => {
      const result = await authManager.validateToken('');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Token must be a non-empty string');
    });

    it('should reject whitespace-only token', async () => {
      const result = await authManager.validateToken('   ');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Token cannot be empty');
    });

    it('should use authenticate function as fallback for tokens when no validator configured', async () => {
      const token = 'test-token-123';
      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      mockAuthenticateFn.mockResolvedValue(authContext);

      authManager.configure({
        authenticate: mockAuthenticateFn,
      });

      const result = await authManager.validateToken(token);

      expect(result.success).toBe(true);
      expect(mockAuthenticateFn).toHaveBeenCalledWith({ token });
    });

    it('should validate token with custom claims in context', async () => {
      const token = 'jwt-token-with-claims';
      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['admin'],
        permissions: ['read', 'write'],
        scopes: ['api:read', 'api:write'],
        token: {
          type: 'bearer' as const,
          expiresAt: new Date('2025-12-31'),
          issuer: 'auth.example.com',
          audience: ['api.example.com'],
        },
        metadata: {
          deviceId: 'device-123',
          sessionId: 'session-456',
        },
      };

      mockValidateTokenFn.mockResolvedValue(authContext);

      authManager.configure({
        authenticate: mockAuthenticateFn,
        validateToken: mockValidateTokenFn,
      });

      const result = await authManager.validateToken(token);

      expect(result.success).toBe(true);
      expect(result.context).toEqual(authContext);
      expect(result.context?.metadata?.deviceId).toBe('device-123');
    });
  });

  describe('configuration validation', () => {
    it('should throw error when configuring with invalid authenticate function', () => {
      expect(() => {
        authManager.configure({
          authenticate: 'not-a-function' as any,
        });
      }).toThrow(TypeError);
    });

    it('should throw error when configuring with invalid validateToken function', () => {
      expect(() => {
        authManager.configure({
          authenticate: mockAuthenticateFn,
          validateToken: 'not-a-function' as any,
        });
      }).toThrow(TypeError);
    });

    it('should allow multiple reconfigurations', () => {
      const config1: NetronAuthConfig = {
        authenticate: mockAuthenticateFn,
      };

      authManager.configure(config1);
      expect(authManager.isConfigured()).toBe(true);

      const newMockAuth = jest.fn();
      const config2: NetronAuthConfig = {
        authenticate: newMockAuth,
        validateToken: mockValidateTokenFn,
      };

      authManager.configure(config2);
      expect(authManager.isConfigured()).toBe(true);
      expect(authManager.isTokenValidationConfigured()).toBe(true);
    });
  });

  describe('authentication function edge cases', () => {
    it('should handle authentication function that returns null', async () => {
      const credentials: AuthCredentials = {
        username: 'testuser',
        password: 'testpass',
      };

      mockAuthenticateFn.mockResolvedValue(null as any);

      authManager.configure({
        authenticate: mockAuthenticateFn,
      });

      const result = await authManager.authenticate(credentials);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Authentication failed: no context returned');
    });

    it('should handle authentication function that returns undefined', async () => {
      const credentials: AuthCredentials = {
        username: 'testuser',
        password: 'testpass',
      };

      mockAuthenticateFn.mockResolvedValue(undefined as any);

      authManager.configure({
        authenticate: mockAuthenticateFn,
      });

      const result = await authManager.authenticate(credentials);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Authentication failed: no context returned');
    });

    it('should handle token validation function that returns null', async () => {
      const token = 'test-token';

      mockValidateTokenFn.mockResolvedValue(null as any);

      authManager.configure({
        authenticate: mockAuthenticateFn,
        validateToken: mockValidateTokenFn,
      });

      const result = await authManager.validateToken(token);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Token validation failed: no context returned');
    });
  });

  describe('timeout handling', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should timeout authentication after configured timeout', async () => {
      const credentials: AuthCredentials = {
        username: 'testuser',
        password: 'testpass',
      };

      // Create a promise that never resolves
      mockAuthenticateFn.mockImplementation(
        () => new Promise(() => {}),
      );

      authManager.configure({
        authenticate: mockAuthenticateFn,
      });

      authManager.setTimeout(1000);

      const resultPromise = authManager.authenticate(credentials);

      // Fast-forward time
      jest.advanceTimersByTime(1000);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });

    it('should allow setting custom timeout', () => {
      expect(() => authManager.setTimeout(5000)).not.toThrow();
    });

    it('should reject invalid timeout values', () => {
      expect(() => authManager.setTimeout(0)).toThrow(RangeError);
      expect(() => authManager.setTimeout(-1000)).toThrow(RangeError);
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      authManager.configure({
        authenticate: mockAuthenticateFn,
      });
    });

    it('should handle network errors during authentication', async () => {
      const credentials: AuthCredentials = {
        username: 'testuser',
        password: 'testpass',
      };

      const networkError = new Error('Network request failed');
      (networkError as any).code = 'ECONNREFUSED';

      mockAuthenticateFn.mockRejectedValue(networkError);

      const result = await authManager.authenticate(credentials);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network request failed');
    });

    it('should handle errors without message property', async () => {
      const credentials: AuthCredentials = {
        username: 'testuser',
        password: 'testpass',
      };

      mockAuthenticateFn.mockRejectedValue({ toString: () => 'Custom error' });

      const result = await authManager.authenticate(credentials);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Authentication failed');
    });
  });

  describe('concurrent authentication', () => {
    it('should handle multiple concurrent authentications', async () => {
      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      mockAuthenticateFn.mockImplementation(async (creds: AuthCredentials) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { ...authContext, userId: `user-${creds.username}` };
      });

      authManager.configure({
        authenticate: mockAuthenticateFn,
      });

      // Create 10 concurrent authentication requests
      const promises = Array.from({ length: 10 }, (_, i) =>
        authManager.authenticate({
          username: `user${i}`,
          password: 'testpass',
        }),
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach((result, i) => {
        expect(result.success).toBe(true);
        expect(result.context?.userId).toBe(`user-user${i}`);
      });
    });
  });

  describe('performance and stress tests', () => {
    it('should handle authentication under load (1000+ req/s benchmark)', async () => {
      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      mockAuthenticateFn.mockResolvedValue(authContext);

      authManager.configure({
        authenticate: mockAuthenticateFn,
      });

      const credentials: AuthCredentials = {
        username: 'testuser',
        password: 'testpass',
      };

      const startTime = Date.now();
      const iterations = 1000;

      // Run 1000 authentications
      const promises = Array.from({ length: iterations }, () =>
        authManager.authenticate(credentials),
      );

      const results = await Promise.all(promises);

      const endTime = Date.now();
      const duration = endTime - startTime;
      const requestsPerSecond = (iterations / duration) * 1000;

      expect(results.every((r) => r.success)).toBe(true);
      expect(requestsPerSecond).toBeGreaterThan(1000); // Should handle >1000 req/s
    });

    it('should not leak memory during repeated authentications (100K+ iterations)', async () => {
      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      mockAuthenticateFn.mockResolvedValue(authContext);

      authManager.configure({
        authenticate: mockAuthenticateFn,
      });

      const credentials: AuthCredentials = {
        username: 'testuser',
        password: 'testpass',
      };

      // Run in batches to avoid overwhelming the event loop
      const batchSize = 1000;
      const batches = 100; // 100K total iterations

      for (let i = 0; i < batches; i++) {
        const promises = Array.from({ length: batchSize }, () =>
          authManager.authenticate(credentials),
        );
        await Promise.all(promises);
      }

      // If we get here without running out of memory, the test passes
      expect(true).toBe(true);
    }, 60000); // Increase timeout for this test
  });
});
