/**
 * Navigation Section Types
 *
 * Type definitions for navigation section components.
 *
 * @module @omnitron-dev/prism/components/nav-section
 */

import type { ButtonBaseProps } from '@mui/material/ButtonBase';
import type { Theme, SxProps, CSSObject } from '@mui/material/styles';

// =============================================================================
// NAV ITEM TYPES
// =============================================================================

/**
 * Custom render props for nav items (icons, info badges).
 */
export type NavItemRenderProps = {
  /** Map of icon names to React nodes */
  navIcon?: Record<string, React.ReactNode>;
  /** Function to get info badges by key */
  navInfo?: (val: string) => Record<string, React.ReactElement>;
};

/**
 * State props for nav item.
 */
export type NavItemStateProps = {
  /** Whether the submenu is open */
  open?: boolean;
  /** Whether the item is active/selected */
  active?: boolean;
  /** Whether the item is disabled */
  disabled?: boolean;
};

/**
 * Slot styling props for nav items.
 */
export type NavItemSlotProps = {
  /** Root element sx */
  sx?: SxProps<Theme>;
  /** Icon sx */
  icon?: SxProps<Theme>;
  /** Text container sx */
  texts?: SxProps<Theme>;
  /** Title sx */
  title?: SxProps<Theme>;
  /** Caption sx */
  caption?: SxProps<Theme>;
  /** Info badge sx */
  info?: SxProps<Theme>;
  /** Arrow indicator sx */
  arrow?: SxProps<Theme>;
};

/**
 * Slot props for entire nav section.
 */
export type NavSlotProps = {
  /** Root item slot props */
  rootItem?: NavItemSlotProps;
  /** Sub item slot props */
  subItem?: NavItemSlotProps;
  /** Subheader sx */
  subheader?: SxProps<Theme>;
  /** Dropdown paper sx */
  dropdown?: {
    paper?: SxProps<Theme>;
  };
};

/**
 * Options props for nav items.
 */
export type NavItemOptionsProps = {
  /** Current depth level */
  depth?: number;
  /** Whether item has children */
  hasChild?: boolean;
  /** Whether link is external */
  externalLink?: boolean;
  /** Enable click on root items with children */
  enabledRootRedirect?: boolean;
  /** Custom render props */
  render?: NavItemRenderProps;
  /** Slot styling props */
  slotProps?: NavItemSlotProps;
};

/**
 * Data props for a single nav item.
 */
export type NavItemDataProps = Pick<NavItemStateProps, 'disabled'> & {
  /** Navigation path */
  path: string;
  /** Display title */
  title: string;
  /** Icon (string key or React node) */
  icon?: string | React.ReactNode;
  /** Info badge content */
  info?: string[] | React.ReactNode;
  /** Caption/description */
  caption?: string;
  /** Match nested routes as active */
  deepMatch?: boolean;
  /** Allowed roles for visibility */
  allowedRoles?: string | string[];
  /** Child navigation items */
  children?: NavItemDataProps[];
};

/**
 * Complete props for nav item component.
 */
export type NavItemProps = ButtonBaseProps & NavItemDataProps & NavItemStateProps & NavItemOptionsProps;

// =============================================================================
// NAV LIST TYPES
// =============================================================================

/**
 * Props for NavList component.
 */
export type NavListProps = Pick<NavItemProps, 'render' | 'depth' | 'enabledRootRedirect'> & {
  /** CSS custom properties */
  cssVars?: CSSObject;
  /** Nav item data */
  data: NavItemDataProps;
  /** Slot styling props */
  slotProps?: NavSlotProps;
  /** Permission check function */
  checkPermissions?: (allowedRoles?: NavItemProps['allowedRoles']) => boolean;
};

/**
 * Props for NavSubList component.
 */
export type NavSubListProps = Omit<NavListProps, 'data'> & {
  /** Array of nav item data */
  data: NavItemDataProps[];
};

/**
 * Props for NavGroup component.
 */
export type NavGroupProps = Omit<NavListProps, 'data' | 'depth'> & {
  /** Group subheader text */
  subheader?: string;
  /** Group items */
  items: NavItemDataProps[];
};

// =============================================================================
// NAV SECTION TYPES
// =============================================================================

/**
 * Data structure for nav section.
 */
export type NavSectionData = {
  /** Section subheader */
  subheader?: string;
  /** Section items */
  items: NavItemDataProps[];
};

/**
 * Props for NavSection component.
 */
export type NavSectionProps = React.ComponentProps<'nav'> &
  Omit<NavListProps, 'data' | 'depth'> & {
    /** Custom sx props */
    sx?: SxProps<Theme>;
    /** Navigation data */
    data: NavSectionData[];
  };

// =============================================================================
// NAV VARIANT TYPES
// =============================================================================

/**
 * Navigation layout variant.
 */
export type NavVariant = 'vertical' | 'horizontal' | 'mini';

/**
 * Common props shared by all nav variants.
 */
export type NavCommonProps = {
  /** Navigation variant */
  variant?: NavVariant;
  /** CSS custom properties */
  cssVars?: CSSObject;
  /** Custom sx props */
  sx?: SxProps<Theme>;
  /** Custom className */
  className?: string;
  /** Slot styling props */
  slotProps?: NavSlotProps;
  /** Custom render props */
  render?: NavItemRenderProps;
  /** Permission check function */
  checkPermissions?: (allowedRoles?: NavItemProps['allowedRoles']) => boolean;
  /** Enable click on root items with children */
  enabledRootRedirect?: boolean;
};
