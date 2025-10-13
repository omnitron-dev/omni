/**
 * Stack - Styled vertical/horizontal stack layout
 *
 * A styled version of the Stack primitive with built-in
 * spacing and alignment variants.
 */

import { styled } from '../../styling/styled.js';
import { Stack as StackPrimitive } from '../../primitives/Stack.js';

/**
 * Styled Stack component with spacing variants
 *
 * @example
 * ```tsx
 * // Vertical stack with spacing
 * <Stack spacing="md">
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 * </Stack>
 *
 * // Horizontal stack
 * <Stack direction="horizontal" spacing="lg" align="center">
 *   <button>Button 1</button>
 *   <button>Button 2</button>
 * </Stack>
 * ```
 */
export const Stack = styled(StackPrimitive, {
  base: {
    display: 'flex',
    boxSizing: 'border-box',
  },
  variants: {
    spacing: {
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

export type { StackProps } from '../../primitives/Stack.js';
