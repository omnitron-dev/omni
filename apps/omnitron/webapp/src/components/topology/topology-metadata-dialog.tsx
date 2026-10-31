import { OperationStatus } from 'src/components/operation-status';
import { useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { daemonClient } from 'src/netron/client';
import type { TopologyMetadataRefresh } from '@omnitron-dev/omnitron/dto/services';

export function TopologyMetadataDialog({ project, stack, onClose, onUpdated }: {
  project: string; stack: string | null; onClose: () => void; onUpdated: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const capture = async () => {
    setBusy(true); setError(null);
    try {
      const result = await daemonClient.invoke<TopologyMetadataRefresh>('daemon', 'OmnitronProject', 'refreshTopologyMetadata',
        [{ project, ...(stack ? { stack } : {}) }], { timeout: 120_000 });
      await onUpdated();
      if (result.failures.length) setError(result.failures.map(item => `${item.app}: ${item.reason}`).join('\n'));
      else onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <Dialog open fullWidth maxWidth="sm" onClose={busy ? undefined : onClose}>
    <DialogTitle>Update declarations · {project}{stack ? ` / ${stack}` : ''}</DialogTitle>
    <DialogContent><Stack spacing={2}>
      <Typography variant="body2">Read the registered applications’ bootstrap declarations and save a new dependency snapshot. Applications keep running.</Typography>
      <Alert severity="info">This imports trusted project code in separate processes. Import-time code can run; application lifecycle hooks are not started.</Alert>
      {error && <Alert severity="error" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{error}</Alert>}
      <OperationStatus active={busy} label="Reading topology declarations" detail="Up to 30 seconds per application, with a shared 90-second deadline" />
    </Stack></DialogContent>
    <DialogActions>
      <Button autoFocus onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant="contained" loading={busy} onClick={() => void capture()} disabled={busy}>Update declarations</Button>
    </DialogActions>
  </Dialog>;
}
