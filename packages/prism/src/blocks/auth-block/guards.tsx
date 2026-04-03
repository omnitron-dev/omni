'use client';

/**
 * Route Guards
 *
 * Authentication and authorization guards for route protection.
 * Works with any router (React Router, Next.js, TanStack Router).
 *
 * @module @omnitron/prism/blocks/auth-block
 */

import { type ReactNode, useEffect, useState } from 'react';

// =============================================================================
// TYPES
// =============================================================================

/**
 * User role type - string or enum value.
 */
export type Role = string;

/**
 * Permission type - string identifier.
 */
export type Permission = string;

/**
 * User with roles and permissions for authorization.
 */
export interface AuthUser {
  /** User ID */
  id: string | number;
  /** User roles */
  roles?: Role[];
  /** User permissions (fine-grained) */
  permissions?: Permission[];
  /** Email verified status */
  emailVerified?: boolean;
  /** Any additional properties */
  [key: string]: unknown;
}

/**
 * Auth state for guards.
 */
export interface AuthState {
  /** Whether user is authenticated */
  isAuthenticated: boolean;
  /** Whether auth state is still loading */
  isLoading: boolean;
  /** Current user (if authenticated) */
  user?: AuthUser | null;
}

/**
 * Props for useAuth hook.
 * Guards need this to check auth state.
 */
export interface UseAuth {
  (): AuthState;
}

// =============================================================================
// AUTH GUARD
// =============================================================================

/**
 * AuthGuard props.
 */
export interface AuthGuardProps {
  /** Children to render when authorized */
  children: ReactNode;
  /** Hook to get auth state */
  useAuth: UseAuth;
  /** Component to show while loading */
  loadingComponent?: ReactNode;
  /** Called when not authenticated (e.g., redirect to login) */
  onUnauthenticated?: () => void;
  /** Component to show when not authenticated (if no redirect) */
  unauthenticatedComponent?: ReactNode;
}

/**
 * Guard that requires authentication.
 *
 * @example
 * ```tsx
 * import { AuthGuard } from '@omnitron/prism/blocks';
 * import { useAuth } from '../hooks/use-auth';
 *
 * function ProtectedPage() {
 *   return (
 *     <AuthGuard
 *       useAuth={useAuth}
 *       onUnauthenticated={() => navigate('/login')}
 *       loadingComponent={<LoadingScreen />}
 *     >
 *       <DashboardContent />
 *     </AuthGuard>
 *   );
 * }
 * ```
 */
export function AuthGuard({
  children,
  useAuth,
  loadingComponent = null,
  onUnauthenticated,
  unauthenticatedComponent = null,
}: AuthGuardProps): ReactNode {
  const { isAuthenticated, isLoading } = useAuth();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      if (!isAuthenticated) {
        onUnauthenticated?.();
      }
      setChecked(true);
    }
  }, [isAuthenticated, isLoading, onUnauthenticated]);

  if (isLoading || !checked) {
    return loadingComponent;
  }

  if (!isAuthenticated) {
    return unauthenticatedComponent;
  }

  return children;
}

// =============================================================================
// GUEST GUARD
// =============================================================================

/**
 * GuestGuard props.
 */
export interface GuestGuardProps {
  /** Children to render when not authenticated */
  children: ReactNode;
  /** Hook to get auth state */
  useAuth: UseAuth;
  /** Component to show while loading */
  loadingComponent?: ReactNode;
  /** Called when authenticated (e.g., redirect to dashboard) */
  onAuthenticated?: () => void;
  /** Component to show when authenticated (if no redirect) */
  authenticatedComponent?: ReactNode;
}

/**
 * Guard that requires NO authentication.
 * Use for login, register, forgot password pages.
 *
 * @example
 * ```tsx
 * import { GuestGuard } from '@omnitron/prism/blocks';
 * import { useAuth } from '../hooks/use-auth';
 *
 * function LoginPage() {
 *   return (
 *     <GuestGuard
 *       useAuth={useAuth}
 *       onAuthenticated={() => navigate('/dashboard')}
 *       loadingComponent={<LoadingScreen />}
 *     >
 *       <LoginForm />
 *     </GuestGuard>
 *   );
 * }
 * ```
 */
