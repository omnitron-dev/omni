/**
 * Theme Mixins
 *
 * Reusable style utilities for component overrides.
 * Based on Minimals template patterns.
 *
 * @module @omnitron-dev/prism/theme/mixins
 */

import type { Theme, CSSObject } from '@mui/material/styles';
import { varAlpha } from './utils/color.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Color key types for style variants.
 */
export type PaletteColorKey = 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'error';
export type CommonColorsKeys = 'black' | 'white';
export type ColorKey = CommonColorsKeys | PaletteColorKey | 'default' | 'inherit';

/**
 * Options for style variants.
 */
export interface StyleOptions {
  hover?: boolean | CSSObject;
}

/**
 * Options for paper styles.
 */
export interface PaperStyleOptions {
  blur?: number;
  color?: string;
  dropdown?: boolean;
}

/**
 * Background gradient options.
 */
export interface BgGradientOptions {
  images?: string[];
  sizes?: string[];
  positions?: string[];
  colors?: string[];
  direction?: string;
}

// Re-export varAlpha for backwards compatibility
export { varAlpha } from './utils/color.js';

/**
 * Helper to generate hover styles.
 */
function getHoverStyles(hoverOption: StyleOptions['hover'], hoverBase: CSSObject): CSSObject {
  if (!hoverOption) return {};

  return {
    '&:hover': {
      ...hoverBase,
      ...(typeof hoverOption === 'object' ? hoverOption : {}),
    },
  };
}

// =============================================================================
// STYLE VARIANTS
// =============================================================================

/**
 * Generate filled style variant for components.
 *
 * @example
 * ```tsx
 * // In component styleOverrides
 * ...filledStyles(theme, 'primary', { hover: true })
 * ...filledStyles(theme, 'inherit', { hover: { boxShadow: theme.vars.customShadows.z8 } })
 * ```
 */
export function filledStyles(theme: Theme, colorKey: ColorKey, options?: StyleOptions): CSSObject {
  if (!colorKey) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[Prism filledStyles] Missing colorKey parameter.');
    }
    return {};
  }

  const palette = theme.vars?.palette || theme.palette;
  const grey = palette.grey;

  if (colorKey === 'default') {
    const base: CSSObject = {
      color: grey[800],
      backgroundColor: grey[300],
    };
    const hover = getHoverStyles(options?.hover, {
      backgroundColor: grey[400],
    });
    return { ...base, ...hover };
  }

  if (colorKey === 'inherit') {
    const base: CSSObject = {
      color: palette.common.white,
      backgroundColor: grey[800],
    };
    const hover = getHoverStyles(options?.hover, {
      backgroundColor: grey[700],
    });
    return { ...base, ...hover };
  }

  if (colorKey === 'white' || colorKey === 'black') {
    const oppositeColor = colorKey === 'white' ? 'black' : 'white';
    const base: CSSObject = {
      color: palette.common[oppositeColor],
      backgroundColor: palette.common[colorKey],
    };
    const hover = getHoverStyles(options?.hover, {
      opacity: 0.8,
    });
    return { ...base, ...hover };
  }

  // Palette colors (primary, secondary, info, success, warning, error)
  const paletteColor = palette[colorKey];
  const base: CSSObject = {
    color: paletteColor.contrastText,
    backgroundColor: paletteColor.main,
  };
  const hover = getHoverStyles(options?.hover, {
    backgroundColor: paletteColor.dark,
  });

  return { ...base, ...hover };
}

/**
 * Generate soft style variant for components.
 *
 * @example
 * ```tsx
 * // In component styleOverrides
 * ...softStyles(theme, 'primary')
 * ...softStyles(theme, 'inherit', { hover: true })
 * ```
 */
