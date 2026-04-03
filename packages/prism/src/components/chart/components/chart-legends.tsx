'use client';

/**
 * Chart Legends Component
 *
 * Custom legend display for charts.
 *
 * @module @omnitron/prism/components/chart
 */

import type { ChartLegendsProps } from '../types.js';

import { styled } from '@mui/material/styles';

import { cn } from '../../../utils/cn.js';
import { chartClasses } from '../classes.js';

// =============================================================================
// CHART LEGENDS
// =============================================================================

/**
 * Custom chart legends component.
 *
 * Displays chart legends with support for colors, icons, values, and sublabels.
 *
 * @example
 * ```tsx
 * <ChartLegends
 *   labels={['Series A', 'Series B']}
 *   colors={['#ff0000', '#00ff00']}
 *   values={['100', '200']}
 * />
 * ```
 */
export function ChartLegends({
  sx,
  className,
  slotProps,
  icons = [],
  values = [],
  labels = [],
  colors = [],
  sublabels = [],
  ...other
}: ChartLegendsProps) {
  return (
    <ListRoot className={cn(chartClasses.legends.root, className)} sx={sx} {...other}>
      {labels.map((series, index) => (
        <ItemWrap
          key={series}
          className={chartClasses.legends.item.wrap}
          sx={[
            {
              '--icon-color': colors[index],
            },
            ...(Array.isArray(slotProps?.wrapper?.sx) ? slotProps.wrapper.sx : [slotProps?.wrapper?.sx]),
          ]}
          {...slotProps?.wrapper}
        >
          <ItemRoot className={chartClasses.legends.item.root} {...slotProps?.root}>
            {icons.length ? (
              <ItemIcon className={chartClasses.legends.item.icon} {...slotProps?.icon}>
                {icons[index]}
              </ItemIcon>
            ) : (
              <ItemDot className={chartClasses.legends.item.dot} {...slotProps?.dot} />
            )}

            <ItemLabel className={chartClasses.legends.item.label} {...slotProps?.label}>
              {series}
              {!!sublabels.length && <> {` (${sublabels[index]})`}</>}
            </ItemLabel>
          </ItemRoot>

          {values.length > 0 && (
            <ItemValue className={chartClasses.legends.item.value} {...slotProps?.value}>
              {values[index]}
            </ItemValue>
          )}
        </ItemWrap>
      ))}
    </ListRoot>
  );
}

// =============================================================================
// STYLED COMPONENTS
// =============================================================================

const ListRoot = styled('ul')(({ theme }) => ({
  display: 'flex',
  flexWrap: 'wrap',
  gap: theme.spacing(2),
  margin: 0,
  padding: 0,
  listStyle: 'none',
}));

const ItemWrap = styled('li')({
  display: 'inline-flex',
  flexDirection: 'column',
});

const ItemRoot = styled('div')(({ theme }) => ({
  gap: 6,
  alignItems: 'center',
  display: 'inline-flex',
  justifyContent: 'flex-start',
  fontSize: theme.typography.pxToRem(13),
  fontWeight: theme.typography.fontWeightMedium,
}));

const ItemIcon = styled('span')({
  display: 'inline-flex',
  color: 'var(--icon-color)',
  '& > svg': {
    width: 20,
    height: 20,
  },
});

const ItemDot = styled('span')({
  width: 12,
  height: 12,
  flexShrink: 0,
  display: 'flex',
  borderRadius: '50%',
  position: 'relative',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--icon-color)',
  backgroundColor: 'currentColor',
});

const ItemLabel = styled('span')({
  flexShrink: 0,
});

const ItemValue = styled('span')(({ theme }) => ({
  ...theme.typography.h6,
  marginTop: theme.spacing(1),
}));
