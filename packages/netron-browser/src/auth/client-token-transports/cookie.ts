/**
 * Cookie client-side token transport — JWT delivery via HttpOnly cookies.
 *
 * The server emits `Set-Cookie` on signin/refresh; the browser stores
 * the cookie in its (JS-inaccessible) cookie jar and ships it
 * automatically on subsequent same-origin requests. We just need to:
 *
 *  1. Set `credentials: 'include'` on fetch so the cookie is sent even
 *     on cross-origin calls behind a gateway (defensive — same-origin
 *     would already include them).
 *  2. Skip Authorization-header injection (we don't have the JWT).
 *  3. NOT append ?token= to WS upgrades (cookies ride the upgrade
 *     handshake automatically on same-origin).
 *
 * Pairs with the server-side {@link CookieTokenTransport}. CSRF
 * protection is delivered as a separate, orthogonal middleware
 * (phase 4).
 *
 * @module @omnitron-dev/netron-browser/auth/client-token-transports/cookie
 */

import type { ClientRequestPrep, IClientTokenTransport } from '../client-token-transport.js';

export interface CookieClientTokenTransportOptions {
  /**
   * Override credentials policy. Default: 'include'.
   * For deployments where same-origin policy is enforced strictly,
   * 'same-origin' is also acceptable — but cross-origin gateway
   * setups need 'include' to actually transmit the cookie.
   */
  credentials?: RequestCredentials;
}

export class CookieClientTokenTransport implements IClientTokenTransport {
  public readonly name = 'cookie';
  public readonly usesCookies = true;
  public readonly needsLocalTokenStorage = false;

  private readonly credentials: RequestCredentials;

  constructor(options: CookieClientTokenTransportOptions = {}) {
    this.credentials = options.credentials ?? 'include';
  }

  prepareRequest(prep: ClientRequestPrep, _token: string | null): void {
    // Don't inject any Authorization header. The cookie jar is the
    // source of truth, and including the JWT in a header would expose
    // it to any same-origin extension reading network state.
    prep.credentials = this.credentials;
  }

  prepareWebSocketUrl(url: string, _token: string | null): string {
    // Same-origin WS upgrade carries the cookie automatically — leave
    // the URL untouched. Cross-origin WS in cookie mode is unsupported
    // per the deployment contract (platform sits behind one gateway).
    return url;
  }
}
