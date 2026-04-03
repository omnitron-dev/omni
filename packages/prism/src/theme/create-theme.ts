/**
 * Theme Factory
 *
 * Creates MUI themes with full Prism integration.
 * Uses MUI's native colorSchemes for automatic light/dark mode.
 *
 * Key Features:
 * - Native MUI colorSchemes integration (automatic dark/light switching)
 * - CSS variables with configurable prefix and `theme.vars.palette.*` access
 * - Density-based component sizing (compact/standard/comfortable)
 * - Runtime primary color override system
 * - Full TypeScript inference
 * - Tree-shakeable component overrides
 *
 * @module @omnitron-dev/prism/theme/create-theme
 */

import { createTheme as muiCreateTheme, responsiveFontSizes } from '@mui/material/styles';
import * as locales from '@mui/material/locale';
import type { PaletteOptions, ThemeOptions } from '@mui/material/styles';
import type {
  ThemePreset,
  ThemeMode,
  ThemeDirection,
  ComponentDensity,
  CssVariablesConfig,
  ComponentsConfig,
  PrismTheme,
  ColorGroup,
} from '../types/theme.js';
import { buildPalette, defaultLightPalette, defaultDarkPalette } from './palette/builder.js';
import { componentOverrides } from './components/index.js';
import { createShadows } from './shadows.js';
import { createTypography, typography } from './typography.js';
import { mixins } from './mixins.js';
import { generateColorScale, generatePaletteColorWithChannels } from './utils/color.js';
import { blue, purple, green, red, orange, lightBlue, grey as baseGrey } from './colors/base.js';
import {
  luxuryPrimary,
  luxurySecondary,
  luxuryNeutral,
  luxuryError,
  luxuryWarning,
  luxurySuccess,
  luxuryInfo,
} from './colors/luxury.js';
// Preset color scales
import { draculaPurple, draculaPink, draculaCyan } from './presets/dracula.js';
import { emberPrimary, emberSecondary } from './presets/ember.js';
import { midnightIndigo, midnightBackground } from './presets/midnight.js';
import { retroAmber, retroTeal } from './presets/retro.js';
import { minimalNeutral, minimalAccent } from './presets/minimal.js';
import { arcticPreset } from './presets/arctic.js';

// =============================================================================
// TYPES
// =============================================================================

export type SupportedLocale = keyof typeof locales;

/**
 * Options for creating a Prism theme.
 *
 * @example
 * ```tsx
 * // Minimal configuration
 * const theme = createPrismTheme();
 *
 * // Full configuration
 * const theme = createPrismTheme({
 *   preset: 'luxury',
 *   mode: 'dark',
 *   primaryColor: '#FF5630',
 *   density: 'compact',
 *   locale: 'ruRU',
 *   direction: 'ltr',
 *   cssVarPrefix: 'myapp',
 *   borderRadius: 12,
 *   responsiveFonts: true,
 * });
 * ```
 */
export interface CreatePrismThemeOptions {
  /** Theme preset (default: 'default-light') */
  preset?: ThemePreset;
  /** Light/dark/system mode (default: 'light') */
  mode?: ThemeMode;
  /** Text direction (default: 'ltr') */
  direction?: ThemeDirection;
  /** MUI locale for i18n (default: 'enUS') */
  locale?: SupportedLocale;
  /** Custom primary color override (hex, e.g., '#FF5630') */
  primaryColor?: string | null;
  /** CSS variable prefix (default: 'prism') */
  cssVarPrefix?: string;
  /** Component density (default: 'standard') */
  density?: ComponentDensity;
  /** Border radius in pixels (default: 8) */
  borderRadius?: number;
  /** Enable responsive font sizes (default: true) */
  responsiveFonts?: boolean;
  /** Custom MUI theme overrides */
  overrides?: Partial<ThemeOptions>;
  /** Typography configuration (optional override) */
  typography?: Partial<ThemeOptions['typography']>;
  /** CSS variables configuration (optional override) */
  cssVariables?: Partial<CssVariablesConfig>;
  /** Components configuration (optional override) */
  components?: Partial<ComponentsConfig>;
  /** Contrast mode: 'default' or 'high' (default: 'default') */
  contrast?: 'default' | 'high';
  /** Override primary font family */
  fontFamily?: string | null;
  /** Override base font size in px (12-20, default: 16) */
  fontSize?: number;
}

