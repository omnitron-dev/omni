/**
 * Auth Context — AsyncLocalStorage-based auth context for daemon RPC services
 *
 * The Netron auth middleware validates JWT and sets authContext in metadata.
 * The invocationWrapper bridges metadata → AsyncLocalStorage so service
 * methods can access the authenticated user via getCurrentAuth().
 *
 * Same pattern as main/storage/messaging backends (RLS context bridge),
 * but simplified — daemon doesn't need full RLS, just auth identity.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthContext } from '@omnitron-dev/titan/netron/auth';

/**
 * Per-request facts the transport knows and the service layer cannot ask for.
 *
 * Kept separate from `AuthContext`: that describes WHO is calling (from a
 * verified token), this describes HOW the call arrived. Mixing them would
 * invite treating a header as an identity claim.
 */
export interface RequestContext {
  /** Peer address as seen by the server, or undefined when unavailable. */
  ipAddress?: string;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/** The current request's transport facts, or null outside a request. */
export function getRequestContext(): RequestContext | null {
  return requestContextStorage.getStore() ?? null;
}

// ---------------------------------------------------------------------------
// AsyncLocalStorage instance (singleton)
// ---------------------------------------------------------------------------

const authContextStorage = new AsyncLocalStorage<AuthContext>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the current auth context from AsyncLocalStorage.
 * Returns null if no auth context is set (anonymous request).
 */
export function getCurrentAuth(): AuthContext | null {
  return authContextStorage.getStore() ?? null;
}

/**
 * Get the current auth context, throwing if not authenticated.
 */
export function requireAuth(): AuthContext {
  const ctx = getCurrentAuth();
  if (!ctx) {
    throw new Error('Authentication required');
  }
  return ctx;
}

/**
 * Get the current user ID, throwing if not authenticated.
 */
export function requireUserId(): string {
  return requireAuth().userId;
}

/**
 * Run a function within an auth context.
 * Used by the invocationWrapper to bridge metadata → AsyncLocalStorage.
 */
export function runWithAuth<T>(authContext: AuthContext, fn: () => T | Promise<T>): T | Promise<T> {
  return authContextStorage.run(authContext, fn);
}

/**
 * Creates an invocationWrapper for Netron HTTP transport.
 *
 * Bridges the authContext from metadata (set by Netron auth middleware)
 * into AsyncLocalStorage so service methods can use getCurrentAuth().
 *
 * This is the standard Titan pattern — same as apps/main bootstrap.
 */
export function createAuthContextWrapper(options: { trustProxy?: boolean } = {}) {
  return async (metadata: Map<string, unknown>, fn: () => Promise<unknown>): Promise<unknown> => {
    const authCtx = metadata.get('authContext') as AuthContext | undefined;
    const requestCtx: RequestContext = {};

    const ip = resolveClientIp(metadata, options.trustProxy === true);
    if (ip) requestCtx.ipAddress = ip;

    const run = () => (authCtx ? runWithAuth(authCtx, fn) : fn());
    return requestContextStorage.run(requestCtx, run);
  };
}

/**
 * Determine the caller's address from transport metadata.
 *
 * ## Why this is header-only
 *
 * Netron's HTTP server is built on the fetch `Request` API, which carries no
 * peer address — Node exposes the socket, the Request does not. So the only
 * address available at this layer is one a proxy wrote into a header.
 *
 * That makes `trustProxy` load-bearing rather than a nicety. A header is
 * written by whoever is talking to us: believed unconditionally, a client
 * could choose the address recorded against its own session, and the
 * operator's session list would repeat that choice as fact. (That is exactly
 * why `ipAddress` was removed from the sign-in payload — see
 * auth.rpc-service.ts. Re-introducing it via an untrusted header would undo
 * the fix in a different costume.)
 *
 * So: with no declared proxy the address stays UNKNOWN and the session list
 * shows "--". An honest blank beats a forgeable value.
 *
 * Header names arrive lower-cased. The middleware adapter also strips a
 * leading `x-`, while the RPC path does not, so both spellings are accepted.
 */
function resolveClientIp(metadata: Map<string, unknown>, trustProxy: boolean): string | undefined {
  if (!trustProxy) return undefined;

  const forwarded = metadata.get('x-forwarded-for') ?? metadata.get('forwarded-for');
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    // Left-most entry is the original client; the rest are proxies.
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }

  const realIp = metadata.get('x-real-ip') ?? metadata.get('real-ip');
  return typeof realIp === 'string' && realIp.length > 0 ? realIp : undefined;
}