export function softStyles(theme: Theme, colorKey: ColorKey, options?: StyleOptions): CSSObject {
  if (!colorKey) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[Prism softStyles] Missing colorKey parameter.');
    }
    return {};
  }

  const palette = theme.vars?.palette || theme.palette;
  const grey = palette.grey;

  if (colorKey === 'default') {
    return {
      ...filledStyles(theme, 'default', options),
      boxShadow: 'none',
    };
  }

  if (colorKey === 'inherit') {
    const greyChannel = (grey as { ['500Channel']?: string })['500Channel'] || '145, 158, 171';
    const base: CSSObject = {
      boxShadow: 'none',
      backgroundColor: varAlpha(greyChannel, 0.16),
    };
    const hover = getHoverStyles(options?.hover, {
      backgroundColor: varAlpha(greyChannel, 0.32),
    });
    return { ...base, ...hover };
  }

  if (colorKey === 'white' || colorKey === 'black') {
    const base: CSSObject = {
      boxShadow: 'none',
      color: palette.common[colorKey],
      backgroundColor: varAlpha('currentColor', 0.08),
    };
    const hover = getHoverStyles(options?.hover, {
      backgroundColor: varAlpha('currentColor', 0.16),
    });
    return { ...base, ...hover };
  }

  // Palette colors
  const paletteColor = palette[colorKey];
  const mainChannel =
    (paletteColor as { mainChannel?: string }).mainChannel ||
    (palette.primary as { mainChannel?: string }).mainChannel ||
    '51, 133, 240';

  const base: CSSObject = {
    boxShadow: 'none',
    color: paletteColor.dark,
    backgroundColor: varAlpha(mainChannel, 0.16),
  };
  const hover = getHoverStyles(options?.hover, {
    backgroundColor: varAlpha(mainChannel, 0.32),
  });

  return { ...base, ...hover };
}

/**
 * Generate background gradient styles.
 *
 * @example
 * ```tsx
 * ...bgGradient({
 *   colors: ['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.8)'],
 *   direction: 'to bottom'
 * })
 * ```
 */
export function bgGradient(options: BgGradientOptions): CSSObject {
  const { images, sizes, positions, colors, direction = 'to bottom' } = options;

  if (colors && colors.length > 0) {
    return {
      background: `linear-gradient(${direction}, ${colors.join(', ')})`,
    };
  }

  if (images && images.length > 0) {
    return {
      backgroundImage: images.join(', '),
      backgroundSize: sizes?.join(', ') || 'cover',
      backgroundPosition: positions?.join(', ') || 'center',
      backgroundRepeat: 'no-repeat',
    };
  }

  return {};
}

/**
 * Generate blur background styles.
 *
 * @example
 * ```tsx
 * ...bgBlur({ blur: 20, color: 'rgba(255,255,255,0.8)' })
 * ```
 */
export function bgBlur(options: { blur?: number; color?: string }): CSSObject {
  const { blur = 20, color = 'rgba(255, 255, 255, 0.8)' } = options;

  return {
    backdropFilter: `blur(${blur}px)`,
    WebkitBackdropFilter: `blur(${blur}px)`,
    backgroundColor: color,
  };
}

/**
 * Generate paper styles with glass effect.
 *
 * @example
 * ```tsx
 * ...paperStyles(theme, { dropdown: true })
 * ```
 */
export function paperStyles(theme: Theme, options?: PaperStyleOptions): CSSObject {
  const { blur = 20, color, dropdown } = options ?? {};
  const palette = theme.vars?.palette || theme.palette;

  const baseStyles: CSSObject = {
    backdropFilter: `blur(${blur}px)`,
    WebkitBackdropFilter: `blur(${blur}px)`,
    backgroundColor: color ?? varAlpha('255, 255, 255', 0.9),
  };

  if (dropdown) {
    const customShadows = (theme as { customShadows?: { dropdown?: string } }).customShadows;
    const greyChannel = (palette.grey as { ['500Channel']?: string })['500Channel'] || '145, 158, 171';
    return {
      ...baseStyles,
      padding: theme.spacing(0.5),
      boxShadow:
        customShadows?.dropdown ||
        `0 0 2px 0 rgba(${greyChannel}, 0.24), -20px 20px 40px -4px rgba(${greyChannel}, 0.24)`,
      borderRadius: `${Number(theme.shape.borderRadius) * 1.25}px`,
    };
  }

  return baseStyles;
}

/**
 * Generate menu item styles.
 *
 * @example
 * ```tsx
 * ...menuItemStyles(theme)
 * ```
 */