// =============================================================================
// PRESET CONFIGURATIONS
// =============================================================================

interface PresetConfig {
  lightPalette: PaletteOptions;
  darkPalette: PaletteOptions;
  colorGroup: ColorGroup;
}

/**
 * Get preset configuration.
 * Each preset defines light and dark palettes plus a color group for matching.
 */
function getPresetConfig(preset: ThemePreset): PresetConfig {
  switch (preset) {
    case 'luxury':
      return {
        lightPalette: buildPalette({
          primary: luxuryPrimary,
          secondary: luxurySecondary,
          info: luxuryInfo,
          success: luxurySuccess,
          warning: luxuryWarning,
          error: luxuryError,
          grey: luxuryNeutral,
          mode: 'light',
          backgroundDefault: '#FAF7F5',
          paperColor: '#FDFBFB',
        }),
        darkPalette: buildPalette({
          primary: luxuryPrimary,
          secondary: luxurySecondary,
          info: luxuryInfo,
          success: luxurySuccess,
          warning: luxuryWarning,
          error: luxuryError,
          grey: luxuryNeutral,
          mode: 'dark',
        }),
        colorGroup: {
          key: 'luxury',
          main: luxuryPrimary[500],
          palette: luxuryPrimary,
        },
      };

    case 'arctic':
      // Arctic has full palettes defined in the preset file
      return {
        lightPalette: buildPaletteFromPreset(arcticPreset.lightPalette!, 'light'),
        darkPalette: buildPaletteFromPreset(arcticPreset.darkPalette!, 'dark'),
        colorGroup: {
          key: 'arctic',
          main: '#1E88E5',
          palette: blue, // Use blue as base for color group
        },
      };

    case 'dracula':
      // Dark-only theme with purple/pink/cyan accents
      return {
        lightPalette: buildPalette({
          primary: draculaPurple,
          secondary: draculaPink,
          info: draculaCyan,
          success: green,
          warning: orange,
          error: red,
          grey: baseGrey,
          mode: 'light',
          backgroundDefault: '#F5F0FA',
          paperColor: '#FAF7FC',
        }),
        darkPalette: buildPalette({
          primary: draculaPurple,
          secondary: draculaPink,
          info: draculaCyan,
          success: green,
          warning: orange,
          error: red,
          grey: baseGrey,
          mode: 'dark',
          backgroundDefault: '#282A36', // Dracula background
          paperColor: '#21222C',
        }),
        colorGroup: {
          key: 'dracula',
          main: draculaPurple[500],
          palette: draculaPurple,
        },
      };

    case 'ember':
      // Warm, fiery theme with orange-red
      return {
        lightPalette: buildPalette({
          primary: emberPrimary,
          secondary: emberSecondary,
          info: lightBlue,
          success: green,
          warning: orange,
          error: emberSecondary,
          grey: baseGrey,
          mode: 'light',
          backgroundDefault: '#FFF5F0',
          paperColor: '#FFFAF7',
        }),
        darkPalette: buildPalette({
          primary: emberPrimary,
          secondary: emberSecondary,
          info: lightBlue,
          success: green,
          warning: orange,
          error: emberSecondary,
          grey: baseGrey,
          mode: 'dark',
          backgroundDefault: '#1A0A05',
          paperColor: '#2D1610',
        }),
        colorGroup: {
          key: 'ember',
          main: emberPrimary[500],
          palette: emberPrimary,
        },
      };

    case 'midnight':
      // Deep blue-black theme with indigo
      return {
        lightPalette: buildPalette({
          primary: midnightIndigo,
          secondary: purple,
          info: lightBlue,
          success: green,
          warning: orange,
          error: red,
          grey: midnightBackground,
          mode: 'light',
          backgroundDefault: '#F0F0F8',
          paperColor: '#F7F7FC',
        }),
        darkPalette: buildPalette({
          primary: midnightIndigo,
          secondary: purple,
          info: lightBlue,
          success: green,
          warning: orange,
          error: red,
          grey: midnightBackground,
          mode: 'dark',
          backgroundDefault: midnightBackground[950],
          paperColor: midnightBackground[900],
        }),
        colorGroup: {
          key: 'midnight',
          main: midnightIndigo[500],
          palette: midnightIndigo,
        },
      };

    case 'retro':
      // Nostalgic vintage theme with amber/teal
      return {
        lightPalette: buildPalette({
          primary: retroAmber,
          secondary: retroTeal,
          info: lightBlue,
          success: retroTeal,
          warning: retroAmber,
          error: red,
          grey: baseGrey,
          mode: 'light',
          backgroundDefault: '#F8F1E0',
          paperColor: '#FDF8EE',
        }),
        darkPalette: buildPalette({
          primary: retroAmber,
          secondary: retroTeal,
          info: lightBlue,
          success: retroTeal,
          warning: retroAmber,
          error: red,
          grey: baseGrey,
          mode: 'dark',
          backgroundDefault: '#1A1814',
          paperColor: '#252218',
        }),
        colorGroup: {
          key: 'retro',
          main: retroAmber[500],
          palette: retroAmber,
        },
      };

    case 'minimal':
      // Clean, minimalist theme with neutral grays
      return {
        lightPalette: buildPalette({
          primary: minimalAccent,
          secondary: minimalNeutral,
          info: lightBlue,
          success: green,
          warning: orange,
          error: red,
          grey: minimalNeutral,
          mode: 'light',
          backgroundDefault: '#FAFAFA',
          paperColor: '#FFFFFF',
        }),
        darkPalette: buildPalette({
          primary: minimalAccent,
          secondary: minimalNeutral,
          info: lightBlue,
          success: green,
          warning: orange,
          error: red,
          grey: minimalNeutral,
          mode: 'dark',
          backgroundDefault: '#0A0A0A',
          paperColor: '#171717',
        }),
        colorGroup: {
          key: 'minimal',
          main: minimalAccent[500],
          palette: minimalAccent,
        },
      };

    case 'nature':
      // Earthy green theme
      return {
        lightPalette: buildPalette({
          primary: green,
          secondary: purple,
          info: lightBlue,
          success: green,
          warning: orange,
          error: red,
          grey: baseGrey,
          mode: 'light',
          backgroundDefault: '#EEF6EE',
          paperColor: '#F5FAF5',
        }),
        darkPalette: buildPalette({
          primary: green,
          secondary: purple,
          info: lightBlue,
          success: green,
          warning: orange,
          error: red,
          grey: baseGrey,
          mode: 'dark',
          backgroundDefault: '#0A1A0A',
          paperColor: '#0F1F0F',
        }),
        colorGroup: {
          key: 'nature',
          main: green[500],
          palette: green,
        },
      };

    case 'default-dark':
      return {
        lightPalette: defaultLightPalette,
        darkPalette: defaultDarkPalette,
        colorGroup: {
          key: 'default-dark',
          main: blue[400],
          palette: blue,
        },
      };

    case 'default-light':
    default:
      return {
        lightPalette: defaultLightPalette,
        darkPalette: defaultDarkPalette,
        colorGroup: {
          key: 'default-light',
          main: blue[500],
          palette: blue,
        },
      };
  }
}

