/**
 * Browser-side counterpart of the server's {@link ITokenTransport}.
 *
 * Decouples *how* the auth token reaches the server (Authorization
 * header vs HttpOnly cookie auto-sent by the browser) from the rest
 * of the client (RPC pipeline, fetch transport, WS URL builder).
 *
 * Three reference implementations live under `./client-token-transports/`:
 *  - `BearerClientTokenTransport`  — Authorization header + ?token=
 *  - `CookieClientTokenTransport`  — credentials:'include', no header
 *  - `HybridClientTokenTransport`  — both (migration / S2S)
 *
 * The {@link AuthenticationClient} accepts a transport via options
 * and threads it through the middleware pipeline + HTTP/WS transports.
 *
 * @module @omnitron-dev/netron-browser/auth/client-token-transport
 */

/**
 * The mutable request bag that `prepareRequest()` decorates before the
 * HTTP transport hands the request off to `fetch()`.
 */
export interface ClientRequestPrep {
  /** Mutable header map. Implementations set/delete entries here. */
  headers: Record<string, string>;
  /**
   * Mutable fetch credentials policy. Default is `same-origin`;
   * cookie mode upgrades to `include` to ensure the browser ships
   * cookies even on cross-origin (gateway-fronted) calls.
   */
  credentials?: RequestCredentials;
}

/**
 * Strategy interface — the client-side companion to server-side
 * {@link ITokenTransport}. Stateless and shareable across requests.
 */
export interface IClientTokenTransport {
  /** Human-readable name for diagnostics. */
  readonly name: string;

  /**
   * Whether this transport relies on cookies for auth. When true, the
   * AuthenticationClient runs in `tokenless` mode (no local storage;
   * `isAuthenticated()` becomes a server-side probe) and CSRF
   * middleware is auto-enabled (phase 4).
   */
  readonly usesCookies: boolean;

  /**
   * True if the {@link AuthenticationClient} should persist the access
   * token locally. Bearer needs this (header injection); cookie mode
   * does not (browser cookie jar is the source of truth).
   */
  readonly needsLocalTokenStorage: boolean;

  /**
   * Decorate the outgoing request with whatever the transport needs:
   * Bearer adds an Authorization header; cookie upgrades credentials
   * to 'include'; hybrid does both.
   *
   * @param prep - Mutable request bag (headers + credentials).
   * @param token - The current local token, or null (cookie mode is
   *   always null since the client never sees the cookie value).
   */
  prepareRequest(prep: ClientRequestPrep, token: string | null): void;

  /**
   * Decorate a WebSocket upgrade URL. Bearer appends `?token=` because
   * browsers can't set custom headers on WS upgrade. Cookie mode
   * returns the URL unchanged — same-origin upgrades automatically
   * carry the cookie jar.
   *
   * @param url - The base WS URL (e.g. wss://host/ws).
   * @param token - The current local token, or null.
   * @returns A possibly-modified URL string.
   */
  prepareWebSocketUrl(url: string, token: string | null): string;
}
