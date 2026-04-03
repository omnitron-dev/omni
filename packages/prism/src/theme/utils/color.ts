/**
 * Color Utilities
 *
 * Functions for color manipulation, channel generation, and palette creation.
 * Uses HSL-based color math for perceptually correct results.
 * Combines Aurora's sophisticated color system with Prism's extensibility.
 *
 * @module @omnitron-dev/prism/theme/utils/color
 */

import type {
  ColorScale,
  ColorScaleWithChannels,
  ColorShadeKey,
  PaletteColor,
  PaletteColorWithChannels,
} from '../../types/theme.js';

// =============================================================================
// COLOR CONVERSION
// =============================================================================

/**
 * Convert hex color to RGB values.
 *
 * @param hex - Hex color string (e.g., '#FF5630' or 'FF5630')
 * @returns RGB tuple [r, g, b]
 */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const expanded =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const bigint = parseInt(expanded, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return [r, g, b];
}

/**
 * Convert hex color to RGB channel string.
 *
 * @param hex - Hex color string
 * @returns RGB channel string (e.g., '255 86 48')
 */
export function hexToRgbChannel(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `${r} ${g} ${b}`;
}

/**
 * Convert RGB values to hex color.
 *
 * @param r - Red (0-255)
 * @param g - Green (0-255)
 * @param b - Blue (0-255)
 * @returns Hex color string (e.g., '#FF5630')
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const to2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`.toUpperCase();
}

/**
 * Convert hex to HSL values.
 *
 * @param hex - Hex color string
 * @returns HSL values { h: 0-360, s: 0-100, l: 0-100 }
 */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = hexToRgb(hex);
  const r1 = r / 255;
  const g1 = g / 255;
  const b1 = b / 255;
  const max = Math.max(r1, g1, b1);
  const min = Math.min(r1, g1, b1);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;

  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r1:
        h = (g1 - b1) / d + (g1 < b1 ? 6 : 0);
        break;
      case g1:
        h = (b1 - r1) / d + 2;
        break;
      default:
        h = (r1 - g1) / d + 4;
    }
    h /= 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

/**
 * Convert HSL values to hex color.
 *
 * @param h - Hue (0-360)
 * @param s - Saturation (0-100)
 * @param l - Lightness (0-100)
 * @returns Hex color string
 */
export function hslToHex(h: number, s: number, l: number): string {
  const s1 = s / 100;
  const l1 = l / 100;
  const c = (1 - Math.abs(2 * l1 - 1)) * s1;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l1 - c / 2;
  let r1: number;
  let g1: number;
  let b1: number;

  if (h >= 0 && h < 60) {
    [r1, g1, b1] = [c, x, 0];
  } else if (h >= 60 && h < 120) {
    [r1, g1, b1] = [x, c, 0];
  } else if (h >= 120 && h < 180) {
    [r1, g1, b1] = [0, c, x];
  } else if (h >= 180 && h < 240) {
    [r1, g1, b1] = [0, x, c];
  } else if (h >= 240 && h < 300) {
    [r1, g1, b1] = [x, 0, c];
  } else {
    [r1, g1, b1] = [c, 0, x];
  }

  return rgbToHex(Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255));
}

// =============================================================================
// RGBA UTILITIES
// =============================================================================

/**
 * Create CSS rgba() from hex color.
 *
 * @param color - Hex color string
 * @param alpha - Alpha value (0-1)
 * @returns CSS rgba string
 */
