/**
 * Authentication Guard Components
 */

import { type ReactNode } from 'react';
import { useAuth, type AuthContextValue } from './context.js';

// ============================================================================
// AuthGuard
// ============================================================================

/**
 * AuthGuard props
 */
export interface AuthGuardProps {
  /** Content to render when authorized */
  children: ReactNode;
  /** Fallback when not authorized */
  fallback?: ReactNode;
  /** Redirect path (if using router) */
  redirectTo?: string;
  /** Required roles (any match) */
  roles?: string[];
  /** Required roles (all match) */
  allRoles?: string[];
  /** Required permissions (any match) */
  permissions?: string[];
  /** Required permissions (all match) */
  allPermissions?: string[];
  /** Loading state */
  loading?: ReactNode;
  /** Custom authorization check */
  authorize?: (auth: AuthContextValue) => boolean;
}

/**
 * AuthGuard component
 *
 * Renders children only when user is authenticated and authorized.
 *
 * @example
 * ```tsx
 * <AuthGuard roles={['admin', 'moderator']} fallback={<Unauthorized />}>
 *   <AdminDashboard />
 * </AuthGuard>
 * ```
 */
export function AuthGuard({
  children,
  fallback = null,
  redirectTo,
  roles,
  allRoles,
  permissions,
  allPermissions,
  loading,
  authorize,
}: AuthGuardProps): React.JSX.Element {
  const auth = useAuth();

  // Show loading if auth is loading
  if (auth.isLoading && loading) {
    return <>{loading}</>;
  }

  // Check authentication
  if (!auth.isAuthenticated) {
    if (redirectTo && typeof window !== 'undefined') {
      window.location.href = redirectTo;
      return <>{loading ?? fallback}</>;
    }
    return <>{fallback}</>;
  }

  // Check custom authorization
  if (authorize && !authorize(auth)) {
    return <>{fallback}</>;
  }

  // Check roles (any match)
  if (roles && roles.length > 0 && !auth.hasAnyRole(roles)) {
    return <>{fallback}</>;
  }

  // Check all roles (all must match)
  if (allRoles && allRoles.length > 0 && !auth.hasAllRoles(allRoles)) {
    return <>{fallback}</>;
  }

  // Check permissions (any match)
  if (permissions && permissions.length > 0) {
    const hasAnyPermission = permissions.some((p) => auth.hasPermission(p));
    if (!hasAnyPermission) {
      return <>{fallback}</>;
    }
  }

  // Check all permissions (all must match)
  if (allPermissions && allPermissions.length > 0) {
    const hasAllPermissions = allPermissions.every((p) => auth.hasPermission(p));
    if (!hasAllPermissions) {
      return <>{fallback}</>;
    }
  }

  return <>{children}</>;
}

// ============================================================================
// RoleGuard
// ============================================================================

/**
 * RoleGuard props
 */
export interface RoleGuardProps {
  /** Required role */
  role: string;
  /** Content when authorized */
  children: ReactNode;
  /** Fallback when not authorized */
  fallback?: ReactNode;
}

/**
 * RoleGuard - Simplified guard for single role check
 */
export function RoleGuard({ role, children, fallback = null }: RoleGuardProps): React.JSX.Element {
  const { hasRole, isAuthenticated } = useAuth();

  if (!isAuthenticated || !hasRole(role)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

// ============================================================================
// PermissionGuard
// ============================================================================

/**
 * PermissionGuard props
 */
export interface PermissionGuardProps {
  /** Required permission */
  permission: string;
  /** Content when authorized */
  children: ReactNode;
  /** Fallback when not authorized */
  fallback?: ReactNode;
}

/**
 * PermissionGuard - Simplified guard for single permission check
 */
export function PermissionGuard({ permission, children, fallback = null }: PermissionGuardProps): React.JSX.Element {
  const { hasPermission, isAuthenticated } = useAuth();

  if (!isAuthenticated || !hasPermission(permission)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

// ============================================================================
// GuestGuard
// ============================================================================

/**
 * GuestGuard props
 */
export interface GuestGuardProps {
  /** Content for guests */
  children: ReactNode;
  /** Fallback for authenticated users */
  fallback?: ReactNode;
  /** Redirect path for authenticated users */
  redirectTo?: string;
}

/**
 * GuestGuard - Only renders for non-authenticated users
 */
export function GuestGuard({ children, fallback = null, redirectTo }: GuestGuardProps): React.JSX.Element {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <>{fallback}</>;
  }

  if (isAuthenticated) {
    if (redirectTo && typeof window !== 'undefined') {
      window.location.href = redirectTo;
    }
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

// ============================================================================
// Conditional Rendering Helpers
// ============================================================================

/**
 * Show - Conditionally show content based on auth
 */
export function Show({
  when,
  children,
  fallback,
}: {
  when: (auth: AuthContextValue) => boolean;
  children: ReactNode;
  fallback?: ReactNode;
}): React.JSX.Element {
  const auth = useAuth();

  if (!when(auth)) {
    return <>{fallback ?? null}</>;
  }

  return <>{children}</>;
}

/**
 * Hide - Conditionally hide content based on auth
 */
export function Hide({
  when,
  children,
}: {
  when: (auth: AuthContextValue) => boolean;
  children: ReactNode;
}): React.JSX.Element {
  const auth = useAuth();

  if (when(auth)) {
    return null as unknown as React.JSX.Element;
  }

  return <>{children}</>;
}
