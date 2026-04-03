/**
 * Ember Theme Preset
 *
 * A warm, fiery theme with deep oranges and reds.
 * Optimized for dark mode with glowing ember accents.
 *
 * @module @omnitron/prism/theme/presets/ember
 */

import type { ThemePresetDefinition, ColorScale } from '../../types/theme.js';

/**
 * Ember primary color scale - warm orange-red.
 */
export const emberPrimary: ColorScale = {
  50: '#FFF4ED',
  100: '#FFE4D4',
  200: '#FFC9A8',
  300: '#FFAA71',
  400: '#FF8038',
  500: '#FF5F11',
  600: '#F04006',
  700: '#C72D07',
  800: '#9E250E',
  900: '#7F230F',
  950: '#450E05',
};

/**
 * Ember secondary color scale - deep red.
 */
export const emberSecondary: ColorScale = {
  50: '#FFF1F2',
  100: '#FFE1E3',
  200: '#FFC8CD',
  300: '#FFA1A9',
  400: '#FF6B78',
  500: '#FA3D4D',
  600: '#E81B2D',
  700: '#C31323',
  800: '#A11421',
  900: '#861721',
  950: '#49060C',
};

/**
 * Ember theme preset.
 * Optimized for dark mode with warm fire tones.
 */
export const emberPreset: ThemePresetDefinition = {
  name: 'ember',
  displayName: 'Ember',
  description: 'A warm, fiery theme with deep oranges and reds.',
  preferredMode: 'dark',
  typography: {
    fontFamily: {
      primary: '"Outfit", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      secondary: '"Playfair Display", Georgia, serif',
      mono: '"Source Code Pro", Consolas, Monaco, monospace',
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
    key: 'ember',
    main: emberPrimary[500],
    palette: emberPrimary,
  },
};
