/**
 * Authentication Token Injection Middleware
 *
 * Automatically injects authentication tokens into requests by
 * delegating to a {@link IClientTokenTransport} strategy. Two ways to
 * configure:
 *
 *  - **Transport-driven** (recommended): pass `transport: IClientTokenTransport`
 *    in the options. The middleware delegates `prepareRequest()` calls
 *    to the strategy. Cookie / bearer / hybrid all work identically.
 *
 *  - **Legacy `tokenProvider` only**: backwards-compatible — if no
 *    transport is given, the middleware auto-wraps the provider in a
 *    {@link BearerClientTokenTransport}, reproducing pre-T#176 behaviour.
 */

import type { MiddlewareFunction } from '../types.js';
import { BearerClientTokenTransport } from '../../auth/client-token-transports/bearer.js';
import type { ClientRequestPrep, IClientTokenTransport } from '../../auth/client-token-transport.js';

/**
 * Token provider interface
 */
export interface TokenProvider {
  /**
   * Get the current authentication token
   */
  getToken(): string | null | Promise<string | null>;

  /**
   * Get token type (e.g., 'Bearer', 'Basic')
   */
  getTokenType?(): string;
}

/**
 * Auth middleware options
 */
export interface AuthMiddlewareOptions {
  /**
   * Token provider — returns the current local token (Bearer mode) or
   * always-null (cookie mode). Mandatory: even cookie mode passes a
   * null-returning provider so the middleware can keep its shape.
   */
  tokenProvider: TokenProvider;

  /**
   * Pluggable token-transport strategy. When provided, the middleware
   * delegates `prepareRequest()` to it (Bearer adds header, Cookie sets
   * credentials, Hybrid does both). When omitted, falls back to a
   * synthesized {@link BearerClientTokenTransport} configured from the
   * legacy `headerName`/`tokenPrefix` options — preserving the
   * pre-T#176 public API.
   */
  transport?: IClientTokenTransport;

  /**
   * Header name for token (legacy bearer-only option). Ignored when
   * `transport` is explicitly provided.
   * @default 'Authorization'
   */
  headerName?: string;

  /**
   * Token prefix (e.g., 'Bearer '). Legacy bearer-only option.
   * Ignored when `transport` is explicitly provided.
   * @default 'Bearer '
   */
  tokenPrefix?: string;

  /**
   * Skip auth for specific services
   */
  skipServices?: string[];

  /**
   * Skip auth for specific methods
   */
  skipMethods?: string[];
}

/**
 * Create authentication token injection middleware.
 *
 * Threads through any configured {@link IClientTokenTransport} so the
 * call sites (HTTP fetch, WS upgrade) see the right headers /
 * credentials / URL shape for the chosen mode.
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions): MiddlewareFunction {
  const { tokenProvider, skipServices = [], skipMethods = [] } = options;

  // Resolve the effective transport. Explicit > synthesized-from-legacy-opts.
  const transport: IClientTokenTransport = options.transport ?? buildLegacyBearer(options, tokenProvider);

  return async (ctx, next) => {
    if (skipServices.includes(ctx.service) || skipMethods.includes(`${ctx.service}.${ctx.method}`)) {
      return await next();
    }

    const token = await tokenProvider.getToken();

    if (!ctx.request) ctx.request = {};
    if (!ctx.request.headers) ctx.request.headers = {};

    // Hand a mutable "prep" object to the transport. We pass it
    // through the same ctx.request slot the HTTP transport consumes
    // downstream, plus a credentials slot the fetch layer reads.
    const prep: ClientRequestPrep = {
      headers: ctx.request.headers as Record<string, string>,
      credentials: ctx.request.credentials as RequestCredentials | undefined,
    };
    transport.prepareRequest(prep, token);

    // Mirror the (possibly-updated) credentials back into the
    // request object so the fetch transport picks them up.
    if (prep.credentials !== undefined) {
      ctx.request.credentials = prep.credentials;
    }
    // Headers were mutated in place — no copy-back needed.

    // Metadata for diagnostics / downstream middleware
    ctx.metadata.set('auth:transport', transport.name);
    if (token) {
      ctx.metadata.set('auth:injected', true);
    }

    return await next();
  };
}

/**
 * Internal: build a BearerClientTokenTransport that honours the legacy
 * `headerName` / `tokenPrefix` / `getTokenType()` options for backward
 * compatibility. Pre-T#176 callers passing only `tokenProvider` get
 * exactly the same wire behaviour as before.
 */
function buildLegacyBearer(opts: AuthMiddlewareOptions, provider: TokenProvider): BearerClientTokenTransport {
  const tokenPrefix =
    opts.tokenPrefix !== undefined ? opts.tokenPrefix : provider.getTokenType?.() || 'Bearer ';
  return new BearerClientTokenTransport({
    headerName: opts.headerName ?? 'Authorization',
    tokenPrefix,
  });
}

/**
 * Simple token provider from string or function
 */
export class SimpleTokenProvider implements TokenProvider {
  constructor(private token: string | (() => string | null)) {}

  getToken(): string | null {
    return typeof this.token === 'function' ? this.token() : this.token;
  }

  getTokenType(): string {
    return 'Bearer ';
  }
}

/**
 * Storage-based token provider (localStorage/sessionStorage)
 */
export class StorageTokenProvider implements TokenProvider {
  constructor(
    private storage: Storage,
    private key: string
  ) {}

  getToken(): string | null {
    return this.storage.getItem(this.key);
  }

  getTokenType(): string {
    return 'Bearer ';
  }
}
