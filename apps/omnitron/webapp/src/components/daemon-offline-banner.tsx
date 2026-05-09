import { useEffect } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import { useBackendStatusStore, useBackendStatus } from 'src/stores/backend-status.store';

export function DaemonOfflineBanner() {
  const status = useBackendStatus();
  const { probe, startPolling } = useBackendStatusStore();

  useEffect(() => {
    const stop = startPolling();
    return stop;
  }, [startPolling]);

  return (
    <Collapse in={status === 'offline'} unmountOnExit>
      <Alert
        severity="error"
        variant="filled"
        sx={{
          borderRadius: 0,
          py: 0.5,
          '& .MuiAlert-message': { display: 'flex', alignItems: 'center', gap: 2, width: '100%' },
        }}
        action={
          <Button color="inherit" size="small" onClick={probe} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
            Retry
          </Button>
        }
      >
        Daemon offline — run <code style={{ margin: '0 4px' }}>omnitron dev</code> to start the backend
      </Alert>
    </Collapse>
  );
}
