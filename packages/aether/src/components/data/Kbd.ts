/**
 * Kbd Component (Styled)
 *
 * A styled keyboard key component for displaying keyboard shortcuts:
 * - Multiple size variants
 * - Visual styles matching keyboard keys
 * - Support for key combinations
 */

import { styled } from '../../styling/styled.js';
import { Kbd as KbdPrimitive, type KbdProps as KbdPrimitiveProps } from '../../primitives/Kbd.js';

// ============================================================================
// Styled Component
// ============================================================================

/**
 * Kbd - Styled keyboard key component
 */
export const Kbd = styled<
  {
    size?: 'sm' | 'md' | 'lg';
    variant?: 'solid' | 'outline' | 'subtle';
  },
  KbdPrimitiveProps
>(KbdPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontWeight: '600',
    lineHeight: '1',
    borderRadius: '0.25rem',
    whiteSpace: 'nowrap',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    transition: 'all 0.15s ease',
  },
  variants: {
    size: {
      sm: {
        fontSize: '0.625rem',
        padding: '0.125rem 0.25rem',
        minWidth: '1.25rem',
        height: '1.25rem',
      },
      md: {
        fontSize: '0.75rem',
        padding: '0.25rem 0.375rem',
        minWidth: '1.5rem',
        height: '1.5rem',
      },
      lg: {
        fontSize: '0.875rem',
        padding: '0.375rem 0.5rem',
        minWidth: '2rem',
        height: '2rem',
      },
    },
    variant: {
      solid: {
        backgroundColor: '#374151',
        color: '#ffffff',
        boxShadow: '0 2px 0 0 rgba(0, 0, 0, 0.2), inset 0 1px 0 0 rgba(255, 255, 255, 0.1)',
        border: '1px solid #1f2937',
      },
      outline: {
        backgroundColor: '#ffffff',
        color: '#374151',
        border: '1px solid #d1d5db',
        boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
      },
      subtle: {
        backgroundColor: '#f3f4f6',
        color: '#374151',
        border: '1px solid #e5e7eb',
        boxShadow: '0 1px 0 0 rgba(0, 0, 0, 0.05)',
      },
    },
  },
  defaultVariants: {
    size: 'md',
    variant: 'solid',
  },
});

// ============================================================================
// Display name
// ============================================================================

Kbd.displayName = 'Kbd';

// ============================================================================
// Type exports
// ============================================================================

export type { KbdPrimitiveProps as KbdProps };
