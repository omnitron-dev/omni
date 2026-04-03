/**
 * Block Type Definitions
 *
 * @module @omnitron-dev/prism/types/blocks
 */

import type { ReactNode } from 'react';

/**
 * Block categories.
 */
export type BlockCategory =
  | 'layouts'
  | 'auth'
  | 'data'
  | 'forms'
  | 'communication'
  | 'productivity'
  | 'marketing'
  | 'settings';

/**
 * Block file type.
 */
export type BlockFileType = 'component' | 'hook' | 'type' | 'schema' | 'util' | 'barrel' | 'style' | 'test';

/**
 * Block file definition.
 */
export interface BlockFile {
  /** File path relative to block root */
  path: string;
  /** File type */
  type: BlockFileType;
  /** Optional description */
  description?: string;
}

/**
 * Block dependencies.
 */
export interface BlockDependencies {
  /** npm package dependencies */
  npm: string[];
  /** Other Prism blocks */
  blocks: string[];
  /** Prism components */
  components: string[];
}

/**
 * Block configuration.
 */
export interface BlockConfig {
  /** Block-specific configuration options */
  [key: string]: unknown;
}

/**
 * Block definition.
 */
export interface BlockDefinition {
  /** Block name */
  name: string;
  /** Block version */
  version: string;
  /** Block category */
  category: BlockCategory;
  /** Display name */
  displayName: string;
  /** Description */
  description: string;
  /** Block files */
  files: BlockFile[];
  /** Dependencies */
  dependencies: BlockDependencies;
  /** Default configuration */
  defaultConfig: BlockConfig;
  /** Preview image URL */
  preview?: string;
  /** Documentation URL */
  docs?: string;
}

// ============================================================================
// Dashboard Block Types
// ============================================================================

/**
 * Dashboard navigation type.
 */
export type DashboardNavType = 'sidebar' | 'topbar' | 'combo';

/**
 * Sidebar navigation variant.
 */
export type SidebarNavVariant = 'default' | 'slim' | 'stacked';

/**
 * Topbar navigation variant.
 */
export type TopbarNavVariant = 'default' | 'slim' | 'stacked';

/**
 * Block navigation item definition.
 * @deprecated Use NavItem from layouts/types instead for layout components.
 */
export interface BlockNavItem {
  /** Item ID */
  id: string;
  /** Display title */
  title: string;
  /** Navigation path */
  path?: string;
  /** Icon component or name */
  icon?: ReactNode | string;
  /** Disabled state */
  disabled?: boolean;
  /** Badge content */
  badge?: string | number;
  /** Children items */
  children?: BlockNavItem[];
  /** External link */
  external?: boolean;
  /** Required roles */
  roles?: string[];
  /** Required permissions */
  permissions?: string[];
}

/**
 * Block navigation section definition.
 * @deprecated Use NavSection from layouts/types instead for layout components.
 */
export interface BlockNavSection {
  /** Section ID */
  id: string;
  /** Section title */
  title?: string;
  /** Section items */
  items: BlockNavItem[];
}

/**
 * Dashboard block layout props.
 * @deprecated Use DashboardLayoutProps from layouts/types instead for layout components.
 */
export interface DashboardBlockProps {
  /** Navigation type */
  navType?: DashboardNavType;
  /** Sidebar variant (when navType is 'sidebar' or 'combo') */
  sidebarVariant?: SidebarNavVariant;
  /** Topbar variant (when navType is 'topbar' or 'combo') */
  topbarVariant?: TopbarNavVariant;
  /** Navigation sections */
  navigation?: BlockNavSection[];
  /** Logo component */
  logo?: ReactNode;
  /** User menu component */
  userMenu?: ReactNode;
  /** Notification center component */
  notifications?: ReactNode;
  /** Settings panel component */
  settingsPanel?: ReactNode;
  /** Footer component */
  footer?: ReactNode;
  /** Children content */
  children?: ReactNode;
}

// ============================================================================
// Auth Block Types
// ============================================================================

/**
 * Authentication provider type.
 */
export type AuthProviderType = 'jwt' | 'firebase' | 'supabase' | 'auth0' | 'amplify';

/**
 * Auth state.
 */
export interface AuthState {
  /** Whether user is authenticated */
  isAuthenticated: boolean;
  /** Whether auth is loading */
  isLoading: boolean;
  /** Current user */
  user: AuthUser | null;
  /** Auth error */
  error: Error | null;
}

/**
 * Authenticated user.
 */
