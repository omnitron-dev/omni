/**
 * Tests for AuthenticationClient
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthenticationClient } from '../../src/auth/client.js';
import { MemoryTokenStorage } from '../../src/auth/storage.js';
import type { AuthResult, AuthContext } from '../../src/auth/types.js';

describe('AuthenticationClient', () => {
  let client: AuthenticationClient;
  let storage: MemoryTokenStorage;

  beforeEach(() => {
    storage = new MemoryTokenStorage();
    client = new AuthenticationClient({
      storage,
      autoRefresh: false, // Disable auto-refresh for tests
    });
  });

  afterEach(() => {
    client.destroy();
  });

  describe('initialization', () => {
    it('should initialize with default state', () => {
      const state = client.getState();
      expect(state.authenticated).toBe(false);
      expect(state.context).toBeUndefined();
      expect(state.token).toBeUndefined();
    });

    it('should restore token from storage', () => {
      storage.setToken('existing-token');
      const newClient = new AuthenticationClient({ storage });
      const state = newClient.getState();
      expect(state.authenticated).toBe(true);
      expect(state.token).toBe('existing-token');
      newClient.destroy();
    });
  });

  describe('authentication', () => {
    it('should set auth context and token', () => {
      const context: AuthContext = {
        userId: 'user-123',
        roles: ['user'],
        permissions: ['read'],
      };

      const result: AuthResult = {
        success: true,
        context,
        metadata: { token: 'test-token' },
      };

      client.setAuth(result);

      expect(client.isAuthenticated()).toBe(true);
      expect(client.getContext()).toEqual(context);
      expect(client.getToken()).toBe('test-token');
      expect(storage.getToken()).toBe('test-token');
    });

    it('should not set auth on failed result', () => {
      const result: AuthResult = {
        success: false,
        error: 'Invalid credentials',
      };

      client.setAuth(result);

      expect(client.isAuthenticated()).toBe(false);
      expect(client.getContext()).toBeUndefined();
    });

    it('should clear authentication', () => {
      const context: AuthContext = {
        userId: 'user-123',
        roles: ['user'],
        permissions: ['read'],
      };

      client.setAuth({
        success: true,
        context,
        metadata: { token: 'test-token' },
      });

      client.clearAuth();

      expect(client.isAuthenticated()).toBe(false);
      expect(client.getContext()).toBeUndefined();
      expect(client.getToken()).toBeUndefined();
      expect(storage.hasToken()).toBe(false);
    });
  });

  describe('token management', () => {
    it('should set token directly', () => {
      const context: AuthContext = {
        userId: 'user-123',
        roles: ['user'],
        permissions: ['read'],
      };

      client.setToken('direct-token', context);

      expect(client.getToken()).toBe('direct-token');
      expect(client.getContext()).toEqual(context);
      expect(storage.getToken()).toBe('direct-token');
    });

    it('should generate auth headers', () => {
      client.setToken('test-token');
      const headers = client.getAuthHeaders();

      expect(headers).toEqual({
        Authorization: 'Bearer test-token',
      });
    });

    it('should return empty headers when not authenticated', () => {
      const headers = client.getAuthHeaders();
      expect(headers).toEqual({});
    });
  });

  describe('token expiry', () => {
    it('should detect expired token', () => {
      const context: AuthContext = {
        userId: 'user-123',
        roles: ['user'],
        permissions: ['read'],
        token: {
          type: 'bearer',
          expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
        },
      };

      client.setAuth({
        success: true,
        context,
        metadata: { token: 'test-token' },
      });

      expect(client.isTokenExpired()).toBe(true);
    });

    it('should detect valid token', () => {
      const context: AuthContext = {
        userId: 'user-123',
        roles: ['user'],
        permissions: ['read'],
        token: {
          type: 'bearer',
          expiresAt: new Date(Date.now() + 3600000), // Expires in 1 hour
        },
      };

      client.setAuth({
        success: true,
        context,
        metadata: { token: 'test-token' },
      });

      expect(client.isTokenExpired()).toBe(false);
    });

    it('should check if token needs refresh', () => {
      const refreshClient = new AuthenticationClient({
        storage,
        autoRefresh: true,
        refreshThreshold: 5 * 60 * 1000, // 5 minutes
      });

      const context: AuthContext = {
        userId: 'user-123',
        roles: ['user'],
        permissions: ['read'],
        token: {
          type: 'bearer',
          expiresAt: new Date(Date.now() + 2 * 60 * 1000), // Expires in 2 minutes
        },
      };

      refreshClient.setAuth({
        success: true,
        context,
        metadata: { token: 'test-token' },
      });

      expect(refreshClient.needsRefresh()).toBe(true);
      refreshClient.destroy();
    });
  });

  describe('event handling', () => {
    it('should emit authenticated event', () => {
      const handler = vi.fn();
      client.on('authenticated', handler);

      const context: AuthContext = {
        userId: 'user-123',
        roles: ['user'],
        permissions: ['read'],
      };

      client.setAuth({
        success: true,
        context,
        metadata: { token: 'test-token' },
      });

      expect(handler).toHaveBeenCalledWith({ context });
    });

    it('should emit unauthenticated event', () => {
      const handler = vi.fn();
      client.on('unauthenticated', handler);

      // First authenticate
      client.setAuth({
        success: true,
        context: {
          userId: 'user-123',
          roles: ['user'],
          permissions: ['read'],
        },
        metadata: { token: 'test-token' },
      });

      // Then clear
      client.clearAuth();

      expect(handler).toHaveBeenCalledWith({});
    });

    it('should remove event listener', () => {
      const handler = vi.fn();
      client.on('authenticated', handler);
      client.off('authenticated', handler);

      client.setAuth({
        success: true,
        context: {
          userId: 'user-123',
          roles: ['user'],
          permissions: ['read'],
        },
        metadata: { token: 'test-token' },
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
