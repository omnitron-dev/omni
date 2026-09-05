import { useEffect } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import { useBackendStatusStore, useBackendStatus } from 'src/stores/backend-status.store';

export function DaemonOfflineBanner() {
  const status = useBackendStatus();
  const { probe, startPolling, consecutiveUnreachable } = useBackendStatusStore();

  useEffect(() => {
    const stop = startPolling();
    return stop;
  }, [startPolling]);

  return (
    <Collapse in={status === 'offline' || status === 'degraded'} unmountOnExit>
      <Alert
        severity={status === 'offline' ? 'error' : 'warning'}
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
        {status === 'offline' ? (
          <>
            Daemon offline — run <code style={{ margin: '0 4px' }}>omnitron up</code> to start the
            backend
          </>
        ) : (
          // Probes that did not complete. This never becomes "offline",
          // however many there are: saying so would tell an operator to start
          // a daemon that is very likely running, which is what this banner
          // did on a loaded machine while the daemon answered the CLI in 3 ms.
          // The count is shown instead — insistent without asserting a cause.
          <>
            {consecutiveUnreachable > 1
              ? `The daemon has not answered ${consecutiveUnreachable} checks — it may be down, or the connection to it may be blocked`
              : 'The daemon did not answer the last check — this view may be out of date'}
          </>
        )}
      </Alert>
    </Collapse>
  );
}
