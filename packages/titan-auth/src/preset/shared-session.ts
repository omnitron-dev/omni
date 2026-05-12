/**
 * Shared-session JWT auth preset for Titan/Omnitron systems.
 *
 * Codifies the pattern every omni-style multi-backend platform
 * uses for authentication: a shared HS256-signed JWT issued by one
 * backend (the auth owner) and verified by every sibling backend
 * against a stack-level session registry (Redis-backed by default,
 * with optional fallback to the canonical store on the owner).
 *
 * The preset gives any Titan app:
 *   1. A `createSharedSessionAuthManager(...)` factory that returns
 *      a configured `AuthenticationManager` ready to plug into
 *      `app.netron.configureAuth(...)`.
 *   2. Two typed errors — `SessionRevokedAuthError` and
 *      `InvalidTokenClaimError` — both 401 + machine-readable
 *      `code` so HTTP clients and Netron middleware can branch.
 *   3. Hardened claim validation: `sub` MUST be a non-empty string;
 *      `iss` MUST match the configured platform issuer (default
 *      `'omnitron'`, overridable, disable-able for a migration).
 *   4. Multi-role JWT support: prefers `payload.roles[]`, falls
 *      back to `[payload.role]` for legacy single-role tokens.
 *   5. Pluggable session registry: Redis fast-path, optional
 *      canonical-store slow-path. After a Redis flush / cold-start
 *      the slow path re-warms Redis with the row's remaining TTL,
 *      so the next request is back on the fast path.
 *
 * Flow:
 *
 *     ┌─────────┐   verify HS256   ┌──────────┐
 *     │ token   │ ────────────────►│ payload  │
 *     └─────────┘                  └──────────┘
 *                                       │
 *                                       ▼
 *               assert sub + iss claims (hard fail)
 *                                       │
 *                                       ▼ (if sid claim)
 *                              ┌─ Redis registry ─┐
 *                              │   hit → accept   │
 *                              │   miss ─┐        │
 *                              └─────────┼────────┘
 *                                        ▼
 *                            sessionLookup adapter
 *                              ┌─ canonical store ┐
 *                              │   hit → re-warm  │
 *                              │           Redis  │
 *                              │   miss → revoked │
 *                              └──────────────────┘
 *
 * Backend roles:
 *   - The "owner" backend (the one that mints tokens and writes
 *     the session table) SHOULD wire `sessionLookup` so the slow
 *     path can recover the platform from a cold Redis.
 *   - "Side" backends pass `sessionLookup: undefined` and rely on
 *     Redis only; they recover automatically as soon as the owner
 *     re-warms the registry.
 *
 * Usage (in a Titan bootstrap `afterCreate` hook):
 *
 *     import {
 *       createSharedSessionAuthManager,
 *     } from '@omnitron-dev/titan-auth/preset/shared-session';
 *     import { JWT_SERVICE_TOKEN } from '@omnitron-dev/titan-auth';
 *     import { REDIS_MANAGER } from '@omnitron-dev/titan-redis';
 *
 *     afterCreate: async (app) => {
 *       const jwtService = await app.container.resolveAsync(JWT_SERVICE_TOKEN);
 *       const redis = (await app.container.resolveAsync(REDIS_MANAGER))
 *         .getClient('default');
 *       const logger = ...; // from logger module
 *       app.netron.configureAuth(
 *         createSharedSessionAuthManager({
 *           logger,
 *           jwtService,
 *           sessionRedis: redis,
 *           // Owner backend only:
 *           sessionLookup: async (sid) => db
 *             .selectFrom('user_sessions')
 *             .select(['userId', 'expiresAt', 'isRevoked'])
 *             .where('id', '=', sid)
 *             .executeTakeFirst(),
 *           expectedIssuer: 'omnitron',     // default
 *           sessionKeyPrefix: 'omni:session:', // default
 *         }),
 *       );
 *     }
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { AuthenticationManager } from '@omnitron-dev/titan/netron/auth';
import type { AuthContext } from '@omnitron-dev/titan/netron/auth';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { IJWTService } from '../auth.types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SessionRedisClient {
  get(key: string): Promise<string | null>;
  /**
   * Optional setter used by the slow-path re-warm. Compatible with
   * `SET key value EX ttl`. The factory uses it fire-and-forget —
   * failures are logged at debug level and never block the request.
   */
  set?(key: string, value: string, mode: 'EX', ttlSec: number): Promise<unknown>;
}

