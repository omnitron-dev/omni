/**
 * SimpleGrid - Styled responsive equal-width grid
 *
 * A styled version of the SimpleGrid primitive with built-in
 * gap and column variants.
 */

import { styled } from '../../styling/styled.js';
import { SimpleGrid as SimpleGridPrimitive } from '../../primitives/SimpleGrid.js';

/**
 * Styled SimpleGrid component with responsive variants
 *
 * @example
 * ```tsx
 * // Fixed 3 columns with gap
 * <SimpleGrid columns={3} gap="md">
 *   <div>Card 1</div>
 *   <div>Card 2</div>
 *   <div>Card 3</div>
 * </SimpleGrid>
 *
 * // Responsive grid with min child width
 * <SimpleGrid minChildWidth={200} gap="lg">
 *   <div>Card 1</div>
 *   <div>Card 2</div>
 * </SimpleGrid>
 * ```
 */
export const SimpleGrid = styled(SimpleGridPrimitive, {
  base: {
    display: 'grid',
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
    rounded: {
      none: { borderRadius: '0' },
      sm: { borderRadius: '0.125rem' },
      md: { borderRadius: '0.375rem' },
      lg: { borderRadius: '0.5rem' },
      xl: { borderRadius: '0.75rem' },
    },
  },
});

export type { SimpleGridProps } from '../../primitives/SimpleGrid.js';
