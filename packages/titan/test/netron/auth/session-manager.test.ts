/**
 * Comprehensive Integration Tests for SessionManager
 *
 * These tests use real implementations (no mocks) to verify SessionManager
 * behavior in realistic scenarios. Tests cover:
 * - All public methods
 * - Edge cases (expired sessions, max sessions limit, automatic cleanup)
 * - Concurrent operations
 * - Session activity tracking
 * - Multi-device support
 *
 * @module @omnitron-dev/titan/netron/auth/tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager, type Session } from '../../../src/netron/auth/session-manager.js';
import type { AuthContext } from '../../../src/netron/auth/types.js';
import type { ILogger, LogLevel } from '../../../src/types/logger.js';

/**
 * Creates a real logger implementation that captures logs for verification
 * Implements ILogger interface with full functionality
 */
function createTestLogger(): ILogger & { logs: Array<{ level: string; obj?: object; msg?: string }> } {
  const logs: Array<{ level: string; obj?: object; msg?: string }> = [];
  let currentLevel: LogLevel = 'debug';

  const createLogMethod =
    (level: string) =>
    (objOrMsg?: object | string, msg?: string): void => {
      if (typeof objOrMsg === 'string') {
        logs.push({ level, msg: objOrMsg });
      } else {
        logs.push({ level, obj: objOrMsg, msg });
      }
    };

  const logger: ILogger & { logs: Array<{ level: string; obj?: object; msg?: string }> } = {
    logs,
    trace: createLogMethod('trace'),
    debug: createLogMethod('debug'),
    info: createLogMethod('info'),
    warn: createLogMethod('warn'),
    error: createLogMethod('error'),
    fatal: createLogMethod('fatal'),
    child: (bindings: object) => {
      // Return a new logger that inherits logs array but adds bindings
      const childLogger = createTestLogger();
      childLogger.logs = logs; // Share logs with parent
      return childLogger;
    },
    time: (label?: string) => {
      const start = Date.now();
      return () => {
        const elapsed = Date.now() - start;
        logs.push({ level: 'info', msg: `${label || 'timer'}: ${elapsed}ms` });
      };
    },
    isLevelEnabled: (level: LogLevel) => {
      const levels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
      return levels.indexOf(level) >= levels.indexOf(currentLevel);
    },
    setLevel: (level: LogLevel) => {
      currentLevel = level;
    },
    getLevel: () => currentLevel,
  };

  return logger;
}

/**
 * Creates a valid AuthContext for testing
 */
function createAuthContext(userId: string, options?: Partial<AuthContext>): AuthContext {
  return {
    userId,
    roles: options?.roles ?? ['user'],
    permissions: options?.permissions ?? ['read:documents'],
    scopes: options?.scopes,
    token: options?.token,
    metadata: options?.metadata,
  };
}

