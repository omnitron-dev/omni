/**
 * Mega Menu Exports
 *
 * @module @omnitron/prism/components/mega-menu
 */

// Types
export type {
  // Item types
  MegaMenuRenderProps,
  MegaMenuItemStateProps,
  MegaMenuItemSlotProps,
  MegaMenuSlotProps,
  MegaMenuSlide,
  MegaMenuTag,
  MegaMenuMoreLink,
  MegaMenuChildItem,
  MegaMenuChildSection,
  MegaMenuItemOptionsProps,
  MegaMenuItemDataProps,
  MegaMenuItemProps,
  MegaMenuSubItemProps,
  // List types
  MegaMenuListProps,
  MegaMenuSubListProps,
  // Menu types
  MegaMenuVariant,
  MegaMenuProps,
} from './types.js';

// Styles
export { megaMenuClasses, megaMenuCssVars } from './styles.js';

// Components
export { MegaMenuHorizontal } from './mega-menu-horizontal.js';
export { MegaMenuVertical } from './mega-menu-vertical.js';
export { MegaMenuMobile } from './mega-menu-mobile.js';

// Default export (horizontal variant)
export { MegaMenuHorizontal as MegaMenu } from './mega-menu-horizontal.js';