export interface AuthUser {
  /** User ID */
  id: string;
  /** Email */
  email: string;
  /** Display name */
  displayName?: string;
  /** Avatar URL */
  avatarUrl?: string;
  /** User roles */
  roles: string[];
  /** User permissions */
  permissions: string[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Auth context value.
 */
export interface AuthContextValue extends AuthState {
  /** Sign in with email/password */
  signIn: (email: string, password: string) => Promise<void>;
  /** Sign up with email/password */
  signUp: (email: string, password: string, data?: Record<string, unknown>) => Promise<void>;
  /** Sign out */
  signOut: () => Promise<void>;
  /** Reset password */
  resetPassword: (email: string) => Promise<void>;
  /** Update password */
  updatePassword: (newPassword: string) => Promise<void>;
  /** Update profile */
  updateProfile: (data: Partial<AuthUser>) => Promise<void>;
  /** Verify email */
  verifyEmail: (token: string) => Promise<void>;
  /** Check if user has role */
  hasRole: (role: string) => boolean;
  /** Check if user has permission */
  hasPermission: (permission: string) => boolean;
}

// ============================================================================
// DataGrid Block Types
// ============================================================================

/**
 * Column definition for DataGrid.
 */
export interface GridColumn<T = unknown> {
  /** Column ID/key */
  field: string;
  /** Header title */
  headerName: string;
  /** Column width */
  width?: number;
  /** Min width */
  minWidth?: number;
  /** Max width */
  maxWidth?: number;
  /** Flex grow */
  flex?: number;
  /** Sortable */
  sortable?: boolean;
  /** Filterable */
  filterable?: boolean;
  /** Editable */
  editable?: boolean;
  /** Hideable */
  hideable?: boolean;
  /** Cell renderer */
  renderCell?: (params: GridCellParams<T>) => ReactNode;
  /** Header renderer */
  renderHeader?: (params: GridHeaderParams) => ReactNode;
  /** Value formatter */
  valueFormatter?: (value: unknown) => string;
  /** Value getter */
  valueGetter?: (row: T) => unknown;
  /** Column type */
  type?: 'string' | 'number' | 'date' | 'dateTime' | 'boolean' | 'actions';
  /** Alignment */
  align?: 'left' | 'center' | 'right';
  /** Header alignment */
  headerAlign?: 'left' | 'center' | 'right';
}

/**
 * Cell render params.
 */
export interface GridCellParams<T = unknown> {
  /** Row data */
  row: T;
  /** Cell value */
  value: unknown;
  /** Column field */
  field: string;
  /** Row ID */
  id: string | number;
  /** Is cell focused */
  hasFocus: boolean;
  /** Tab index */
  tabIndex: number;
}

/**
 * Header render params.
 */
export interface GridHeaderParams {
  /** Column field */
  field: string;
  /** Column definition */
  colDef: GridColumn;
}

/**
 * Grid filter model.
 */
export interface GridFilterModel {
  items: GridFilterItem[];
  quickFilterValues?: string[];
}

/**
 * Grid filter item.
 */
export interface GridFilterItem {
  field: string;
  operator: string;
  value?: unknown;
}

/**
 * Grid sort model.
 */
export interface GridSortModel {
  field: string;
  sort: 'asc' | 'desc' | null;
}

/**
 * DataGrid props.
 */
export interface DataGridProps<T = unknown> {
  /** Row data */
  rows: T[];
  /** Column definitions */
  columns: GridColumn<T>[];
  /** Loading state */
  loading?: boolean;
  /** Row ID getter */
  getRowId?: (row: T) => string | number;
  /** Selection model */
  rowSelectionModel?: (string | number)[];
  /** On selection change */
  onRowSelectionModelChange?: (selection: (string | number)[]) => void;
  /** Checkbox selection */
  checkboxSelection?: boolean;
  /** Disable row selection on click */
  disableRowSelectionOnClick?: boolean;
  /** Page size options */
  pageSizeOptions?: number[];
  /** Initial page size */
  initialPageSize?: number;
  /** Sort model */
  sortModel?: GridSortModel[];
  /** On sort change */
  onSortModelChange?: (model: GridSortModel[]) => void;
  /** Filter model */
  filterModel?: GridFilterModel;
  /** On filter change */
  onFilterModelChange?: (model: GridFilterModel) => void;
  /** Density */
  density?: 'compact' | 'standard' | 'comfortable';
  /** Auto height */
  autoHeight?: boolean;
  /** Enable export */
  enableExport?: boolean;
  /** Enable column visibility */
  enableColumnVisibility?: boolean;
  /** Toolbar component */
  toolbar?: ReactNode;
  /** Empty state component */
  emptyContent?: ReactNode;
}

// ============================================================================
// Forms Block Types
// ============================================================================

/**
 * Form field type.
 */
export type FormFieldType =
  | 'text'
  | 'email'
  | 'password'
  | 'number'
  | 'tel'
  | 'url'
  | 'textarea'
  | 'select'
  | 'multiselect'
  | 'autocomplete'
  | 'checkbox'
  | 'switch'
  | 'radio'
  | 'date'
  | 'time'
  | 'datetime'
  | 'daterange'
  | 'file'
  | 'upload'
  | 'editor'
  | 'code'
  | 'rating'
  | 'slider'
  | 'color';

/**
 * Form field schema.
 */
export interface FormFieldSchema {
  /** Field name */
  name: string;
  /** Field type */
  type: FormFieldType;
  /** Field label */
  label?: string;
  /** Placeholder */
  placeholder?: string;
  /** Helper text */
  helperText?: string;
  /** Required */
  required?: boolean;
  /** Disabled */
  disabled?: boolean;
  /** Default value */
  defaultValue?: unknown;
  /** Options (for select, radio, etc.) */
  options?: Array<{ value: string | number; label: string }>;
  /** Validation rules */
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    custom?: (value: unknown) => string | true;
  };
  /** Conditional visibility */
  visible?: (formValues: Record<string, unknown>) => boolean;
  /** Grid column span */
  colSpan?: number;
}

/**
 * Form section schema.
 */
export interface FormSectionSchema {
  /** Section ID */
  id: string;
  /** Section title */
  title?: string;
  /** Section description */
  description?: string;
  /** Section fields */
  fields: FormFieldSchema[];
  /** Collapsible */
  collapsible?: boolean;
  /** Default collapsed */
  defaultCollapsed?: boolean;
}

/**
 * Form schema.
 */
export interface FormSchema {
  /** Form sections */
  sections: FormSectionSchema[];
  /** Submit button label */
  submitLabel?: string;
  /** Cancel button label */
  cancelLabel?: string;
  /** Show cancel button */
  showCancel?: boolean;
  /** Form layout */
  layout?: 'vertical' | 'horizontal' | 'inline';
  /** Columns */
  columns?: number;
}
