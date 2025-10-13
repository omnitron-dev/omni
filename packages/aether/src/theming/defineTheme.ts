/**
 * Theme Definition System
 *
 * Comprehensive theme system with:
 * - Design token definitions (colors, typography, spacing)
 * - Theme inheritance
 * - Type-safe token access
 * - CSS variable generation
 */

/**
 * Color scale (50-950)
 */
export interface ColorScale {
  50?: string;
  100?: string;
  200?: string;
  300?: string;
  400?: string;
  500?: string;
  600?: string;
  700?: string;
  800?: string;
  900?: string;
  950?: string;
}

/**
 * Color tokens
 */
export interface ColorTokens {
  // Primary colors
  primary?: ColorScale | string;
  secondary?: ColorScale | string;
  accent?: ColorScale | string;

  // Semantic colors
  success?: ColorScale | string;
  warning?: ColorScale | string;
  error?: ColorScale | string;
  info?: ColorScale | string;

  // Neutral colors
  gray?: ColorScale;
  slate?: ColorScale;
  neutral?: ColorScale;

  // Background colors
  background?: {
    primary?: string;
    secondary?: string;
    tertiary?: string;
    inverse?: string;
  };

  // Surface colors
  surface?: {
    base?: string;
    raised?: string;
    overlay?: string;
  };

  // Text colors
  text?: {
    primary?: string;
    secondary?: string;
    tertiary?: string;
    inverse?: string;
    disabled?: string;
    link?: string;
    linkHover?: string;
  };

  // Border colors
  border?: {
    default?: string;
    muted?: string;
    strong?: string;
    focus?: string;
  };

  // Custom colors
  [key: string]: ColorScale | string | Record<string, string> | undefined;
}

/**
 * Typography scale
 */
export interface TypographyScale {
  xs?: string;
  sm?: string;
  base?: string;
  lg?: string;
  xl?: string;
  '2xl'?: string;
  '3xl'?: string;
  '4xl'?: string;
  '5xl'?: string;
  '6xl'?: string;
  '7xl'?: string;
  '8xl'?: string;
  '9xl'?: string;
}

/**
 * Font weight scale
 */
export interface FontWeightScale {
  thin?: number | string;
  extralight?: number | string;
  light?: number | string;
  normal?: number | string;
  medium?: number | string;
  semibold?: number | string;
  bold?: number | string;
  extrabold?: number | string;
  black?: number | string;
}

/**
 * Typography tokens
 */
export interface TypographyTokens {
  fontFamily?: {
    sans?: string;
    serif?: string;
    mono?: string;
    [key: string]: string | undefined;
  };

  fontSize?: TypographyScale;
  fontWeight?: FontWeightScale;

  lineHeight?: {
    none?: string | number;
    tight?: string | number;
    snug?: string | number;
    normal?: string | number;
    relaxed?: string | number;
    loose?: string | number;
    [key: string]: string | number | undefined;
  };

  letterSpacing?: {
    tighter?: string;
    tight?: string;
    normal?: string;
    wide?: string;
    wider?: string;
    widest?: string;
    [key: string]: string | undefined;
  };

  [key: string]: any;
}

/**
 * Spacing scale (0-96)
 */
export interface SpacingTokens {
  0?: string;
  0.5?: string;
  1?: string;
  1.5?: string;
  2?: string;
  2.5?: string;
  3?: string;
  3.5?: string;
  4?: string;
  5?: string;
  6?: string;
  7?: string;
  8?: string;
  9?: string;
  10?: string;
  11?: string;
  12?: string;
  14?: string;
  16?: string;
  20?: string;
  24?: string;
  28?: string;
  32?: string;
  36?: string;
  40?: string;
  44?: string;
  48?: string;
  52?: string;
  56?: string;
  60?: string;
  64?: string;
  72?: string;
  80?: string;
  96?: string;
  [key: string]: string | undefined;
}

/**
 * Sizing tokens
 */
