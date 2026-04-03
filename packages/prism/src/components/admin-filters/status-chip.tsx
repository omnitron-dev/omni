'use client';

/**
 * Status Chip Component
 *
 * Universal status badge with automatic color mapping.
 *
 * @module @omnitron/prism/components/admin-filters
 */

import type { ReactNode } from 'react';
import Chip from '@mui/material/Chip';
import { alpha } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

// =============================================================================
// TYPES
// =============================================================================

export type StatusColor = 'success' | 'error' | 'warning' | 'info' | 'default';

export interface StatusChipProps {
  /** Status string to display */
  status: string;
  /** Map status values to colors */
  colorMap?: Record<string, StatusColor>;
  /** Chip size */
  size?: 'small' | 'medium';
  /** Additional styles */
  sx?: SxProps<Theme>;
}

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
export function StatusChip({ status, colorMap, size = 'small', sx }: StatusChipProps): ReactNode {
  const normalizedStatus = status.toLowerCase();
  const mergedMap = colorMap ? { ...DEFAULT_COLOR_MAP, ...colorMap } : DEFAULT_COLOR_MAP;
  const color: StatusColor = mergedMap[normalizedStatus] ?? 'default';

  // Capitalize first letter
  const displayLabel = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

  return (
    <Chip
      label={displayLabel}
      size={size}
      sx={{
        height: size === 'small' ? 22 : 28,
        fontSize: size === 'small' ? '0.7rem' : '0.775rem',
        fontWeight: 600,
        borderRadius: 0.75,
        letterSpacing: '0.01em',
        ...(color !== 'default' && {
          color: (theme) => theme.palette[color].main,
          bgcolor: (theme) => alpha(theme.palette[color].main, 0.1),
          border: (theme) => `1px solid ${alpha(theme.palette[color].main, 0.2)}`,
        }),
        ...(color === 'default' && {
          color: 'text.secondary',
          bgcolor: (theme) => alpha(theme.palette.grey[500], 0.08),
          border: (theme) => `1px solid ${alpha(theme.palette.grey[500], 0.16)}`,
        }),
        ...sx,
      }}
    />
  );
}
