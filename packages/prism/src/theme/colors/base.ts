/**
 * Base Color Scales
 *
 * Foundation colors used across all presets.
 * 11-shade scales (50-950) for maximum flexibility.
 *
 * @module @omnitron/prism/theme/colors/base
 */

import type { ColorScale } from '../../types/theme.js';

// =============================================================================
// NEUTRAL COLORS
// =============================================================================

/**
 * Grey scale - neutral foundation.
 */
export const grey: ColorScale = {
  50: '#F7FAFC',
  100: '#EBF2F5',
  200: '#DBE6EB',
  300: '#C3D3DB',
  400: '#9CAEB8',
  500: '#77878F',
  600: '#4D595E',
  700: '#262D30',
  800: '#1B2124',
  900: '#111417',
  950: '#06080A',
};

// =============================================================================
// PRIMARY COLORS
// =============================================================================

/**
 * Blue - default primary.
 */
export const blue: ColorScale = {
  50: '#EAF3FD',
  100: '#C6DDFB',
  200: '#A1C7F8',
  300: '#7DB1F5',
  400: '#589BF3',
  500: '#3385F0',
  600: '#2B71CC',
  700: '#245DA8',
  800: '#1C4984',
  900: '#143560',
  950: '#0A1B30',
};

/**
 * Green - success/teal variant.
 */
export const green: ColorScale = {
  50: '#E6F5F0',
  100: '#BBE4D5',
  200: '#8ED3BA',
  300: '#62C29F',
  400: '#35B084',
  500: '#099F69',
  600: '#088759',
  700: '#066F49',
  800: '#05573A',
  900: '#04402A',
  950: '#022015',
};

/**
 * Purple - secondary.
 */
export const purple: ColorScale = {
  50: '#F2E4FE',
  100: '#E6CAFE',
  200: '#D6A8FD',
  300: '#C686FC',
  400: '#B663FB',
  500: '#A641FA',
  600: '#8D37D5',
  700: '#742DAF',
  800: '#5B2489',
  900: '#421A64',
  950: '#210D32',
};

// =============================================================================
// SEMANTIC COLORS
// =============================================================================

/**
 * Red - error/destructive.
 */
export const red: ColorScale = {
  50: '#F9E2E6',
  100: '#F2C1CA',
  200: '#E99AA8',
  300: '#E17286',
  400: '#D84A63',
  500: '#D02241',
  600: '#B11D37',
  700: '#91182D',
  800: '#721324',
  900: '#530E1A',
  950: '#3A0A12',
};

/**
 * Orange - warning.
 */
export const orange: ColorScale = {
  50: '#FEEFE1',
  100: '#FCDFC4',
  200: '#FBCB9D',
  300: '#F9B677',
  400: '#F8A250',
  500: '#F68D2A',
  600: '#D17824',
  700: '#AC631D',
  800: '#874E17',
  900: '#623811',
  950: '#372412',
};

/**
 * Light Blue - info.
 */
export const lightBlue: ColorScale = {
  50: '#E0F3FA',
  100: '#BCE6F4',
  200: '#90D6EC',
  300: '#64C6E5',
  400: '#39B6DD',
  500: '#0DA6D6',
  600: '#0B8DB6',
  700: '#097496',
  800: '#075B76',
  900: '#054256',
  950: '#03212B',
};

// =============================================================================
// BASIC COLORS
// =============================================================================

/**
 * Basic black and white.
 */
export const basic = {
  white: '#FFFFFF',
  black: '#000000',
} as const;

// =============================================================================
// EXPORTS
// =============================================================================

/**
 * All base color scales.
 */
export const baseColors = {
  grey,
  blue,
  green,
  purple,
  red,
  orange,
  lightBlue,
  basic,
} as const;
