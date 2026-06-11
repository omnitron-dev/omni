/**
 * Minimal RFC 6265 cookie codec for Netron auth token transport.
 *
 * We deliberately avoid pulling in the `cookie` npm package: the subset
 * we need (parse Cookie header into Map, build Set-Cookie strings with
 * a small attribute set) is ~80 lines and keeping it in-tree lets the
 * core titan package remain dependency-thin.
 *
 * @module @omnitron-dev/titan/netron/auth/cookie-codec
 */

/**
 * SameSite attribute values for Set-Cookie. The browser uses these to
 * decide whether to send the cookie on cross-site requests; "Strict"
 * is the default for our auth cookies (highest XSRF resistance).
 */
export type CookieSameSite = 'Strict' | 'Lax' | 'None';

/**
 * Attributes for serializing a Set-Cookie header. Defaults are chosen
 * for auth-grade cookies (HttpOnly + Secure + SameSite=Strict).
 */
export interface CookieAttributes {
  /** Cookie value validity in seconds. Omit for session-only cookies. */
  maxAge?: number;
  /** Explicit expiration date (use either Max-Age or Expires; both is fine, browsers prefer Max-Age). */
  expires?: Date;
  /** Cookie scope path. Default: '/'. */
  path?: string;
  /** Cookie scope domain. Default: omitted (host-only cookie). */
  domain?: string;
  /** Mark cookie as HttpOnly (not readable from JS). Default: true. */
  httpOnly?: boolean;
  /** Mark cookie as Secure (HTTPS only). Default: true (callers should override for dev/HTTP). */
  secure?: boolean;
  /** SameSite policy. Default: 'Strict'. */
  sameSite?: CookieSameSite;
}

/**
 * Parse a Cookie request header into a Map of name -> value.
 *
 * Cookies share a single header with `name=value; name2=value2` syntax.
 * This parser is tolerant to malformed entries (skips them silently)
 * because real-world Cookie headers from browsers can contain stale
 * or partial state we don't control.
 *
 * @param header - The raw `Cookie` header value (string | string[] | undefined).
 * @returns A Map of cookie name to decoded value. Empty Map if no cookies.
 *
 * @example
 *   parseCookieHeader('omni_access=eyJ...; csrf=abc')
 *     -> Map { 'omni_access' => 'eyJ...', 'csrf' => 'abc' }
 */
export function parseCookieHeader(header: string | string[] | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;

  // Browsers send a single Cookie header; some proxies / clients may
  // duplicate it. Normalize array form into a single semicolon-joined
  // string before splitting.
  const raw = Array.isArray(header) ? header.join('; ') : header;

  for (const pair of raw.split(';')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue; // skip malformed (no '=', or starts with '=')
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!name) continue;
    // Strip surrounding double quotes if present (RFC 6265 §5.2)
    const unquoted = value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
    try {
      out.set(name, decodeURIComponent(unquoted));
    } catch {
      // decode failed (e.g. lone %): use raw value rather than dropping
      out.set(name, unquoted);
    }
  }
  return out;
}

/**
 * Build a Set-Cookie header value from a name, value, and attributes.
 *
 * Attribute defaults are biased toward security:
 *  - HttpOnly: true
 *  - Secure: true (callers MUST override to false in dev/HTTP)
 *  - SameSite: Strict
 *  - Path: '/'
 *
 * @param name - Cookie name (RFC 6265 token; must not contain control chars).
 * @param value - Cookie value (will be URL-encoded for safe transport).
 * @param attrs - Optional attribute overrides.
 * @returns A header value suitable for `res.setHeader('Set-Cookie', ...)` or
 *   appending via Set-Cookie multi-value.
 *
 * @example
 *   buildSetCookie('omni_access', 'jwt', { maxAge: 900, path: '/api' })
 *     -> 'omni_access=jwt; Max-Age=900; Path=/api; HttpOnly; Secure; SameSite=Strict'
 */
export function buildSetCookie(name: string, value: string, attrs: CookieAttributes = {}): string {
  if (!isValidCookieName(name)) {
    throw new Error(`Invalid cookie name: ${JSON.stringify(name)}`);
  }
  // RFC 6265bis cookie-name prefixes carry browser-enforced invariants — a
  // Set-Cookie that violates them is silently dropped by the browser, so we
  // fail fast at construction time (mirrors the production-Secure guard).
  //   __Host-  → must be Secure, Path=/, and NO Domain (host-only)
  //   __Secure- → must be Secure
  if (name.startsWith('__Host-')) {
    if (attrs.secure === false) throw new Error(`__Host- cookie "${name}" must be Secure`);
    if (attrs.domain) throw new Error(`__Host- cookie "${name}" must not set a Domain`);
    if (attrs.path !== undefined && attrs.path !== '/') {
      throw new Error(`__Host- cookie "${name}" must use Path=/`);
    }
  } else if (name.startsWith('__Secure-') && attrs.secure === false) {
    throw new Error(`__Secure- cookie "${name}" must be Secure`);
  }
  const parts: string[] = [`${name}=${encodeURIComponent(value)}`];

  if (typeof attrs.maxAge === 'number' && Number.isFinite(attrs.maxAge)) {
    parts.push(`Max-Age=${Math.floor(attrs.maxAge)}`);
  }
  if (attrs.expires instanceof Date && !isNaN(attrs.expires.getTime())) {
    parts.push(`Expires=${attrs.expires.toUTCString()}`);
  }
  parts.push(`Path=${attrs.path ?? '/'}`);
  if (attrs.domain) {
    parts.push(`Domain=${attrs.domain}`);
  }
  if (attrs.httpOnly !== false) {
    parts.push('HttpOnly');
  }
  if (attrs.secure !== false) {
    parts.push('Secure');
  }
  parts.push(`SameSite=${attrs.sameSite ?? 'Strict'}`);

  return parts.join('; ');
}

/**
 * Build a Set-Cookie value that immediately expires (clears) a cookie.
 * Browsers compare the (name, path, domain) tuple — to actually delete,
 * the path and domain must match the original cookie. Empty value +
 * Max-Age=0 is the canonical "clear" pattern.
 *
 * @param name - Cookie name to clear.
 * @param attrs - Path/domain attributes MUST match the original Set-Cookie.
 */
export function buildClearCookie(name: string, attrs: Pick<CookieAttributes, 'path' | 'domain'> = {}): string {
  if (!isValidCookieName(name)) {
    throw new Error(`Invalid cookie name: ${JSON.stringify(name)}`);
  }
  // A __Host-/__Secure- cookie can only be (re)written with a Secure attribute,
  // and __Host- additionally pins Path=/ + no Domain. The CLEAR Set-Cookie MUST
  // satisfy the same invariants or the browser rejects it and never deletes the
  // cookie — i.e. signout would silently leave the session cookie in place.
  const isHost = name.startsWith('__Host-');
  const isSecure = isHost || name.startsWith('__Secure-');
  const path = isHost ? '/' : (attrs.path ?? '/');
  const parts: string[] = [`${name}=`, 'Max-Age=0', `Path=${path}`];
  if (!isHost && attrs.domain) parts.push(`Domain=${attrs.domain}`);
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * RFC 6265 §4.1.1 — cookie name is an HTTP token: ASCII visible chars
 * excluding separators. We use a conservative whitelist; the practical
 * attack vector is header injection (CRLF), which this check blocks.
 */
function isValidCookieName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  // No control chars, no whitespace, no separators
  return /^[a-zA-Z0-9!#$%&'*+\-.^_`|~]+$/.test(name);
}
