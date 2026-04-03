/**
 * Layout Type Definitions
 *
 * Combines the best patterns from minimal and aurora layout systems.
 *
 * @module @omnitron-dev/prism/layouts/types
 */

import type { ReactNode } from 'react';
import type { Breakpoint, SxProps, Theme } from '@mui/material';

// =============================================================================
// LAYOUT CONFIGURATION
// =============================================================================

/**
 * Navigation menu type - determines overall navigation strategy.
 */
export type NavigationMenuType = 'sidenav' | 'topnav' | 'combo';

/**
 * Sidenav variant - different sidebar styles.
 */
export type SidenavVariant = 'default' | 'mini' | 'stacked';

/**
 * Topnav variant - different top navigation styles.
 */
export type TopnavVariant = 'default' | 'slim' | 'stacked';

/**
 * Navigation color mode.
 */
export type NavColorMode = 'default' | 'vibrant' | 'integrate';

/**
 * Layout configuration options.
 */
export interface LayoutConfig {
  /** Navigation menu type */
  navigationMenuType: NavigationMenuType;
  /** Sidenav variant (when using sidenav or combo) */
  sidenavVariant: SidenavVariant;
  /** Whether sidenav is collapsed */
  sidenavCollapsed: boolean;
  /** Topnav variant (when using topnav or combo) */
  topnavVariant: TopnavVariant;
  /** Navigation color mode */
  navColor: NavColorMode;
  /** Whether mobile drawer is open */
  drawerOpen: boolean;
  /** Current drawer width in pixels */
  drawerWidth: number;
  /** Content compact mode (max-width container) */
  compactLayout: boolean;
}

// =============================================================================
// DRAWER WIDTH CONSTANTS
// =============================================================================

/**
 * Standard drawer width values.
 */
export const DRAWER_WIDTHS = {
  /** Full expanded width */
  full: 280,
  /** Collapsed/mini width (72 content + 1px border = header desktop height) */
  mini: 73,
  /** Mobile drawer width */
  mobile: 280,
  /** Stacked sidenav collapsed width (left panel only) */
  stackedCollapsed: 72,
  /** Stacked sidenav expanded width */
  stackedExpanded: 300,
} as const;

/**
 * Header height values by breakpoint.
 */
export const HEADER_HEIGHTS = {
  mobile: 64,
  desktop: 72,
} as const;

// =============================================================================
// NAVIGATION ITEM TYPES
// =============================================================================

/**
 * Layout navigation item definition.
 *
 * This is the data structure used for layout configuration.
 * For the NavItem component, see @omnitron-dev/prism/components/nav-section.
 */
export interface LayoutNavItem {
  /** Unique item ID */
  id: string;
  /** Display title */
  title: string;
  /** Navigation path (for leaf items) */
  path?: string;
  /** Icon component */
  icon?: ReactNode;
  /** Info badge/label */
  info?: ReactNode;
  /** Caption/description text */
  caption?: string;
  /** Disabled state */
  disabled?: boolean;
  /** External link flag */
  external?: boolean;
  /** Child items for nested menus */
  children?: LayoutNavItem[];
  /** Required roles for visibility */
  allowedRoles?: string[];
  /** Required permissions for visibility */
  allowedPermissions?: string[];
  /** Deep match for active state (match child paths) */
  deepMatch?: boolean;
  /** Badge for "new" or count indicators */
  badge?: string | number;
  /**
   * Selection prefix for active state matching.
   * If set, the item will be marked active when the current path
   * starts with this prefix. Useful for parent items that should
   * stay highlighted when on child routes.
   *
   * @example
   * ```tsx
   * // Parent item with selectionPrefix
   * { id: 'products', title: 'Products', path: '/products', selectionPrefix: '/products' }
   * // Will be active for /products, /products/123, /products/new, etc.
   * ```
   */
  selectionPrefix?: string;
}

/**
 * Layout navigation section (group of items with optional subheader).
 *
 * This is the data structure used for layout configuration.
 * For the NavSection component, see @omnitron-dev/prism/components/nav-section.
 */
export interface LayoutNavSection {
  /** Section ID */
  id: string;
  /** Section subheader text */
  subheader?: string;
  /** Items in this section */
  items: LayoutNavItem[];
}

/**
 * Layout navigation data structure.
 */
export type LayoutNavData = LayoutNavSection[];

// =============================================================================
// HEADER SECTION TYPES
// =============================================================================

/**
 * Header section slots for flexible composition.
 */
export interface HeaderSlots {
  /** Content above the main header row */
  topArea?: ReactNode;
  /** Left side content (logo, menu button) */
  leftArea?: ReactNode;
  /** Center content (navigation, search) */
  centerArea?: ReactNode;
  /** Right side content (actions, user menu) */
  rightArea?: ReactNode;
  /** Content below the main header row (horizontal nav) */
  bottomArea?: ReactNode;
}

/**
 * Header section props.
 */
