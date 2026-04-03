/**
 * Luxury Theme Preset
 *
 * A rich, elegant theme with deep colors and premium feel.
 *
 * @module @omnitron/prism/theme/presets/luxury
 */

import type { ThemePresetDefinition, PresetPalette } from '../../types/theme.js';

/**
 * Light mode palette.
 */
const lightPalette: PresetPalette = {
  primary: {
    lighter: '#F5E6D3',
    light: '#D4A574',
    main: '#8B6914',
    dark: '#6B4F0F',
    darker: '#4A370A',
    contrastText: '#FFFFFF',
  },
  secondary: {
    lighter: '#E8D5E8',
    light: '#B38AB3',
    main: '#6B3A6B',
    dark: '#4D2A4D',
    darker: '#2F1A2F',
    contrastText: '#FFFFFF',
  },
  info: {
    lighter: '#D6E4F0',
    light: '#8BBED9',
    main: '#2E7AB8',
    dark: '#1F5A8A',
    darker: '#103A5C',
    contrastText: '#FFFFFF',
  },
  success: {
    lighter: '#D8EED3',
    light: '#8BC98A',
    main: '#2E8B2E',
    dark: '#1F6B1F',
    darker: '#104A10',
    contrastText: '#FFFFFF',
  },
  warning: {
    lighter: '#FFF3D6',
    light: '#FFD98B',
    main: '#D4A012',
    dark: '#A67A0E',
    darker: '#785509',
    contrastText: '#212121',
  },
  error: {
    lighter: '#F5D6D6',
    light: '#D98B8B',
    main: '#B82E2E',
    dark: '#8A1F1F',
    darker: '#5C1010',
    contrastText: '#FFFFFF',
  },
  grey: {
    50: '#FAF9F7',
    100: '#F5F3F0',
    200: '#E8E4DE',
    300: '#D4CEC4',
    400: '#B8AFA0',
    500: '#9C917C',
    600: '#7A6F5C',
    700: '#5C5244',
    800: '#3E362C',
    900: '#201C16',
  },
  common: {
    black: '#0D0A06',
    white: '#FFFCF7',
  },
  background: {
    default: '#FFFCF7',
    paper: '#FFFFFF',
    neutral: '#F5F3F0',
  },
  text: {
    primary: '#201C16',
    secondary: '#5C5244',
    disabled: '#9C917C',
  },
};

/**
 * Dark mode palette.
 */
const darkPalette: PresetPalette = {
  primary: {
    lighter: '#F5E6D3',
    light: '#D4A574',
    main: '#C9A227',
    dark: '#A68A1F',
    darker: '#846D18',
    contrastText: '#0D0A06',
  },
  secondary: {
    lighter: '#E8D5E8',
    light: '#B38AB3',
    main: '#9B5A9B',
    dark: '#7D4A7D',
    darker: '#5F3A5F',
    contrastText: '#FFFFFF',
  },
  info: {
    lighter: '#D6E4F0',
    light: '#8BBED9',
    main: '#4E9AD4',
    dark: '#3A7AB0',
    darker: '#265A8C',
    contrastText: '#FFFFFF',
  },
  success: {
    lighter: '#D8EED3',
    light: '#8BC98A',
    main: '#4EAB4E',
    dark: '#3A8B3A',
    darker: '#266B26',
    contrastText: '#FFFFFF',
  },
  warning: {
    lighter: '#FFF3D6',
    light: '#FFD98B',
    main: '#E8B612',
    dark: '#C49A0E',
    darker: '#A07E0A',
    contrastText: '#0D0A06',
  },
  error: {
    lighter: '#F5D6D6',
    light: '#D98B8B',
    main: '#D44E4E',
    dark: '#B03A3A',
    darker: '#8C2626',
    contrastText: '#FFFFFF',
  },
  grey: {
    50: '#18140E',
    100: '#241E16',
    200: '#362E22',
    300: '#4A402E',
    400: '#5E523A',
    500: '#7A6F5C',
    600: '#9C917C',
    700: '#B8AFA0',
    800: '#D4CEC4',
    900: '#E8E4DE',
  },
  common: {
    black: '#0D0A06',
    white: '#FFFCF7',
  },
  background: {
    default: '#0D0A06',
    paper: '#18140E',
    neutral: '#241E16',
  },
  text: {
    primary: '#E8E4DE',
    secondary: '#B8AFA0',
    disabled: '#7A6F5C',
  },
};

/**
 * Luxury theme preset.
 */
export const luxuryPreset: ThemePresetDefinition = {
  name: 'luxury',
  displayName: 'Luxury',
  description: 'A rich, elegant theme with deep colors and premium feel.',
  preferredMode: 'light',
  lightPalette,
  darkPalette,
  typography: {
    fontFamily: {
      primary: '"Playfair Display", Georgia, "Times New Roman", serif',
      secondary: '"Lato", -apple-system, BlinkMacSystemFont, sans-serif',
      mono: '"JetBrains Mono", Consolas, Monaco, monospace',
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
    key: 'luxury',
    main: '#8B6914',
  },
};
