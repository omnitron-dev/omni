/**
 * Shared-session authentication for a platform's cooperating backends.
 * JWT signatures are verified by IJWTService; this boundary binds the subject
 * to a live session and keeps human and service authority disjoint. Authority
 * is checked on every validation, independently of signature-cache policy.
 *
 * Redis is the shared session registry. The optional canonical lookup can
 * recover a cache miss/outage. It must serialize any cache restoration with
 * revocation itself: an unconditional SET after a lookup can resurrect a
 * concurrently revoked session, so this preset never writes the registry.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AuthenticationManager, AuthenticationUnavailableError } from '@omnitron-dev/titan/netron/auth';
import type { AuthContext } from '@omnitron-dev/titan/netron/auth';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { IJWTService } from '../auth.types.js';

export interface SessionRedisClient {
  get(key: string): Promise<string | null>;
  /** Retained for adapter compatibility; cache restoration belongs to the canonical owner. */
  set?(key: string, value: string, mode: 'EX', ttlSec: number): Promise<unknown>;
}

/** A lookup may restore the cache only while holding the same lock as revocation. */
export type SessionLookup = (sessionId: string) => Promise<{
  userId: unknown;
  expiresAt: Date | string | number;
  isRevoked: boolean | null;
  activeRefreshTokenId?: string | null;
} | undefined>;

/** Live, application-owned authority. Read session and grants from one consistent snapshot. */
export interface SessionAuthority {
  userId: string;
  expiresAt: Date | string | number;
  isRevoked: boolean;
  activeRefreshTokenId?: string | null;
  roles: string[];
  permissions: string[];
}
export type SessionAuthorityLookup = (sessionId: string, userId: string) => Promise<SessionAuthority | undefined>;

export interface SharedSessionAuthManagerOptions {
  logger: ILogger;
  jwtService: Pick<IJWTService, 'verify'>;
  sessionRedis?: SessionRedisClient;
  sessionLookup?: SessionLookup;
  /** Canonical mode: bypass registry/cache; resolve current session and grants on every request. */
  sessionAuthority?: SessionAuthorityLookup;
  sessionKeyPrefix?: string;
  /** @deprecated Session authority is never cached; configure signature caching in IJWTService. */
  cacheTtl?: number;
  /** Use a project-specific issuer. null explicitly disables the issuer check. */
  expectedIssuer?: string | null;
  /** Verifies cnf.fp against the active refresh-token id when the claim is present. */
  cnfHmacSecret?: string;
  /** Application-owned role inheritance; it cannot promote a human to service_role. */
  roleExpander?: (roles: readonly string[]) => string[];
}

export class SessionRevokedAuthError extends Error {
  readonly code = 'SESSION_REVOKED' as const;
  readonly statusCode = 401 as const;
  constructor(message = 'Session has been revoked or expired') {
    super(message);
    this.name = 'SessionRevokedAuthError';
  }
}

export class InvalidTokenClaimError extends Error {
  readonly code = 'INVALID_TOKEN_CLAIM' as const;
  readonly statusCode = 401 as const;
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTokenClaimError';
  }
}

interface SessionValue { userId: string; refreshTokenId?: string }
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim() === value;

function claimsList(value: unknown, name: string, maximum = 2048): string[] {
  if (!Array.isArray(value) || value.length > maximum || value.some(v => !identifier(v)))
    throw new InvalidTokenClaimError(`Invalid ${name} claim`);
  return [...new Set(value as string[])];
}

function parseSessionValue(raw: string): SessionValue | null {
  if (!raw) return null;
  if (raw.startsWith('{')) {
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object') return null;
      const { u, r } = value as { u?: unknown; r?: unknown };
      if (!identifier(u) || (r !== undefined && !identifier(r))) return null;
      return { userId: u, ...(r ? { refreshTokenId: r as string } : {}) };
    } catch { return null; }
  }
  return identifier(raw) ? { userId: raw } : null;
}

function confirmationMatches(presented: string, expected: string): boolean {
  return /^[a-fA-F0-9]{32}$/.test(presented) &&
    timingSafeEqual(Buffer.from(presented, 'hex'), Buffer.from(expected, 'hex'));
}

