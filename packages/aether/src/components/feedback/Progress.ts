/**
 * Styled Progress Component
 *
 * Progress indicators for linear and circular progress.
 * Built on top of the Progress primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  Progress as ProgressPrimitive,
  ProgressIndicator as ProgressIndicatorPrimitive,
  type ProgressProps as ProgressPrimitiveProps,
} from '../../primitives/Progress.js';

/**
 * Progress - Styled progress bar component
 *
 * @example
 * ```tsx
 * <Progress value={progress()} size="md" variant="primary">
 *   <Progress.Indicator />
 * </Progress>
 * ```
 */
export const Progress = styled<
  {
    size?: 'sm' | 'md' | 'lg';
    variant?: 'primary' | 'success' | 'warning' | 'danger' | 'gray';
  },
  ProgressPrimitiveProps
>(ProgressPrimitive, {
  base: {
    position: 'relative',
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#e5e7eb',
    borderRadius: '9999px',
  },
  variants: {
    size: {
      sm: {
        height: '0.5rem',
      },
      md: {
        height: '0.75rem',
      },
      lg: {
        height: '1rem',
      },
    },
    variant: {
      primary: {},
      success: {},
      warning: {},
      danger: {},
      gray: {},
    },
  },
  defaultVariants: {
    size: 'md',
    variant: 'primary',
  },
});

/**
 * ProgressIndicator - Visual progress indicator
 */
export const ProgressIndicator = styled<{
  variant?: 'primary' | 'success' | 'warning' | 'danger' | 'gray';
}>(ProgressIndicatorPrimitive, {
  base: {
    height: '100%',
    width: '100%',
    transition: 'transform 0.3s ease',
    '&[data-state="indeterminate"]': {
      animation: 'progress-indeterminate 1.5s ease-in-out infinite',
    },
  },
  variants: {
    variant: {
      primary: {
        backgroundColor: '#3b82f6',
      },
      success: {
        backgroundColor: '#10b981',
      },
      warning: {
        backgroundColor: '#f59e0b',
      },
      danger: {
        backgroundColor: '#ef4444',
      },
      gray: {
        backgroundColor: '#6b7280',
      },
    },
  },
  defaultVariants: {
    variant: 'primary',
  },
});

// Attach sub-components
(Progress as any).Indicator = ProgressIndicator;

// Display names
Progress.displayName = 'Progress';
ProgressIndicator.displayName = 'ProgressIndicator';

// Type exports
export type { ProgressPrimitiveProps as ProgressProps };
