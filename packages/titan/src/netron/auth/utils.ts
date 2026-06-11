/**
 * Authentication utility functions for Netron
 * Provides common helpers for auth header parsing and security utilities.
 */

import { timingSafeEqual } from 'node:crypto';

import type { AuthContext, AccessValidationResult } from './types.js';

/**
 * Constant-time string comparison to prevent timing attacks.
 * Should be used when comparing security-sensitive strings like user IDs, tenant IDs, etc.
 *
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns true if strings are equal, false otherwise
 *
 * @example
 * safeCompare('user-123', 'user-123') // returns true
 * safeCompare('user-123', 'user-456') // returns false (timing-safe)
 */
export function safeCompare(a: string, b: string): boolean {
  // Quick check for empty strings or type mismatches
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  // For different lengths, we still compare using timing-safe method
  // to avoid leaking length information through early return
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  // If lengths differ, compare against self to maintain constant time
  // but always return false
  if (bufA.length !== bufB.length) {
    // Perform a fake comparison to maintain constant time
    timingSafeEqual(bufA, bufA);
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

/**
 * Check if a granted permission pattern matches a required permission.
 * Supports wildcard matching:
 *   '*' matches everything
 *   'admin.*' matches 'admin.users.list', 'admin.config.view', etc.
 *   'admin.users.*' matches 'admin.users.list' but not 'admin.config.view'
 *   'admin.users.list' matches only 'admin.users.list' (exact)
 *
 * @param granted - The permission the user has (may contain wildcards)
 * @param required - The permission being checked (exact, no wildcards)
 * @returns true if the granted permission covers the required one
 */
export function permissionMatches(granted: string, required: string): boolean {
  if (granted === '*') return true;
  if (granted === required) return true;
  if (granted.endsWith('.*')) {
    const prefix = granted.slice(0, -1); // 'admin.users.*' → 'admin.users.'
    return required.startsWith(prefix);
  }
  return false;
}

/**
 * Check if any of the granted permissions satisfy the required permission.
 *
 * @param grantedPermissions - Array of permissions the user has
 * @param required - The permission being checked
 * @returns true if at least one granted permission covers the required one
 */
export function hasPermission(grantedPermissions: string[], required: string): boolean {
  return grantedPermissions.some((granted) => permissionMatches(granted, required));
}

/**
 * Required roles/permissions/scopes for a guarded operation.
 */
export interface AccessRequirements {
  /** ANY of these roles grants access. */
  roles?: string[];
  /** ALL of these permissions are required (wildcards supported). */
  permissions?: string[];
  /** ALL of these OAuth2 scopes are required. */
  scopes?: string[];
}

/**
 * Pure, transport-agnostic access check for roles / permissions / scopes.
 *
 * Single source of truth shared by {@link AuthorizationManager.validateAccess}
 * and the wire/HTTP `enforceMethodAuthorization` path, so the two can never
 * drift (the divergence between them was the root of SEC-1). Semantics:
 *   - roles       → ANY-of (caller needs at least one)
 *   - permissions → ALL-of (wildcard matching via {@link hasPermission})
 *   - scopes      → ALL-of
 */
export function validateAccessRequirements(
  authContext: Pick<AuthContext, 'roles' | 'permissions' | 'scopes'>,
  requirements: AccessRequirements,
): AccessValidationResult {
  const roles = authContext.roles ?? [];

  // Roles — ANY of the required roles.
  if (requirements.roles && requirements.roles.length > 0) {
    const hasRole = requirements.roles.some((role) => roles.includes(role));
    if (!hasRole) {
      return {
        allowed: false,
        reason: 'Missing required role',
        details: { missingRoles: requirements.roles.filter((r) => !roles.includes(r)) },
      };
    }
  }

  // Permissions — ALL required (wildcard-aware).
  if (requirements.permissions && requirements.permissions.length > 0) {
    const granted = authContext.permissions ?? [];
    const missingPermissions = requirements.permissions.filter((required) => !hasPermission(granted, required));
    if (missingPermissions.length > 0) {
      return { allowed: false, reason: 'Missing required permissions', details: { missingPermissions } };
    }
  }

  // Scopes — ALL required.
  if (requirements.scopes && requirements.scopes.length > 0) {
    const granted = authContext.scopes ?? [];
    const missingScopes = requirements.scopes.filter((scope) => !granted.includes(scope));
    if (missingScopes.length > 0) {
      return { allowed: false, reason: 'Missing required scopes', details: { missingScopes } };
    }
  }

  return { allowed: true };
}

/**
 * Extract Bearer token from Authorization header
 *
 * @param authHeader - The Authorization header value
 * @returns The extracted token, or null if invalid/missing
 *
 * @example
 * extractBearerToken('Bearer abc123') // returns 'abc123'
 * extractBearerToken('Basic xyz') // returns null
 * extractBearerToken(undefined) // returns null
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }

  // Parse Bearer token: "Bearer <token>"
  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0] === 'Bearer' && parts[1]) {
    return parts[1];
  }

  return null;
}
