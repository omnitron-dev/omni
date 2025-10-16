/**
 * Theme System Exports
 * Complete theming system for the Advanced Editor
 */

// Core theme manager
export { ThemeManager, getThemeManager, resetThemeManager } from './ThemeManager';

// Theme types
export type {
  Theme,
  ThemeMetadata,
  ThemeColorPalette,
  ThemeTypography,
  ThemeSpacing,
  ThemeBorderRadius,
  ThemeShadows,
  ThemeZIndex,
  ThemeAnimation,
  ThemeBreakpoints,
  ThemeConfig,
  ThemeChangeEvent,
  ThemeValidationResult,
  ContrastCheckResult,
  ThemePreview,
  CSSCustomProperties,
} from './types';

// Theme presets
export {
  defaultTheme,
  minimalTheme,
  githubTheme,
  darkTheme,
  highContrastTheme,
  allThemes,
  themeRegistry,
  getThemeByName,
  getThemeNames,
} from './presets';

// Theme picker component
export { ThemePicker, themePickerStyles } from './ThemePicker';
export type { ThemePickerProps } from './ThemePicker';