/**
 * Build palette from preset palette definition (for presets with full palette specs).
 */
function buildPaletteFromPreset(
  presetPalette: import('../types/theme.js').PresetPalette,
  mode: 'light' | 'dark'
): PaletteOptions {
  const grey = presetPalette.grey as import('../types/theme.js').ColorScale;

  return {
    mode,
    primary: generatePaletteColorWithChannels(presetPalette.primary),
    secondary: generatePaletteColorWithChannels(presetPalette.secondary),
    info: generatePaletteColorWithChannels(presetPalette.info),
    success: generatePaletteColorWithChannels(presetPalette.success),
    warning: generatePaletteColorWithChannels(presetPalette.warning),
    error: generatePaletteColorWithChannels(presetPalette.error),
    grey,
    common: presetPalette.common,
    background: presetPalette.background,
    text: presetPalette.text,
  };
}

// =============================================================================
// COLOR GROUPS FOR PRIMARY OVERRIDE
// =============================================================================

/**
 * Available color groups for primary color override.
 * When primaryColor matches a group's main color, we use that group's full palette
 * for proper shade generation in both light and dark modes.
 */
export const COLOR_GROUPS: ColorGroup[] = [
  // Default presets
  { key: 'default-light', main: blue[500], palette: blue },
  { key: 'default-dark', main: blue[400], palette: blue },
  // Base colors
  { key: 'green', main: green[500], palette: green },
  { key: 'purple', main: purple[500], palette: purple },
  { key: 'red', main: red[500], palette: red },
  { key: 'orange', main: orange[500], palette: orange },
  { key: 'lightBlue', main: lightBlue[500], palette: lightBlue },
  // Preset colors
  { key: 'luxury', main: luxuryPrimary[500], palette: luxuryPrimary },
  { key: 'dracula', main: draculaPurple[500], palette: draculaPurple },
  { key: 'ember', main: emberPrimary[500], palette: emberPrimary },
  { key: 'midnight', main: midnightIndigo[500], palette: midnightIndigo },
  { key: 'retro', main: retroAmber[500], palette: retroAmber },
  { key: 'minimal', main: minimalAccent[500], palette: minimalAccent },
  { key: 'nature', main: green[500], palette: green },
  { key: 'arctic', main: '#1E88E5', palette: blue },
];

