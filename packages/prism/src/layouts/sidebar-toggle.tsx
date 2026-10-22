import IconButton, { type IconButtonProps } from '@mui/material/IconButton';
import SvgIcon from '@mui/material/SvgIcon';
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
      <SvgIcon sx={{ fontSize: 16, transform: collapsed ? 'rotate(180deg)' : undefined }}>
        <path d="m14.7 6.7-1.4-1.4L6.6 12l6.7 6.7 1.4-1.4L9.4 12z" />
      </SvgIcon>
    </IconButton>
  );
}
