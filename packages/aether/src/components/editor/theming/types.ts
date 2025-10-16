/**
 * Theme System Type Definitions
 * Comprehensive type system for editor theming
 */

/**
 * Color palette for the theme
 */
export interface ThemeColorPalette {
  // Primary colors
  primary: string;
  primaryHover: string;
  primaryActive: string;
  primaryDisabled: string;

  // Secondary colors
  secondary: string;
  secondaryHover: string;
  secondaryActive: string;

  // Surface colors
  surface: string;
  surfaceHover: string;
  surfaceActive: string;
  surfaceRaised: string;
  surfaceOverlay: string;

  // Background colors
  background: string;
  backgroundAlt: string;

  // Text colors
  text: string;
  textSecondary: string;
  textTertiary: string;
  textDisabled: string;
  textInverse: string;

  // Border colors
  border: string;
  borderHover: string;
  borderFocus: string;
  borderDivider: string;

  // Semantic colors
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  error: string;
  errorBg: string;
  info: string;
  infoBg: string;

  // Special colors
  selection: string;
  selectionBg: string;
  highlight: string;
  highlightBg: string;
  focus: string;
  focusRing: string;

  // Code colors
  codeBackground: string;
  codeBorder: string;
  codeText: string;
  codeKeyword: string;
  codeString: string;
  codeComment: string;
  codeNumber: string;
  codeOperator: string;
}

/**
 * Typography configuration
 */
export interface ThemeTypography {
  // Font families
  fontFamily: string;
  fontFamilyMono: string;
  fontFamilyHeading: string;

  // Font sizes
  fontSizeXs: string;
  fontSizeSm: string;
  fontSizeBase: string;
  fontSizeMd: string;
  fontSizeLg: string;
  fontSizeXl: string;
  fontSize2xl: string;
  fontSize3xl: string;

  // Font weights
  fontWeightNormal: string;
  fontWeightMedium: string;
  fontWeightSemibold: string;
  fontWeightBold: string;

  // Line heights
  lineHeightTight: string;
  lineHeightBase: string;
  lineHeightRelaxed: string;

  // Letter spacing
  letterSpacingTight: string;
  letterSpacingNormal: string;
  letterSpacingWide: string;
}

/**
 * Spacing system
 */
export interface ThemeSpacing {
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  '2xl': string;
  '3xl': string;
  '4xl': string;
}

/**
 * Border radius values
 */
export interface ThemeBorderRadius {
  none: string;
  sm: string;
  base: string;
  md: string;
  lg: string;
  xl: string;
  full: string;
}

/**
 * Shadow definitions
 */
export interface ThemeShadows {
  none: string;
  xs: string;
  sm: string;
  base: string;
  md: string;
  lg: string;
  xl: string;
  '2xl': string;
  inner: string;
}

/**
 * Z-index scale
 */
export interface ThemeZIndex {
  base: number;
  dropdown: number;
  sticky: number;
  fixed: number;
  modal: number;
  popover: number;
  tooltip: number;
  toast: number;
}

/**
 * Animation configuration
 */
export interface ThemeAnimation {
  // Durations
  durationFast: string;
  durationBase: string;
  durationSlow: string;

  // Easings
  easingLinear: string;
  easingIn: string;
  easingOut: string;
  easingInOut: string;
  easingSharp: string;
}

/**
 * Breakpoints for responsive design
 */
export interface ThemeBreakpoints {
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  '2xl': string;
}

/**
 * Theme metadata
 */
export interface ThemeMetadata {
  name: string;
  displayName: string;
  author: string;
  version: string;
  description: string;
  isDark: boolean;
  isHighContrast: boolean;
}

/**
 * Complete theme definition
 */
export interface Theme {
  metadata: ThemeMetadata;
  colors: ThemeColorPalette;
  typography: ThemeTypography;
  spacing: ThemeSpacing;
  borderRadius: ThemeBorderRadius;
  shadows: ThemeShadows;
  zIndex: ThemeZIndex;
  animation: ThemeAnimation;
  breakpoints: ThemeBreakpoints;
}

/**
 * Theme configuration options
 */
export interface ThemeConfig {
  // Default theme to use
  defaultTheme: string;

  // Enable automatic dark mode detection
  autoDarkMode: boolean;

  // Enable theme persistence
  persist: boolean;

  // Storage key for persistence
  storageKey: string;

  // Enable theme transitions
  enableTransitions: boolean;

  // Transition duration (ms)
  transitionDuration: number;
}

/**
 * Theme change event
 */
export interface ThemeChangeEvent {
  from: string | null;
  to: string;
  theme: Theme;
  timestamp: number;
}

/**
 * CSS custom property map
 */
export type CSSCustomProperties = Record<string, string | number>;

/**
 * Theme validation result
 */
export interface ThemeValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Color contrast check result
 */
export interface ContrastCheckResult {
  ratio: number;
  passes: {
    aa: boolean;
    aaa: boolean;
    aaLarge: boolean;
    aaaLarge: boolean;
  };
}

/**
 * Theme preview configuration
 */
export interface ThemePreview {
  id: string;
  name: string;
  thumbnail?: string;
  colors: {
    primary: string;
    background: string;
    text: string;
    border: string;
  };
}
