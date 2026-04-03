/**
 * Dracula Theme Preset
 *
 * A dark theme inspired by the popular Dracula color scheme.
 * Features purple primary with distinct accent colors.
 *
 * @module @omnitron/prism/theme/presets/dracula
 */

import type { ThemePresetDefinition, ColorScale } from '../../types/theme.js';

/**
 * Dracula purple primary.
 */
export const draculaPurple: ColorScale = {
  50: '#F9F5FF',
  100: '#F0E6FF',
  200: '#E3CFFF',
  300: '#CEA9FF',
  400: '#B574FF',
  500: '#BD93F9', // Main Dracula purple
  600: '#A57EE0',
  700: '#8666B8',
  800: '#6E5394',
  900: '#5B4579',
  950: '#3B2D4D',
};

/**
 * Dracula pink accent.
 */
export const draculaPink: ColorScale = {
  50: '#FFF5F7',
  100: '#FFE5EA',
  200: '#FFCCD6',
  300: '#FFA4B5',
  400: '#FF6E8B',
  500: '#FF79C6', // Main Dracula pink
  600: '#E85AA1',
  700: '#C4407F',
  800: '#A2356A',
  900: '#87305B',
  950: '#4E1533',
};

/**
 * Dracula cyan accent.
 */
export const draculaCyan: ColorScale = {
  50: '#ECFFFE',
  100: '#CFFFFE',
  200: '#A5FFFE',
  300: '#67FFFC',
  400: '#22FFF5',
  500: '#8BE9FD', // Main Dracula cyan
  600: '#06D1E7',
  700: '#0BA6BC',
  800: '#118497',
  900: '#136C7D',
  950: '#05484E',
};

/**
 * Dracula theme preset.
 * Dark-only theme inspired by the popular Dracula scheme.
 */
export const draculaPreset: ThemePresetDefinition = {
  name: 'dracula',
  displayName: 'Dracula',
  description: 'A dark theme inspired by the popular Dracula color scheme.',
  preferredMode: 'dark',
  typography: {
    fontFamily: {
      primary: '"Fira Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      secondary: '"DM Sans", -apple-system, BlinkMacSystemFont, sans-serif',
      mono: '"Fira Code", Consolas, Monaco, monospace',
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
    key: 'dracula',
    main: draculaPurple[500],
    palette: draculaPurple,
  },
};
