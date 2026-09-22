'use client';

/**
 * Status Chip Component
 *
 * Universal status badge with automatic color mapping.
 *
 * @module components/admin-filters
 */

import type { ReactNode, Ref } from 'react';
import Chip, { type ChipProps } from '@mui/material/Chip';
import { alpha } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

// =============================================================================
// TYPES
// =============================================================================

export type StatusColor = 'success' | 'error' | 'warning' | 'info' | 'default';

interface StatusChipOwnProps {
  /** Status string to display (drives color mapping) */
  status: string;
  /**
   * Optional display override — pass a localized label while keeping
   * `status` as the raw enum value used for color mapping. When omitted,
   * the chip falls back to the capitalized `status` string.
   */
  label?: ReactNode;
  /** Map status values to colors */
  colorMap?: Record<string, StatusColor>;
  /** Chip size */
  size?: 'small' | 'medium';
  /** Additional styles */
  sx?: SxProps<Theme>;
}

/**
 * The chip takes `ref` and passes everything else to MUI's `Chip`, as every
 * leaf in this library does: the portal's members tab put two of these
 * inside a `Tooltip`, which attaches its ref and its hover handlers to its
 * child — and a chip that dropped both was a tooltip that never opened.
 */
export type StatusChipProps = StatusChipOwnProps &
  Omit<ChipProps, keyof StatusChipOwnProps | 'ref'> & { ref?: Ref<HTMLDivElement> };

// =============================================================================
// DEFAULT COLOR MAP
// =============================================================================

const DEFAULT_COLOR_MAP: Record<string, StatusColor> = {
  active: 'success',
  completed: 'success',
  confirmed: 'success',
  approved: 'success',
  enabled: 'success',
  online: 'success',
  paid: 'success',
  resolved: 'success',
  success: 'success',

  pending: 'warning',
  processing: 'warning',
  waiting: 'warning',
  review: 'warning',
  draft: 'warning',

  failed: 'error',
  error: 'error',
  rejected: 'error',
  blocked: 'error',
  banned: 'error',
  disabled: 'error',
  cancelled: 'error',
  expired: 'error',
  suspended: 'error',
  offline: 'error',

  info: 'info',
  new: 'info',
  open: 'info',
};

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * StatusChip - Universal status badge with color mapping.
 *
 * Automatically maps common status strings to appropriate colors.
 * Provide a custom `colorMap` to override or extend the defaults.
 *
 * @example
 * ```tsx
 * <StatusChip status="active" />
 * <StatusChip status="pending" size="small" />
 * <StatusChip
 *   status="custom"
 *   colorMap={{ custom: 'info', special: 'success' }}
 * />
 * ```
 */
export function StatusChip({ status, label, colorMap, size = 'small', sx, ref, ...other }: StatusChipProps): ReactNode {
  const normalizedStatus = status.toLowerCase();
  const mergedMap = colorMap ? { ...DEFAULT_COLOR_MAP, ...colorMap } : DEFAULT_COLOR_MAP;
  // Own-property lookup only. Statuses arrive from the server, and a plain
  // object answers `map['constructor']` with a FUNCTION — which `?? 'default'`
  // accepts as a colour, sending `theme.palette[fn].main` into a TypeError
  // that takes the whole React tree down. `toString`, `valueOf` and
  // `hasOwnProperty` do the same.
  const mapped = Object.hasOwn(mergedMap, normalizedStatus) ? mergedMap[normalizedStatus] : undefined;
  const color: StatusColor = mapped ?? 'default';

  const displayLabel: ReactNode = label ?? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

  return (
    <Chip
      ref={ref}
      {...other}
      label={displayLabel}
      size={size}
      sx={[
        {
          height: size === 'small' ? 22 : 28,
          fontSize: size === 'small' ? '0.7rem' : '0.775rem',
          fontWeight: 600,
          borderRadius: 0.75,
          letterSpacing: '0.01em',
          ...(color !== 'default' && {
            color: (theme: Theme) => theme.palette[color].main,
            bgcolor: (theme: Theme) => alpha(theme.palette[color].main, 0.1),
            border: (theme: Theme) => `1px solid ${alpha(theme.palette[color].main, 0.2)}`,
          }),
          ...(color === 'default' && {
            color: 'text.secondary',
            bgcolor: (theme: Theme) => alpha(theme.palette.grey[500], 0.08),
            border: (theme: Theme) => `1px solid ${alpha(theme.palette.grey[500], 0.16)}`,
          }),
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    />
  );
}
