/**
 * Masonry - Styled Pinterest-style masonry grid
 *
 * A styled version of the Masonry primitive with built-in
 * gap and column variants.
 */

import { styled } from '../../styling/styled.js';
import { Masonry as MasonryPrimitive } from '../../primitives/Masonry.js';

/**
 * Styled Masonry component with layout variants
 *
 * @example
 * ```tsx
 * // 3-column masonry with gap
 * <Masonry columns={3} gap="md">
 *   <div style={{ height: 200 }}>Item 1</div>
 *   <div style={{ height: 300 }}>Item 2</div>
 *   <div style={{ height: 150 }}>Item 3</div>
 * </Masonry>
 *
 * // Responsive masonry
 * <Masonry columns={4} gap="lg" padding="md">
 *   <div>Card 1</div>
 *   <div>Card 2</div>
 * </Masonry>
 * ```
 */
export const Masonry = styled(MasonryPrimitive, {
  base: {
    position: 'relative',
    boxSizing: 'border-box',
  },
  variants: {
    gap: {
      none: { gap: '0' },
      xs: { gap: '0.25rem' },
      sm: { gap: '0.5rem' },
      md: { gap: '1rem' },
      lg: { gap: '1.5rem' },
      xl: { gap: '2rem' },
      '2xl': { gap: '3rem' },
    },
    padding: {
      none: { padding: '0' },
      xs: { padding: '0.25rem' },
      sm: { padding: '0.5rem' },
      md: { padding: '1rem' },
      lg: { padding: '1.5rem' },
      xl: { padding: '2rem' },
      '2xl': { padding: '3rem' },
    },
    bg: {
      transparent: { backgroundColor: 'transparent' },
      white: { backgroundColor: '#ffffff' },
      gray: { backgroundColor: '#f3f4f6' },
      primary: { backgroundColor: '#3b82f6' },
    },
  },
});

export type { MasonryProps } from '../../primitives/Masonry.js';
