/**
 * Cookie token transport — JWT in HttpOnly cookies.
 *
 * Reads the access token from a configurable Cookie name on incoming
 * requests; issues Set-Cookie headers on signin/refresh; emits a
 * delete-cookie on signout.
 *
 * The transport understands two cookies — access and (optional) refresh —
 * because they typically have different `Path` and `Max-Age` profiles:
 *   - access:  Path=/api, Max-Age=15min (matches JWT TTL)
 *   - refresh: Path=/api/main/auth, Max-Age=7d (scoped to refresh endpoint)
 *
 * `stripFromBody` instructs the post-processor to remove `accessToken`
 * and `refreshToken` keys from the JSON response: in cookie mode the
 * JWT must NEVER appear in a JS-readable surface (that defeats the
 * whole HttpOnly point).
 *
 * @module @omnitron-dev/titan/netron/auth/token-transports/cookie
 */

import { buildClearCookie, buildSetCookie, parseCookieHeader, type CookieAttributes } from '../cookie-codec.js';
import type { ITokenTransport, IssueResult, IssuedTokens, TokenExtractRequest, TokenIssueResponse } from '../token-transport.js';
import type { CsrfManager } from '../csrf.js';

/**
 * Per-cookie configuration: name + override-able attributes.
 *
 * Attributes default to secure-by-default values defined in
 * `cookie-codec.ts` (HttpOnly, Secure, SameSite=Strict). Callers
 * SHOULD set `secure: false` for dev/HTTP deployments.
 */
export interface CookieSpec {
  /** Cookie name. */
  name: string;
  /** Default Max-Age in seconds. Caller can override per-call via IssuedTokens.{access,refresh}MaxAgeSec. */
  maxAgeSec?: number;
  /** Cookie path (default '/'). For refresh tokens, narrow to the refresh endpoint. */
  path?: string;
  /** Cookie domain. Default: omitted (host-only). */
  domain?: string;
  /** Mark HttpOnly. Default: true (and you should leave it true for auth cookies). */
  httpOnly?: boolean;
  /** Mark Secure. Default: true. Override to false for dev/HTTP. */
  secure?: boolean;
  /** SameSite policy. Default: 'Strict'. */
  sameSite?: CookieAttributes['sameSite'];
}

/**
 * Cookie transport options.
 */
export interface CookieTokenTransportOptions {
  /** Access-token cookie spec (REQUIRED). */
  accessCookie: CookieSpec;
  /** Refresh-token cookie spec (optional — omit for deployments without refresh rotation). */
  refreshCookie?: CookieSpec;
  /**
   * Body fields to strip when issuing tokens. Default:
   * `['accessToken', 'refreshToken']` — matches the de-facto field
   * names returned by the daos auth RPC. Override for other schemas.
   */
  stripFields?: string[];
  /**
   * CSRF manager. When provided, `issue()` also emits a fresh CSRF
   * cookie (non-HttpOnly, readable by client JS) on every successful
   * signin/refresh, and `clear()` clears it. The accompanying server
   * middleware (see {@link createCsrfMiddleware}) then enforces
   * double-submit on every protected RPC.
   *
   * Leave undefined for backwards compatibility — but a cookie-mode
   * deployment SHOULD configure this for XSRF protection.
   */
  csrf?: CsrfManager;
}

/**
 * Cookie-based transport.
 */
export class CookieTokenTransport implements ITokenTransport {
  public readonly name = 'cookie';
  public readonly usesCookies = true;

  private readonly accessCookie: CookieSpec;
  private readonly refreshCookie: CookieSpec | undefined;
  private readonly stripFields: string[];
  private readonly csrf: CsrfManager | undefined;

  constructor(options: CookieTokenTransportOptions) {
    if (!options.accessCookie?.name) {
      throw new Error('CookieTokenTransport: accessCookie.name is required');
    }
    this.accessCookie = options.accessCookie;
    this.refreshCookie = options.refreshCookie;
    this.stripFields = options.stripFields ?? ['accessToken', 'refreshToken'];
    this.csrf = options.csrf;
  }

  extract(req: TokenExtractRequest): string | null {
    const header = readHeader(req.headers, 'cookie');
    if (header === undefined) return null;
    const cookies = parseCookieHeader(header);
    const token = cookies.get(this.accessCookie.name);
    return token && token.length > 0 ? token : null;
  }

  issue(res: TokenIssueResponse, tokens: IssuedTokens): IssueResult {
    res.appendHeader(
      'Set-Cookie',
      buildSetCookie(this.accessCookie.name, tokens.access, this.toCookieAttrs(this.accessCookie, tokens.accessMaxAgeSec))
    );
    if (this.refreshCookie && tokens.refresh) {
      res.appendHeader(
        'Set-Cookie',
        buildSetCookie(
          this.refreshCookie.name,
          tokens.refresh,
          this.toCookieAttrs(this.refreshCookie, tokens.refreshMaxAgeSec)
        )
      );
    }
    // Rotate the CSRF token on every successful auth event. A new
    // token invalidates anything captured earlier (defense in depth
    // against session-fixation-style attacks).
    //
    // T#176-sec — defence-in-depth against pre-signin cookie planting:
    // emit a Max-Age=0 clear for the SAME-Path csrf cookie BEFORE
    // setting the new value. The browser processes Set-Cookie headers
    // in order; the clear evicts any same-path attacker-planted cookie
    // and the subsequent set installs the legitimate rotated token.
    // Cookies planted at a NARROWER path (e.g. /api/admin) survive
    // this clear, but they don't grant any auth privilege either —
    // the HttpOnly omni_access cookie is the only credential that
    // authenticates, and the attacker can't write that one.
    if (this.csrf) {
      res.appendHeader('Set-Cookie', this.csrf.buildClearCookie());
      res.appendHeader('Set-Cookie', this.csrf.buildCookie(this.csrf.generateToken()));
    }
    return { stripFromBody: [...this.stripFields] };
  }

  clear(res: TokenIssueResponse): void {
    res.appendHeader(
      'Set-Cookie',
      buildClearCookie(this.accessCookie.name, { path: this.accessCookie.path, domain: this.accessCookie.domain })
    );
    if (this.refreshCookie) {
      res.appendHeader(
        'Set-Cookie',
        buildClearCookie(this.refreshCookie.name, { path: this.refreshCookie.path, domain: this.refreshCookie.domain })
      );
    }
    if (this.csrf) {
      res.appendHeader('Set-Cookie', this.csrf.buildClearCookie());
    }
  }

  /**
   * Internal: convert a CookieSpec + per-call Max-Age override into
   * the lower-level CookieAttributes shape consumed by the codec.
   */
  private toCookieAttrs(spec: CookieSpec, maxAgeOverride: number | undefined): CookieAttributes {
    return {
      maxAge: maxAgeOverride ?? spec.maxAgeSec,
      path: spec.path,
      domain: spec.domain,
      httpOnly: spec.httpOnly,
      secure: spec.secure,
      sameSite: spec.sameSite,
    };
  }
}

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
