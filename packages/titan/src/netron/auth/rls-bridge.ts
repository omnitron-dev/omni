/**
 * RLS Bridge - Maps Netron AuthContext to @kysera/rls RLSContext
 *
 * This bridge connects application-level authentication (netron/auth)
 * with data-level authorization (@kysera/rls).
 *
 * @module @omnitron-dev/titan/netron/auth
 */

import type { RLSContext, RLSAuthContext } from '@kysera/rls';
import { rlsContext } from '@kysera/rls';
import type { AuthContext } from './types.js';

/**
 * Options for mapping AuthContext to RLSContext
 */
export interface AuthToRLSOptions {
  /** Default tenant ID when none provided */
  defaultTenantId?: string | number;
  /** Map auth metadata keys to RLS attributes */
  attributeMapping?: Record<string, string>;
}

/**
 * Map a Netron AuthContext to a @kysera/rls RLSAuthContext.
 *
 * The JWT payload (`auth.claims`) is merged into the RLS
 * `attributes` field alongside `auth.metadata` so downstream
 * readers reconstructing an IAuthContext via `getCurrentAuth()`
 * see the original custom claims (username, displayName,
 * avatarUrl, etc.). Skipping the claims previously meant
 * `username` was lost on every HTTP-RPC call and forced the
 * messaging identity service to round-trip main for any user
 * whose identity row had not been cached yet — manifesting as
 * `IdentityResolveError: main unreachable or user not found`
 * on first sign-up. Metadata wins on collision (titan-auth's
 * explicit per-request metadata is more authoritative than
 * static JWT claims).
 *
 * The Netron `AuthContext` interface doesn't formally declare
 * `claims`, but `createSharedSessionAuthManager` attaches the
 * raw JWT payload there at runtime so downstream consumers
 * (messaging's `readProfileClaims`, etc.) can read it via the
 * titan-auth `IAuthContext` shape they use.
 */
export function mapAuthToRLSAuthContext(auth: AuthContext, options?: AuthToRLSOptions): RLSAuthContext {
  const claims = (auth as AuthContext & { claims?: Record<string, unknown> }).claims;
  const metadata = auth.metadata as Record<string, unknown> | undefined;
  const attributes: Record<string, unknown> | undefined =
    claims || metadata
      ? { ...(claims ?? {}), ...(metadata ?? {}) }
      : undefined;
  // S2S service-role tokens carry `metadata.isServiceRole === true`
  // (set by `createSharedSessionAuthManager` when the JWT claims
  // `service_role`). Cross-backend privileged traffic is semantically
  // equivalent to the in-process system context (`withSystemRLSContext`)
  // — propagate the flag so downstream consumers reading
  // `getCurrentAuth().isServiceRole` (and RLS policies checking
  // `ctx.auth.isSystem`) recognise the privileged caller. Without
  // this lift, every admin-or-service gate that reads `isServiceRole`
  // through the RLS bridge silently denies all S2S traffic even
  // though the JWT validates cleanly.
  const isSystem = (metadata as { isServiceRole?: unknown } | undefined)?.isServiceRole === true;
  return {
    userId: auth.userId,
    roles: auth.roles,
    permissions: auth.permissions,
    tenantId: options?.defaultTenantId,
    attributes,
    isSystem,
  };
}

/**
 * Map a Netron AuthContext to a full @kysera/rls RLSContext
 */
export function mapAuthToRLSContext(auth: AuthContext, options?: AuthToRLSOptions): RLSContext {
  return {
    auth: mapAuthToRLSAuthContext(auth, options),
    timestamp: new Date(),
  };
}

/**
 * Run a function within a @kysera/rls context derived from AuthContext.
 *
 * @example
 * ```typescript
 * const result = await withAuthRLSContext(authContext, async () => {
 *   // All database queries here are RLS-filtered
 *   return await repository.findAll();
 * });
 * ```
 */
export async function withAuthRLSContext<T>(
  auth: AuthContext,
  fn: () => Promise<T>,
  options?: AuthToRLSOptions
): Promise<T> {
  const ctx = mapAuthToRLSContext(auth, options);
  return rlsContext.runAsync(ctx, fn);
}

/**
 * Run a function with system-level RLS context (bypasses all policies).
 *
 * @example
 * ```typescript
 * const result = await withSystemRLSContext(async () => {
 *   // All database queries bypass RLS
 *   return await repository.findAll();
 * });
 * ```
 */
export async function withSystemRLSContext<T>(fn: () => Promise<T>, tenantId?: string | number): Promise<T> {
  const ctx: RLSContext = {
    auth: {
      userId: 'system',
      roles: ['system'],
      isSystem: true,
      tenantId,
    },
    timestamp: new Date(),
  };
  return rlsContext.runAsync(ctx, fn);
}
