'use client';

/**
 * Tooltip Component
 *
 * Enhanced tooltip with custom styling and arrow support.
 *
 * @module @omnitron-dev/prism/components/tooltip
 */

import type { ReactNode, ReactElement } from 'react';
import MuiTooltip from '@mui/material/Tooltip';
import type { TooltipProps as MuiTooltipProps } from '@mui/material/Tooltip';

/**
 * Props for Tooltip component.
 */
export interface TooltipProps extends Omit<MuiTooltipProps, 'children'> {
  /** Tooltip content */
  title: ReactNode;
  /** Element to attach tooltip to */
  children: ReactElement;
  /** Show arrow */
  arrow?: boolean;
  /** Tooltip placement */
  placement?: MuiTooltipProps['placement'];
  /** Max width */
  maxWidth?: number | string;
}

/**
 * Tooltip - Enhanced tooltip with custom styling.
 *
 * @example
 * ```tsx
 * <Tooltip title="Delete item" placement="top">
 *   <IconButton>
 *     <DeleteIcon />
 *   </IconButton>
 * </Tooltip>
 * ```
 */
export function Tooltip({
  title,
  children,
  arrow = true,
  placement = 'top',
  maxWidth = 300,
  ...other
}: TooltipProps): ReactNode {
  if (!title) {
    return children;
  }

  return (
    <MuiTooltip
      title={title}
      arrow={arrow}
      placement={placement}
      slotProps={{
        tooltip: {
          sx: {
            maxWidth,
          },
        },
        ...other.slotProps,
      }}
      {...other}
    >
      {children}
    </MuiTooltip>
  );
}
