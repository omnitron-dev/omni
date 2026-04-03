/**
 * Chart Component Types
 *
 * Type definitions for the Chart component using ApexCharts.
 * Types are defined locally to avoid requiring react-apexcharts installation.
 *
 * @module @omnitron-dev/prism/components/chart
 */

import type { Theme, SxProps } from '@mui/material/styles';

// =============================================================================
// APEX CHARTS TYPES (Local definitions to avoid peer dependency requirement)
// =============================================================================

/**
 * ApexCharts options type.
 * This is a simplified version - full types available with react-apexcharts.
 */
export interface ChartOptions {
  chart?: {
    type?: ChartType;
    toolbar?: { show?: boolean };
    zoom?: { enabled?: boolean };
    parentHeightOffset?: number;
    fontFamily?: string;
    foreColor?: string;
    animations?: {
      enabled?: boolean;
      speed?: number;
      animateGradually?: { enabled?: boolean; delay?: number };
      dynamicAnimation?: { enabled?: boolean; speed?: number };
    };
    [key: string]: unknown;
  };
  colors?: string[];
  states?: {
    hover?: { filter?: { type?: string } };
    active?: { filter?: { type?: string } };
  };
  fill?: {
    type?: string;
    opacity?: number;
    gradient?: {
      type?: string;
      shadeIntensity?: number;
      opacityFrom?: number;
      opacityTo?: number;
      stops?: number[];
    };
  };
  dataLabels?: { enabled?: boolean };
  stroke?: { width?: number; curve?: string; lineCap?: string };
  grid?: {
    strokeDashArray?: number;
    borderColor?: string;
    padding?: { top?: number; right?: number; bottom?: number; left?: number };
    xaxis?: { lines?: { show?: boolean } };
  };
  xaxis?: {
    categories?: string[];
    axisBorder?: { show?: boolean };
    axisTicks?: { show?: boolean };
    [key: string]: unknown;
  };
  yaxis?: { tickAmount?: number; [key: string]: unknown } | Array<{ tickAmount?: number; [key: string]: unknown }>;
  markers?: { size?: number; strokeColors?: string };
  tooltip?: {
    enabled?: boolean;
    theme?: string;
    fillSeriesColor?: boolean;
    x?: { show?: boolean; format?: string };
    y?: { formatter?: (val: number) => string; title?: { formatter?: (seriesName: string) => string } };
    marker?: { show?: boolean };
  };
  legend?: {
    show?: boolean;
    position?: string;
    fontWeight?: number;
    fontSize?: string;
    horizontalAlign?: string;
    markers?: { shape?: string };
    labels?: { colors?: string };
    itemMargin?: { horizontal?: number; vertical?: number };
  };
  plotOptions?: {
    bar?: { borderRadius?: number; columnWidth?: string; borderRadiusApplication?: string };
    pie?: { donut?: { size?: string; labels?: { show?: boolean; value?: object; total?: object } } };
    radialBar?: { hollow?: object; track?: object; dataLabels?: object };
    radar?: { polygons?: { fill?: object; strokeColors?: string; connectorColors?: string } };
    polarArea?: { rings?: { strokeColor?: string }; spokes?: { connectorColors?: string } };
    heatmap?: { distributed?: boolean };
  };
  responsive?: Array<{ breakpoint?: number; options?: object }>;
  [key: string]: unknown;
}

/**
 * Chart data series.
 */
export type ChartSeries =
  | Array<{
      name?: string;
      data: number[] | number[][] | Array<{ x: string | number; y: number }>;
      type?: string;
      [key: string]: unknown;
    }>
  | number[];

/**
 * Supported chart types.
 */
export type ChartType =
  | 'line'
  | 'area'
  | 'bar'
  | 'pie'
  | 'donut'
  | 'radialBar'
  | 'scatter'
  | 'bubble'
  | 'heatmap'
  | 'candlestick'
  | 'boxPlot'
  | 'radar'
  | 'polarArea'
  | 'rangeBar'
  | 'rangeArea'
  | 'treemap';

// =============================================================================
// CHART PROPS
// =============================================================================

/**
 * Chart component props.
 */
export interface ChartProps extends React.ComponentProps<'div'> {
  /** Chart type (line, bar, pie, etc.) */
  type?: ChartType;
  /** Chart data series */
  series?: ChartSeries;
  /** ApexCharts options */
  options?: ChartOptions;
  /** Chart width (default: 100%) */
  width?: string | number;
  /** Chart height (default: 100%) */
  height?: string | number;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
  /** Slot props for internal components */
  slotProps?: {
    /** Loading skeleton styles */
    loading?: SxProps<Theme>;
  };
}

// =============================================================================
// CHART LOADING PROPS
// =============================================================================

/**
 * Chart loading skeleton props.
 */
export interface ChartLoadingProps extends React.ComponentProps<'div'> {
  /** Chart type (affects skeleton shape) */
  type?: ChartType;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

// =============================================================================
// CHART LEGENDS PROPS
// =============================================================================

/**
 * Chart legends component props.
 */
export interface ChartLegendsProps extends React.ComponentProps<'ul'> {
  /** Legend labels */
  labels?: string[];
  /** Legend colors */
  colors?: string[];
  /** Legend values */
  values?: string[];
  /** Legend sublabels */
  sublabels?: string[];
  /** Custom icons */
  icons?: React.ReactNode[];
  /** MUI sx prop */
  sx?: SxProps<Theme>;
  /** Slot props for internal components */
  slotProps?: {
    wrapper?: React.ComponentProps<'li'> & { sx?: SxProps<Theme> };
    root?: React.ComponentProps<'div'>;
    dot?: React.ComponentProps<'span'>;
    icon?: React.ComponentProps<'span'>;
    value?: React.ComponentProps<'span'>;
    label?: React.ComponentProps<'span'>;
  };
}