/**
 * Postgres-/store-backed session lookup. Returning `undefined`
 * (no row) is treated as session-not-found → SessionRevokedAuthError.
 * `isRevoked === true` is treated the same way. A live row is
 * accepted and its TTL is used to re-warm Redis.
 *
 * `activeRefreshTokenId` (optional) is used to validate the access
 * token's `cnf.fp` claim. When provided, the slow path re-warms
 * Redis with this value so subsequent requests can validate via
 * the fast path. When omitted (back-compat for sessions without
 * the refresh-token chain), cnf.fp is not enforced.
 */
export type SessionLookup = (sessionId: string) => Promise<
  | {
      userId: unknown;
      expiresAt: Date | string | number;
      isRevoked: boolean | null;
      activeRefreshTokenId?: string | null;
    }
  | undefined
>;

/**
 * Parsed shape of a Redis session entry.
 *
 * Two storage formats are accepted for graceful rollout:
 *   - Legacy (back-compat): the value is a plain `<userId>` string.
 *     No refresh-token id available → cnf.fp not enforced.
 *   - Current: the value is JSON `{"u":"<userId>","r":"<rtid>"}`.
 *     When the access token carries a `cnf.fp` claim, the verifier
 *     recomputes HMAC(rtid, hmacSecret) and rejects on mismatch.
 */
interface ParsedSessionValue {
  userId: string;
  refreshTokenId?: string;
}

function parseSessionValue(raw: string): ParsedSessionValue | null {
  if (!raw) return null;
  // JSON-format detection without throwing on every read: structured
  // values always start with `{`.
  if (raw.charCodeAt(0) === 0x7b /* '{' */) {
    try {
      const obj = JSON.parse(raw) as { u?: unknown; r?: unknown };
      if (typeof obj.u !== 'string' || obj.u.length === 0) return null;
      return {
        userId: obj.u,
        ...(typeof obj.r === 'string' && obj.r.length > 0
          ? { refreshTokenId: obj.r }
          : {}),
      };
    } catch {
      return null;
    }
  }
  return { userId: raw };
}

function serializeSessionValue(v: ParsedSessionValue): string {
  return v.refreshTokenId ? JSON.stringify({ u: v.userId, r: v.refreshTokenId }) : v.userId;
}

/**
 * Constant-time hex-string comparison. JS string `===` short-circuits
 * on the first mismatched character and leaks the position via timing.
 * cnf.fp validation must use a constant-time compare to be useful.
 */
function constantTimeEqHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export interface SharedSessionAuthManagerOptions {
  logger: ILogger;
  jwtService: IJWTService;
  sessionRedis: SessionRedisClient;
  /**
   * Optional fallback to the canonical session store. When set,
   * a Redis miss triggers this lookup; a hit re-warms Redis.
   * Recommended on the backend that owns the table. Side-backends
   * pass `undefined` and run Redis-only.
   */
  sessionLookup?: SessionLookup;
  /** Redis key prefix. Default: `'omni:session:'`. */
  sessionKeyPrefix?: string;
  /** Token validation cache TTL in ms. Default: 60_000 (1 min). */
  cacheTtl?: number;
  /**
   * Required JWT `iss` claim. Default: `'omnitron'`. Setting this to
   * `null` disables the check (only use for legacy-token migration).
   *
   * Without this check, ANY service that happens to share the same
   * JWT_SECRET could mint tokens that pass authentication here.
   * Asserting the issuer quarantines the auth domain even when the
   * secret is reused elsewhere by mistake.
   */
  expectedIssuer?: string | null;
  /**
   * Server-side HMAC secret for verifying the `cnf.fp` confirmation
   * claim (RFC 7800). When set AND the access token carries `cnf.fp`,
   * the verifier recomputes `HMAC-SHA256(activeRefreshTokenId, secret)`
   * (truncated to 32 hex chars / 128 bits) and rejects on mismatch.
   *
   * The signer (typically the platform's auth-owner backend) computes
   * cnf.fp from the SAME secret + the refresh-token row id at
   * access-token mint time. On rotation, the active refresh-token id
   * changes, so old access tokens whose cnf.fp targets the previous
   * id stop validating on the next request — no per-token bookkeeping
   * needed, just one HMAC + one Redis read.
   *
   * If `cnfHmacSecret` is unset, the cnf.fp claim is ignored. If it's
   * set but the Redis session entry doesn't carry the rtid (legacy
   * format), cnf.fp is also skipped. Both are graceful-rollout
   * fallbacks; production should run with both wired.
   *
   * Typically the same string as `JWT_SECRET` — the kid mechanism
   * handles secret rotation independently. Separate values are fine
   * if you want belt-and-suspenders.
   */
  cnfHmacSecret?: string;
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Thrown when a JWT's session is no longer alive — either the
 * Redis registry entry expired/was revoked, or the canonical-store
 * fallback returned a revoked/missing row. HTTP middleware surfaces
 * this as 401.
 */
export class SessionRevokedAuthError extends Error {
  public readonly code = 'SESSION_REVOKED' as const;
  public readonly statusCode = 401 as const;
  constructor(message = 'Session has been revoked or expired') {
    super(message);
    this.name = 'SessionRevokedAuthError';
  }
}

/**
 * Thrown when a JWT lacks a required claim or carries the wrong
 * issuer. Distinct from SessionRevokedAuthError so debug logs and
 * tests can tell "token claim broken" apart from "session gone."
 * Both still surface as 401 to the client.
 */
export class InvalidTokenClaimError extends Error {
  public readonly code = 'INVALID_TOKEN_CLAIM' as const;
  public readonly statusCode = 401 as const;
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTokenClaimError';
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Netron `AuthenticationManager` wired to the shared-session
 * JWT pattern. See file header for the validation flow.
 */
export function createSharedSessionAuthManager(
  opts: SharedSessionAuthManagerOptions,
): AuthenticationManager {
  const {
    logger,
    jwtService,
    sessionRedis,
    sessionLookup,
    sessionKeyPrefix = 'omni:session:',
    cacheTtl = 60_000,
    expectedIssuer = 'omnitron',
    cnfHmacSecret,
  } = opts;

  function computeCnfFp(refreshTokenId: string): string | null {
    if (!cnfHmacSecret) return null;
    return createHmac('sha256', cnfHmacSecret)
      .update(refreshTokenId)
      .digest('hex')
      .slice(0, 32);
  }

  return new AuthenticationManager(logger, {
    authenticate: async () => {
      throw new Error(
        'Credential authentication not supported. Use JWT Bearer token.',
      );
    },

    validateToken: async (token: string): Promise<AuthContext> => {
      const payload = await jwtService.verify(token);

      // ---- Claim validation ----
      // (1) `sub` must be a non-empty string. Pre-fix the missing
      //     subject silently became AuthContext.userId=undefined and
      //     every downstream check (RLS, audit, RBAC) keyed off
      //     `undefined` — a quiet auth bypass.
      const sub = payload['sub'];
      if (typeof sub !== 'string' || sub.length === 0) {
        throw new InvalidTokenClaimError('Token missing required `sub` claim');
      }
      // (2) `iss` must match the platform issuer. Quarantines the
      //     auth domain even when JWT_SECRET happens to be shared
      //     with an unrelated service.
      if (expectedIssuer !== null) {
        const iss = payload['iss'];
        if (iss !== expectedIssuer) {
          throw new InvalidTokenClaimError(
            `Token issuer mismatch: expected '${expectedIssuer}'`,
          );
        }
      }

      // ---- Session registry check ----
      const sessionId = payload['sid'] as string | undefined;
      let activeSession: ParsedSessionValue | null = null;
      if (sessionId) {
        const redisKey = `${sessionKeyPrefix}${sessionId}`;
        const rawFastPath = await sessionRedis.get(redisKey);
        activeSession = rawFastPath ? parseSessionValue(rawFastPath) : null;

        if (!activeSession && sessionLookup) {
          // Slow path: consult the canonical store.
          try {
            const row = await sessionLookup(sessionId);
            if (!row || row.isRevoked) {
              throw new SessionRevokedAuthError(
                row?.isRevoked ? 'Session revoked' : 'Session not found',
              );
            }
            const expiresAt =
              row.expiresAt instanceof Date
                ? row.expiresAt
                : new Date(row.expiresAt as string | number);
            const remainingSec = Math.floor(
              (expiresAt.getTime() - Date.now()) / 1000,
            );
            if (remainingSec <= 0) {
              throw new SessionRevokedAuthError('Session expired');
            }
            activeSession = {
              userId: String(row.userId),
              ...(row.activeRefreshTokenId
                ? { refreshTokenId: row.activeRefreshTokenId }
                : {}),
            };
            // Fire-and-forget Redis re-warm.
            if (sessionRedis.set) {
              sessionRedis
                .set(redisKey, serializeSessionValue(activeSession), 'EX', remainingSec)
                .catch((err) =>
                  logger.debug({ err, sessionId }, 'Session re-warm failed'),
                );
            }
          } catch (err) {
            if (err instanceof SessionRevokedAuthError) throw err;
            // Canonical store outage: fail closed. The client handles
            // 401 by attempting a refresh; recovery is automatic once
            // the store is reachable again.
            logger.warn(
              { err, sessionId },
              'Session canonical-store fallback failed — rejecting request',
            );
            throw new SessionRevokedAuthError('Session lookup failed');
          }
        }

        if (!activeSession) {
          throw new SessionRevokedAuthError('Session not registered');
        }

        // ---- cnf.fp confirmation claim ----
        // Both signer and verifier compute cnf.fp = HMAC(rtid, secret).
        // After a refresh-token rotation the active rtid changes, so
        // old access tokens whose cnf.fp targets the previous rtid
        // stop validating. Enforced only when BOTH (a) the token
        // carries the claim AND (b) the Redis entry carries the rtid.
        // Either side missing → graceful no-op (sessions issued before
        // the rotation upgrade keep working).
        const cnf = payload['cnf'] as { fp?: unknown } | undefined;
        const presentedFp = cnf?.fp;
        if (typeof presentedFp === 'string' && presentedFp.length > 0) {
          const expectedFp =
            activeSession.refreshTokenId
              ? computeCnfFp(activeSession.refreshTokenId)
              : null;
          if (expectedFp && !constantTimeEqHex(presentedFp, expectedFp)) {
            // Mismatch: this access token was minted under a
            // refresh-token id that's no longer active. Either the
            // refresh chain rotated (legitimate aging) or this token
            // is stale/replayed. Either way: reject so the client
            // refreshes.
            throw new SessionRevokedAuthError(
              'Access token bound to a rotated refresh token',
            );
          }
          // expectedFp === null: legacy session value or
          // cnfHmacSecret unset — silently allow.
        }
      }

      // ---- Roles ----
      // Prefer the canonical `roles[]` claim (multi-role JWTs); fall
      // back to wrapping the legacy singular `role` for back-compat
      // with tokens issued before the schema upgrade.
      const claimedRoles = payload['roles'];
      const roles =
        Array.isArray(claimedRoles) && claimedRoles.length > 0
          ? (claimedRoles as string[])
          : payload['role']
            ? [payload['role'] as string]
            : [];

      return {
        userId: sub,
        roles,
        permissions: (payload['permissions'] as string[] | undefined) ?? [],
        token: { type: 'bearer' },
        metadata: {
          sessionId,
          tenantId: payload['tenant_id'] || 'default',
          isServiceRole:
            roles.includes('service_role') || payload['role'] === 'service_role',
        },
      };
    },

    // When cnf.fp is enforced, the AuthenticationManager-level cache
    // becomes a security hole: it would re-use a cached AuthResult
    // for up to cacheTtl ms after a refresh-token rotation, letting
    // an attacker keep replaying a stolen access token despite the
    // legitimate rotation invalidating its cnf.fp. The JWTService
    // still caches the (expensive) HS256 signature check internally,
    // so we only lose the (cheap) Redis-GET-and-cnf.fp recheck per
    // request — a few μs against the security guarantee.
    tokenCache: cnfHmacSecret
      ? { enabled: false }
      : { enabled: true, ttl: cacheTtl },
  });
}
