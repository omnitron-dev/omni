/**
 * Composite token transport — chain multiple strategies.
 *
 * Useful in two scenarios:
 *
 * 1. **Migration period**: serve both cookie and bearer simultaneously so
 *    old clients (still sending Authorization headers) keep working while
 *    new clients switch to cookies. Old NON-browser clients only: a
 *    browser is answered by cookie alone, so a bearer-mode page that reads
 *    its token from the body needs a bearer transport, not this one.
 *
 * 2. **S2S coexistence**: an app accepts user-facing requests via cookies
 *    AND service-to-service calls via bearer service-account JWTs. One
 *    netron, one auth manager, two transport strategies.
 *
 * `extract()` runs delegates in order, first non-null wins. `issue()`
 * answers each request by ONE channel: a browser gets the cookie
 * delegates and a body without the tokens, any other client the bearer
 * body and no cookies (see `issue` below). `clear()` fans out to all
 * delegates — clearing a cookie a client never had costs nothing.
 *
 * @module @omnitron-dev/titan/netron/auth/token-transports/composite
 */

import { isBrowserRequest, type ITokenTransport, type IssueResult, type IssuedTokens, type TokenExtractRequest, type TokenIssueResponse } from '../token-transport.js';

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

  /**
   * One channel per response, chosen by who is asking.
   *
   * This fanned out to every delegate and stripped nothing, on the reasoning
   * that «the JWT in the body lives only for the round-trip to the signing
   * client, who already saw it via Set-Cookie too». In a browser the
   * round-trip ends in the page's scripts, which are exactly what the
   * HttpOnly cookie is for keeping the token from. Measured on the daos dev
   * stand, every backend composite (2026-09-27): `signin` answered with the
   * access token (547 chars) and the 7-day refresh token (43) in the body
   * beside the cookies, and so did a `refreshAccessToken` a script can make
   * at will: empty body, refresh cookie sent by the browser, CSRF header read
   * from the readable cookie.
   *
   * Now a browser ({@link isBrowserRequest}) gets the cookie delegates only
   * and a body stripped of what they strip; any other client gets the rest
   * and no cookies. Without the request (a caller that does not pass it) the
   * answer is the browser's: a missing body token fails loudly for a bearer
   * client, while a token left in a browser's body fails silently.
   */
  issue(res: TokenIssueResponse, tokens: IssuedTokens, req?: TokenExtractRequest): IssueResult {
    const browser = req === undefined || isBrowserRequest(req);
    const chosen = this.delegates.filter((d) => d.usesCookies === browser);
    // A composite with no delegate for this kind of client has one channel
    // only, and it is the one the client gets.
    const serving = chosen.length > 0 ? chosen : this.delegates;
    const strip = new Set<string>();
    for (const delegate of serving) {
      for (const field of delegate.issue(res, tokens, req).stripFromBody ?? []) strip.add(field);
    }
    return strip.size > 0 ? { stripFromBody: [...strip] } : {};
  }

  clear(res: TokenIssueResponse): void {
    for (const delegate of this.delegates) {
      delegate.clear(res);
    }
  }
}
