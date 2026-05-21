/**
 * Server-side Origin-header validation for cookie-mode HTTP RPC.
 *
 * Pairs with the WebSocket-upgrade Origin check in
 * {@link ../transport/websocket/auth.ts}. Cookie-mode auth makes the
 * browser attach `omni_access` automatically on any same-origin
 * fetch, which means the only thing standing between an attacker
 * page (`evil.example`) and a privileged mutating call is:
 *
 *   1. SameSite=Strict on the cookie — blocks cross-site `fetch()`
 *      from sending the cookie at all (modern browsers).
 *   2. CSRF double-submit — `omni_csrf` cookie + `X-CSRF-Token`
 *      header, validated by {@link ./csrf-middleware.ts}.
 *   3. Origin header validation — this middleware.
 *
 * Defense-in-depth: any one layer failing (e.g. a browser bug, a
 * misconfigured SameSite default, a CSRF token leak via subdomain
 * takeover) should leave the others standing. Origin enforcement is
 * the cheapest of the three and the one we control end-to-end on
 * the server side, so we run it unconditionally for cookie-mode.
 *
 * Bypass conditions (mirror CSRF middleware):
 *  - Netron is NOT in cookie mode — bearer-only is Origin-immune by
 *    construction (an attacker can't forge an Authorization header
 *    cross-origin).
 *  - The request has no access-token cookie — bearer-S2S or anon.
 *  - The qualifier is in the exempt list (signin / refresh / whoami
 *    are called BEFORE the user has any session, so policing their
 *    Origin would lock out the boot path).
 *
 * Strict-fail rule: when enforcement is active and the request
 * carries no Origin header at all (modern browsers always set it
 * for fetch + WS; absence implies a hand-crafted client), we
 * REJECT. Same disposition as the WS handler.
 *
 * @module @omnitron-dev/titan/netron/auth/origin-middleware
 */

import type { MiddlewareFunction, NetronMiddlewareContext } from '../transport/http/middleware/types.js';
import { TitanError, ErrorCode } from '../../errors/index.js';
import type { INetronInternal } from '../interfaces/internal-types.js';

export interface OriginMiddlewareOptions {
  /**
   * Whitelist. `true` accepts any Origin (parity with the WS handler;
   * for dev only — production deployments should pin the list). An
   * array compares both the full Origin (`https://omni.example`) and
   * the host portion (`omni.example`).
   */
  allowedOrigins: true | string[];
  /**
   * Method qualifiers exempt from Origin enforcement. Same shape as
   * {@link CsrfMiddlewareOptions.exempt}. Default: no exemptions.
   */
  exempt?: string[];
  /**
   * Force the check even when the netron is in bearer-only mode.
   * Off by default; an HTTP-API surface with no browser clients
   * should keep this false.
   */
  alwaysEnforce?: boolean;
  /**
   * Name of the access-token cookie used as the "this request is
   * cookie-authenticated" signal. Default: 'omni_access'.
   */
  accessCookieName?: string;
}

function parseHost(origin: string): string | null {
  // Strict parsing: don't trust new URL() to throw on absurd inputs;
  // an Origin header is `<scheme>://<host>[:port]` (no path), and we
  // only want the host:port portion for fallback matching.
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

export function createOriginMiddleware(opts: OriginMiddlewareOptions): MiddlewareFunction {
  const { allowedOrigins, exempt = [], alwaysEnforce = false } = opts;
  const exemptSet = new Set(exempt.map((q) => q.toLowerCase()));
  // Pre-compute a Set for O(1) full-Origin lookup; the host fallback
  // remains O(n) since hosts and origins are different shapes.
  const allowedSet =
    allowedOrigins === true
      ? null
      : new Set(allowedOrigins.map((o) => o.toLowerCase()));

  return async (ctx: NetronMiddlewareContext & { request?: Request }, next: () => Promise<void>) => {
    // Bypass when not in cookie mode (bearer is Origin-immune).
    if (!alwaysEnforce) {
      const netron = (ctx.peer as any)?.netron as INetronInternal | undefined;
      if (!netron?.tokenTransport?.usesCookies) {
        return await next();
      }
    }

    const qualifier = `${ctx.serviceName ?? ''}.${ctx.methodName ?? ''}`.toLowerCase();
    if (exemptSet.has(qualifier)) {
      return await next();
    }

    const headers: Record<string, string> = {};
    if (ctx.request?.headers) {
      ctx.request.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
    }

    // Per-request bypass for non-cookie-authed traffic — mirror CSRF.
    if (!alwaysEnforce) {
      const cookieHeader = headers['cookie'] ?? '';
      const accessCookieName = (opts.accessCookieName ?? 'omni_access') + '=';
      const hasAccessCookie = cookieHeader.split(';').some((c) => c.trim().startsWith(accessCookieName));
      if (!hasAccessCookie) return await next();
    }

    const origin = headers['origin'];
    if (!origin) {
      // Strict-fail. A cookie-authenticated mutating call without an
      // Origin header is either (a) a misbehaving browser, or (b) a
      // hand-crafted client trying to bypass SameSite — we cannot
      // tell them apart, and the safe default is to deny.
      throw new TitanError({
        code: ErrorCode.FORBIDDEN,
        message: 'Origin header required for cookie-authenticated requests',
        details: { reason: 'missing Origin' },
      });
    }

    if (allowedOrigins === true) return await next();

    const lower = origin.toLowerCase();
    if (allowedSet!.has(lower)) return await next();
    const host = parseHost(origin)?.toLowerCase();
    if (host && allowedSet!.has(host)) return await next();

    throw new TitanError({
      code: ErrorCode.FORBIDDEN,
      message: 'Origin not allowed',
      details: { reason: 'origin mismatch', origin },
    });
  };
}
