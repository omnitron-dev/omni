import { PanelExpandIcon, PanelCollapseIcon } from '../icons/controls.js';
import IconButton, { type IconButtonProps } from '@mui/material/IconButton';
export interface SidebarToggleProps extends Omit<IconButtonProps, 'children' | 'aria-label' | 'aria-expanded'> {
  collapsed: boolean;
  labels: { expand: string; collapse: string };
}
/** Shared edge control for the application sidebar and nested tool panels. */
export function SidebarToggle({ collapsed, labels, sx, ...props }: SidebarToggleProps) {
  return (
    <IconButton
      {...props}
      size="small"
      aria-label={collapsed ? labels.expand : labels.collapse}
      aria-expanded={!collapsed}
      sx={[
        {
          position: 'absolute',
          top: 36,
          right: -12,
          transform: 'translateY(-50%)',
          width: 24,
          height: 24,
          bgcolor: 'background.paper',
          border: 1,
          borderColor: 'divider',
          boxShadow: 1,
          '&:hover': { bgcolor: 'action.hover' },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {collapsed ? <PanelExpandIcon sx={{ fontSize: 18 }} /> : <PanelCollapseIcon sx={{ fontSize: 18 }} />}
    </IconButton>
  );
}
