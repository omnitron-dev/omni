/**
 * Layout CSS Variables
 *
 * Global CSS variables for layout dimensions and styling.
 *
 * @module @omnitron-dev/prism/layouts/core/css-vars
 */

import type { ReactNode } from 'react';
import GlobalStyles from '@mui/material/GlobalStyles';
import { useTheme } from '@mui/material/styles';
import { LAYOUT_CSS_VARS, HEADER_HEIGHTS, DRAWER_WIDTHS, type NavColorMode } from '../types.js';

// =============================================================================
// CSS VARIABLE GENERATION
// =============================================================================

/**
 * Generate base layout CSS variables.
 */
export function getBaseLayoutCssVars(zIndexBase: number): Record<string, string | number> {
  return {
    // Header dimensions
    [LAYOUT_CSS_VARS.headerMobileHeight]: `${HEADER_HEIGHTS.mobile}px`,
    [LAYOUT_CSS_VARS.headerDesktopHeight]: `${HEADER_HEIGHTS.desktop}px`,
    [LAYOUT_CSS_VARS.headerBlur]: '8px',
    [LAYOUT_CSS_VARS.headerZIndex]: zIndexBase + 1,
    // Nav dimensions
    [LAYOUT_CSS_VARS.navWidth]: `${DRAWER_WIDTHS.full}px`,
    [LAYOUT_CSS_VARS.navMiniWidth]: `${DRAWER_WIDTHS.mini}px`,
    [LAYOUT_CSS_VARS.navMobileWidth]: `${DRAWER_WIDTHS.mobile}px`,
    [LAYOUT_CSS_VARS.navZIndex]: zIndexBase,
  };
}

/**
 * Generate navigation color CSS variables based on mode.
 */
export function getNavColorCssVars(
  mode: NavColorMode,
  theme: {
    palette: {
      mode: 'light' | 'dark';
      background: { paper: string; default: string };
      text: { primary: string; secondary: string };
    };
  }
): Record<string, string> {
  const isDark = theme.palette.mode === 'dark';

  switch (mode) {
    case 'vibrant':
      // Vibrant mode - gradient background with white text
      return {
        [LAYOUT_CSS_VARS.navBg]: isDark
          ? 'linear-gradient(135deg, #1a237e 0%, #0d47a1 100%)'
          : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        [LAYOUT_CSS_VARS.navTextColor]: '#ffffff',
        [LAYOUT_CSS_VARS.navTextSecondaryColor]: 'rgba(255, 255, 255, 0.7)',
      };

    case 'integrate':
      // Integrate mode - blends with page background
      return {
        [LAYOUT_CSS_VARS.navBg]: 'transparent',
        [LAYOUT_CSS_VARS.navTextColor]: theme.palette.text.primary,
        [LAYOUT_CSS_VARS.navTextSecondaryColor]: theme.palette.text.secondary,
      };

    case 'default':
    default:
      // Default mode - distinct nav background
      return {
        [LAYOUT_CSS_VARS.navBg]: theme.palette.background.paper,
        [LAYOUT_CSS_VARS.navTextColor]: theme.palette.text.primary,
        [LAYOUT_CSS_VARS.navTextSecondaryColor]: theme.palette.text.secondary,
      };
  }
}

/**
 * Merge custom CSS variables with defaults.
 */
export function mergeLayoutCssVars(
  customVars: Record<string, string | number> | undefined,
  ...defaultVars: Record<string, string | number>[]
): Record<string, string | number> {
  return Object.assign({}, ...defaultVars, customVars);
}

// =============================================================================
// GLOBAL STYLES COMPONENT
// =============================================================================

export interface LayoutGlobalStylesProps {
  /** Additional CSS variables */
  cssVars?: Record<string, string | number>;
}

/**
 * Global CSS variables for layouts.
 * Should be rendered once at the root of the layout system.
 */
export function LayoutGlobalStyles({ cssVars }: LayoutGlobalStylesProps): ReactNode {
  const theme = useTheme();

  const baseVars = getBaseLayoutCssVars(theme.zIndex.drawer);

  const allVars = mergeLayoutCssVars(cssVars, baseVars);

  // Convert to CSS string (kept for debugging)
  const _cssString = Object.entries(allVars)
    .map(([key, value]) => `${key}: ${value};`)
    .join('\n');

  return (
    <GlobalStyles
      styles={{
        ':root': Object.fromEntries(Object.entries(allVars).map(([key, value]) => [key, value])),
        // Responsive header height
        [`@media (max-width: ${theme.breakpoints.values.md}px)`]: {
          ':root': {
            [LAYOUT_CSS_VARS.headerHeight]: `var(${LAYOUT_CSS_VARS.headerMobileHeight})`,
          },
        },
        [`@media (min-width: ${theme.breakpoints.values.md}px)`]: {
          ':root': {
            [LAYOUT_CSS_VARS.headerHeight]: `var(${LAYOUT_CSS_VARS.headerDesktopHeight})`,
          },
        },
      }}
    />
  );
}
