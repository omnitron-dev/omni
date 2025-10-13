/**
 * Divider - Styled visual separator with label support
 *
 * A styled version of the Divider primitive with built-in
 * color and style variants.
 */

import { styled } from '../../styling/styled.js';
import { Divider as DividerPrimitive } from '../../primitives/Divider.js';

/**
 * Styled Divider component with visual variants
 *
 * @example
 * ```tsx
 * // Basic divider
 * <Divider />
 *
 * // Divider with label
 * <Divider label="OR" />
 *
 * // Dashed divider with custom color
 * <Divider variant="dashed" color="primary" />
 *
 * // Vertical divider
 * <Divider orientation="vertical" />
 *
 * // Thick divider with label
 * <Divider thickness={2} label="Section" labelPosition="start" />
 * ```
 */
export const Divider = styled(DividerPrimitive, {
  base: {
    border: 'none',
  },
  variants: {
    color: {
      default: { borderColor: '#e5e7eb' },
      gray: { borderColor: '#9ca3af' },
      primary: { borderColor: '#3b82f6' },
      secondary: { borderColor: '#8b5cf6' },
      success: { borderColor: '#10b981' },
      warning: { borderColor: '#f59e0b' },
      danger: { borderColor: '#ef4444' },
    },
    spacing: {
      none: { margin: '0' },
      xs: { margin: '0.25rem 0' },
      sm: { margin: '0.5rem 0' },
      md: { margin: '1rem 0' },
      lg: { margin: '1.5rem 0' },
      xl: { margin: '2rem 0' },
    },
  },
  defaultVariants: {
    color: 'default',
  },
});

export type { DividerProps } from '../../primitives/Divider.js';
