/**
 * Token Transport abstraction for Netron auth.
 *
 * Decouples *how* the JWT token travels (Authorization header,
 * HttpOnly cookie, query param, ...) from *what* the token contains
 * (JWT signature, claims, session lookup — handled by AuthenticationManager).
 *
 * One netron instance is configured with a single ITokenTransport at
 * `configureAuth(..., { tokenTransport })`. Transport servers (HTTP/WS)
 * call `extract()` to read the token off an incoming request; auth-aware
 * RPC services call into ExecutionContext.issueTokens()/clearTokens(),
 * which dispatches to `issue()`/`clear()` on the configured transport
 * during response post-processing.
 *
 * Reference implementations live under `./token-transports/`.
 *
 * @module @omnitron-dev/titan/netron/auth/token-transport
 */

/**
 * Minimal shape of an incoming request that a token transport needs to
 * inspect. We don't depend on node:http types here so the same interface
 * works for fetch-style requests, WS upgrade handshakes, and synthetic
 * test fixtures.
 */
export interface TokenExtractRequest {
  /** Raw request headers. Lowercased keys preferred but transport must be case-insensitive. */
  headers: Record<string, string | string[] | undefined>;
  /** Full request URL (path + query). Some transports use ?token= query fallback. */
  url?: string;
}

/**
 * Minimal write-side handle for token transport `issue()`/`clear()`. The
 * HTTP transport server adapts node's ServerResponse to this interface;
 * tests can pass a stub.
 */
export interface TokenIssueResponse {
  /**
   * Append a header value. For Set-Cookie this MUST be additive: cookie
   * mode issues multiple cookies (access, refresh, csrf) and replacing
   * would lose earlier sets.
   */
  appendHeader(name: string, value: string): void;
}

/**
 * The tokens being issued/refreshed. The access token is mandatory;
 * the refresh token is optional (e.g. signout, or implementations
 * that don't rotate refresh on every call).
 */
export interface IssuedTokens {
  /** Short-lived JWT used for RPC auth. */
  access: string;
  /** Optional long-lived rotation token. */
  refresh?: string;
  /** TTL override for the access token in seconds. Transport may use its own default if omitted. */
  accessMaxAgeSec?: number;
  /** TTL override for the refresh token in seconds. */
  refreshMaxAgeSec?: number;
}

/**
 * Result of `issue()` — tells the response post-processor which body
 * fields to strip before serialization.
 *
 * In cookie mode we set Set-Cookie headers AND remove `accessToken`/`refreshToken`
 * from the JSON body, so the JWT never leaks into JS-accessible context.
 * In bearer mode `issue()` is a no-op and stripFromBody is empty —
 * the client expects the tokens in the body and stores them itself.
 */
export interface IssueResult {
  /** Field paths (dot-notation) to remove from the response body. */
  stripFromBody?: string[];
}

/**
 * Strategy interface for transporting an auth token between client
 * and server. Implementations are stateless and thread-safe.
 */
export interface ITokenTransport {
  /** Human-readable transport name for diagnostics ('bearer', 'cookie', 'composite'). */
  readonly name: string;

  /**
   * True if this transport relies on HttpOnly cookies (used by CSRF
   * middleware to decide whether to enforce double-submit checks).
   */
  readonly usesCookies: boolean;

  /**
   * Read a token from an incoming request. Return null if no token
   * is present — auth middleware will then either reject or treat the
   * request as anonymous depending on policy.
   */
  extract(req: TokenExtractRequest): string | null;

  /**
   * Write issued tokens to an outgoing response (e.g. Set-Cookie).
   * For bearer transport this is a no-op; the response body already
   * contains the tokens and the client stores them.
   *
   * @returns Body-stripping spec applied by the post-processor.
   */
  issue(res: TokenIssueResponse, tokens: IssuedTokens): IssueResult;

  /**
   * Clear tokens from the client (e.g. Set-Cookie with Max-Age=0).
   * Called on signout. Bearer transport: no-op (client clears its
   * own storage based on the response).
   */
  clear(res: TokenIssueResponse): void;
}
