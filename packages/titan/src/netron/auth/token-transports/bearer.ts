/**
 * Bearer token transport — the default, backwards-compatible strategy.
 *
 * Reads JWT from `Authorization: Bearer <jwt>` header on HTTP requests
 * and from `?token=` query param as a WS-upgrade fallback (browsers
 * can't set custom headers on WebSocket upgrade).
 *
 * `issue()` and `clear()` are no-ops: in bearer mode the client owns
 * its token storage (sessionStorage / localStorage / cookie jar) and
 * reads tokens out of the response body itself. The server never sets
 * Set-Cookie for auth in this mode.
 *
 * @module @omnitron-dev/titan/netron/auth/token-transports/bearer
 */

import { extractBearerToken } from '../utils.js';
import type { ITokenTransport, IssueResult, IssuedTokens, TokenExtractRequest, TokenIssueResponse } from '../token-transport.js';

/**
 * Options for the Bearer transport. All optional — defaults reproduce
 * the historical netron behaviour exactly.
 */
export interface BearerTokenTransportOptions {
  /**
   * Header to read on incoming requests. Default: 'authorization'.
   * Some deployments proxy through gateways that rename the header;
   * override here if needed.
   */
  headerName?: string;
  /**
   * Query parameter name used as a WS-upgrade fallback. Default: 'token'.
   * Set to null to disable the query fallback entirely (HTTP-only
   * deployments where WS isn't used can lock down this surface).
   */
  queryParamName?: string | null;
}

/**
 * Default Bearer transport. Stateless — safe to share across requests.
 */
export class BearerTokenTransport implements ITokenTransport {
  public readonly name = 'bearer';
  public readonly usesCookies = false;

  private readonly headerName: string;
  private readonly queryParamName: string | null;

  constructor(options: BearerTokenTransportOptions = {}) {
    this.headerName = (options.headerName ?? 'authorization').toLowerCase();
    this.queryParamName = options.queryParamName === null ? null : (options.queryParamName ?? 'token');
  }

  extract(req: TokenExtractRequest): string | null {
    // Headers are commonly lowercased by node's http module, but be
    // defensive: accept any case from the caller.
    const headerValue = readHeader(req.headers, this.headerName);
    const fromHeader = extractBearerToken(typeof headerValue === 'string' ? headerValue : undefined);
    if (fromHeader) return fromHeader;

    // WebSocket fallback — browsers can't set Authorization on upgrade.
    if (this.queryParamName && req.url) {
      try {
        // The URL constructor needs an absolute base; use a stub host
        // since we only care about the search params.
        const parsed = new URL(req.url, 'http://_local_');
        const q = parsed.searchParams.get(this.queryParamName);
        if (q) return q;
      } catch {
        // Malformed URL — ignore silently. Auth middleware will treat
        // the request as anonymous.
      }
    }

    return null;
  }

  issue(_res: TokenIssueResponse, _tokens: IssuedTokens): IssueResult {
    // Bearer mode: client reads tokens from the response body and
    // manages its own storage. Server has no side-channel to write.
    return {};
  }

  clear(_res: TokenIssueResponse): void {
    // Bearer mode: client clears its own storage on signout based on
    // the RPC return value. No server-side action required.
  }
}

/**
 * Case-insensitive header lookup. Returns the first string value or
 * the entire array unchanged if the caller stored it that way.
 */
function readHeader(headers: Record<string, string | string[] | undefined>, name: string): string | string[] | undefined {
  // Fast path: direct hit on the (presumed lowercase) key
  const direct = headers[name];
  if (direct !== undefined) return direct;
  // Slow path: case-insensitive scan
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}
