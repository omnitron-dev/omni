/**
 * CSRF protection (double-submit cookie) for cookie-based netron auth.
 *
 * # Why this exists
 *
 * When the JWT lives in an HttpOnly cookie, the browser ships it on
 * every same-origin request — including ones triggered by a malicious
 * third-party page hosting a forged form. That's the canonical XSRF
 * threat model.
 *
 * The mitigation here is the standard "double-submit cookie" pattern:
 *
 *  1. On signin/refresh, the server emits TWO cookies:
 *     - `omni_access` — HttpOnly (JS can't see it)
 *     - `omni_csrf`   — Non-HttpOnly (JS reads it)
 *  2. The client reads `omni_csrf` from `document.cookie` and echoes
 *     it back via `X-CSRF-Token` request header.
 *  3. This middleware (PRE_INVOKE) reads BOTH the cookie and the
 *     header, compares them constant-time, rejects on mismatch.
 *
 * A third-party page cannot read the cookie value (same-origin
 * restriction applies to `document.cookie` reads — the attacker's
 * origin sees only its own cookies), so it can't forge the header.
 * The attacker can still cause the BROWSER to send the cookie, but
 * without the matching header the server rejects.
 *
 * # When CSRF is enforced
 *
 * Only when the netron's {@link ITokenTransport} actually uses
 * cookies. Bearer-mode deployments are immune to CSRF by construction
 * (the attacker can't forge an Authorization header from a malicious
 * page), so the middleware short-circuits to a pass-through.
 *
 * Authentication-establishment endpoints (signin / refresh) are
 * exempted — the boot path can't have a CSRF cookie yet.
 *
 * @module @omnitron-dev/titan/netron/auth/csrf
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { parseCookieHeader, buildSetCookie, type CookieAttributes } from './cookie-codec.js';

/**
 * Cookie spec for the CSRF token. Non-HttpOnly (must be readable by
 * client JS); same SameSite policy as auth cookies for consistency.
 */
export interface CsrfCookieSpec {
  /** Cookie name. Default: 'omni_csrf'. */
  name?: string;
  /** Cookie path. Default: '/'. */
  path?: string;
  /** Cookie domain. Default: omitted (host-only). */
  domain?: string;
  /** Mark Secure. Default: true (override to false for dev/HTTP). */
  secure?: boolean;
  /** SameSite policy. Default: 'Strict'. */
  sameSite?: CookieAttributes['sameSite'];
  /** TTL in seconds. Default: matches access-token TTL (~15 min). */
  maxAgeSec?: number;
}

/**
 * CSRF manager — owns token generation + verification + cookie issue.
 *
 * Constructed once per netron deployment and shared across requests.
 * Stateless apart from configuration (constant-time compare is
 * stateless; token entropy is per-call from the OS RNG).
 */
export class CsrfManager {
  public readonly cookieName: string;
  public readonly headerName: string;
  private readonly cookieSpec: Required<Omit<CsrfCookieSpec, 'domain'>> & { domain?: string };

  constructor(opts: {
    /** Header name the client uses to echo the CSRF token. Default: 'X-CSRF-Token'. */
    headerName?: string;
    /** Cookie spec for the (non-HttpOnly) CSRF cookie. */
    cookie?: CsrfCookieSpec;
  } = {}) {
    this.headerName = (opts.headerName ?? 'X-CSRF-Token').toLowerCase();
    const c = opts.cookie ?? {};
    this.cookieName = c.name ?? 'omni_csrf';
    this.cookieSpec = {
      name: this.cookieName,
      path: c.path ?? '/',
      domain: c.domain,
      secure: c.secure ?? true,
      sameSite: c.sameSite ?? 'Strict',
      maxAgeSec: c.maxAgeSec ?? 15 * 60,
    };
  }

  /**
   * Generate a fresh CSRF token (32-byte URL-safe base64).
   *
   * Called by the cookie token transport on signin/refresh — every
   * successful auth event mints a new CSRF, so a stolen-and-then-
   * recovered session doesn't leave a stale token in play.
   */
  generateToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Build the Set-Cookie header value for the CSRF cookie.
   */
  buildCookie(token: string): string {
    return buildSetCookie(this.cookieSpec.name, token, {
      maxAge: this.cookieSpec.maxAgeSec,
      path: this.cookieSpec.path,
      domain: this.cookieSpec.domain,
      // CSRF cookie MUST be readable by JS (the client echoes it
      // in the X-CSRF-Token header).
      httpOnly: false,
      secure: this.cookieSpec.secure,
      sameSite: this.cookieSpec.sameSite,
    });
  }

  /**
   * Build the Set-Cookie for clearing the CSRF cookie (signout).
   */
  buildClearCookie(): string {
    return buildSetCookie(this.cookieSpec.name, '', {
      maxAge: 0,
      path: this.cookieSpec.path,
      domain: this.cookieSpec.domain,
      httpOnly: false,
      secure: this.cookieSpec.secure,
      sameSite: this.cookieSpec.sameSite,
    });
  }

  /**
   * Verify a request: header value MUST equal the value of the CSRF
   * cookie shipped with the same request. Constant-time compare to
   * resist timing-based discovery attacks.
   *
   * @returns true if the pair matches (request is CSRF-safe).
   */
  verify(request: { headers: Record<string, string | string[] | undefined> }): boolean {
    const cookieHeader = readHeader(request.headers, 'cookie');
    if (cookieHeader === undefined) return false;
    const cookies = parseCookieHeader(cookieHeader);
    const cookieToken = cookies.get(this.cookieSpec.name);
    if (!cookieToken) return false;

    const rawHeader = readHeader(request.headers, this.headerName);
    const headerToken = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (typeof headerToken !== 'string' || headerToken.length === 0) return false;

    // Different lengths can short-circuit; that's safe — an attacker
    // would learn the LENGTH of the secret but not its bytes, and
    // the length is fixed (32 bytes base64url = 43 chars).
    const a = Buffer.from(cookieToken);
    const b = Buffer.from(headerToken);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}

/**
 * Case-insensitive header lookup helper (same shape used in
 * token-transports/cookie.ts; kept inline to avoid a tiny shared module).
 */
function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | string[] | undefined {
  const direct = headers[name];
  if (direct !== undefined) return direct;
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}
