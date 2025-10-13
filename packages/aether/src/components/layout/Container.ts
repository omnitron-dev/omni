/**
 * Container - Styled responsive content container
 *
 * A styled version of the Container primitive with built-in
 * size and padding variants.
 */

import { styled } from '../../styling/styled.js';
import { Container as ContainerPrimitive } from '../../primitives/Container.js';

/**
 * Styled Container component with size variants
 *
 * @example
 * ```tsx
 * // Default container
 * <Container>
 *   <h1>Page Title</h1>
 *   <p>Content</p>
 * </Container>
 *
 * // Small container with padding
 * <Container size="sm" padding="lg">
 *   <article>Article content</article>
 * </Container>
 *
 * // Fluid container
 * <Container fluid>
 *   <div>Full-width content</div>
 * </Container>
 * ```
 */
export const Container = styled(ContainerPrimitive, {
  base: {
    width: '100%',
    marginLeft: 'auto',
    marginRight: 'auto',
    boxSizing: 'border-box',
  },
  variants: {
    padding: {
      none: { paddingLeft: '0', paddingRight: '0' },
      xs: { paddingLeft: '0.25rem', paddingRight: '0.25rem' },
      sm: { paddingLeft: '0.5rem', paddingRight: '0.5rem' },
      md: { paddingLeft: '1rem', paddingRight: '1rem' },
      lg: { paddingLeft: '1.5rem', paddingRight: '1.5rem' },
      xl: { paddingLeft: '2rem', paddingRight: '2rem' },
      '2xl': { paddingLeft: '3rem', paddingRight: '3rem' },
    },
    bg: {
      transparent: { backgroundColor: 'transparent' },
      white: { backgroundColor: '#ffffff' },
      gray: { backgroundColor: '#f3f4f6' },
      primary: { backgroundColor: '#3b82f6' },
    },
    shadow: {
      none: { boxShadow: 'none' },
      sm: { boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)' },
      md: { boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' },
      lg: { boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)' },
    },
  },
});

export type { ContainerProps } from '../../primitives/Container.js';
