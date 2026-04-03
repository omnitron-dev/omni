'use client';

/**
 * Skeleton Component
 *
 * Loading placeholder with multiple variants.
 *
 * @module @omnitron-dev/prism/components/skeleton
 */

import type { ReactNode, ComponentProps } from 'react';
import MuiSkeleton from '@mui/material/Skeleton';
import Box from '@mui/material/Box';

/**
 * Skeleton variant types.
 */
export type SkeletonVariant = 'text' | 'circular' | 'rectangular' | 'rounded';

/**
 * Props for Skeleton component.
 */
export interface SkeletonProps extends ComponentProps<typeof MuiSkeleton> {
  /** Skeleton variant */
  variant?: SkeletonVariant;
}

/**
 * Skeleton - Loading placeholder component.
 *
 * @example
 * ```tsx
 * // Text skeleton
 * <Skeleton variant="text" width={200} />
 *
 * // Circular skeleton (avatar placeholder)
 * <Skeleton variant="circular" width={40} height={40} />
 *
 * // Rectangular skeleton (image placeholder)
 * <Skeleton variant="rectangular" width={210} height={118} />
 * ```
 */
export function Skeleton({ variant = 'text', ...props }: SkeletonProps): ReactNode {
  return <MuiSkeleton variant={variant} {...props} />;
}

/**
 * Props for CardSkeleton component.
 */
export interface CardSkeletonProps {
  /** Show avatar placeholder */
  hasAvatar?: boolean;
  /** Number of text lines */
  lines?: number;
  /** Card width */
  width?: number | string;
}

/**
 * CardSkeleton - Pre-composed card loading skeleton.
 *
 * @example
 * ```tsx
 * <CardSkeleton hasAvatar lines={3} />
 * ```
 */
export function CardSkeleton({ hasAvatar = true, lines = 2, width = '100%' }: CardSkeletonProps): ReactNode {
  return (
    <Box sx={{ width, p: 2 }}>
      {hasAvatar && (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Skeleton variant="circular" width={40} height={40} />
          <Box sx={{ ml: 1, flex: 1 }}>
            <Skeleton variant="text" width="60%" />
            <Skeleton variant="text" width="40%" />
          </Box>
        </Box>
      )}
      <Skeleton variant="rectangular" width="100%" height={118} sx={{ borderRadius: 1 }} />
      <Box sx={{ mt: 1 }}>
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} variant="text" width={i === lines - 1 ? '80%' : '100%'} />
        ))}
      </Box>
    </Box>
  );
}

/**
 * Props for TableSkeleton component.
 */
export interface TableSkeletonProps {
  /** Number of rows */
  rows?: number;
  /** Number of columns */
  columns?: number;
  /** Show header */
  hasHeader?: boolean;
}

/**
 * TableSkeleton - Pre-composed table loading skeleton.
 *
 * @example
 * ```tsx
 * <TableSkeleton rows={5} columns={4} />
 * ```
 */
export function TableSkeleton({ rows = 5, columns = 4, hasHeader = true }: TableSkeletonProps): ReactNode {
  return (
    <Box sx={{ width: '100%' }}>
      {hasHeader && (
        <Box sx={{ display: 'flex', gap: 2, mb: 1, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
          {Array.from({ length: columns }, (_, i) => (
            <Skeleton key={i} variant="text" sx={{ flex: 1 }} height={24} />
          ))}
        </Box>
      )}
      {Array.from({ length: rows }, (_row, rowIndex) => (
        <Box key={rowIndex} sx={{ display: 'flex', gap: 2, py: 1 }}>
          {Array.from({ length: columns }, (_col, colIndex) => (
            <Skeleton key={colIndex} variant="text" sx={{ flex: 1 }} />
          ))}
        </Box>
      ))}
    </Box>
  );
}
