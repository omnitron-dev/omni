import { useId, useState, type ReactNode } from 'react';
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material';
import { MoreVertIcon } from 'src/assets/icons';

export interface RowAction {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  color?: 'error' | 'warning';
  onClick: () => void;
}

/** Secondary row commands share one named, keyboard-accessible MUI menu. */
export function RowActions({ label, actions }: { label: string; actions: RowAction[] }) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Tooltip title={label}>
        <IconButton
          size="small"
          id={`${id}-trigger`}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={Boolean(anchor)}
          aria-controls={anchor ? id : undefined}
          onClick={(event) => {
            event.stopPropagation();
            setAnchor(event.currentTarget);
          }}
        >
          <MoreVertIcon />
        </IconButton>
      </Tooltip>
      <Menu
        id={id}
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        onClick={(event) => event.stopPropagation()}
        slotProps={{ list: { 'aria-labelledby': `${id}-trigger` } }}
      >
        {actions.map((action) => (
          <MenuItem
            key={action.id}
            disabled={action.disabled}
            sx={action.color ? { color: `${action.color}.main` } : undefined}
            onClick={() => {
              setAnchor(null);
              action.onClick();
            }}
          >
            {action.icon && <ListItemIcon sx={{ color: 'inherit' }}>{action.icon}</ListItemIcon>}
            <ListItemText>{action.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
