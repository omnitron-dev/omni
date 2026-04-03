/**
 * CSS Variables System
 *
 * Utilities for generating and managing CSS variables.
 *
 * @module @omnitron/prism/theme/css-variables
 */

import type { PrismTheme, CssVariablesConfig } from '../types/theme.js';
import { generatePaletteChannel } from './palette.js';

/**
 * CSS variable definitions.
 * Uses an index signature since keys are dynamically generated based on prefix.
 */
export interface CssVariables {
  [key: string]: string;
}

/**
 * Default CSS variable values.
 */
export const cssVariables: CssVariables = {
  '--prism-background': '#FFFFFF',
  '--prism-foreground': '#212121',
  '--prism-card': '#FFFFFF',
  '--prism-card-foreground': '#212121',
  '--prism-popover': '#FFFFFF',
  '--prism-popover-foreground': '#212121',

  '--prism-primary': '#00A76F',
  '--prism-primary-foreground': '#FFFFFF',
  '--prism-primary-lighter': '#C8FAD6',
  '--prism-primary-light': '#5BE49B',
  '--prism-primary-dark': '#007867',
  '--prism-primary-darker': '#004B50',

  '--prism-secondary': '#8E33FF',
  '--prism-secondary-foreground': '#FFFFFF',

  '--prism-muted': '#F4F6F8',
  '--prism-muted-foreground': '#637381',
  '--prism-accent': '#F4F6F8',
  '--prism-accent-foreground': '#212121',
  '--prism-destructive': '#FF5630',
  '--prism-destructive-foreground': '#FFFFFF',

  '--prism-border': '#E0E0E0',
  '--prism-input': '#E0E0E0',
  '--prism-ring': '#00A76F',

  '--prism-radius': '0.5rem',

  '--prism-primary-channel': '0 167 111',
  '--prism-secondary-channel': '142 51 255',
  '--prism-background-channel': '255 255 255',
};

/**
 * Generate CSS variables from a Prism theme.
 *
 * @param theme - Prism theme
 * @param config - CSS variables configuration
 * @returns CSS variables object
 */
export function generateCssVariables(theme: PrismTheme, config: CssVariablesConfig): CssVariables {
  const { prefix } = config;
  const { palette } = theme;

  const vars: CssVariables = {
    [`--${prefix}-background`]: palette.background.default,
    [`--${prefix}-foreground`]: palette.text.primary,
    [`--${prefix}-card`]: palette.background.paper,
    [`--${prefix}-card-foreground`]: palette.text.primary,
    [`--${prefix}-popover`]: palette.background.paper,
    [`--${prefix}-popover-foreground`]: palette.text.primary,

    [`--${prefix}-primary`]: palette.primary.main,
    [`--${prefix}-primary-foreground`]: palette.primary.contrastText,
    [`--${prefix}-primary-lighter`]:
      (palette.primary as unknown as { lighter?: string }).lighter || palette.primary.light,
    [`--${prefix}-primary-light`]: palette.primary.light,
    [`--${prefix}-primary-dark`]: palette.primary.dark,
    [`--${prefix}-primary-darker`]: (palette.primary as unknown as { darker?: string }).darker || palette.primary.dark,

    [`--${prefix}-secondary`]: palette.secondary.main,
    [`--${prefix}-secondary-foreground`]: palette.secondary.contrastText,

    [`--${prefix}-muted`]: palette.background.default,
    [`--${prefix}-muted-foreground`]: palette.text.secondary,
    [`--${prefix}-accent`]: palette.background.default,
    [`--${prefix}-accent-foreground`]: palette.text.primary,
    [`--${prefix}-destructive`]: palette.error.main,
    [`--${prefix}-destructive-foreground`]: palette.error.contrastText,

    [`--${prefix}-border`]: palette.divider || palette.grey[300],
    [`--${prefix}-input`]: palette.divider || palette.grey[300],
    [`--${prefix}-ring`]: palette.primary.main,

    [`--${prefix}-radius`]: `${theme.shape.borderRadius}px`,

    [`--${prefix}-primary-channel`]: generatePaletteChannel(palette.primary.main),
    [`--${prefix}-secondary-channel`]: generatePaletteChannel(palette.secondary.main),
    [`--${prefix}-background-channel`]: generatePaletteChannel(palette.background.default),
  };

  // Inject into document if in browser
  if (typeof document !== 'undefined') {
    injectCssVariables(vars, config);
  }

  return vars;
}

/**
 * Inject CSS variables into the document.
 *
 * @param vars - CSS variables object
 * @param config - CSS variables configuration
 */
function injectCssVariables(vars: CssVariables, config: CssVariablesConfig): void {
  const root = document.documentElement;

  Object.entries(vars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
}

/**
 * Get computed CSS variable value.
 *
 * @param name - Variable name (with or without --)
 * @returns Computed value
 */
export function getCssVariable(name: string): string {
  if (typeof window === 'undefined') return '';

  const varName = name.startsWith('--') ? name : `--${name}`;
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

/**
 * Set CSS variable value.
 *
 * @param name - Variable name (with or without --)
 * @param value - New value
 */
export function setCssVariable(name: string, value: string): void {
  if (typeof document === 'undefined') return;

  const varName = name.startsWith('--') ? name : `--${name}`;
  document.documentElement.style.setProperty(varName, value);
}