export function menuItemStyles(theme: Theme): CSSObject {
  const palette = theme.vars?.palette || theme.palette;

  return {
    ...theme.typography.body2,
    padding: theme.spacing(0.75, 1),
    borderRadius: Number(theme.shape.borderRadius) * 0.75,
    '&:not(:last-of-type)': {
      marginBottom: 4,
    },
    '&.Mui-selected': {
      fontWeight: theme.typography.fontWeightMedium,
      backgroundColor: palette.action.selected,
      '&:hover': { backgroundColor: palette.action.hover },
    },
  };
}

/**
 * Generate max lines text truncation.
 *
 * @example
 * ```tsx
 * ...maxLine({ lines: 2 })
 * ```
 */
export function maxLine(options: { lines: number; lineHeight?: number }): CSSObject {
  const { lines, lineHeight = 1.5 } = options;

  return {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: lines,
    textOverflow: 'ellipsis',
    ...(lineHeight && { lineHeight }),
  };
}

/**
 * Generate text gradient effect.
 *
 * @example
 * ```tsx
 * ...textGradient('to right', '#FF5630', '#00AB55')
 * ```
 */
export function textGradient(direction: string, ...colors: string[]): CSSObject {
  return {
    background: `linear-gradient(${direction}, ${colors.join(', ')})`,
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    textFillColor: 'transparent',
    display: 'inline-block',
  };
}

/**
 * Generate border gradient effect using background-clip trick.
 *
 * @example
 * ```tsx
 * ...borderGradient({ color: 'linear-gradient(135deg, #FF5630, #00AB55)', borderWidth: 2 })
 * ```
 */
export function borderGradient(options: { color?: string; borderWidth?: number; borderRadius?: number }): CSSObject {
  const { color = 'linear-gradient(135deg, #FF5630, #00AB55)', borderWidth = 2, borderRadius = 0 } = options;

  return {
    position: 'relative' as const,
    border: 'none',
    borderRadius,
    '&::before': {
      content: '""',
      position: 'absolute' as const,
      inset: 0,
      borderRadius: 'inherit',
      padding: borderWidth,
      background: color,
      WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
      WebkitMaskComposite: 'xor',
      maskComposite: 'exclude',
      pointerEvents: 'none' as const,
    },
  };
}

/**
 * Generate theme-aware scrollbar styles.
 * Uses CSS variables for proper dark mode support.
 *
 * @example
 * ```tsx
 * ...scrollbarStyles(theme)
 * ```
 */
export function scrollbarStyles(theme: Theme): CSSObject {
  const palette = theme.vars?.palette || theme.palette;
  const greyChannel = (palette.grey as { ['500Channel']?: string })['500Channel'] || '145, 158, 171';

  return {
    scrollbarWidth: 'thin' as const,
    scrollbarColor: `${varAlpha(greyChannel, 0.4)} ${varAlpha(greyChannel, 0.08)}`,
    '&::-webkit-scrollbar': {
      width: 6,
      height: 6,
    },
    '&::-webkit-scrollbar-track': {
      backgroundColor: 'transparent',
    },
    '&::-webkit-scrollbar-thumb': {
      backgroundColor: varAlpha(greyChannel, 0.4),
      borderRadius: 3,
      '&:hover': {
        backgroundColor: varAlpha(greyChannel, 0.6),
      },
    },
  };
}

// =============================================================================
// KEYFRAME ANIMATIONS
// =============================================================================

/**
 * Spin animation keyframes (for loading spinners).
 */
export const spinKeyframes = {
  '@keyframes prism-spin': {
    from: { transform: 'rotate(0deg)' },
    to: { transform: 'rotate(360deg)' },
  },
};

/**
 * Dash animation keyframes (for SVG stroke animations).
 */
export const dashKeyframes = {
  '@keyframes prism-dash': {
    '0%': { strokeDasharray: '1, 200', strokeDashoffset: 0 },
    '50%': { strokeDasharray: '100, 200', strokeDashoffset: -15 },
    '100%': { strokeDasharray: '100, 200', strokeDashoffset: -125 },
  },
};

/**
 * Pulse animation keyframes.
 */
