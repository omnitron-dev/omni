/**
 * Theme Type Definitions
 *
 * Enhanced theme types combining the best of Aurora and Prism architectures:
 * - Aurora: 11-shade color scales, elevation levels, channel generation, vibrant colors
 * - Prism: Density system, preset definitions, CSS variables integration
 *
 * @module @omnitron/prism/types/theme
 */

import type { Theme as MuiTheme, ThemeOptions as MuiThemeOptions } from '@mui/material/styles';

// =============================================================================
// PRESETS & MODES
// =============================================================================

/**
 * Available theme presets.
 * Light-optimized: default-light, luxury, retro, arctic, nature
 * Dark-optimized: default-dark, ember, dracula, midnight
 */
export type ThemePreset =
  | 'default-light'
  | 'default-dark'
  | 'luxury'
  | 'arctic'
  | 'nature'
  | 'ember'
  | 'dracula'
  | 'midnight'
  | 'retro'
  | 'minimal';

/**
 * Theme mode (light/dark/system).
 */
export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Text direction.
 */
export type ThemeDirection = 'ltr' | 'rtl';

/**
 * Component density.
 */
export type ComponentDensity = 'compact' | 'standard' | 'comfortable';

// =============================================================================
// COLOR SCALE (11 SHADES - AURORA PATTERN)
// =============================================================================

/**
 * Standard color shade keys (50-950).
 * Provides granular control for UI states and accessibility.
 */
export type ColorShadeKey = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;

/**
 * Full 11-shade color scale.
 */
export type ColorScale = Record<ColorShadeKey, string>;

/**
 * Color scale with computed RGB channel values for alpha compositing.
 * Each color gets a `${shade}Channel` variant (e.g., `500Channel: "51 102 255"`).
 */
export type ColorScaleWithChannels = ColorScale & {
  [K in ColorShadeKey as `${K}Channel`]: string;
};

// =============================================================================
// PALETTE COLORS
// =============================================================================

/**
 * Semantic palette color (primary, secondary, error, etc.).
 * Uses 5-shade semantic naming for convenience, mapped from 11-shade scale.
 */
export interface PaletteColor {
  /** Lightest shade (mapped from scale 50) */
  lighter: string;
  /** Light shade (mapped from scale 300-400) */
  light: string;
  /** Main shade (mapped from scale 500) */
  main: string;
  /** Dark shade (mapped from scale 600-700) */
  dark: string;
  /** Darkest shade (mapped from scale 900) */
  darker: string;
  /** Text color for contrast */
  contrastText: string;
}

/**
 * Palette color with channel values for alpha compositing.
 */
export interface PaletteColorWithChannels extends PaletteColor {
  lighterChannel: string;
  lightChannel: string;
  mainChannel: string;
  darkChannel: string;
  darkerChannel: string;
  contrastTextChannel: string;
}

// =============================================================================
// BACKGROUND & ELEVATION (AURORA PATTERN)
// =============================================================================

/**
 * Background configuration with elevation levels.
 * Elevation levels are crucial for proper card stacking and visual hierarchy.
 */
export interface BackgroundPalette {
  /** Default background (body) */
  default: string;
  /** Paper/card background */
  paper: string;
  /** Neutral background (subtle) */
  neutral: string;
  /** Elevation level 1 (e.g., cards) */
  elevation1: string;
  /** Elevation level 2 (e.g., dropdowns) */
  elevation2: string;
  /** Elevation level 3 (e.g., modals) */
  elevation3: string;
  /** Elevation level 4 (e.g., tooltips) */
  elevation4: string;
  /** Menu background */
  menu: string;
  /** Menu elevation 1 */
  menuElevation1: string;
  /** Menu elevation 2 */
  menuElevation2: string;
}

// =============================================================================
// TEXT & ACTION
// =============================================================================

/**
 * Text color configuration.
 */
export interface TextPalette {
  primary: string;
  secondary: string;
  disabled: string;
}

/**
 * Action state colors.
 */
export interface ActionPalette {
  active: string;
  hover: string;
  selected: string;
  disabled: string;
  disabledBackground: string;
  focus: string;
}

