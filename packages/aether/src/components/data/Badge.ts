/**
 * Badge Component (Styled)
 *
 * A styled badge component for status indicators, counts, and labels:
 * - Multiple visual variants (solid, outline, subtle)
 * - Color schemes for different states
 * - Size variants
 * - Pill and square shapes
 */

import { styled } from '../../styling/styled.js';
import { Badge as BadgePrimitive, type BadgeProps as BadgePrimitiveProps } from '../../primitives/Badge.js';

// ============================================================================
// Styled Component
// ============================================================================

/**
 * Badge - Styled badge component
 */
export const Badge = styled<BadgePrimitiveProps>(BadgePrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '500',
    lineHeight: '1',
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap',
  },
  variants: {
    size: {
      sm: {
        fontSize: '0.625rem',
        padding: '0.125rem 0.375rem',
        height: '1.25rem',
      },
      md: {
        fontSize: '0.75rem',
        padding: '0.25rem 0.5rem',
        height: '1.5rem',
      },
      lg: {
        fontSize: '0.875rem',
        padding: '0.375rem 0.75rem',
        height: '2rem',
      },
    },
    variant: {
      solid: {},
      outline: {
        backgroundColor: 'transparent',
        borderWidth: '1px',
        borderStyle: 'solid',
      },
      subtle: {},
    },
    colorScheme: {
      gray: {},
      primary: {},
      success: {},
      warning: {},
      danger: {},
      info: {},
    },
    shape: {
      rounded: {
        borderRadius: '0.25rem',
      },
      pill: {
        borderRadius: '9999px',
      },
      square: {
        borderRadius: '0',
      },
    },
  },
  compoundVariants: [
    // Solid variants
    {
      variant: 'solid',
      colorScheme: 'gray',
      css: {
        backgroundColor: '#6b7280',
        color: '#ffffff',
      },
    },
    {
      variant: 'solid',
      colorScheme: 'primary',
      css: {
        backgroundColor: '#3b82f6',
        color: '#ffffff',
      },
    },
    {
      variant: 'solid',
      colorScheme: 'success',
      css: {
        backgroundColor: '#10b981',
        color: '#ffffff',
      },
    },
    {
      variant: 'solid',
      colorScheme: 'warning',
      css: {
        backgroundColor: '#f59e0b',
        color: '#ffffff',
      },
    },
    {
      variant: 'solid',
      colorScheme: 'danger',
      css: {
        backgroundColor: '#ef4444',
        color: '#ffffff',
      },
    },
    {
      variant: 'solid',
      colorScheme: 'info',
      css: {
        backgroundColor: '#06b6d4',
        color: '#ffffff',
      },
    },
    // Outline variants
    {
      variant: 'outline',
      colorScheme: 'gray',
      css: {
        borderColor: '#6b7280',
        color: '#6b7280',
      },
    },
    {
      variant: 'outline',
      colorScheme: 'primary',
      css: {
        borderColor: '#3b82f6',
        color: '#3b82f6',
      },
    },
    {
      variant: 'outline',
      colorScheme: 'success',
      css: {
        borderColor: '#10b981',
        color: '#10b981',
      },
    },
    {
      variant: 'outline',
      colorScheme: 'warning',
      css: {
        borderColor: '#f59e0b',
        color: '#f59e0b',
      },
    },
    {
      variant: 'outline',
      colorScheme: 'danger',
      css: {
        borderColor: '#ef4444',
        color: '#ef4444',
      },
    },
    {
      variant: 'outline',
      colorScheme: 'info',
      css: {
        borderColor: '#06b6d4',
        color: '#06b6d4',
      },
    },
    // Subtle variants
    {
      variant: 'subtle',
      colorScheme: 'gray',
      css: {
        backgroundColor: '#f3f4f6',
        color: '#374151',
      },
    },
    {
      variant: 'subtle',
      colorScheme: 'primary',
      css: {
        backgroundColor: '#dbeafe',
        color: '#1e40af',
      },
    },
    {
      variant: 'subtle',
      colorScheme: 'success',
      css: {
        backgroundColor: '#d1fae5',
        color: '#065f46',
      },
    },
    {
      variant: 'subtle',
      colorScheme: 'warning',
      css: {
        backgroundColor: '#fef3c7',
        color: '#92400e',
      },
    },
    {
      variant: 'subtle',
      colorScheme: 'danger',
      css: {
        backgroundColor: '#fee2e2',
        color: '#991b1b',
      },
    },
    {
      variant: 'subtle',
      colorScheme: 'info',
      css: {
        backgroundColor: '#cffafe',
        color: '#155e75',
      },
    },
  ],
  defaultVariants: {
    size: 'md',
    variant: 'solid',
    colorScheme: 'gray',
    shape: 'rounded',
  },
});

// ============================================================================
// Display name
// ============================================================================

Badge.displayName = 'Badge';

// ============================================================================
// Type exports
// ============================================================================

export type { BadgePrimitiveProps as BadgeProps };
