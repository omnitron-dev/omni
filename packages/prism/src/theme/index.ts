/**
 * Prism Theme Module
 *
 * Theme system with presets, CSS variables, and MUI integration.
 * Uses MUI's native colorSchemes for automatic light/dark mode.
 *
 * @module @omnitron-dev/prism/theme
 */

// =============================================================================
// THEME FACTORY (Primary Export)
// =============================================================================

export {
  createPrismTheme,
  COLOR_GROUPS,
  PRESET_NAMES,
  PRESET_DISPLAY_NAMES,
  PRESET_INHERENT_MODE,
  getPresetDisplayName,
} from './create-theme.js';

export type { CreatePrismThemeOptions, SupportedLocale } from './create-theme.js';

// =============================================================================
// PALETTE SYSTEM
// =============================================================================

export {
  buildPalette,
  buildPaletteColor,
  buildBackground,
  buildText,
  buildAction,
  buildVibrant,
  buildChartColors,
  defaultLightPalette,
  defaultDarkPalette,
} from './palette/builder.js';

export type { BuildPaletteOptions, BackgroundColors, TextColors, ActionColors } from './palette/builder.js';

// Legacy palette utilities (for compatibility)
export { generatePaletteChannel, applyPrimaryOverride } from './palette.js';

// =============================================================================
// COLOR UTILITIES
// =============================================================================

export {
  hexToRgb,
  hexToRgbChannel,
  rgbToHex,
  hexToHsl,
  hslToHex,
  rgba,
  cssVarRgba,
  lighten,
  darken,
  mix,
  generateColorScale,
  generatePaletteColorWithChannels,
  generateColorScaleWithChannels,
  createPaletteColorFromScale,
  invertColorScale,
  getLuminance,
  getContrastRatio,
  isLightColor,
  getContrastText,
} from './utils/color.js';

// =============================================================================
// COLOR SCALES
// =============================================================================

export * from './colors/index.js';

// =============================================================================
// TYPOGRAPHY
// =============================================================================

export { typography, createTypography } from './typography.js';

// =============================================================================
// SHADOWS
// =============================================================================

export { shadows, darkShadow, createShadows } from './shadows.js';

// =============================================================================
// MIXINS
// =============================================================================

export {
  mixins,
  hideScrollbarMixin,
  customScrollbarMixin,
  textEllipsisMixin,
  multiLineEllipsisMixin,
  focusRingMixin,
  glassMixin,
} from './mixins.js';

// =============================================================================
// COMPONENT OVERRIDES
// =============================================================================

export { componentOverrides } from './components/index.js';
export { createButtonOverrides, createButtonBaseOverrides, createButtonGroupOverrides } from './components/Button.js';

// =============================================================================
// PRESETS (Legacy)
// =============================================================================

export { defaultPreset } from './presets/default.js';
export { luxuryPreset } from './presets/luxury.js';
export { arcticPreset } from './presets/arctic.js';
export { getPreset, presetNames } from './presets/index.js';

// =============================================================================
// CSS VARIABLES
// =============================================================================

export { cssVariables, generateCssVariables } from './css-variables.js';

// =============================================================================
// TYPE RE-EXPORTS
// =============================================================================

export type {
  PrismTheme,
  ThemePreset,
  ThemeMode,
  ThemeDirection,
  ComponentDensity,
  ColorScale,
  ColorShadeKey,
  ColorScaleWithChannels,
  PaletteColor,
  PaletteColorWithChannels,
  BackgroundPalette,
  VibrantPalette,
  ChartPalette,
  ComponentsConfig,
  CssVariablesConfig,
  ColorGroup,
} from '../types/theme.js';
