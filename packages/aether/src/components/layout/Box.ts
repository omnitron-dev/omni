/**
 * Box - Styled primitive building block
 *
 * A styled version of the Box primitive with built-in spacing,
 * color, and layout variants using the styling system.
 */

import { styled } from '../../styling/styled.js';
import { Box as BoxPrimitive } from '../../primitives/Box.js';

/**
 * Styled Box component with spacing and styling variants
 *
 * @example
 * ```tsx
 * // Basic box with padding
 * <Box padding="md">Content</Box>
 *
 * // Box with margin and background
 * <Box margin="lg" bg="primary">
 *   Styled content
 * </Box>
 *
 * // Responsive padding
 * <Box padding={{ sm: 'sm', md: 'md', lg: 'lg' }}>
 *   Responsive padding
 * </Box>
 * ```
 */
export const Box = styled(BoxPrimitive, {
  base: {
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
    paddingX: {
      none: { paddingLeft: '0', paddingRight: '0' },
      xs: { paddingLeft: '0.25rem', paddingRight: '0.25rem' },
      sm: { paddingLeft: '0.5rem', paddingRight: '0.5rem' },
      md: { paddingLeft: '1rem', paddingRight: '1rem' },
      lg: { paddingLeft: '1.5rem', paddingRight: '1.5rem' },
      xl: { paddingLeft: '2rem', paddingRight: '2rem' },
      '2xl': { paddingLeft: '3rem', paddingRight: '3rem' },
    },
    paddingY: {
      none: { paddingTop: '0', paddingBottom: '0' },
      xs: { paddingTop: '0.25rem', paddingBottom: '0.25rem' },
      sm: { paddingTop: '0.5rem', paddingBottom: '0.5rem' },
      md: { paddingTop: '1rem', paddingBottom: '1rem' },
      lg: { paddingTop: '1.5rem', paddingBottom: '1.5rem' },
      xl: { paddingTop: '2rem', paddingBottom: '2rem' },
      '2xl': { paddingTop: '3rem', paddingBottom: '3rem' },
    },
    margin: {
      none: { margin: '0' },
      xs: { margin: '0.25rem' },
      sm: { margin: '0.5rem' },
      md: { margin: '1rem' },
      lg: { margin: '1.5rem' },
      xl: { margin: '2rem' },
      '2xl': { margin: '3rem' },
      auto: { margin: 'auto' },
    },
    marginX: {
      none: { marginLeft: '0', marginRight: '0' },
      xs: { marginLeft: '0.25rem', marginRight: '0.25rem' },
      sm: { marginLeft: '0.5rem', marginRight: '0.5rem' },
      md: { marginLeft: '1rem', marginRight: '1rem' },
      lg: { marginLeft: '1.5rem', marginRight: '1.5rem' },
      xl: { marginLeft: '2rem', marginRight: '2rem' },
      '2xl': { marginLeft: '3rem', marginRight: '3rem' },
      auto: { marginLeft: 'auto', marginRight: 'auto' },
    },
    marginY: {
      none: { marginTop: '0', marginBottom: '0' },
      xs: { marginTop: '0.25rem', marginBottom: '0.25rem' },
      sm: { marginTop: '0.5rem', marginBottom: '0.5rem' },
      md: { marginTop: '1rem', marginBottom: '1rem' },
      lg: { marginTop: '1.5rem', marginBottom: '1.5rem' },
      xl: { marginTop: '2rem', marginBottom: '2rem' },
      '2xl': { marginTop: '3rem', marginBottom: '3rem' },
      auto: { marginTop: 'auto', marginBottom: 'auto' },
    },
    bg: {
      transparent: { backgroundColor: 'transparent' },
      white: { backgroundColor: '#ffffff' },
      black: { backgroundColor: '#000000' },
      gray: { backgroundColor: '#6b7280' },
      primary: { backgroundColor: '#3b82f6' },
      secondary: { backgroundColor: '#8b5cf6' },
      success: { backgroundColor: '#10b981' },
      warning: { backgroundColor: '#f59e0b' },
      danger: { backgroundColor: '#ef4444' },
    },
    color: {
      inherit: { color: 'inherit' },
      white: { color: '#ffffff' },
      black: { color: '#000000' },
      gray: { color: '#6b7280' },
      primary: { color: '#3b82f6' },
      secondary: { color: '#8b5cf6' },
      success: { color: '#10b981' },
      warning: { color: '#f59e0b' },
      danger: { color: '#ef4444' },
    },
    rounded: {
      none: { borderRadius: '0' },
      sm: { borderRadius: '0.125rem' },
      md: { borderRadius: '0.375rem' },
      lg: { borderRadius: '0.5rem' },
      xl: { borderRadius: '0.75rem' },
      '2xl': { borderRadius: '1rem' },
      full: { borderRadius: '9999px' },
    },
    shadow: {
      none: { boxShadow: 'none' },
      sm: { boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)' },
      md: { boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' },
      lg: { boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)' },
      xl: { boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)' },
    },
    border: {
      none: { border: 'none' },
      default: { border: '1px solid #e5e7eb' },
      thick: { border: '2px solid #e5e7eb' },
    },
  },
});

export type { BoxProps } from '../../primitives/Box.js';
