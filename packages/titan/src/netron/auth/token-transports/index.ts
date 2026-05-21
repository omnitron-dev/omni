/**
 * Token transport strategies for netron auth.
 *
 * Re-export of the three reference implementations + a tiny factory
 * for the most common "composite cookie + bearer" deployment.
 *
 * @module @omnitron-dev/titan/netron/auth/token-transports
 */

export { BearerTokenTransport, type BearerTokenTransportOptions } from './bearer.js';
export { CookieTokenTransport, type CookieTokenTransportOptions, type CookieSpec } from './cookie.js';
export { CompositeTokenTransport } from './composite.js';

import { BearerTokenTransport, type BearerTokenTransportOptions } from './bearer.js';
import { CookieTokenTransport, type CookieTokenTransportOptions } from './cookie.js';
import { CompositeTokenTransport } from './composite.js';

/**
 * Build a composite transport that prefers cookies for browser clients
 * but falls back to bearer for service-to-service calls. Common shape
 * for production deployments migrating off bearer-only.
 */
export function createCompositeCookieBearer(
  cookieOpts: CookieTokenTransportOptions,
  bearerOpts: BearerTokenTransportOptions = {}
): CompositeTokenTransport {
  return new CompositeTokenTransport([new CookieTokenTransport(cookieOpts), new BearerTokenTransport(bearerOpts)]);
}
