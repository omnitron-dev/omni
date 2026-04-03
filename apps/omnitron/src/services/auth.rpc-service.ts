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
import { getCurrentAuth, requireAuth } from './auth-context.js';
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
    ipAddress?: string;
    userAgent?: string;
  }): Promise<OmnitronSignInResult> {
    return this.authService.signIn(data);
  }

  @Public({ auth: { allowAnonymous: true } })
  async validateToken(data: { token: string }): Promise<{
    valid: boolean;
    userId?: string;
    sessionId?: string;
  }> {
    const result = await this.authService.validateToken(data.token);
    if (!result) return { valid: false };
    return { valid: true, userId: result.userId, sessionId: result.sessionId };
  }

  @Public({ auth: { allowAnonymous: true } })
  async validateSession(data: { sessionId: string }): Promise<{
    valid: boolean;
    user?: OmnitronAuthUser | undefined;
    session?: { expiresAt: string } | undefined;
  }> {
    const user = await this.authService.validateSession(data.sessionId);
    if (!user) return { valid: false };
    const session = await this.authService.getSessionInfo(data.sessionId);
    return { valid: true, user, session: session ? { expiresAt: session.expiresAt.toISOString() } : undefined };
  }

  @Public({ auth: { allowAnonymous: true } })
  async refreshSession(data: { sessionId: string }): Promise<{
    success: boolean;
    result?: OmnitronSignInResult;
  }> {
    const result = await this.authService.refreshSession(data.sessionId);
    if (!result) return { success: false };
    return { success: true, result };
  }

  @Public({ auth: { allowAnonymous: true } })
  async signOut(data: { sessionId: string }): Promise<{ success: boolean }> {
    // If authenticated, verify session ownership
    const auth = getCurrentAuth();
    if (auth) {
      const sessionOwner = await this.authService.validateSession(data.sessionId);
      if (sessionOwner && sessionOwner.id !== auth.userId) {
        throw new Error('Forbidden: cannot revoke another user\'s session');
      }
    }
    await this.authService.signOut(data.sessionId);
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
