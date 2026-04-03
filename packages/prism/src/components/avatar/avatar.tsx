'use client';

/**
 * Avatar Component
 *
 * Enhanced avatar with fallback initials and group support.
 *
 * @module @omnitron-dev/prism/components/avatar
 */

import type { ReactNode, CSSProperties } from 'react';
import { forwardRef, useMemo } from 'react';
import MuiAvatar from '@mui/material/Avatar';
import AvatarGroup from '@mui/material/AvatarGroup';
import { styled, useTheme } from '@mui/material/styles';
import type { AvatarProps as MuiAvatarProps } from '@mui/material/Avatar';
import type { AvatarGroupProps as MuiAvatarGroupProps } from '@mui/material/AvatarGroup';
import type { Palette } from '@mui/material/styles';

// =============================================================================
// TYPES
// =============================================================================

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export type AvatarShape = 'circular' | 'rounded' | 'square';

export interface AvatarProps extends Omit<MuiAvatarProps, 'variant'> {
  /** Avatar size preset */
  size?: AvatarSize;
  /** Avatar shape */
  shape?: AvatarShape;
  /** User name for fallback initials */
  name?: string;
  /** Show online indicator */
  online?: boolean;
  /** Show offline indicator */
  offline?: boolean;
  /** Badge content (e.g., notification count) */
  badge?: ReactNode;
  /** Custom badge color */
  badgeColor?: 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info';
}

// =============================================================================
// UTILS
// =============================================================================

const SIZES: Record<AvatarSize, number> = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 56,
  xl: 80,
};

const FONT_SIZES: Record<AvatarSize, number> = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 20,
  xl: 28,
};

/**
 * Generate initials from a name.
 */
function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Generate a consistent color based on a string.
 */
function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  const colors = [
    '#F44336',
    '#E91E63',
    '#9C27B0',
    '#673AB7',
    '#3F51B5',
    '#2196F3',
    '#03A9F4',
    '#00BCD4',
    '#009688',
    '#4CAF50',
    '#8BC34A',
    '#CDDC39',
    '#FFC107',
    '#FF9800',
    '#FF5722',
    '#795548',
  ];

  return colors[Math.abs(hash) % colors.length];
}

// =============================================================================
// STYLED COMPONENT
// =============================================================================

interface StyledAvatarProps {
  ownerState: {
    size: AvatarSize;
    shape: AvatarShape;
    hasImage: boolean;
    bgColor?: string;
  };
}

const StyledAvatar = styled(MuiAvatar, {
  shouldForwardProp: (prop) => prop !== 'ownerState',
})<StyledAvatarProps>(({ theme, ownerState }) => {
  const { size, shape, hasImage, bgColor } = ownerState;
  const dimension = SIZES[size];
  const fontSize = FONT_SIZES[size];

  const borderRadius = typeof theme.shape.borderRadius === 'number' ? theme.shape.borderRadius : 4;

  return {
    width: dimension,
    height: dimension,
    fontSize,
    fontWeight: 600,
    ...(shape === 'rounded' && {
      borderRadius: borderRadius * 1.5,
    }),
    ...(shape === 'square' && {
      borderRadius: 0,
    }),
    ...(!hasImage &&
      bgColor && {
        backgroundColor: bgColor,
        color: theme.palette.getContrastText(bgColor),
      }),
  };
});

// =============================================================================
// WRAPPER FOR BADGES
// =============================================================================

interface AvatarWrapperProps {
  children: ReactNode;
  online?: boolean;
  offline?: boolean;
  badge?: ReactNode;
  badgeColor?: 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info';
  size: AvatarSize;
}

