/**
 * VirtualList Component (Styled)
 *
 * A styled virtualized list component for rendering large datasets:
 * - Smooth scrolling
 * - Optimized rendering
 * - Border and shadow variants
 */

import { styled } from '../../styling/styled.js';
import {
  VirtualList as VirtualListPrimitive,
  type VirtualListProps as VirtualListPrimitiveProps,
} from '../../primitives/VirtualList.js';

// ============================================================================
// Styled Component
// ============================================================================

/**
 * VirtualList - Styled virtualized list
 */
export const VirtualList = styled<
  VirtualListPrimitiveProps & {
    variant?: 'default' | 'bordered' | 'elevated';
  }
>(VirtualListPrimitive, {
  base: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: '0.5rem',
  },
  variants: {
    variant: {
      default: {},
      bordered: {
        border: '1px solid #e5e7eb',
      },
      elevated: {
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
      },
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

// ============================================================================
// Display name
// ============================================================================

VirtualList.displayName = 'VirtualList';

// ============================================================================
// Type exports
// ============================================================================

export type { VirtualListPrimitiveProps as VirtualListProps };
