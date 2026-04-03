/**
 * Palette Utilities
 *
 * Utilities for palette manipulation and CSS channel generation.
 * All color math uses HSL for perceptually correct results.
 *
 * @module @omnitron/prism/theme/palette
 */

import type { ThemePalette, PaletteColor, ColorScale, ColorScaleWithChannels } from '../types/theme.js';
import {
  generatePaletteColorWithChannels,
  generateColorScaleWithChannels,
  hexToRgbChannel,
  lighten,
  darken,
} from './utils/color.js';

/**
 * Generate RGB channel string from hex color.
 *
 * @param hex - Hex color value
 * @returns RGB channel string (e.g., "255 255 255")
 */
export function generatePaletteChannel(hex: string): string {
  return hexToRgbChannel(hex);
}

/**
 * Generate a full palette color from a main color.
 * Uses HSL-based color math for perceptually correct shades.
 *
 * @param main - Main color hex value
 * @param contrastText - Contrast text color (default: white)
 * @returns Full palette color with all shades
 */
export function generatePaletteColor(main: string, contrastText = '#FFFFFF'): PaletteColor {
  // HSL lightness adjustments (percentage points)
  // These values produce visually balanced shade progressions
  return {
    lighter: lighten(main, 32), // +32 lightness points (very light, ~85-95% L)
    light: lighten(main, 16), // +16 lightness points (light, ~65-75% L)
    main, // Base color (typically ~45-55% L)
    dark: darken(main, 12), // -12 lightness points (dark, ~35-45% L)
    darker: darken(main, 28), // -28 lightness points (very dark, ~20-30% L)
    contrastText,
  };
}

/**
 * Apply primary color override to a palette.
 *
 * @param palette - Base palette
 * @param primaryColor - New primary color
 * @param mode - Theme mode (light/dark)
 * @returns Updated palette with new primary color
 */
export function applyPrimaryOverride(
  palette: ThemePalette,
  primaryColor: string,
  mode: 'light' | 'dark' = 'light'
): ThemePalette {
  const contrastText = mode === 'dark' ? '#FFFFFF' : '#FFFFFF';
  const basePrimary = generatePaletteColor(primaryColor, contrastText);
  const newPrimary = generatePaletteColorWithChannels(basePrimary);

  return {
    ...palette,
    primary: newPrimary,
  };
}

/**
 * Create grey palette.
 */
export function createGreyPalette(): ColorScaleWithChannels {
  const scale: ColorScale = {
    50: '#FAFAFA',
    100: '#F5F5F5',
    200: '#EEEEEE',
    300: '#E0E0E0',
    400: '#BDBDBD',
    500: '#9E9E9E',
    600: '#757575',
    700: '#616161',
    800: '#424242',
    900: '#212121',
    950: '#121212',
  };
  return generateColorScaleWithChannels(scale);
}

/**
 * Create dark mode grey palette.
 */
export function createDarkGreyPalette(): ColorScaleWithChannels {
  const scale: ColorScale = {
    50: '#1A1A1A',
    100: '#242424',
    200: '#2E2E2E',
    300: '#383838',
    400: '#454545',
    500: '#5C5C5C',
    600: '#757575',
    700: '#9E9E9E',
    800: '#BDBDBD',
    900: '#E0E0E0',
    950: '#F5F5F5',
  };
  return generateColorScaleWithChannels(scale);
}