/**
 * Helper to wait for a specific duration
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('SessionManager Integration Tests', () => {
  let logger: ILogger & { logs: Array<{ level: string; obj?: object; msg?: string }> };
  let sessionManager: SessionManager;

  beforeEach(() => {
    logger = createTestLogger();
    sessionManager = new SessionManager(logger, {
      autoCleanup: false, // Disable for most tests
      defaultTTL: 24 * 60 * 60 * 1000, // 24 hours
      trackActivity: true,
    });
  });

  afterEach(async () => {
    await sessionManager.destroy();
  });

  // ============================================================================
  // createSession Tests
  // ============================================================================

  describe('createSession', () => {
    it('should create a session with auto-generated session ID', async () => {
      const userId = 'user-001';
      const context = createAuthContext(userId);

      const session = await sessionManager.createSession(userId, context);

      expect(session).toBeDefined();
      expect(session.sessionId).toMatch(/^sess_/);
      expect(session.userId).toBe(userId);
      expect(session.context).toEqual(context);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastActivityAt).toBeInstanceOf(Date);
      expect(session.expiresAt).toBeInstanceOf(Date);
      expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should create a session with custom session ID', async () => {
      const userId = 'user-002';
      const context = createAuthContext(userId);
      const customId = 'custom-session-id-123';

      const session = await sessionManager.createSession(userId, context, {
        sessionId: customId,
      });

      expect(session.sessionId).toBe(customId);
    });

    it('should create a session with custom TTL', async () => {
      const userId = 'user-003';
      const context = createAuthContext(userId);
      const customTTL = 60 * 60 * 1000; // 1 hour

      const session = await sessionManager.createSession(userId, context, {
        ttl: customTTL,
      });

      const expectedExpiresAt = session.createdAt.getTime() + customTTL;
      expect(session.expiresAt.getTime()).toBeCloseTo(expectedExpiresAt, -2);
    });

    it('should create a session with device information', async () => {
      const userId = 'user-004';
      const context = createAuthContext(userId);
      const device = {
        id: 'device-iphone-13',
        name: 'iPhone 13 Pro',
        type: 'mobile',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)',
      };

      const session = await sessionManager.createSession(userId, context, { device });

      expect(session.device).toEqual(device);
    });

    it('should create a session with metadata', async () => {
      const userId = 'user-005';
      const context = createAuthContext(userId);
      const metadata = {
        ipAddress: '192.168.1.100',
        location: 'New York, NY',
        loginMethod: 'oauth2',
      };

      const session = await sessionManager.createSession(userId, context, { metadata });

      expect(session.metadata).toEqual(metadata);
    });

    it('should create multiple sessions for the same user', async () => {
      const userId = 'user-006';
      const context = createAuthContext(userId);

      const session1 = await sessionManager.createSession(userId, context);
      const session2 = await sessionManager.createSession(userId, context);
      const session3 = await sessionManager.createSession(userId, context);

      expect(session1.sessionId).not.toBe(session2.sessionId);
      expect(session2.sessionId).not.toBe(session3.sessionId);

      const stats = sessionManager.getStats();
      expect(stats.totalSessions).toBe(3);
      expect(stats.sessionsByUser.get(userId)).toBe(3);
    });

    it('should create sessions for different users independently', async () => {
      const user1 = 'user-007';
      const user2 = 'user-008';

      await sessionManager.createSession(user1, createAuthContext(user1));
      await sessionManager.createSession(user1, createAuthContext(user1));
      await sessionManager.createSession(user2, createAuthContext(user2));

      const stats = sessionManager.getStats();
      expect(stats.totalSessions).toBe(3);
      expect(stats.sessionsByUser.get(user1)).toBe(2);
      expect(stats.sessionsByUser.get(user2)).toBe(1);
    });
  });

  // ============================================================================
  // Max Sessions Per User Limit Tests
  // ============================================================================

  describe('maxSessionsPerUser limit', () => {
    it('should enforce max sessions per user limit by removing oldest session', async () => {
      const manager = new SessionManager(logger, {
        maxSessionsPerUser: 2,
        autoCleanup: false,
      });

      const userId = 'user-limit-001';
      const context = createAuthContext(userId);

      // Create 3 sessions with delays to ensure different creation times
      const session1 = await manager.createSession(userId, context);
      await wait(10);
      const session2 = await manager.createSession(userId, context);
      await wait(10);
      const session3 = await manager.createSession(userId, context);

      // Should only have 2 sessions (oldest was removed)
      const userSessions = await manager.getUserSessions(userId);
      expect(userSessions).toHaveLength(2);

      // Session 1 (oldest) should be removed
      const removedSession = await manager.getSession(session1.sessionId);
      expect(removedSession).toBeNull();

      // Sessions 2 and 3 should still exist
      const activeSession2 = await manager.getSession(session2.sessionId);
      const activeSession3 = await manager.getSession(session3.sessionId);
      expect(activeSession2).not.toBeNull();
      expect(activeSession3).not.toBeNull();

      await manager.destroy();
    });

    it('should remove oldest session when max sessions limit is reached', async () => {
      const manager = new SessionManager(logger, {
        maxSessionsPerUser: 1,
        autoCleanup: false,
      });

      const userId = 'user-limit-002';
      const context = createAuthContext(userId);

      const session1 = await manager.createSession(userId, context);
      const session2 = await manager.createSession(userId, context);

      // When limit is reached, the oldest session should be removed
      // Session 1 should be removed since it was created first
      const retrievedSession1 = await manager.getSession(session1.sessionId);
      const retrievedSession2 = await manager.getSession(session2.sessionId);

      expect(retrievedSession1).toBeNull(); // First session should be removed
      expect(retrievedSession2).not.toBeNull(); // Second session should exist

      // Only 1 session should remain
      const userSessions = await manager.getUserSessions(userId);
      expect(userSessions).toHaveLength(1);
      expect(userSessions[0].sessionId).toBe(session2.sessionId);

      await manager.destroy();
    });

    it('should handle unlimited sessions when maxSessionsPerUser is 0', async () => {
      const manager = new SessionManager(logger, {
        maxSessionsPerUser: 0, // Unlimited
        autoCleanup: false,
      });

      const userId = 'user-unlimited';
      const context = createAuthContext(userId);

      // Create many sessions
      for (let i = 0; i < 50; i++) {
        await manager.createSession(userId, context);
      }

      const userSessions = await manager.getUserSessions(userId);
      expect(userSessions).toHaveLength(50);

      await manager.destroy();
    });

    it('should correctly identify oldest session across multiple rapid creations', async () => {
      const manager = new SessionManager(logger, {
        maxSessionsPerUser: 3,
        autoCleanup: false,
      });

      const userId = 'user-rapid';
      const context = createAuthContext(userId);

      // Create sessions rapidly
      const sessions: Session[] = [];
      for (let i = 0; i < 5; i++) {
        const session = await manager.createSession(userId, context);
        sessions.push(session);
        await wait(5); // Small delay to ensure different creation times
      }

      // Should have only 3 sessions
      const userSessions = await manager.getUserSessions(userId);
      expect(userSessions).toHaveLength(3);

      // First 2 sessions should be removed
      expect(await manager.getSession(sessions[0].sessionId)).toBeNull();
      expect(await manager.getSession(sessions[1].sessionId)).toBeNull();

      // Last 3 sessions should exist
      expect(await manager.getSession(sessions[2].sessionId)).not.toBeNull();
      expect(await manager.getSession(sessions[3].sessionId)).not.toBeNull();
      expect(await manager.getSession(sessions[4].sessionId)).not.toBeNull();

      await manager.destroy();
    });
  });

  // ============================================================================
  // getSession Tests
  // ============================================================================

  describe('getSession', () => {
    it('should retrieve an existing session', async () => {
      const userId = 'user-get-001';
      const context = createAuthContext(userId);

      const created = await sessionManager.createSession(userId, context);
      const retrieved = await sessionManager.getSession(created.sessionId);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.sessionId).toBe(created.sessionId);
      expect(retrieved?.userId).toBe(userId);
    });

    it('should return null for non-existent session', async () => {
      const session = await sessionManager.getSession('non-existent-session-id');
      expect(session).toBeNull();
    });

    it('should return null for expired session and remove it', async () => {
      const userId = 'user-expired';
      const context = createAuthContext(userId);

      // Create session with very short TTL
      const session = await sessionManager.createSession(userId, context, {
        ttl: 1, // 1ms TTL
      });

      // Wait for expiration
      await wait(20);

      // Should return null
      const retrieved = await sessionManager.getSession(session.sessionId);
      expect(retrieved).toBeNull();

      // Session should be removed from stats
      const stats = sessionManager.getStats();
      expect(stats.totalSessions).toBe(0);
    });

    it('should update lastActivityAt when retrieving session with activity tracking enabled', async () => {
      const manager = new SessionManager(logger, {
        trackActivity: true,
        autoCleanup: false,
      });

      const userId = 'user-activity';
      const context = createAuthContext(userId);

      const session = await manager.createSession(userId, context);
      const originalActivityTime = session.lastActivityAt.getTime();

      // Wait a bit
      await wait(20);

      const retrieved = await manager.getSession(session.sessionId);
      expect(retrieved?.lastActivityAt.getTime()).toBeGreaterThan(originalActivityTime);

      await manager.destroy();
    });

    it('should NOT update lastActivityAt when activity tracking is disabled', async () => {
      const manager = new SessionManager(logger, {
        trackActivity: false,
        autoCleanup: false,
      });

      const userId = 'user-no-activity';
      const context = createAuthContext(userId);

      const session = await manager.createSession(userId, context);
      const originalActivityTime = session.lastActivityAt.getTime();

      // Wait a bit
      await wait(20);

      const retrieved = await manager.getSession(session.sessionId);
      expect(retrieved?.lastActivityAt.getTime()).toBe(originalActivityTime);

      await manager.destroy();
    });
  });

  // ============================================================================
  // getUserSessions Tests
  // ============================================================================

  describe('getUserSessions', () => {
    it('should retrieve all sessions for a user', async () => {
      const userId = 'user-multi-session';
      const context = createAuthContext(userId);

      await sessionManager.createSession(userId, context);
      await sessionManager.createSession(userId, context);
      await sessionManager.createSession(userId, context);

      const sessions = await sessionManager.getUserSessions(userId);
      expect(sessions).toHaveLength(3);
      sessions.forEach((s) => expect(s.userId).toBe(userId));
    });

    it('should return empty array for user with no sessions', async () => {
      const sessions = await sessionManager.getUserSessions('non-existent-user');
      expect(sessions).toEqual([]);
    });

    it('should exclude expired sessions from results', async () => {
      const userId = 'user-mixed-expiry';
      const context = createAuthContext(userId);

      // Create one valid and two expired sessions
      await sessionManager.createSession(userId, context); // Valid
      await sessionManager.createSession(userId, context, { ttl: 1 }); // Expired
      await sessionManager.createSession(userId, context, { ttl: 1 }); // Expired

      // Wait for expiration
      await wait(20);

      const sessions = await sessionManager.getUserSessions(userId);
      expect(sessions).toHaveLength(1);
    });

    it('should not return sessions of other users', async () => {
      const user1 = 'user-a';
      const user2 = 'user-b';

      await sessionManager.createSession(user1, createAuthContext(user1));
      await sessionManager.createSession(user1, createAuthContext(user1));
      await sessionManager.createSession(user2, createAuthContext(user2));

      const user1Sessions = await sessionManager.getUserSessions(user1);
      const user2Sessions = await sessionManager.getUserSessions(user2);

      expect(user1Sessions).toHaveLength(2);
      expect(user2Sessions).toHaveLength(1);
      user1Sessions.forEach((s) => expect(s.userId).toBe(user1));
      user2Sessions.forEach((s) => expect(s.userId).toBe(user2));
    });
  });

  // ============================================================================
  // updateSession Tests
  // ============================================================================

  describe('updateSession', () => {
    it('should update session context', async () => {
      const userId = 'user-update-context';
      const originalContext = createAuthContext(userId, { roles: ['user'] });
      const session = await sessionManager.createSession(userId, originalContext);

      const newContext = createAuthContext(userId, {
        roles: ['user', 'admin'],
        permissions: ['read:all', 'write:all'],
      });

      const updated = await sessionManager.updateSession(session.sessionId, {
        context: newContext,
      });

      expect(updated?.context).toEqual(newContext);
    });

    it('should update session expiresAt', async () => {
      const userId = 'user-update-expiry';
      const context = createAuthContext(userId);
      const session = await sessionManager.createSession(userId, context);

      const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const updated = await sessionManager.updateSession(session.sessionId, {
        expiresAt: newExpiresAt,
      });

      expect(updated?.expiresAt.getTime()).toBeCloseTo(newExpiresAt.getTime(), -2);
    });

    it('should merge metadata (not replace)', async () => {
      const userId = 'user-update-metadata';
      const context = createAuthContext(userId);
      const session = await sessionManager.createSession(userId, context, {
        metadata: { key1: 'value1', key2: 'value2' },
      });

      const updated = await sessionManager.updateSession(session.sessionId, {
        metadata: { key2: 'updated', key3: 'value3' },
      });

      expect(updated?.metadata).toEqual({
        key1: 'value1',
        key2: 'updated',
        key3: 'value3',
      });
    });

    it('should update lastActivityAt on update', async () => {
      const userId = 'user-update-activity';
      const context = createAuthContext(userId);
      const session = await sessionManager.createSession(userId, context);
      const originalActivityTime = session.lastActivityAt.getTime();

      await wait(20);

      const updated = await sessionManager.updateSession(session.sessionId, {
        metadata: { test: true },
      });

      expect(updated?.lastActivityAt.getTime()).toBeGreaterThan(originalActivityTime);
    });

    it('should return null for non-existent session', async () => {
      const result = await sessionManager.updateSession('non-existent', {
        metadata: { test: true },
      });
      expect(result).toBeNull();
    });

    it('should return null for expired session', async () => {
      const userId = 'user-update-expired';
      const context = createAuthContext(userId);
      const session = await sessionManager.createSession(userId, context, { ttl: 1 });

      await wait(20);

      const result = await sessionManager.updateSession(session.sessionId, {
        metadata: { test: true },
      });
      expect(result).toBeNull();
    });
  });

  // ============================================================================
  // refreshSession Tests
  // ============================================================================

  describe('refreshSession', () => {
    it('should extend session expiration using default TTL', async () => {
      const userId = 'user-refresh-default';
      const context = createAuthContext(userId);
      const session = await sessionManager.createSession(userId, context);
      const originalExpiresAt = session.expiresAt.getTime();

      await wait(20);

      const refreshed = await sessionManager.refreshSession(session.sessionId);

      expect(refreshed?.expiresAt.getTime()).toBeGreaterThan(originalExpiresAt);
    });

    it('should extend session expiration using custom TTL', async () => {
      const userId = 'user-refresh-custom';
      const context = createAuthContext(userId);
      const session = await sessionManager.createSession(userId, context);
      const customTTL = 2 * 60 * 60 * 1000; // 2 hours

      const refreshed = await sessionManager.refreshSession(session.sessionId, customTTL);

      const expectedExpiry = Date.now() + customTTL;
      expect(refreshed?.expiresAt.getTime()).toBeCloseTo(expectedExpiry, -2);
    });

    it('should return null for non-existent session', async () => {
      const result = await sessionManager.refreshSession('non-existent');
      expect(result).toBeNull();
    });

    it('should return null for expired session', async () => {
      const userId = 'user-refresh-expired';
      const context = createAuthContext(userId);
      const session = await sessionManager.createSession(userId, context, { ttl: 1 });

      await wait(20);

      const result = await sessionManager.refreshSession(session.sessionId);
      expect(result).toBeNull();
    });

    it('should update lastActivityAt when refreshing', async () => {
      const userId = 'user-refresh-activity';
      const context = createAuthContext(userId);
      const session = await sessionManager.createSession(userId, context);
      const originalActivityTime = session.lastActivityAt.getTime();

      await wait(20);

      const refreshed = await sessionManager.refreshSession(session.sessionId);

      expect(refreshed?.lastActivityAt.getTime()).toBeGreaterThan(originalActivityTime);
    });
  });

  // ============================================================================
  // revokeSession Tests
  // ============================================================================

  describe('revokeSession', () => {
    it('should revoke an existing session', async () => {
      const userId = 'user-revoke';
      const context = createAuthContext(userId);
      const session = await sessionManager.createSession(userId, context);

      const revoked = await sessionManager.revokeSession(session.sessionId);

      expect(revoked).toBe(true);
      expect(await sessionManager.getSession(session.sessionId)).toBeNull();
    });

    it('should return false for non-existent session', async () => {
      const revoked = await sessionManager.revokeSession('non-existent');
      expect(revoked).toBe(false);
    });

    it('should update stats after revocation', async () => {
      const userId = 'user-revoke-stats';
      const context = createAuthContext(userId);

      await sessionManager.createSession(userId, context);
      const session2 = await sessionManager.createSession(userId, context);

      expect(sessionManager.getStats().totalSessions).toBe(2);

      await sessionManager.revokeSession(session2.sessionId);

      expect(sessionManager.getStats().totalSessions).toBe(1);
      expect(sessionManager.getStats().sessionsByUser.get(userId)).toBe(1);
    });

    it('should remove user from sessionsByUser when last session is revoked', async () => {
      const userId = 'user-revoke-last';
      const context = createAuthContext(userId);

      const session = await sessionManager.createSession(userId, context);

      await sessionManager.revokeSession(session.sessionId);

      const stats = sessionManager.getStats();
      expect(stats.sessionsByUser.has(userId)).toBe(false);
    });
  });

  // ============================================================================
  // revokeUserSessions Tests
  // ============================================================================

  describe('revokeUserSessions', () => {
    it('should revoke all sessions for a user', async () => {
      const userId = 'user-revoke-all';
      const context = createAuthContext(userId);

      await sessionManager.createSession(userId, context);
      await sessionManager.createSession(userId, context);
      await sessionManager.createSession(userId, context);

      const revokedCount = await sessionManager.revokeUserSessions(userId);

      expect(revokedCount).toBe(3);
      expect(await sessionManager.getUserSessions(userId)).toHaveLength(0);
    });

    it('should return 0 for user with no sessions', async () => {
      const revokedCount = await sessionManager.revokeUserSessions('non-existent-user');
      expect(revokedCount).toBe(0);
    });

    it('should not affect other users sessions', async () => {
      const user1 = 'user-revoke-1';
      const user2 = 'user-revoke-2';

      await sessionManager.createSession(user1, createAuthContext(user1));
      await sessionManager.createSession(user1, createAuthContext(user1));
      await sessionManager.createSession(user2, createAuthContext(user2));
      await sessionManager.createSession(user2, createAuthContext(user2));

      await sessionManager.revokeUserSessions(user1);

      expect(await sessionManager.getUserSessions(user1)).toHaveLength(0);
      expect(await sessionManager.getUserSessions(user2)).toHaveLength(2);
    });

    it('should revoke all user sessions and update stats', async () => {
      const userId = 'user-revoke-stats-test';
      const context = createAuthContext(userId);

      await sessionManager.createSession(userId, context);
      await sessionManager.createSession(userId, context);

      const statsBefore = sessionManager.getStats();
      expect(statsBefore.totalSessions).toBe(2);
      expect(statsBefore.sessionsByUser.get(userId)).toBe(2);

      const revokedCount = await sessionManager.revokeUserSessions(userId);

      // Verify all sessions were revoked
      expect(revokedCount).toBe(2);

      const statsAfter = sessionManager.getStats();
      expect(statsAfter.totalSessions).toBe(0);
      expect(statsAfter.sessionsByUser.has(userId)).toBe(false);
    });
  });

  // ============================================================================
  // revokeOtherSessions Tests
  // ============================================================================

  describe('revokeOtherSessions', () => {
    it('should revoke all sessions except the specified one', async () => {
      const userId = 'user-revoke-other';
      const context = createAuthContext(userId);

      const session1 = await sessionManager.createSession(userId, context);
      const sessionToKeep = await sessionManager.createSession(userId, context);
      const session3 = await sessionManager.createSession(userId, context);

      const revokedCount = await sessionManager.revokeOtherSessions(userId, sessionToKeep.sessionId);

      expect(revokedCount).toBe(2);

      expect(await sessionManager.getSession(session1.sessionId)).toBeNull();
      expect(await sessionManager.getSession(sessionToKeep.sessionId)).not.toBeNull();
      expect(await sessionManager.getSession(session3.sessionId)).toBeNull();
    });

    it('should return 0 when user has only one session', async () => {
      const userId = 'user-revoke-single';
      const context = createAuthContext(userId);

      const session = await sessionManager.createSession(userId, context);

      const revokedCount = await sessionManager.revokeOtherSessions(userId, session.sessionId);

      expect(revokedCount).toBe(0);
      expect(await sessionManager.getSession(session.sessionId)).not.toBeNull();
    });

    it('should return 0 for user with no sessions', async () => {
      const revokedCount = await sessionManager.revokeOtherSessions('non-existent-user', 'some-session');
      expect(revokedCount).toBe(0);
    });

    it('should handle case where keepSessionId does not exist', async () => {
      const userId = 'user-revoke-invalid-keep';
      const context = createAuthContext(userId);

      await sessionManager.createSession(userId, context);
      await sessionManager.createSession(userId, context);

      // Try to keep a non-existent session - all sessions should be revoked
      const revokedCount = await sessionManager.revokeOtherSessions(userId, 'non-existent-session');

      expect(revokedCount).toBe(2);
      expect(await sessionManager.getUserSessions(userId)).toHaveLength(0);
    });
  });

  // ============================================================================
  // getStats Tests
  // ============================================================================

  describe('getStats', () => {
    it('should return accurate total session count', async () => {
      const user1 = 'user-stats-1';
      const user2 = 'user-stats-2';

      await sessionManager.createSession(user1, createAuthContext(user1));
      await sessionManager.createSession(user1, createAuthContext(user1));
      await sessionManager.createSession(user2, createAuthContext(user2));

      const stats = sessionManager.getStats();
      expect(stats.totalSessions).toBe(3);
    });

    it('should return accurate sessions by user map', async () => {
      const user1 = 'user-stats-map-1';
      const user2 = 'user-stats-map-2';
      const user3 = 'user-stats-map-3';

      await sessionManager.createSession(user1, createAuthContext(user1));
      await sessionManager.createSession(user1, createAuthContext(user1));
      await sessionManager.createSession(user1, createAuthContext(user1));
      await sessionManager.createSession(user2, createAuthContext(user2));
      await sessionManager.createSession(user2, createAuthContext(user2));
      await sessionManager.createSession(user3, createAuthContext(user3));

      const stats = sessionManager.getStats();
      expect(stats.sessionsByUser.get(user1)).toBe(3);
      expect(stats.sessionsByUser.get(user2)).toBe(2);
      expect(stats.sessionsByUser.get(user3)).toBe(1);
    });

    it('should track cleaned up sessions count', async () => {
      const userId = 'user-stats-cleanup';
      const context = createAuthContext(userId);

      // Create expired sessions
      await sessionManager.createSession(userId, context, { ttl: 1 });
      await sessionManager.createSession(userId, context, { ttl: 1 });
      await sessionManager.createSession(userId, context, { ttl: 1 });

      await wait(20);

      await sessionManager.cleanup();

      const stats = sessionManager.getStats();
      expect(stats.cleanedUpSessions).toBe(3);
      expect(stats.totalSessions).toBe(0);
    });

    it('should return empty stats when no sessions exist', async () => {
      const stats = sessionManager.getStats();

      expect(stats.totalSessions).toBe(0);
      expect(stats.sessionsByUser.size).toBe(0);
      expect(stats.cleanedUpSessions).toBe(0);
    });
  });

  // ============================================================================
  // cleanup Tests
  // ============================================================================

  describe('cleanup', () => {
    it('should remove expired sessions', async () => {
      const userId = 'user-cleanup';
      const context = createAuthContext(userId);

      // Create mix of valid and expired sessions
      await sessionManager.createSession(userId, context); // Valid (default TTL)
      await sessionManager.createSession(userId, context, { ttl: 1 }); // Expired
      await sessionManager.createSession(userId, context, { ttl: 1 }); // Expired

      await wait(20);

      const cleanedCount = await sessionManager.cleanup();

      expect(cleanedCount).toBe(2);
      expect((await sessionManager.getUserSessions(userId)).length).toBe(1);
    });

    it('should return 0 when no sessions need cleanup', async () => {
      const userId = 'user-no-cleanup';
      const context = createAuthContext(userId);

      await sessionManager.createSession(userId, context);
      await sessionManager.createSession(userId, context);

      const cleanedCount = await sessionManager.cleanup();

      expect(cleanedCount).toBe(0);
    });

    it('should increment cleanedUpSessions counter', async () => {
      const userId = 'user-cleanup-counter';
      const context = createAuthContext(userId);

      await sessionManager.createSession(userId, context, { ttl: 1 });
      await wait(20);
      await sessionManager.cleanup();

      await sessionManager.createSession(userId, context, { ttl: 1 });
      await wait(20);
      await sessionManager.cleanup();

      const stats = sessionManager.getStats();
      expect(stats.cleanedUpSessions).toBe(2);
    });

    it('should handle cleanup when all sessions are expired', async () => {
      const userId = 'user-all-expired';
      const context = createAuthContext(userId);

      await sessionManager.createSession(userId, context, { ttl: 1 });
      await sessionManager.createSession(userId, context, { ttl: 1 });
      await sessionManager.createSession(userId, context, { ttl: 1 });

      await wait(20);

      const cleanedCount = await sessionManager.cleanup();

      expect(cleanedCount).toBe(3);
      expect(sessionManager.getStats().totalSessions).toBe(0);
    });
  });

  // ============================================================================
  // Automatic Cleanup Tests
  // ============================================================================

  describe('automatic cleanup', () => {
    it('should automatically clean up expired sessions at intervals', async () => {
      const manager = new SessionManager(logger, {
        autoCleanup: true,
        cleanupInterval: 50, // 50ms interval
      });

      const userId = 'user-auto-cleanup';
      const context = createAuthContext(userId);

      await manager.createSession(userId, context, { ttl: 10 }); // Expires in 10ms

      // Wait for session to expire and auto-cleanup to run
      await wait(100);

      const stats = manager.getStats();
      expect(stats.totalSessions).toBe(0);
      expect(stats.cleanedUpSessions).toBeGreaterThan(0);

      await manager.destroy();
    });

    it('should stop automatic cleanup when destroyed', async () => {
      const manager = new SessionManager(logger, {
        autoCleanup: true,
        cleanupInterval: 50,
      });

      await manager.destroy();

      // Create session after destroy (this is just to verify no errors)
      // Note: In real usage, you should not use a destroyed manager
      const stats = manager.getStats();
      expect(stats.totalSessions).toBe(0);
    });
  });

  // ============================================================================
  // destroy Tests
  // ============================================================================

  describe('destroy', () => {
    it('should clear all sessions', async () => {
      const user1 = 'user-destroy-1';
      const user2 = 'user-destroy-2';

      await sessionManager.createSession(user1, createAuthContext(user1));
      await sessionManager.createSession(user1, createAuthContext(user1));
      await sessionManager.createSession(user2, createAuthContext(user2));

      await sessionManager.destroy();

      const stats = sessionManager.getStats();
      expect(stats.totalSessions).toBe(0);
      expect(stats.sessionsByUser.size).toBe(0);
    });

    it('should stop cleanup timer', async () => {
      const manager = new SessionManager(logger, {
        autoCleanup: true,
        cleanupInterval: 10,
      });

      await manager.createSession('user', createAuthContext('user'));

      await manager.destroy();

      // Cleanup timer should be stopped (no errors thrown)
      await wait(50);
      expect(manager.getStats().totalSessions).toBe(0);
    });

    it('should be idempotent (safe to call multiple times)', async () => {
      await sessionManager.destroy();
      await sessionManager.destroy();
      await sessionManager.destroy();

      // Should not throw
      expect(sessionManager.getStats().totalSessions).toBe(0);
    });
  });

  // ============================================================================
  // Concurrent Operations Tests
  // ============================================================================

  describe('concurrent operations', () => {
    it('should handle concurrent session creations', async () => {
      const userId = 'user-concurrent-create';
      const context = createAuthContext(userId);

      const promises = Array.from({ length: 100 }, () => sessionManager.createSession(userId, context));

      const sessions = await Promise.all(promises);

      expect(sessions).toHaveLength(100);

      // All sessions should have unique IDs
      const ids = new Set(sessions.map((s) => s.sessionId));
      expect(ids.size).toBe(100);

      const stats = sessionManager.getStats();
      expect(stats.totalSessions).toBe(100);
    });

    it('should handle concurrent reads and writes', async () => {
      const userId = 'user-concurrent-rw';
      const context = createAuthContext(userId);

      const session = await sessionManager.createSession(userId, context);

      // Perform concurrent operations on the same session
      const promises = [
        sessionManager.getSession(session.sessionId),
        sessionManager.getSession(session.sessionId),
        sessionManager.refreshSession(session.sessionId),
        sessionManager.updateSession(session.sessionId, { metadata: { test: 1 } }),
        sessionManager.getSession(session.sessionId),
        sessionManager.updateSession(session.sessionId, { metadata: { test: 2 } }),
      ];

      const results = await Promise.all(promises);

      // All results should be defined (session exists)
      results.forEach((r) => expect(r).not.toBeNull());
    });

    it('should handle concurrent session revocations', async () => {
      const userId = 'user-concurrent-revoke';
      const context = createAuthContext(userId);

      // Create sessions
      const sessions: Session[] = [];
      for (let i = 0; i < 50; i++) {
        sessions.push(await sessionManager.createSession(userId, context));
      }

      // Revoke all concurrently
      const revokePromises = sessions.map((s) => sessionManager.revokeSession(s.sessionId));
      const results = await Promise.all(revokePromises);

      // All should return true
      results.forEach((r) => expect(r).toBe(true));

      // All sessions should be gone
      const stats = sessionManager.getStats();
      expect(stats.totalSessions).toBe(0);
    });

    it('should handle mixed concurrent operations across users', async () => {
      const users = ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'];

      const operations: Promise<any>[] = [];

      // Create sessions for all users
      for (const userId of users) {
        for (let i = 0; i < 10; i++) {
          operations.push(sessionManager.createSession(userId, createAuthContext(userId)));
        }
      }

      await Promise.all(operations);

      // Verify stats
      const stats = sessionManager.getStats();
      expect(stats.totalSessions).toBe(50);
      users.forEach((userId) => {
        expect(stats.sessionsByUser.get(userId)).toBe(10);
      });

      // Now perform concurrent operations
      const mixedOps: Promise<any>[] = [];
      for (const userId of users) {
        mixedOps.push(sessionManager.getUserSessions(userId));
        mixedOps.push(sessionManager.revokeUserSessions(userId));
      }

      await Promise.all(mixedOps);

      // All sessions should be revoked
      expect(sessionManager.getStats().totalSessions).toBe(0);
    });
  });

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================

  describe('edge cases', () => {
    it('should handle very long session IDs', async () => {
      const userId = 'user-long-id';
      const context = createAuthContext(userId);
      const longId = 'a'.repeat(1000);

      const session = await sessionManager.createSession(userId, context, {
        sessionId: longId,
      });

      expect(session.sessionId).toBe(longId);

      const retrieved = await sessionManager.getSession(longId);
      expect(retrieved?.sessionId).toBe(longId);
    });

    it('should handle special characters in user ID', async () => {
      const specialUserIds = ['user@example.com', 'user:with:colons', 'user/with/slashes', 'user with spaces'];

      for (const userId of specialUserIds) {
        const session = await sessionManager.createSession(userId, createAuthContext(userId));
        const retrieved = await sessionManager.getSession(session.sessionId);
        expect(retrieved?.userId).toBe(userId);
      }
    });

    it('should handle empty metadata', async () => {
      const userId = 'user-empty-meta';
      const context = createAuthContext(userId);

      const session = await sessionManager.createSession(userId, context, {
        metadata: {},
      });

      expect(session.metadata).toEqual({});
    });

    it('should handle null-ish device values', async () => {
      const userId = 'user-null-device';
      const context = createAuthContext(userId);

      const session = await sessionManager.createSession(userId, context, {
        device: { id: 'device-1', name: undefined, type: undefined, userAgent: undefined },
      });

      expect(session.device?.id).toBe('device-1');
      expect(session.device?.name).toBeUndefined();
    });

    it('should handle zero TTL gracefully', async () => {
      const userId = 'user-zero-ttl';
      const context = createAuthContext(userId);

      const session = await sessionManager.createSession(userId, context, { ttl: 0 });

      // Session should be created but immediately expired
      const retrieved = await sessionManager.getSession(session.sessionId);
      expect(retrieved).toBeNull();
    });

    it('should handle very large TTL', async () => {
      const userId = 'user-large-ttl';
      const context = createAuthContext(userId);
      const largeTTL = 365 * 24 * 60 * 60 * 1000; // 1 year

      const session = await sessionManager.createSession(userId, context, { ttl: largeTTL });

      const expectedExpiry = session.createdAt.getTime() + largeTTL;
      expect(session.expiresAt.getTime()).toBeCloseTo(expectedExpiry, -2);
    });

    it('should handle rapid create and destroy cycles', async () => {
      for (let i = 0; i < 10; i++) {
        const manager = new SessionManager(logger, { autoCleanup: false });
        await manager.createSession('user', createAuthContext('user'));
        await manager.destroy();
      }

      // Should not throw or leak resources
      expect(true).toBe(true);
    });

    it('should handle session operations after partial cleanup', async () => {
      const userId = 'user-partial-cleanup';
      const context = createAuthContext(userId);

      // Create mix of valid and expired
      const validSession = await sessionManager.createSession(userId, context);
      await sessionManager.createSession(userId, context, { ttl: 1 });

      await wait(20);

      // Cleanup only expired
      await sessionManager.cleanup();

      // Valid session should still work
      const refreshed = await sessionManager.refreshSession(validSession.sessionId);
      expect(refreshed).not.toBeNull();
    });
  });

  // ============================================================================
  // Multi-Device Support Tests
  // ============================================================================

  describe('multi-device support', () => {
    it('should track sessions from multiple devices for same user', async () => {
      const userId = 'user-multi-device';
      const context = createAuthContext(userId);

      const devices = [
        { id: 'iphone-1', name: 'iPhone 14', type: 'mobile' },
        { id: 'macbook-1', name: 'MacBook Pro', type: 'desktop' },
        { id: 'ipad-1', name: 'iPad Pro', type: 'tablet' },
        { id: 'android-1', name: 'Pixel 7', type: 'mobile' },
      ];

      for (const device of devices) {
        await sessionManager.createSession(userId, context, { device });
      }

      const sessions = await sessionManager.getUserSessions(userId);
      expect(sessions).toHaveLength(4);

      const deviceIds = sessions.map((s) => s.device?.id);
      expect(deviceIds).toContain('iphone-1');
      expect(deviceIds).toContain('macbook-1');
      expect(deviceIds).toContain('ipad-1');
      expect(deviceIds).toContain('android-1');
    });

    it('should allow revoking session from specific device', async () => {
      const userId = 'user-revoke-device';
      const context = createAuthContext(userId);

      const mobileSession = await sessionManager.createSession(userId, context, {
        device: { id: 'mobile-device', type: 'mobile' },
      });
      await sessionManager.createSession(userId, context, {
        device: { id: 'desktop-device', type: 'desktop' },
      });

      // Revoke mobile session only
      await sessionManager.revokeSession(mobileSession.sessionId);

      const sessions = await sessionManager.getUserSessions(userId);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].device?.id).toBe('desktop-device');
    });

    it('should support "logout from all other devices" flow', async () => {
      const userId = 'user-logout-others';
      const context = createAuthContext(userId);

      // Create sessions from different devices
      await sessionManager.createSession(userId, context, {
        device: { id: 'device-1', type: 'mobile' },
      });
      const currentSession = await sessionManager.createSession(userId, context, {
        device: { id: 'current-device', type: 'desktop' },
      });
      await sessionManager.createSession(userId, context, {
        device: { id: 'device-3', type: 'tablet' },
      });

      // Logout from all other devices
      const revokedCount = await sessionManager.revokeOtherSessions(userId, currentSession.sessionId);

      expect(revokedCount).toBe(2);

      const sessions = await sessionManager.getUserSessions(userId);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].device?.id).toBe('current-device');
    });
  });

  // ============================================================================
  // Session Activity Tracking Tests
  // ============================================================================

  describe('session activity tracking', () => {
    it('should track activity across multiple accesses', async () => {
      const manager = new SessionManager(logger, {
        trackActivity: true,
        autoCleanup: false,
      });

      const userId = 'user-activity-track';
      const context = createAuthContext(userId);

      const session = await manager.createSession(userId, context);
      let previousActivity = session.lastActivityAt.getTime();

      // Access multiple times with delays
      for (let i = 0; i < 5; i++) {
        await wait(15);
        const retrieved = await manager.getSession(session.sessionId);
        expect(retrieved?.lastActivityAt.getTime()).toBeGreaterThan(previousActivity);
        previousActivity = retrieved!.lastActivityAt.getTime();
      }

      await manager.destroy();
    });

    it('should preserve creation time even when activity is updated', async () => {
      const manager = new SessionManager(logger, {
        trackActivity: true,
        autoCleanup: false,
      });

      const userId = 'user-preserve-created';
      const context = createAuthContext(userId);

      const session = await manager.createSession(userId, context);
      const originalCreatedAt = session.createdAt.getTime();

      await wait(20);
      await manager.getSession(session.sessionId);
      await wait(20);
      await manager.refreshSession(session.sessionId);

      const finalSession = await manager.getSession(session.sessionId);
      expect(finalSession?.createdAt.getTime()).toBe(originalCreatedAt);

      await manager.destroy();
    });
  });

  // ============================================================================
  // Configuration Tests
  // ============================================================================

  describe('configuration', () => {
    it('should use default configuration when not specified', async () => {
      const manager = new SessionManager(logger);

      const session = await manager.createSession('user', createAuthContext('user'));

      // Default TTL is 24 hours
      const expectedExpiry = session.createdAt.getTime() + 24 * 60 * 60 * 1000;
      expect(session.expiresAt.getTime()).toBeCloseTo(expectedExpiry, -2);

      await manager.destroy();
    });

    it('should respect custom defaultTTL', async () => {
      const customTTL = 60 * 60 * 1000; // 1 hour
      const manager = new SessionManager(logger, {
        defaultTTL: customTTL,
        autoCleanup: false,
      });

      const session = await manager.createSession('user', createAuthContext('user'));

      const expectedExpiry = session.createdAt.getTime() + customTTL;
      expect(session.expiresAt.getTime()).toBeCloseTo(expectedExpiry, -2);

      await manager.destroy();
    });

    it('should respect cleanupInterval configuration', async () => {
      const manager = new SessionManager(logger, {
        autoCleanup: true,
        cleanupInterval: 30, // 30ms
      });

      const session = await manager.createSession('user', createAuthContext('user'), { ttl: 10 });

      // Wait for cleanup interval to pass
      await wait(80);

      const retrieved = await manager.getSession(session.sessionId);
      expect(retrieved).toBeNull();

      await manager.destroy();
    });
  });
});
