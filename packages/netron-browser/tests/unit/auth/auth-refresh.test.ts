/**
 * Token Refresh Tests
 *
 * Tests for token refresh functionality including:
 * - Token refresh calls server
 * - Refresh coalescing works (concurrent calls)
 * - Refresh failure triggers logout
 * - Refresh updates stored tokens
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { AuthenticationClient } from '../../../src/auth/client.js';
import { MemoryTokenStorage } from '../../../src/auth/storage.js';
import type { AuthContext, AuthResult, TokenStorage } from '../../../src/auth/types.js';

/**
 * Extended AuthenticationClient with refresh capabilities for testing
 */
class RefreshableAuthClient extends AuthenticationClient {
  private refreshPromise: Promise<AuthResult> | null = null;
  private refreshFn: (() => Promise<AuthResult>) | null = null;

  constructor(
    options: {
      storage?: TokenStorage;
      autoRefresh?: boolean;
      refreshThreshold?: number;
    } = {}
  ) {
    super(options);
  }

  /**
   * Set the refresh function
   */
  setRefreshFunction(fn: () => Promise<AuthResult>): void {
    this.refreshFn = fn;
  }

  /**
   * Perform token refresh with coalescing
   */
  async refreshToken(): Promise<AuthResult> {
    // Coalesce concurrent refresh calls
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    if (!this.refreshFn) {
      throw new Error('No refresh function configured');
    }

    this.refreshPromise = this.refreshFn()
      .then((result) => {
        if (result.success) {
          this.setAuth(result);
          this.emit('token-refreshed', { success: true });
        } else {
          this.clearAuth();
          this.emit('error', { error: result.error });
        }
        return result;
      })
      .finally(() => {
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }

  /**
   * Check if a refresh is currently in progress
   */
  isRefreshing(): boolean {
    return this.refreshPromise !== null;
  }

  /**
   * Emit event (expose for testing)
   */
  emit(event: 'authenticated' | 'unauthenticated' | 'token-refreshed' | 'error', data: any): void {
    // Access private method via casting
    (this as any).eventHandlers.get(event)?.forEach((handler: (data: any) => void) => {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in ${event} handler:`, error);
      }
    });
  }
}

describe('Token Refresh', () => {
  let client: RefreshableAuthClient;
  let storage: MemoryTokenStorage;
  let mockRefresh: Mock<() => Promise<AuthResult>>;

  beforeEach(() => {
    storage = new MemoryTokenStorage();
    client = new RefreshableAuthClient({
      storage,
      autoRefresh: true,
      refreshThreshold: 5 * 60 * 1000, // 5 minutes
    });

    mockRefresh = vi.fn();
    client.setRefreshFunction(mockRefresh);
  });

  afterEach(() => {
    client.destroy();
    vi.clearAllMocks();
  });

  describe('basic refresh functionality', () => {
    it('should call server for token refresh', async () => {
      const newContext: AuthContext = {
        userId: 'user-123',
        roles: ['user'],
        permissions: ['read'],
        token: {
          type: 'bearer',
          expiresAt: new Date(Date.now() + 3600000),
        },
      };

      mockRefresh.mockResolvedValueOnce({
        success: true,
        context: newContext,
        metadata: { token: 'new-access-token' },
      });

      // Set initial auth
      client.setToken('old-token');
      expect(client.getToken()).toBe('old-token');

      // Refresh
      const result = await client.refreshToken();

      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(client.getToken()).toBe('new-access-token');
    });

    it('should update stored tokens after refresh', async () => {
      const newContext: AuthContext = {
        userId: 'user-456',
        roles: ['admin'],
        permissions: ['read', 'write'],
        token: {
          type: 'bearer',
          expiresAt: new Date(Date.now() + 7200000),
        },
      };

      mockRefresh.mockResolvedValueOnce({
        success: true,
        context: newContext,
        metadata: { token: 'refreshed-token' },
      });

      client.setToken('initial-token');
      await client.refreshToken();

      expect(storage.getToken()).toBe('refreshed-token');
      expect(client.getContext()).toEqual(newContext);
    });

    it('should emit token-refreshed event on success', async () => {
      const handler = vi.fn();
      client.on('token-refreshed', handler);

      mockRefresh.mockResolvedValueOnce({
        success: true,
        context: {
          userId: 'user-123',
          roles: ['user'],
          permissions: ['read'],
        },
        metadata: { token: 'new-token' },
      });

      await client.refreshToken();

      expect(handler).toHaveBeenCalledWith({ success: true });
    });

    it('should update expiry time after refresh', async () => {
      const futureDate = new Date(Date.now() + 3600000);

      mockRefresh.mockResolvedValueOnce({
        success: true,
        context: {
          userId: 'user-123',
          roles: ['user'],
          permissions: ['read'],
          token: {
            type: 'bearer',
            expiresAt: futureDate,
          },
        },
        metadata: { token: 'new-token' },
      });

      await client.refreshToken();

      const state = client.getState();
      expect(state.expiresAt).toEqual(futureDate);
    });
  });

  describe('refresh coalescing', () => {
    it('should coalesce concurrent refresh calls', async () => {
      const newContext: AuthContext = {
        userId: 'user-123',
        roles: ['user'],
        permissions: ['read'],
      };

      // Simulate slow refresh
      mockRefresh.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                success: true,
                context: newContext,
                metadata: { token: 'coalesced-token' },
              });
            }, 100);
          })
      );

      // Start multiple refresh calls concurrently
      const refreshPromises = [client.refreshToken(), client.refreshToken(), client.refreshToken()];

      // All should be refreshing
      expect(client.isRefreshing()).toBe(true);

      // Wait for all to complete
      const results = await Promise.all(refreshPromises);

      // Only one actual refresh call should have been made
      expect(mockRefresh).toHaveBeenCalledTimes(1);

      // All results should be identical
      expect(results[0]).toBe(results[1]);
      expect(results[1]).toBe(results[2]);
      expect(results[0].success).toBe(true);
    });

    it('should allow new refresh after previous completes', async () => {
      mockRefresh.mockResolvedValue({
        success: true,
        context: {
          userId: 'user-123',
          roles: ['user'],
          permissions: ['read'],
        },
        metadata: { token: 'token-1' },
      });

      // First refresh
      await client.refreshToken();
      expect(mockRefresh).toHaveBeenCalledTimes(1);

      // After completion, should allow another refresh
      mockRefresh.mockResolvedValue({
        success: true,
        context: {
          userId: 'user-123',
          roles: ['user'],
          permissions: ['read'],
        },
        metadata: { token: 'token-2' },
      });

      await client.refreshToken();
      expect(mockRefresh).toHaveBeenCalledTimes(2);
    });

    it('should clear refresh promise after completion', async () => {
      mockRefresh.mockResolvedValueOnce({
        success: true,
        context: {
          userId: 'user-123',
          roles: ['user'],
          permissions: ['read'],
        },
        metadata: { token: 'new-token' },
      });

      expect(client.isRefreshing()).toBe(false);

      const refreshPromise = client.refreshToken();
      expect(client.isRefreshing()).toBe(true);

      await refreshPromise;
      expect(client.isRefreshing()).toBe(false);
    });
  });

  describe('refresh failure handling', () => {
    it('should trigger logout on refresh failure', async () => {
      const unauthHandler = vi.fn();
      client.on('unauthenticated', unauthHandler);

      client.setToken('old-token');

      mockRefresh.mockResolvedValueOnce({
        success: false,
        error: 'Refresh token expired',
      });

      const result = await client.refreshToken();

      expect(result.success).toBe(false);
      expect(client.isAuthenticated()).toBe(false);
      expect(client.getToken()).toBeUndefined();
      expect(storage.hasToken()).toBe(false);
    });

    it('should emit error event on refresh failure', async () => {
      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      mockRefresh.mockResolvedValueOnce({
        success: false,
        error: 'Invalid refresh token',
      });

      await client.refreshToken();

      expect(errorHandler).toHaveBeenCalledWith({ error: 'Invalid refresh token' });
    });

    it('should handle network errors during refresh', async () => {
      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      mockRefresh.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.refreshToken()).rejects.toThrow('Network error');
    });

    it('should clear refresh promise on error', async () => {
      mockRefresh.mockRejectedValueOnce(new Error('Refresh failed'));

      expect(client.isRefreshing()).toBe(false);

      const refreshPromise = client.refreshToken();
      expect(client.isRefreshing()).toBe(true);

      await expect(refreshPromise).rejects.toThrow();
      expect(client.isRefreshing()).toBe(false);
    });
  });

  describe('refresh with different token types', () => {
    it('should handle bearer token refresh', async () => {
      mockRefresh.mockResolvedValueOnce({
        success: true,
        context: {
          userId: 'user-123',
          roles: ['user'],
          permissions: ['read'],
          token: {
            type: 'bearer',
            expiresAt: new Date(Date.now() + 3600000),
          },
        },
        metadata: { token: 'bearer-token' },
      });

      const result = await client.refreshToken();

      expect(result.success).toBe(true);
      expect(client.getAuthHeaders()).toEqual({
        Authorization: 'Bearer bearer-token',
      });
    });

    it('should handle refresh with extended context', async () => {
      const extendedContext: AuthContext = {
        userId: 'user-123',
        roles: ['admin', 'user'],
        permissions: ['read', 'write', 'delete'],
        scopes: ['api:full'],
        token: {
          type: 'bearer',
          expiresAt: new Date(Date.now() + 3600000),
          issuer: 'auth.example.com',
          audience: ['api.example.com'],
        },
        metadata: {
          refreshCount: 1,
          lastRefresh: new Date().toISOString(),
        },
      };

      mockRefresh.mockResolvedValueOnce({
        success: true,
        context: extendedContext,
        metadata: { token: 'extended-token' },
      });

      await client.refreshToken();

      const context = client.getContext();
      expect(context).toEqual(extendedContext);
      expect(context?.scopes).toContain('api:full');
      expect(context?.token?.issuer).toBe('auth.example.com');
    });
  });

  describe('refresh timing', () => {
    it('should detect when token needs refresh', () => {
      const nearExpiryContext: AuthContext = {
        userId: 'user-123',
        roles: ['user'],
        permissions: ['read'],
        token: {
          type: 'bearer',
          expiresAt: new Date(Date.now() + 2 * 60 * 1000), // 2 minutes from now
        },
      };

      client.setAuth({
        success: true,
        context: nearExpiryContext,
        metadata: { token: 'expiring-token' },
      });

      // With 5 minute threshold, 2 minutes until expiry should need refresh
      expect(client.needsRefresh()).toBe(true);
    });

    it('should not need refresh when token has long validity', () => {
      const longValidContext: AuthContext = {
        userId: 'user-123',
        roles: ['user'],
        permissions: ['read'],
        token: {
          type: 'bearer',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes from now
        },
      };

      client.setAuth({
        success: true,
        context: longValidContext,
        metadata: { token: 'valid-token' },
      });

      // With 5 minute threshold, 30 minutes until expiry should not need refresh
      expect(client.needsRefresh()).toBe(false);
    });
  });
});
