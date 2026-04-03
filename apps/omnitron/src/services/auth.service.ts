/**
 * Omnitron Auth Service
 *
 * Portal authentication for the Omnitron webapp. Handles user sign-in,
 * session lifecycle, JWT issuance, and password management.
 *
 * Uses Kysely directly against omnitron-pg (port 5480).
 * Password hashing via Node's native crypto.scrypt (zero external deps).
 * JWT via jose (HS256), already a Titan dependency.
 */

import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';
import type { Kysely } from 'kysely';
import type { OmnitronDatabase } from '../database/schema.js';

const scryptAsync = promisify(scrypt);

// =============================================================================
// Types
// =============================================================================

export interface OmnitronSignInRequest {
  username: string;
  password: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface OmnitronSignInResult {
  user: OmnitronAuthUser;
  session: OmnitronSessionInfo;
  accessToken: string;
}

export interface OmnitronAuthUser {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
  totpEnabled: boolean;
  pgpEnabled: boolean;
}

export interface OmnitronSessionInfo {
  id: string;
  expiresAt: Date;
}

export interface OmnitronActiveSession {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
  current: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const SALT_LENGTH = 32;
const KEY_LENGTH = 64;
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const JWT_EXPIRY = '1h';

// =============================================================================
// Auth Service
// =============================================================================

export class AuthService {
  private readonly jwtSecret: Uint8Array;

  constructor(
    private readonly db: Kysely<OmnitronDatabase>,
    jwtSecret?: string
  ) {
    // Derive JWT signing key from secret (or use a default for dev)
    const secret = jwtSecret ?? 'omnitron-dev-jwt-secret-change-in-production';
    this.jwtSecret = new TextEncoder().encode(secret);
  }

  // ===========================================================================
  // Sign In
  // ===========================================================================

  async signIn(request: OmnitronSignInRequest): Promise<OmnitronSignInResult> {
    const { username, password, ipAddress, userAgent } = request;

    // 1. Find user
    const user = await this.db
      .selectFrom('omnitron_users')
      .selectAll()
      .where('username', '=', username)
      .executeTakeFirst();

    if (!user) {
      throw new Error('Invalid credentials');
    }

    // 2. Verify password
    const valid = await this.verifyPassword(password, user.passwordHash);
    if (!valid) {
      throw new Error('Invalid credentials');
    }

    // 3. Create session (include role in JWT for RBAC enforcement)
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    const accessToken = await this.issueToken(user.id, sessionId, user.role);

    await this.db
      .insertInto('omnitron_sessions')
      .values({
        id: sessionId,
        userId: user.id,
        token: accessToken,
        expiresAt,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      })
      .execute();

    // 4. Update last login
    await this.db
      .updateTable('omnitron_users')
      .set({ lastLoginAt: new Date() })
      .where('id', '=', user.id)
      .execute();

    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        totpEnabled: user.totpEnabled,
        pgpEnabled: user.pgpEnabled,
      },
      session: { id: sessionId, expiresAt },
      accessToken,
    };
  }

  // ===========================================================================
  // Sign Out
  // ===========================================================================

  async signOut(sessionId: string): Promise<void> {
    await this.db
      .deleteFrom('omnitron_sessions')
      .where('id', '=', sessionId)
      .execute();
  }

  // ===========================================================================
  // Validate Session
  // ===========================================================================

