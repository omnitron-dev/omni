/**
 * Palette Builder
 *
 * Creates MUI-native palette structures with full channel support.
 * Designed for maximum integration with MUI's colorSchemes and CSS variables.
 *
 * Key MUI Integration Points:
 * - Uses MUI's PaletteOptions structure directly
 * - Generates channel values for use with `theme.vars.palette.*.mainChannel`
 * - Supports MUI's `applyStyles` for dark mode variants
 * - Works seamlessly with MUI's CSS variable system
 *
 * @module @omnitron/prism/theme/palette/builder
 */

import type { PaletteOptions } from '@mui/material/styles';
import type {
  ColorScale,
  PaletteColor,
  PaletteColorWithChannels,
  VibrantPalette,
  ChartPalette,
} from '../../types/theme.js';
import {
  hexToRgbChannel,
  generateColorScaleWithChannels,
  generatePaletteColorWithChannels,
  cssVarRgba,
} from '../utils/color.js';
import { grey as baseGrey, blue, green, purple, red, orange, lightBlue, basic } from '../colors/base.js';

// =============================================================================
// PALETTE COLOR BUILDER
// =============================================================================

/**
 * Calculate relative luminance of a hex color.
 * Used for determining if text should be light or dark for contrast.
 */
function getLuminance(hex: string): number {
  const rgb = hex.replace('#', '').match(/.{2}/g);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const val = parseInt(c, 16) / 255;
    return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Get appropriate contrast text color for a background.
 * Uses luminance to determine if white or dark text provides better contrast.
 * Threshold of 0.4 ensures colored buttons get white text for better UX.
 */
function getContrastText(bgColor: string): string {
  const luminance = getLuminance(bgColor);
  // Threshold 0.179 is WCAG standard; 0.3 balances WCAG AA compliance
  // with UX preference for white text on colored buttons.
  // Colors brighter than 0.3 luminance (e.g. yellow, light orange) get dark text.
  return luminance < 0.3 ? '#FFFFFF' : '#212121';
}

/**
 * Build palette color from color scale.
 *
 * @param scale - 11-shade color scale
 * @param mode - Light or dark mode
 * @returns Palette color with channels
 */
export function buildPaletteColor(scale: ColorScale, mode: 'light' | 'dark' = 'light'): PaletteColorWithChannels {
  // Determine main color and calculate appropriate contrast text
  const mainColor = mode === 'dark' ? scale[400] : scale[500];
  const contrastText = getContrastText(mainColor);

  const color: PaletteColor =
    mode === 'dark'
      ? {
          lighter: scale[950],
          light: scale[700],
          main: mainColor,
          dark: scale[300],
          darker: scale[100],
          contrastText,
        }
      : {
          lighter: scale[50],
          light: scale[400],
          main: mainColor,
          dark: scale[600],
          darker: scale[900],
          contrastText,
        };

  return generatePaletteColorWithChannels(color);
}

// =============================================================================
// BACKGROUND BUILDER
// =============================================================================

export interface BackgroundColors {
  default: string;
  paper: string;
  neutral: string;
  elevation1: string;
  elevation2: string;
  elevation3: string;
  elevation4: string;
  menu: string;
  menuElevation1: string;
  menuElevation2: string;
}

/**
 * Build background palette from grey scale.
 *
 * @param grey - Grey color scale
 * @param mode - Light or dark mode
 * @returns Background colors
 */
export function buildBackground(grey: ColorScale, mode: 'light' | 'dark' = 'light'): BackgroundColors {
  if (mode === 'dark') {
    return {
      default: grey[950],
      paper: grey[900],
      neutral: grey[800],
      elevation1: grey[800],
      elevation2: grey[700],
      elevation3: grey[600],
      elevation4: grey[500],
      menu: grey[900],
      menuElevation1: grey[800],
      menuElevation2: grey[700],
    };
  }

  return {
    default: '#FFFFFF',
    paper: '#FFFFFF',
    neutral: grey[50],
    elevation1: grey[50],
    elevation2: grey[100],
    elevation3: grey[200],
    elevation4: grey[300],
    menu: '#FFFFFF',
    menuElevation1: grey[50],
    menuElevation2: grey[100],
  };
}

// =============================================================================
// TEXT BUILDER
// =============================================================================

export interface TextColors {
  primary: string;
  secondary: string;
  disabled: string;
  primaryChannel: string;
  secondaryChannel: string;
  disabledChannel: string;
}

/**
 * Build text colors from grey scale.
 *
 * @param grey - Grey color scale
 * @param mode - Light or dark mode
 * @returns Text colors with channels
 */
export function buildText(grey: ColorScale, mode: 'light' | 'dark' = 'light'): TextColors {
  const colors =
    mode === 'dark'
      ? {
          primary: grey[50],
          secondary: grey[300],
          disabled: grey[500],
        }
      : {
          primary: grey[900],
          secondary: grey[600],
          disabled: grey[400],
        };

  return {
    ...colors,
    primaryChannel: hexToRgbChannel(colors.primary),
    secondaryChannel: hexToRgbChannel(colors.secondary),
    disabledChannel: hexToRgbChannel(colors.disabled),
  };
}

// =============================================================================
// ACTION BUILDER
// =============================================================================

export interface ActionColors {
  active: string;
  hover: string;
  selected: string;
  disabled: string;
  disabledBackground: string;
  focus: string;
}

/**
 * Build action colors from grey scale.
 *
 * @param grey - Grey color scale
 * @param mode - Light or dark mode
 * @returns Action colors
 */
export function buildAction(grey: ColorScale, mode: 'light' | 'dark' = 'light'): ActionColors {
  if (mode === 'dark') {
    return {
      active: grey[400],
      hover: grey[700],
      selected: grey[700],
      disabled: grey[600],
      disabledBackground: grey[800],
      focus: grey[600],
    };
  }

  return {
    active: grey[500],
    hover: grey[100],
    selected: grey[100],
    disabled: grey[400],
    disabledBackground: grey[200],
    focus: grey[300],
  };
}

// =============================================================================
// VIBRANT BUILDER
// =============================================================================

/**
 * Build vibrant colors for overlays and glass effects.
 *
 * @param commonWhiteChannel - White color channel
 * @param textPrimary - Primary text color
 * @param mode - Light or dark mode
 * @returns Vibrant palette
 */
export function buildVibrant(
  commonWhiteChannel: string,
  textPrimary: string,
  mode: 'light' | 'dark' = 'light'
): VibrantPalette {
  const textChannel = hexToRgbChannel(textPrimary);

  return {
    listItemHover: cssVarRgba(commonWhiteChannel, mode === 'dark' ? 0.08 : 0.5),
    buttonHover: cssVarRgba(commonWhiteChannel, mode === 'dark' ? 0.12 : 0.7),
    textFieldHover: cssVarRgba(commonWhiteChannel, mode === 'dark' ? 0.12 : 0.7),
    text: {
      secondary: cssVarRgba(textChannel, 0.76),
      disabled: cssVarRgba(textChannel, 0.4),
    },
    overlay: cssVarRgba(commonWhiteChannel, mode === 'dark' ? 0.16 : 0.7),
  };
}

// =============================================================================
// CHART COLORS BUILDER
// =============================================================================

/**
 * Build chart color palette.
 *
 * @param options - Color scales for charts
 * @returns Chart palette
 */
export function buildChartColors(options: {
  grey: ColorScale;
  red: ColorScale;
  blue: ColorScale;
  green: ColorScale;
  orange: ColorScale;
  lightBlue: ColorScale;
  purple: ColorScale;
}): ChartPalette {
  return {
    chGrey: generateColorScaleWithChannels(options.grey),
    chRed: generateColorScaleWithChannels(options.red),
    chBlue: generateColorScaleWithChannels(options.blue),
    chGreen: generateColorScaleWithChannels(options.green),
    chOrange: generateColorScaleWithChannels(options.orange),
    chLightBlue: generateColorScaleWithChannels(options.lightBlue),
    chPurple: generateColorScaleWithChannels(options.purple),
  };
}

// =============================================================================
// FULL PALETTE BUILDER
// =============================================================================

export interface BuildPaletteOptions {
  /** Primary color scale */
  primary: ColorScale;
  /** Secondary color scale */
  secondary: ColorScale;
  /** Info color scale */
  info: ColorScale;
  /** Success color scale */
  success: ColorScale;
  /** Warning color scale */
  warning: ColorScale;
  /** Error color scale */
  error: ColorScale;
  /** Neutral/grey color scale */
  grey: ColorScale;
  /** Light or dark mode */
  mode: 'light' | 'dark';
  /** Custom background default color */
  backgroundDefault?: string;
  /** Custom paper color */
  paperColor?: string;
}

/**
 * Build complete MUI-compatible palette.
 *
 * @param options - Palette build options
 * @returns Complete MUI palette options
 */
export function buildPalette(options: BuildPaletteOptions): PaletteOptions {
  const { primary, secondary, info, success, warning, error, grey, mode, backgroundDefault, paperColor } = options;

  const greyWithChannels = generateColorScaleWithChannels(grey);
  const background = buildBackground(grey, mode);
  const text = buildText(grey, mode);
  const action = buildAction(grey, mode);

  // Override with custom colors if provided
  if (backgroundDefault) {
    background.default = backgroundDefault;
  }
  if (paperColor) {
    background.paper = paperColor;
    background.menu = paperColor;
  }

  const common = {
    black: basic.black,
    white: basic.white,
    blackChannel: hexToRgbChannel(basic.black),
    whiteChannel: hexToRgbChannel(basic.white),
  };

  const vibrant = buildVibrant(common.whiteChannel, text.primary, mode);

  const chart = buildChartColors({
    grey,
    red,
    blue,
    green,
    orange,
    lightBlue,
    purple,
  });

  // Dividers
  const divider = mode === 'dark' ? grey[700] : grey[300];
  const dividerLight = cssVarRgba(hexToRgbChannel(grey[mode === 'dark' ? 700 : 300]), 0.6);
  const menuDivider = cssVarRgba(hexToRgbChannel(grey[700]), 0);

  return {
    mode,
    common,
    grey: greyWithChannels,
    primary: buildPaletteColor(primary, mode),
    secondary: buildPaletteColor(secondary, mode),
    info: buildPaletteColor(info, mode),
    success: buildPaletteColor(success, mode),
    warning: buildPaletteColor(warning, mode),
    error: buildPaletteColor(error, mode),
    neutral: buildPaletteColor(grey, mode),
    background,
    text,
    action,
    divider,
    dividerLight,
    menuDivider,
    vibrant,
    chart,
  } as PaletteOptions;
}

// =============================================================================
// DEFAULT PALETTES
// =============================================================================

/**
 * Default light palette.
 */
export const defaultLightPalette = buildPalette({
  primary: blue,
  secondary: purple,
  info: lightBlue,
  success: green,
  warning: orange,
  error: red,
  grey: baseGrey,
  mode: 'light',
});

/**
 * Default dark palette.
 */
export const defaultDarkPalette = buildPalette({
  primary: blue,
  secondary: purple,
  info: lightBlue,
  success: green,
  warning: orange,
  error: red,
  grey: baseGrey,
  mode: 'dark',
});
