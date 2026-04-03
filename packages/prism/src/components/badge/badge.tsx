'use client';

/**
 * Badge Component
 *
 * Notification badge and status indicator components.
 *
 * @module @omnitron-dev/prism/components/badge
 */

import type { ReactNode } from 'react';
import { forwardRef } from 'react';
import MuiBadge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import { styled } from '@mui/material/styles';
import type { BadgeProps as MuiBadgeProps } from '@mui/material/Badge';
import type { SxProps, Theme } from '@mui/material/styles';

// =============================================================================
// TYPES
// =============================================================================

export type BadgeSize = 'small' | 'medium' | 'large';

export type BadgeVariant = 'standard' | 'dot' | 'online' | 'offline' | 'busy';

export type BadgeColor = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info';

export interface BadgeProps extends Omit<MuiBadgeProps, 'variant' | 'color' | 'content'> {
  /** Badge variant */
  variant?: BadgeVariant;
  /** Badge color */
  color?: BadgeColor;
  /** Badge size */
  size?: BadgeSize;
}

// =============================================================================
// STYLED COMPONENT
// =============================================================================

interface StyledBadgeProps {
  ownerState: {
    variant: BadgeVariant;
    color: BadgeColor;
    size: BadgeSize;
  };
}

const StyledBadge = styled(MuiBadge, {
  shouldForwardProp: (prop) => prop !== 'ownerState',
})<StyledBadgeProps>(({ theme, ownerState }) => {
  const { variant, color, size } = ownerState;

  // Size dimensions
  const sizeDimensions: Record<BadgeSize, { width: number; height: number; fontSize: number }> = {
    small: { width: 16, height: 16, fontSize: 10 },
    medium: { width: 20, height: 20, fontSize: 12 },
    large: { width: 24, height: 24, fontSize: 14 },
  };

  const { width, height, fontSize } = sizeDimensions[size];

  // Color mapping
  const colorMap: Record<BadgeColor, string> = {
    default: theme.palette.grey[500],
    primary: theme.palette.primary.main,
    secondary: theme.palette.secondary.main,
    success: theme.palette.success.main,
    warning: theme.palette.warning.main,
    error: theme.palette.error.main,
    info: theme.palette.info.main,
  };

  // Status color mapping
  const statusColors: Record<string, string> = {
    online: theme.palette.success.main,
    offline: theme.palette.grey[500],
    busy: theme.palette.error.main,
  };

  const isStatusVariant = variant === 'online' || variant === 'offline' || variant === 'busy';
  const isDotVariant = variant === 'dot' || isStatusVariant;
  const badgeColor = isStatusVariant ? statusColors[variant] : colorMap[color];

  return {
    '& .MuiBadge-badge': {
      minWidth: isDotVariant ? height / 2 : width,
      height: isDotVariant ? height / 2 : height,
      padding: isDotVariant ? 0 : '0 4px',
      fontSize,
      fontWeight: 600,
      backgroundColor: badgeColor,
      color: theme.palette.getContrastText(badgeColor),
      ...(isDotVariant && {
        borderRadius: '50%',
      }),
      // Add pulsing animation for online status
      ...(variant === 'online' && {
        '&::after': {
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          animation: 'ripple 1.2s infinite ease-in-out',
          border: `1px solid ${theme.palette.success.main}`,
          content: '""',
        },
        '@keyframes ripple': {
          '0%': {
            transform: 'scale(.8)',
            opacity: 1,
          },
          '100%': {
            transform: 'scale(2.4)',
            opacity: 0,
          },
        },
      }),
    },
  };
});

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * Badge - Notification badge and status indicator.
 *
 * @example
 * ```tsx
 * // Standard badge with count
 * <Badge badgeContent={4} color="error">
 *   <MailIcon />
 * </Badge>
 *
 * // Dot badge
 * <Badge variant="dot" color="primary">
 *   <NotificationsIcon />
 * </Badge>
 *
 * // Online status
 * <Badge variant="online">
 *   <Avatar src="/avatar.jpg" />
 * </Badge>
 * ```
 */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { variant = 'standard', color = 'error', size = 'medium', badgeContent, children, sx, ...other },
  ref
) {
  const ownerState = { variant, color, size };

  const isStatusVariant = variant === 'online' || variant === 'offline' || variant === 'busy';
  const isDotVariant = variant === 'dot' || isStatusVariant;

  return (
    <StyledBadge
      ref={ref}
      ownerState={ownerState}
      badgeContent={isDotVariant ? undefined : badgeContent}
      variant={isDotVariant ? 'dot' : 'standard'}
      sx={sx}
      {...other}
    >
      {children}
    </StyledBadge>
  );
});

// =============================================================================
// COUNT BADGE
// =============================================================================

export interface CountBadgeProps {
  /** Count value */
  count: number;
  /** Maximum count before showing + */
  max?: number;
  /** Show zero count */
  showZero?: boolean;
  /** Color */
  color?: BadgeColor;
  /** Size */
  size?: BadgeSize;
  /** Additional styles */
  sx?: SxProps<Theme>;
}

/**
 * CountBadge - Standalone count badge without children.
 *
 * @example
 * ```tsx
 * <CountBadge count={42} />
 * <CountBadge count={150} max={99} /> // Shows "99+"
 * ```
 */
export function CountBadge({
  count,
  max = 99,
  showZero = false,
  color = 'error',
  size = 'medium',
  sx,
}: CountBadgeProps): ReactNode {
  if (!showZero && count === 0) {
    return null;
  }

  const displayCount = count > max ? `${max}+` : count.toString();

  const sizeDimensions: Record<BadgeSize, { minWidth: number; height: number; fontSize: number }> = {
    small: { minWidth: 16, height: 16, fontSize: 10 },
    medium: { minWidth: 20, height: 20, fontSize: 12 },
    large: { minWidth: 24, height: 24, fontSize: 14 },
  };

  const { minWidth, height, fontSize } = sizeDimensions[size];

  const colorMap: Record<BadgeColor, string> = {
    default: '#9ca3af',
    primary: '#2563eb',
    secondary: '#7c3aed',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#06b6d4',
  };

  const bgColor = colorMap[color];

  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth,
        height,
        padding: '0 4px',
        borderRadius: height / 2,
        fontSize,
        fontWeight: 600,
        backgroundColor: bgColor,
        color: 'white',
        ...sx,
      }}
    >
      {displayCount}
    </Box>
  );
}

// =============================================================================
// STATUS DOT
// =============================================================================

export type StatusDotStatus = 'online' | 'offline' | 'busy' | 'away';

export interface StatusDotProps {
  /** Status type */
  status: StatusDotStatus;
  /** Size in pixels */
  size?: number;
  /** Show pulsing animation for online */
  pulse?: boolean;
  /** Additional styles */
  sx?: SxProps<Theme>;
}

/**
 * StatusDot - Standalone status indicator.
 *
 * @example
 * ```tsx
 * <StatusDot status="online" />
 * <StatusDot status="busy" size={12} />
 * ```
 */
export function StatusDot({ status, size = 8, pulse = true, sx }: StatusDotProps): ReactNode {
  const statusColors: Record<StatusDotStatus, string> = {
    online: '#22c55e',
    offline: '#9ca3af',
    busy: '#ef4444',
    away: '#f59e0b',
  };

  const color = statusColors[status];

  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: color,
        ...(pulse &&
          status === 'online' && {
            animation: 'pulse 2s infinite',
          }),
        ...sx,
      }}
    />
  );
}
