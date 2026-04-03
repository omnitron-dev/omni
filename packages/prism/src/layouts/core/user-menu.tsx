/**
 * User Menu Component
 *
 * A dropdown menu for user account actions with avatar button trigger.
 * Combines minimal design with portal-style functionality.
 *
 * @module @omnitron/prism/layouts/core/user-menu
 */

'use client';

import type { ReactNode, MouseEvent } from 'react';
import { useState, useCallback } from 'react';
import { styled, alpha } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Avatar from '@mui/material/Avatar';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import type { SxProps, Theme } from '@mui/material';

// =============================================================================
// TYPES
// =============================================================================

export interface UserMenuUser {
  /** User display name */
  name: string;
  /** User email */
  email?: string;
  /** Avatar image URL */
  avatarUrl?: string;
  /** User role or subtitle */
  role?: string;
}

export interface UserMenuItem {
  /** Unique key for the menu item */
  key: string;
  /** Menu item label */
  label: string;
  /** Optional icon */
  icon?: ReactNode;
  /** Click handler */
  onClick?: () => void;
  /** Highlight as destructive (e.g., logout) */
  destructive?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Show divider after this item */
  dividerAfter?: boolean;
}

export interface UserMenuProps {
  /** User data */
  user: UserMenuUser;
  /** Menu items */
  menuItems?: UserMenuItem[];
  /** Custom header content */
  header?: ReactNode;
  /** Custom footer content */
  footer?: ReactNode;
  /** Avatar size */
  avatarSize?: 'small' | 'medium' | 'large';
  /** Show email in header */
  showEmail?: boolean;
  /** Show role in header */
  showRole?: boolean;
  /** Custom sx for the trigger button */
  sx?: SxProps<Theme>;
  /** Custom sx for the popover */
  popoverSx?: SxProps<Theme>;
  /** Callback when menu opens */
  onOpen?: () => void;
  /** Callback when menu closes */
  onClose?: () => void;
}

// =============================================================================
// STYLED COMPONENTS
// =============================================================================

const AVATAR_SIZES = {
  small: 32,
  medium: 40,
  large: 48,
} as const;

const TriggerButton = styled(ButtonBase)(({ theme }) => ({
  borderRadius: '50%',
  padding: 0,
  transition: theme.transitions.create(['box-shadow', 'background-color'], {
    duration: theme.transitions.duration.shorter,
  }),
  '&:hover': {
    backgroundColor: alpha(theme.palette.primary.main, 0.08),
  },
  '&:focus-visible': {
    outline: `2px solid ${theme.palette.primary.main}`,
    outlineOffset: 2,
  },
}));

const StyledPopover = styled(Popover)(({ theme }) => ({
  '& .MuiPopover-paper': {
    minWidth: 220,
    maxWidth: 280,
    borderRadius: Number(theme.shape.borderRadius) * 1.5,
    boxShadow: theme.shadows[8],
    overflow: 'hidden',
  },
}));

const UserHeader = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2),
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1.5),
}));

const UserInfo = styled(Box)({
  flex: 1,
  minWidth: 0, // Enable text truncation
  overflow: 'hidden',
});

const StyledMenuItem = styled(MenuItem, {
  shouldForwardProp: (prop) => prop !== 'destructive',
})<{ destructive?: boolean }>(({ theme, destructive }) => ({
  padding: theme.spacing(1, 2),
  minHeight: 40,
  gap: theme.spacing(1.5),
  ...(destructive && {
    color: theme.palette.error.main,
    '&:hover': {
      backgroundColor: alpha(theme.palette.error.main, 0.08),
    },
  }),
}));

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get initials from a name.
 */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return (parts[0]?.[0] || '?').toUpperCase();
}

/**
 * Get avatar background color based on name.
 */
