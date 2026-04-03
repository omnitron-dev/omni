/**
 * Menu Test Page
 *
 * Renders dropdown menu components for E2E and accessibility testing.
 */

import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import IconButton from '@mui/material/IconButton';

export function MenuTestPage() {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [iconAnchorEl, setIconAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const iconOpen = Boolean(iconAnchorEl);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleIconClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setIconAnchorEl(event.currentTarget);
  };

  const handleIconClose = () => {
    setIconAnchorEl(null);
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Menu Test Page
      </Typography>

      <Box sx={{ display: 'flex', gap: 4, mb: 4 }}>
        {/* Text Button Menu */}
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Button with Menu
          </Typography>
          <Button
            id="options-button"
            aria-controls={open ? 'options-menu' : undefined}
            aria-haspopup="true"
            aria-expanded={open ? 'true' : undefined}
            onClick={handleClick}
            variant="contained"
          >
            Options
          </Button>
          <Menu
            id="options-menu"
            anchorEl={anchorEl}
            open={open}
            onClose={handleClose}
            MenuListProps={{
              'aria-labelledby': 'options-button',
            }}
          >
            <MenuItem onClick={handleClose}>
              <ListItemIcon>
                <EditIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Edit</ListItemText>
            </MenuItem>
            <MenuItem onClick={handleClose}>
              <ListItemIcon>
                <ContentCopyIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Duplicate</ListItemText>
            </MenuItem>
            <MenuItem onClick={handleClose}>
              <ListItemIcon>
                <DeleteIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Delete</ListItemText>
            </MenuItem>
          </Menu>
        </Box>

        {/* Icon Button Menu */}
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Icon Button with Menu
          </Typography>
          <IconButton
            id="more-button"
            aria-label="More options"
            aria-controls={iconOpen ? 'more-menu' : undefined}
            aria-haspopup="true"
            aria-expanded={iconOpen ? 'true' : undefined}
            onClick={handleIconClick}
          >
            <MoreVertIcon />
          </IconButton>
          <Menu
            id="more-menu"
            anchorEl={iconAnchorEl}
            open={iconOpen}
            onClose={handleIconClose}
            MenuListProps={{
              'aria-labelledby': 'more-button',
            }}
          >
            <MenuItem onClick={handleIconClose}>Option 1</MenuItem>
            <MenuItem onClick={handleIconClose}>Option 2</MenuItem>
            <MenuItem onClick={handleIconClose}>Option 3</MenuItem>
          </Menu>
        </Box>
      </Box>
    </Box>
  );
}
