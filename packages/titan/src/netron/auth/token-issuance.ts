/**
 * Server-side helpers for service code to issue / clear auth tokens
 * in a transport-agnostic way.
 *
 * The auth RPC service calls `issueTokens({ access, refresh })` on
 * signin/refresh and `clearTokens()` on signout. The configured
 * {@link ITokenTransport} on the netron instance decides *how* the
 * tokens reach the client: cookie mode emits Set-Cookie headers and
 * strips tokens from the JSON body; bearer mode is a no-op and the
 * service's returned body carries the tokens.
 *
 * Internally, the helpers use AsyncLocalStorage to find the current
 * request's {@link NetronMiddlewareContext.metadata} Map without
 * requiring the user's @Public method to receive a framework context
 * argument. The HTTP transport sets up the ALS frame around every
 * handler invocation (see {@link runWithTokenIssuanceContext}).
 *
 * Service code can ALSO pass an explicit context (advanced path for
 * tests / middleware-level use). Both call shapes are supported.
 *
 * @module @omnitron-dev/titan/netron/auth/token-issuance
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { NetronMiddlewareContext } from '../transport/http/middleware/types.js';
import type { IssuedTokens } from './token-transport.js';
import { buildSetCookie, buildClearCookie, type CookieAttributes } from './cookie-codec.js';

/**
 * Metadata keys consumed by the HTTP transport's response builder.
 * Exported so transport implementations and tests can reference the
 * canonical key names without hard-coding strings.
 */
export const TOKEN_ISSUANCE_METADATA_KEYS = {
  /** Tokens to issue (cookie mode emits Set-Cookie). */
  issued: 'netron:auth:issuedTokens',
  /** Boolean flag: clear all auth tokens (cookie mode emits Max-Age=0). */
  cleared: 'netron:auth:clearTokens',
  /** Collected Set-Cookie header values queued for the response. */
  setCookies: 'netron:auth:setCookies',
} as const;

/**
 * Per-request context frame. Lives only for the duration of a single
 * service method invocation; the HTTP transport pushes it before
 * calling the handler and pops it on return.
 *
 * `requestHeaders` is an optional snapshot of the incoming request
 * headers (lowercase keys) so service code can introspect things like
 * the Cookie header — used by cookie-mode refresh, where the refresh
 * token lives in a cookie the JS layer can't read, so the server-side
 * RPC method needs to extract it itself.
 */
interface TokenIssuanceFrame {
  metadata: Map<string, unknown>;
  requestHeaders?: Record<string, string>;
}

const storage = new AsyncLocalStorage<TokenIssuanceFrame>();

/**
 * Internal: invoke `fn` inside an AsyncLocalStorage frame so that
 * {@link issueTokens} / {@link clearTokens} can find the current
 * request's metadata Map without receiving it as an argument.
 *
 * Called by transport servers (HTTP today; WS / TCP could opt in
 * later). Re-entrant nesting is benign — the inner frame shadows the
 * outer for the duration of `fn`.
 */
export function runWithTokenIssuanceContext<T>(
  metadata: Map<string, unknown>,
  fn: () => T | Promise<T>,
  options?: { requestHeaders?: Record<string, string> }
): T | Promise<T> {
  return storage.run({ metadata, ...(options?.requestHeaders ? { requestHeaders: options.requestHeaders } : {}) }, fn);
}

/**
 * Read a cookie value from the ambient request. Returns null when called
 * outside a service-handler context or when the cookie is absent.
 *
 * Service code uses this to bridge cookie-only credentials (e.g. the
 * refresh-token cookie) into endpoint handlers that historically
 * accepted the credential in the request body.
 *
 * @example
 *   async refreshAccessToken(request) {
 *     const refresh = request.refreshToken ?? readRequestCookie('omni_refresh');
 *     if (!refresh) throw new UnauthorizedError('No refresh token');
 *     ...
 *   }
 */
