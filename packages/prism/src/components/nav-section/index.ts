/**
 * Navigation Section Exports
 *
 * @module @omnitron-dev/prism/components/nav-section
 */

// Types
export type {
  // Item types
  NavItemRenderProps,
  NavItemStateProps,
  NavItemSlotProps,
  NavSlotProps,
  NavItemOptionsProps,
  NavItemDataProps,
  NavItemProps,
  // List types
  NavListProps,
  NavSubListProps,
  NavGroupProps,
  // Section types
  NavSectionData,
  NavSectionProps,
  // Variant types
  NavVariant,
  NavCommonProps,
} from './types.js';

// Styles
export { navSectionClasses, navSectionCssVars, getNavCssVars } from './styles.js';

// Base components
export {
  Nav,
  NavUl,
  NavLi,
  NavSubheader,
  NavItemBase,
  NavIcon,
  NavTexts,
  NavArrow,
  NavInfo,
  type NavUlProps,
  type NavLiProps,
  type NavSubheaderProps,
  type NavItemBaseProps,
  type NavIconProps,
  type NavTextsProps,
  type NavArrowProps,
  type NavInfoProps,
} from './components.js';

// NavItem
export { NavItem } from './nav-item.js';

// NavList
export { NavList, NavSubList } from './nav-list.js';

// NavSection variants
export { NavSectionVertical } from './nav-section-vertical.js';
export { NavSectionHorizontal } from './nav-section-horizontal.js';
export { NavSectionMini } from './nav-section-mini.js';

// Default export (vertical variant)
export { NavSectionVertical as NavSection } from './nav-section-vertical.js';
