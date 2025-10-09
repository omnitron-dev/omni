/**
 * Tests for SessionManager
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  SessionManager,
} from '../../../src/netron/auth/session-manager.js';
import type { AuthContext } from '../../../src/netron/auth/types.js';

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let mockLogger: any;

  const createMockAuthContext = (userId: string): AuthContext => ({
    userId,
    roles: ['user'],
    permissions: ['read:documents'],
  });

  beforeEach(() => {
    mockLogger = {
      child: jest.fn().mockReturnThis(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    sessionManager = new SessionManager(mockLogger, {
      autoCleanup: false, // Disable auto-cleanup for tests
    });
  });

  afterEach(async () => {
    await sessionManager.destroy();
  });

  describe('createSession', () => {
    it('should create a new session', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);

      const session = await sessionManager.createSession(userId, context);

      expect(session).toBeDefined();
      expect(session.sessionId).toBeDefined();
      expect(session.userId).toBe(userId);
      expect(session.context).toEqual(context);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastActivityAt).toBeInstanceOf(Date);
      expect(session.expiresAt).toBeInstanceOf(Date);
    });

    it('should create session with custom session ID', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);
      const customSessionId = 'custom-session-id';

      const session = await sessionManager.createSession(userId, context, {
        sessionId: customSessionId,
      });

      expect(session.sessionId).toBe(customSessionId);
    });

    it('should create session with custom TTL', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);
      const customTTL = 60 * 60 * 1000; // 1 hour

      const session = await sessionManager.createSession(userId, context, {
        ttl: customTTL,
      });

      const expectedExpiry = session.createdAt.getTime() + customTTL;
      expect(session.expiresAt.getTime()).toBeCloseTo(expectedExpiry, -2);
    });

    it('should create session with device information', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);
      const device = {
        id: 'device-123',
        name: 'iPhone 13',
        type: 'mobile',
        userAgent: 'Mozilla/5.0...',
      };

      const session = await sessionManager.createSession(userId, context, {
        device,
      });

      expect(session.device).toEqual(device);
    });

    it('should create session with metadata', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);
      const metadata = {
        ipAddress: '192.168.1.1',
        location: 'New York',
      };

      const session = await sessionManager.createSession(userId, context, {
        metadata,
      });

      expect(session.metadata).toEqual(metadata);
    });

    it('should enforce max sessions per user limit', async () => {
      const manager = new SessionManager(mockLogger, {
        maxSessionsPerUser: 2,
        autoCleanup: false,
      });

      const userId = 'user123';
      const context = createMockAuthContext(userId);

      // Create 3 sessions for the same user
      const session1 = await manager.createSession(userId, context);
      const session2 = await manager.createSession(userId, context);
      const session3 = await manager.createSession(userId, context);

      // Should only have 2 sessions (oldest was removed)
      const userSessions = await manager.getUserSessions(userId);
      expect(userSessions).toHaveLength(2);

      // Session 1 should be removed
      const removedSession = await manager.getSession(session1.sessionId);
      expect(removedSession).toBeNull();

      // Sessions 2 and 3 should still exist
      expect(userSessions.find((s) => s.sessionId === session2.sessionId)).toBeDefined();
      expect(userSessions.find((s) => s.sessionId === session3.sessionId)).toBeDefined();

      await manager.destroy();
    });
  });

  describe('getSession', () => {
    it('should retrieve an existing session', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);

      const createdSession = await sessionManager.createSession(userId, context);
      const retrievedSession = await sessionManager.getSession(createdSession.sessionId);

      expect(retrievedSession).toBeDefined();
      expect(retrievedSession?.sessionId).toBe(createdSession.sessionId);
    });

    it('should return null for non-existent session', async () => {
      const session = await sessionManager.getSession('non-existent-id');
      expect(session).toBeNull();
    });

    it('should return null for expired session', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);

      // Create session with 1ms TTL
      const session = await sessionManager.createSession(userId, context, {
        ttl: 1,
      });

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      const retrievedSession = await sessionManager.getSession(session.sessionId);
      expect(retrievedSession).toBeNull();
    });

    it('should update last activity timestamp when retrieving session', async () => {
      const manager = new SessionManager(mockLogger, {
        trackActivity: true,
        autoCleanup: false,
      });

      const userId = 'user123';
      const context = createMockAuthContext(userId);

      const session = await manager.createSession(userId, context);
      const originalActivityTime = session.lastActivityAt.getTime();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      const retrievedSession = await manager.getSession(session.sessionId);
      expect(retrievedSession?.lastActivityAt.getTime()).toBeGreaterThan(
        originalActivityTime,
      );

      await manager.destroy();
    });

    it('should not update last activity when tracking is disabled', async () => {
      const manager = new SessionManager(mockLogger, {
        trackActivity: false,
        autoCleanup: false,
      });

      const userId = 'user123';
      const context = createMockAuthContext(userId);

      const session = await manager.createSession(userId, context);
      const originalActivityTime = session.lastActivityAt.getTime();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      const retrievedSession = await manager.getSession(session.sessionId);
      expect(retrievedSession?.lastActivityAt.getTime()).toBe(originalActivityTime);

      await manager.destroy();
    });
  });

  describe('getUserSessions', () => {
    it('should retrieve all sessions for a user', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);

      await sessionManager.createSession(userId, context);
      await sessionManager.createSession(userId, context);
      await sessionManager.createSession(userId, context);

      const userSessions = await sessionManager.getUserSessions(userId);
      expect(userSessions).toHaveLength(3);
      userSessions.forEach((session) => {
        expect(session.userId).toBe(userId);
      });
    });

    it('should return empty array for user with no sessions', async () => {
      const userSessions = await sessionManager.getUserSessions('no-sessions-user');
      expect(userSessions).toEqual([]);
    });

    it('should exclude expired sessions', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);

      // Create one valid session and one expired session
      await sessionManager.createSession(userId, context);
      await sessionManager.createSession(userId, context, { ttl: 1 });

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      const userSessions = await sessionManager.getUserSessions(userId);
      expect(userSessions).toHaveLength(1);
    });
  });

  describe('updateSession', () => {
    it('should update session context', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);

      const session = await sessionManager.createSession(userId, context);

      const newContext: AuthContext = {
        userId,
        roles: ['admin', 'user'],
        permissions: ['read:documents', 'write:documents'],
      };

      const updatedSession = await sessionManager.updateSession(session.sessionId, {
        context: newContext,
      });

      expect(updatedSession?.context).toEqual(newContext);
    });

    it('should update session expiration', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);

      const session = await sessionManager.createSession(userId, context);
      const newExpiresAt = new Date(Date.now() + 60 * 60 * 1000);

      const updatedSession = await sessionManager.updateSession(session.sessionId, {
        expiresAt: newExpiresAt,
      });

      expect(updatedSession?.expiresAt.getTime()).toBeCloseTo(newExpiresAt.getTime(), -2);
    });

    it('should update session metadata', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);

      const session = await sessionManager.createSession(userId, context, {
        metadata: { foo: 'bar' },
      });

      const updatedSession = await sessionManager.updateSession(session.sessionId, {
        metadata: { baz: 'qux' },
      });

      expect(updatedSession?.metadata).toEqual({ foo: 'bar', baz: 'qux' });
    });

    it('should return null for non-existent session', async () => {
      const result = await sessionManager.updateSession('non-existent', {
        metadata: { foo: 'bar' },
      });

      expect(result).toBeNull();
    });
  });

  describe('refreshSession', () => {
    it('should extend session expiration', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);

      const session = await sessionManager.createSession(userId, context);
      const originalExpiresAt = session.expiresAt.getTime();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      const refreshedSession = await sessionManager.refreshSession(session.sessionId);

      expect(refreshedSession?.expiresAt.getTime()).toBeGreaterThan(originalExpiresAt);
    });

    it('should use custom TTL when refreshing', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);

      const session = await sessionManager.createSession(userId, context);
      const customTTL = 60 * 60 * 1000; // 1 hour

      const refreshedSession = await sessionManager.refreshSession(
        session.sessionId,
        customTTL,
      );

      const expectedExpiry = Date.now() + customTTL;
      expect(refreshedSession?.expiresAt.getTime()).toBeCloseTo(expectedExpiry, -2);
    });

    it('should return null for non-existent session', async () => {
      const result = await sessionManager.refreshSession('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('revokeSession', () => {
    it('should revoke a session', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);

      const session = await sessionManager.createSession(userId, context);

      const revoked = await sessionManager.revokeSession(session.sessionId);
      expect(revoked).toBe(true);

      const retrievedSession = await sessionManager.getSession(session.sessionId);
      expect(retrievedSession).toBeNull();
    });

    it('should return false when revoking non-existent session', async () => {
      const revoked = await sessionManager.revokeSession('non-existent');
      expect(revoked).toBe(false);
    });
  });

  describe('revokeUserSessions', () => {
    it('should revoke all sessions for a user', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);

      await sessionManager.createSession(userId, context);
      await sessionManager.createSession(userId, context);
      await sessionManager.createSession(userId, context);

      const revokedCount = await sessionManager.revokeUserSessions(userId);
      expect(revokedCount).toBe(3);

      const userSessions = await sessionManager.getUserSessions(userId);
      expect(userSessions).toHaveLength(0);
    });

    it('should return 0 for user with no sessions', async () => {
      const revokedCount = await sessionManager.revokeUserSessions('no-sessions-user');
      expect(revokedCount).toBe(0);
    });

    it('should not affect other users sessions', async () => {
      const user1 = 'user1';
      const user2 = 'user2';

      await sessionManager.createSession(user1, createMockAuthContext(user1));
      await sessionManager.createSession(user2, createMockAuthContext(user2));

      await sessionManager.revokeUserSessions(user1);

      const user1Sessions = await sessionManager.getUserSessions(user1);
      const user2Sessions = await sessionManager.getUserSessions(user2);

      expect(user1Sessions).toHaveLength(0);
      expect(user2Sessions).toHaveLength(1);
    });
  });

  describe('revokeOtherSessions', () => {
    it('should revoke all sessions except the specified one', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);

      const session1 = await sessionManager.createSession(userId, context);
      const session2 = await sessionManager.createSession(userId, context);
      const session3 = await sessionManager.createSession(userId, context);

      const revokedCount = await sessionManager.revokeOtherSessions(
        userId,
        session2.sessionId,
      );

      expect(revokedCount).toBe(2);

      const userSessions = await sessionManager.getUserSessions(userId);
      expect(userSessions).toHaveLength(1);
      expect(userSessions[0].sessionId).toBe(session2.sessionId);
    });

    it('should return 0 when user has only one session', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);

      const session = await sessionManager.createSession(userId, context);

      const revokedCount = await sessionManager.revokeOtherSessions(
        userId,
        session.sessionId,
      );

      expect(revokedCount).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return accurate session statistics', async () => {
      const user1 = 'user1';
      const user2 = 'user2';

      await sessionManager.createSession(user1, createMockAuthContext(user1));
      await sessionManager.createSession(user1, createMockAuthContext(user1));
      await sessionManager.createSession(user2, createMockAuthContext(user2));

      const stats = sessionManager.getStats();

      expect(stats.totalSessions).toBe(3);
      expect(stats.sessionsByUser.get(user1)).toBe(2);
      expect(stats.sessionsByUser.get(user2)).toBe(1);
      expect(stats.cleanedUpSessions).toBe(0);
    });

    it('should track cleaned up sessions', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);

      // Create expired session
      await sessionManager.createSession(userId, context, { ttl: 1 });

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Trigger cleanup
      await sessionManager.cleanup();

      const stats = sessionManager.getStats();
      expect(stats.cleanedUpSessions).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('should remove expired sessions', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);

      // Create mix of valid and expired sessions
      await sessionManager.createSession(userId, context);
      await sessionManager.createSession(userId, context, { ttl: 1 });
      await sessionManager.createSession(userId, context, { ttl: 1 });

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      const cleanedCount = await sessionManager.cleanup();
      expect(cleanedCount).toBe(2);

      const userSessions = await sessionManager.getUserSessions(userId);
      expect(userSessions).toHaveLength(1);
    });

    it('should return 0 when no sessions need cleanup', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);

      await sessionManager.createSession(userId, context);

      const cleanedCount = await sessionManager.cleanup();
      expect(cleanedCount).toBe(0);
    });
  });

  describe('auto cleanup', () => {
    it('should automatically clean up expired sessions', async () => {
      const manager = new SessionManager(mockLogger, {
        autoCleanup: true,
        cleanupInterval: 50, // 50ms for testing
      });

      const userId = 'user123';
      const context = createMockAuthContext(userId);

      // Create expired session
      await manager.createSession(userId, context, { ttl: 1 });

      // Wait for cleanup to run
      await new Promise((resolve) => setTimeout(resolve, 100));

      const stats = manager.getStats();
      expect(stats.totalSessions).toBe(0);
      expect(stats.cleanedUpSessions).toBeGreaterThan(0);

      await manager.destroy();
    });
  });

  describe('multi-device support', () => {
    it('should track multiple devices for the same user', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);

      const device1 = { id: 'device-1', name: 'iPhone', type: 'mobile' };
      const device2 = { id: 'device-2', name: 'MacBook', type: 'desktop' };
      const device3 = { id: 'device-3', name: 'iPad', type: 'tablet' };

      await sessionManager.createSession(userId, context, { device: device1 });
      await sessionManager.createSession(userId, context, { device: device2 });
      await sessionManager.createSession(userId, context, { device: device3 });

      const userSessions = await sessionManager.getUserSessions(userId);
      expect(userSessions).toHaveLength(3);

      const devices = userSessions.map((s) => s.device?.id);
      expect(devices).toContain('device-1');
      expect(devices).toContain('device-2');
      expect(devices).toContain('device-3');
    });

    it('should revoke sessions from specific device', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);

      const session1 = await sessionManager.createSession(userId, context, {
        device: { id: 'device-1', type: 'mobile' },
      });
      const session2 = await sessionManager.createSession(userId, context, {
        device: { id: 'device-2', type: 'desktop' },
      });

      // Revoke mobile device session
      await sessionManager.revokeSession(session1.sessionId);

      const userSessions = await sessionManager.getUserSessions(userId);
      expect(userSessions).toHaveLength(1);
      expect(userSessions[0].device?.id).toBe('device-2');
    });
  });

  describe('destroy', () => {
    it('should clean up all resources', async () => {
      const manager = new SessionManager(mockLogger, {
        autoCleanup: true,
        cleanupInterval: 1000,
      });

      const userId = 'user123';
      const context = createMockAuthContext(userId);

      await manager.createSession(userId, context);
      await manager.createSession(userId, context);

      await manager.destroy();

      const stats = manager.getStats();
      expect(stats.totalSessions).toBe(0);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle rapid session creation', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);

      const promises = Array.from({ length: 100 }, () =>
        sessionManager.createSession(userId, context),
      );

      const sessions = await Promise.all(promises);
      expect(sessions).toHaveLength(100);

      const userSessions = await sessionManager.getUserSessions(userId);
      expect(userSessions).toHaveLength(100);
    });

    it('should handle concurrent session operations', async () => {
      const userId = 'user123';
      const context = createMockAuthContext(userId);

      const session = await sessionManager.createSession(userId, context);

      // Perform concurrent operations
      const promises = [
        sessionManager.getSession(session.sessionId),
        sessionManager.refreshSession(session.sessionId),
        sessionManager.updateSession(session.sessionId, {
          metadata: { test: 'value' },
        }),
      ];

      const results = await Promise.all(promises);
      expect(results).toHaveLength(3);
      results.forEach((result) => expect(result).toBeDefined());
    });
  });
});
