'use client';

/**
 * Chart Component
 *
 * Lazy-loaded ApexCharts wrapper with theme integration and SSR support.
 *
 * @module @omnitron/prism/components/chart
 */

import type { ChartProps } from './types.js';

import { lazy, Suspense, useState, useEffect, type ComponentType } from 'react';

import { styled } from '@mui/material/styles';

import { cn } from '../../utils/cn.js';
import { chartClasses } from './classes.js';
import { ChartLoading } from './components/index.js';

// =============================================================================
// LAZY LOADED APEX CHARTS
// =============================================================================

/**
 * ApexChart component props (minimal type for lazy loading).
 */
interface ApexChartProps {
  type?: string;
  series?: unknown;
  options?: unknown;
  width?: string | number;
  height?: string | number;
}

const LazyApexChart = lazy(() =>
  import('react-apexcharts').then((module) => ({
    default: module.default as ComponentType<ApexChartProps>,
  }))
);

// =============================================================================
// CHART COMPONENT
// =============================================================================

/**
 * Theme-aware chart component using ApexCharts.
 *
 * Features:
 * - Lazy loading with Suspense
 * - SSR-safe (only renders on client)
 * - Theme-integrated styles
 * - Loading skeleton placeholder
 *
 * @example
 * ```tsx
 * import { Chart, useChart } from '@omnitron/prism/components';
 *
 * function MyChart() {
 *   const chartOptions = useChart({
 *     xaxis: { categories: ['Jan', 'Feb', 'Mar'] },
 *   });
 *
 *   return (
 *     <Chart
 *       type="line"
 *       series={[{ name: 'Sales', data: [10, 20, 30] }]}
 *       options={chartOptions}
 *       height={320}
 *     />
 *   );
 * }
 * ```
 */
export function Chart({
  type,
  series,
  options,
  width = '100%',
  height = '100%',
  slotProps,
  className,
  sx,
  ...other
}: ChartProps) {
  const [isClient, setIsClient] = useState(false);

  // SSR safety: only render chart on client
  useEffect(() => {
    setIsClient(true);
  }, []);

  const renderFallback = () => <ChartLoading type={type} sx={slotProps?.loading} />;

  return (
    <ChartRoot dir="ltr" className={cn(chartClasses.root, className)} sx={sx} {...other}>
      {isClient ? (
        <Suspense fallback={renderFallback()}>
          <LazyApexChart type={type} series={series} options={options} width={width} height={height} />
        </Suspense>
      ) : (
        renderFallback()
      )}
    </ChartRoot>
  );
}

// =============================================================================
// STYLED COMPONENTS
// =============================================================================

const ChartRoot = styled('div')(({ theme }) => ({
  width: '100%',
  flexShrink: 0,
  position: 'relative',
  borderRadius: Number(theme.shape.borderRadius) * 1.5,
}));
