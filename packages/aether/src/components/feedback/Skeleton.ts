/**
 * Styled Skeleton Component
 *
 * Loading content placeholder with animation.
 * Built on top of the Skeleton primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  Skeleton as SkeletonPrimitive,
  type SkeletonProps as SkeletonPrimitiveProps,
} from '../../primitives/Skeleton.js';

/**
 * Skeleton - Loading placeholder component
 *
 * @example
 * ```tsx
 * <Skeleton width="100px" height="20px" variant="text" />
 * <Skeleton width="200px" height="200px" variant="rectangular" />
 * <Skeleton width="40px" height="40px" variant="circular" />
 * ```
 */
export const Skeleton = styled<
  {
    variant?: 'text' | 'rectangular' | 'circular';
    animation?: 'pulse' | 'wave' | 'none';
  },
  SkeletonPrimitiveProps
>(SkeletonPrimitive, {
  base: {
    backgroundColor: '#e5e7eb',
    display: 'inline-block',
    position: 'relative',
    overflow: 'hidden',
    '&::after': {
      content: '""',
      position: 'absolute',
      top: '0',
      right: '0',
      bottom: '0',
      left: '0',
      transform: 'translateX(-100%)',
      background:
        'linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.2) 20%, rgba(255, 255, 255, 0.5) 60%, rgba(255, 255, 255, 0))',
    },
  },
  variants: {
    variant: {
      text: {
        borderRadius: '0.25rem',
        height: '1em',
        marginTop: '0',
        marginBottom: '0',
        '&:empty::before': {
          content: '"\\00a0"',
        },
      },
      rectangular: {
        borderRadius: '0.375rem',
      },
      circular: {
        borderRadius: '50%',
      },
    },
    animation: {
      pulse: {
        animation: 'skeleton-pulse 1.5s ease-in-out 0.5s infinite',
      },
      wave: {
        '&::after': {
          animation: 'skeleton-wave 1.6s linear 0.5s infinite',
        },
      },
      none: {
        animation: 'none',
        '&::after': {
          display: 'none',
        },
      },
    },
  },
  defaultVariants: {
    variant: 'text',
    animation: 'pulse',
  },
});

// Display name
Skeleton.displayName = 'Skeleton';

// Type exports
export type { SkeletonPrimitiveProps as SkeletonProps };
