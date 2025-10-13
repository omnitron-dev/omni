/**
 * Theme System
 *
 * Complete theming solution with:
 * - Theme definition
 * - CSS variable generation
 * - Theme provider and hooks
 */

// Theme definition
export {
  defineTheme,
  getToken,
  createDefaultLightTheme,
  createDefaultDarkTheme,
  type Theme,
  type ThemeConfig,
  type ColorTokens,
  type ColorScale,
  type TypographyTokens,
  type TypographyScale,
  type FontWeightScale,
  type SpacingTokens,
  type SizingTokens,
  type RadiusTokens,
  type ShadowTokens,
  type ZIndexTokens,
  type AnimationTokens,
  type BreakpointTokens,
} from './defineTheme.js';

// CSS variables
export {
  generateCSSVariables,
  generateScopedVariables,
  applyTheme,
  removeTheme,
  getCSSVariable,
  createThemeVars,
  generateThemeTypes,
  injectThemeCSS,
  removeThemeCSS,
} from './variables.js';

// Theme provider
export {
  ThemeProvider,
  useTheme,
  useThemeToken,
  useThemeVar,
  withTheme,
  createThemedComponent,
  useThemeToggle,
  ThemeContextSymbol,
  type ThemeContextType,
  type ThemeProviderProps,
} from './provider.js';

// Default exports
export { defineTheme as default } from './defineTheme.js';
