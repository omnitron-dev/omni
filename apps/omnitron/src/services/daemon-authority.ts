import type { AuthContext } from '@omnitron-dev/titan/netron/auth';
import type { AuthService } from './auth.service.js';
import { isOmnitronRole } from '../shared/roles.js';

type AuthorityStore = Pick<AuthService, 'validateSessionAuthority'>;
type VerifiedClaims = { sub?: unknown; role?: unknown; sid?: unknown; exp?: unknown; iss?: unknown };

function denied(message: string): Error {
  return Object.assign(new Error(message), { code: 'SESSION_REVOKED', statusCode: 401 });
}

/** Token verification is supplied by Titan; human authority always comes from its live session. */
export function createDaemonTokenValidator(verify: (token: string) => Promise<VerifiedClaims>, sessions: AuthorityStore | null) {
  return async (token: string): Promise<AuthContext> => {
    const claims = await verify(token);
    if (claims.iss !== 'omnitron' || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 150 ||
        typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp) || claims.exp * 1000 <= Date.now()) {
      throw denied('A bounded, unexpired Omnitron identity is required');
    }
    if (claims.role === 'service_role') {
      if (claims.sid !== undefined) throw denied('A service identity cannot carry a human session');
      return { userId: claims.sub, roles: ['service_role'], permissions: [], token: { type: 'bearer' },
        metadata: { principalType: 'service', isServiceRole: true, expiresAt: claims.exp * 1000 } };
    }
    if (!sessions || !isOmnitronRole(claims.role) || typeof claims.sid !== 'string' || !claims.sid || claims.sid.length > 150) {
      throw denied('Human access requires an active session on the master');
    }
    const current = await sessions.validateSessionAuthority(claims.sub, claims.sid);
    if (!current || !isOmnitronRole(current.role)) throw denied('Session has been revoked or expired');
    return { userId: current.userId, roles: [current.role], permissions: [], token: { type: 'bearer' },
      metadata: { principalType: 'human', sessionId: current.sessionId, isServiceRole: false, expiresAt: claims.exp * 1000 } };
  };
}

/** Recheck admitted peers on every invocation, including cached HTTP tokens and long-lived sockets. */
export function createDaemonPrincipalValidator(sessions: AuthorityStore | null) {
  return async (context: AuthContext): Promise<void> => {
    if (context.userId === 'omnitron-local' && context.metadata?.['source'] === 'local-unix-socket' &&
        context.roles?.length === 1 && context.roles[0] === 'admin') return;
    const expiresAt = context.metadata?.['expiresAt'];
    if (!context.userId || typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw denied('Authentication expired; reconnect with a current credential');
    }
    if (context.metadata?.['principalType'] === 'service' && context.roles?.length === 1 && context.roles[0] === 'service_role') return;
    const sessionId = context.metadata?.['sessionId'];
    if (!sessions || context.metadata?.['principalType'] !== 'human' || typeof sessionId !== 'string') {
      throw denied('An active human session is required');
    }
    const current = await sessions.validateSessionAuthority(context.userId, sessionId);
    // The method gate ran with the peer's admitted role. Never change that role
    // after the gate: refuse the call and require a freshly authenticated peer.
    if (!current || !isOmnitronRole(current.role) || context.roles?.length !== 1 || context.roles[0] !== current.role) {
      throw denied('Session was revoked or its role changed; authenticate again');
    }
  };
}