export function rgba(color: string, alpha: number): string {
  const [r, g, b] = hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Create CSS rgba() from RGB channel string.
 * Useful for CSS variable references.
 *
 * @param channel - RGB channel string (e.g., '255 86 48')
 * @param alpha - Alpha value (0-1)
 * @returns CSS rgba string using modern syntax
 */
export function cssVarRgba(channel: string, alpha: number): string {
  return `rgba(${channel} / ${alpha})`;
}

// =============================================================================
// CHANNEL GENERATION
// =============================================================================

/**
 * Generate palette color with channel values.
 *
 * @param color - Palette color object
 * @returns Palette color with channel values
 */
export function generatePaletteColorWithChannels(color: PaletteColor): PaletteColorWithChannels {
  return {
    ...color,
    lighterChannel: hexToRgbChannel(color.lighter),
    lightChannel: hexToRgbChannel(color.light),
    mainChannel: hexToRgbChannel(color.main),
    darkChannel: hexToRgbChannel(color.dark),
    darkerChannel: hexToRgbChannel(color.darker),
    contrastTextChannel: hexToRgbChannel(color.contrastText),
  };
}

/**
 * Generate color scale with channel values.
 *
 * @param scale - Color scale object
 * @returns Color scale with channel values
 */
export function generateColorScaleWithChannels(scale: ColorScale): ColorScaleWithChannels {
  const shadeKeys: ColorShadeKey[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
  const channels = {} as Record<`${ColorShadeKey}Channel`, string>;

  for (const key of shadeKeys) {
    const channelKey = `${key}Channel` as `${ColorShadeKey}Channel`;
    channels[channelKey] = hexToRgbChannel(scale[key]);
  }

  return { ...scale, ...channels };
}

// =============================================================================
// SHADE GENERATION
// =============================================================================

/**
 * Clamp a number between min and max.
 */
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Generate 11-shade color scale from a base color.
 * Uses HSL manipulation to create consistent, accessible shades.
 *
 * @param baseColor - Base hex color (typically the 500 shade)
 * @returns Full 11-shade color scale
 */
export function generateColorScale(baseColor: string): ColorScale {
  const base = hexToHsl(baseColor);

  const tones: Array<{ key: ColorShadeKey; lDelta: number }> = [
    { key: 50, lDelta: +40 },
    { key: 100, lDelta: +32 },
    { key: 200, lDelta: +24 },
    { key: 300, lDelta: +16 },
    { key: 400, lDelta: +8 },
    { key: 500, lDelta: 0 },
    { key: 600, lDelta: -8 },
    { key: 700, lDelta: -16 },
    { key: 800, lDelta: -24 },
    { key: 900, lDelta: -32 },
    { key: 950, lDelta: -40 },
  ];

  const scale = {} as ColorScale;

  for (const { key, lDelta } of tones) {
    const l = clamp(base.l + lDelta, 5, 95);
    scale[key] = hslToHex(base.h, base.s, l);
  }

  return scale;
}

/**
 * Generate primary color shades from a base color.
 * Alias for generateColorScale for compatibility with Aurora's naming.
 */
export const generatePrimaryShades = generateColorScale;

// =============================================================================
// PALETTE HELPERS
// =============================================================================

/**
 * Calculate relative luminance of a hex color for WCAG contrast calculations.
 */
function getLuminanceForContrast(hex: string): number {
  const rgb = hex.replace('#', '').match(/.{2}/g);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const val = parseInt(c, 16) / 255;
    return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Get appropriate contrast text color for WCAG AA compliance.
 * Uses luminance to determine if white or dark text provides better contrast.
 * Threshold of 0.4 ensures colored buttons get white text for better UX.
 */
function getContrastTextColor(bgColor: string): string {
  const luminance = getLuminanceForContrast(bgColor);
  // Higher threshold (0.4) ensures most colored backgrounds get white text
  // Only very bright colors like yellow/warning get dark text
  return luminance < 0.4 ? '#FFFFFF' : '#212121';
}

/**
 * Create semantic palette color from a color scale.
 * Maps 11-shade scale to 5-shade semantic naming.
 *
 * @param scale - Full color scale
 * @param mode - Light or dark mode
 * @returns Semantic palette color
 */
export function createPaletteColorFromScale(scale: ColorScale, mode: 'light' | 'dark' = 'light'): PaletteColor {
  const mainColor = mode === 'dark' ? scale[400] : scale[500];
  const contrastText = getContrastTextColor(mainColor);

  if (mode === 'dark') {
    return {
      lighter: scale[950],
      light: scale[700],
      main: mainColor,
      dark: scale[300],
      darker: scale[100],
      contrastText,
    };
  }

  return {
    lighter: scale[50],
    light: scale[400],
    main: mainColor,
    dark: scale[600],
    darker: scale[900],
    contrastText,
  };
}

/**
 * Create inverted color scale for dark mode.
 * Swaps light and dark shades for proper dark mode contrast.
 *
 * @param scale - Original color scale
 * @returns Inverted color scale
 */
export function invertColorScale(scale: ColorScale): ColorScale {
  return {
    50: scale[950],
    100: scale[800],
    200: scale[700],
    300: scale[600],
    400: scale[500],
    500: scale[400],
    600: scale[300],
    700: scale[200],
    800: scale[100],
    900: scale[50],
    950: '#FFFFFF',
  };
}

// =============================================================================
// CONTRAST UTILITIES
// =============================================================================

/**
 * Calculate relative luminance of a color.
 *
 * @param hex - Hex color string
 * @returns Relative luminance (0-1)
 */
export function getLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const sRgb = c / 255;
    return sRgb <= 0.03928 ? sRgb / 12.92 : Math.pow((sRgb + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Calculate contrast ratio between two colors.
 *
 * @param color1 - First hex color
 * @param color2 - Second hex color
 * @returns Contrast ratio (1-21)
 */
export function getContrastRatio(color1: string, color2: string): number {
  const l1 = getLuminance(color1);
  const l2 = getLuminance(color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Determine if a color is light or dark.
 *
 * @param hex - Hex color string
 * @returns True if color is light
 */
export function isLightColor(hex: string): boolean {
  return getLuminance(hex) > 0.5;
}

/**
 * Get optimal contrast text color for a background.
 *
 * @param background - Background hex color
 * @param lightText - Light text color (default: white)
 * @param darkText - Dark text color (default: black)
 * @returns Best contrast text color
 */
export function getContrastText(background: string, lightText = '#FFFFFF', darkText = '#000000'): string {
  return isLightColor(background) ? darkText : lightText;
}

// =============================================================================
// HSL-BASED COLOR MANIPULATION
// =============================================================================

/**
 * Lighten a color using HSL.
 * Preserves hue and saturation while increasing lightness.
 *
 * @param hex - Hex color string
 * @param amount - Amount to lighten (0-100 percentage points)
 * @returns Lightened hex color
 */
export function lighten(hex: string, amount: number): string {
  const hsl = hexToHsl(hex);
  const newL = clamp(hsl.l + amount, 0, 100);
  return hslToHex(hsl.h, hsl.s, newL);
}

/**
 * Darken a color using HSL.
 * Preserves hue and saturation while decreasing lightness.
 *
 * @param hex - Hex color string
 * @param amount - Amount to darken (0-100 percentage points)
 * @returns Darkened hex color
 */
export function darken(hex: string, amount: number): string {
  const hsl = hexToHsl(hex);
  const newL = clamp(hsl.l - amount, 0, 100);
  return hslToHex(hsl.h, hsl.s, newL);
}

/**
 * Saturate a color using HSL.
 *
 * @param hex - Hex color string
 * @param amount - Amount to increase saturation (0-100 percentage points)
 * @returns Saturated hex color
 */
export function saturate(hex: string, amount: number): string {
  const hsl = hexToHsl(hex);
  const newS = clamp(hsl.s + amount, 0, 100);
  return hslToHex(hsl.h, newS, hsl.l);
}

/**
 * Desaturate a color using HSL.
 *
 * @param hex - Hex color string
 * @param amount - Amount to decrease saturation (0-100 percentage points)
 * @returns Desaturated hex color
 */
export function desaturate(hex: string, amount: number): string {
  const hsl = hexToHsl(hex);
  const newS = clamp(hsl.s - amount, 0, 100);
  return hslToHex(hsl.h, newS, hsl.l);
}

/**
 * Adjust hue of a color.
 *
 * @param hex - Hex color string
 * @param degrees - Degrees to rotate hue (-360 to 360)
 * @returns Color with adjusted hue
 */
export function adjustHue(hex: string, degrees: number): string {
  const hsl = hexToHsl(hex);
  const newH = (hsl.h + degrees + 360) % 360;
  return hslToHex(newH, hsl.s, hsl.l);
}

/**
 * Mix two colors together.
 *
 * @param color1 - First hex color
 * @param color2 - Second hex color
 * @param weight - Weight of first color (0-1, default: 0.5)
 * @returns Mixed hex color
 */
export function mix(color1: string, color2: string, weight = 0.5): string {
  const [r1, g1, b1] = hexToRgb(color1);
  const [r2, g2, b2] = hexToRgb(color2);
  const w = clamp(weight, 0, 1);
  const newR = Math.round(r1 * w + r2 * (1 - w));
  const newG = Math.round(g1 * w + g2 * (1 - w));
  const newB = Math.round(b1 * w + b2 * (1 - w));
  return rgbToHex(newR, newG, newB);
}

// =============================================================================
// CSS VARIABLE ALPHA UTILITIES (Aurora pattern)
// =============================================================================

/**
 * Validate and normalize opacity value.
 *
 * @param opacity - Opacity value (number 0-1, percentage string, or CSS variable)
 * @param color - Color string for error messages
 * @returns Normalized opacity as percentage string
 * @throws Error if opacity is invalid
 */
function validateOpacity(opacity: string | number, color: string): string {
  const isCSSVar = (val: string) => val.includes('var(--');
  const isPercentage = (val: string) => val.trim().endsWith('%');

  const errors = {
    invalid: `[varAlpha]: Invalid opacity "${opacity}" for "${color}".`,
    range: 'Must be a number between 0 and 1 (e.g., 0.48).',
    format: 'Must be a percentage (e.g., "48%") or CSS variable (e.g., "var(--opacity)").',
  };

  if (typeof opacity === 'string') {
    // Already a percentage - return as-is
    if (isPercentage(opacity)) return opacity;

    // CSS variable - wrap in calc to convert to percentage
    if (isCSSVar(opacity)) return `calc(${opacity} * 100%)`;

    // Try parsing as a number string
    const parsed = parseFloat(opacity.trim());
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      return `${Number((parsed * 100).toFixed(2))}%`;
    }

    throw new Error(`${errors.invalid} ${errors.format}`);
  }

  if (typeof opacity === 'number') {
    if (opacity >= 0 && opacity <= 1) {
      return `${Number((opacity * 100).toFixed(2))}%`;
    }
    throw new Error(`${errors.invalid} ${errors.range}`);
  }

  throw new Error(`${errors.invalid}`);
}

/**
 * Create CSS rgba() using a CSS variable channel.
 * Essential for dynamic alpha with CSS custom properties.
 *
 * Supports:
 * - RGB channel strings: "200 250 214"
 * - CSS variables: "var(--palette-primary-mainChannel)"
 * - currentColor (via color-mix)
 *
 * Does NOT support (will throw):
 * - Hex colors: "#00B8D9"
 * - RGB: "rgb(0, 184, 217)"
 * - RGBA: "rgba(0, 184, 217, 1)"
 *
 * @example
 * ```tsx
 * // With CSS variable channel
 * varAlpha('var(--palette-primary-mainChannel)', 0.5)
 * // Returns: "rgba(var(--palette-primary-mainChannel) / 50%)"
 *
 * // With RGB channel string
 * varAlpha('200 250 214', 0.8)
 * // Returns: "rgba(200 250 214 / 80%)"
 *
 * // With percentage opacity
 * varAlpha('var(--palette-primary-mainChannel)', '50%')
 * // Returns: "rgba(var(--palette-primary-mainChannel) / 50%)"
 *
 * // With CSS variable opacity
 * varAlpha('var(--palette-primary-mainChannel)', 'var(--opacity)')
 * // Returns: "rgba(var(--palette-primary-mainChannel) / calc(var(--opacity) * 100%))"
 *
 * // With currentColor
 * varAlpha('currentColor', 0.5)
 * // Returns: "color-mix(in srgb, currentColor 50%, transparent)"
 * ```
 *
 * @param color - CSS variable reference for the RGB channel, RGB channel string, or 'currentColor'
 * @param opacity - Alpha value (0-1 number, percentage string, or CSS variable)
 * @returns CSS rgba/color-mix string
 * @throws Error if color format is unsupported or opacity is invalid
 */
export function varAlpha(color: string, opacity: string | number = 1): string {
  // Validate color input
  if (!color?.trim()) {
    throw new Error('[varAlpha]: Color is undefined or empty!');
  }

  // Check for unsupported color formats
  const isUnsupported =
    color.startsWith('#') ||
    color.startsWith('rgb(') ||
    color.startsWith('rgba(') ||
    (!color.includes('var') && color.includes('Channel'));

  if (isUnsupported) {
    throw new Error(
      [
        `[varAlpha]: Unsupported color format "${color}"`,
        '✅ Supported formats:',
        '  - RGB channels: "0 184 217"',
        '  - CSS variables: "var(--palette-primary-mainChannel)"',
        '  - currentColor',
        '❌ Unsupported formats:',
        '  - Hex: "#00B8D9"',
        '  - RGB: "rgb(0, 184, 217)"',
        '  - RGBA: "rgba(0, 184, 217, 1)"',
      ].join('\n')
    );
  }

  // Validate and normalize opacity
  const alpha = validateOpacity(opacity, color);

  // Handle currentColor specially using color-mix
  if (color.toLowerCase() === 'currentcolor') {
    return `color-mix(in srgb, currentColor ${alpha}, transparent)`;
  }

  return `rgba(${color} / ${alpha})`;
}

/**
 * Create palette channel CSS variables object.
 * Maps semantic color keys to CSS variable references.
 *
 * @param prefix - CSS variable prefix (e.g., '--palette-primary')
 * @returns Object with channel variable references
 */
export function createPaletteChannelVars(prefix: string): Record<string, string> {
  return {
    lighterChannel: `var(${prefix}-lighterChannel)`,
    lightChannel: `var(${prefix}-lightChannel)`,
    mainChannel: `var(${prefix}-mainChannel)`,
    darkChannel: `var(${prefix}-darkChannel)`,
    darkerChannel: `var(${prefix}-darkerChannel)`,
    contrastTextChannel: `var(${prefix}-contrastTextChannel)`,
  };
}

// =============================================================================
// CSS VARIABLE UTILITIES
// =============================================================================

/**
 * Parse CSS variable name from a var() expression.
 *
 * @param cssVar - CSS var() expression (e.g., 'var(--prism-primary-main)' or '--prism-primary-main')
 * @returns Variable name without -- prefix, or null if invalid
 *
 * @example
 * ```ts
 * parseCssVar('var(--prism-primary-main)') // 'prism-primary-main'
 * parseCssVar('var(--color, #fff)')        // 'color'
 * parseCssVar('--my-variable')             // 'my-variable'
 * parseCssVar('invalid')                   // null
 * ```
 */
export function parseCssVar(cssVar: string): string | null {
  if (!cssVar) return null;

  // Handle var(--name) or var(--name, fallback) format
  const varMatch = cssVar.match(/var\(\s*--([^,)]+)\s*(?:,\s*[^)]*)?\)/);
  if (varMatch) {
    return varMatch[1].trim();
  }

  // Handle --name format (direct CSS variable name)
  if (cssVar.startsWith('--')) {
    return cssVar.slice(2);
  }

  return null;
}

/**
 * Check if a value is a CSS variable expression.
 *
 * @param value - Value to check
 * @returns True if value is a var() expression or --variable
 */
export function isCssVar(value: string): boolean {
  return value.startsWith('var(') || value.startsWith('--');
}

/**
 * Extract all CSS variables from a theme.vars object path.
 *
 * @param varsPath - Dot-separated path to CSS variables (e.g., 'palette.primary')
 * @param vars - Theme vars object (from theme.vars)
 * @returns Object with variable names as keys and CSS var expressions as values
 *
 * @example
 * ```ts
 * const vars = extractCssVars('palette.primary', theme.vars);
 * // { main: 'var(--prism-palette-primary-main)', light: '...', dark: '...' }
 * ```
 */
export function extractCssVars(varsPath: string, vars: Record<string, unknown>): Record<string, string> {
  const parts = varsPath.split('.');
  let current: Record<string, unknown> = vars;

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part] as Record<string, unknown>;
    } else {
      return {};
    }
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(current)) {
    if (typeof value === 'string' && isCssVar(value)) {
      result[key] = value;
    }
  }
  return result;
}
