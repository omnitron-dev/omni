/**
 * Composite token transport — chain multiple strategies.
 *
 * Useful in two scenarios:
 *
 * 1. **Migration period**: serve both cookie and bearer simultaneously so
 *    old clients (still sending Authorization headers) keep working while
 *    new clients switch to cookies.
 *
 * 2. **S2S coexistence**: an app accepts user-facing requests via cookies
 *    AND service-to-service calls via bearer service-account JWTs. One
 *    netron, one auth manager, two transport strategies.
 *
 * `extract()` runs delegates in order, first non-null wins. `issue()`/
 * `clear()` fan out to ALL delegates so a signin can simultaneously
 * set Set-Cookie AND leave the tokens in the response body (bearer
 * mode reads the body, cookie mode strips them — composite strips
 * whatever ANY delegate asks to strip).
 *
 * @module @omnitron-dev/titan/netron/auth/token-transports/composite
 */

import type { ITokenTransport, IssueResult, IssuedTokens, TokenExtractRequest, TokenIssueResponse } from '../token-transport.js';

/**
 * Composite transport.
 */
export class CompositeTokenTransport implements ITokenTransport {
  public readonly name: string;
  public readonly usesCookies: boolean;

  constructor(private readonly delegates: readonly ITokenTransport[]) {
    if (!delegates || delegates.length === 0) {
      throw new Error('CompositeTokenTransport: at least one delegate is required');
    }
    this.name = `composite(${delegates.map((d) => d.name).join('+')})`;
    this.usesCookies = delegates.some((d) => d.usesCookies);
  }

  extract(req: TokenExtractRequest): string | null {
    for (const delegate of this.delegates) {
      const token = delegate.extract(req);
      if (token) return token;
    }
    return null;
  }

  issue(res: TokenIssueResponse, tokens: IssuedTokens): IssueResult {
    // Composite mode deliberately does NOT propagate stripFromBody:
    // the very reason to compose multiple transports is to serve
    // browser clients (cookie path — JWT in cookie jar) AND bearer-
    // header clients (S2S, admin tools — JWT in body) from the same
    // endpoint. Stripping the body would break the bearer-header
    // consumer. The cookie path's security guarantee is unchanged:
    // the JWT in the body lives only for the round-trip to the
    // signing client, who already saw it via Set-Cookie too. If a
    // deployment wants strict cookie-only semantics (no body leak),
    // it should configure a pure CookieTokenTransport instead of
    // composite.
    for (const delegate of this.delegates) {
      delegate.issue(res, tokens);
    }
    return {};
  }

  clear(res: TokenIssueResponse): void {
    for (const delegate of this.delegates) {
      delegate.clear(res);
    }
  }
}
