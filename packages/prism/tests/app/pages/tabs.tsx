/**
 * Tabs Test Page
 *
 * Renders Prism Tabs component for E2E and accessibility testing.
 */

import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiTabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`tabpanel-${index}`}
      aria-labelledby={`tab-${index}`}
      data-testid={`tabpanel-${index}`}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

function a11yProps(index: number) {
  return {
    id: `tab-${index}`,
    'aria-controls': `tabpanel-${index}`,
  };
}

export function TabsTestPage() {
  const [value, setValue] = useState(0);
  const [verticalValue, setVerticalValue] = useState(0);

  const handleChange = (_event: React.SyntheticEvent, newValue: number) => {
    setValue(newValue);
  };

  const handleVerticalChange = (_event: React.SyntheticEvent, newValue: number) => {
    setVerticalValue(newValue);
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Tabs Test Page
      </Typography>

      {/* Horizontal Tabs */}
      <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
        Horizontal Tabs
      </Typography>
      <Box sx={{ width: '100%', border: 1, borderColor: 'divider', borderRadius: 1 }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <MuiTabs value={value} onChange={handleChange} aria-label="Demo tabs" data-testid="horizontal-tabs">
            <Tab label="Overview" {...a11yProps(0)} data-testid="tab-overview" />
            <Tab label="Details" {...a11yProps(1)} data-testid="tab-details" />
            <Tab label="Settings" {...a11yProps(2)} data-testid="tab-settings" />
            <Tab label="History" {...a11yProps(3)} data-testid="tab-history" />
          </MuiTabs>
        </Box>
        <TabPanel value={value} index={0}>
          <Typography data-testid="content-overview">
            Overview content - This is the main dashboard view with summary information.
          </Typography>
        </TabPanel>
        <TabPanel value={value} index={1}>
          <Typography data-testid="content-details">
            Details content - Detailed information about the selected item.
          </Typography>
        </TabPanel>
        <TabPanel value={value} index={2}>
          <Typography data-testid="content-settings">
            Settings content - Configure your preferences and options here.
          </Typography>
        </TabPanel>
        <TabPanel value={value} index={3}>
          <Typography data-testid="content-history">History content - View past activities and changes.</Typography>
        </TabPanel>
      </Box>

      {/* Vertical Tabs */}
      <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
        Vertical Tabs
      </Typography>
      <Box
        sx={{
          display: 'flex',
          height: 224,
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
        }}
      >
        <MuiTabs
          orientation="vertical"
          variant="scrollable"
          value={verticalValue}
          onChange={handleVerticalChange}
          aria-label="Vertical tabs"
          sx={{ borderRight: 1, borderColor: 'divider' }}
          data-testid="vertical-tabs"
        >
          <Tab label="Item One" data-testid="vtab-1" />
          <Tab label="Item Two" data-testid="vtab-2" />
          <Tab label="Item Three" data-testid="vtab-3" />
        </MuiTabs>
        <Box sx={{ flex: 1, p: 2 }}>
          {verticalValue === 0 && <Typography data-testid="vcontent-1">Content for Item One</Typography>}
          {verticalValue === 1 && <Typography data-testid="vcontent-2">Content for Item Two</Typography>}
          {verticalValue === 2 && <Typography data-testid="vcontent-3">Content for Item Three</Typography>}
        </Box>
      </Box>

      {/* Disabled Tab */}
      <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
        Tabs with Disabled
      </Typography>
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
        <MuiTabs value={0} aria-label="Tabs with disabled" data-testid="tabs-with-disabled">
          <Tab label="Active" data-testid="tab-active" />
          <Tab label="Disabled" disabled data-testid="tab-disabled" />
          <Tab label="Also Active" data-testid="tab-also-active" />
        </MuiTabs>
      </Box>
    </Box>
  );
}
