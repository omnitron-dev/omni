/**
 * Auth Module Utilities
 *
 * Security utilities for authentication operations.
 *
 * @module titan/modules/auth
 */

import type { IAuthContext, IJWTPayload, IRequestLike } from './auth.types.js';

/**
 * Constant-time string comparison to prevent timing attacks.
 *
 * This function compares two strings in constant time, regardless of
 * how many characters match. This is critical for comparing secrets
 * like API keys to prevent timing-based side-channel attacks.
 *
 * @param a - First string
 * @param b - Second string
 * @returns True if strings are equal
 *
 * @example
 * ```typescript
 * // Safe API key comparison
 * if (constantTimeCompare(providedKey, expectedKey)) {
 *   // Keys match
 * }
 * ```
 */
export function constantTimeCompare(a: string, b: string): boolean {
  // Convert to byte arrays for safe comparison
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  // Length check must still happen, but we continue to prevent timing leak
  const maxLength = Math.max(aBytes.length, bBytes.length);
  let result = aBytes.length === bBytes.length ? 0 : 1;

  // Compare all bytes, using 0 padding for shorter string
  for (let i = 0; i < maxLength; i++) {
    const aByte = i < aBytes.length ? aBytes[i]! : 0;
    const bByte = i < bBytes.length ? bBytes[i]! : 0;
    result |= aByte ^ bByte;
  }

  return result === 0;
}

/**
 * Extract header value from request-like object.
 *
 * Handles both Map-like headers (Fetch API) and object-like headers (Node.js).
 *
 * @param request - Request-like object
 * @param name - Header name (case-insensitive)
 * @returns Header value or null
 */
export function getHeader(request: IRequestLike, name: string): string | null {
  const headers = request.headers;

  // Handle Fetch API style headers (has get method)
  if (typeof headers === 'object' && 'get' in headers && typeof headers.get === 'function') {
    return headers.get(name);
  }

  // Handle Node.js style headers (plain object)
  if (typeof headers === 'object') {
    const lowerName = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === lowerName) {
        if (Array.isArray(value)) {
          return value[0] ?? null;
        }
        return value ?? null;
      }
    }
  }

  return null;
}

/**
 * Extract Bearer token from Authorization header.
 *
 * @param request - Request-like object
 * @returns Token string or null
 */
export function extractBearerToken(request: IRequestLike): string | null {
  const authHeader = getHeader(request, 'authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

/**
 * Extract API key from request headers.
 *
 * Checks both 'x-api-key' and 'apikey' headers.
 *
 * @param request - Request-like object
 * @returns API key or null
 */
export function extractApiKey(request: IRequestLike): string | null {
  return getHeader(request, 'x-api-key') ?? getHeader(request, 'apikey');
}

/**
 * Extract tenant ID from request headers.
 *
 * @param request - Request-like object
 * @param defaultTenantId - Default tenant ID if not found
 * @returns Tenant ID
 */
export function extractTenantId(request: IRequestLike, defaultTenantId: string = 'default'): string {
  return getHeader(request, 'x-tenant-id') ?? defaultTenantId;
}

/**
 * Create an anonymous auth context.
 *
 * @param tenantId - Tenant ID
 * @returns Anonymous auth context
 */
export function createAnonymousContext(tenantId: string): IAuthContext {
  return {
    userId: 'anonymous',
    role: 'anon',
    tenantId,
    isServiceRole: false,
    claims: {
      sub: 'anonymous',
      role: 'anon',
      tenant_id: tenantId,
    },
  };
}

/**
 * Create a service-level auth context.
 *
 * @param tenantId - Tenant ID
 * @returns Service auth context
 */
export function createServiceContext(tenantId: string): IAuthContext {
  return {
    userId: 'service',
    role: 'service_role',
    tenantId,
    isServiceRole: true,
    claims: {
      sub: 'service',
      role: 'service_role',
      tenant_id: tenantId,
    },
  };
}

/**
 * Create an auth context from JWT payload.
 *
 * @param payload - JWT payload
 * @param defaultTenantId - Default tenant ID if not in payload
 * @returns Auth context
 */
export function createContextFromPayload(payload: IJWTPayload, defaultTenantId: string = 'default'): IAuthContext {
  return {
    userId: payload.sub,
    role: payload.role,
    tenantId: payload.tenant_id ?? defaultTenantId,
    isServiceRole: payload.role === 'service_role',
    claims: payload,
  };
}

/**
 * Check if a role is in a list of allowed roles.
 *
 * @param userRole - User's role
 * @param allowedRoles - List of allowed roles
 * @returns True if role is allowed
 */
export function hasRole(userRole: string, allowedRoles: string[]): boolean {
  // Service role has access to everything
  if (userRole === 'service_role') {
    return true;
  }
  return allowedRoles.includes(userRole);
}

/**
 * Check if an auth context has service-level access.
 *
 * @param context - Auth context
 * @returns True if service role
 */
export function isServiceRole(context: IAuthContext): boolean {
  return context.isServiceRole || context.role === 'service_role';
}

/**
 * Check if an auth context is anonymous.
 *
 * @param context - Auth context
 * @returns True if anonymous
 */
export function isAnonymous(context: IAuthContext): boolean {
  return context.userId === 'anonymous' || context.role === 'anon';
}
