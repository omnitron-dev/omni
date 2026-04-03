/**
 * Auth module exports
 */

export {
  AuthProvider,
  useAuth,
  useAuthRequired,
  useUser,
  useIsAuthenticated,
  type AuthProviderProps,
  type AuthContextValue,
  type AuthState,
  type User,
} from './context.js';

export {
  AuthGuard,
  RoleGuard,
  PermissionGuard,
  GuestGuard,
  Show,
  Hide,
  type AuthGuardProps,
  type RoleGuardProps,
  type PermissionGuardProps,
  type GuestGuardProps,
} from './guard.js';
