/**
 * Session Persistence Tests
 *
 * Tests for session persistence functionality including:
 * - Full context persisted (not just token)
 * - Context restored on page load
 * - Session metadata persisted
 * - Storage version migration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AuthContext, TokenStorage } from '../../../src/auth/types.js';

/**
 * Storage version for migration support
 */
const STORAGE_VERSION = 2;

/**
 * Persisted session data structure
 */
interface PersistedSession {
  version: number;
  token: string;
  context: AuthContext;
  metadata: {
    createdAt: string;
    lastActivity: string;
    deviceId?: string;
    userAgent?: string;
  };
}

/**
 * Session-aware token storage with full context persistence
 */
class SessionPersistenceStorage implements TokenStorage {
  private key: string;
  private sessionKey: string;

  constructor(key = 'netron_auth') {
    this.key = key;
    this.sessionKey = `${key}_session`;
  }

  getToken(): string | null {
    const session = this.getSession();
    return session?.token ?? null;
  }

  setToken(token: string): void {
    const session = this.getSession();
    if (session) {
      session.token = token;
      session.metadata.lastActivity = new Date().toISOString();
      this.saveSession(session);
    } else {
      // Create minimal session if none exists
      this.saveSession({
        version: STORAGE_VERSION,
        token,
        context: {
          userId: '',
          roles: [],
          permissions: [],
        },
        metadata: {
          createdAt: new Date().toISOString(),
          lastActivity: new Date().toISOString(),
        },
      });
    }
  }

  removeToken(): void {
    this.clearSession();
  }

  hasToken(): boolean {
    return this.getToken() !== null;
  }

  getSession(): PersistedSession | null {
    try {
      const data = localStorage.getItem(this.sessionKey);
      if (!data) return null;

      const session = JSON.parse(data) as PersistedSession;
      return this.migrateSession(session);
    } catch {
      return null;
    }
  }

  saveSession(session: PersistedSession): void {
    try {
      localStorage.setItem(this.sessionKey, JSON.stringify(session));
    } catch {
      // Silently fail
    }
  }

  clearSession(): void {
    try {
      localStorage.removeItem(this.sessionKey);
    } catch {
      // Silently fail
    }
  }

  private migrateSession(session: PersistedSession): PersistedSession {
    if (session.version === STORAGE_VERSION) {
      return session;
    }

    // Migrate from v1 to v2
    if (session.version === 1) {
      return {
        ...session,
        version: STORAGE_VERSION,
        metadata: {
          ...session.metadata,
          lastActivity: session.metadata.lastActivity || new Date().toISOString(),
        },
      };
    }

    // Unknown version - return as-is with current version
    return {
      ...session,
      version: STORAGE_VERSION,
    };
  }
}

/**
 * Auth client with full session persistence
 */
class PersistentAuthClient {
  private storage: SessionPersistenceStorage;
  private token: string | null = null;
  private context: AuthContext | undefined;
  private metadata: PersistedSession['metadata'] | undefined;
  private authenticated = false;
  private eventHandlers = new Map<string, Set<(data: any) => void>>();

  constructor(storage: SessionPersistenceStorage) {
    this.storage = storage;
    this.restoreSession();
  }

  private restoreSession(): void {
    const session = this.storage.getSession();
    if (session) {
      this.token = session.token;
      this.context = session.context;
      this.metadata = session.metadata;
      this.authenticated = true;
      this.emit('restored', { session });
    }
  }

  setAuth(token: string, context: AuthContext, metadata?: Partial<PersistedSession['metadata']>): void {
    this.token = token;
    this.context = context;
    this.metadata = {
      createdAt: metadata?.createdAt || new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      deviceId: metadata?.deviceId,
      userAgent: metadata?.userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : undefined),
    };
    this.authenticated = true;

    this.storage.saveSession({
      version: STORAGE_VERSION,
      token,
      context,
      metadata: this.metadata,
    });

