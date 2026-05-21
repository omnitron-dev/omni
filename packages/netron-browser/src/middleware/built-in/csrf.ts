/**
 * CSRF token injection middleware (browser side).
 *
 * Reads the CSRF cookie value via `document.cookie` and sets the
 * `X-CSRF-Token` request header on every protected RPC call. The
 * server's CSRF middleware compares this header against the same
 * cookie (double-submit pattern) and rejects on mismatch.
 *
 * Bypasses gracefully:
 *  - When `document` isn't available (Node-side use; non-browser tests).
 *  - When the cookie hasn't been set yet (pre-signin boot path).
 *
 * Auto-include this middleware whenever the {@link CookieClientTokenTransport}
 * is selected — it complements the cookie auth path. Bearer mode
 * doesn't need (or want) CSRF and should not register this middleware.
 *
 * @module @omnitron-dev/netron-browser/middleware/built-in/csrf
 */

import type { MiddlewareFunction } from '../types.js';

export interface CsrfMiddlewareOptions {
  /** CSRF cookie name. Default: 'omni_csrf'. */
  cookieName?: string;
  /** Header name to echo the token in. Default: 'X-CSRF-Token'. */
  headerName?: string;
  /**
   * Skip CSRF header injection for these service.method pairs (boot-
   * path RPCs that the server has already exempted). Default: no skips
   * — but the typical config is `['auth@1.0.0.signin', ...]`.
   */
  skipMethods?: string[];
}

/**
 * Create the CSRF-header injection middleware.
 */
export function createCsrfMiddleware(opts: CsrfMiddlewareOptions = {}): MiddlewareFunction {
  const cookieName = opts.cookieName ?? 'omni_csrf';
  const headerName = opts.headerName ?? 'X-CSRF-Token';
  const skipMethods = new Set(opts.skipMethods ?? []);

  return async (ctx, next) => {
    if (skipMethods.has(`${ctx.service}.${ctx.method}`)) {
      return await next();
    }

    const token = readCookie(cookieName);
    if (token) {
      if (!ctx.request) ctx.request = {};
      if (!ctx.request.headers) ctx.request.headers = {};
      ctx.request.headers[headerName] = token;
      ctx.metadata.set('csrf:injected', true);
    }
    // If the cookie isn't present (pre-signin), pass through without
    // header — the server will accept exempt endpoints (signin/refresh)
    // and reject everything else, which is correct.

    return await next();
  };
}

/**
 * Internal: read a cookie value from document.cookie. Browser-only;
 * returns null in non-DOM environments (server-side test runs, etc).
 */
function readCookie(name: string): string | null {
  if (typeof document === 'undefined' || typeof document.cookie !== 'string') return null;
  const cookies = document.cookie.split(';');
  for (const raw of cookies) {
    const eq = raw.indexOf('=');
    if (eq < 0) continue;
    const key = raw.slice(0, eq).trim();
    if (key !== name) continue;
    let value = raw.slice(eq + 1).trim();
    // T#375 — RFC 6265 permits quote-wrapped cookie values (`name="value"`).
    // Browsers normally elide the quotes when serialising into
    // document.cookie, but some pre-set scenarios (e.g. a server that
    // serialised through a sloppy cookie library, or values that happen
    // to contain spaces) leave the quotes intact. We strip a single
    // matched pair so the CSRF header carries the same byte sequence
    // the server signed — without it, the server's double-submit
    // comparison would fail on an otherwise-legitimate request.
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}