export interface HeaderSectionProps {
  /** Slot content */
  slots?: HeaderSlots;
  /** Props for each slot */
  slotProps?: {
    topArea?: SxProps<Theme>;
    leftArea?: SxProps<Theme>;
    centerArea?: SxProps<Theme>;
    rightArea?: SxProps<Theme>;
    bottomArea?: SxProps<Theme>;
  };
  /** Disable sticky behavior */
  disableSticky?: boolean;
  /** Disable offset detection (blur on scroll) */
  disableOffset?: boolean;
  /** Custom CSS variables */
  cssVars?: Record<string, string | number>;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

// =============================================================================
// LAYOUT SECTION TYPES
// =============================================================================

/**
 * Main layout section props.
 */
export interface LayoutSectionProps {
  /** Header section */
  headerSection?: ReactNode;
  /** Sidebar section (sidenav) */
  sidebarSection?: ReactNode;
  /** Footer section */
  footerSection?: ReactNode;
  /** Main content */
  children?: ReactNode;
  /** Custom CSS variables */
  cssVars?: Record<string, string | number>;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

// =============================================================================
// DASHBOARD LAYOUT TYPES
// =============================================================================

/**
 * Dashboard layout props.
 */
export interface DashboardLayoutProps {
  /** Child content */
  children?: ReactNode;
  /** Layout breakpoint threshold */
  layoutQuery?: Breakpoint;
  /** Navigation data */
  navData?: LayoutNavData;
  /** Header slots */
  headerSlots?: HeaderSlots;
  /** Props for layout sections */
  slotProps?: {
    header?: Partial<HeaderSectionProps>;
    nav?: {
      data?: LayoutNavData;
    };
    main?: {
      sx?: SxProps<Theme>;
    };
  };
}

// =============================================================================
// AUTH LAYOUT TYPES
// =============================================================================

/**
 * Auth layout variant.
 */
export type AuthLayoutVariant = 'centered' | 'split' | 'simple';

/**
 * Auth layout props.
 */
export interface AuthLayoutProps {
  /** Child content */
  children?: ReactNode;
  /** Layout variant */
  variant?: AuthLayoutVariant;
  /** Title text (for split layout) */
  title?: string;
  /** Subtitle text (for split layout) */
  subtitle?: string;
  /** Illustration image (for split layout) */
  illustration?: ReactNode;
  /** Show logo in header */
  showLogo?: boolean;
  /** Show help link */
  showHelp?: boolean;
  /** Custom max width for content */
  maxWidth?: number | string;
}

// =============================================================================
// LAYOUT CONTEXT TYPES
// =============================================================================

/**
 * Layout context value.
 */
export interface LayoutContextValue {
  /** Current layout configuration */
  config: LayoutConfig;
  /** Whether the viewport is below the mobile breakpoint */
  isMobile: boolean;
  /** Update configuration */
  setConfig: (config: Partial<LayoutConfig>) => void;
  /** Toggle drawer open/close */
  toggleDrawer: () => void;
  /** Toggle sidenav collapse */
  toggleSidenavCollapse: () => void;
  /** Set navigation menu type */
  setNavigationMenuType: (type: NavigationMenuType) => void;
  /** Set sidenav variant */
  setSidenavVariant: (variant: SidenavVariant) => void;
  /** Set nav color mode */
  setNavColor: (mode: NavColorMode) => void;
  /** Open navigation items (for nested menus) */
  openItems: string[];
  /** Set open items */
  setOpenItems: (items: string[]) => void;
  /** Check if nested item is open */
  isItemOpen: (id: string) => boolean;
  /** Toggle item open state */
  toggleItem: (id: string) => void;
  /**
   * Check if any nested item is active based on current pathname.
   * Used to keep parent items highlighted when on child routes.
   *
   * @param items - Child items to check
   * @param pathname - Current pathname (typically from router)
   * @returns true if any nested item matches the current route
   */
  isNestedItemActive: (items: LayoutNavItem[] | undefined, pathname: string) => boolean;
  /**
   * Check if a single nav item is active based on pathname.
   * Supports exact match, deep match, and selectionPrefix matching.
   *
   * @param item - Nav item to check
   * @param pathname - Current pathname
   * @returns true if the item is active
   */
  isNavItemActive: (item: LayoutNavItem, pathname: string) => boolean;
}

// =============================================================================
// CSS VARIABLES
// =============================================================================

/**
 * CSS variable names for layout dimensions.
 */
export const LAYOUT_CSS_VARS = {
  // Header
  headerHeight: '--layout-header-height',
  headerMobileHeight: '--layout-header-mobile-height',
  headerDesktopHeight: '--layout-header-desktop-height',
  headerBlur: '--layout-header-blur',
  headerZIndex: '--layout-header-z-index',
  // Nav
  navWidth: '--layout-nav-width',
  navMiniWidth: '--layout-nav-mini-width',
  navMobileWidth: '--layout-nav-mobile-width',
  navZIndex: '--layout-nav-z-index',
  navBg: '--layout-nav-bg',
  navTextColor: '--layout-nav-text-color',
  navTextSecondaryColor: '--layout-nav-text-secondary-color',
  // Main
  mainPaddingTop: '--layout-main-padding-top',
  mainPaddingBottom: '--layout-main-padding-bottom',
  mainPaddingLeft: '--layout-main-padding-left',
  mainPaddingRight: '--layout-main-padding-right',
} as const;

/**
 * Default CSS variable values.
 */
export const DEFAULT_LAYOUT_CSS_VARS: Record<string, string | number> = {
  [LAYOUT_CSS_VARS.headerMobileHeight]: `${HEADER_HEIGHTS.mobile}px`,
  [LAYOUT_CSS_VARS.headerDesktopHeight]: `${HEADER_HEIGHTS.desktop}px`,
  [LAYOUT_CSS_VARS.headerBlur]: '8px',
  [LAYOUT_CSS_VARS.navWidth]: `${DRAWER_WIDTHS.full}px`,
  [LAYOUT_CSS_VARS.navMiniWidth]: `${DRAWER_WIDTHS.mini}px`,
  [LAYOUT_CSS_VARS.navMobileWidth]: `${DRAWER_WIDTHS.mobile}px`,
};
