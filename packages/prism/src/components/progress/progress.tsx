'use client';

/**
 * Progress Components
 *
 * Linear and circular progress indicators.
 *
 * @module @omnitron-dev/prism/components/progress
 */

import type { ReactNode, ComponentProps } from 'react';
import MuiLinearProgress from '@mui/material/LinearProgress';
import MuiCircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

/**
 * Progress color variants.
 */
export type ProgressColor = 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info' | 'inherit';

/**
 * Props for LinearProgress component.
 */
export interface LinearProgressProps extends Omit<ComponentProps<typeof MuiLinearProgress>, 'color'> {
  /** Progress color */
  color?: ProgressColor;
  /** Show percentage label */
  showLabel?: boolean;
  /** Label position */
  labelPosition?: 'end' | 'below';
  /** Custom label formatter */
  formatLabel?: (value: number) => string;
}

/**
 * LinearProgress - Horizontal progress indicator.
 *
 * @example
 * ```tsx
 * // Determinate
 * <LinearProgress value={75} showLabel />
 *
 * // Indeterminate (loading)
 * <LinearProgress />
 *
 * // With custom label
 * <LinearProgress
 *   value={50}
 *   showLabel
 *   formatLabel={(v) => `${v}/100 completed`}
 * />
 * ```
 */
export function LinearProgress({
  color = 'primary',
  showLabel = false,
  labelPosition = 'end',
  formatLabel,
  value,
  variant = value !== undefined ? 'determinate' : 'indeterminate',
  sx,
  ...props
}: LinearProgressProps): ReactNode {
  const label = formatLabel ? formatLabel(value ?? 0) : `${Math.round(value ?? 0)}%`;

  if (!showLabel) {
    return (
      <MuiLinearProgress variant={variant} value={value} color={color} sx={{ borderRadius: 1, ...sx }} {...props} />
    );
  }

  if (labelPosition === 'below') {
    return (
      <Box sx={{ width: '100%' }}>
        <MuiLinearProgress variant={variant} value={value} color={color} sx={{ borderRadius: 1, ...sx }} {...props} />
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', textAlign: 'center' }}>
          {label}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box sx={{ flex: 1 }}>
        <MuiLinearProgress variant={variant} value={value} color={color} sx={{ borderRadius: 1, ...sx }} {...props} />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 40 }}>
        {label}
      </Typography>
    </Box>
  );
}

/**
 * Props for CircularProgress component.
 */
export interface CircularProgressProps extends Omit<ComponentProps<typeof MuiCircularProgress>, 'color'> {
  /** Progress color */
  color?: ProgressColor;
  /** Show percentage label in center */
  showLabel?: boolean;
  /** Custom label formatter */
  formatLabel?: (value: number) => string;
}

/**
 * CircularProgress - Circular progress indicator.
 *
 * @example
 * ```tsx
 * // Determinate with label
 * <CircularProgress value={75} showLabel />
 *
 * // Indeterminate spinner
 * <CircularProgress />
 *
 * // Custom size
 * <CircularProgress value={50} size={80} thickness={5} showLabel />
 * ```
 */
export function CircularProgress({
  color = 'primary',
  showLabel = false,
  formatLabel,
  value,
  variant = value !== undefined ? 'determinate' : 'indeterminate',
  size = 40,
  ...props
}: CircularProgressProps): ReactNode {
  if (!showLabel || variant === 'indeterminate') {
    return <MuiCircularProgress variant={variant} value={value} color={color} size={size} {...props} />;
  }

  const label = formatLabel ? formatLabel(value ?? 0) : `${Math.round(value ?? 0)}%`;

  return (
    <Box sx={{ position: 'relative', display: 'inline-flex' }}>
      <MuiCircularProgress variant={variant} value={value} color={color} size={size} {...props} />
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          right: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontSize: typeof size === 'number' ? size * 0.25 : undefined }}
        >
          {label}
        </Typography>
      </Box>
    </Box>
  );
}

/**
 * Props for ProgressBar component (segmented).
 */
export interface ProgressBarProps {
  /** Segments with value and optional color */
  segments: Array<{
    value: number;
    color?: ProgressColor;
    label?: string;
  }>;
  /** Bar height */
  height?: number;
  /** Show segment labels */
  showLabels?: boolean;
}

/**
 * ProgressBar - Segmented progress bar for multiple values.
 *
 * @example
 * ```tsx
 * <ProgressBar
 *   segments={[
 *     { value: 30, color: 'success', label: 'Complete' },
 *     { value: 20, color: 'warning', label: 'In Progress' },
 *     { value: 50, color: 'error', label: 'Failed' },
 *   ]}
 *   showLabels
 * />
 * ```
 */
export function ProgressBar({ segments, height = 8, showLabels = false }: ProgressBarProps): ReactNode {
  const colorMap: Record<ProgressColor, string> = {
    primary: 'primary.main',
    secondary: 'secondary.main',
    success: 'success.main',
    error: 'error.main',
    warning: 'warning.main',
    info: 'info.main',
    inherit: 'text.primary',
  };

  return (
    <Box sx={{ width: '100%' }}>
      <Box
        sx={{
          display: 'flex',
          borderRadius: 1,
          overflow: 'hidden',
          height,
          bgcolor: 'action.hover',
        }}
      >
        {segments.map((segment, index) => (
          <Box
            key={index}
            sx={{
              width: `${segment.value}%`,
              bgcolor: colorMap[segment.color ?? 'primary'],
              transition: 'width 0.3s ease-in-out',
            }}
          />
        ))}
      </Box>
      {showLabels && (
        <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
          {segments.map((segment, index) => (
            <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: colorMap[segment.color ?? 'primary'],
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {segment.label ?? `${segment.value}%`}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
