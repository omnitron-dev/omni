/**
 * Prism Layout System
 *
 * Comprehensive layout components for building application structures.
 * Combines the best patterns from minimal and aurora layout systems.
 *
 * @module @omnitron-dev/prism/layouts
 */

// =============================================================================
// TYPES
// =============================================================================

export type {
  NavigationMenuType,
  SidenavVariant,
  TopnavVariant,
  NavColorMode,
  LayoutNavItem,
  LayoutNavSection,
  LayoutNavData,
  HeaderSlots,
  LayoutConfig,
  LayoutContextValue,
  AuthLayoutVariant,
  AuthLayoutProps,
} from './types.js';

export { DRAWER_WIDTHS, HEADER_HEIGHTS, LAYOUT_CSS_VARS, DEFAULT_LAYOUT_CSS_VARS } from './types.js';

// =============================================================================
// CORE
// =============================================================================

export {
  LayoutContext,
  LayoutProvider,
  defaultLayoutConfig,
  useLayoutContext,
  useLayoutConfig,
  useSidenavVisible,
  useTopnavVisible,
  useNavActive,
} from './core/index.js';
export type { LayoutProviderProps } from './core/index.js';

export { getBaseLayoutCssVars, getNavColorCssVars, mergeLayoutCssVars, LayoutGlobalStyles } from './core/index.js';
export type { LayoutGlobalStylesProps } from './core/index.js';

export { LayoutSection, MainSection } from './core/index.js';
export type { LayoutSectionProps, MainSectionProps } from './core/index.js';

export { HeaderSection, HeaderToolbar } from './core/index.js';
export type { HeaderSectionProps, HeaderToolbarProps } from './core/index.js';

// =============================================================================
// DASHBOARD LAYOUTS
// =============================================================================

export { DashboardLayout, DashboardContent } from './dashboard/index.js';
export type { DashboardLayoutProps, DashboardContentProps } from './dashboard/index.js';

export { Sidenav, MobileSidenav } from './dashboard/index.js';
export type { SidenavProps, MobileSidenavProps } from './dashboard/index.js';

// =============================================================================
// AUTH LAYOUTS
// =============================================================================

export { AuthCenteredLayout, AuthCenteredContent } from './auth/index.js';
export type { AuthCenteredLayoutProps, AuthCenteredContentProps } from './auth/index.js';

export { AuthSplitLayout, AuthSplitIllustration, AuthSplitContent } from './auth/index.js';
export type { AuthSplitLayoutProps, AuthSplitIllustrationProps, AuthSplitContentProps } from './auth/index.js';

export { AuthSimpleLayout, SimpleCompactContent } from './auth/index.js';
export type { AuthSimpleLayoutProps, SimpleCompactContentProps } from './auth/index.js';
