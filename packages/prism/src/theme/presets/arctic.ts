/**
 * Arctic Theme Preset
 *
 * A cool, crisp blue theme inspired by northern landscapes.
 *
 * @module @omnitron/prism/theme/presets/arctic
 */

import type { ThemePresetDefinition, PresetPalette } from '../../types/theme.js';

/**
 * Light mode palette.
 */
const lightPalette: PresetPalette = {
  primary: {
    lighter: '#D6E9F8',
    light: '#7BC1F0',
    main: '#1E88E5',
    dark: '#1565C0',
    darker: '#0D47A1',
    contrastText: '#FFFFFF',
  },
  secondary: {
    lighter: '#E3F2FD',
    light: '#90CAF9',
    main: '#42A5F5',
    dark: '#1E88E5',
    darker: '#1565C0',
    contrastText: '#FFFFFF',
  },
  info: {
    lighter: '#E0F7FA',
    light: '#80DEEA',
    main: '#26C6DA',
    dark: '#00ACC1',
    darker: '#00838F',
    contrastText: '#FFFFFF',
  },
  success: {
    lighter: '#E8F5E9',
    light: '#A5D6A7',
    main: '#66BB6A',
    dark: '#43A047',
    darker: '#2E7D32',
    contrastText: '#FFFFFF',
  },
  warning: {
    lighter: '#FFF8E1',
    light: '#FFE082',
    main: '#FFB300',
    dark: '#FF8F00',
    darker: '#FF6F00',
    contrastText: '#212121',
  },
  error: {
    lighter: '#FFEBEE',
    light: '#EF9A9A',
    main: '#EF5350',
    dark: '#E53935',
    darker: '#C62828',
    contrastText: '#FFFFFF',
  },
  grey: {
    50: '#FAFBFC',
    100: '#F4F6F8',
    200: '#E4E9ED',
    300: '#D0D7DE',
    400: '#AFB8C1',
    500: '#8C959F',
    600: '#6E7781',
    700: '#57606A',
    800: '#424A53',
    900: '#32383F',
    950: '#272C31',
  },
  common: {
    black: '#1B1F23',
    white: '#FFFFFF',
  },
  background: {
    default: '#E8F0F6',
    paper: '#F1F9FB',
    neutral: '#E4E9ED',
  },
  text: {
    primary: '#1B1F23',
    secondary: '#57606A',
    disabled: '#8C959F',
  },
};

/**
 * Dark mode palette.
 */
const darkPalette: PresetPalette = {
  primary: {
    lighter: '#D6E9F8',
    light: '#7BC1F0',
    main: '#42A5F5',
    dark: '#1E88E5',
    darker: '#1565C0',
    contrastText: '#FFFFFF',
  },
  secondary: {
    lighter: '#E3F2FD',
    light: '#90CAF9',
    main: '#64B5F6',
    dark: '#42A5F5',
    darker: '#1E88E5',
    contrastText: '#FFFFFF',
  },
  info: {
    lighter: '#E0F7FA',
    light: '#80DEEA',
    main: '#4DD0E1',
    dark: '#26C6DA',
    darker: '#00ACC1',
    contrastText: '#FFFFFF',
  },
  success: {
    lighter: '#E8F5E9',
    light: '#A5D6A7',
    main: '#81C784',
    dark: '#66BB6A',
    darker: '#4CAF50',
    contrastText: '#FFFFFF',
  },
  warning: {
    lighter: '#FFF8E1',
    light: '#FFE082',
    main: '#FFCA28',
    dark: '#FFB300',
    darker: '#FFA000',
    contrastText: '#212121',
  },
  error: {
    lighter: '#FFEBEE',
    light: '#EF9A9A',
    main: '#EF5350',
    dark: '#F44336',
    darker: '#E53935',
    contrastText: '#FFFFFF',
  },
  grey: {
    50: '#0D1117',
    100: '#161B22',
    200: '#21262D',
    300: '#30363D',
    400: '#484F58',
    500: '#6E7681',
    600: '#8B949E',
    700: '#B1BAC4',
    800: '#C9D1D9',
    900: '#F0F6FC',
  },
  common: {
    black: '#010409',
    white: '#FFFFFF',
  },
  background: {
    default: '#0D1117',
    paper: '#161B22',
    neutral: '#21262D',
  },
  text: {
    primary: '#F0F6FC',
    secondary: '#B1BAC4',
    disabled: '#6E7681',
  },
};

/**
 * Arctic theme preset.
 */
export const arcticPreset: ThemePresetDefinition = {
  name: 'arctic',
  displayName: 'Arctic',
  description: 'A cool, crisp blue theme inspired by northern landscapes.',
  preferredMode: 'light',
  lightPalette,
  darkPalette,
  typography: {
    fontFamily: {
      primary: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      secondary: '"Poppins", -apple-system, BlinkMacSystemFont, sans-serif',
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
    key: 'arctic',
    main: '#1E88E5',
  },
};
