'use client';

/**
 * Scrollbar Component
 *
 * Custom scrollbar wrapper with themed styling.
 *
 * @module components/scrollbar
 */

import type { ReactNode, Ref } from 'react';
import Box from '@mui/material/Box';
import { styled } from '@mui/material/styles';
import { scrollbarStyles } from '../../theme/mixins.js';
import type { SxProps, Theme } from '@mui/material/styles';

// =============================================================================
// TYPES
// =============================================================================

export interface ScrollbarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Content to scroll */
  children?: ReactNode;
  /** Additional styles */
  sx?: SxProps<Theme>;
  /** Fill available content space */
  fillContent?: boolean;
  /** Hide scrollbar (content still scrollable) */
  hideScrollbar?: boolean;
  /** Reveal on hover or keyboard focus; native visibility on touch/high contrast. */
  autoHide?: boolean;
  /** Scrollbar axis */
  axis?: 'x' | 'y' | 'both';
  /** Max height constraint */
  maxHeight?: number | string;
  /** Min height constraint */
  minHeight?: number | string;
  /** Additional class name */
  className?: string;
  /** Scroll event handler */
  onScroll?: React.UIEventHandler<HTMLDivElement>;
}

// =============================================================================
// STYLED COMPONENT
// =============================================================================

interface ScrollbarRootProps {
  ownerState: {
    fillContent: boolean;
    hideScrollbar: boolean;
    autoHide: boolean;
    axis: 'x' | 'y' | 'both';
  };
}

const ScrollbarRoot = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'ownerState',
})<ScrollbarRootProps>(({ theme, ownerState }) => {
  const { fillContent, hideScrollbar, autoHide, axis } = ownerState;

  const getOverflow = () => {
    if (axis === 'x') return { overflowX: 'auto', overflowY: 'hidden' } as const;
    if (axis === 'y') return { overflowX: 'hidden', overflowY: 'auto' } as const;
    return { overflow: 'auto' } as const;
  };

  return {
    minWidth: 0,
    minHeight: 0,
    ...getOverflow(),
    ...(fillContent && {
      flexGrow: 1,
      display: 'flex',
      flexDirection: 'column',
    }),
    ...(!hideScrollbar && scrollbarStyles(theme, { autoHide })),
    ...(hideScrollbar && {
      scrollbarWidth: 'none',
      msOverflowStyle: 'none',
      '&::-webkit-scrollbar': {
        display: 'none',
      },
    }),
  };
});
// =============================================================================
// COMPONENT
// =============================================================================

/**
 * Scrollbar - Custom scrollbar wrapper with themed styling.
 *
 * @example
 * ```tsx
 * <Scrollbar maxHeight={400}>
 *   <List>...</List>
 * </Scrollbar>
 * ```
 *
 * @example
 * ```tsx
 * // Horizontal scrollbar
 * <Scrollbar axis="x">
 *   <Stack direction="row" spacing={2}>...</Stack>
 * </Scrollbar>
 * ```
 *
 * @example
 * ```tsx
 * // Fill available space
 * <Scrollbar fillContent>
 *   {content}
 * </Scrollbar>
 * ```
 */
export function Scrollbar({
  children,
  sx,
  fillContent = false,
  hideScrollbar = false,
  autoHide = true,
  axis = 'y',
  maxHeight,
  minHeight,
  className,
  ref,
  ...other
}: ScrollbarProps & { ref?: Ref<HTMLDivElement> }) {
  const ownerState = {
    fillContent,
    hideScrollbar,
    autoHide,
    axis,
  };

  return (
    <ScrollbarRoot
      ref={ref}
      ownerState={ownerState}
      className={className}
      sx={[
        {
          ...(maxHeight !== undefined && { maxHeight }),
          ...(minHeight !== undefined && { minHeight }),
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      {children}
    </ScrollbarRoot>
  );
}