// =============================================================================
// VIBRANT COLORS (AURORA PATTERN)
// =============================================================================

/**
 * Vibrant/overlay colors for special UI states.
 */
export interface VibrantPalette {
  /** List item hover overlay */
  listItemHover: string;
  /** Button hover overlay */
  buttonHover: string;
  /** TextField hover overlay */
  textFieldHover: string;
  /** Text colors for vibrant backgrounds */
  text: {
    secondary: string;
    disabled: string;
  };
  /** General overlay */
  overlay: string;
}

// =============================================================================
// CHART COLORS (AURORA PATTERN)
// =============================================================================

/**
 * Chart/visualization color palette with full scales.
 * Prefixed with 'ch' (chart) to avoid conflicts with semantic colors.
 */
export interface ChartPalette {
  /** Grey scale for charts */
  chGrey: ColorScaleWithChannels;
  /** Red scale for charts */
  chRed: ColorScaleWithChannels;
  /** Blue scale for charts */
  chBlue: ColorScaleWithChannels;
  /** Green scale for charts */
  chGreen: ColorScaleWithChannels;
  /** Orange scale for charts */
  chOrange: ColorScaleWithChannels;
  /** Light blue scale for charts */
  chLightBlue: ColorScaleWithChannels;
  /** Purple scale for charts */
  chPurple: ColorScaleWithChannels;
}

// =============================================================================
// FULL PALETTE
// =============================================================================

/**
 * Grey scale configuration.
 */
export type GreyScale = Record<ColorShadeKey, string>;

/**
 * Common colors (black & white).
 */
export interface CommonColors {
  black: string;
  white: string;
}

/**
 * Full palette definition combining all color systems.
 */
export interface ThemePalette {
  // Semantic colors
  primary: PaletteColorWithChannels;
  secondary: PaletteColorWithChannels;
  info: PaletteColorWithChannels;
  success: PaletteColorWithChannels;
  warning: PaletteColorWithChannels;
  error: PaletteColorWithChannels;
  neutral: PaletteColorWithChannels;

  // Scales
  grey: ColorScaleWithChannels;
  common: CommonColors & { blackChannel: string; whiteChannel: string };

  // Backgrounds
  background: BackgroundPalette;

  // Text
  text: TextPalette & {
    primaryChannel: string;
    secondaryChannel: string;
    disabledChannel: string;
  };

  // Actions
  action: ActionPalette;

  // Dividers
  divider: string;
  dividerLight: string;
  menuDivider: string;

  // Vibrant (for glass/blur effects)
  vibrant: VibrantPalette;

  // Chart colors
  chart: ChartPalette;
}

// =============================================================================
// TYPOGRAPHY
// =============================================================================

/**
 * Typography configuration.
 */
export interface ThemeTypography {
  fontFamily: {
    primary: string;
    secondary?: string;
    mono?: string;
  };
  fontWeights: {
    light: number;
    regular: number;
    medium: number;
    semiBold: number;
    bold: number;
  };
}

// =============================================================================
// CSS VARIABLES
// =============================================================================

/**
 * CSS variables configuration.
 */
export interface CssVariablesConfig {
  /** Prefix for CSS variables (e.g., 'prism' -> '--prism-primary') */
  prefix: string;
  /** Attribute selector for color scheme (e.g., 'data-prism-color-scheme') */
  colorSchemeSelector: string;
  /** Whether to enable CSS variables */
  enabled: boolean;
}

// =============================================================================
// COMPONENT CONFIGURATION
// =============================================================================

/**
 * Components configuration.
 */
export interface ComponentsConfig {
  /** Component density */
  density: ComponentDensity;
  /** Default border radius in pixels */
  borderRadius: number;
  /** Button style */
  buttonStyle: 'contained' | 'outlined' | 'text';
}

// =============================================================================
// THEME CONFIGURATION
// =============================================================================

/**
 * Theme configuration options.
 */
