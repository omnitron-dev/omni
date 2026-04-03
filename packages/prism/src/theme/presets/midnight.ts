/**
 * Midnight Theme Preset
 *
 * A deep blue-black theme for late night coding sessions.
 * Features indigo primary with soft blue accents.
 *
 * @module @omnitron-dev/prism/theme/presets/midnight
 */

import type { ThemePresetDefinition, ColorScale } from '../../types/theme.js';

/**
 * Midnight indigo primary.
 */
export const midnightIndigo: ColorScale = {
  50: '#EEF2FF',
  100: '#E0E7FF',
  200: '#C7D2FE',
  300: '#A5B4FC',
  400: '#818CF8',
  500: '#6366F1', // Main indigo
  600: '#4F46E5',
  700: '#4338CA',
  800: '#3730A3',
  900: '#312E81',
  950: '#1E1B4B',
};

/**
 * Midnight blue-grey background scale.
 */
export const midnightBackground: ColorScale = {
  50: '#F8FAFC',
  100: '#F1F5F9',
  200: '#E2E8F0',
  300: '#CBD5E1',
  400: '#94A3B8',
  500: '#64748B',
  600: '#475569',
  700: '#334155',
  800: '#1E293B',
  900: '#0F172A', // Main dark background
  950: '#020617',
};

/**
 * Midnight theme preset.
 * Deep blue-black theme optimized for dark mode.
 */
export const midnightPreset: ThemePresetDefinition = {
  name: 'midnight',
  displayName: 'Midnight',
  description: 'A deep blue-black theme for late night coding sessions.',
  preferredMode: 'dark',
  typography: {
    fontFamily: {
      primary: '"Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      secondary: '"Sora", -apple-system, BlinkMacSystemFont, sans-serif',
      mono: '"IBM Plex Mono", Consolas, Monaco, monospace',
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
    key: 'midnight',
    main: midnightIndigo[500],
    palette: midnightIndigo,
  },
};
