/**
 * Code Component (Styled)
 *
 * A styled code component for displaying code snippets:
 * - Inline and block variants
 * - Multiple color schemes
 * - Syntax highlighting support
 * - Size variants
 */

import { styled } from '../../styling/styled.js';
import { Code as CodePrimitive, type CodeProps as CodePrimitiveProps } from '../../primitives/Code.js';

// ============================================================================
// Styled Component
// ============================================================================

/**
 * Code - Styled code component
 */
export const Code = styled<
  {
    size?: 'sm' | 'md' | 'lg';
    variant?: 'solid' | 'outline' | 'ghost';
    colorScheme?: 'gray' | 'primary' | 'success' | 'warning' | 'danger';
  },
  CodePrimitiveProps
>(CodePrimitive, {
  base: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontWeight: '400',
    borderRadius: '0.25rem',
    transition: 'all 0.15s ease',
  },
  variants: {
    size: {
      sm: {
        fontSize: '0.75rem',
        padding: '0.125rem 0.25rem',
      },
      md: {
        fontSize: '0.875rem',
        padding: '0.25rem 0.5rem',
      },
      lg: {
        fontSize: '1rem',
        padding: '0.375rem 0.625rem',
      },
    },
    variant: {
      solid: {},
      outline: {
        backgroundColor: 'transparent',
        borderWidth: '1px',
        borderStyle: 'solid',
      },
      ghost: {
        backgroundColor: 'transparent',
      },
    },
    colorScheme: {
      gray: {},
      primary: {},
      success: {},
      warning: {},
      danger: {},
    },
  },
  compoundVariants: [
    // Solid variants
    {
      variant: 'solid',
      colorScheme: 'gray',
      css: {
        backgroundColor: '#f3f4f6',
        color: '#1f2937',
      },
    },
    {
      variant: 'solid',
      colorScheme: 'primary',
      css: {
        backgroundColor: '#dbeafe',
        color: '#1e40af',
      },
    },
    {
      variant: 'solid',
      colorScheme: 'success',
      css: {
        backgroundColor: '#d1fae5',
        color: '#065f46',
      },
    },
    {
      variant: 'solid',
      colorScheme: 'warning',
      css: {
        backgroundColor: '#fef3c7',
        color: '#92400e',
      },
    },
    {
      variant: 'solid',
      colorScheme: 'danger',
      css: {
        backgroundColor: '#fee2e2',
        color: '#991b1b',
      },
    },
    // Outline variants
    {
      variant: 'outline',
      colorScheme: 'gray',
      css: {
        borderColor: '#d1d5db',
        color: '#1f2937',
      },
    },
    {
      variant: 'outline',
      colorScheme: 'primary',
      css: {
        borderColor: '#3b82f6',
        color: '#1e40af',
      },
    },
    {
      variant: 'outline',
      colorScheme: 'success',
      css: {
        borderColor: '#10b981',
        color: '#065f46',
      },
    },
    {
      variant: 'outline',
      colorScheme: 'warning',
      css: {
        borderColor: '#f59e0b',
        color: '#92400e',
      },
    },
    {
      variant: 'outline',
      colorScheme: 'danger',
      css: {
        borderColor: '#ef4444',
        color: '#991b1b',
      },
    },
    // Ghost variants
    {
      variant: 'ghost',
      colorScheme: 'gray',
      css: {
        color: '#6b7280',
      },
    },
    {
      variant: 'ghost',
      colorScheme: 'primary',
      css: {
        color: '#3b82f6',
      },
    },
    {
      variant: 'ghost',
      colorScheme: 'success',
      css: {
        color: '#10b981',
      },
    },
    {
      variant: 'ghost',
      colorScheme: 'warning',
      css: {
        color: '#f59e0b',
      },
    },
    {
      variant: 'ghost',
      colorScheme: 'danger',
      css: {
        color: '#ef4444',
      },
    },
  ],
  defaultVariants: {
    size: 'md',
    variant: 'solid',
    colorScheme: 'gray',
  },
});

// ============================================================================
// Display name
// ============================================================================

Code.displayName = 'Code';

// ============================================================================
// Type exports
// ============================================================================

export type { CodePrimitiveProps as CodeProps };