// =============================================================================
// PRIMARY COLOR OVERRIDE
// =============================================================================

/**
 * Apply primary color override to palette.
 * Uses existing color group if exact match, otherwise generates new shades.
 */
function applyPrimaryOverride(
  basePalette: PaletteOptions,
  primaryColor: string | null | undefined,
  mode: 'light' | 'dark'
): PaletteOptions {
  if (!primaryColor) return basePalette;

  // Find matching color group for optimal shades
  const colorGroup = COLOR_GROUPS.find((group) => group.main === primaryColor);

  if (colorGroup?.palette) {
    // Use pre-defined palette for best results
    const newPrimary =
      mode === 'dark'
        ? generatePaletteColorWithChannels({
            lighter: colorGroup.palette[950],
            light: colorGroup.palette[700],
            main: primaryColor,
            dark: colorGroup.palette[300],
            darker: colorGroup.palette[100],
            contrastText: colorGroup.palette[950],
          })
        : generatePaletteColorWithChannels({
            lighter: colorGroup.palette[50],
            light: colorGroup.palette[400],
            main: primaryColor,
            dark: colorGroup.palette[600],
            darker: colorGroup.palette[900],
            contrastText: colorGroup.palette[50],
          });

    return { ...basePalette, primary: newPrimary };
  }

  // Generate new color scale from custom color
  const generatedScale = generateColorScale(primaryColor);
  const newPrimary =
    mode === 'dark'
      ? generatePaletteColorWithChannels({
          lighter: generatedScale[950],
          light: generatedScale[700],
          main: generatedScale[400],
          dark: generatedScale[300],
          darker: generatedScale[100],
          contrastText: generatedScale[950],
        })
      : generatePaletteColorWithChannels({
          lighter: generatedScale[50],
          light: generatedScale[400],
          main: generatedScale[500],
          dark: generatedScale[600],
          darker: generatedScale[900],
          contrastText: generatedScale[50],
        });

  return { ...basePalette, primary: newPrimary };
}

// =============================================================================
// DENSITY MULTIPLIER
// =============================================================================

/**
 * Get density multiplier for spacing calculations.
 * Used by component overrides to scale padding/margins.
 */
function getDensityMultiplier(density: ComponentDensity): number {
  switch (density) {
    case 'compact':
      return 0.75;
    case 'comfortable':
      return 1.25;
    case 'standard':
    default:
      return 1;
  }
}