export function readRequestCookie(name: string): string | null {
  const headers = storage.getStore()?.requestHeaders;
  if (!headers) return null;
  const cookieHeader = headers['cookie'];
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(';')) {
    const trimmed = pair.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq).trim() !== name) continue;
    const value = trimmed.slice(eq + 1).trim();
    const unquoted = value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
    try {
      return decodeURIComponent(unquoted);
    } catch {
      return unquoted;
    }
  }
  return null;
}

/**
 * Internal: read the current ALS frame's metadata. Returns null when
 * called outside of a service-handler context (e.g. unit tests
 * exercising the helpers directly).
 */
function currentMetadata(): Map<string, unknown> | null {
  return storage.getStore()?.metadata ?? null;
}

/**
 * Request the framework issue the given tokens to the client. Idempotent
 * (last call wins). Service code calls this from signin/refresh handlers.
 *
 * Two call shapes:
 *  - `issueTokens(tokens)` — uses the ambient request context (the
 *    common case for @Public methods on a Netron service).
 *  - `issueTokens(ctx, tokens)` — explicit context, useful in middleware
 *    or tests where the caller already holds the NetronMiddlewareContext.
 *
 * @example
 *   @Public()
 *   async signin(dto: SigninDto) {
 *     const { user, accessToken, refreshToken } = await this.svc.signin(dto);
 *     issueTokens({ access: accessToken, refresh: refreshToken });
 *     return { user, accessToken, refreshToken };
 *     // Cookie mode strips accessToken/refreshToken from the body
 *     // before serialization; bearer mode leaves the body untouched.
 *   }
 */
export function issueTokens(tokens: IssuedTokens): void;
export function issueTokens(ctx: Pick<NetronMiddlewareContext, 'metadata'>, tokens: IssuedTokens): void;
export function issueTokens(
  first: IssuedTokens | Pick<NetronMiddlewareContext, 'metadata'>,
  second?: IssuedTokens
): void {
  const { metadata, tokens } = resolveContextAndPayload(first, second);
  metadata.set(TOKEN_ISSUANCE_METADATA_KEYS.issued, tokens);
}

/**
 * Request the framework clear any auth tokens from the client. Service
 * code calls this from signout handlers. Bearer mode is a no-op
 * (client clears its own storage); cookie mode emits Max-Age=0
 * Set-Cookie for every registered cookie.
 *
 * Two call shapes (see {@link issueTokens}):
 *  - `clearTokens()` — ambient context
 *  - `clearTokens(ctx)` — explicit context
 */
export function clearTokens(ctx?: Pick<NetronMiddlewareContext, 'metadata'>): void {
  const metadata = ctx?.metadata ?? currentMetadata();
  if (!metadata) {
    throw new Error(
      'clearTokens() called outside of a service-handler context — either pass ctx explicitly or invoke inside runWithTokenIssuanceContext'
    );
  }
  metadata.set(TOKEN_ISSUANCE_METADATA_KEYS.cleared, true);
}

/**
 * Queue one Set-Cookie for this response, for a cookie that is NOT an auth
 * token.
 *
 * `issueTokens` speaks only of `access` and `refresh`, and only when a cookie
 * transport is configured. A platform needs other cookies that a gateway —
 * not the application — reads: a maintenance-mode bypass an nginx/Lua layer
 * compares against a stored hash, a canary flag, a shard pin. They have no
 * business in the token transport and no reason to wait for one.
 *
 * Writes into the SAME queue the transport appends to
 * ({@link TOKEN_ISSUANCE_METADATA_KEYS.setCookies}), which the HTTP server
 * flushes into the response after every POST_PROCESS middleware has run —
 * unconditionally, not only when tokens were issued. So this composes with
 * `issueTokens` in either order and in either transport mode.
 *
 * This function exists so that nobody writes into that metadata key by hand.
 * The key is exported for transports and tests, and a second writer with its
 * own idea of the attributes is how two cookies of one name end up in a jar:
 * browsers key on (name, path, domain), so a value written once with `Path=/`
 * and once without is two cookies, and which one is sent is not something the
 * server decides.
 *
 * SECURITY: `attrs` defaults are the auth-grade ones from
 * {@link buildSetCookie} — `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`.
 * A deployment served over plain HTTP (an onion address, a development
 * stand) MUST pass `secure: false`, or the browser drops the cookie and the
 * caller sees nothing but a feature that does not work. Take that flag from
 * whatever already decided it for the session cookie; do not re-derive it.
 *
 * @example
 *   issueCookie('omni_maint', secret, { secure, maxAge: 86_400 });
 */
