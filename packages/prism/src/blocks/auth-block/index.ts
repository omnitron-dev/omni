/**
 * Auth Block
 *
 * Authentication-related form components: login, register, forgot password, etc.
 * Also includes route guards for authentication and authorization.
 *
 * @module @omnitron-dev/prism/blocks/auth-block
 */

export {
  AuthBlock,
  LoginForm,
  RegisterForm,
  ForgotPasswordForm,
  ResetPasswordForm,
  VerifyCodeForm,
} from './auth-block.js';

export type {
  LoginFormProps,
  LoginFormData,
  RegisterFormProps,
  RegisterFormData,
  ForgotPasswordFormProps,
  ForgotPasswordFormData,
  ResetPasswordFormProps,
  ResetPasswordFormData,
  VerifyCodeFormProps,
  VerifyCodeFormData,
  AuthBlockVariant,
} from './types.js';

// Route Guards
export { AuthGuard, GuestGuard, RoleBasedGuard, hasRole, hasPermission, createConditionalRender } from './guards.js';

export type {
  Role,
  Permission,
  AuthUser,
  AuthState,
  UseAuth,
  AuthGuardProps,
  GuestGuardProps,
  RoleBasedGuardProps,
  AccessDeniedReason,
} from './guards.js';
