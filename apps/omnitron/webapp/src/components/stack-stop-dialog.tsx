import { useEffect, useState } from 'react';
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, Typography } from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import type { StackStopReview } from '@omnitron-dev/omnitron/dto/services';
import { Can } from 'src/auth/access';
import { daemonClient } from 'src/netron/client';
import { OperationStatus } from './operation-status';

export function StackStopDialog({ project, stack, onClose, onConfirm }: {
  project: string; stack: string; onClose: () => void; onConfirm: (digest: string, keepInfrastructure: boolean) => void;
}) {
  const [keepInfrastructure, setKeepInfrastructure] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [report, setReport] = useState<StackStopReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setReport(null); setError(null);
    void daemonClient.invoke<StackStopReview>('daemon', 'OmnitronProject', 'reviewStackStop', [{ project, stack, ...(keepInfrastructure && { keepInfrastructure: true }) }], { timeout: 120_000 })
      .then(result => {
        if (!current) return;
        if (keepInfrastructure && result.keepInfrastructure !== true) {
          setError('This controller cannot confirm infrastructure preservation. Update it before stopping applications separately.');
          return;
        }
        setReport(result);
      })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : 'Stop review unavailable'); });
    return () => { current = false; };
  }, [project, stack, attempt, keepInfrastructure]);
  const busy = !report && !error;
  const reviewed = !!report?.digest && (report.keepInfrastructure === true) === keepInfrastructure;
  return <Dialog open fullWidth maxWidth="sm" onClose={onClose} aria-labelledby="stack-stop-title">
    <DialogTitle id="stack-stop-title">Review stop · {project} / {stack}</DialogTitle>
    <DialogContent dividers aria-busy={busy}>
      <FormControlLabel control={<Checkbox checked={keepInfrastructure} onChange={event => {
        setReport(null); setError(null); setKeepInfrastructure(event.target.checked);
      }} />} label="Keep infrastructure" sx={{ mb: 1 }} />
      <OperationStatus active={busy} label="Checking current owners and resources" />
      {error && <Alert severity="error">{error}</Alert>}
      {report && <Stack spacing={1.5}>
        <Typography variant="body2" role="status">{report.digest ? 'Stopping will disable automatic resume for this stack.' : 'Some targets could not be verified. Review their status before stopping.'}</Typography>
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {report.targets.map(target => <Box component="li" key={target.node} sx={{ py: 1, overflowWrap: 'anywhere', '& + li': { borderTop: 1, borderColor: 'divider' } }}>
            <Typography variant="subtitle2">{target.node}{target.runtime && ` · ${target.runtime.project}/${target.runtime.stack}`}</Typography>
            {target.reason ? <Typography color="warning.main" variant="body2">{target.reason}</Typography> : <>
              <Typography variant="body2">Applications to stop · {target.applications?.join(', ') || 'None'}</Typography>
              <Typography variant="body2">Containers {keepInfrastructure ? 'kept' : 'to remove'} · {target.containers?.join(', ') || 'None'}</Typography>
            </>}
          </Box>)}
        </Box>
      </Stack>}
    </DialogContent>
    <DialogActions sx={{ flexWrap: 'wrap' }}>
      <Button disabled={busy} onClick={() => { setReport(null); setError(null); setAttempt(value => value + 1); }}>Check again</Button>
      <Button autoFocus onClick={onClose}>Close</Button>
      <Can permission="OmnitronProject.stopStack"><Button disabled={!reviewed} color="error" variant="contained"
        onClick={() => { if (reviewed && report?.digest) onConfirm(report.digest, keepInfrastructure); }}>{keepInfrastructure ? 'Stop applications' : 'Stop stack'}</Button></Can>
    </DialogActions>
  </Dialog>;
}
