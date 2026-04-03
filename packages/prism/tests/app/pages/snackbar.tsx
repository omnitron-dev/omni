/**
 * Snackbar Test Page
 *
 * Renders Snackbar notifications for E2E and accessibility testing.
 */

import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';

import { SnackbarProvider, useSnackbar, SimpleSnackbar } from '../../../src/components/snackbar';

function SnackbarButtons() {
  const snackbar = useSnackbar();

  return (
    <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
      <Button
        variant="contained"
        color="success"
        onClick={() => snackbar.success('Operation completed successfully!')}
        data-testid="btn-success"
      >
        Success
      </Button>

      <Button
        variant="contained"
        color="error"
        onClick={() => snackbar.error('An error occurred!')}
        data-testid="btn-error"
      >
        Error
      </Button>

      <Button
        variant="contained"
        color="warning"
        onClick={() => snackbar.warning('Please review your input!')}
        data-testid="btn-warning"
      >
        Warning
      </Button>

      <Button
        variant="contained"
        color="info"
        onClick={() => snackbar.info('Here is some information.')}
        data-testid="btn-info"
      >
        Info
      </Button>

      <Button
        variant="outlined"
        onClick={() =>
          snackbar.show({
            message: 'Custom snackbar with action',
            severity: 'info',
            duration: 10000,
            action: (
              <Button color="inherit" size="small" onClick={() => snackbar.close()}>
                UNDO
              </Button>
            ),
          })
        }
        data-testid="btn-custom"
      >
        With Action
      </Button>

      <Button
        variant="outlined"
        onClick={() =>
          snackbar.show({
            message: 'Top right notification',
            severity: 'success',
            position: { vertical: 'top', horizontal: 'right' },
          })
        }
        data-testid="btn-top-right"
      >
        Top Right
      </Button>
    </Stack>
  );
}

function SimpleSnackbarDemo() {
  const [open, setOpen] = useState(false);
  const [severity, setSeverity] = useState<'success' | 'error' | 'warning' | 'info'>('success');

  const showSnackbar = (type: typeof severity) => {
    setSeverity(type);
    setOpen(true);
  };

  return (
    <Box>
      <Typography variant="subtitle1" gutterBottom>
        SimpleSnackbar (Controlled)
      </Typography>
      <Stack direction="row" spacing={2}>
        <Button variant="outlined" onClick={() => showSnackbar('success')} data-testid="simple-success">
          Simple Success
        </Button>
        <Button variant="outlined" onClick={() => showSnackbar('error')} data-testid="simple-error">
          Simple Error
        </Button>
      </Stack>

      <SimpleSnackbar
        open={open}
        onClose={() => setOpen(false)}
        message={`This is a ${severity} message!`}
        severity={severity}
        duration={3000}
      />
    </Box>
  );
}

export function SnackbarTestPage() {
  return (
    <SnackbarProvider defaultDuration={5000}>
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom>
          Snackbar Test Page
        </Typography>

        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" gutterBottom>
            Context-Based Snackbar
          </Typography>
          <SnackbarButtons />
        </Box>

        <Box sx={{ mb: 4 }}>
          <SimpleSnackbarDemo />
        </Box>

        <Typography variant="body2" color="text.secondary">
          Click the buttons to show different types of snackbar notifications.
        </Typography>
      </Box>
    </SnackbarProvider>
  );
}
