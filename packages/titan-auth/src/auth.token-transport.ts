/**
 * High-level factories for the netron token-transport strategies.
 *
 * Wraps the lower-level constructors in `@omnitron-dev/titan/netron/auth`
 * with sensible defaults for the omnitron-platform conventions:
 *
 *  - access-cookie  = 'omni_access'  / 15-min TTL / Path '/'
 *  - refresh-cookie = 'omni_refresh' / 7-day TTL / Path '/'
 *  - csrf-cookie    = 'omni_csrf'    / 15-min TTL / non-HttpOnly
 *
 * In Secure host-only deployments the access/refresh cookies additionally get
 * the RFC 6265bis '__Host-' name prefix (browser-enforced Secure + host-only +
 * Path=/), which defeats subdomain cookie-tossing / session fixation.
 *
 * Apps that want different naming / scoping should call the underlying
 * constructors directly (via `@omnitron-dev/titan/netron/auth`).
 *
 * @module @omnitron-dev/titan-auth/token-transport
 */

import {
  BearerTokenTransport,
  CompositeTokenTransport,
  CookieTokenTransport,
  CsrfManager,
  type CookieSpec,
  type ITokenTransport,
} from '@omnitron-dev/titan/netron/auth';

// Re-export the low-level constructors and types so callers can mix
// custom transports with these high-level helpers without juggling
// two import paths.
export {
  BearerTokenTransport,
  CompositeTokenTransport,
  CookieTokenTransport,
  CsrfManager,
};
export type { ITokenTransport, CookieSpec };

export interface OmniCookieTransportOptions {
  /**
   * Whether the deployment runs over HTTPS. When false (dev/HTTP),
   * the cookies are emitted without the Secure attribute. Defaults
   * to `process.env.NODE_ENV === 'production'`.
   */
  secure?: boolean;
  /**
   * Cookie domain. Omit for host-only cookies (the recommended
   * default — most omnitron deployments live on a single host).
   */
  domain?: string;
  /** Override access-cookie name. Default: 'omni_access'. */
  accessCookieName?: string;
  /** Override access-cookie TTL in seconds. Default: 900 (15 min, matches JWT exp). */
  accessMaxAgeSec?: number;
  /** Override refresh-cookie name. Default: 'omni_refresh'. */
  refreshCookieName?: string;
  /** Override refresh-cookie path (scope). Default: '/api/main/auth'. */
  refreshPath?: string;
  /** Override refresh-cookie TTL in seconds. Default: 604800 (7 days). */
  refreshMaxAgeSec?: number;
  /**
   * Whether to also enable CSRF (double-submit cookie + middleware).
   * Strongly recommended — cookie mode without CSRF leaves the
   * deployment open to XSRF. Default: true.
   */
  csrf?: boolean | CsrfManager;
  /** Override CSRF cookie name. Default: 'omni_csrf'. */
  csrfCookieName?: string;
  /** Override CSRF header name. Default: 'X-CSRF-Token'. */
  csrfHeaderName?: string;
}

/**
 * Build a CookieTokenTransport pre-configured with omni-platform
 * defaults (cookie names, paths, TTLs, CSRF enablement).
 *
 * @example
 *   const transport = createOmniCookieTransport({
 *     secure: process.env.NODE_ENV === 'production',
 *   });
 *   netron.configureAuth(authMgr, authzMgr, { tokenTransport: transport });
 */
