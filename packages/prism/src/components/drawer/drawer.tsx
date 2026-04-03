'use client';

/**
 * Drawer Component
 *
 * Enhanced drawer/side panel with custom styling.
 *
 * @module @omnitron-dev/prism/components/drawer
 */

import type { ReactNode } from 'react';
import MuiDrawer from '@mui/material/Drawer';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import type { PaperProps } from '@mui/material/Paper';
import type { SxProps, Theme } from '@mui/material/styles';

/**
 * Drawer anchor positions.
 */
export type DrawerAnchor = 'left' | 'right' | 'top' | 'bottom';

/**
 * Props for Drawer component.
 */
export interface DrawerProps {
  /** Whether the drawer is open */
  open?: boolean;
  /** Drawer anchor position */
  anchor?: DrawerAnchor;
  /** Drawer title */
  title?: ReactNode;
  /** Drawer width (for left/right anchors) */
  width?: number | string;
  /** Drawer height (for top/bottom anchors) */
  height?: number | string;
  /** Show close button */
  showCloseButton?: boolean;
  /** Close button icon */
  closeIcon?: ReactNode;
  /** Header actions */
  headerActions?: ReactNode;
  /** Footer content */
  footer?: ReactNode;
  /** Drawer content */
  children?: ReactNode;
  /** On close handler */
  onClose?: () => void;
  /** Variant: permanent, persistent, or temporary */
  variant?: 'permanent' | 'persistent' | 'temporary';
  /** Props for the Paper component */
  PaperProps?: Partial<PaperProps>;
  /** Custom sx props */
  sx?: SxProps<Theme>;
}

/**
 * Default close icon.
 */
function DefaultCloseIcon(): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </svg>
  );
}

/**
 * Drawer - Enhanced drawer/side panel.
 *
 * @example
 * ```tsx
 * <Drawer
 *   open={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   title="Edit Profile"
 *   anchor="right"
 *   width={400}
 * >
 *   <ProfileForm />
 * </Drawer>
 * ```
 */
export function Drawer({
  open,
  anchor = 'right',
  title,
  width = 320,
  height = 'auto',
  showCloseButton = true,
  closeIcon,
  headerActions,
  footer,
  children,
  onClose,
  variant = 'temporary',
  PaperProps,
  sx,
}: DrawerProps): ReactNode {
  const isHorizontal = anchor === 'left' || anchor === 'right';
  const drawerSize = isHorizontal ? { width } : { height };

  return (
    <MuiDrawer
      open={open}
      anchor={anchor}
      variant={variant}
      onClose={onClose}
      transitionDuration={{ enter: 300, exit: 250 }}
      sx={sx}
      slotProps={{
        backdrop: { sx: { backdropFilter: 'blur(2px)' } },
      }}
      PaperProps={{
        sx: {
          ...drawerSize,
          display: 'flex',
          flexDirection: 'column',
        },
        ...PaperProps,
      }}
    >
      {/* Header */}
      {(title || showCloseButton || headerActions) && (
        <>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              p: 2,
              minHeight: 64,
            }}
          >
            {title && (
              <Typography variant="h6" component="div">
                {title}
              </Typography>
            )}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 'auto' }}>
              {headerActions}
              {showCloseButton && onClose && (
                <IconButton onClick={onClose} edge="end" size="small" aria-label="Close drawer">
                  {closeIcon ?? <DefaultCloseIcon />}
                </IconButton>
              )}
            </Box>
          </Box>
          <Divider />
        </>
      )}

      {/* Content */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          p: 2,
        }}
      >
        {children}
      </Box>

      {/* Footer */}
      {footer && (
        <>
          <Divider />
          <Box sx={{ p: 2 }}>{footer}</Box>
        </>
      )}
    </MuiDrawer>
  );
}
