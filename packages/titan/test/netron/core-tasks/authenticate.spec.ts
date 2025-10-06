/**
 * Tests for authenticate core-task
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { authenticate } from '../../../src/netron/core-tasks/authenticate.js';
import type { AuthCredentials, AuthResult, AuthContext } from '../../../src/netron/auth/types.js';
import { TitanError, ErrorCode } from '../../../src/errors/index.js';

describe('authenticate core-task', () => {
  let remotePeer: any;
  let mockNetron: any;
  let mockAuthManager: any;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      child: jest.fn().mockReturnThis(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    mockAuthManager = {
      authenticate: jest.fn(),
      validateToken: jest.fn(),
    };

    mockNetron = {
      authenticationManager: mockAuthManager,
      logger: mockLogger,
      peer: {
        abilities: {},
      },
    };

    remotePeer = {
      netron: mockNetron,
      logger: mockLogger,
      setAuthContext: jest.fn(),
      getAuthContext: jest.fn(),
    } as any;
  });

  describe('credential-based authentication', () => {
    it('should authenticate with username and password', async () => {
      const credentials: AuthCredentials = {
        username: 'test@example.com',
        password: 'secret123',
      };

      const expectedContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: ['read:documents'],
      };

      const expectedResult: AuthResult = {
        success: true,
        context: expectedContext,
      };

      mockAuthManager.authenticate.mockResolvedValue(expectedResult);

      const result = await authenticate(remotePeer, credentials);

      expect(result).toEqual(expectedResult);
      expect(mockAuthManager.authenticate).toHaveBeenCalledWith(credentials);
      expect(remotePeer.setAuthContext).toHaveBeenCalledWith(expectedContext);
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should handle authentication failure', async () => {
      const credentials: AuthCredentials = {
        username: 'test@example.com',
        password: 'wrong-password',
      };

      const failureResult: AuthResult = {
        success: false,
        error: 'Invalid credentials',
      };

      mockAuthManager.authenticate.mockResolvedValue(failureResult);

      const result = await authenticate(remotePeer, credentials);

      expect(result).toEqual(failureResult);
      expect(remotePeer.setAuthContext).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('token-based authentication', () => {
    it('should authenticate with token', async () => {
      const credentials: AuthCredentials = {
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      };

      const expectedContext: AuthContext = {
        userId: 'user123',
        roles: ['admin'],
        permissions: ['read:all', 'write:all'],
        token: {
          type: 'bearer',
          expiresAt: new Date('2025-12-31'),
        },
      };

      const expectedResult: AuthResult = {
        success: true,
        context: expectedContext,
      };

      mockAuthManager.validateToken.mockResolvedValue(expectedResult);

      const result = await authenticate(remotePeer, credentials);

      expect(result).toEqual(expectedResult);
      expect(mockAuthManager.validateToken).toHaveBeenCalledWith(credentials.token);
      expect(remotePeer.setAuthContext).toHaveBeenCalledWith(expectedContext);
    });

    it('should handle token validation failure', async () => {
      const credentials: AuthCredentials = {
        token: 'invalid-token',
      };

      const failureResult: AuthResult = {
        success: false,
        error: 'Invalid token',
      };

      mockAuthManager.validateToken.mockResolvedValue(failureResult);

      const result = await authenticate(remotePeer, credentials);

      expect(result).toEqual(failureResult);
      expect(remotePeer.setAuthContext).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should throw error when authentication not configured', async () => {
      const peerWithoutAuth = {
        netron: {
          logger: mockLogger,
        },
        logger: mockLogger,
      } as any;

      const credentials: AuthCredentials = {
        username: 'test',
        password: 'test',
      };

      await expect(authenticate(peerWithoutAuth, credentials)).rejects.toThrow(TitanError);

      try {
        await authenticate(peerWithoutAuth, credentials);
      } catch (error: any) {
        expect(error.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
        expect(error.message).toContain('Authentication not configured');
      }
    });

    it('should handle authentication manager errors', async () => {
      const credentials: AuthCredentials = {
        username: 'test',
        password: 'test',
      };

      const error = new Error('Database connection failed');
      mockAuthManager.authenticate.mockRejectedValue(error);

      const result = await authenticate(remotePeer, credentials);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection failed');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle token validation errors', async () => {
      const credentials: AuthCredentials = {
        token: 'some-token',
      };

      const error = new Error('Token verification failed');
      mockAuthManager.validateToken.mockRejectedValue(error);

      const result = await authenticate(remotePeer, credentials);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Token verification failed');
    });

    it('should mask credentials in error logs', async () => {
      const credentials: AuthCredentials = {
        username: 'test@example.com',
        password: 'secret123',
        token: 'sensitive-token',
      };

      const error = new Error('Test error');
      mockAuthManager.authenticate.mockRejectedValue(error);

      await authenticate(remotePeer, credentials);

      // Verify that password and token are masked
      const errorCall = mockLogger.error.mock.calls[0];
      expect(errorCall[0].credentials.password).toBe('***');
      expect(errorCall[0].credentials.token).toBe('***');
    });
  });

  describe('auth context storage', () => {
    it('should store auth context only on successful authentication', async () => {
      const credentials: AuthCredentials = {
        username: 'test',
        password: 'test',
      };

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      const successResult: AuthResult = {
        success: true,
        context: authContext,
      };

      mockAuthManager.authenticate.mockResolvedValue(successResult);

      await authenticate(remotePeer, credentials);

      expect(remotePeer.setAuthContext).toHaveBeenCalledWith(authContext);
    });

    it('should not store auth context on authentication failure', async () => {
      const credentials: AuthCredentials = {
        username: 'test',
        password: 'wrong',
      };

      const failureResult: AuthResult = {
        success: false,
        error: 'Invalid credentials',
      };

      mockAuthManager.authenticate.mockResolvedValue(failureResult);

      await authenticate(remotePeer, credentials);

      expect(remotePeer.setAuthContext).not.toHaveBeenCalled();
    });

    it('should not store auth context when result has no context', async () => {
      const credentials: AuthCredentials = {
        username: 'test',
        password: 'test',
      };

      const resultWithoutContext: AuthResult = {
        success: true,
        // no context field
      };

      mockAuthManager.authenticate.mockResolvedValue(resultWithoutContext);

      await authenticate(remotePeer, credentials);

      expect(remotePeer.setAuthContext).not.toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('should log successful authentication', async () => {
      const credentials: AuthCredentials = {
        username: 'test',
        password: 'test',
      };

      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['admin', 'user'],
        permissions: ['read:all'],
      };

      mockAuthManager.authenticate.mockResolvedValue({
        success: true,
        context: authContext,
      });

      await authenticate(remotePeer, credentials);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user123',
          roles: ['admin', 'user'],
        }),
        'Peer authenticated successfully',
      );
    });

    it('should log authentication failures', async () => {
      const credentials: AuthCredentials = {
        username: 'test',
        password: 'wrong',
      };

      mockAuthManager.authenticate.mockResolvedValue({
        success: false,
        error: 'Invalid credentials',
      });

      await authenticate(remotePeer, credentials);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Invalid credentials',
        }),
        'Authentication failed',
      );
    });

    it('should log authentication errors', async () => {
      const credentials: AuthCredentials = {
        username: 'test',
        password: 'test',
      };

      const error = new Error('Database error');
      mockAuthManager.authenticate.mockRejectedValue(error);

      await authenticate(remotePeer, credentials);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
        }),
        'Authentication error',
      );
    });
  });
});
