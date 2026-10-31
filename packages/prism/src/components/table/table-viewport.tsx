'use client';

import TableContainer from '@mui/material/TableContainer';
import type { TableContainerProps } from '@mui/material/TableContainer';
import type { KeyboardEvent } from 'react';

export interface TableViewportProps extends TableContainerProps {
  /** Accessible name of the keyboard-scrollable table region. */
  label?: string;
  /** Constrain the rows, keeping pagination outside the scroll region. */
  maxHeight?: number | string;
  /** Arrow/Home/End/Page keys browse rows; Escape returns to the viewport. */
  keyboardNavigation?: boolean;
}

function browseRows(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.defaultPrevented || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target as HTMLElement;
  if (target.closest('input,textarea,select,button,a,[contenteditable="true"]')) return;
  const viewport = event.currentTarget;
  const rows = Array.from(viewport.querySelectorAll<HTMLElement>('tbody > tr')).filter(
    (row) => !row.querySelector('[role="progressbar"],.MuiSkeleton-root')
  );
  const row = target.closest('tbody > tr') as HTMLElement | null;
  const index = row ? rows.indexOf(row) : -1;
  const page = Math.max(1, Math.floor(viewport.clientHeight / (row?.getBoundingClientRect().height || 40)) || 10);
  const movement: Record<string, number> = {
    ArrowDown: index + 1,
    ArrowUp: index < 0 ? rows.length - 1 : index - 1,
    Home: 0,
    End: rows.length - 1,
    PageDown: index + page,
    PageUp: index - page,
  };
  if (event.key in movement && rows.length) {
    event.preventDefault();
    const next = rows[Math.max(0, Math.min(rows.length - 1, movement[event.key]!))]!;
    next.tabIndex = -1;
    next.focus({ preventScroll: true });
    next.scrollIntoView?.({ block: 'nearest' });
  } else if (event.key === 'Escape' && row) {
    event.preventDefault();
    event.stopPropagation();
    viewport.focus({ preventScroll: true });
  } else if (event.key === 'Enter' && row) {
    event.preventDefault();
    row.click();
  } else if (event.key === ' ' && row) {
    const checkbox = row.querySelector<HTMLInputElement>('input[type="checkbox"]:not(:disabled)');
    if (checkbox) {
      event.preventDefault();
      checkbox.click();
    }
  }
}

/** A bounded, keyboard-accessible viewport for wide or tall native MUI tables. */
export function TableViewport({
  label = 'Table',
  maxHeight,
  keyboardNavigation = true,
  onKeyDown,
  sx,
  ...props
}: TableViewportProps) {
  return (
    <TableContainer
      role="region"
      aria-label={label}
      tabIndex={0}
      data-keyboard-region={keyboardNavigation ? label : undefined}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (keyboardNavigation) browseRows(event);
      }}
      {...props}
      sx={[
        {
          minWidth: 0,
          maxWidth: '100%',
          maxHeight,
          overflow: 'auto',
          overscrollBehaviorX: 'contain',
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
          '& tbody > tr:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  );
}