export function GuestGuard({
  children,
  useAuth,
  loadingComponent = null,
  onAuthenticated,
  authenticatedComponent = null,
}: GuestGuardProps): ReactNode {
  const { isAuthenticated, isLoading } = useAuth();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      if (isAuthenticated) {
        onAuthenticated?.();
      }
      setChecked(true);
    }
  }, [isAuthenticated, isLoading, onAuthenticated]);

  if (isLoading || !checked) {
    return loadingComponent;
  }

  if (isAuthenticated) {
    return authenticatedComponent;
  }

  return children;
}

// =============================================================================
// ROLE-BASED GUARD
// =============================================================================

/**
 * RoleBasedGuard props.
 */
export interface RoleBasedGuardProps {
  /** Children to render when authorized */
  children: ReactNode;
  /** Hook to get auth state */
  useAuth: UseAuth;
  /** Required roles (user must have at least one) */
  roles?: Role[];
  /** Required permissions (user must have ALL) */
  permissions?: Permission[];
  /** Require email verification */
  requireEmailVerified?: boolean;
  /** Match strategy for roles: 'any' (default) or 'all' */
  roleMatchStrategy?: 'any' | 'all';
  /** Component to show while loading */
  loadingComponent?: ReactNode;
  /** Called when access denied */
  onAccessDenied?: (reason: AccessDeniedReason) => void;
  /** Component to show when access denied */
  accessDeniedComponent?: ReactNode;
}

/**
 * Reason for access denial.
 */
export type AccessDeniedReason = 'not_authenticated' | 'missing_role' | 'missing_permission' | 'email_not_verified';

/**
 * Guard for role/permission-based access control.
 *
 * @example
 * ```tsx
 * import { RoleBasedGuard } from '@omnitron/prism/blocks';
 * import { useAuth } from '../hooks/use-auth';
 *
 * // Require admin role
 * function AdminPage() {
 *   return (
 *     <RoleBasedGuard
 *       useAuth={useAuth}
 *       roles={['admin']}
 *       onAccessDenied={() => navigate('/403')}
 *     >
 *       <AdminPanel />
 *     </RoleBasedGuard>
 *   );
 * }
 *
 * // Require specific permission
 * function EditUserPage() {
 *   return (
 *     <RoleBasedGuard
 *       useAuth={useAuth}
 *       permissions={['users:write']}
 *       accessDeniedComponent={<AccessDenied />}
 *     >
 *       <UserEditForm />
 *     </RoleBasedGuard>
 *   );
 * }
 *
 * // Require admin OR moderator role
 * function ModeratePage() {
 *   return (
 *     <RoleBasedGuard
 *       useAuth={useAuth}
 *       roles={['admin', 'moderator']}
 *       roleMatchStrategy="any"
 *     >
 *       <ModerateContent />
 *     </RoleBasedGuard>
 *   );
 * }
 *
 * // Require email verified
 * function VerifiedOnlyPage() {
 *   return (
 *     <RoleBasedGuard
 *       useAuth={useAuth}
 *       requireEmailVerified
 *       onAccessDenied={(reason) => {
 *         if (reason === 'email_not_verified') {
 *           navigate('/verify-email');
 *         }
 *       }}
 *     >
 *       <VerifiedContent />
 *     </RoleBasedGuard>
 *   );
 * }
 * ```
 */
