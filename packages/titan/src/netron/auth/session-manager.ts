/**
 * Session Manager for Netron
 * Manages active user sessions with support for multi-device sessions,
 * token refresh, and session revocation
 * @module @omnitron-dev/titan/netron/auth
 */

import { randomUUID } from 'crypto';
import { Injectable } from '../../decorators/index.js';
import type { ILogger } from '../../modules/logger/logger.types.js';
import type { AuthContext } from './types.js';

/**
 * Session data structure
 */
export interface Session {
  /** Unique session identifier */
  sessionId: string;

  /** User ID associated with this session */
  userId: string;

  /** Authentication context */
  context: AuthContext;

  /** Session creation timestamp */
  createdAt: Date;

  /** Last activity timestamp */
  lastActivityAt: Date;

  /** Session expiration timestamp */
  expiresAt: Date;

  /** Device information */
  device?: {
    id: string;
    name?: string;
    type?: string;
    userAgent?: string;
  };

  /** Session metadata */
  metadata?: Record<string, any>;
}

/**
 * Session configuration
 */
export interface SessionConfig {
  /** Default session TTL in milliseconds (default: 24 hours) */
  defaultTTL?: number;

  /** Maximum number of concurrent sessions per user (default: unlimited) */
  maxSessionsPerUser?: number;

  /** Enable automatic session cleanup (default: true) */
  autoCleanup?: boolean;

  /** Cleanup interval in milliseconds (default: 5 minutes) */
  cleanupInterval?: number;

  /** Enable session activity tracking (default: true) */
  trackActivity?: boolean;
}

/**
 * Session statistics
 */
export interface SessionStats {
  /** Total active sessions */
  totalSessions: number;

  /** Active sessions by user */
  sessionsByUser: Map<string, number>;

  /** Total expired sessions cleaned up */
  cleanedUpSessions: number;
}

/**
 * Default session TTL (24 hours)
 */
const DEFAULT_SESSION_TTL = 24 * 60 * 60 * 1000;

/**
 * Default cleanup interval (5 minutes)
 */
const DEFAULT_CLEANUP_INTERVAL = 5 * 60 * 1000;

/**
 * Session Manager
 * Manages user sessions with support for multi-device sessions,
 * automatic expiration, and session tracking
 */
