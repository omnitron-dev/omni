/**
 * useChart Hook
 *
 * Creates theme-aware ApexCharts options with sensible defaults.
 * Merges custom options with base theme-integrated options.
 *
 * @module @omnitron/prism/components/chart
 */

import type { Theme } from '@mui/material/styles';
import type { ChartOptions } from './types.js';

import { useTheme } from '@mui/material/styles';

// =============================================================================
// USE CHART HOOK
// =============================================================================

/**
 * Create theme-aware chart options.
 *
 * @param updatedOptions - Custom options to merge with base options
 * @returns Merged chart options with theme integration
 *
 * @example
 * ```tsx
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
 *     />
 *   );
 * }
 * ```
 */
export function useChart(updatedOptions?: ChartOptions): ChartOptions {
  const theme = useTheme();

  const baseOptions = baseChartOptions(theme) ?? {};

  return deepMerge(baseOptions, updatedOptions ?? {});
}

// =============================================================================
// BASE CHART OPTIONS
// =============================================================================

/**
 * Generate base chart options from theme.
 */
function baseChartOptions(theme: Theme): ChartOptions {
  // Access CSS variables safely
  const vars = theme.vars?.palette;
  const palette = theme.palette;

  // Label styles for donut/radialBar charts
  const LABEL_TOTAL = {
    show: true,
    label: 'Total',
    color: vars?.text.secondary ?? palette.text.secondary,
    fontSize: theme.typography.subtitle2.fontSize as string,
    fontWeight: theme.typography.subtitle2.fontWeight,
  };

  const LABEL_VALUE = {
    offsetY: 8,
    color: vars?.text.primary ?? palette.text.primary,
    fontSize: theme.typography.h4.fontSize as string,
    fontWeight: theme.typography.h4.fontWeight,
  };

  // Get grey channel for opacity calculations
  const greyChannel = getColorChannel(theme, 'grey', '500');
  const dividerColor = vars?.divider ?? palette.divider;
  const paperColor = vars?.background.paper ?? palette.background.paper;

  return {
    // =========================================================================
    // Chart
    // https://apexcharts.com/docs/options/chart/animations/
    // =========================================================================
    chart: {
      toolbar: { show: false },
      zoom: { enabled: false },
      parentHeightOffset: 0,
      fontFamily: theme.typography.fontFamily,
      foreColor: vars?.text.disabled ?? palette.text.disabled,
      animations: {
        enabled: true,
        speed: 360,
        animateGradually: { enabled: true, delay: 120 },
        dynamicAnimation: { enabled: true, speed: 360 },
      },
    },

    // =========================================================================
    // Colors
    // https://apexcharts.com/docs/options/colors/
    // =========================================================================
    colors: [
      palette.primary.main,
      palette.warning.main,
      palette.info.main,
      palette.error.main,
      palette.success.main,
      palette.warning.dark,
      palette.success.dark,
      palette.info.dark,
      palette.primary.dark,
    ],

    // =========================================================================
    // States
    // https://apexcharts.com/docs/options/states/
    // =========================================================================
    states: {
      hover: { filter: { type: 'darken' } },
      active: { filter: { type: 'darken' } },
    },

    // =========================================================================
    // Fill
    // https://apexcharts.com/docs/options/fill/
    // =========================================================================
    fill: {
      opacity: 1,
      gradient: {
        type: 'vertical',
        shadeIntensity: 0,
        opacityFrom: 0.4,
        opacityTo: 0,
        stops: [0, 100],
      },
    },

    // =========================================================================
    // Data Labels
    // https://apexcharts.com/docs/options/datalabels/
    // =========================================================================
    dataLabels: { enabled: false },

    // =========================================================================
    // Stroke
    // https://apexcharts.com/docs/options/stroke/
    // =========================================================================
    stroke: { width: 2.5, curve: 'smooth', lineCap: 'round' },

    // =========================================================================
    // Grid
    // https://apexcharts.com/docs/options/grid/
    // =========================================================================
    grid: {
      strokeDashArray: 3,
      borderColor: dividerColor,
      padding: { top: 0, right: 0, bottom: 0 },
      xaxis: { lines: { show: false } },
    },

    // =========================================================================
    // Axis
    // https://apexcharts.com/docs/options/xaxis/
    // https://apexcharts.com/docs/options/yaxis/
    // =========================================================================
    xaxis: { axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { tickAmount: 5 },

    // =========================================================================
    // Markers
    // https://apexcharts.com/docs/options/markers/
    // =========================================================================
    markers: {
      size: 0,
      strokeColors: paperColor,
    },

    // =========================================================================
    // Tooltip
    // =========================================================================
    tooltip: { theme: 'false', fillSeriesColor: false, x: { show: true } },

    // =========================================================================
    // Legend
    // https://apexcharts.com/docs/options/legend/
    // =========================================================================
    legend: {
      show: false,
      position: 'top',
      fontWeight: 500,
      fontSize: '13px',
      horizontalAlign: 'right',
      markers: { shape: 'circle' },
      labels: { colors: vars?.text.primary ?? palette.text.primary },
      itemMargin: { horizontal: 8, vertical: 8 },
    },

    // =========================================================================
    // Plot Options
    // =========================================================================
    plotOptions: {
      // Bar charts
      // https://apexcharts.com/docs/options/plotoptions/bar/
      bar: { borderRadius: 4, columnWidth: '48%', borderRadiusApplication: 'end' },

      // Pie & Donut charts
      // https://apexcharts.com/docs/options/plotoptions/pie/
      pie: {
        donut: {
          labels: {
            show: true,
            value: { ...LABEL_VALUE },
            total: { ...LABEL_TOTAL },
          },
        },
      },

      // RadialBar charts
      // https://apexcharts.com/docs/options/plotoptions/radialbar/
      radialBar: {
        hollow: { margin: -8, size: '100%' },
        track: {
          margin: -8,
          strokeWidth: '50%',
          background: `rgba(${greyChannel} / 0.16)`,
        },
        dataLabels: { value: { ...LABEL_VALUE }, total: { ...LABEL_TOTAL } },
      },

      // Radar charts
      // https://apexcharts.com/docs/options/plotoptions/radar/
      radar: {
        polygons: {
          fill: { colors: ['transparent'] },
          strokeColors: dividerColor,
          connectorColors: dividerColor,
        },
      },

      // Polar Area charts
      // https://apexcharts.com/docs/options/plotoptions/polararea/
      polarArea: {
        rings: { strokeColor: dividerColor },
        spokes: { connectorColors: dividerColor },
      },

      // Heatmap charts
      // https://apexcharts.com/docs/options/plotoptions/heatmap/
      heatmap: { distributed: true },
    },

    // =========================================================================
    // Responsive
    // https://apexcharts.com/docs/options/responsive/
    // =========================================================================
    responsive: [
      {
        breakpoint: theme.breakpoints.values.sm,
        options: { plotOptions: { bar: { borderRadius: 3, columnWidth: '80%' } } },
      },
      {
        breakpoint: theme.breakpoints.values.md,
        options: { plotOptions: { bar: { columnWidth: '60%' } } },
      },
    ],
  };
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get color channel from theme safely.
 */
function getColorChannel(theme: Theme, color: 'grey' | 'primary' | 'secondary', shade?: string): string {
  const channelKey = shade ? `${shade}Channel` : 'mainChannel';
  const vars = theme.vars?.palette[color] as Record<string, string> | undefined;

  const fallbacks: Record<string, string> = {
    '500Channel': '145 158 171',
    '900Channel': '0 0 0',
    mainChannel: '51 133 240',
  };

  return vars?.[channelKey] ?? fallbacks[channelKey] ?? '145 158 171';
}

/**
 * Deep merge two objects.
 */
function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const output = { ...target };

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (
      sourceValue !== null &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue !== null &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      output[key] = deepMerge(targetValue as object, sourceValue as object) as T[keyof T];
    } else if (sourceValue !== undefined) {
      output[key] = sourceValue as T[keyof T];
    }
  }

  return output;
}
