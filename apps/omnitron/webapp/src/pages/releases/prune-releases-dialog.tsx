/**
 * Removing old releases.
 *
 * Two presses, and the first one deletes nothing: the daemon answers what
 * WOULD go, with each release's size, and only the second press applies it.
 * A release is two gigabytes of artifacts and the only copy of a gate run,
 * so the list is shown in full rather than as a count.
 *
 * Releases a stack has deployed are protected whatever their age. The daemon
 * does not know which release is running — the audit rows do — so the page
 * that read them passes them down, and the prune keeps them.
 *
 * When they could not be read — no audit trail, or a stack whose last start
 * recorded a release and not its name — there is nothing to protect with,
 * and this dialog does not remove anything: it would have been an empty
 * list, which protects nothing. The CLI refuses the same way, and names the
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

import type { PruneResult } from '@omnitron-dev/omnitron/dto/services';
import { releases as releaseRpc } from 'src/netron/client';

import { bytes } from 'src/components/release-bits';

export default function PruneReleasesDialog({
  open,
  onClose,
  protect,
  blind,
  onPruned,
}: {
  open: boolean;
  onClose: () => void;
  protect: string[];
  /** Why which releases the stacks run cannot be told, or `null` when it can. */
  blind: string | null;
  onPruned: () => void;
}) {
  const [keep, setKeep] = useState(5);
  const [plan, setPlan] = useState<PruneResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [removed, setRemoved] = useState<PruneResult | null>(null);

  const dryRun = useCallback(async () => {
    setBusy(true);
    setFailure(null);
    try {
      setPlan(await releaseRpc.prune({ keep, protect }));
    } catch (err) {
      setFailure((err as Error).message);
      setPlan(null);
    } finally {
      setBusy(false);
    }
  }, [keep, protect]);

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
      const result = await releaseRpc.prune({ keep, apply: true, protect });
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

          {blind && (
            <Alert severity="warning">
              Which of these a stack is running cannot be told — {blind}. Nothing will be removed from here until it
              can; <code>omnitron release prune --yes --allow-unprotected</code> removes them without knowing.
            </Alert>
          )}

          {protect.length > 0 && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {protect.length} release{protect.length === 1 ? '' : 's'} deployed to a stack {protect.length === 1 ? 'is' : 'are'} kept
              whatever their age.
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
            disabled={busy || !plan || plan.doomed.length === 0 || blind !== null}
            onClick={apply}
          >
            Remove {plan?.doomed.length ?? 0}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
