import { OperationStatus } from 'src/components/operation-status';
import { useLayoutEffect, useRef, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { daemonClient } from 'src/netron/client';
import type { IProjectRpcService, TopologyMetadataRefresh } from '@omnitron-dev/omnitron/dto/services';

export function TopologyMetadataDialog({ project, stack, release, onClose, onUpdated }: {
  project: string; stack: string | null; release?: string; onClose: () => void; onUpdated: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  useLayoutEffect(() => {
    const current = ++generation.current;
    setBusy(false);
    setError(null);
    return () => { generation.current = current + 1; };
  }, [project, stack, release]);
  const capture = async () => {
    const request = generation.current;
    setBusy(true); setError(null);
    try {
      const scope: Parameters<IProjectRpcService['refreshTopologyMetadata']>[0] =
        { project, ...(stack && { stack }), ...(release && { release }) };
      const result = await daemonClient.invoke<TopologyMetadataRefresh>('daemon', 'OmnitronProject', 'refreshTopologyMetadata',
        [scope], { timeout: 120_000 });
      if (request !== generation.current) return;
      await onUpdated();
      if (request !== generation.current) return;
      if (result.failures.length) setError(result.failures.map(item => `${item.app}: ${item.reason}`).join('\n'));
      else onClose();
    } catch (reason) {
      if (request === generation.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  return <Dialog open fullWidth maxWidth="sm" onClose={busy ? undefined : onClose}>
    <DialogTitle>Update declarations · {project}{stack ? ` / ${stack}` : ''}</DialogTitle>
    <DialogContent><Stack spacing={2}>
      <Typography variant="body2">{release
        ? <>Read the application declarations from release <strong>{release}</strong> for this stack. The current deployment keeps running.</>
        : 'Read the registered applications’ bootstrap declarations and save a new dependency snapshot. Applications keep running.'}</Typography>
      <Alert severity="info">This imports trusted bootstrap code in separate processes. Code at module scope can run during inspection.</Alert>
      {error && <Alert severity="error" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{error}</Alert>}
      <OperationStatus active={busy} label="Reading topology declarations" detail="Up to 30 seconds per application, with a shared 90-second deadline" />
    </Stack></DialogContent>
    <DialogActions>
      <Button autoFocus onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant="contained" loading={busy} onClick={() => void capture()} disabled={busy}>Update declarations</Button>
    </DialogActions>
  </Dialog>;
}