  async validateSession(sessionId: string): Promise<OmnitronAuthUser | null> {
    const session = await this.db
      .selectFrom('omnitron_sessions')
      .selectAll()
      .where('id', '=', sessionId)
      .executeTakeFirst();

    if (!session) return null;

    // Check expiry
    if (new Date(session.expiresAt) < new Date()) {
      // Expired — clean up
      await this.db
        .deleteFrom('omnitron_sessions')
        .where('id', '=', sessionId)
        .execute();
      return null;
    }

    const user = await this.db
      .selectFrom('omnitron_users')
      .selectAll()
      .where('id', '=', session.userId)
      .executeTakeFirst();

    if (!user) return null;

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      totpEnabled: user.totpEnabled,
      pgpEnabled: user.pgpEnabled,
    };
  }

  /**
   * Get session info (expiry) without full user validation.
   */
  async getSessionInfo(sessionId: string): Promise<{ expiresAt: Date } | null> {
    const session = await this.db
      .selectFrom('omnitron_sessions')
      .select(['expiresAt'])
      .where('id', '=', sessionId)
      .executeTakeFirst();

    if (!session) return null;
    return { expiresAt: new Date(session.expiresAt) };
  }

  // ===========================================================================
  // Validate Token (JWT)
  // ===========================================================================

  async validateToken(token: string): Promise<{ userId: string; sessionId: string } | null> {
    try {
      const { payload } = await jwtVerify(token, this.jwtSecret, {
        algorithms: ['HS256'],
        issuer: 'omnitron',
      });

      const userId = payload.sub;
      const sessionId = payload['sid'] as string | undefined;

      if (!userId || !sessionId) return null;

      // Verify session still exists and is not expired
      const session = await this.db
        .selectFrom('omnitron_sessions')
        .select(['id', 'expiresAt'])
        .where('id', '=', sessionId)
        .where('userId', '=', userId)
        .executeTakeFirst();

      if (!session) return null;
      if (new Date(session.expiresAt) < new Date()) return null;

      return { userId, sessionId };
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // Get Active Sessions
  // ===========================================================================

  async getActiveSessions(userId: string, currentSessionId?: string): Promise<OmnitronActiveSession[]> {
    const sessions = await this.db
      .selectFrom('omnitron_sessions')
      .selectAll()
      .where('userId', '=', userId)
      .where('expiresAt', '>', new Date())
      .orderBy('createdAt', 'desc')
      .execute();

    return sessions.map((s) => ({
      id: s.id,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      createdAt: new Date(s.createdAt),
      expiresAt: new Date(s.expiresAt),
      current: s.id === currentSessionId,
    }));
  }

  // ===========================================================================
  // Refresh Session
  // ===========================================================================

  async refreshSession(sessionId: string): Promise<OmnitronSignInResult | null> {
    const session = await this.db
      .selectFrom('omnitron_sessions')
      .selectAll()
      .where('id', '=', sessionId)
      .executeTakeFirst();

    if (!session) return null;

    // Session must still be valid (allow refresh up to 5 min after expiry for grace)
    const gracePeriod = 5 * 60 * 1000;
    if (new Date(session.expiresAt).getTime() + gracePeriod < Date.now()) {
      await this.db.deleteFrom('omnitron_sessions').where('id', '=', sessionId).execute();
      return null;
    }

    const user = await this.db
      .selectFrom('omnitron_users')
      .selectAll()
      .where('id', '=', session.userId)
      .executeTakeFirst();

    if (!user) return null;

    // Issue new token and extend session (include role for RBAC)
    const newExpiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    const newToken = await this.issueToken(user.id, sessionId, user.role);

    await this.db
      .updateTable('omnitron_sessions')
      .set({ token: newToken, expiresAt: newExpiresAt })
      .where('id', '=', sessionId)
      .execute();

    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        totpEnabled: user.totpEnabled,
        pgpEnabled: user.pgpEnabled,
      },
      session: { id: sessionId, expiresAt: newExpiresAt },
      accessToken: newToken,
    };
  }

  // ===========================================================================
  // Change Password
  // ===========================================================================

  async changePassword(userId: string, oldPassword: string, newPassword: string, currentSessionId?: string): Promise<void> {
    const user = await this.db
      .selectFrom('omnitron_users')
      .select(['id', 'passwordHash'])
      .where('id', '=', userId)
      .executeTakeFirst();

    if (!user) {
      throw new Error('User not found');
    }

    const valid = await this.verifyPassword(oldPassword, user.passwordHash);
    if (!valid) {
      throw new Error('Invalid current password');
    }

    const newHash = await this.hashPassword(newPassword);

    await this.db
      .updateTable('omnitron_users')
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where('id', '=', userId)
      .execute();

    // Revoke all sessions except the caller's current session
    let query = this.db.deleteFrom('omnitron_sessions').where('userId', '=', userId);
    if (currentSessionId) {
      query = query.where('id', '!=', currentSessionId);
    }
    await query.execute();
  }

  // ===========================================================================
  // Password Hashing (crypto.scrypt — no external deps)
  // ===========================================================================

  async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
    return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    const parts = hash.split(':');
    if (parts[0] !== 'scrypt' || parts.length !== 3) return false;

    const salt = Buffer.from(parts[1]!, 'hex');
    const stored = Buffer.from(parts[2]!, 'hex');
    const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;

    return timingSafeEqual(stored, derived);
  }

  // ===========================================================================
  // JWT
  // ===========================================================================

  private async issueToken(userId: string, sessionId: string, role = 'viewer'): Promise<string> {
    return new SignJWT({ sid: sessionId, role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer('omnitron')
      .setIssuedAt()
      .setExpirationTime(JWT_EXPIRY)
      .sign(this.jwtSecret);
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /** Remove all expired sessions — call periodically */
  async cleanupExpiredSessions(): Promise<number> {
    const result = await this.db
      .deleteFrom('omnitron_sessions')
      .where('expiresAt', '<', new Date())
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0);
  }
}
