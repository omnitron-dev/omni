/**
 * Separator - Styled semantic content divider
 *
 * A styled version of the Separator primitive with built-in
 * color and spacing variants.
 */

import { styled } from '../../styling/styled.js';
import { Separator as SeparatorPrimitive } from '../../primitives/Separator.js';

/**
 * Styled Separator component with visual variants
 *
 * @example
 * ```tsx
 * // Basic separator
 * <Separator />
 *
 * // Vertical separator
 * <Separator orientation="vertical" />
 *
 * // Separator with custom color
 * <Separator color="primary" />
 *
 * // Decorative separator with spacing
 * <Separator decorative spacing="lg" />
 * ```
 */
export const Separator = styled(SeparatorPrimitive, {
  base: {
    border: 'none',
    backgroundColor: '#e5e7eb',
  },
  variants: {
    color: {
      default: { backgroundColor: '#e5e7eb' },
      gray: { backgroundColor: '#9ca3af' },
      primary: { backgroundColor: '#3b82f6' },
      secondary: { backgroundColor: '#8b5cf6' },
      success: { backgroundColor: '#10b981' },
      warning: { backgroundColor: '#f59e0b' },
      danger: { backgroundColor: '#ef4444' },
    },
    spacing: {
      none: { margin: '0' },
      xs: { margin: '0.25rem 0' },
      sm: { margin: '0.5rem 0' },
      md: { margin: '1rem 0' },
      lg: { margin: '1.5rem 0' },
      xl: { margin: '2rem 0' },
    },
    thickness: {
      thin: { height: '1px', width: '1px' },
      medium: { height: '2px', width: '2px' },
      thick: { height: '4px', width: '4px' },
    },
  },
  defaultVariants: {
    color: 'default',
    thickness: 'thin',
  },
});

export type { SeparatorProps } from '../../primitives/Separator.js';
