/**
 * Minimal Theme Preset
 *
 * A clean, minimalist theme with subtle grays and muted accents.
 * Focuses on content over chrome with maximum readability.
 *
 * @module @omnitron-dev/prism/theme/presets/minimal
 */

import type { ThemePresetDefinition, ColorScale } from '../../types/theme.js';

/**
 * Minimal neutral scale - refined grays.
 */
export const minimalNeutral: ColorScale = {
  50: '#FAFAFA',
  100: '#F5F5F5',
  200: '#E5E5E5',
  300: '#D4D4D4',
  400: '#A3A3A3',
  500: '#737373', // Main neutral
  600: '#525252',
  700: '#404040',
  800: '#262626',
  900: '#171717',
  950: '#0A0A0A',
};

/**
 * Minimal accent scale - subtle blue-grey.
 */
export const minimalAccent: ColorScale = {
  50: '#F8FAFC',
  100: '#F1F5F9',
  200: '#E2E8F0',
  300: '#CBD5E1',
  400: '#94A3B8',
  500: '#64748B', // Main slate
  600: '#475569',
  700: '#334155',
  800: '#1E293B',
  900: '#0F172A',
  950: '#020617',
};

/**
 * Minimal theme preset.
 * Clean, content-focused theme that works in both light and dark modes.
 */
export const minimalPreset: ThemePresetDefinition = {
  name: 'minimal',
  displayName: 'Minimal',
  description: 'A clean, minimalist theme with subtle grays and muted accents.',
  preferredMode: 'light',
  typography: {
    fontFamily: {
      primary: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      secondary: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
      mono: '"SF Mono", Menlo, Consolas, Monaco, monospace',
    },
    fontWeights: {
      light: 300,
      regular: 400,
      medium: 500,
      semiBold: 600,
      bold: 700,
    },
  },
  colorGroup: {
    key: 'minimal',
    main: minimalNeutral[500],
    palette: minimalNeutral,
  },
};
