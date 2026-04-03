/**
 * Chart Component
 *
 * Theme-aware ApexCharts wrapper with lazy loading and SSR support.
 *
 * @module @omnitron/prism/components/chart
 */

// Main component
export { Chart } from './chart.js';

// Hook
export { useChart } from './use-chart.js';

// Subcomponents
export { ChartLoading, ChartLegends } from './components/index.js';

// Classes
export { chartClasses } from './classes.js';

// Types
export type {
  ChartProps,
  ChartOptions,
  ChartSeries,
  ChartType,
  ChartLoadingProps,
  ChartLegendsProps,
} from './types.js';

// Import styles for side effects
import './styles.css';
