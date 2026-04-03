/**
 * Typography System
 *
 * Typography configuration for Prism themes.
 *
 * @module @omnitron-dev/prism/theme/typography
 */

import type { ThemeOptions } from '@mui/material/styles';
import type { ThemeTypography } from '../types/theme.js';

/** MUI Typography options type */
type TypographyOptions = NonNullable<ThemeOptions['typography']>;

/**
 * Default typography configuration.
 */
export const typography: ThemeTypography = {
  fontFamily: {
    primary: '"Nunito Sans Variable", "Nunito Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    secondary: '"Exo 2", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: '"JetBrains Mono", "Fira Code", Consolas, Monaco, monospace',
  },
  fontWeights: {
    light: 300,
    regular: 400,
    medium: 500,
    semiBold: 600,
    bold: 700,
  },
};

/**
 * Font size scale (in rem).
 */
const fontSizes = {
  xs: '0.75rem', // 12px
  sm: '0.875rem', // 14px
  md: '1rem', // 16px
  lg: '1.125rem', // 18px
  xl: '1.25rem', // 20px
  '2xl': '1.5rem', // 24px
  '3xl': '1.875rem', // 30px
  '4xl': '2.25rem', // 36px
  '5xl': '3rem', // 48px
  '6xl': '3.75rem', // 60px
};

/**
 * Line height scale.
 */
const lineHeights = {
  tight: 1.25,
  snug: 1.375,
  normal: 1.5,
  relaxed: 1.625,
  loose: 2,
};

/**
 * Create MUI typography options from Prism typography config.
 *
 * @param config - Typography configuration
 * @returns MUI typography options
 */
export function createTypography(config: ThemeTypography): TypographyOptions {
  const { fontFamily, fontWeights } = config;

  return {
    fontFamily: fontFamily.primary,
    fontWeightLight: fontWeights.light,
    fontWeightRegular: fontWeights.regular,
    fontWeightMedium: fontWeights.medium,
    fontWeightBold: fontWeights.bold,

    // Headings
    h1: {
      fontFamily: fontFamily.secondary || fontFamily.primary,
      fontWeight: fontWeights.bold,
      fontSize: fontSizes['5xl'],
      lineHeight: lineHeights.tight,
      letterSpacing: '-0.025em',
    },
    h2: {
      fontFamily: fontFamily.secondary || fontFamily.primary,
      fontWeight: fontWeights.bold,
      fontSize: fontSizes['4xl'],
      lineHeight: lineHeights.tight,
      letterSpacing: '-0.025em',
    },
    h3: {
      fontFamily: fontFamily.secondary || fontFamily.primary,
      fontWeight: fontWeights.semiBold,
      fontSize: fontSizes['3xl'],
      lineHeight: lineHeights.snug,
      letterSpacing: '-0.02em',
    },
    h4: {
      fontFamily: fontFamily.secondary || fontFamily.primary,
      fontWeight: fontWeights.semiBold,
      fontSize: fontSizes['2xl'],
      lineHeight: lineHeights.snug,
      letterSpacing: '-0.02em',
    },
    h5: {
      fontFamily: fontFamily.secondary || fontFamily.primary,
      fontWeight: fontWeights.semiBold,
      fontSize: fontSizes.xl,
      lineHeight: lineHeights.snug,
    },
    h6: {
      fontFamily: fontFamily.secondary || fontFamily.primary,
      fontWeight: fontWeights.semiBold,
      fontSize: fontSizes.lg,
      lineHeight: lineHeights.snug,
    },

    // Body text
    body1: {
      fontSize: fontSizes.md,
      lineHeight: lineHeights.relaxed,
    },
    body2: {
      fontSize: fontSizes.sm,
      lineHeight: lineHeights.relaxed,
    },

    // Subtitles
    subtitle1: {
      fontSize: fontSizes.md,
      fontWeight: fontWeights.medium,
      lineHeight: lineHeights.normal,
    },
    subtitle2: {
      fontSize: fontSizes.sm,
      fontWeight: fontWeights.medium,
      lineHeight: lineHeights.normal,
    },

    // Captions and overlines
    caption: {
      fontSize: fontSizes.xs,
      lineHeight: lineHeights.normal,
    },
    overline: {
      fontSize: fontSizes.xs,
      fontWeight: fontWeights.semiBold,
      lineHeight: lineHeights.normal,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
    },

    // Buttons
    button: {
      fontSize: fontSizes.sm,
      fontWeight: fontWeights.semiBold,
      lineHeight: lineHeights.normal,
      textTransform: 'none',
    },
  };
}
