'use client';

/**
 * Loading Screen Component
 *
 * Lightweight content loading indicator with centered LinearProgress.
 * Use for lazy-loaded route content within layouts.
 *
 * @module @omnitron-dev/prism/components/loading-screen
 */

import type { ReactNode } from 'react';
import { Fragment } from 'react';
import Portal from '@mui/material/Portal';
import { styled } from '@mui/material/styles';
import LinearProgress from '@mui/material/LinearProgress';
import type { LinearProgressProps } from '@mui/material/LinearProgress';
import type { SxProps, Theme } from '@mui/material/styles';

// =============================================================================
// TYPES
// =============================================================================

export interface LoadingScreenProps extends React.ComponentProps<'div'> {
  /** Render in a portal */
  portal?: boolean;
  /** Additional styles */
  sx?: SxProps<Theme>;
  /** Slot overrides */
  slots?: {
    progress?: ReactNode;
  };
  /** Slot props */
  slotProps?: {
    progress?: LinearProgressProps;
  };
}

// =============================================================================
// STYLED COMPONENTS
// =============================================================================

const LoadingContent = styled('div')(({ theme }) => ({
  flexGrow: 1,
  width: '100%',
  display: 'flex',
  minHeight: '100%',
  alignItems: 'center',
  justifyContent: 'center',
  paddingLeft: theme.spacing(5),
  paddingRight: theme.spacing(5),
}));

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * LoadingScreen - Lightweight content loading indicator.
 *
 * @example
 * ```tsx
 * <Suspense fallback={<LoadingScreen />}>
 *   <Outlet />
 * </Suspense>
 * ```
 */
export function LoadingScreen({ portal, slots, slotProps, sx, ...other }: LoadingScreenProps): ReactNode {
  const Wrapper = portal ? Portal : Fragment;

  return (
    <Wrapper>
      <LoadingContent sx={sx} {...other}>
        {slots?.progress ?? (
          <LinearProgress
            color="inherit"
            sx={[
              { width: 1, maxWidth: 360 },
              ...(Array.isArray(slotProps?.progress?.sx) ? slotProps.progress.sx : [slotProps?.progress?.sx]),
            ]}
            {...slotProps?.progress}
          />
        )}
      </LoadingContent>
    </Wrapper>
  );
}
