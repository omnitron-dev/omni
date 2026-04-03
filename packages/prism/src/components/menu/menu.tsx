'use client';

/**
 * Menu Component
 *
 * Dropdown menu with various item types.
 *
 * @module @omnitron-dev/prism/components/menu
 */

import type { ReactNode, MouseEvent } from 'react';
import { useState, useCallback } from 'react';
import MuiMenu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';

// =============================================================================
// SHARED RENDERING
// =============================================================================

/**
 * Render menu items (shared between Menu and ContextMenu).
 *
 * @param items - Array of menu item definitions
 * @param onItemClick - Click handler for menu items
 * @returns Array of rendered menu elements
 */
function renderMenuItems(items: MenuItemDef[], onItemClick: (item: MenuItemDef) => void): ReactNode[] {
  return items.map((item, index) => {
    if (item.type === 'divider') {
      return <Divider key={`divider-${index}`} sx={{ my: 0.5 }} />;
    }

    if (item.type === 'header') {
      return (
        <Typography
          key={`header-${index}`}
          variant="overline"
          sx={{ px: 2, py: 0.5, display: 'block', color: 'text.secondary' }}
        >
          {item.label}
        </Typography>
      );
    }

    return (
      <MenuItem
        key={item.key ?? `item-${index}`}
        onClick={() => onItemClick(item)}
        disabled={item.disabled}
        sx={{
          color: item.danger ? 'error.main' : undefined,
          '&:hover': item.danger ? { bgcolor: 'error.lighter' } : undefined,
        }}
      >
        {item.icon && <ListItemIcon sx={{ color: item.danger ? 'error.main' : undefined }}>{item.icon}</ListItemIcon>}
        <ListItemText>{item.label}</ListItemText>
        {item.shortcut && (
          <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
            {item.shortcut}
          </Typography>
        )}
      </MenuItem>
    );
  });
}

// =============================================================================
// TYPES
// =============================================================================

/**
 * Menu item types.
 */
export type MenuItemType = 'item' | 'divider' | 'header';

/**
 * Menu item definition.
 */
export interface MenuItemDef {
  /** Item type */
  type?: MenuItemType;
  /** Unique key (required for items) */
  key?: string;
  /** Item label */
  label?: string;
  /** Optional icon */
  icon?: ReactNode;
  /** Click handler */
  onClick?: () => void;
  /** Disabled state */
  disabled?: boolean;
  /** Danger/destructive action styling */
  danger?: boolean;
  /** Shortcut hint text */
  shortcut?: string;
}

/**
 * Props for Menu component.
 */
export interface MenuProps {
  /** Menu items */
  items: MenuItemDef[];
  /** Anchor element */
  anchorEl: HTMLElement | null;
  /** Open state */
  open: boolean;
  /** Close handler */
  onClose: () => void;
  /** Minimum width */
  minWidth?: number;
  /** Anchor origin */
  anchorOrigin?: {
    vertical: 'top' | 'center' | 'bottom';
    horizontal: 'left' | 'center' | 'right';
  };
  /** Transform origin */
  transformOrigin?: {
    vertical: 'top' | 'center' | 'bottom';
    horizontal: 'left' | 'center' | 'right';
  };
}

/**
 * Menu - Dropdown menu component.
 *
 * @example
 * ```tsx
 * const { anchorEl, open, handleOpen, handleClose } = useMenu();
 *
 * <Button onClick={handleOpen}>Open Menu</Button>
 * <Menu
 *   anchorEl={anchorEl}
 *   open={open}
 *   onClose={handleClose}
 *   items={[
 *     { key: 'edit', label: 'Edit', icon: <EditIcon /> },
 *     { key: 'duplicate', label: 'Duplicate', icon: <CopyIcon /> },
 *     { type: 'divider' },
 *     { key: 'delete', label: 'Delete', icon: <DeleteIcon />, danger: true },
 *   ]}
 * />
 * ```
 */