export interface SizingTokens {
  xs?: string;
  sm?: string;
  md?: string;
  lg?: string;
  xl?: string;
  '2xl'?: string;
  '3xl'?: string;
  '4xl'?: string;
  '5xl'?: string;
  full?: string;
  screen?: string;
  min?: string;
  max?: string;
  fit?: string;
  [key: string]: string | undefined;
}

/**
 * Border radius tokens
 */
export interface RadiusTokens {
  none?: string;
  sm?: string;
  base?: string;
  md?: string;
  lg?: string;
  xl?: string;
  '2xl'?: string;
  '3xl'?: string;
  full?: string;
  [key: string]: string | undefined;
}

/**
 * Shadow tokens
 */
export interface ShadowTokens {
  none?: string;
  sm?: string;
  base?: string;
  md?: string;
  lg?: string;
  xl?: string;
  '2xl'?: string;
  inner?: string;
  [key: string]: string | undefined;
}

/**
 * Z-index tokens
 */
export interface ZIndexTokens {
  base?: number;
  dropdown?: number;
  sticky?: number;
  fixed?: number;
  overlay?: number;
  modal?: number;
  popover?: number;
  toast?: number;
  tooltip?: number;
  [key: string]: number | undefined;
}

/**
 * Animation tokens
 */
export interface AnimationTokens {
  duration?: {
    fast?: string;
    base?: string;
    slow?: string;
    slower?: string;
    [key: string]: string | undefined;
  };

  easing?: {
    linear?: string;
    in?: string;
    out?: string;
    inOut?: string;
    [key: string]: string | undefined;
  };

  [key: string]: any;
}

/**
 * Breakpoint tokens
 */
export interface BreakpointTokens {
  sm?: string;
  md?: string;
  lg?: string;
  xl?: string;
  '2xl'?: string;
  [key: string]: string | undefined;
}

/**
 * Complete theme definition
 */
export interface Theme {
  name: string;
  extends?: Theme;
  colors: ColorTokens;
  typography: TypographyTokens;
  spacing: SpacingTokens;
  sizing?: SizingTokens;
  radius?: RadiusTokens;
  shadow?: ShadowTokens;
  zIndex?: ZIndexTokens;
  animation?: AnimationTokens;
  breakpoints?: BreakpointTokens;
  custom?: Record<string, any>;
}

/**
 * Theme configuration input (partial, with inheritance)
 */
export type ThemeConfig = Partial<Theme> & {
  name: string;
  extends?: Theme;
  colors: ColorTokens;
  typography: TypographyTokens;
  spacing: SpacingTokens;
};

/**
 * Deep merge two objects
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (sourceValue === undefined) continue;

    if (
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(targetValue, sourceValue);
    } else {
      result[key] = sourceValue as any;
    }
  }

  return result;
}

/**
 * Define a theme with design tokens
 *
 * @param config - Theme configuration
 * @returns Complete theme object
 *
 * @example
 * ```typescript
 * const lightTheme = defineTheme({
 *   name: 'light',
 *   colors: {
 *     primary: {
 *       500: '#3b82f6',
 *       600: '#2563eb'
 *     },
 *     background: {
 *       primary: '#ffffff',
 *       secondary: '#f3f4f6'
 *     }
 *   },
 *   typography: {
 *     fontFamily: {
 *       sans: 'Inter, system-ui, sans-serif'
 *     },
 *     fontSize: {
 *       base: '1rem',
 *       lg: '1.125rem'
 *     }
 *   },
 *   spacing: {
 *     1: '0.25rem',
 *     2: '0.5rem',
 *     4: '1rem'
 *   }
 * });
 * ```
 */
export function defineTheme(config: ThemeConfig): Theme {
  // Start with base theme or extended theme
  const base: Theme = config.extends
    ? config.extends
    : {
        name: config.name,
        colors: {},
        typography: {},
        spacing: {},
      };

  // Merge configuration with base
  const theme: Theme = deepMerge(base, config);

  // Ensure required fields
  theme.name = config.name;

  return theme;
}

