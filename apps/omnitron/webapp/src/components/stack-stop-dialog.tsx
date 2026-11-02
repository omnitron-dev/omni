import { useEffect, useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import type { StackStopReview } from '@omnitron-dev/omnitron/dto/services';
import { Can } from 'src/auth/access';
import { daemonClient } from 'src/netron/client';
import { OperationStatus } from './operation-status';

export function StackStopDialog({ project, stack, onClose, onConfirm }: {
  project: string; stack: string; onClose: () => void; onConfirm: (digest: string) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [report, setReport] = useState<StackStopReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setReport(null); setError(null);
    void daemonClient.invoke<StackStopReview>('daemon', 'OmnitronProject', 'reviewStackStop', [{ project, stack }], { timeout: 120_000 })
      .then(result => { if (current) setReport(result); })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : 'Stop review unavailable'); });
    return () => { current = false; };
  }, [project, stack, attempt]);
  const busy = !report && !error;
  return <Dialog open fullWidth maxWidth="sm" onClose={onClose} aria-labelledby="stack-stop-title">
    <DialogTitle id="stack-stop-title">Review stop · {project} / {stack}</DialogTitle>
    <DialogContent dividers aria-busy={busy}>
      <OperationStatus active={busy} label="Checking current owners and resources" />
      {error && <Alert severity="error">{error}</Alert>}
      {report && <Stack spacing={1.5}>
        <Typography variant="body2" role="status">{report.digest ? 'Stopping will disable automatic resume for this stack.' : 'Some targets could not be verified. Review their status before stopping.'}</Typography>
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {report.targets.map(target => <Box component="li" key={target.node} sx={{ py: 1, overflowWrap: 'anywhere', '& + li': { borderTop: 1, borderColor: 'divider' } }}>
            <Typography variant="subtitle2">{target.node}{target.runtime && ` · ${target.runtime.project}/${target.runtime.stack}`}</Typography>
            {target.reason ? <Typography color="warning.main" variant="body2">{target.reason}</Typography> : <>
              <Typography variant="body2">Applications · {target.applications?.join(', ') || 'None'}</Typography>
              <Typography variant="body2">Containers · {target.containers?.join(', ') || 'None'}</Typography>
            </>}
          </Box>)}
        </Box>
      </Stack>}
    </DialogContent>
    <DialogActions sx={{ flexWrap: 'wrap' }}>
      <Button disabled={busy} onClick={() => { setReport(null); setError(null); setAttempt(value => value + 1); }}>Check again</Button>
      <Button autoFocus onClick={onClose}>Close</Button>
      <Can permission="OmnitronProject.stopStack"><Button disabled={!report?.digest} color="error" variant="contained"
        onClick={() => { if (report?.digest) onConfirm(report.digest); }}>Stop stack</Button></Can>
    </DialogActions>
  </Dialog>;
}
