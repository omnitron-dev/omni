'use client';

import TableContainer from '@mui/material/TableContainer';
import type { TableContainerProps } from '@mui/material/TableContainer';

export interface TableViewportProps extends TableContainerProps {
  /** Accessible name of the keyboard-scrollable table region. */
  label?: string;
  /** Constrain the rows, keeping pagination outside the scroll region. */
  maxHeight?: number | string;
}

/** A bounded, keyboard-accessible viewport for wide or tall native MUI tables. */
export function TableViewport({ label = 'Table', maxHeight, sx, ...props }: TableViewportProps) {
  return (
    <TableContainer
      role="region"
      aria-label={label}
      tabIndex={0}
      {...props}
      sx={[
        {
          minWidth: 0,
          maxWidth: '100%',
          maxHeight,
          overflow: 'auto',
          overscrollBehaviorX: 'contain',
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  );
}