function getAvatarColor(name: string): string {
  const colors = [
    '#1976d2', // Blue
    '#388e3c', // Green
    '#d32f2f', // Red
    '#7b1fa2', // Purple
    '#f57c00', // Orange
    '#0097a7', // Cyan
    '#c2185b', // Pink
    '#5d4037', // Brown
  ];

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * User Menu - Dropdown menu with avatar trigger for user account actions.
 *
 * Features:
 * - Avatar button trigger with hover/focus states
 * - Customizable menu items with icons
 * - User header with name, email, and role
 * - Destructive action styling (for logout)
 * - Keyboard accessible
 *
 * @example
 * ```tsx
 * <UserMenu
 *   user={{
 *     name: 'John Doe',
 *     email: 'john@example.com',
 *     avatarUrl: '/avatars/john.jpg',
 *   }}
 *   menuItems={[
 *     { key: 'profile', label: 'Profile', icon: <PersonIcon />, onClick: () => {} },
 *     { key: 'settings', label: 'Settings', icon: <SettingsIcon />, onClick: () => {} },
 *     { key: 'logout', label: 'Logout', icon: <LogoutIcon />, destructive: true, onClick: handleLogout },
 *   ]}
 * />
 * ```
 */
export function UserMenu({
  user,
  menuItems = [],
  header,
  footer,
  avatarSize = 'medium',
  showEmail = true,
  showRole = false,
  sx,
  popoverSx,
  onOpen,
  onClose,
}: UserMenuProps): ReactNode {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const handleOpen = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      setAnchorEl(event.currentTarget);
      onOpen?.();
    },
    [onOpen]
  );

  const handleClose = useCallback(() => {
    setAnchorEl(null);
    onClose?.();
  }, [onClose]);

  const handleMenuItemClick = useCallback(
    (item: UserMenuItem) => {
      item.onClick?.();
      handleClose();
    },
    [handleClose]
  );

  const size = AVATAR_SIZES[avatarSize];
  const initials = getInitials(user.name);
  const avatarBgColor = getAvatarColor(user.name);

  return (
    <>
      <TriggerButton onClick={handleOpen} aria-label="Open user menu" aria-haspopup="true" aria-expanded={open} sx={sx}>
        <Avatar
          src={user.avatarUrl}
          alt={user.name}
          sx={{
            width: size,
            height: size,
            bgcolor: user.avatarUrl ? 'transparent' : avatarBgColor,
            fontSize: size * 0.4,
            fontWeight: 600,
          }}
        >
          {initials}
        </Avatar>
      </TriggerButton>

      <StyledPopover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        slotProps={{
          paper: {
            sx: popoverSx,
          },
        }}
      >
        {/* Custom header or default user header */}
        {header ?? (
          <UserHeader>
            <Avatar
              src={user.avatarUrl}
              alt={user.name}
              sx={{
                width: 44,
                height: 44,
                bgcolor: user.avatarUrl ? 'transparent' : avatarBgColor,
                fontSize: 18,
                fontWeight: 600,
              }}
            >
              {initials}
            </Avatar>
            <UserInfo>
              <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600 }}>
                {user.name}
              </Typography>
              {showEmail && user.email && (
                <Typography variant="body2" color="text.secondary" noWrap>
                  {user.email}
                </Typography>
              )}
              {showRole && user.role && (
                <Typography variant="caption" color="text.disabled" noWrap>
                  {user.role}
                </Typography>
              )}
            </UserInfo>
          </UserHeader>
        )}

        {menuItems.length > 0 && (
          <>
            <Divider sx={{ my: 0.5 }} />
            <Box sx={{ py: 0.5 }}>
              {menuItems.map((item) => (
                <Box key={item.key}>
                  <StyledMenuItem
                    onClick={() => handleMenuItemClick(item)}
                    disabled={item.disabled}
                    destructive={item.destructive}
                  >
                    {item.icon && (
                      <ListItemIcon
                        sx={{
                          minWidth: 'auto',
                          color: item.destructive ? 'error.main' : 'inherit',
                        }}
                      >
                        {item.icon}
                      </ListItemIcon>
                    )}
                    <ListItemText
                      primary={item.label}
                      primaryTypographyProps={{
                        variant: 'body2',
                        noWrap: true,
                      }}
                    />
                  </StyledMenuItem>
                  {item.dividerAfter && <Divider sx={{ my: 0.5 }} />}
                </Box>
              ))}
            </Box>
          </>
        )}

        {/* Custom footer */}
        {footer && (
          <>
            <Divider />
            {footer}
          </>
        )}
      </StyledPopover>
    </>
  );
}