// =============================================================================
// DEEP MERGE
// =============================================================================

/**
 * Deep merge two theme option objects.
 * Arrays are replaced, not concatenated. Functions are overwritten.
 * Preserves nested component overrides, palette, typography, etc.
 */
function deepMergeThemeOptions(base: ThemeOptions, overrides: Partial<ThemeOptions>): ThemeOptions {
  const result: Record<string, unknown> = { ...base };

  for (const key of Object.keys(overrides)) {
    const baseVal = (base as Record<string, unknown>)[key];
    const overrideVal = (overrides as Record<string, unknown>)[key];

    if (
      overrideVal !== null &&
      typeof overrideVal === 'object' &&
      !Array.isArray(overrideVal) &&
      typeof overrideVal !== 'function' &&
      baseVal !== null &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal) &&
      typeof baseVal !== 'function'
    ) {
      result[key] = deepMergeThemeOptions(baseVal as ThemeOptions, overrideVal as Partial<ThemeOptions>);
    } else {
      result[key] = overrideVal;
    }
  }

  return result as ThemeOptions;
}

// =============================================================================
// THEME FACTORY
// =============================================================================

/**
 * Create a Prism theme.
 *
 * This is the main entry point for creating themes. It uses MUI's native
 * colorSchemes for automatic light/dark mode switching, CSS variables
 * for dynamic theming, and includes all Prism extensions.
 *
 * @example
 * ```tsx
 * // Basic usage
 * const theme = createPrismTheme({ preset: 'luxury', mode: 'dark' });
 *
 * // With custom primary color
 * const theme = createPrismTheme({
 *   preset: 'default-light',
 *   primaryColor: '#FF5630',
 *   density: 'compact',
 * });
 *
 * // Use with MUI ThemeProvider
 * <ThemeProvider theme={theme}>
 *   <App />
 * </ThemeProvider>
 * ```
 *
 * @param options - Theme creation options
 * @returns MUI theme with Prism extensions
 */
