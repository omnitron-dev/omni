/** Router-independent access guards without forms, charts or layout dependencies. */
export {
  AuthGuard,
  GuestGuard,
  RoleBasedGuard,
  hasRole,
  hasPermission,
  createConditionalRender,
} from '../blocks/auth-block/guards.js';
export type {
  AuthUser,
  AuthState,
  UseAuth,
  AuthGuardProps,
  GuestGuardProps,
  RoleBasedGuardProps,
  AccessDeniedReason,
  Role,
  Permission,
} from '../blocks/auth-block/guards.js';
