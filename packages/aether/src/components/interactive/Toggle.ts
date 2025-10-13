/**
 * Styled Toggle Component
 *
 * Two-state toggle button.
 * Built on top of the Toggle primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import { Toggle as TogglePrimitive, type ToggleProps as TogglePrimitiveProps } from '../../primitives/Toggle.js';

/**
 * Toggle - Toggle button component
 */
export const Toggle = styled<{
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'outline';
}>(TogglePrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '0.375rem',
    fontWeight: '500',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#111827',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    '&:hover': {
      backgroundColor: '#f3f4f6',
    },
    '&:focus': {
      outline: 'none',
      boxShadow: '0 0 0 2px #3b82f6',
    },
    '&[data-state="on"]': {
      backgroundColor: '#eff6ff',
      color: '#1e40af',
    },
    '&[data-disabled]': {
      opacity: '0.5',
      pointerEvents: 'none',
    },
  },
  variants: {
    size: {
      sm: {
        height: '2rem',
        padding: '0 0.5rem',
        fontSize: '0.8125rem',
      },
      md: {
        height: '2.5rem',
        padding: '0 0.75rem',
        fontSize: '0.875rem',
      },
      lg: {
        height: '3rem',
        padding: '0 1rem',
        fontSize: '1rem',
      },
    },
    variant: {
      default: {},
      outline: {
        border: '1px solid #e5e7eb',
        '&[data-state="on"]': {
          backgroundColor: '#3b82f6',
          borderColor: '#3b82f6',
          color: '#ffffff',
        },
      },
    },
  },
  defaultVariants: {
    size: 'md',
    variant: 'default',
  },
});

// Display name
Toggle.displayName = 'Toggle';

// Type exports
export type { TogglePrimitiveProps as ToggleProps };