export function createSharedSessionAuthManager(opts: SharedSessionAuthManagerOptions): AuthenticationManager {
  const { logger, jwtService, sessionRedis, sessionLookup, sessionKeyPrefix = 'omni:session:',
    expectedIssuer = 'omnitron', cnfHmacSecret } = opts;
  if (!opts.sessionAuthority && !sessionRedis) throw new Error('A session authority or session registry is required');

  async function session(id: string): Promise<SessionValue> {
    let active: SessionValue | null = null;
    let unavailable: unknown;
    try {
      const raw = await sessionRedis!.get(`${sessionKeyPrefix}${id}`);
      if (raw !== null && typeof raw !== 'string') throw new Error('Invalid session registry response');
      active = raw ? parseSessionValue(raw) : null;
      if (raw && !active) throw new Error('Invalid session registry record');
    } catch (error) {
      unavailable = error;
      logger.warn({ event: 'auth.session.registry_unavailable' }, 'Session registry unavailable; consulting canonical authority');
    }
    if (active) return active;
    if (!sessionLookup) {
      if (unavailable) throw new AuthenticationUnavailableError();
      throw new SessionRevokedAuthError('Session not registered');
    }
    try {
      const row = await sessionLookup(id);
      if (!row || row.isRevoked === true) throw new SessionRevokedAuthError();
      const expiresAt = new Date(row.expiresAt).getTime();
      if (!identifier(row.userId) || !Number.isFinite(expiresAt) ||
          (row.isRevoked !== false && row.isRevoked !== null) ||
          (row.activeRefreshTokenId != null && !identifier(row.activeRefreshTokenId)))
        throw new Error('Invalid canonical session record');
      if (expiresAt <= Date.now()) throw new SessionRevokedAuthError('Session expired');
      return { userId: row.userId, ...(row.activeRefreshTokenId ? { refreshTokenId: row.activeRefreshTokenId } : {}) };
    } catch (error) {
      if (error instanceof SessionRevokedAuthError) throw error;
      logger.warn({ event: 'auth.session.authority_unavailable' }, 'Canonical session authority unavailable; request refused');
      throw new AuthenticationUnavailableError();
    }
  }

  return new AuthenticationManager(logger, {
    authenticate: () => { throw new Error('Use a bearer token issued by the authentication owner'); },
    validateToken: async (token): Promise<AuthContext> => {
      const payload = await jwtService.verify(token);
      const sub = payload['sub'], sid = payload['sid'], exp = payload['exp'];
      if (!identifier(sub)) throw new InvalidTokenClaimError('Token requires a bounded subject');
      if (expectedIssuer !== null && payload['iss'] !== expectedIssuer)
        throw new InvalidTokenClaimError('Token issuer mismatch');
      if (typeof exp !== 'number' || !Number.isSafeInteger(exp) || exp <= Date.now() / 1000 ||
          exp > 8_640_000_000_000)
        throw new InvalidTokenClaimError('Token requires a bounded, unexpired exp claim');
      if (sid !== undefined && !identifier(sid)) throw new InvalidTokenClaimError('Invalid sid claim');
      if (payload['role'] !== undefined && !identifier(payload['role']))
        throw new InvalidTokenClaimError('Invalid role claim');
      const claimed = payload['roles'] !== undefined ? claimsList(payload['roles'], 'roles', 128) : [];
      const roles = claimed.length ? claimed : payload['role'] ? [payload['role'] as string] : [];
      const claimsService = roles.includes('service_role') || payload['role'] === 'service_role';
      if (sid !== undefined && claimsService)
        throw new InvalidTokenClaimError('Human sessions cannot claim service authority');
      if (sid === undefined && !claimsService)
        throw new InvalidTokenClaimError('Human tokens require a session id');
      let expanded = opts.roleExpander ? claimsList(opts.roleExpander(roles), 'expanded roles', 128) : roles;
      if (!claimsService && expanded.includes('service_role'))
        throw new InvalidTokenClaimError('Role inheritance cannot grant service authority');
      let permissions = payload['permissions'] === undefined ? [] : claimsList(payload['permissions'], 'permissions');
      if (payload['tenant_id'] !== undefined && !identifier(payload['tenant_id']))
        throw new InvalidTokenClaimError('Invalid tenant_id claim');
      if (sid !== undefined) {
        let active: SessionValue;
        if (opts.sessionAuthority) {
          let authority: SessionAuthority | undefined;
          try { authority = await opts.sessionAuthority(sid, sub); }
          catch {
            logger.warn({ event: 'auth.session.authority_unavailable' }, 'Canonical authority unavailable; request refused');
            throw new AuthenticationUnavailableError();
          }
          if (!authority || authority.isRevoked === true) throw new SessionRevokedAuthError();
          try {
            const expiry = new Date(authority.expiresAt).getTime();
            if (!identifier(authority.userId) || authority.isRevoked !== false || !Number.isFinite(expiry) ||
                (authority.activeRefreshTokenId != null && !identifier(authority.activeRefreshTokenId)))
              throw new Error('Invalid authority snapshot');
            if (expiry <= Date.now()) throw new SessionRevokedAuthError('Session expired');
            const current = claimsList(authority.roles, 'authority roles', 128);
            expanded = opts.roleExpander ? claimsList(opts.roleExpander(current), 'expanded roles', 128) : current;
            if (current.includes('service_role') || expanded.includes('service_role'))
              throw new Error('Human authority cannot include service_role');
            permissions = claimsList(authority.permissions, 'authority permissions');
            active = { userId: authority.userId,
              ...(authority.activeRefreshTokenId ? { refreshTokenId: authority.activeRefreshTokenId } : {}) };
          } catch (error) {
            if (error instanceof SessionRevokedAuthError) throw error;
            throw new AuthenticationUnavailableError();
          }
        } else active = await session(sid);
        if (active.userId !== sub) throw new SessionRevokedAuthError('Session does not belong to the credential subject');
        const cnf = payload['cnf'];
        if (cnf !== undefined) {
          const fp = cnf && typeof cnf === 'object' ? (cnf as { fp?: unknown }).fp : undefined;
          if (typeof fp !== 'string' || !/^[a-fA-F0-9]{32}$/.test(fp))
            throw new InvalidTokenClaimError('Invalid cnf.fp claim');
          if (cnfHmacSecret && opts.sessionAuthority && !active.refreshTokenId)
            throw new SessionRevokedAuthError('No active refresh token for this confirmation');
          if (cnfHmacSecret && active.refreshTokenId) {
            const expected = createHmac('sha256', cnfHmacSecret).update(active.refreshTokenId).digest('hex').slice(0, 32);
            if (!confirmationMatches(fp, expected))
              throw new SessionRevokedAuthError('Access token bound to a rotated refresh token');
          }
        }
      }
      return {
        userId: sub, roles: expanded, permissions,
        token: { type: 'bearer', expiresAt: new Date(exp * 1000) },
        metadata: { sessionId: sid, tenantId: payload['tenant_id'] ?? 'default', isServiceRole: claimsService,
          ...(sid !== undefined && opts.sessionAuthority ? { authoritySource: 'canonical' } : {}) },
        claims: payload,
      } as AuthContext;
    },
    // JWTService may cache signatures. Session revocation is a separate live decision.
    tokenCache: { enabled: false },
  });
}
