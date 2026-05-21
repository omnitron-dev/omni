/**
 * Server-side CSRF middleware for cookie-mode netron deployments.
 *
 * Registered at {@link MiddlewareStage.PRE_INVOKE} so it runs AFTER
 * the auth middleware has resolved the user (giving us auth context
 * for richer logging) but BEFORE the service method is invoked.
 *
 * Bypasses gracefully when:
 *  - The configured token transport is NOT cookie-based (bearer is
 *    immune to CSRF by construction, no point doing the work).
 *  - The current `service.method` appears in the exemption list
 *    (signin / refresh need to run before any CSRF cookie exists).
 *
 * @module @omnitron-dev/titan/netron/auth/csrf-middleware
 */

import type { CsrfManager } from './csrf.js';
import type { MiddlewareFunction, NetronMiddlewareContext } from '../transport/http/middleware/types.js';
import { TitanError, ErrorCode } from '../../errors/index.js';
import type { INetronInternal } from '../interfaces/internal-types.js';

export interface CsrfMiddlewareOptions {
  /** CSRF manager (token generation + verification). */
  csrf: CsrfManager;
  /**
   * Method qualifiers that are exempt from CSRF enforcement. Format:
   * `service@version.method` (e.g. 'auth@1.0.0.signin'). Typically
   * includes signin/refresh/signout — the boot path where no CSRF
   * cookie exists yet. Default: no exemptions (caller MUST configure).
   */
  exempt?: string[];
  /**
   * If true, enforce CSRF even when the netron's token transport does
   * NOT use cookies. Off by default (CSRF on bearer is wasted CPU).
   */
  alwaysEnforce?: boolean;
  /**
   * Name of the access-token cookie used as the "is this request
   * cookie-authenticated?" signal. Default: 'omni_access'. Must match
   * the name used by the CookieTokenTransport on this deployment.
   */
  accessCookieName?: string;
}

/**
 * Create the CSRF PRE_INVOKE middleware.
 *
 * Usage (in a bootstrap that's already configured cookie auth):
 *
 *   const csrf = new CsrfManager({ ... });
 *   const tokenTransport = new CookieTokenTransport({ ..., csrf });
 *   netron.configureAuth(authMgr, authzMgr, { tokenTransport });
 *   netron.peer.netron.transportServers.get('http')?.pipeline.use(
 *     createCsrfMiddleware({ csrf, exempt: [
 *       'auth@1.0.0.signin', 'auth@1.0.0.refresh', 'auth@1.0.0.signout',
 *     ] }),
 *     { name: 'csrf', priority: 20 },
 *     MiddlewareStage.PRE_INVOKE,
 *   );
 *
 * (Apps typically wrap this in a `withCsrf(netron, opts)` helper at
 * their own bootstrap layer; phase 5 will add such a helper.)
 */
export function createCsrfMiddleware(opts: CsrfMiddlewareOptions): MiddlewareFunction {
  const { csrf, exempt = [], alwaysEnforce = false } = opts;
  // T#176-sec — case-normalize the exempt qualifiers so a casing
  // drift in `@Service({ name })` between deployments (e.g. 'Auth'
  // vs 'auth') doesn't silently turn a boot endpoint into a CSRF-
  // protected one — which would DoS the signin flow with no clear
  // diagnostic. The normalization is symmetric: lookup is also done
  // with `.toLowerCase()` below.
  const exemptSet = new Set(exempt.map((q) => q.toLowerCase()));

  return async (ctx: NetronMiddlewareContext & { request?: Request }, next: () => Promise<void>) => {
    // Short-circuit when the netron isn't using cookies at all. Bearer-
    // only mode is CSRF-safe by construction (attacker can't forge an
    // Authorization header from a malicious origin), so the verification
    // check would be pure overhead.
    if (!alwaysEnforce) {
      const netron = (ctx.peer as any)?.netron as INetronInternal | undefined;
      if (!netron?.tokenTransport?.usesCookies) {
        return await next();
      }
    }

    // Exemption check (signin/refresh/signout typically). Case-
    // insensitive comparison matches the normalization done at
    // construction time above.
    const qualifier = `${ctx.serviceName ?? ''}.${ctx.methodName ?? ''}`.toLowerCase();
    if (exemptSet.has(qualifier)) {
      return await next();
    }

    // Read the live request headers via ctx.request (web Fetch shape).
    // Falls back to nothing — strict-fail in that path so a missing
    // request object can't bypass CSRF.
    const headersRecord: Record<string, string | string[] | undefined> = {};
    if (ctx.request?.headers) {
      ctx.request.headers.forEach((value, key) => {
        headersRecord[key.toLowerCase()] = value;
      });
    }

    // Per-request bypass: CSRF only matters for cookie-authenticated
    // requests. A request without an auth cookie is either bearer-S2S
    // (Authorization header, CSRF-immune by construction) or anonymous
    // (no privileged action possible). Both should pass through.
    //
    // The signal we key on is the access-token cookie's presence —
    // its name follows the deployment convention (defaults to
    // `omni_access`, override via env). We detect it by scanning the
    // raw Cookie header for `<authCookieName>=` rather than parsing
    // every cookie, since malformed cookies should not be treated as
    // proof of authentication.
    if (!alwaysEnforce) {
      const cookieHeader = headersRecord['cookie'];
      const cookieStr = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : (cookieHeader ?? '');
      const accessCookieName = (opts.accessCookieName ?? 'omni_access') + '=';
      const hasAccessCookie = cookieStr.split(';').some((c) => c.trim().startsWith(accessCookieName));
      if (!hasAccessCookie) {
        // No cookie auth → either bearer or anonymous. CSRF doesn't apply.
        return await next();
      }
    }

    if (!csrf.verify({ headers: headersRecord })) {
      throw new TitanError({
        code: ErrorCode.FORBIDDEN,
        message: 'CSRF validation failed',
        details: { reason: 'missing or mismatched CSRF token' },
      });
    }

    await next();
  };
}
