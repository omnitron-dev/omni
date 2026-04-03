/**
 * Luxury Preset Colors
 *
 * Rich, elegant color scales with gold/amber tones.
 *
 * @module @omnitron/prism/theme/colors/luxury
 */

import type { ColorScale } from '../../types/theme.js';

/**
 * Luxury Primary - Rich Gold/Amber.
 */
export const luxuryPrimary: ColorScale = {
  50: '#FBF7E8',
  100: '#F5EBC9',
  200: '#EDDFA8',
  300: '#E3D086',
  400: '#D9C164',
  500: '#C9A227',
  600: '#A88820',
  700: '#876D1A',
  800: '#665314',
  900: '#45380E',
  950: '#241D07',
};

/**
 * Luxury Secondary - Deep Purple.
 */
export const luxurySecondary: ColorScale = {
  50: '#F5EEF5',
  100: '#E8D5E8',
  200: '#D4B3D4',
  300: '#B38AB3',
  400: '#996399',
  500: '#6B3A6B',
  600: '#5A305A',
  700: '#4A284A',
  800: '#3A1F3A',
  900: '#2A172A',
  950: '#1A0F1A',
};

/**
 * Luxury Neutral - Warm Grey.
 */
export const luxuryNeutral: ColorScale = {
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
  950: '#100E0B',
};

/**
 * Luxury Error - Muted Red.
 */
export const luxuryError: ColorScale = {
  50: '#F9E8E8',
  100: '#F0C9C9',
  200: '#E4A3A3',
  300: '#D57C7C',
  400: '#C65656',
  500: '#B82E2E',
  600: '#9A2626',
  700: '#7D1E1E',
  800: '#5F1717',
  900: '#42100F',
  950: '#250908',
};

/**
 * Luxury Warning - Rich Amber.
 */
export const luxuryWarning: ColorScale = {
  50: '#FEF8E6',
  100: '#FCEFC2',
  200: '#F9E394',
  300: '#F5D566',
  400: '#F0C538',
  500: '#D4A012',
  600: '#B1850F',
  700: '#8E6B0C',
  800: '#6B5009',
  900: '#483606',
  950: '#251B03',
};

/**
 * Luxury Success - Forest Green.
 */
export const luxurySuccess: ColorScale = {
  50: '#E8F4E8',
  100: '#C9E4C9',
  200: '#A3D1A3',
  300: '#7DBD7D',
  400: '#56A956',
  500: '#2E8B2E',
  600: '#267426',
  700: '#1E5D1E',
  800: '#174717',
  900: '#0F300F',
  950: '#081A08',
};

/**
 * Luxury Info - Steel Blue.
 */
export const luxuryInfo: ColorScale = {
  50: '#E8F0F6',
  100: '#C9DCEB',
  200: '#A3C4DD',
  300: '#7DACCE',
  400: '#5694C0',
  500: '#2E7AB8',
  600: '#26669A',
  700: '#1E527C',
  800: '#173E5E',
  900: '#0F2A40',
  950: '#081520',
};

/**
 * All luxury colors.
 */
export const luxuryColors = {
  primary: luxuryPrimary,
  secondary: luxurySecondary,
  neutral: luxuryNeutral,
  error: luxuryError,
  warning: luxuryWarning,
  success: luxurySuccess,
  info: luxuryInfo,
} as const;
