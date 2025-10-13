/**
 * Grid - Styled CSS Grid layout container
 *
 * A styled version of the Grid primitive with built-in
 * gap and layout variants.
 */

import { styled } from '../../styling/styled.js';
import { Grid as GridPrimitive } from '../../primitives/Grid.js';

/**
 * Styled Grid component with layout variants
 *
 * @example
 * ```tsx
 * // 3-column grid with gap
 * <Grid gap="md" templateColumns="repeat(3, 1fr)">
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 *   <div>Item 3</div>
 * </Grid>
 *
 * // Responsive grid
 * <Grid gap="lg" templateColumns="repeat(auto-fit, minmax(200px, 1fr))">
 *   <div>Card 1</div>
 *   <div>Card 2</div>
 * </Grid>
 * ```
 */
export const Grid = styled(GridPrimitive, {
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
    columns: {
      1: { gridTemplateColumns: 'repeat(1, 1fr)' },
      2: { gridTemplateColumns: 'repeat(2, 1fr)' },
      3: { gridTemplateColumns: 'repeat(3, 1fr)' },
      4: { gridTemplateColumns: 'repeat(4, 1fr)' },
      5: { gridTemplateColumns: 'repeat(5, 1fr)' },
      6: { gridTemplateColumns: 'repeat(6, 1fr)' },
      12: { gridTemplateColumns: 'repeat(12, 1fr)' },
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

export type { GridProps } from '../../primitives/Grid.js';
