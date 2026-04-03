/**
 * Navigation Section Styles
 *
 * CSS custom properties and class names for nav sections.
 *
 * @module @omnitron-dev/prism/components/nav-section
 */

import type { Theme, CSSObject } from '@mui/material/styles';
import type { NavVariant } from './types.js';
import { createComponentClasses } from '../../utils/create-classes.js';

// =============================================================================
// CLASS NAMES
// =============================================================================

/**
 * CSS class names for nav section components.
 */
export const navSectionClasses = createComponentClasses('nav-section', [
  'root',
  'vertical',
  'horizontal',
  'mini',
  'ul',
  'li',
  'subheader',
  'item',
  'icon',
  'texts',
  'title',
  'caption',
  'info',
  'arrow',
  'active',
  'disabled',
  'open',
] as const);

// =============================================================================
// CSS CUSTOM PROPERTIES
// =============================================================================

/**
 * Default CSS variables for nav sections.
 */
export const navSectionCssVars = {
  /**
   * Get CSS variables for vertical variant.
   */
  vertical: (theme: Theme): CSSObject => ({
    // Item spacing
    '--nav-item-gap': '4px',
    '--nav-item-padding': '4px 8px 4px 12px',
    '--nav-item-padding-top': '4px',
    '--nav-item-padding-right': '8px',
    '--nav-item-padding-bottom': '4px',
    '--nav-item-padding-left': '12px',
    '--nav-item-radius': '8px',
    '--nav-item-min-height': '44px',
    // Icon
    '--nav-icon-size': '24px',
    '--nav-icon-margin': '0 16px 0 0',
    // Text
    '--nav-item-font-size': '0.875rem',
    '--nav-item-caption-size': '0.75rem',
    // Colors - inactive
    '--nav-item-color': theme.palette.text.secondary,
    '--nav-icon-color': theme.palette.text.secondary,
    '--nav-item-bg': 'transparent',
    // Colors - hover
    '--nav-item-hover-bg': theme.palette.action.hover,
    '--nav-item-hover-color': theme.palette.text.primary,
    // Colors - active
    '--nav-item-active-bg': theme.palette.action.selected,
    '--nav-item-active-color': theme.palette.primary.main,
    '--nav-icon-active-color': theme.palette.primary.main,
    // Colors - disabled
    '--nav-item-disabled-color': theme.palette.text.disabled,
    // Subheader
    '--nav-subheader-font-size': '0.6875rem',
    '--nav-subheader-font-weight': '700',
    '--nav-subheader-color': theme.palette.text.disabled,
    '--nav-subheader-padding': '8px 8px 8px 12px',
    // Sub-item adjustments
    '--nav-sub-item-padding': '4px 8px 4px 12px',
    '--nav-sub-item-margin-left': '40px',
    '--nav-sub-item-radius': '8px',
  }),

  /**
   * Get CSS variables for horizontal variant.
   */
  horizontal: (theme: Theme): CSSObject => ({
    // Item spacing
    '--nav-item-gap': '6px',
    '--nav-item-padding': '8px 14px',
    '--nav-item-radius': '8px',
    '--nav-item-min-height': '36px',
    // Icon
    '--nav-icon-size': '22px',
    '--nav-icon-margin': '0 8px 0 0',
    // Text
    '--nav-item-font-size': '0.875rem',
    // Colors - inactive
    '--nav-item-color': theme.palette.text.primary,
    '--nav-icon-color': theme.palette.text.secondary,
    '--nav-item-bg': 'transparent',
    // Colors - hover
    '--nav-item-hover-bg': theme.palette.action.hover,
    '--nav-item-hover-color': theme.palette.text.primary,
    // Colors - active
    '--nav-item-active-bg': theme.palette.action.selected,
    '--nav-item-active-color': theme.palette.primary.main,
    '--nav-icon-active-color': theme.palette.primary.main,
    // Colors - disabled
    '--nav-item-disabled-color': theme.palette.text.disabled,
    // Dropdown
    '--nav-dropdown-paper-width': '180px',
    '--nav-dropdown-paper-radius': '8px',
    '--nav-dropdown-paper-shadow': theme.shadows[8],
  }),

  /**
   * Get CSS variables for mini variant.
   */
  mini: (theme: Theme): CSSObject => ({
    // Item spacing
    '--nav-item-gap': '4px',
    '--nav-item-padding': '8px',
    '--nav-item-radius': '8px',
    '--nav-item-min-height': 'auto',
    // Icon
    '--nav-icon-size': '22px',
    '--nav-icon-margin': '0',
    // Text
    '--nav-item-font-size': '0.625rem',
    // Colors - inactive
    '--nav-item-color': theme.palette.text.secondary,
    '--nav-icon-color': theme.palette.text.secondary,
    '--nav-item-bg': 'transparent',
    // Colors - hover
    '--nav-item-hover-bg': theme.palette.action.hover,
    '--nav-item-hover-color': theme.palette.text.primary,
    // Colors - active
    '--nav-item-active-bg': theme.palette.action.selected,
    '--nav-item-active-color': theme.palette.primary.main,
    '--nav-icon-active-color': theme.palette.primary.main,
    // Colors - disabled
    '--nav-item-disabled-color': theme.palette.text.disabled,
    // Tooltip/Popover
    '--nav-tooltip-paper-width': '160px',
  }),
};

/**
 * Get CSS variables for a specific nav variant.
 */
export function getNavCssVars(theme: Theme, variant: NavVariant): CSSObject {
  switch (variant) {
    case 'horizontal':
      return navSectionCssVars.horizontal(theme);
    case 'mini':
      return navSectionCssVars.mini(theme);
    default:
      return navSectionCssVars.vertical(theme);
  }
}
