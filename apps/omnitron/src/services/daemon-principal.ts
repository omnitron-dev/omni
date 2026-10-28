import { Errors } from '@omnitron-dev/titan/errors';
import { getCurrentAuth } from './auth-context.js';
import { hasMinimumRole, isOmnitronRole, type OmnitronRole } from '../shared/roles.js';
import type { AuthService } from './auth.service.js';

/** Revalidate human authority at sensitive boundaries, independently of transport caches. */
export async function daemonPrincipal(authService: Pick<AuthService, 'validateSession'>, minimum: OmnitronRole) {
  const context = getCurrentAuth();
  if (!context?.userId || !hasMinimumRole(context.roles ?? [], minimum))
    throw Errors.forbidden(`Requires ${minimum} access`);
  if (context.userId === 'omnitron-local' && context.metadata?.['source'] === 'local-unix-socket') {
    return { context, role: 'admin' as OmnitronRole, sessionId: undefined };
  }
  const sessionId = context.metadata?.['sessionId'];
  if (typeof sessionId !== 'string') throw Errors.forbidden('An active human session is required');
  const user = await authService.validateSession(sessionId);
  if (!user || user.id !== context.userId || !isOmnitronRole(user.role) || !hasMinimumRole([user.role], minimum)) {
    throw Errors.forbidden('Session expired, was revoked, or no longer has the required role');
  }
  return { context: { ...context, roles: [user.role] }, role: user.role, sessionId };
}

/** Evict cached tokens and remove authority from admitted persistent peers. */
export function revokeDaemonAuthority(
  netron: import('@omnitron-dev/titan/netron').Netron,
  userId: string,
  sessions: { only?: string; except?: string } = {}
): void {
  netron.revokeUserSessions(userId);
  for (const peer of netron.peers.values()) {
    const context = peer.getAuthContext();
    if (context?.userId !== userId) continue;
    const sessionId = context.metadata?.['sessionId'];
    if (sessions.only && sessionId !== sessions.only) continue;
    if (sessions.except && sessionId === sessions.except) continue;
    peer.clearAuthContext();
    void peer.close().catch(() => undefined);
  }
}
