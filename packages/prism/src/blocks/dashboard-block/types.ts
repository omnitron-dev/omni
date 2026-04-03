/**
 * Dashboard Block Types
 *
 * Type definitions for the dashboard block component.
 *
 * @module @omnitron-dev/prism/blocks/dashboard-block/types
 */

import type { ReactNode } from 'react';
import type { SxProps, Theme } from '@mui/material';

/**
 * Dashboard block variant types.
 */
export type DashboardBlockVariant = 'default' | 'outlined' | 'filled';

/**
 * Dashboard block size presets.
 */
export type DashboardBlockSize = 'small' | 'medium' | 'large';

/**
 * Loading state configuration.
 */
export interface LoadingConfig {
  /** Show skeleton loading */
  skeleton?: boolean;
  /** Number of skeleton rows */
  skeletonRows?: number;
  /** Custom loading component */
  loadingComponent?: ReactNode;
}

/**
 * Error state configuration.
 */
export interface ErrorConfig {
  /** Error message */
  message?: string;
  /** Retry callback */
  onRetry?: () => void;
  /** Custom error component */
  errorComponent?: ReactNode;
}

/**
 * Dashboard block header props.
 */
export interface DashboardBlockHeaderProps {
  /** Block title */
  title: string;
  /** Optional subtitle */
  subtitle?: string;
  /** Icon element */
  icon?: ReactNode;
  /** Actions slot (buttons, menu, etc.) */
  actions?: ReactNode;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

/**
 * Dashboard block content props.
 */
export interface DashboardBlockContentProps {
  /** Content children */
  children?: ReactNode;
  /** Disable default padding */
  disablePadding?: boolean;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

/**
 * Dashboard block footer props.
 */
export interface DashboardBlockFooterProps {
  /** Footer content */
  children?: ReactNode;
  /** Show divider above footer */
  divider?: boolean;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

/**
 * Dashboard block props.
 */
export interface DashboardBlockProps {
  /** Block title */
  title?: string;
  /** Optional subtitle */
  subtitle?: string;
  /** Icon element */
  icon?: ReactNode;
  /** Actions slot */
  actions?: ReactNode;
  /** Content children */
  children?: ReactNode;
  /** Footer content */
  footer?: ReactNode;
  /** Block variant */
  variant?: DashboardBlockVariant;
  /** Block size */
  size?: DashboardBlockSize;
  /** Loading state */
  loading?: boolean;
  /** Loading configuration */
  loadingConfig?: LoadingConfig;
  /** Error state */
  error?: boolean;
  /** Error configuration */
  errorConfig?: ErrorConfig;
  /** Collapsible block */
  collapsible?: boolean;
  /** Initial collapsed state */
  defaultCollapsed?: boolean;
  /** Controlled collapsed state */
  collapsed?: boolean;
  /** Collapse change handler */
  onCollapseChange?: (collapsed: boolean) => void;
  /** Disable default content padding */
  disablePadding?: boolean;
  /** Show footer divider */
  footerDivider?: boolean;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
  /** Header slot props */
  slotProps?: {
    header?: Partial<DashboardBlockHeaderProps>;
    content?: Partial<DashboardBlockContentProps>;
    footer?: Partial<DashboardBlockFooterProps>;
  };
}

/**
 * Dashboard block context value.
 */
export interface DashboardBlockContextValue {
  /** Current collapsed state */
  collapsed: boolean;
  /** Toggle collapse */
  toggleCollapse: () => void;
  /** Set collapsed state */
  setCollapsed: (collapsed: boolean) => void;
  /** Current loading state */
  loading: boolean;
  /** Current error state */
  error: boolean;
  /** Block variant */
  variant: DashboardBlockVariant;
  /** Block size */
  size: DashboardBlockSize;
}
