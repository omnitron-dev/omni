/**
 * Cross-Tab Synchronization Tests
 *
 * Tests for cross-tab auth synchronization including:
 * - StorageEvent triggers state update
 * - Login in one tab syncs to others
 * - Logout in one tab syncs to others
 * - Conflicting states resolved correctly
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { AuthContext, TokenStorage } from '../../../src/auth/types.js';

/**
 * Cross-tab aware token storage
 */
class CrossTabTokenStorage implements TokenStorage {
  private key: string;
  private listeners: Set<(event: StorageEvent) => void> = new Set();

  constructor(key = 'netron_auth_token') {
    this.key = key;
  }

  getToken(): string | null {
    try {
      return localStorage.getItem(this.key);
    } catch {
      return null;
    }
  }

  setToken(token: string): void {
    try {
      localStorage.setItem(this.key, token);
    } catch {
      // Silently fail
    }
  }

  removeToken(): void {
    try {
      localStorage.removeItem(this.key);
    } catch {
      // Silently fail
    }
  }

  hasToken(): boolean {
    return this.getToken() !== null;
  }

  getKey(): string {
    return this.key;
  }

  onStorageChange(callback: (event: StorageEvent) => void): () => void {
    this.listeners.add(callback);
    window.addEventListener('storage', callback);
    return () => {
      this.listeners.delete(callback);
      window.removeEventListener('storage', callback);
    };
  }
}

/**
 * Cross-tab aware auth client
 */
class CrossTabAuthClient {
  private storage: CrossTabTokenStorage;
  private token: string | null = null;
  private context: AuthContext | undefined;
  private authenticated = false;
  private eventHandlers = new Map<string, Set<(data: any) => void>>();
  private unsubscribeStorage: (() => void) | null = null;
  private lastUpdateTimestamp = 0;

  constructor(storage: CrossTabTokenStorage) {
    this.storage = storage;
    this.restoreFromStorage();
    this.setupCrossTabSync();
  }

  private restoreFromStorage(): void {
    const token = this.storage.getToken();
    if (token) {
      this.token = token;
      this.authenticated = true;
    }
  }

  private setupCrossTabSync(): void {
    this.unsubscribeStorage = this.storage.onStorageChange((event) => {
      if (event.key === this.storage.getKey()) {
        this.handleStorageChange(event);
      }
    });
  }

  private handleStorageChange(event: StorageEvent): void {
    const now = Date.now();

    if (event.newValue === null) {
      // Token was removed (logout in another tab)
      this.handleRemoteLogout();
    } else if (event.newValue !== this.token) {
      // Token was changed (login or refresh in another tab)
      this.handleRemoteLogin(event.newValue, now);
    }
  }

  private handleRemoteLogout(): void {
    this.token = null;
    this.context = undefined;
    this.authenticated = false;
    this.emit('sync', { type: 'logout', source: 'remote' });
    this.emit('unauthenticated', { source: 'remote' });
  }

  private handleRemoteLogin(newToken: string, timestamp: number): void {
    // Remote storage events always represent the current truth from localStorage
    // Accept the new token since it came from a storage event (another tab updated it)
    this.token = newToken;
    this.authenticated = true;
    this.lastUpdateTimestamp = timestamp;
    this.emit('sync', { type: 'login', source: 'remote', token: newToken });
    this.emit('authenticated', { source: 'remote' });
  }

  setAuth(token: string, context?: AuthContext): void {
    this.token = token;
    this.context = context;
    this.authenticated = true;
    this.lastUpdateTimestamp = Date.now();
    this.storage.setToken(token);
    this.emit('authenticated', { source: 'local' });
  }

  clearAuth(): void {
    this.token = null;
    this.context = undefined;
    this.authenticated = false;
    this.storage.removeToken();
    this.emit('unauthenticated', { source: 'local' });
  }

  getToken(): string | null {
    return this.token;
  }

