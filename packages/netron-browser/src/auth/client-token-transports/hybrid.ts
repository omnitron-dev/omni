/**
 * Hybrid client-side token transport.
 *
 * Sends BOTH the Authorization header and the cookie credentials. The
 * server's own composite transport will accept whichever arrives.
 *
 * Two practical uses:
 *  - **Migration window**: roll out cookie auth gradually without
 *    breaking clients still expecting Authorization-header behaviour.
 *    Once everything is migrated, swap to the cookie-only transport.
 *  - **Service-to-service browser-like clients**: tests or admin
 *    tools that need both modes available.
 *
 * Pairs naturally with the server-side `CompositeTokenTransport(cookie, bearer)`.
 *
 * @module @omnitron-dev/netron-browser/auth/client-token-transports/hybrid
 */

import type { ClientRequestPrep, IClientTokenTransport } from '../client-token-transport.js';
import { BearerClientTokenTransport, type BearerClientTokenTransportOptions } from './bearer.js';
import { CookieClientTokenTransport, type CookieClientTokenTransportOptions } from './cookie.js';

export interface HybridClientTokenTransportOptions {
  bearer?: BearerClientTokenTransportOptions;
  cookie?: CookieClientTokenTransportOptions;
}

export class HybridClientTokenTransport implements IClientTokenTransport {
  public readonly name = 'hybrid';
  public readonly usesCookies = true;
  // Hybrid mode keeps a local token (for the header path) AND relies
  // on the cookie jar. Storage is needed.
  public readonly needsLocalTokenStorage = true;

  private readonly bearer: BearerClientTokenTransport;
  private readonly cookie: CookieClientTokenTransport;

  constructor(options: HybridClientTokenTransportOptions = {}) {
    this.bearer = new BearerClientTokenTransport(options.bearer);
    this.cookie = new CookieClientTokenTransport(options.cookie);
  }

  prepareRequest(prep: ClientRequestPrep, token: string | null): void {
    // Cookie first (sets credentials), then bearer (adds header).
    // Order does not matter functionally — they touch disjoint fields.
    this.cookie.prepareRequest(prep, token);
    this.bearer.prepareRequest(prep, token);
  }

  prepareWebSocketUrl(url: string, token: string | null): string {
    // Bearer wins for WS — cookie is implicit (browser sends it
    // automatically on same-origin), bearer adds the ?token= which
    // works as a defensive fallback if cookie ever drops.
    return this.bearer.prepareWebSocketUrl(url, token);
  }
}
