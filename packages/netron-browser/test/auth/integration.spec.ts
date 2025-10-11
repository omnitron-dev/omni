/**
 * Integration tests for authentication with HTTP and WebSocket clients
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthenticationClient } from '../../src/auth/client.js';
import { MemoryTokenStorage } from '../../src/auth/storage.js';
import { HttpClient } from '../../src/client/http-client.js';
import { WebSocketClient } from '../../src/client/ws-client.js';
import type { AuthContext } from '../../src/auth/types.js';

describe('Authentication Integration', () => {
  let authClient: AuthenticationClient;
  let storage: MemoryTokenStorage;

  beforeEach(() => {
    storage = new MemoryTokenStorage();
    authClient = new AuthenticationClient({
      storage,
      autoRefresh: false,
    });
  });

  afterEach(() => {
    authClient.destroy();
  });

  describe('HTTP Client Integration', () => {
    it('should create HTTP client with auth', () => {
      const httpClient = new HttpClient({
        url: 'http://localhost:3000',
        auth: authClient,
      });

      expect(httpClient).toBeDefined();
      expect(httpClient.getState()).toBe('disconnected');
    });

    it('should attach auth headers when authenticated', () => {
      const httpClient = new HttpClient({
        url: 'http://localhost:3000',
        auth: authClient,
      });

      // Authenticate
      const context: AuthContext = {
        userId: 'user-123',
        roles: ['user'],
        permissions: ['read'],
      };

      authClient.setAuth({
        success: true,
        context,
        metadata: { token: 'test-token' },
      });

      // Headers should be available
      expect(authClient.getAuthHeaders()).toEqual({
        Authorization: 'Bearer test-token',
      });
    });
  });

  describe('WebSocket Client Integration', () => {
    let wsClient: WebSocketClient;

    afterEach(async () => {
      if (wsClient) {
        await wsClient.disconnect();
      }
    });

    it('should create WebSocket client with auth', () => {
      wsClient = new WebSocketClient({
        url: 'ws://localhost:3000',
        auth: authClient,
        reconnect: false, // Disable reconnect for tests
      });

      expect(wsClient).toBeDefined();
      expect(wsClient.getState()).toBe('disconnected');
    });

    it('should attach auth context when authenticated', () => {
      wsClient = new WebSocketClient({
        url: 'ws://localhost:3000',
        auth: authClient,
        reconnect: false,
      });

      // Authenticate
      const context: AuthContext = {
        userId: 'user-123',
        roles: ['admin', 'user'],
        permissions: ['read', 'write'],
        scopes: ['api:read', 'api:write'],
      };

      authClient.setAuth({
        success: true,
        context,
        metadata: { token: 'ws-test-token' },
      });

      expect(authClient.isAuthenticated()).toBe(true);
      expect(authClient.getContext()).toEqual(context);
      expect(authClient.getToken()).toBe('ws-test-token');
    });
  });

  describe('Token Lifecycle', () => {
    it('should persist token across client instances', () => {
      // Set token in first client
      authClient.setToken('persistent-token');
      expect(storage.getToken()).toBe('persistent-token');

      // Create new client with same storage
      const newAuthClient = new AuthenticationClient({
        storage,
      });

      expect(newAuthClient.getToken()).toBe('persistent-token');
      expect(newAuthClient.isAuthenticated()).toBe(true);

      newAuthClient.destroy();
    });

    it('should clear token from storage', () => {
      authClient.setToken('temp-token');
      expect(storage.hasToken()).toBe(true);

      authClient.clearAuth();
      expect(storage.hasToken()).toBe(false);
    });
  });

  describe('Auth Context Tracking', () => {
    it('should track full auth context', () => {
      const context: AuthContext = {
        userId: 'user-456',
        roles: ['admin', 'moderator'],
        permissions: ['read', 'write', 'delete'],
        scopes: ['api:admin'],
        token: {
          type: 'bearer',
          expiresAt: new Date(Date.now() + 3600000),
          issuer: 'auth-server',
          audience: ['api-server'],
        },
        metadata: {
          sessionId: 'session-123',
          ipAddress: '192.168.1.1',
        },
      };

      authClient.setAuth({
        success: true,
        context,
        metadata: { token: 'full-context-token' },
      });

      const retrievedContext = authClient.getContext();
      expect(retrievedContext).toEqual(context);
      expect(retrievedContext?.roles).toContain('admin');
      expect(retrievedContext?.permissions).toContain('write');
      expect(retrievedContext?.scopes).toContain('api:admin');
      expect(retrievedContext?.metadata?.sessionId).toBe('session-123');
    });
  });
});
