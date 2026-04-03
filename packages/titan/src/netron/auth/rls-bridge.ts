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
 * Map a Netron AuthContext to a @kysera/rls RLSAuthContext
 */
export function mapAuthToRLSAuthContext(auth: AuthContext, options?: AuthToRLSOptions): RLSAuthContext {
  return {
    userId: auth.userId,
    roles: auth.roles,
    permissions: auth.permissions,
    tenantId: options?.defaultTenantId,
    attributes: auth.metadata as Record<string, unknown> | undefined,
    isSystem: false,
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
