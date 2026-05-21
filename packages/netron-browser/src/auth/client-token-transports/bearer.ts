/**
 * Bearer client-side token transport — historical default.
 *
 * Injects the JWT as `Authorization: Bearer <token>` on every RPC
 * call, and appends `?token=` to WS upgrade URLs (browsers can't set
 * custom headers on WebSocket upgrades).
 *
 * Pairs with the server-side {@link BearerTokenTransport}. Backwards-
 * compatible with pre-T#176 deployments — no config changes needed
 * to keep this working.
 *
 * @module @omnitron-dev/netron-browser/auth/client-token-transports/bearer
 */

import type { ClientRequestPrep, IClientTokenTransport } from '../client-token-transport.js';

export interface BearerClientTokenTransportOptions {
  /** Authorization header name. Default: 'Authorization'. */
  headerName?: string;
  /** Token prefix. Default: 'Bearer '. (Include trailing space.) */
  tokenPrefix?: string;
  /**
   * Query-param name used for WS upgrades. Default: 'token'.
   * Pass `null` to disable the query-param fallback entirely.
   */
  wsQueryParam?: string | null;
}

/**
 * Bearer transport. Stateless; safe to share across all clients.
 */
export class BearerClientTokenTransport implements IClientTokenTransport {
  public readonly name = 'bearer';
  public readonly usesCookies = false;
  public readonly needsLocalTokenStorage = true;

  private readonly headerName: string;
  private readonly tokenPrefix: string;
  private readonly wsQueryParam: string | null;

  constructor(options: BearerClientTokenTransportOptions = {}) {
    this.headerName = options.headerName ?? 'Authorization';
    this.tokenPrefix = options.tokenPrefix ?? 'Bearer ';
    this.wsQueryParam = options.wsQueryParam === null ? null : (options.wsQueryParam ?? 'token');
  }

  prepareRequest(prep: ClientRequestPrep, token: string | null): void {
    if (token) {
      prep.headers[this.headerName] = `${this.tokenPrefix}${token}`;
    }
    // No credentials adjustment — bearer relies on the header, not
    // the cookie jar. Default `same-origin` policy is fine.
  }

  prepareWebSocketUrl(url: string, token: string | null): string {
    if (!token || !this.wsQueryParam) return url;
    // Build a URL safely whether or not the input already has a query.
    // We can't use `new URL()` blindly because the input may already
    // be a fully-qualified ws:// URL.
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}${encodeURIComponent(this.wsQueryParam)}=${encodeURIComponent(token)}`;
  }
}
