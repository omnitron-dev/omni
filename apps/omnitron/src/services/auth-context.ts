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
export function createAuthContextWrapper() {
  return async (metadata: Map<string, unknown>, fn: () => Promise<unknown>): Promise<unknown> => {
    const authCtx = metadata.get('authContext') as AuthContext | undefined;
    if (authCtx) {
      return runWithAuth(authCtx, fn);
    }
    return fn();
  };
}
