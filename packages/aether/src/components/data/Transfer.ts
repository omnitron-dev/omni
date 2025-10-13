/**
 * Transfer Component (Styled)
 *
 * A styled transfer component for moving items between lists:
 * - Source and target list styling
 * - Control buttons
 * - Item selection states
 * - Size variants
 */

import { styled } from '../../styling/styled.js';
import {
  Transfer as TransferPrimitive,
  TransferList as TransferListPrimitive,
  TransferControls as TransferControlsPrimitive,
  type TransferProps as TransferPrimitiveProps,
} from '../../primitives/Transfer.js';

// ============================================================================
// Styled Components
// ============================================================================

/**
 * Transfer Root - Styled transfer container
 */
export const Transfer = styled<
  TransferPrimitiveProps & {
    size?: 'sm' | 'md' | 'lg';
  }
>(TransferPrimitive, {
  base: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  variants: {
    size: {
      sm: {
        gap: '0.75rem',
      },
      md: {
        gap: '1rem',
      },
      lg: {
        gap: '1.5rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * Transfer List - Styled transfer list container
 */
export const TransferList = styled<
  {
    size?: 'sm' | 'md' | 'lg';
  },
  any
>(TransferListPrimitive, {
  base: {
    width: '15rem',
    minHeight: '20rem',
    border: '1px solid #e5e7eb',
    borderRadius: '0.5rem',
    backgroundColor: '#ffffff',
    overflow: 'auto',
    padding: '0.5rem',
  },
  variants: {
    size: {
      sm: {
        width: '12rem',
        minHeight: '16rem',
        padding: '0.375rem',
      },
      md: {
        width: '15rem',
        minHeight: '20rem',
        padding: '0.5rem',
      },
      lg: {
        width: '18rem',
        minHeight: '24rem',
        padding: '0.75rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * Transfer Controls - Styled transfer controls container
 */
export const TransferControls = styled<
  {
    size?: 'sm' | 'md' | 'lg';
  },
  any
>(TransferControlsPrimitive, {
  base: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  variants: {
    size: {
      sm: {
        gap: '0.375rem',
      },
      md: {
        gap: '0.5rem',
      },
      lg: {
        gap: '0.75rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

// ============================================================================
// Attach sub-components
// ============================================================================

(Transfer as any).List = TransferList;
(Transfer as any).Controls = TransferControls;

// ============================================================================
// Display names
// ============================================================================

Transfer.displayName = 'Transfer';
TransferList.displayName = 'Transfer.List';
TransferControls.displayName = 'Transfer.Controls';

// ============================================================================
// Type exports
// ============================================================================

export type { TransferPrimitiveProps as TransferProps };
