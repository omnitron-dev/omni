/**
 * Omnitron Auth RPC Service
 *
 * Netron RPC endpoints for portal authentication.
 * Uses titan-auth + netron/auth for JWT validation (standard Titan pattern).
 *
 * Auth context flows:
 *   1. Netron HTTP middleware validates JWT → sets authContext in metadata
 *   2. invocationWrapper bridges metadata → AsyncLocalStorage
 *   3. Service methods call getCurrentAuth() / requireAuth()
 *
 * @Public({ auth: { allowAnonymous: true } }) = no auth required
 * @Public({ auth: true }) = auth required (role-based access possible)
 * @Public() = default (follows configureAuth rules)
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { Errors } from '@omnitron-dev/titan/errors';
import { requirePayload, requireString } from './anonymous-input.js';
import { getCurrentAuth, requireAuth, getRequestContext } from './auth-context.js';
import type {
  AuthService,
  OmnitronSignInResult,
  OmnitronAuthUser,
  OmnitronActiveSession,
} from './auth.service.js';

@Service({ name: 'OmnitronAuth' })
export class AuthRpcService {
  constructor(private readonly authService: AuthService) {}

  // ===========================================================================
  // Public (anonymous) endpoints — no token required
  // ===========================================================================

  @Public({ auth: { allowAnonymous: true } })
  async signIn(data: {
    username: string;
    password: string;
    userAgent?: string;
  }): Promise<OmnitronSignInResult> {
    // The address is taken from the TRANSPORT, never from the payload. It
    // used to be a client-supplied field written to omnitron_sessions
    // verbatim, so a client could stamp any address onto its own session and
    // the operator's session list would repeat it as fact.
    const payload = requirePayload(data, 'signIn');
    requireString(payload, 'username', 'signIn');
    requireString(payload, 'password', 'signIn');

    const ipAddress = getRequestContext()?.ipAddress;
    return this.authService.signIn(data, ipAddress ? { ipAddress } : {});
  }

  @Public({ auth: { allowAnonymous: true } })
  async validateToken(data: { token: string }): Promise<{
    valid: boolean;
    userId?: string;
    sessionId?: string;
  }> {
    const token = requireString(requirePayload(data, 'validateToken'), 'token', 'validateToken');
    const result = await this.authService.validateToken(token);
    if (!result) return { valid: false };
    return { valid: true, userId: result.userId, sessionId: result.sessionId };
  }

  @Public({ auth: { allowAnonymous: true } })
  async validateSession(data: { sessionId: string }): Promise<{
    valid: boolean;
    user?: OmnitronAuthUser | undefined;
    session?: { expiresAt: string } | undefined;
  }> {
    const sessionId = requireString(requirePayload(data, 'validateSession'), 'sessionId', 'validateSession');
    const user = await this.authService.validateSession(sessionId);
    if (!user) return { valid: false };
    const session = await this.authService.getSessionInfo(sessionId);
    return { valid: true, user, session: session ? { expiresAt: session.expiresAt.toISOString() } : undefined };
  }

  @Public({ auth: { allowAnonymous: true } })
  async refreshSession(data: { sessionId: string }): Promise<{
    success: boolean;
    result?: OmnitronSignInResult;
  }> {
    const sessionId = requireString(requirePayload(data, 'refreshSession'), 'sessionId', 'refreshSession');
    const result = await this.authService.refreshSession(sessionId);
    if (!result) return { success: false };
    return { success: true, result };
  }

  @Public({ auth: { allowAnonymous: true } })
  async signOut(data: { sessionId: string }): Promise<{ success: boolean }> {
    const sessionId = requireString(requirePayload(data, 'signOut'), 'sessionId', 'signOut');

    // If authenticated, verify session ownership
    const auth = getCurrentAuth();
    if (auth) {
      const sessionOwner = await this.authService.validateSession(sessionId);
      if (sessionOwner && sessionOwner.id !== auth.userId) {
        throw Errors.forbidden('Cannot revoke another user\'s session');
      }
    }
    await this.authService.signOut(sessionId);
    return { success: true };
  }

  // ===========================================================================
  // Authenticated endpoints — auth context from titan middleware
  // ===========================================================================

  @Public({ auth: true })
  async getActiveSessions(): Promise<OmnitronActiveSession[]> {
    const auth = requireAuth();
    const sessionId = (auth.metadata as any)?.sessionId;
    return this.authService.getActiveSessions(auth.userId, sessionId);
  }

  @Public({ auth: true })
  async changePassword(data: {
    oldPassword: string;
    newPassword: string;
  }): Promise<{ success: boolean }> {
    const auth = requireAuth();
    const sessionId = (auth.metadata as any)?.sessionId;
    await this.authService.changePassword(auth.userId, data.oldPassword, data.newPassword, sessionId);
    return { success: true };
  }
}