export const pulseKeyframes = {
  '@keyframes prism-pulse': {
    '0%': { transform: 'scale(1)', opacity: 1 },
    '50%': { transform: 'scale(1.05)', opacity: 0.7 },
    '100%': { transform: 'scale(1)', opacity: 1 },
  },
};

/**
 * Shimmer animation for skeleton loading.
 */
export const shimmerKeyframes = {
  '@keyframes prism-shimmer': {
    '0%': { backgroundPosition: '-200% 0' },
    '100%': { backgroundPosition: '200% 0' },
  },
};

/**
 * Fade in animation.
 */
export const fadeInKeyframes = {
  '@keyframes prism-fadeIn': {
    from: { opacity: 0 },
    to: { opacity: 1 },
  },
};

/**
 * Slide up animation.
 */
export const slideUpKeyframes = {
  '@keyframes prism-slideUp': {
    from: { transform: 'translateY(16px)', opacity: 0 },
    to: { transform: 'translateY(0)', opacity: 1 },
  },
};

// =============================================================================
// BASIC MIXINS
// =============================================================================

/**
 * MUI mixins configuration.
 */
export const mixins = {
  toolbar: {
    minHeight: 56,
    '@media (min-width:0px)': {
      '@media (orientation: landscape)': {
        minHeight: 48,
      },
    },
    '@media (min-width:600px)': {
      minHeight: 64,
    },
  },
  // Extended mixins
  hideScrollX: {
    msOverflowStyle: 'none' as const,
    scrollbarWidth: 'none' as const,
    overflowX: 'auto' as const,
    '&::-webkit-scrollbar': { display: 'none' },
  },
  hideScrollY: {
    msOverflowStyle: 'none' as const,
    scrollbarWidth: 'none' as const,
    overflowY: 'auto' as const,
    '&::-webkit-scrollbar': { display: 'none' },
  },
  // Style functions (attached at theme creation)
  bgBlur,
  bgGradient,
  maxLine,
  softStyles,
  filledStyles,
  paperStyles,
  menuItemStyles,
  varAlpha,
  textGradient,
  borderGradient,
  scrollbarStyles,
};

/**
 * Hide scrollbar mixin.
 */
export const hideScrollbarMixin = {
  scrollbarWidth: 'none' as const,
  msOverflowStyle: 'none' as const,
  '&::-webkit-scrollbar': {
    display: 'none',
  },
};

/**
 * Custom scrollbar mixin.
 */
export function customScrollbarMixin(theme: Theme): CSSObject {
  const palette = theme.vars?.palette || theme.palette;
  const greyChannel = (palette.grey as { ['500Channel']?: string })['500Channel'] || '145, 158, 171';

  return {
    scrollbarWidth: 'thin' as const,
    scrollbarColor: `${varAlpha(greyChannel, 0.4)} ${varAlpha(greyChannel, 0.08)}`,
    '&::-webkit-scrollbar': {
      width: 6,
      height: 6,
    },
    '&::-webkit-scrollbar-track': {
      backgroundColor: 'transparent',
    },
    '&::-webkit-scrollbar-thumb': {
      backgroundColor: varAlpha(greyChannel, 0.4),
      borderRadius: 3,
      '&:hover': {
        backgroundColor: varAlpha(greyChannel, 0.6),
      },
    },
  };
}

/**
 * Text overflow ellipsis mixin.
 */
export const textEllipsisMixin = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap' as const,
};

/**
 * Multi-line text overflow mixin.
 */
export function multiLineEllipsisMixin(lines: number) {
  return {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical' as const,
    WebkitLineClamp: lines,
  };
}

/**
 * Focus visible ring mixin.
 */
export const focusRingMixin = {
  '&:focus-visible': {
    outline: 'none',
    boxShadow: '0 0 0 2px var(--prism-background, #FFF), 0 0 0 4px var(--prism-primary, #3385F0)',
  },
};

/**
 * Glass/blur background mixin.
 */
export const glassMixin = {
  backdropFilter: 'blur(20px)',
  backgroundColor: 'var(--prism-vibrant-overlay, rgba(255, 255, 255, 0.7))',
};