export function createPrismTheme(options: CreatePrismThemeOptions = {}): PrismTheme {
  const {
    preset = 'default-light',
    mode = 'light',
    direction = 'ltr',
    locale = 'enUS',
    primaryColor = null,
    cssVarPrefix = 'prism',
    density = 'standard',
    borderRadius = 8,
    responsiveFonts = true,
    contrast = 'default',
    overrides,
  } = options;

  // Get preset configuration
  const presetConfig = getPresetConfig(preset);

  // Note: MUI 7 handles 'system' mode automatically via CSS media queries
  // No need to resolve mode here - CSS variables handle light/dark switching

  // Apply primary color override if provided
  let lightPalette = applyPrimaryOverride(presetConfig.lightPalette, primaryColor, 'light');
  let darkPalette = applyPrimaryOverride(presetConfig.darkPalette, primaryColor, 'dark');

  // Apply high contrast mode if enabled (increases background/paper contrast)
  if (contrast === 'high') {
    lightPalette = {
      ...lightPalette,
      background: {
        ...lightPalette.background,
        default: baseGrey[200],
        paper: '#FFFFFF',
      },
    };
    darkPalette = {
      ...darkPalette,
      background: {
        ...darkPalette.background,
        default: '#000000',
        paper: baseGrey[900],
      },
    };
  }

  // Get density multiplier
  const densityMultiplier = getDensityMultiplier(density);

  // Components configuration
  const componentsConfig: ComponentsConfig = {
    density,
    borderRadius,
    buttonStyle: 'contained',
  };

  // CSS variables configuration
  const cssVariablesConfig: CssVariablesConfig = {
    prefix: cssVarPrefix,
    colorSchemeSelector: `data-${cssVarPrefix}-color-scheme`,
    enabled: true,
  };

  // Build MUI locale
  const muiLocale = locales[locale] || locales.enUS;

  // Get shadows for light and dark modes
  const primaryMain = (lightPalette.primary as { main?: string })?.main || blue[500];
  const lightShadows = createShadows(primaryMain);
  // Dark mode uses subtle shadows with reduced opacity
  const darkShadows = createShadows(primaryMain, 0.4);

  // Resolve effective mode ('system' → actual light/dark)
  // Note: PrismProvider resolves 'system' before calling this, but handle fallback here
  const effectiveMode = mode === 'dark' ? 'dark' : 'light';

  // Select palette and shadows based on active mode
  const activePalette = effectiveMode === 'dark' ? darkPalette : lightPalette;
  const activeShadows = effectiveMode === 'dark' ? darkShadows : lightShadows;

  // Build base theme options
  const themeOptions: ThemeOptions = {
    // CSS Variables integration - enables theme.vars.palette.*
    cssVariables: {
      cssVarPrefix,
      colorSchemeSelector: cssVariablesConfig.colorSchemeSelector,
    },

    // Active palette based on resolved mode
    // PrismProvider recreates the theme on mode change, so we use the resolved palette directly
    palette: activePalette,

    // Active shadows based on resolved mode
    shadows: activeShadows,

    // Typography (uses Nunito Sans / Exo 2 defaults, overridable via options)
    typography: createTypography({
      fontFamily: {
        primary: options.fontFamily
          ? `"${options.fontFamily}", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
          : typography.fontFamily.primary,
        secondary: typography.fontFamily.secondary,
        mono: typography.fontFamily.mono,
      },
      fontWeights: typography.fontWeights,
    }),
    // Note: actual html font-size is set by PrismProvider via useEffect.
    // Do NOT set htmlFontSize here — MUI would compensate its rem values,
    // cancelling out the scaling effect we want.

    // Direction (RTL support)
    direction,

    // Shape
    shape: {
      borderRadius,
    },

    // Mixins
    mixins,

    // Component overrides with density support
    components: componentOverrides(componentsConfig),
  };

  // Deep merge with custom overrides (preserves nested component overrides)
  const finalOptions = overrides ? deepMergeThemeOptions(themeOptions, overrides) : themeOptions;

  // Create base theme
  let theme = muiCreateTheme(finalOptions, muiLocale);

  // Apply responsive font sizes
  if (responsiveFonts) {
    theme = responsiveFontSizes(theme);
  }

  // Add Prism metadata
  const prismTheme = theme as unknown as PrismTheme;
  prismTheme.prism = {
    preset,
    mode,
    direction,
    density,
    densityMultiplier,
    cssVariables: cssVariablesConfig,
  };

  return prismTheme;
}

// =============================================================================
// CONVENIENCE EXPORTS
// =============================================================================

/**
 * Available preset names.
 */
export const PRESET_NAMES: readonly ThemePreset[] = [
  'default-light',
  'default-dark',
  'luxury',
  'arctic',
  'nature',
  'ember',
  'dracula',
  'midnight',
  'retro',
  'minimal',
] as const;

/**
 * Preset display names for UI.
 */
export const PRESET_DISPLAY_NAMES: Record<ThemePreset, string> = {
  'default-light': 'Default (Light)',
  'default-dark': 'Default (Dark)',
  luxury: 'Luxury',
  arctic: 'Arctic',
  nature: 'Nature',
  ember: 'Ember',
  dracula: 'Dracula',
  midnight: 'Midnight',
  retro: 'Retro',
  minimal: 'Minimal',
};

/**
 * Inherent mode for each preset.
 * Non-default presets are inherently light or dark — selecting them forces the mode.
 * Default presets respect the user's light/dark/system toggle.
 */
export const PRESET_INHERENT_MODE: Record<ThemePreset, 'light' | 'dark'> = {
  'default-light': 'light',
  'default-dark': 'dark',
  luxury: 'light',
  arctic: 'light',
  nature: 'light',
  retro: 'light',
  minimal: 'light',
  ember: 'dark',
  dracula: 'dark',
  midnight: 'dark',
};

/**
 * Get preset display name.
 */
export function getPresetDisplayName(preset: ThemePreset): string {
  return PRESET_DISPLAY_NAMES[preset];
}

// Re-export types for convenience
export type { PrismTheme, ThemePreset, ThemeMode, ThemeDirection, ComponentDensity };
