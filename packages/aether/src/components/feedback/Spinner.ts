/**
 * Styled Spinner Component
 *
 * Loading spinner with multiple variants and sizes.
 * Built on top of the Spinner primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import { Spinner as SpinnerPrimitive, type SpinnerProps as SpinnerPrimitiveProps } from '../../primitives/Spinner.js';

/**
 * Spinner - Loading spinner component
 *
 * @example
 * ```tsx
 * <Spinner size="md" variant="border" colorScheme="primary" />
 * <Spinner size="lg" variant="dots" />
 * ```
 */
export const Spinner = styled<
  SpinnerPrimitiveProps,
  {
    size: {
      xs: {};
      sm: {};
      md: {};
      lg: {};
      xl: {};
    };
    variant: {
      border: {};
      dots: {};
      grow: {};
    };
    colorScheme: {
      primary: {};
      secondary: {};
      success: {};
      warning: {};
      danger: {};
      gray: {};
    };
  }
>(SpinnerPrimitive, {
  base: {
    display: 'inline-block',
    verticalAlign: 'middle',
  },
  variants: {
    size: {
      xs: {
        width: '1rem',
        height: '1rem',
      },
      sm: {
        width: '1.5rem',
        height: '1.5rem',
      },
      md: {
        width: '2rem',
        height: '2rem',
      },
      lg: {
        width: '2.5rem',
        height: '2.5rem',
      },
      xl: {
        width: '3rem',
        height: '3rem',
      },
    },
    variant: {
      border: {
        border: '0.25em solid currentColor',
        borderRightColor: 'transparent',
        borderRadius: '50%',
        animation: 'spinner-border 0.75s linear infinite',
      },
      dots: {
        position: 'relative',
        '&::before, &::after': {
          content: '""',
          position: 'absolute',
          width: '25%',
          height: '25%',
          borderRadius: '50%',
          backgroundColor: 'currentColor',
          animation: 'spinner-dots 1.2s infinite ease-in-out both',
        },
        '&::before': {
          left: '0',
          animationDelay: '-0.32s',
        },
        '&::after': {
          right: '0',
        },
      },
      grow: {
        borderRadius: '50%',
        backgroundColor: 'currentColor',
        opacity: '0',
        animation: 'spinner-grow 0.75s linear infinite',
      },
    },
    colorScheme: {
      primary: {
        color: '#3b82f6',
      },
      secondary: {
        color: '#8b5cf6',
      },
      success: {
        color: '#10b981',
      },
      warning: {
        color: '#f59e0b',
      },
      danger: {
        color: '#ef4444',
      },
      gray: {
        color: '#6b7280',
      },
    },
  },
  defaultVariants: {
    size: 'md' as const,
    variant: 'border' as const,
    colorScheme: 'primary' as const,
  },
});

// Display name
Spinner.displayName = 'Spinner';

// Type exports
export type { SpinnerPrimitiveProps as SpinnerProps };