  getContext(): AuthContext | undefined {
    return this.context;
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  on(event: string, handler: (data: any) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  off(event: string, handler: (data: any) => void): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  private emit(event: string, data: any): void {
    this.eventHandlers.get(event)?.forEach((handler) => {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in ${event} handler:`, error);
      }
    });
  }

  destroy(): void {
    this.unsubscribeStorage?.();
    this.eventHandlers.clear();
  }
}

/**
 * Simulate storage event from another tab
 */
function simulateStorageEvent(key: string, oldValue: string | null, newValue: string | null): void {
  const event = new StorageEvent('storage', {
    key,
    oldValue,
    newValue,
    storageArea: localStorage,
  });
  window.dispatchEvent(event);
}

describe('Cross-Tab Synchronization', () => {
  let storage: CrossTabTokenStorage;
  let client: CrossTabAuthClient;

  beforeEach(() => {
    localStorage.clear();
    storage = new CrossTabTokenStorage('test_auth_token');
    client = new CrossTabAuthClient(storage);
  });

  afterEach(() => {
    client.destroy();
    localStorage.clear();
  });

  describe('storage event handling', () => {
    it('should update state when storage event triggers', async () => {
      const syncHandler = vi.fn();
      client.on('sync', syncHandler);

      // Simulate login from another tab
      localStorage.setItem('test_auth_token', 'remote-token');
      simulateStorageEvent('test_auth_token', null, 'remote-token');

      expect(syncHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'login',
          source: 'remote',
          token: 'remote-token',
        })
      );
    });

    it('should ignore storage events for different keys', () => {
      const syncHandler = vi.fn();
      client.on('sync', syncHandler);

      // Simulate storage change for different key
      simulateStorageEvent('other_key', null, 'some-value');

      expect(syncHandler).not.toHaveBeenCalled();
    });

    it('should handle storage event with null values', () => {
      client.setAuth('initial-token');
      const syncHandler = vi.fn();
      client.on('sync', syncHandler);

      // Simulate logout from another tab
      simulateStorageEvent('test_auth_token', 'initial-token', null);

      expect(syncHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'logout',
          source: 'remote',
        })
      );
    });
  });

  describe('login synchronization', () => {
    it('should sync login from another tab', () => {
      expect(client.isAuthenticated()).toBe(false);

      // Simulate login in another tab
      localStorage.setItem('test_auth_token', 'synced-token');
      simulateStorageEvent('test_auth_token', null, 'synced-token');

      expect(client.isAuthenticated()).toBe(true);
      expect(client.getToken()).toBe('synced-token');
    });

    it('should emit authenticated event on remote login', () => {
      const authHandler = vi.fn();
      client.on('authenticated', authHandler);

      localStorage.setItem('test_auth_token', 'new-token');
      simulateStorageEvent('test_auth_token', null, 'new-token');

      expect(authHandler).toHaveBeenCalledWith({ source: 'remote' });
    });

    it('should update token when changed in another tab', () => {
      client.setAuth('original-token');
      expect(client.getToken()).toBe('original-token');

      // Simulate token refresh in another tab
      localStorage.setItem('test_auth_token', 'refreshed-token');
      simulateStorageEvent('test_auth_token', 'original-token', 'refreshed-token');

      expect(client.getToken()).toBe('refreshed-token');
    });
  });

  describe('logout synchronization', () => {
    it('should sync logout from another tab', () => {
      client.setAuth('active-token');
      expect(client.isAuthenticated()).toBe(true);

      // Simulate logout in another tab
      localStorage.removeItem('test_auth_token');
      simulateStorageEvent('test_auth_token', 'active-token', null);

      expect(client.isAuthenticated()).toBe(false);
      expect(client.getToken()).toBeNull();
    });

    it('should emit unauthenticated event on remote logout', () => {
      client.setAuth('active-token');

      const unauthHandler = vi.fn();
      client.on('unauthenticated', unauthHandler);

      localStorage.removeItem('test_auth_token');
      simulateStorageEvent('test_auth_token', 'active-token', null);

      expect(unauthHandler).toHaveBeenCalledWith({ source: 'remote' });
    });

    it('should clear context on remote logout', () => {
      const context: AuthContext = {
        userId: 'user-123',
        roles: ['user'],
        permissions: ['read'],
      };

      client.setAuth('active-token', context);
      expect(client.getContext()).toEqual(context);

      // Simulate logout from another tab
      localStorage.removeItem('test_auth_token');
      simulateStorageEvent('test_auth_token', 'active-token', null);

      expect(client.getContext()).toBeUndefined();
    });
  });

  describe('conflict resolution', () => {
    it('should accept remote token updates via storage events', () => {
      // Set initial token locally
      client.setAuth('initial-token');

      // Simulate token update from another tab via storage event
      // Storage events represent the authoritative state from localStorage
      localStorage.setItem('test_auth_token', 'remote-updated-token');
      simulateStorageEvent('test_auth_token', 'initial-token', 'remote-updated-token');

      // The remote token should be accepted since storage events are authoritative
      expect(client.getToken()).toBe('remote-updated-token');
    });

    it('should handle rapid successive updates', async () => {
      const syncHandler = vi.fn();
      client.on('sync', syncHandler);

      // Simulate rapid updates from another tab
      localStorage.setItem('test_auth_token', 'token-1');
      simulateStorageEvent('test_auth_token', null, 'token-1');

      localStorage.setItem('test_auth_token', 'token-2');
      simulateStorageEvent('test_auth_token', 'token-1', 'token-2');

      localStorage.setItem('test_auth_token', 'token-3');
      simulateStorageEvent('test_auth_token', 'token-2', 'token-3');

      expect(client.getToken()).toBe('token-3');
      expect(syncHandler).toHaveBeenCalledTimes(3);
    });

    it('should handle concurrent login and logout', () => {
      client.setAuth('active-token');

      // Simulate logout
      localStorage.removeItem('test_auth_token');
      simulateStorageEvent('test_auth_token', 'active-token', null);

      expect(client.isAuthenticated()).toBe(false);

      // Immediately followed by login
      localStorage.setItem('test_auth_token', 'new-session-token');
      simulateStorageEvent('test_auth_token', null, 'new-session-token');

      expect(client.isAuthenticated()).toBe(true);
      expect(client.getToken()).toBe('new-session-token');
    });

    it('should maintain consistency with local changes', () => {
      // Local login
      client.setAuth('local-token');
      expect(storage.getToken()).toBe('local-token');
      expect(client.getToken()).toBe('local-token');

      // Local logout
      client.clearAuth();
      expect(storage.getToken()).toBeNull();
      expect(client.getToken()).toBeNull();
    });
  });

  describe('multiple clients', () => {
    it('should sync between multiple client instances', () => {
      const client2 = new CrossTabAuthClient(storage);

      const sync1Handler = vi.fn();
      const sync2Handler = vi.fn();
      client.on('sync', sync1Handler);
      client2.on('sync', sync2Handler);

      // Login via client1 (won't trigger sync for client1 since it's local)
      client.setAuth('shared-token');

      // Simulate storage event for client2
      simulateStorageEvent('test_auth_token', null, 'shared-token');

      // client2 should receive the sync
      expect(sync2Handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'login',
          source: 'remote',
        })
      );

      expect(client2.getToken()).toBe('shared-token');

      client2.destroy();
    });
  });

  describe('edge cases', () => {
    it('should handle empty token string', () => {
      localStorage.setItem('test_auth_token', '');
      simulateStorageEvent('test_auth_token', null, '');

      // Empty string is truthy for token check but might need special handling
      expect(client.getToken()).toBe('');
    });

    it('should clean up event listeners on destroy', () => {
      const syncHandler = vi.fn();
      client.on('sync', syncHandler);

      client.destroy();

      // Events after destroy should not trigger handler
      localStorage.setItem('test_auth_token', 'after-destroy-token');
      simulateStorageEvent('test_auth_token', null, 'after-destroy-token');

      expect(syncHandler).not.toHaveBeenCalled();
    });

    it('should restore state from storage on initialization', () => {
      localStorage.setItem('test_auth_token', 'pre-existing-token');

      const newClient = new CrossTabAuthClient(storage);

      expect(newClient.isAuthenticated()).toBe(true);
      expect(newClient.getToken()).toBe('pre-existing-token');

      newClient.destroy();
    });
  });
});
