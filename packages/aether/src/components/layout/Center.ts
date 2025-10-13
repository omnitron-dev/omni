/**
 * Center - Styled centering container
 *
 * A styled version of the Center primitive with built-in
 * padding and background variants.
 */

import { styled } from '../../styling/styled.js';
import { Center as CenterPrimitive } from '../../primitives/Center.js';

/**
 * Styled Center component with spacing variants
 *
 * @example
 * ```tsx
 * // Center content in viewport
 * <Center height="100vh">
 *   <div>Perfectly centered</div>
 * </Center>
 *
 * // Inline center
 * <Center inline padding="md">
 *   <button>Centered button</button>
 * </Center>
 *
 * // Center with dimensions
 * <Center width={400} height={300} bg="gray">
 *   <img src="/logo.png" alt="Logo" />
 * </Center>
 * ```
 */
export const Center = styled(CenterPrimitive, {
  base: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    boxSizing: 'border-box',
  },
  variants: {
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
      full: { borderRadius: '9999px' },
    },
  },
});

export type { CenterProps } from '../../primitives/Center.js';