export function Menu({
  items,
  anchorEl,
  open,
  onClose,
  minWidth = 180,
  anchorOrigin = { vertical: 'bottom', horizontal: 'right' },
  transformOrigin = { vertical: 'top', horizontal: 'right' },
}: MenuProps): ReactNode {
  const handleItemClick = useCallback(
    (item: MenuItemDef) => {
      item.onClick?.();
      onClose();
    },
    [onClose]
  );

  return (
    <MuiMenu
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      anchorOrigin={anchorOrigin}
      transformOrigin={transformOrigin}
      slotProps={{
        paper: {
          sx: { minWidth },
        },
      }}
    >
      {renderMenuItems(items, handleItemClick)}
    </MuiMenu>
  );
}

/**
 * Return type for useMenu hook.
 */
export interface UseMenuReturn {
  /** Anchor element for menu positioning */
  anchorEl: HTMLElement | null;
  /** Whether menu is open */
  open: boolean;
  /** Open menu handler (pass as onClick) */
  handleOpen: (event: MouseEvent<HTMLElement>) => void;
  /** Close menu handler */
  handleClose: () => void;
  /** Toggle menu handler */
  handleToggle: (event: MouseEvent<HTMLElement>) => void;
  /** Props to spread on Menu component */
  menuProps: {
    anchorEl: HTMLElement | null;
    open: boolean;
    onClose: () => void;
  };
}

/**
 * useMenu - Hook for managing menu state.
 *
 * @example
 * ```tsx
 * const menu = useMenu();
 *
 * return (
 *   <>
 *     <IconButton onClick={menu.handleOpen}>
 *       <MoreVertIcon />
 *     </IconButton>
 *     <Menu {...menu.menuProps} items={menuItems} />
 *   </>
 * );
 * ```
 */
export function useMenu(): UseMenuReturn {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const open = Boolean(anchorEl);

  const handleOpen = useCallback((event: MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  }, []);

  const handleClose = useCallback(() => {
    setAnchorEl(null);
  }, []);

  const handleToggle = useCallback((event: MouseEvent<HTMLElement>) => {
    setAnchorEl((prev) => (prev ? null : event.currentTarget));
  }, []);

  return {
    anchorEl,
    open,
    handleOpen,
    handleClose,
    handleToggle,
    menuProps: {
      anchorEl,
      open,
      onClose: handleClose,
    },
  };
}

/**
 * Props for ContextMenu component.
 */
export interface ContextMenuProps extends Omit<MenuProps, 'anchorEl' | 'open' | 'onClose'> {
  /** Children to wrap with context menu */
  children: ReactNode;
}

/**
 * ContextMenu - Right-click context menu wrapper.
 *
 * @example
 * ```tsx
 * <ContextMenu
 *   items={[
 *     { key: 'cut', label: 'Cut', shortcut: '⌘X' },
 *     { key: 'copy', label: 'Copy', shortcut: '⌘C' },
 *     { key: 'paste', label: 'Paste', shortcut: '⌘V' },
 *   ]}
 * >
 *   <div>Right-click me!</div>
 * </ContextMenu>
 * ```
 */
export function ContextMenu({ items, children, ...menuProps }: ContextMenuProps): ReactNode {
  const [contextMenu, setContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
  } | null>(null);

  const handleContextMenu = useCallback((event: MouseEvent) => {
    event.preventDefault();
    setContextMenu({
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
    });
  }, []);

  const handleClose = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleItemClick = useCallback(
    (item: MenuItemDef) => {
      item.onClick?.();
      handleClose();
    },
    [handleClose]
  );

  return (
    <>
      <div onContextMenu={handleContextMenu}>{children}</div>
      <MuiMenu
        open={contextMenu !== null}
        onClose={handleClose}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu !== null ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
        slotProps={{
          paper: {
            sx: { minWidth: menuProps.minWidth ?? 180 },
          },
        }}
      >
        {renderMenuItems(items, handleItemClick)}
      </MuiMenu>
    </>
  );
}
