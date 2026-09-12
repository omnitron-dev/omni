/**
 * Tests for authenticate core-task
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
      child: vi.fn().mockReturnThis(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    mockAuthManager = {
      authenticate: vi.fn(),
      validateToken: vi.fn(),
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
      setAuthContext: vi.fn(),
      getAuthContext: vi.fn(),
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

    it('should keep credential values out of error logs', async () => {
      // This test used to assert `credentials.password === '***'`, i.e. it
      // certified a denylist: the two masked keys were present and correct, so
      // it passed while every other credential field was logged verbatim. The
      // contract is now that no credential VALUE is logged at all.
      const credentials: AuthCredentials = {
        username: 'test@example.com',
        password: 'secret123',
        token: 'sensitive-token',
      };

      const error = new Error('Test error');
      mockAuthManager.authenticate.mockRejectedValue(error);

      await authenticate(remotePeer, credentials);

      const [payload] = mockLogger.error.mock.calls[0] as [Record<string, unknown>];
      expect(payload).not.toHaveProperty('credentials');
      expect(payload['credentialFields']).toEqual(['password', 'token', 'username']);
      expect(JSON.stringify(payload)).not.toContain('secret123');
      expect(JSON.stringify(payload)).not.toContain('sensitive-token');
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
        'Peer authenticated successfully'
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
        'Authentication failed'
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
        'Authentication error'
      );
    });
  });

  /**
   * The failure path used to log `{ ...credentials, password: '***', token: '***' }`.
   * `AuthCredentials` declares `[key: string]: any`, so that mask was a denylist
   * over an open set: it covered the two fields that existed when it was written
   * and nothing an application adds afterwards. And it sat in the CATCH, i.e. the
   * branch a client reaches by sending a credential the auth function chokes on.
   *
   * These assert over everything the logger received, because the old code would
   * pass any check that only looked at `password` and `token`.
   */
  describe('the error log names the credential shape, not its values', () => {
    const loggedText = () =>
      mockLogger.error.mock.calls
        .map((c: unknown[]) => JSON.stringify(c, (_k, v) => (v instanceof Error ? v.message : v)))
        .join('\n');

    it('leaks no credential value, including fields the mask never knew about', async () => {
      const credentials: AuthCredentials = {
        username: 'neo',
        password: 'correct-horse-battery-staple',
        token: 'eyJhbGciOiJIUzI1NiJ9.payload.sig',
        mfaCode: '314159',
        recoveryCode: 'RESCUE-8842-QQ',
        pgpChallengeResponse: '-----BEGIN PGP MESSAGE-----abc',
      };

      mockAuthManager.authenticate.mockRejectedValue(new Error('Database error'));

      await authenticate(remotePeer, credentials);

      const text = loggedText();
      for (const secret of [
        'correct-horse-battery-staple',
        'eyJhbGciOiJIUzI1NiJ9.payload.sig',
        '314159',
        'RESCUE-8842-QQ',
        '-----BEGIN PGP MESSAGE-----abc',
      ]) {
        expect(text, `secret value reached the log: ${secret}`).not.toContain(secret);
      }
    });

    it('still says which fields were supplied, which is what the log is for', async () => {
      mockAuthManager.authenticate.mockRejectedValue(new Error('Database error'));

      await authenticate(remotePeer, {
        username: 'neo',
        password: 'p',
        mfaCode: '1',
      } as AuthCredentials);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'neo',
          credentialFields: ['mfaCode', 'password', 'username'],
        }),
        'Authentication error'
      );
    });

    it('does not spread the credentials object under any key', async () => {
      mockAuthManager.validateToken.mockRejectedValue(new Error('boom'));

      await authenticate(remotePeer, { token: 'tok-should-not-appear' } as AuthCredentials);

      const [payload] = mockLogger.error.mock.calls.at(-1) as [Record<string, unknown>];
      expect(payload).not.toHaveProperty('credentials');
      expect(payload['credentialFields']).toEqual(['token']);
    });
  });
});
