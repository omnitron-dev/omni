'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import type { SxProps, Theme } from '@mui/material/styles';

export interface CursorPaginationProps {
  /** An omitted action is unsupported. A null action is supported but currently unavailable. */
  first?: (() => void) | null;
  previous?: (() => void) | null;
  next?: (() => void) | null;
  pending?: boolean;
  labels?: { navigation?: string; first?: string; previous?: string; next?: string };
  /** A caller-supplied observation, such as a real item count. Empty results can omit it. */
  status?: ReactNode;
  sx?: SxProps<Theme>;
}

/** Controlled navigation for opaque cursors. The caller owns its tokens, requests and list contents. */
export function CursorPagination({
  first, previous, next, pending = false, labels, status, sx,
}: CursorPaginationProps) {
  const root = useRef<HTMLElement>(null);
  const [hasFocus, setHasFocus] = useState(false);
  const actions = [
    { id: 'first', run: first, label: labels?.first ?? 'First page' },
    { id: 'previous', run: previous, label: labels?.previous ?? 'Previous page' },
    { id: 'next', run: next, label: labels?.next ?? 'Next page' },
  ] as const;
  const hasAction = actions.some(action => typeof action.run === 'function');
  const hasStatus = status != null && status !== false && status !== '';
  const showControls = pending || hasAction || hasFocus;

  useLayoutEffect(() => {
    const nav = root.current;
    const focused = nav?.ownerDocument.activeElement;
    if (pending || !nav || !focused || !nav.contains(focused) || focused.getAttribute('aria-disabled') !== 'true') {
      return;
    }
    nav.querySelector<HTMLButtonElement>('button:not([aria-disabled="true"])')?.focus({ preventScroll: true });
  }, [first, previous, next, pending]);

  if (!showControls && !hasStatus) return null;
  return (
    <Box
      component="nav"
      ref={root}
      aria-label={labels?.navigation ?? 'Pagination'}
      aria-busy={pending || undefined}
      onFocusCapture={() => setHasFocus(true)}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setHasFocus(false);
      }}
      sx={[
        { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {hasStatus && <Box component="span" role="status" sx={{ minWidth: 0 }}>{status}</Box>}
      {actions.map(({ id, run, label }) => {
        if (run === undefined || !showControls) return null;
        const unavailable = pending || !run;
        return (
          <Button
            key={id}
            type="button"
            size="small"
            aria-disabled={unavailable || undefined}
            tabIndex={unavailable ? -1 : undefined}
            sx={{
              ...(id === 'next' && { marginInlineStart: 'auto' }),
              '&[aria-disabled="true"]': { color: 'text.disabled' },
            }}
            onClick={() => {
              if (!unavailable) run();
            }}
          >
            {label}
          </Button>
        );
      })}
    </Box>
  );
}