export function RoleBasedGuard({
  children,
  useAuth,
  roles = [],
  permissions = [],
  requireEmailVerified = false,
  roleMatchStrategy = 'any',
  loadingComponent = null,
  onAccessDenied,
  accessDeniedComponent = null,
}: RoleBasedGuardProps): ReactNode {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [checked, setChecked] = useState(false);
  const [accessGranted, setAccessGranted] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      // Check authentication
      if (!isAuthenticated || !user) {
        onAccessDenied?.('not_authenticated');
        setAccessGranted(false);
        setChecked(true);
        return;
      }

      // Check email verification
      if (requireEmailVerified && !user.emailVerified) {
        onAccessDenied?.('email_not_verified');
        setAccessGranted(false);
        setChecked(true);
        return;
      }

      // Check roles
      if (roles.length > 0) {
        const userRoles = user.roles ?? [];
        const hasRequiredRole =
          roleMatchStrategy === 'all'
            ? roles.every((role) => userRoles.includes(role))
            : roles.some((role) => userRoles.includes(role));

        if (!hasRequiredRole) {
          onAccessDenied?.('missing_role');
          setAccessGranted(false);
          setChecked(true);
          return;
        }
      }

      // Check permissions (always ALL)
      if (permissions.length > 0) {
        const userPermissions = user.permissions ?? [];
        const hasAllPermissions = permissions.every((perm) => userPermissions.includes(perm));

        if (!hasAllPermissions) {
          onAccessDenied?.('missing_permission');
          setAccessGranted(false);
          setChecked(true);
          return;
        }
      }

      // Access granted
      setAccessGranted(true);
      setChecked(true);
    }
  }, [isAuthenticated, isLoading, user, roles, permissions, requireEmailVerified, roleMatchStrategy, onAccessDenied]);

  if (isLoading || !checked) {
    return loadingComponent;
  }

  if (!accessGranted) {
    return accessDeniedComponent;
  }

  return children;
}

// =============================================================================
// UTILITY HOOKS
// =============================================================================

/**
 * Check if user has specific role(s).
 *
 * @example
 * ```tsx
 * const isAdmin = hasRole(user, 'admin');
 * const isModerator = hasRole(user, ['admin', 'moderator'], 'any');
 * const isSuperAdmin = hasRole(user, ['admin', 'superuser'], 'all');
 * ```
 */
export function hasRole(
  user: AuthUser | null | undefined,
  role: Role | Role[],
  strategy: 'any' | 'all' = 'any'
): boolean {
  if (!user?.roles?.length) return false;

  const roles = Array.isArray(role) ? role : [role];

  return strategy === 'all' ? roles.every((r) => user.roles!.includes(r)) : roles.some((r) => user.roles!.includes(r));
}

/**
 * Check if user has specific permission(s).
 *
 * @example
 * ```tsx
 * const canEdit = hasPermission(user, 'users:write');
 * const canManage = hasPermission(user, ['users:read', 'users:write'], 'all');
 * ```
 */
export function hasPermission(
  user: AuthUser | null | undefined,
  permission: Permission | Permission[],
  strategy: 'any' | 'all' = 'all'
): boolean {
  if (!user?.permissions?.length) return false;

  const permissions = Array.isArray(permission) ? permission : [permission];

  return strategy === 'all'
    ? permissions.every((p) => user.permissions!.includes(p))
    : permissions.some((p) => user.permissions!.includes(p));
}

/**
 * Create a conditional render helper based on roles/permissions.
 *
 * @example
 * ```tsx
 * const { canRender } = useConditionalRender(user);
 *
 * return (
 *   <div>
 *     {canRender({ roles: ['admin'] }) && <AdminPanel />}
 *     {canRender({ permissions: ['users:write'] }) && <EditButton />}
 *   </div>
 * );
 * ```
 */
export function createConditionalRender(user: AuthUser | null | undefined) {
  return {
    canRender: (options: {
      roles?: Role[];
      permissions?: Permission[];
      roleMatchStrategy?: 'any' | 'all';
    }): boolean => {
      const { roles = [], permissions = [], roleMatchStrategy = 'any' } = options;

      if (roles.length > 0 && !hasRole(user, roles, roleMatchStrategy)) {
        return false;
      }

      if (permissions.length > 0 && !hasPermission(user, permissions, 'all')) {
        return false;
      }

      return true;
    },
  };
}
