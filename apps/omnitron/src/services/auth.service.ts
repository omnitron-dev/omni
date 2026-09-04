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
import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { OMNITRON_DB_TOKEN, JWT_SECRET_TOKEN } from '../shared/tokens.js';
import type {
  OmnitronSignInRequest,
  OmnitronSignInResult,
  OmnitronAuthUser,
  OmnitronActiveSession,
} from '../shared/dto/auth.js';

const scryptAsync = promisify(scrypt);

// =============================================================================
// Types
// =============================================================================

export type {
  OmnitronSignInRequest,
  OmnitronSignInResult,
  OmnitronAuthUser,
  OmnitronSessionInfo,
  OmnitronActiveSession,
} from '../shared/dto/auth.js';

// =============================================================================
// Constants
// =============================================================================

const SALT_LENGTH = 32;
const KEY_LENGTH = 64;
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const JWT_EXPIRY = '1h';

/** Consecutive failures tolerated before the account locks. */
const MAX_FAILED_ATTEMPTS = 5;
/** First lockout duration; doubles with each further failure. */
const LOCKOUT_BASE_MS = 60_000; // 1 minute
/** Ceiling for the exponential lockout. */
const LOCKOUT_MAX_MS = 30 * 60_000; // 30 minutes

// =============================================================================
// Auth Service
// =============================================================================

@Injectable()
export class AuthService {
  private readonly jwtSecret: Uint8Array;
  /** Lazily-computed decoy hash — see `decoyHash()`. */
  private decoyHashPromise: Promise<string> | null = null;

  // T-2 part 2 — @Inject + useClass replaces the prior useFactory.
  // The jwtSecret string used to ride a non-DI ctor param; it now
  // flows through JWT_SECRET_TOKEN registered as useValue in the
  // module, so the framework reads the dependency contract from the
  // decorator metadata. The DI guard catches both length AND
  // order-swap drift in one path.
  constructor(
    @Inject(OMNITRON_DB_TOKEN) private readonly db: Kysely<OmnitronDatabase>,
    @Inject(JWT_SECRET_TOKEN) jwtSecret: string
  ) {
    // Derive JWT signing key from secret. The default string MUST
    // match the one TitanAuthModule uses for token verification (set
    // in daemon.module.ts → `resolvedJwtSecret`); otherwise every
    // sign-in produces a token the daemon's own auth middleware
    // immediately rejects with "Authentication required". The fix is
    // for callers to always pass the resolved secret; the default
    // here exists only as a fail-safe for unit tests that construct
    // AuthService directly.
    this.jwtSecret = new TextEncoder().encode(jwtSecret || 'omnitron-dev-jwt-secret');
  }

  // ===========================================================================
  // Sign In
  // ===========================================================================

  async signIn(request: OmnitronSignInRequest): Promise<OmnitronSignInResult> {
    const { username, password, userAgent } = request;

    // 1. Find user
    const user = await this.db
      .selectFrom('omnitron_users')
      .selectAll()
      .where('username', '=', username)
      .executeTakeFirst();

    // 2. Reject while locked out, before spending a scrypt on it.
    if (user?.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const seconds = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 1000);
      throw new Error(`Account temporarily locked — try again in ${seconds}s`);
    }

    // 3. Verify password.
    //
    // An unknown username still costs a full scrypt against a throwaway hash.
    // Returning early on "no such user" made sign-in measurably faster for
    // absent accounts than for present ones, which is a username oracle on
    // the infrastructure control plane: scrypt here takes ~100ms, so the
    // difference was trivially observable over the network.
    const valid = user
      ? await this.verifyPassword(password, user.passwordHash)
      : await this.verifyPassword(password, await this.decoyHash());

    if (!user || !valid) {
      if (user) await this.registerFailedAttempt(user.id, user.failedLoginAttempts);
      throw new Error('Invalid credentials');
    }

    // 4. Create session (include role in JWT for RBAC enforcement)
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
        ipAddress: null,
        userAgent: userAgent ?? null,
      })
      .execute();

    // 5. Update last login and clear the failure streak
    await this.db
      .updateTable('omnitron_users')
      .set({ lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null })
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
  // Brute-force throttling
  // ===========================================================================

  /**
   * Record a failed sign-in and lock the account once the streak crosses the
   * threshold. The lockout grows exponentially with each additional failure
   * past the threshold, capped at LOCKOUT_MAX_MS.
   *
   * State is persisted rather than held in memory: a daemon restart — which
   * an attacker may be able to provoke — must not hand back a clean slate.
   */
  private async registerFailedAttempt(userId: string, currentAttempts: number): Promise<void> {
    const attempts = currentAttempts + 1;
    const overThreshold = attempts - MAX_FAILED_ATTEMPTS;

    const lockedUntil =
      overThreshold >= 0
        ? new Date(Date.now() + Math.min(LOCKOUT_BASE_MS * 2 ** overThreshold, LOCKOUT_MAX_MS))
        : null;

    await this.db
      .updateTable('omnitron_users')
      .set({ failedLoginAttempts: attempts, lockedUntil })
      .where('id', '=', userId)
      .execute();
  }

  /**
   * A scrypt hash of a random secret, computed once per process.
   *
   * Used to spend the same CPU on an unknown username as on a known one, so
   * response time cannot distinguish the two.
   */
  private async decoyHash(): Promise<string> {
    this.decoyHashPromise ??= this.hashPassword(randomBytes(32).toString('hex'));
    return this.decoyHashPromise;
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