@Injectable()
export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private userSessions: Map<string, Set<string>> = new Map();
  private config: Required<SessionConfig>;
  private cleanupTimer?: NodeJS.Timeout;
  private cleanedUpCount = 0;

  constructor(
    private logger: ILogger,
    config?: SessionConfig
  ) {
    this.logger = logger.child({ component: 'SessionManager' });

    // Set default configuration
    this.config = {
      defaultTTL: config?.defaultTTL ?? DEFAULT_SESSION_TTL,
      maxSessionsPerUser: config?.maxSessionsPerUser ?? 0, // 0 means unlimited
      autoCleanup: config?.autoCleanup ?? true,
      cleanupInterval: config?.cleanupInterval ?? DEFAULT_CLEANUP_INTERVAL,
      trackActivity: config?.trackActivity ?? true,
    };

    // Start automatic cleanup if enabled
    if (this.config.autoCleanup) {
      this.startCleanupTimer();
    }

    this.logger.debug({ config: this.config }, 'Session manager initialized');
  }

  /**
   * Create a new session
   * @param userId - User ID
   * @param context - Authentication context
   * @param options - Session options
   * @returns Created session
   */
  async createSession(
    userId: string,
    context: AuthContext,
    options?: {
      sessionId?: string;
      ttl?: number;
      device?: Session['device'];
      metadata?: Record<string, any>;
    }
  ): Promise<Session> {
    // Generate session ID if not provided
    const sessionId = options?.sessionId ?? this.generateSessionId();

    // Check max sessions per user limit
    if (this.config.maxSessionsPerUser > 0) {
      const userSessionCount = this.userSessions.get(userId)?.size ?? 0;
      if (userSessionCount >= this.config.maxSessionsPerUser) {
        this.logger.warn({ userId, limit: this.config.maxSessionsPerUser }, 'Max sessions per user limit reached');

        // Remove oldest session for this user
        await this.removeOldestSession(userId);
      }
    }

    const now = new Date();
    const ttl = options?.ttl ?? this.config.defaultTTL;
    const expiresAt = new Date(now.getTime() + ttl);

    const session: Session = {
      sessionId,
      userId,
      context,
      createdAt: now,
      lastActivityAt: now,
      expiresAt,
      device: options?.device,
      metadata: options?.metadata,
    };

    // Store session
    this.sessions.set(sessionId, session);

    // Track user sessions
    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, new Set());
    }
    this.userSessions.get(userId)!.add(sessionId);

    this.logger.info({ sessionId, userId, expiresAt }, 'Session created');

    return session;
  }

  /**
   * Get session by ID
   * @param sessionId - Session ID
   * @returns Session if found and not expired
   */
  async getSession(sessionId: string): Promise<Session | null> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    // Check if session is expired
    if (this.isSessionExpired(session)) {
      this.logger.debug({ sessionId }, 'Session expired');
      await this.removeSession(sessionId);
      return null;
    }

    // Update last activity
    if (this.config.trackActivity) {
      session.lastActivityAt = new Date();
    }

    return session;
  }

  /**
   * Get all sessions for a user
   * @param userId - User ID
   * @returns Array of active sessions
   */
  async getUserSessions(userId: string): Promise<Session[]> {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds || sessionIds.size === 0) {
      return [];
    }

    const sessions: Session[] = [];
    for (const sessionId of sessionIds) {
      const session = await this.getSession(sessionId);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  /**
   * Update session
   * @param sessionId - Session ID
   * @param updates - Partial session updates
   * @returns Updated session or null if not found
   */
  async updateSession(
    sessionId: string,
    updates: Partial<Pick<Session, 'context' | 'expiresAt' | 'metadata'>>
  ): Promise<Session | null> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    // Apply updates
    if (updates.context) {
      session.context = updates.context;
    }
    if (updates.expiresAt) {
      session.expiresAt = updates.expiresAt;
    }
    if (updates.metadata) {
      session.metadata = { ...session.metadata, ...updates.metadata };
    }

    session.lastActivityAt = new Date();

    this.logger.debug({ sessionId }, 'Session updated');

    return session;
  }

  /**
   * Refresh session (extend expiration)
   * @param sessionId - Session ID
   * @param ttl - New TTL in milliseconds (optional, uses default if not provided)
   * @returns Refreshed session or null if not found
   */
  async refreshSession(sessionId: string, ttl?: number): Promise<Session | null> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    const refreshTTL = ttl ?? this.config.defaultTTL;
    const newExpiresAt = new Date(Date.now() + refreshTTL);

    return this.updateSession(sessionId, { expiresAt: newExpiresAt });
  }

  /**
   * Revoke (remove) a session
   * @param sessionId - Session ID
   * @returns True if session was removed
   */
  async revokeSession(sessionId: string): Promise<boolean> {
    return this.removeSession(sessionId);
  }

  /**
   * Revoke all sessions for a user
   * @param userId - User ID
   * @returns Number of sessions revoked
   */
  async revokeUserSessions(userId: string): Promise<number> {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds || sessionIds.size === 0) {
      return 0;
    }

    let revokedCount = 0;
    for (const sessionId of Array.from(sessionIds)) {
      const removed = await this.removeSession(sessionId);
      if (removed) {
        revokedCount++;
      }
    }

    this.logger.info({ userId, count: revokedCount }, 'User sessions revoked');

    return revokedCount;
  }

  /**
   * Revoke all sessions except the specified one
   * @param userId - User ID
   * @param keepSessionId - Session ID to keep
   * @returns Number of sessions revoked
   */
  async revokeOtherSessions(userId: string, keepSessionId: string): Promise<number> {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds || sessionIds.size === 0) {
      return 0;
    }

    let revokedCount = 0;
    for (const sessionId of Array.from(sessionIds)) {
      if (sessionId !== keepSessionId) {
        const removed = await this.removeSession(sessionId);
        if (removed) {
          revokedCount++;
        }
      }
    }

    this.logger.info({ userId, keepSessionId, count: revokedCount }, 'Other user sessions revoked');

    return revokedCount;
  }

  /**
   * Get session statistics
   * @returns Session statistics
   */
  getStats(): SessionStats {
    const sessionsByUser = new Map<string, number>();

    for (const [userId, sessionIds] of this.userSessions.entries()) {
      sessionsByUser.set(userId, sessionIds.size);
    }

    return {
      totalSessions: this.sessions.size,
      sessionsByUser,
      cleanedUpSessions: this.cleanedUpCount,
    };
  }

  /**
   * Clean up expired sessions
   * @returns Number of sessions cleaned up
   */
  async cleanup(): Promise<number> {
    let cleanedCount = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (this.isSessionExpired(session)) {
        await this.removeSession(sessionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.cleanedUpCount += cleanedCount;
      this.logger.debug({ count: cleanedCount }, 'Expired sessions cleaned up');
    }

    return cleanedCount;
  }

  /**
   * Destroy the session manager and clean up resources
   */
  async destroy(): Promise<void> {
    // Stop cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    // Clear all sessions
    this.sessions.clear();
    this.userSessions.clear();

    this.logger.debug('Session manager destroyed');
  }

  /**
   * Generate a unique session ID
   * @returns Session ID
   */
  private generateSessionId(): string {
    return `sess_${randomUUID()}`;
  }

  /**
   * Check if session is expired
   * @param session - Session to check
   * @returns True if expired
   */
  private isSessionExpired(session: Session): boolean {
    return session.expiresAt.getTime() <= Date.now();
  }

  /**
   * Remove a session
   * @param sessionId - Session ID
   * @returns True if session was removed
   */
  private async removeSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    // Remove from sessions map
    this.sessions.delete(sessionId);

    // Remove from user sessions
    const userSessionSet = this.userSessions.get(session.userId);
    if (userSessionSet) {
      userSessionSet.delete(sessionId);
      if (userSessionSet.size === 0) {
        this.userSessions.delete(session.userId);
      }
    }

    this.logger.debug({ sessionId, userId: session.userId }, 'Session removed');

    return true;
  }

  /**
   * Remove the oldest session for a user
   * @param userId - User ID
   */
  private async removeOldestSession(userId: string): Promise<void> {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds || sessionIds.size === 0) {
      return;
    }

    let oldestSession: Session | null = null;
    let oldestSessionId: string | null = null;

    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId);
      if (session) {
        if (!oldestSession || session.createdAt < oldestSession.createdAt) {
          oldestSession = session;
          oldestSessionId = sessionId;
        }
      }
    }

    if (oldestSessionId) {
      await this.removeSession(oldestSessionId);
      this.logger.info({ userId, sessionId: oldestSessionId }, 'Oldest session removed due to max sessions limit');
    }
  }

  /**
   * Start automatic cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch((error) => {
        this.logger.error({ error: error.message }, 'Session cleanup failed');
      });
    }, this.config.cleanupInterval);

    // Ensure timer doesn't prevent process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }
}
