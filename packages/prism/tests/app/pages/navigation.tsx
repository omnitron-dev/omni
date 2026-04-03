/**
 * Navigation Test Page
 *
 * Renders navigation components for E2E and accessibility testing.
 */

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import HomeIcon from '@mui/icons-material/Home';
import SettingsIcon from '@mui/icons-material/Settings';
import PersonIcon from '@mui/icons-material/Person';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import HelpIcon from '@mui/icons-material/Help';

export function NavigationTestPage() {
  return (
    <Box sx={{ p: 3, display: 'flex', gap: 4 }}>
      <Box
        component="nav"
        role="navigation"
        aria-label="Main navigation"
        data-testid="prism-sidenav"
        sx={{
          width: 250,
          bgcolor: 'background.paper',
          borderRadius: 1,
          border: 1,
          borderColor: 'divider',
        }}
      >
        <List>
          <ListItem disablePadding data-testid="prism-sidenav-item">
            <ListItemButton selected>
              <ListItemIcon>
                <HomeIcon />
              </ListItemIcon>
              <ListItemText primary="Home" />
            </ListItemButton>
          </ListItem>

          <ListItem disablePadding data-testid="prism-sidenav-item">
            <ListItemButton>
              <ListItemIcon>
                <AnalyticsIcon />
              </ListItemIcon>
              <ListItemText primary="Analytics" />
            </ListItemButton>
          </ListItem>

          <ListItem disablePadding data-testid="prism-sidenav-item">
            <ListItemButton>
              <ListItemIcon>
                <PersonIcon />
              </ListItemIcon>
              <ListItemText primary="Profile" />
            </ListItemButton>
          </ListItem>

          <ListItem disablePadding data-testid="prism-sidenav-item">
            <ListItemButton>
              <ListItemIcon>
                <SettingsIcon />
              </ListItemIcon>
              <ListItemText primary="Settings" />
            </ListItemButton>
          </ListItem>

          <ListItem disablePadding data-testid="prism-sidenav-item">
            <ListItemButton>
              <ListItemIcon>
                <HelpIcon />
              </ListItemIcon>
              <ListItemText primary="Help" />
            </ListItemButton>
          </ListItem>
        </List>
      </Box>

      <Box sx={{ flex: 1 }}>
        <Typography variant="h4" gutterBottom>
          Navigation Test Page
        </Typography>
        <Typography color="text.secondary">
          Test keyboard navigation and accessibility of the side navigation.
        </Typography>
      </Box>
    </Box>
  );
}
