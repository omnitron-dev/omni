'use client';

/**
 * Scrollbar Component
 *
 * Custom scrollbar wrapper with themed styling.
 *
 * @module @omnitron-dev/prism/components/scrollbar
 */

import type { ReactNode } from 'react';
import { forwardRef } from 'react';
import Box from '@mui/material/Box';
import { styled, alpha } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

// =============================================================================
// TYPES
// =============================================================================

export interface ScrollbarProps {
  /** Content to scroll */
  children?: ReactNode;
  /** Additional styles */
  sx?: SxProps<Theme>;
  /** Fill available content space */
  fillContent?: boolean;
  /** Hide scrollbar (content still scrollable) */
  hideScrollbar?: boolean;
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
    axis: 'x' | 'y' | 'both';
  };
}

const ScrollbarRoot = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'ownerState',
})<ScrollbarRootProps>(({ theme, ownerState }) => {
  const { fillContent, hideScrollbar, axis } = ownerState;

  const scrollbarColor = alpha(theme.palette.text.disabled, 0.4);
  const scrollbarHoverColor = alpha(theme.palette.text.disabled, 0.6);
  const scrollbarTrackColor = alpha(theme.palette.grey[500], 0.08);

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
    // Custom scrollbar styles
    ...(!hideScrollbar && {
      scrollbarWidth: 'thin',
      scrollbarColor: `${scrollbarColor} ${scrollbarTrackColor}`,
      // Webkit browsers
      '&::-webkit-scrollbar': {
        width: 8,
        height: 8,
      },
      '&::-webkit-scrollbar-track': {
        backgroundColor: scrollbarTrackColor,
        borderRadius: 4,
      },
      '&::-webkit-scrollbar-thumb': {
        backgroundColor: scrollbarColor,
        borderRadius: 4,
        '&:hover': {
          backgroundColor: scrollbarHoverColor,
        },
      },
      '&::-webkit-scrollbar-corner': {
        backgroundColor: 'transparent',
      },
    }),
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
export const Scrollbar = forwardRef<HTMLDivElement, ScrollbarProps>(function Scrollbar(
  { children, sx, fillContent = false, hideScrollbar = false, axis = 'y', maxHeight, minHeight, className, ...other },
  ref
) {
  const ownerState = {
    fillContent,
    hideScrollbar,
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
});
