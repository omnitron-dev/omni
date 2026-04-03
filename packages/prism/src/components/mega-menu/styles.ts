/**
 * Mega Menu Styles
 *
 * CSS custom properties and class names for mega menus.
 *
 * @module @omnitron/prism/components/mega-menu
 */

import type { Theme, CSSObject } from '@mui/material/styles';
import type { MegaMenuVariant } from './types.js';
import { createComponentClasses } from '../../utils/create-classes.js';

// =============================================================================
// CLASS NAMES
// =============================================================================

/**
 * CSS class names for mega menu components.
 */
export const megaMenuClasses = createComponentClasses('mega-menu', [
  'root',
  'horizontal',
  'vertical',
  'mobile',
  'ul',
  'li',
  'item',
  'icon',
  'title',
  'info',
  'arrow',
  'dropdown',
  'subheader',
  'subItem',
  'tags',
  'moreLink',
  'slide',
  'active',
  'disabled',
  'open',
] as const);

// =============================================================================
// CSS CUSTOM PROPERTIES
// =============================================================================

/**
 * Get CSS variables for mega menu based on variant.
 */
export function megaMenuCssVars(theme: Theme, variant: MegaMenuVariant): CSSObject {
  const commonVars: CSSObject = {
    // Item spacing
    '--nav-item-gap': '6px',
    '--nav-item-radius': '8px',
    // Icon
    '--nav-icon-size': '22px',
    '--nav-icon-margin': '0 8px 0 0',
    // Text
    '--nav-item-font-size': '0.875rem',
    '--nav-subheader-font-size': '0.6875rem',
    '--nav-subheader-font-weight': '700',
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
  };

  switch (variant) {
    case 'horizontal':
      return {
        ...commonVars,
        '--nav-item-padding': '8px 14px',
        '--nav-item-min-height': '36px',
        // Dropdown
        '--nav-dropdown-width': '800px',
        '--nav-dropdown-max-height': '400px',
        '--nav-dropdown-radius': '12px',
        '--nav-dropdown-shadow': theme.shadows[20],
        '--nav-dropdown-padding': '24px',
      };

    case 'vertical':
      return {
        ...commonVars,
        '--nav-item-padding': '8px 12px',
        '--nav-item-min-height': '40px',
        // Dropdown
        '--nav-dropdown-width': '280px',
        '--nav-dropdown-max-height': '350px',
        '--nav-dropdown-radius': '10px',
        '--nav-dropdown-shadow': theme.shadows[16],
        '--nav-dropdown-padding': '16px',
      };

    case 'mobile':
      return {
        ...commonVars,
        '--nav-item-padding': '12px 16px',
        '--nav-item-min-height': '44px',
        // No dropdown for mobile - uses accordion style
      };

    default:
      return commonVars;
  }
}
