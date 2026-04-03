/**
 * Colors Test Page
 *
 * Renders text with different color combinations for contrast testing.
 */

import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';

import { createPrismTheme } from '../../../src/theme';

function ColorSamples() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Typography on different backgrounds */}
      <Box>
        <Typography variant="h6" gutterBottom>
          Typography Variants
        </Typography>
        <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="h4">Heading 4 Text</Typography>
          <Typography variant="h5">Heading 5 Text</Typography>
          <Typography variant="h6">Heading 6 Text</Typography>
          <Typography variant="body1">Body 1 regular text</Typography>
          <Typography variant="body2">Body 2 regular text</Typography>
          <Typography variant="caption">Caption text</Typography>
          <Typography color="text.secondary" data-testid="secondary-text">
            Secondary text color
          </Typography>
          <Typography color="text.disabled" data-testid="disabled-text">
            Disabled text color
          </Typography>
        </Paper>
      </Box>

      {/* Color variants */}
      <Box>
        <Typography variant="h6" gutterBottom>
          Semantic Colors
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button variant="contained" color="primary">
            Primary Button
          </Button>
          <Button variant="contained" color="secondary">
            Secondary Button
          </Button>
          <Button variant="contained" color="error">
            Error Button
          </Button>
          <Button variant="contained" color="warning">
            Warning Button
          </Button>
          <Button variant="contained" color="info">
            Info Button
          </Button>
          <Button variant="contained" color="success">
            Success Button
          </Button>
        </Box>
      </Box>

      {/* Outlined variants */}
      <Box>
        <Typography variant="h6" gutterBottom>
          Outlined Buttons
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button variant="outlined" color="primary">
            Primary
          </Button>
          <Button variant="outlined" color="secondary">
            Secondary
          </Button>
          <Button variant="outlined" color="error">
            Error
          </Button>
        </Box>
      </Box>

      {/* Alerts */}
      <Box>
        <Typography variant="h6" gutterBottom>
          Alert Components
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Alert severity="success">Success alert message</Alert>
          <Alert severity="info">Info alert message</Alert>
          <Alert severity="warning">Warning alert message</Alert>
          <Alert severity="error">Error alert message</Alert>
        </Box>
      </Box>

      {/* Chips */}
      <Box>
        <Typography variant="h6" gutterBottom>
          Chips
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Chip label="Default" />
          <Chip label="Primary" color="primary" />
          <Chip label="Secondary" color="secondary" />
          <Chip label="Error" color="error" />
          <Chip label="Warning" color="warning" />
          <Chip label="Info" color="info" />
          <Chip label="Success" color="success" />
        </Box>
      </Box>

      {/* Links */}
      <Box>
        <Typography variant="h6" gutterBottom>
          Links
        </Typography>
        <Typography>
          This is a paragraph with{' '}
          <Typography component="a" href="#" sx={{ color: 'primary.main', textDecoration: 'underline' }}>
            a link
          </Typography>{' '}
          inside it for contrast testing.
        </Typography>
      </Box>
    </Box>
  );
}

export function ColorsTestPage() {
  const [searchParams] = useSearchParams();
  const mode = (searchParams.get('mode') as 'light' | 'dark') || 'light';

  const theme = useMemo(() => createPrismTheme({ mode }), [mode]);

  return (
    <ThemeProvider theme={theme}>
      <Box
        sx={{
          p: 3,
          minHeight: '100vh',
          bgcolor: 'background.default',
          color: 'text.primary',
        }}
      >
        <Typography variant="h4" gutterBottom>
          Color Contrast Test Page ({mode} mode)
        </Typography>
        <ColorSamples />
      </Box>
    </ThemeProvider>
  );
}
