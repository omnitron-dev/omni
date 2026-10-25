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
        (theme) => ({
          position: 'absolute',
          top: 36,
          insetInlineEnd: 0,
          // Centre on the rail edge even when the host enlarges the hit target.
          // A logical inset and an unflipped custom value also work with RTL caches.
          '--prism-sidebar-toggle-shift': theme.direction === 'rtl' ? '-50%' : '50%',
          transform: 'translate(var(--prism-sidebar-toggle-shift), -50%)',
          width: 24,
          height: 24,
          bgcolor: 'background.paper',
          border: 1,
          borderColor: 'divider',
          boxShadow: 1,
          // Keep an opaque surface over the rail divider in every interactive state.
          '&:hover, &.Mui-focusVisible': {
            bgcolor: 'background.paper',
            backgroundImage: `linear-gradient(${(theme.vars ?? theme).palette.action.hover}, ${(theme.vars ?? theme).palette.action.hover})`,
          },
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {collapsed ? <PanelExpandIcon sx={{ fontSize: 18 }} /> : <PanelCollapseIcon sx={{ fontSize: 18 }} />}
    </IconButton>
  );
}
