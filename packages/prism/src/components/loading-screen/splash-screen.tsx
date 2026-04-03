'use client';

/**
 * Splash Screen Component
 *
 * Full-screen or contained loading states with customizable indicators.
 * Use for app-level loading (initial boot, auth checks).
 *
 * @module @omnitron-dev/prism/components/loading-screen
 */

import type { ReactNode } from 'react';
import { Fragment } from 'react';
import Box from '@mui/material/Box';
import Portal from '@mui/material/Portal';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

// =============================================================================
// TYPES
// =============================================================================

export interface SplashScreenProps {
  /** Loading indicator variant */
  variant?: 'circular' | 'linear';
  /** Loading message */
  message?: string;
  /** Custom loading indicator */
  indicator?: ReactNode;
  /** Render in a portal (useful for overlays) */
  portal?: boolean;
  /** Size of circular indicator */
  size?: number;
  /** Progress value (0-100) for determinate mode */
  progress?: number;
  /** Full screen overlay mode */
  fullScreen?: boolean;
  /** Additional styles */
  sx?: SxProps<Theme>;
}

// =============================================================================
// STYLED COMPONENTS
// =============================================================================

const SplashContainer = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'fullScreen',
})<{ fullScreen?: boolean }>(({ theme, fullScreen }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: theme.spacing(2),
  padding: theme.spacing(3),
  ...(fullScreen
    ? {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: theme.zIndex.modal + 1,
        backgroundColor: theme.palette.background.default,
      }
    : {
        flexGrow: 1,
        width: '100%',
        minHeight: 200,
      }),
}));

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * SplashScreen - Full-screen or contained loading indicator.
 *
 * @example
 * ```tsx
 * // Simple splash
 * <SplashScreen />
 * ```
 *
 * @example
 * ```tsx
 * // With message
 * <SplashScreen message="Loading data..." />
 * ```
 *
 * @example
 * ```tsx
 * // Determinate progress
 * <SplashScreen
 *   variant="linear"
 *   progress={65}
 *   message="Uploading files..."
 * />
 * ```
 *
 * @example
 * ```tsx
 * // Full screen overlay
 * <SplashScreen fullScreen portal />
 * ```
 */
export function SplashScreen({
  variant = 'circular',
  message,
  indicator,
  portal = false,
  size = 48,
  progress,
  fullScreen = false,
  sx,
}: SplashScreenProps): ReactNode {
  const Wrapper = portal ? Portal : Fragment;
  const isDeterminate = progress !== undefined;

  const renderIndicator = () => {
    if (indicator) return indicator;

    if (variant === 'linear') {
      return (
        <LinearProgress
          variant={isDeterminate ? 'determinate' : 'indeterminate'}
          value={progress}
          color="primary"
          sx={{ width: '100%', maxWidth: 360, borderRadius: 1 }}
        />
      );
    }

    return (
      <CircularProgress
        variant={isDeterminate ? 'determinate' : 'indeterminate'}
        value={progress}
        size={size}
        thickness={3}
        color="primary"
      />
    );
  };

  return (
    <Wrapper>
      <SplashContainer fullScreen={fullScreen} sx={sx}>
        {renderIndicator()}

        {message && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, textAlign: 'center' }}>
            {message}
          </Typography>
        )}

        {isDeterminate && (
          <Typography variant="caption" color="text.disabled">
            {Math.round(progress)}%
          </Typography>
        )}
      </SplashContainer>
    </Wrapper>
  );
}

// =============================================================================
// SPINNER COMPONENT
// =============================================================================

export interface SpinnerProps {
  /** Size of the spinner */
  size?: 'small' | 'medium' | 'large' | number;
  /** Color */
  color?: 'primary' | 'secondary' | 'inherit';
  /** Additional styles */
  sx?: SxProps<Theme>;
}

const sizeMap = {
  small: 20,
  medium: 32,
  large: 48,
};

/**
 * Spinner - Simple spinning indicator.
 *
 * @example
 * ```tsx
 * <Button disabled={loading}>
 *   {loading ? <Spinner size="small" /> : 'Submit'}
 * </Button>
 * ```
 */
export function Spinner({ size = 'medium', color = 'primary', sx }: SpinnerProps): ReactNode {
  const computedSize = typeof size === 'number' ? size : sizeMap[size];

  return <CircularProgress size={computedSize} color={color} thickness={3.5} sx={sx} />;
}
