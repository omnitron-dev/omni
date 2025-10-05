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
});