function AvatarWrapper({
  children,
  online,
  offline,
  badge,
  badgeColor = 'error',
  size,
}: AvatarWrapperProps): ReactNode {
  const theme = useTheme();
  const showIndicator = online || offline;
  const indicatorSize = size === 'xs' ? 6 : size === 'sm' ? 8 : 10;

  if (!showIndicator && !badge) {
    return children;
  }

  // Get theme-aware badge color
  const getBadgeBackgroundColor = (color: keyof Palette): string => {
    const paletteColor = theme.palette[color];
    if (paletteColor && typeof paletteColor === 'object' && 'main' in paletteColor) {
      return paletteColor.main;
    }
    return theme.palette.error.main;
  };

  const wrapperStyle: CSSProperties = {
    position: 'relative',
    display: 'inline-flex',
  };

  const indicatorStyle: CSSProperties = {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: indicatorSize,
    height: indicatorSize,
    borderRadius: '50%',
    border: `2px solid ${theme.palette.background.paper}`,
    backgroundColor: online ? theme.palette.success.main : theme.palette.grey[400],
  };

  const badgeStyle: CSSProperties = {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    padding: '0 4px',
    borderRadius: 9,
    fontSize: 10,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: theme.palette.common.white,
    backgroundColor: getBadgeBackgroundColor(badgeColor as keyof Palette),
  };

  return (
    <span style={wrapperStyle}>
      {children}
      {showIndicator && <span style={indicatorStyle} />}
      {badge && <span style={badgeStyle}>{badge}</span>}
    </span>
  );
}

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * Avatar - Enhanced avatar with fallback initials.
 *
 * @example
 * ```tsx
 * // With image
 * <Avatar src="/avatar.jpg" name="John Doe" />
 *
 * // Fallback to initials
 * <Avatar name="John Doe" />
 *
 * // With online indicator
 * <Avatar src="/avatar.jpg" name="John Doe" online />
 *
 * // With badge
 * <Avatar src="/avatar.jpg" name="John Doe" badge={3} />
 * ```
 */
export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(function Avatar(
  { size = 'md', shape = 'circular', name, src, alt, online, offline, badge, badgeColor, children, sx, ...other },
  ref
) {
  const initials = useMemo(() => {
    if (children) return null;
    return name ? getInitials(name) : null;
  }, [name, children]);

  const bgColor = useMemo(() => {
    if (src) return undefined;
    return name ? stringToColor(name) : undefined;
  }, [src, name]);

  const ownerState = {
    size,
    shape,
    hasImage: Boolean(src),
    bgColor,
  };

  const avatarContent = (
    <StyledAvatar ref={ref} src={src} alt={alt || name} ownerState={ownerState} sx={sx} {...other}>
      {children || initials}
    </StyledAvatar>
  );

  return (
    <AvatarWrapper online={online} offline={offline} badge={badge} badgeColor={badgeColor} size={size}>
      {avatarContent}
    </AvatarWrapper>
  );
});

// =============================================================================
// AVATAR GROUP
// =============================================================================

export interface CustomAvatarGroupProps extends Omit<MuiAvatarGroupProps, 'children'> {
  /** Avatar items */
  avatars: Array<{
    name?: string;
    src?: string;
    alt?: string;
  }>;
  /** Avatar size */
  size?: AvatarSize;
  /** Maximum avatars to show */
  max?: number;
}

/**
 * CustomAvatarGroup - Display multiple avatars in a group.
 *
 * @example
 * ```tsx
 * <CustomAvatarGroup
 *   avatars={[
 *     { name: 'John Doe', src: '/avatar1.jpg' },
 *     { name: 'Jane Smith', src: '/avatar2.jpg' },
 *     { name: 'Bob Wilson' },
 *   ]}
 *   max={3}
 * />
 * ```
 */
export function CustomAvatarGroup({ avatars, size = 'sm', max = 4, sx, ...other }: CustomAvatarGroupProps): ReactNode {
  return (
    <AvatarGroup max={max} sx={sx} {...other}>
      {avatars.map((avatar, index) => (
        <Avatar key={index} name={avatar.name} src={avatar.src} alt={avatar.alt || avatar.name} size={size} />
      ))}
    </AvatarGroup>
  );
}
