/**
 * Shadow System
 *
 * Shadow configuration for Prism themes.
 *
 * @module @omnitron-dev/prism/theme/shadows
 */

import type { Shadows } from '@mui/material/styles';

/**
 * Default shadows array (MUI expects 25 shadows).
 */
export const shadows: Shadows = [
  'none',
  '0px 1px 2px 0px rgba(0, 0, 0, 0.05)',
  '0px 1px 3px 0px rgba(0, 0, 0, 0.1), 0px 1px 2px -1px rgba(0, 0, 0, 0.1)',
  '0px 4px 6px -1px rgba(0, 0, 0, 0.1), 0px 2px 4px -2px rgba(0, 0, 0, 0.1)',
  '0px 10px 15px -3px rgba(0, 0, 0, 0.1), 0px 4px 6px -4px rgba(0, 0, 0, 0.1)',
  '0px 20px 25px -5px rgba(0, 0, 0, 0.1), 0px 8px 10px -6px rgba(0, 0, 0, 0.1)',
  '0px 25px 50px -12px rgba(0, 0, 0, 0.25)',
  // Cards and dropdowns
  '0px 2px 4px rgba(0, 0, 0, 0.08)',
  '0px 4px 8px rgba(0, 0, 0, 0.08)',
  '0px 8px 16px rgba(0, 0, 0, 0.08)',
  '0px 12px 24px rgba(0, 0, 0, 0.08)',
  '0px 16px 32px rgba(0, 0, 0, 0.08)',
  '0px 20px 40px rgba(0, 0, 0, 0.08)',
  // Modals and dialogs
  '0px 4px 6px -2px rgba(0, 0, 0, 0.05), 0px 10px 15px -3px rgba(0, 0, 0, 0.1)',
  '0px 10px 10px -5px rgba(0, 0, 0, 0.04), 0px 20px 25px -5px rgba(0, 0, 0, 0.1)',
  '0px 20px 20px -10px rgba(0, 0, 0, 0.04), 0px 25px 50px -12px rgba(0, 0, 0, 0.25)',
  // Navigation
  '0px 0px 0px 1px rgba(0, 0, 0, 0.05)',
  '0px 1px 2px rgba(0, 0, 0, 0.05), 0px 0px 0px 1px rgba(0, 0, 0, 0.05)',
  '0px 2px 4px rgba(0, 0, 0, 0.05), 0px 0px 0px 1px rgba(0, 0, 0, 0.05)',
  // Focus rings
  '0px 0px 0px 3px rgba(66, 153, 225, 0.5)',
  '0px 0px 0px 3px rgba(72, 187, 120, 0.5)',
  '0px 0px 0px 3px rgba(245, 101, 101, 0.5)',
  // Inset
  'inset 0px 2px 4px rgba(0, 0, 0, 0.06)',
  'inset 0px 4px 6px rgba(0, 0, 0, 0.1)',
  'inset 0px 0px 0px 1px rgba(0, 0, 0, 0.1)',
];

/**
 * Create shadows with optional opacity multiplier for dark mode.
 *
 * @param primaryColor - Primary color for tinted shadows (reserved for future)
 * @param opacityMultiplier - Multiplier for shadow opacity (default: 1, use 0.4-0.6 for dark mode)
 * @returns Shadows array with adjusted opacity
 */
export function createShadows(primaryColor?: string, opacityMultiplier = 1): Shadows {
  if (opacityMultiplier === 1) {
    return [...shadows] as Shadows;
  }

  // Adjust shadow opacity for dark mode
  return shadows.map((shadow) => {
    if (shadow === 'none') return shadow;

    // Replace rgba opacity values
    return shadow.replace(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g, (_, r, g, b, a) => {
      const newAlpha = Math.min(1, parseFloat(a) * opacityMultiplier);
      return `rgba(${r}, ${g}, ${b}, ${newAlpha.toFixed(2)})`;
    });
  }) as Shadows;
}

/**
 * Named shadow presets for easier usage.
 */
export const shadowPresets = {
  /** No shadow */
  none: shadows[0],
  /** Extra small shadow */
  xs: shadows[1],
  /** Small shadow */
  sm: shadows[2],
  /** Medium shadow */
  md: shadows[3],
  /** Large shadow */
  lg: shadows[4],
  /** Extra large shadow */
  xl: shadows[5],
  /** 2x extra large shadow */
  '2xl': shadows[6],
  /** Card shadow */
  card: shadows[8],
  /** Dropdown shadow */
  dropdown: shadows[9],
  /** Modal shadow */
  modal: shadows[14],
  /** Dialog shadow */
  dialog: shadows[15],
  /** Focus ring (primary) */
  focusPrimary: shadows[19],
  /** Focus ring (success) */
  focusSuccess: shadows[20],
  /** Focus ring (error) */
  focusError: shadows[21],
  /** Inset shadow */
  inset: shadows[22],
} as const;

export type ShadowPreset = keyof typeof shadowPresets;

/**
 * Dark mode shadow - subtle shadow for dark backgrounds.
 */
export const darkShadow = '0px 0px 0px 1px rgba(255, 255, 255, 0.1)';
