/**
 * Removing old releases.
 *
 * Two presses, and the first one deletes nothing: the daemon answers what
 * WOULD go, with each release's size, and only the second press applies it.
 * A release is two gigabytes of artifacts and the only copy of a gate run,
 * so the list is shown in full rather than as a count.
 *
 * Releases a stack has deployed are protected whatever their age, and the
 * daemon decides which (f19b16b0): it reads each stack's last start from its
 * own audit trail. It used to take the list from this dialog, which built it
 * from `deployments()` — and a daemon without its trail serves that as `[]`,
 * so the second press would have removed the release a stack runs.
 *
 * When the daemon cannot tell — no trail, or a stack whose last start
 * recorded a release and not its name — its answer says why (`unknown`), it
 * refuses to remove anything, and so does this dialog. The CLI names the
 * flag that removes without knowing.
 */

import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import type { ReleasePruneAnswer } from '@omnitron-dev/omnitron/dto/services';
import { releases as releaseRpc } from 'src/netron/client';

import { bytes } from 'src/components/release-bits';

export default function PruneReleasesDialog({
  open,
  onClose,
  onPruned,
}: {
  open: boolean;
  onClose: () => void;
  onPruned: () => void;
}) {
  const [keep, setKeep] = useState(5);
  const [plan, setPlan] = useState<ReleasePruneAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [removed, setRemoved] = useState<ReleasePruneAnswer | null>(null);

  const dryRun = useCallback(async () => {
    setBusy(true);
    setFailure(null);
    try {
      setPlan(await releaseRpc.prune({ keep }));
    } catch (err) {
      setFailure((err as Error).message);
      setPlan(null);
    } finally {
      setBusy(false);
    }
  }, [keep]);

  useEffect(() => {
    if (open) {
      setRemoved(null);
      void dryRun();
    }
  }, [open, dryRun]);

  const apply = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const result = await releaseRpc.prune({ keep, apply: true });
      setRemoved(result);
      onPruned();
    } catch (err) {
      setFailure((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Prune releases</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          <TextField
            label="Keep the newest"
            type="number"
            size="small"
            value={keep}
            onChange={(e) => setKeep(Math.max(0, Number(e.target.value) || 0))}
            onBlur={() => void dryRun()}
            disabled={busy}
            sx={{ width: 180 }}
          />

          {plan?.unknown && (
            <Alert severity="warning">
              Which of these a stack is running cannot be told — {plan.unknown}. The daemon will not remove anything
              until it can; <code>omnitron release prune --yes --allow-unprotected</code> removes them without knowing.
            </Alert>
          )}

          {plan && plan.protectedByDeployment.length > 0 && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Kept whatever their age, because a stack runs them: {plan.protectedByDeployment.join(', ')}.
            </Typography>
          )}

          {busy && !removed && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <CircularProgress size={16} />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Measuring…
              </Typography>
            </Stack>
          )}

          {removed && (
            <Alert severity="success">
              Removed {removed.removed.length} release{removed.removed.length === 1 ? '' : 's'}, {bytes(removed.freedBytes)} freed;{' '}
              {removed.kept} kept.
            </Alert>
          )}

          {!removed && plan && (
            plan.doomed.length === 0 ? (
              <Alert severity="info">Nothing to remove — {plan.kept} release(s) and all of them are kept.</Alert>
            ) : (
              <Box>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  {plan.doomed.length} release{plan.doomed.length === 1 ? '' : 's'} would go, freeing {bytes(plan.freedBytes)}:
                </Typography>
                <Box sx={{ maxHeight: 220, overflowY: 'auto' }}>
                  {plan.doomed.map((d) => (
                    <Stack key={d.id} direction="row" spacing={1.5} sx={{ py: 0.25 }}>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace', flex: 1 }}>
                        {d.id}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
                        {bytes(d.bytes)}
                      </Typography>
                    </Stack>
                  ))}
                </Box>
              </Box>
            )
          )}

          {failure && (
            <Alert severity="error">
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {failure}
              </Typography>
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small" disabled={busy}>
          {removed ? 'Close' : 'Cancel'}
        </Button>
        {!removed && (
          <Button
            variant="contained"
            color="error"
            size="small"
            disabled={busy || !plan || plan.doomed.length === 0 || plan.unknown !== null}
            onClick={apply}
          >
            Remove {plan?.doomed.length ?? 0}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