export interface ThemeConfig {
  /** Theme preset */
  preset: ThemePreset;
  /** Color mode */
  mode: ThemeMode;
  /** Text direction */
  direction: ThemeDirection;
  /** Override primary color (hex) */
  primaryColor?: string | null;
  /** Typography settings */
  typography?: Partial<ThemeTypography>;
  /** CSS variables settings */
  cssVariables?: Partial<CssVariablesConfig>;
  /** Components settings */
  components?: Partial<ComponentsConfig>;
  /** Custom MUI theme overrides */
  overrides?: MuiThemeOptions;
}

// =============================================================================
// PRESET DEFINITION
// =============================================================================

/**
 * Color group for primary color override system.
 */
export interface ColorGroup {
  /** Unique key for the color group */
  key: string;
  /** Main color (hex) */
  main: string;
  /** Full color palette (optional) */
  palette?: ColorScale;
}

/**
 * Simple palette color (without channel values).
 * Used for preset definitions where channels are generated at runtime.
 */
export interface SimplePaletteColor {
  lighter: string;
  light: string;
  main: string;
  dark: string;
  darker: string;
  contrastText: string;
}

/**
 * Simple preset palette definition.
 * Channels and complex values are generated at runtime.
 */
export interface PresetPalette {
  primary: SimplePaletteColor;
  secondary: SimplePaletteColor;
  info: SimplePaletteColor;
  success: SimplePaletteColor;
  warning: SimplePaletteColor;
  error: SimplePaletteColor;
  neutral?: SimplePaletteColor;
  grey: Partial<Record<ColorShadeKey, string>>;
  common: CommonColors;
  background: {
    default: string;
    paper: string;
    neutral: string;
  };
  text: TextPalette;
  divider?: string;
}

/**
 * Theme preset definition.
 */
export interface ThemePresetDefinition {
  /** Preset identifier */
  name: ThemePreset;
  /** Human-readable name */
  displayName: string;
  /** Description */
  description: string;
  /** Color mode this preset is optimized for */
  preferredMode: ThemeMode;
  /** Palette for light mode (simple format, channels generated at runtime) */
  lightPalette?: PresetPalette;
  /** Palette for dark mode (simple format, channels generated at runtime) */
  darkPalette?: PresetPalette;
  /** Typography settings */
  typography: ThemeTypography;
  /** Color group for primary override matching */
  colorGroup: ColorGroup;
}

// =============================================================================
// PRISM THEME
// =============================================================================

/**
 * Extended MUI Theme with Prism additions.
 */
export interface PrismTheme extends MuiTheme {
  prism: {
    preset: ThemePreset;
    mode: ThemeMode;
    direction: ThemeDirection;
    density: ComponentDensity;
    cssVariables: CssVariablesConfig;
    /** Density-based spacing multiplier */
    densityMultiplier: number;
  };
}

// =============================================================================
// CONTEXT
// =============================================================================

/**
 * Theme context value.
 */
export interface ThemeContextValue {
  theme: PrismTheme;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  preset: ThemePreset;
  setPreset: (preset: ThemePreset) => void;
  direction: ThemeDirection;
  setDirection: (direction: ThemeDirection) => void;
  density: ComponentDensity;
  setDensity: (density: ComponentDensity) => void;
  primaryColor: string | null;
  setPrimaryColor: (color: string | null) => void;
}

// =============================================================================
// MODULE AUGMENTATION
// =============================================================================

declare module '@mui/material/styles' {
  interface Theme {
    prism: PrismTheme['prism'];
  }
  interface ThemeOptions {
    prism?: Partial<PrismTheme['prism']>;
  }
  interface Palette {
    neutral: PaletteColorWithChannels;
    vibrant: VibrantPalette;
    chart: ChartPalette;
    dividerLight: string;
    menuDivider: string;
  }
  interface PaletteOptions {
    neutral?: Partial<PaletteColorWithChannels>;
    vibrant?: Partial<VibrantPalette>;
    chart?: Partial<ChartPalette>;
    dividerLight?: string;
    menuDivider?: string;
  }
  interface TypeBackground {
    neutral: string;
    elevation1: string;
    elevation2: string;
    elevation3: string;
    elevation4: string;
    menu: string;
    menuElevation1: string;
    menuElevation2: string;
  }
}
