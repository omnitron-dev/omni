/**
 * Retro Theme Preset
 *
 * A nostalgic theme with vintage computer aesthetics.
 * Features amber/gold primary with classic terminal vibes.
 *
 * @module @omnitron-dev/prism/theme/presets/retro
 */

import type { ThemePresetDefinition, ColorScale } from '../../types/theme.js';

/**
 * Retro amber primary - classic terminal gold.
 */
export const retroAmber: ColorScale = {
  50: '#FFFBEB',
  100: '#FEF3C7',
  200: '#FDE68A',
  300: '#FCD34D',
  400: '#FBBF24',
  500: '#F59E0B', // Main amber
  600: '#D97706',
  700: '#B45309',
  800: '#92400E',
  900: '#78350F',
  950: '#451A03',
};

/**
 * Retro teal secondary - vintage accent.
 */
export const retroTeal: ColorScale = {
  50: '#F0FDFA',
  100: '#CCFBF1',
  200: '#99F6E4',
  300: '#5EEAD4',
  400: '#2DD4BF',
  500: '#14B8A6', // Main teal
  600: '#0D9488',
  700: '#0F766E',
  800: '#115E59',
  900: '#134E4A',
  950: '#042F2E',
};

/**
 * Retro theme preset.
 * Nostalgic vintage computer aesthetic optimized for light mode.
 */
export const retroPreset: ThemePresetDefinition = {
  name: 'retro',
  displayName: 'Retro',
  description: 'A nostalgic theme with vintage computer aesthetics.',
  preferredMode: 'light',
  typography: {
    fontFamily: {
      primary: '"VT323", "Courier New", Courier, monospace',
      secondary: '"Press Start 2P", "Courier New", monospace',
      mono: '"VT323", "Courier New", Courier, monospace',
    },
    fontWeights: {
      light: 400,
      regular: 400,
      medium: 400,
      semiBold: 400,
      bold: 400,
    },
  },
  colorGroup: {
    key: 'retro',
    main: retroAmber[500],
    palette: retroAmber,
  },
};