export function createOmniCookieTransport(opts: OmniCookieTransportOptions = {}): {
  transport: CookieTokenTransport;
  csrf: CsrfManager | undefined;
  /** Resolved access-cookie name (carries the `__Host-` prefix when applied). */
  accessCookieName: string;
} {
  const secure = opts.secure ?? process.env['NODE_ENV'] === 'production';
  const domain = opts.domain;

  // T#176-sec — fail-fast on production + insecure cookies. The
  // failure mode without this guard is silent: the browser receives
  // Set-Cookie without Secure, attaches it on subsequent HTTP requests,
  // and an on-path attacker between the user and the gateway can steal
  // the session. We refuse to construct the transport in that shape so
  // a misconfig surfaces at boot rather than mid-traffic.
  if (process.env['NODE_ENV'] === 'production' && opts.secure === false) {
    throw new Error(
      'createOmniCookieTransport: refusing to emit non-Secure cookies in production. ' +
        'Either deploy behind HTTPS (and set X-Forwarded-Proto correctly so the cookie attribute matches) ' +
        'or override NODE_ENV. Never run cookie-mode auth over plain HTTP in production.',
    );
  }

  // CSRF manager (optional — strongly recommended for cookie mode).
  let csrf: CsrfManager | undefined;
  if (opts.csrf === false) {
    csrf = undefined;
  } else if (opts.csrf instanceof CsrfManager) {
    csrf = opts.csrf;
  } else {
    csrf = new CsrfManager({
      headerName: opts.csrfHeaderName,
      cookie: {
        name: opts.csrfCookieName ?? 'omni_csrf',
        path: '/',
        domain,
        secure,
        sameSite: 'Strict',
        maxAgeSec: opts.accessMaxAgeSec ?? 15 * 60,
      },
    });
  }

  // __Host- prefix (RFC 6265bis): the gold-standard hardening for session
  // cookies — the browser GUARANTEES the cookie is Secure, host-only (no
  // Domain) and Path=/, so a sibling subdomain (or a network attacker pivoting
  // through one) cannot set or overwrite it (cookie-tossing / fixation). It is
  // only valid for Secure host-only cookies, so we apply it exactly when both
  // hold. Access/refresh are HttpOnly server-internal credentials, so the
  // prefix is transparent to clients (they never read these by name).
  const refreshPath = opts.refreshPath ?? '/';
  const canHostPrefix = secure && !domain;
  const accessName = (canHostPrefix ? '__Host-' : '') + (opts.accessCookieName ?? 'omni_access');
  // The refresh cookie additionally needs Path=/ to qualify for __Host-.
  const refreshName =
    (canHostPrefix && refreshPath === '/' ? '__Host-' : '') + (opts.refreshCookieName ?? 'omni_refresh');

  const accessCookie: CookieSpec = {
    name: accessName,
    path: '/',
    domain,
    secure,
    sameSite: 'Strict',
    httpOnly: true,
    maxAgeSec: opts.accessMaxAgeSec ?? 15 * 60,
  };
  const refreshCookie: CookieSpec = {
    // Path scoping: the netron RPC dispatcher is single-endpoint per backend;
    // narrowing the refresh-cookie path beyond `/` would mean the browser
    // doesn't ship it on the refresh RPC. The defense a narrow path used to
    // provide is already covered by HttpOnly + SameSite=Strict (+ __Host-).
    name: refreshName,
    path: refreshPath,
    domain,
    secure,
    sameSite: 'Strict',
    httpOnly: true,
    maxAgeSec: opts.refreshMaxAgeSec ?? 7 * 24 * 60 * 60,
  };

  const transport = new CookieTokenTransport({ accessCookie, refreshCookie, csrf });
  return { transport, csrf, accessCookieName: accessName };
}

/**
 * Build a CompositeTokenTransport that prefers cookies for browser
 * clients and falls back to bearer headers for S2S calls. Common
 * production shape: one netron handles both user-facing requests
 * (cookie) and service-to-service traffic (bearer with a
 * service-account JWT).
 */
export function createOmniCompositeCookieBearer(opts: OmniCookieTransportOptions = {}): {
  transport: CompositeTokenTransport;
  csrf: CsrfManager | undefined;
  /** Resolved access-cookie name (carries the `__Host-` prefix when applied). */
  accessCookieName: string;
} {
  const { transport: cookie, csrf, accessCookieName } = createOmniCookieTransport(opts);
  const composite = new CompositeTokenTransport([cookie, new BearerTokenTransport()]);
  return { transport: composite, csrf, accessCookieName };
}