/**
 * Get a token value from the theme
 *
 * @param theme - Theme object
 * @param path - Token path (e.g., 'colors.primary.500')
 * @returns Token value or undefined
 *
 * @example
 * ```typescript
 * const color = getToken(theme, 'colors.primary.500');
 * const fontSize = getToken(theme, 'typography.fontSize.lg');
 * ```
 */
export function getToken(theme: Theme, path: string): any {
  const parts = path.split('.');
  let current: any = theme;

  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }

  return current;
}

/**
 * Create a default light theme
 */
export function createDefaultLightTheme(): Theme {
  return defineTheme({
    name: 'light',
    colors: {
      primary: {
        50: '#eff6ff',
        100: '#dbeafe',
        200: '#bfdbfe',
        300: '#93c5fd',
        400: '#60a5fa',
        500: '#3b82f6',
        600: '#2563eb',
        700: '#1d4ed8',
        800: '#1e40af',
        900: '#1e3a8a',
        950: '#172554',
      },
      gray: {
        50: '#f9fafb',
        100: '#f3f4f6',
        200: '#e5e7eb',
        300: '#d1d5db',
        400: '#9ca3af',
        500: '#6b7280',
        600: '#4b5563',
        700: '#374151',
        800: '#1f2937',
        900: '#111827',
        950: '#030712',
      },
      background: {
        primary: '#ffffff',
        secondary: '#f9fafb',
        tertiary: '#f3f4f6',
        inverse: '#111827',
      },
      text: {
        primary: '#111827',
        secondary: '#6b7280',
        tertiary: '#9ca3af',
        inverse: '#ffffff',
        disabled: '#d1d5db',
      },
      border: {
        default: '#e5e7eb',
        muted: '#f3f4f6',
        strong: '#d1d5db',
      },
    },
    typography: {
      fontFamily: {
        sans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
        mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      },
      fontSize: {
        xs: '0.75rem',
        sm: '0.875rem',
        base: '1rem',
        lg: '1.125rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
        '3xl': '1.875rem',
        '4xl': '2.25rem',
        '5xl': '3rem',
      },
      fontWeight: {
        normal: 400,
        medium: 500,
        semibold: 600,
        bold: 700,
      },
      lineHeight: {
        tight: 1.25,
        normal: 1.5,
        relaxed: 1.75,
      },
    },
    spacing: {
      0: '0',
      1: '0.25rem',
      2: '0.5rem',
      3: '0.75rem',
      4: '1rem',
      5: '1.25rem',
      6: '1.5rem',
      8: '2rem',
      10: '2.5rem',
      12: '3rem',
      16: '4rem',
      20: '5rem',
      24: '6rem',
    },
    radius: {
      none: '0',
      sm: '0.125rem',
      base: '0.25rem',
      md: '0.375rem',
      lg: '0.5rem',
      xl: '0.75rem',
      '2xl': '1rem',
      full: '9999px',
    },
    shadow: {
      sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
      base: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
      md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
      lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
      xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
    },
  });
}

/**
 * Create a default dark theme
 */
export function createDefaultDarkTheme(): Theme {
  const lightTheme = createDefaultLightTheme();

  return defineTheme({
    name: 'dark',
    extends: lightTheme,
    colors: {
      background: {
        primary: '#111827',
        secondary: '#1f2937',
        tertiary: '#374151',
        inverse: '#ffffff',
      },
      text: {
        primary: '#f9fafb',
        secondary: '#d1d5db',
        tertiary: '#9ca3af',
        inverse: '#111827',
        disabled: '#6b7280',
      },
      border: {
        default: '#374151',
        muted: '#1f2937',
        strong: '#4b5563',
      },
    },
    typography: lightTheme.typography,
    spacing: lightTheme.spacing,
  });
}