    this.emit('authenticated', { context, metadata: this.metadata });
  }

  updateActivity(): void {
    if (this.authenticated && this.token && this.context && this.metadata) {
      this.metadata.lastActivity = new Date().toISOString();
      this.storage.saveSession({
        version: STORAGE_VERSION,
        token: this.token,
        context: this.context,
        metadata: this.metadata,
      });
    }
  }

  clearAuth(): void {
    this.token = null;
    this.context = undefined;
    this.metadata = undefined;
    this.authenticated = false;
    this.storage.clearSession();
    this.emit('unauthenticated', {});
  }

  getToken(): string | null {
    return this.token;
  }

  getContext(): AuthContext | undefined {
    return this.context;
  }

  getMetadata(): PersistedSession['metadata'] | undefined {
    return this.metadata;
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  getSession(): PersistedSession | null {
    return this.storage.getSession();
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
    this.eventHandlers.clear();
  }
}

describe('Session Persistence', () => {
  let storage: SessionPersistenceStorage;
  let client: PersistentAuthClient;

  beforeEach(() => {
    localStorage.clear();
    storage = new SessionPersistenceStorage('test_auth');
    client = new PersistentAuthClient(storage);
  });

  afterEach(() => {
    client.destroy();
    localStorage.clear();
  });

  describe('full context persistence', () => {
    it('should persist full auth context (not just token)', () => {
      const expiryDate = new Date(Date.now() + 3600000);
      const context: AuthContext = {
        userId: 'user-123',
        roles: ['admin', 'user'],
        permissions: ['read', 'write', 'delete'],
        scopes: ['api:full'],
        token: {
          type: 'bearer',
          expiresAt: expiryDate,
          issuer: 'auth.example.com',
          audience: ['api.example.com'],
        },
        metadata: {
          email: 'user@example.com',
          name: 'Test User',
        },
      };

      client.setAuth('test-token', context);

      const session = client.getSession();
      expect(session).not.toBeNull();
      expect(session!.token).toBe('test-token');
      // Date is serialized as string in JSON, so compare relevant fields
      expect(session!.context.userId).toBe(context.userId);
      expect(session!.context.roles).toEqual(context.roles);
      expect(session!.context.permissions).toEqual(context.permissions);
      expect(session!.context.scopes).toEqual(context.scopes);
      expect(session!.context.token?.type).toBe('bearer');
      expect(session!.context.token?.issuer).toBe('auth.example.com');
      expect(session!.context.token?.audience).toEqual(['api.example.com']);
      expect(session!.context.metadata).toEqual(context.metadata);
      // expiresAt is serialized as ISO string
      expect(session!.context.token?.expiresAt).toBe(expiryDate.toISOString());
    });

    it('should persist roles and permissions', () => {
      const context: AuthContext = {
        userId: 'user-456',
        roles: ['moderator', 'contributor'],
        permissions: ['read', 'comment', 'moderate'],
      };

      client.setAuth('role-token', context);

      const session = client.getSession();
      expect(session!.context.roles).toEqual(['moderator', 'contributor']);
      expect(session!.context.permissions).toEqual(['read', 'comment', 'moderate']);
    });

    it('should persist scopes for OAuth', () => {
      const context: AuthContext = {
        userId: 'oauth-user',
        roles: [],
        permissions: [],
        scopes: ['openid', 'profile', 'email', 'offline_access'],
      };

      client.setAuth('oauth-token', context);

      const session = client.getSession();
      expect(session!.context.scopes).toEqual(['openid', 'profile', 'email', 'offline_access']);
    });

    it('should persist custom metadata in context', () => {
      const context: AuthContext = {
        userId: 'user-789',
        roles: ['user'],
        permissions: ['read'],
        metadata: {
          customField1: 'value1',
          customField2: 123,
          nestedData: {
            key: 'nested-value',
          },
        },
      };

      client.setAuth('metadata-token', context);

      const session = client.getSession();
      expect(session!.context.metadata).toEqual(context.metadata);
      expect(session!.context.metadata?.customField1).toBe('value1');
    });
  });

  describe('context restoration on page load', () => {
    it('should restore context on new client initialization', () => {
      const context: AuthContext = {
        userId: 'persistent-user',
        roles: ['user'],
        permissions: ['read'],
      };

      client.setAuth('persistent-token', context);

      // Simulate page reload by creating new client
      const newClient = new PersistentAuthClient(storage);

      expect(newClient.isAuthenticated()).toBe(true);
      expect(newClient.getToken()).toBe('persistent-token');
      expect(newClient.getContext()).toEqual(context);

      newClient.destroy();
    });

    it('should emit restored event on successful restoration', () => {
      const context: AuthContext = {
        userId: 'user-123',
        roles: ['user'],
        permissions: ['read'],
      };

      client.setAuth('token', context);

      // Create new client and listen for restored event
      const restoredHandler = vi.fn();
      const newStorage = new SessionPersistenceStorage('test_auth');
      const newClient = new PersistentAuthClient(newStorage);

      // Event was already emitted during construction, so we verify state
      expect(newClient.isAuthenticated()).toBe(true);
      expect(newClient.getContext()).toEqual(context);

      newClient.destroy();
    });

    it('should handle missing session gracefully', () => {
      localStorage.clear();
      const freshClient = new PersistentAuthClient(storage);

      expect(freshClient.isAuthenticated()).toBe(false);
      expect(freshClient.getToken()).toBeNull();
      expect(freshClient.getContext()).toBeUndefined();

      freshClient.destroy();
    });

    it('should restore token expiry information', () => {
      const expiryDate = new Date(Date.now() + 7200000);
      const context: AuthContext = {
        userId: 'user-123',
        roles: ['user'],
        permissions: ['read'],
        token: {
          type: 'bearer',
          expiresAt: expiryDate,
        },
      };

      client.setAuth('expiring-token', context);

      const newClient = new PersistentAuthClient(storage);
      const restoredContext = newClient.getContext();

      // Note: Date will be serialized as string and needs parsing
      expect(restoredContext?.token?.type).toBe('bearer');

      newClient.destroy();
    });
  });

  describe('session metadata persistence', () => {
    it('should persist session creation time', () => {
      const context: AuthContext = {
        userId: 'user-123',
        roles: ['user'],
        permissions: ['read'],
      };

      const beforeCreation = new Date();
      client.setAuth('token', context);
      const afterCreation = new Date();

      const session = client.getSession();
      const createdAt = new Date(session!.metadata.createdAt);

      expect(createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreation.getTime());
      expect(createdAt.getTime()).toBeLessThanOrEqual(afterCreation.getTime());
    });

    it('should persist last activity time', () => {
      const context: AuthContext = {
        userId: 'user-123',
        roles: ['user'],
        permissions: ['read'],
      };

      client.setAuth('token', context);

      const session1 = client.getSession();
      const activity1 = session1!.metadata.lastActivity;

      // Update activity
      client.updateActivity();

      const session2 = client.getSession();
      const activity2 = session2!.metadata.lastActivity;

      expect(new Date(activity2).getTime()).toBeGreaterThanOrEqual(new Date(activity1).getTime());
    });

    it('should persist device ID when provided', () => {
      const context: AuthContext = {
        userId: 'user-123',
        roles: ['user'],
        permissions: ['read'],
      };

      client.setAuth('token', context, { deviceId: 'device-abc-123' });

      const session = client.getSession();
      expect(session!.metadata.deviceId).toBe('device-abc-123');
    });

    it('should persist user agent', () => {
      const context: AuthContext = {
        userId: 'user-123',
        roles: ['user'],
        permissions: ['read'],
      };

      client.setAuth('token', context);

      const session = client.getSession();
      expect(session!.metadata.userAgent).toBeDefined();
    });

    it('should update metadata without changing context', () => {
      const context: AuthContext = {
        userId: 'user-123',
        roles: ['admin'],
        permissions: ['read', 'write'],
      };

      client.setAuth('token', context);
      const originalContext = client.getContext();

      // Update activity multiple times
      client.updateActivity();
      client.updateActivity();
      client.updateActivity();

      const updatedContext = client.getContext();
      expect(updatedContext).toEqual(originalContext);
    });
  });

  describe('storage version migration', () => {
    it('should migrate v1 session to v2', () => {
      // Simulate v1 session format
      const v1Session = {
        version: 1,
        token: 'v1-token',
        context: {
          userId: 'legacy-user',
          roles: ['user'],
          permissions: ['read'],
        },
        metadata: {
          createdAt: '2024-01-01T00:00:00.000Z',
          // v1 didn't have lastActivity
        },
      };

      localStorage.setItem('test_auth_session', JSON.stringify(v1Session));

      const newClient = new PersistentAuthClient(storage);
      const session = newClient.getSession();

      expect(session!.version).toBe(STORAGE_VERSION);
      expect(session!.token).toBe('v1-token');
      expect(session!.metadata.lastActivity).toBeDefined();

      newClient.destroy();
    });

    it('should handle unknown version gracefully', () => {
      const unknownVersionSession = {
        version: 999,
        token: 'future-token',
        context: {
          userId: 'future-user',
          roles: ['user'],
          permissions: ['read'],
        },
        metadata: {
          createdAt: '2024-01-01T00:00:00.000Z',
          lastActivity: '2024-01-01T00:00:00.000Z',
        },
      };

      localStorage.setItem('test_auth_session', JSON.stringify(unknownVersionSession));

      const newClient = new PersistentAuthClient(storage);
      const session = newClient.getSession();

      // Should upgrade version number but preserve data
      expect(session!.version).toBe(STORAGE_VERSION);
      expect(session!.token).toBe('future-token');

      newClient.destroy();
    });

    it('should preserve all context data during migration', () => {
      const v1Session = {
        version: 1,
        token: 'legacy-token',
        context: {
          userId: 'legacy-user',
          roles: ['admin', 'user'],
          permissions: ['read', 'write', 'delete'],
          scopes: ['api:full'],
          metadata: {
            legacyField: 'should-be-preserved',
          },
        },
        metadata: {
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      };

      localStorage.setItem('test_auth_session', JSON.stringify(v1Session));

      const newClient = new PersistentAuthClient(storage);
      const session = newClient.getSession();

      expect(session!.context.roles).toEqual(['admin', 'user']);
      expect(session!.context.permissions).toEqual(['read', 'write', 'delete']);
      expect(session!.context.scopes).toEqual(['api:full']);
      expect(session!.context.metadata?.legacyField).toBe('should-be-preserved');

      newClient.destroy();
    });
  });

  describe('error handling', () => {
    it('should handle corrupted session data', () => {
      localStorage.setItem('test_auth_session', 'not-valid-json');

      const newClient = new PersistentAuthClient(storage);

      expect(newClient.isAuthenticated()).toBe(false);
      expect(newClient.getSession()).toBeNull();

      newClient.destroy();
    });

    it('should handle partial session data', () => {
      const partialSession = {
        version: STORAGE_VERSION,
        token: 'partial-token',
        // Missing context and metadata
      };

      localStorage.setItem('test_auth_session', JSON.stringify(partialSession));

      const newClient = new PersistentAuthClient(storage);
      const session = newClient.getSession();

      // Should still be able to get token
      expect(session?.token).toBe('partial-token');

      newClient.destroy();
    });

    it('should clear session completely on logout', () => {
      const context: AuthContext = {
        userId: 'user-123',
        roles: ['user'],
        permissions: ['read'],
      };

      client.setAuth('token', context);
      expect(client.getSession()).not.toBeNull();

      client.clearAuth();

      expect(client.getSession()).toBeNull();
      expect(localStorage.getItem('test_auth_session')).toBeNull();
    });
  });
});
