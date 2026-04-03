/**
 * Mega Menu Types
 *
 * Type definitions for mega menu components.
 *
 * @module @omnitron/prism/components/mega-menu
 */

import type { ButtonBaseProps } from '@mui/material/ButtonBase';
import type { LinkProps } from '@mui/material/Link';
import type { Theme, SxProps, CSSObject } from '@mui/material/styles';

// =============================================================================
// MEGA MENU ITEM TYPES
// =============================================================================

/**
 * Custom render props for mega menu items.
 */
export type MegaMenuRenderProps = {
  /** Map of icon names to React nodes */
  navIcon?: Record<string, React.ReactNode>;
  /** Function to get info badges by key */
  navInfo?: (val: string) => Record<string, React.ReactElement>;
};

/**
 * State props for mega menu item.
 */
export type MegaMenuItemStateProps = {
  /** Whether the submenu is open */
  open?: boolean;
  /** Whether the item is active */
  active?: boolean;
  /** Whether the item is disabled */
  disabled?: boolean;
};

/**
 * Slot styling props for mega menu items.
 */
export type MegaMenuItemSlotProps = {
  /** Root element sx */
  sx?: SxProps<Theme>;
  /** Icon sx */
  icon?: SxProps<Theme>;
  /** Title sx */
  title?: SxProps<Theme>;
  /** Info badge sx */
  info?: SxProps<Theme>;
  /** Arrow indicator sx */
  arrow?: SxProps<Theme>;
};

/**
 * Slot props for entire mega menu.
 */
export type MegaMenuSlotProps = {
  /** Root item slot props */
  rootItem?: Pick<MegaMenuItemSlotProps, 'sx' | 'icon' | 'title' | 'info' | 'arrow'>;
  /** Sub item sx */
  subItem?: SxProps<Theme>;
  /** Subheader sx */
  subheader?: SxProps<Theme>;
  /** Dropdown sx */
  dropdown?: SxProps<Theme>;
  /** Tags sx */
  tags?: SxProps<Theme>;
  /** More link sx */
  moreLink?: SxProps<Theme>;
};

/**
 * Slide content for mega menu carousel.
 */
export type MegaMenuSlide = {
  /** Slide name/title */
  name: string;
  /** Link path */
  path: string;
  /** Cover image URL */
  coverUrl: string;
};

/**
 * Tag link for mega menu items.
 */
export type MegaMenuTag = {
  /** Tag title */
  title: string;
  /** Tag path */
  path: string;
};

/**
 * "More" link for mega menu sections.
 */
export type MegaMenuMoreLink = {
  /** Link title */
  title: string;
  /** Link path */
  path: string;
};

/**
 * Child item structure for mega menu.
 */
export type MegaMenuChildItem = {
  /** Child title */
  title: string;
  /** Child path */
  path: string;
};

/**
 * Child section for mega menu (grouped children).
 */
export type MegaMenuChildSection = {
  /** Section subheader */
  subheader?: string;
  /** Section items */
  items: MegaMenuChildItem[];
};

/**
 * Options props for mega menu items.
 */
export type MegaMenuItemOptionsProps = {
  /** Whether item has children */
  hasChild?: boolean;
  /** Whether link is external */
  externalLink?: boolean;
  /** Enable click on root items with children */
  enabledRootRedirect?: boolean;
  /** Custom render props */
  render?: MegaMenuRenderProps;
  /** Slot styling props */
  slotProps?: MegaMenuItemSlotProps;
};

/**
 * Data props for a single mega menu item.
 */
export type MegaMenuItemDataProps = Pick<MegaMenuItemStateProps, 'disabled'> & {
  /** Navigation path */
  path: string;
  /** Display title */
  title: string;
  /** Icon (string key or React node) */
  icon?: string | React.ReactNode;
  /** Info badge content */
  info?: string[] | React.ReactNode;
  /** Carousel slides */
  slides?: MegaMenuSlide[];
  /** "More" link */
  moreLink?: MegaMenuMoreLink;
  /** Tag links */
  tags?: MegaMenuTag[];
  /** Match nested routes as active */
  deepMatch?: boolean;
  /** Child sections */
  children?: MegaMenuChildSection[];
};

/**
 * Complete props for mega menu item component.
 */
export type MegaMenuItemProps = ButtonBaseProps &
  MegaMenuItemDataProps &
  MegaMenuItemStateProps &
  MegaMenuItemOptionsProps;

/**
 * Props for mega menu sub item.
 */
export type MegaMenuSubItemProps = LinkProps &
  Pick<MegaMenuItemProps, 'title' | 'path' | 'active'> &
  Pick<MegaMenuSlotProps, 'subItem'>;

// =============================================================================
// MEGA MENU LIST TYPES
// =============================================================================

/**
 * Props for MegaMenuList component.
 */
export type MegaMenuListProps = Pick<MegaMenuItemProps, 'render' | 'enabledRootRedirect'> & {
  /** CSS custom properties */
  cssVars?: CSSObject;
  /** Menu item data */
  data: MegaMenuItemDataProps;
  /** Slot styling props */
  slotProps?: MegaMenuSlotProps;
  /** Custom slots */
  slots?: {
    /** Custom button slot */
    button?: React.ReactElement;
    /** Top area slot */
    topArea?: React.ReactNode;
    /** Bottom area slot */
    bottomArea?: React.ReactNode;
  };
};

/**
 * Props for mega menu sub list.
 */
export type MegaMenuSubListProps = React.ComponentProps<'li'> & {
  /** Custom sx props */
  sx?: SxProps<Theme>;
  /** Slot styling props */
  slotProps?: MegaMenuSlotProps;
  /** Child sections data */
  data: MegaMenuItemDataProps['children'];
};

// =============================================================================
// MEGA MENU TYPES
// =============================================================================

/**
 * Mega menu layout variant.
 */
export type MegaMenuVariant = 'horizontal' | 'vertical' | 'mobile';

/**
 * Props for MegaMenu component.
 */
export type MegaMenuProps = React.ComponentProps<'nav'> &
  Omit<MegaMenuListProps, 'data'> & {
    /** Custom sx props */
    sx?: SxProps<Theme>;
    /** Menu data */
    data: MegaMenuItemDataProps[];
  };
