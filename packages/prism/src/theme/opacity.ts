/**
 * Opacity Configuration
 *
 * Standardized opacity values for consistent UI effects across components.
 * Based on Minimals template patterns.
 *
 * @module @omnitron-dev/prism/theme/opacity
 */

/**
 * Extended opacity settings for soft, filled, and outlined variants.
 */
export interface OpacityExtend {
  filled: {
    commonHoverBg: number;
  };
  outlined: {
    border: number;
  };
  soft: {
    bg: number;
    hoverBg: number;
    commonBg: number;
    commonHoverBg: number;
    border: number;
  };
}

/**
 * Opacity configuration for theme.
 */
export interface OpacityConfig {
  /** Switch track opacity when on */
  switchTrack: number;
  /** Switch track opacity when disabled */
  switchTrackDisabled: number;
  /** Input placeholder opacity */
  inputPlaceholder: number;
  /** Input underline opacity */
  inputUnderline: number;
  /** Filled variant opacities */
  filled: OpacityExtend['filled'];
  /** Outlined variant opacities */
  outlined: OpacityExtend['outlined'];
  /** Soft variant opacities */
  soft: OpacityExtend['soft'];
}

/**
 * Default opacity values.
 * These provide consistent transparency across all Prism components.
 */
export const opacity: OpacityConfig = {
  // System
  switchTrack: 1,
  switchTrackDisabled: 0.48,
  inputPlaceholder: 1,
  inputUnderline: 0.32,
  // Filled variant
  filled: {
    commonHoverBg: 0.72,
  },
  // Outlined variant
  outlined: {
    border: 0.48,
  },
  // Soft variant
  soft: {
    bg: 0.16,
    hoverBg: 0.32,
    commonBg: 0.08,
    commonHoverBg: 0.16,
    border: 0.24,
  },
};
