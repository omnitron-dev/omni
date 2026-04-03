/**
 * Prism Blocks Module
 *
 * Pre-built UI blocks combining multiple components for common patterns.
 *
 * @module @omnitron-dev/prism/blocks
 */

// Dashboard Block
export {
  DashboardBlock,
  DashboardBlockHeader,
  DashboardBlockContent,
  DashboardBlockFooter,
  useDashboardBlockContext,
  useDashboardBlock,
} from './dashboard-block/index.js';

export type {
  DashboardBlockProps,
  DashboardBlockVariant,
  DashboardBlockSize,
  DashboardBlockHeaderProps,
  DashboardBlockContentProps,
  DashboardBlockFooterProps,
  DashboardBlockContextValue,
  LoadingConfig,
  ErrorConfig,
  UseDashboardBlockReturn,
  UseDashboardBlockOptions,
  DashboardBlockState,
  DashboardBlockActions,
} from './dashboard-block/index.js';

// Auth Block
export {
  AuthBlock,
  LoginForm,
  RegisterForm,
  ForgotPasswordForm,
  ResetPasswordForm,
  VerifyCodeForm,
  // Route Guards
  AuthGuard,
  GuestGuard,
  RoleBasedGuard,
  hasRole,
  hasPermission,
  createConditionalRender,
} from './auth-block/index.js';

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
  // Guard types
  Role,
  Permission,
  AuthUser,
  AuthState,
  UseAuth,
  AuthGuardProps,
  GuestGuardProps,
  RoleBasedGuardProps,
  AccessDeniedReason,
} from './auth-block/index.js';

// DataGrid Block
export { DataGridBlock, useDataGridBlock, useDataGridBlockContext } from './data-grid-block/index.js';

export type {
  DataGridBlockProps,
  DataGridBlockContextValue,
  DataGridRowAction,
  DataGridToolbarConfig,
  DataGridPaginationConfig,
  DataGridSelectionConfig,
  DataGridEmptyConfig,
  QuickFilterConfig,
  ExportConfig,
  ColumnVisibilityConfig,
  UseDataGridBlockOptions,
  UseDataGridBlockReturn,
  DataGridFetchParams,
  DataGridFetchResult,
} from './data-grid-block/index.js';