export function issueCookie(name: string, value: string, attrs?: CookieAttributes): void;
export function issueCookie(
  ctx: Pick<NetronMiddlewareContext, 'metadata'>,
  name: string,
  value: string,
  attrs?: CookieAttributes
): void;
export function issueCookie(
  first: string | Pick<NetronMiddlewareContext, 'metadata'>,
  second: string,
  third?: string | CookieAttributes,
  fourth?: CookieAttributes
): void {
  if (typeof first === 'string') {
    queueSetCookie(null, buildSetCookie(first, second, third as CookieAttributes | undefined));
    return;
  }
  queueSetCookie(first.metadata, buildSetCookie(second, third as string, fourth));
}

/**
 * Queue a Set-Cookie that deletes one non-auth cookie.
 *
 * `path` and `domain` MUST match what {@link issueCookie} used, because the
 * browser deletes by the (name, path, domain) tuple and silently keeps a
 * cookie whose tuple differs — a bypass that outlives the session that was
 * given it, with nothing in any log to say so.
 *
 * Distinct from {@link clearTokens}, which clears the transport's registered
 * auth cookies and knows nothing about these.
 */
export function clearCookie(name: string, attrs?: Pick<CookieAttributes, 'path' | 'domain'>): void;
export function clearCookie(
  ctx: Pick<NetronMiddlewareContext, 'metadata'>,
  name: string,
  attrs?: Pick<CookieAttributes, 'path' | 'domain'>
): void;
export function clearCookie(
  first: string | Pick<NetronMiddlewareContext, 'metadata'>,
  second?: string | Pick<CookieAttributes, 'path' | 'domain'>,
  third?: Pick<CookieAttributes, 'path' | 'domain'>
): void {
  if (typeof first === 'string') {
    queueSetCookie(null, buildClearCookie(first, second as Pick<CookieAttributes, 'path' | 'domain'> | undefined));
    return;
  }
  queueSetCookie(first.metadata, buildClearCookie(second as string, third));
}

/**
 * Internal: append one serialized Set-Cookie to the response queue.
 *
 * Appends rather than replaces: a handler may set several cookies, and the
 * transport's own tokens are in the same array.
 */
function queueSetCookie(metadata: Map<string, unknown> | null, serialized: string): void {
  const target = metadata ?? currentMetadata();
  if (!target) {
    throw new Error(
      'issueCookie()/clearCookie() called outside of a service-handler context — either pass ctx explicitly or invoke inside runWithTokenIssuanceContext'
    );
  }
  const existing = target.get(TOKEN_ISSUANCE_METADATA_KEYS.setCookies) as string[] | undefined;
  target.set(TOKEN_ISSUANCE_METADATA_KEYS.setCookies, existing ? [...existing, serialized] : [serialized]);
}

/**
 * Internal: normalize the two call shapes of issueTokens() into a
 * { metadata, tokens } pair, throwing a clear error if no ambient
 * context is available.
 */
function resolveContextAndPayload(
  first: IssuedTokens | Pick<NetronMiddlewareContext, 'metadata'>,
  second?: IssuedTokens
): { metadata: Map<string, unknown>; tokens: IssuedTokens } {
  if (second !== undefined) {
    // Explicit (ctx, tokens) form
    const ctx = first as Pick<NetronMiddlewareContext, 'metadata'>;
    return { metadata: ctx.metadata, tokens: second };
  }
  // Ambient (tokens) form
  const metadata = currentMetadata();
  if (!metadata) {
    throw new Error(
      'issueTokens() called outside of a service-handler context — either pass ctx explicitly or invoke inside runWithTokenIssuanceContext'
    );
  }
  return { metadata, tokens: first as IssuedTokens };
}
