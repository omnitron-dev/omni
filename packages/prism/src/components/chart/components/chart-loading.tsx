'use client';

/**
 * Chart Loading Component
 *
 * Skeleton placeholder shown while chart is loading.
 *
 * @module @omnitron/prism/components/chart
 */

import type { ChartLoadingProps, ChartType } from '../types.js';

import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';

import { cn } from '../../../utils/cn.js';
import { chartClasses } from '../classes.js';

// =============================================================================
// CIRCULAR CHART TYPES
// =============================================================================

const CIRCULAR_TYPES: ChartType[] = ['donut', 'radialBar', 'pie', 'polarArea'];

// =============================================================================
// CHART LOADING
// =============================================================================

/**
 * Loading skeleton for charts.
 *
 * Displays a skeleton placeholder with shape appropriate for the chart type.
 *
 * @example
 * ```tsx
 * <ChartLoading type="pie" />
 * <ChartLoading type="bar" />
 * ```
 */
export function ChartLoading({ sx, className, type, ...other }: ChartLoadingProps) {
  const isCircular = type && CIRCULAR_TYPES.includes(type);

  return (
    <Box
      className={cn(chartClasses.loading, className)}
      sx={[
        {
          top: 0,
          left: 0,
          width: 1,
          zIndex: 9,
          height: 1,
          p: 'inherit',
          overflow: 'hidden',
          alignItems: 'center',
          position: 'absolute',
          borderRadius: 'inherit',
          justifyContent: 'center',
          display: 'flex',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      <Skeleton
        variant="circular"
        sx={{
          width: 1,
          height: 1,
          borderRadius: 'inherit',
          ...(isCircular && { borderRadius: '50%' }),
        }}
      />
    </Box>
  );
}
