/**
 * Layout Core
 *
 * Core building blocks for Prism layouts.
 *
 * @module @omnitron-dev/prism/layouts/core
 */

// Context
export {
  LayoutContext,
  LayoutProvider,
  defaultLayoutConfig,
  useLayoutContext,
  useLayoutConfig,
  useSidenavVisible,
  useTopnavVisible,
  useNavActive,
} from './context.js';
export type { LayoutProviderProps } from './context.js';

// CSS Variables
export { LayoutGlobalStyles, getBaseLayoutCssVars, getNavColorCssVars, mergeLayoutCssVars } from './css-vars.js';
export type { LayoutGlobalStylesProps } from './css-vars.js';

// Layout Section
export { LayoutSection, MainSection } from './layout-section.js';
export type { LayoutSectionProps, MainSectionProps } from './layout-section.js';

// Header Section
export { HeaderSection, HeaderToolbar } from './header-section.js';
export type { HeaderSectionProps, HeaderToolbarProps } from './header-section.js';

// User Menu
export { UserMenu } from './user-menu.js';
export type { UserMenuProps, UserMenuUser, UserMenuItem } from './user-menu.js';
