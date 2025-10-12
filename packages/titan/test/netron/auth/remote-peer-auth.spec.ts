/**
 * Tests for RemotePeer authentication methods
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { RemotePeer } from '../../../src/netron/remote-peer.js';
import type { AuthContext } from '../../../src/netron/auth/types.js';

describe('RemotePeer Authentication', () => {
  let remotePeer: RemotePeer;
  let mockSocket: any;
  let mockNetron: any;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      child: jest.fn().mockReturnThis(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    mockNetron = {
      logger: mockLogger,
      peer: {
        abilities: {},
      },
    } as any;

    mockSocket = {
      on: jest.fn(),
      send: jest.fn(),
      close: jest.fn(),
    };

    remotePeer = new RemotePeer(mockSocket, mockNetron, 'test-peer-id');
  });

  describe('getAuthContext', () => {
    it('should return undefined when not authenticated', () => {
      const authContext = remotePeer.getAuthContext();
      expect(authContext).toBeUndefined();
    });

    it('should return auth context after authentication', () => {
      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: ['read:documents'],
      };

      remotePeer.setAuthContext(authContext);

      expect(remotePeer.getAuthContext()).toEqual(authContext);
    });
  });

  describe('setAuthContext', () => {
    it('should set authentication context', () => {
      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['admin'],
        permissions: ['read:all', 'write:all'],
      };

      remotePeer.setAuthContext(authContext);

      expect(remotePeer.getAuthContext()).toEqual(authContext);
      expect(remotePeer.isAuthenticated()).toBe(true);
    });

    it('should log authentication context setting', () => {
      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      remotePeer.setAuthContext(authContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user123',
          roles: ['user'],
        }),
        'Authentication context set for peer'
      );
    });

    it('should update existing auth context', () => {
      const authContext1: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      const authContext2: AuthContext = {
        userId: 'user123',
        roles: ['user', 'admin'],
        permissions: ['read:all'],
      };

      remotePeer.setAuthContext(authContext1);
      remotePeer.setAuthContext(authContext2);

      expect(remotePeer.getAuthContext()).toEqual(authContext2);
    });
  });

  describe('clearAuthContext', () => {
    it('should clear authentication context', () => {
      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      remotePeer.setAuthContext(authContext);
      expect(remotePeer.isAuthenticated()).toBe(true);

      remotePeer.clearAuthContext();

      expect(remotePeer.getAuthContext()).toBeUndefined();
      expect(remotePeer.isAuthenticated()).toBe(false);
    });

    it('should log context clearing', () => {
      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
      };

      remotePeer.setAuthContext(authContext);
      remotePeer.clearAuthContext();

      expect(mockLogger.info).toHaveBeenCalledWith('Authentication context cleared for peer');
    });

    it('should be safe to call when not authenticated', () => {
      expect(() => remotePeer.clearAuthContext()).not.toThrow();
      expect(remotePeer.isAuthenticated()).toBe(false);
    });
  });

  describe('isAuthenticated', () => {
    it('should return false when not authenticated', () => {
      expect(remotePeer.isAuthenticated()).toBe(false);
    });

    it('should return true after authentication', () => {
      const authContext: AuthContext = {
        userId: 'user123',
        roles: [],
        permissions: [],
      };

      remotePeer.setAuthContext(authContext);

      expect(remotePeer.isAuthenticated()).toBe(true);
    });

    it('should return false after clearing auth context', () => {
      const authContext: AuthContext = {
        userId: 'user123',
        roles: [],
        permissions: [],
      };

      remotePeer.setAuthContext(authContext);
      remotePeer.clearAuthContext();

      expect(remotePeer.isAuthenticated()).toBe(false);
    });
  });

  describe('auth context with scopes and metadata', () => {
    it('should support OAuth2 scopes', () => {
      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
        scopes: ['read:documents', 'write:documents'],
      };

      remotePeer.setAuthContext(authContext);

      const retrieved = remotePeer.getAuthContext();
      expect(retrieved?.scopes).toEqual(['read:documents', 'write:documents']);
    });

    it('should support token metadata', () => {
      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
        token: {
          type: 'bearer',
          expiresAt: new Date('2025-12-31'),
          issuer: 'auth.example.com',
          audience: ['api.example.com'],
        },
      };

      remotePeer.setAuthContext(authContext);

      const retrieved = remotePeer.getAuthContext();
      expect(retrieved?.token?.type).toBe('bearer');
      expect(retrieved?.token?.issuer).toBe('auth.example.com');
    });

    it('should support custom metadata', () => {
      const authContext: AuthContext = {
        userId: 'user123',
        roles: ['user'],
        permissions: [],
        metadata: {
          department: 'engineering',
          subscriptionTier: 'premium',
          customField: 'value',
        },
      };

      remotePeer.setAuthContext(authContext);

      const retrieved = remotePeer.getAuthContext();
      expect(retrieved?.metadata?.department).toBe('engineering');
      expect(retrieved?.metadata?.subscriptionTier).toBe('premium');
    });
  });
});
