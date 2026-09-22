/**
 * Putting a release on a stack.
 *
 * The decision is not made here. Before anything moves, the dialog asks the
 * daemon `checkRelease`, which runs the deployment's own `admitRelease` and
 * changes nothing: same gates, same «this directory must be the release's
 * commit», same static bundle rule. What appears in the box is that answer,
 * whole — those refusals are three lines long because each one names what to
 * do next, and a console that trimmed them to «Refused» would be throwing
 * away the only part an operator can act on.
 *
 * A remote deployment then takes minutes, longer than any RPC deadline, so a
 * timeout on the start call is not a failure: it means the deployment is
 * running and the place to watch it is the stack's own page.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import type { IStackInfo, ReleaseSummary } from '@omnitron-dev/omnitron/dto/services';
import { project as projectRpc, releases as releaseRpc } from 'src/netron/client';
import { isRpcTimeout, useProjectStore } from 'src/stores/project.store';
import { DeployIcon } from 'src/assets/icons';

import { CommitPair, GateStrip, gateSentence } from './release-bits';

export interface DeployReleaseDialogProps {
  open: boolean;
  onClose: () => void;
  project: string;
  /**
   * The release to deploy, when the operator came from one. `null` opens the
   * dialog from the other end — at a stack, with the releases to choose from
   * — which is the same decision reached from the other side.
   */
  release: ReleaseSummary | null;
  /** Pre-selected stack, when the dialog is opened from one. */
  stack?: string;
}

export function DeployReleaseDialog({ open, onClose, project, release: given, stack }: DeployReleaseDialogProps) {
  const navigate = useNavigate();
  const stacksByProject = useProjectStore((s) => s.stacksByProject);
  const fetchStacks = useProjectStore((s) => s.fetchStacks);
  const startStack = useProjectStore((s) => s.startStack);

  const stacks: IStackInfo[] = stacksByProject[project] ?? [];
  const [available, setAvailable] = useState<ReleaseSummary[]>([]);
  const [picked, setPicked] = useState('');
  const [target, setTarget] = useState(stack ?? '');
  const [verdict, setVerdict] = useState<{ ok: boolean; because: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (open && stacks.length === 0) void fetchStacks(project);
  }, [open, project, stacks.length, fetchStacks]);

  // Opened at a stack: the releases to choose from, newest first. Unfinished
  // builds are left out — there is nothing in them to deploy — and so are
  // other projects', which could not be admitted anyway.
  useEffect(() => {
    if (!open || given) return undefined;
    let current = true;
    releaseRpc
      .list()
      .then(({ releases }) => {
        if (!current) return;
        const mine = releases.filter((r) => r.project === project && r.complete);
        setAvailable(mine);
        setPicked((was) => was || mine[0]?.id || '');
      })
      .catch((err: Error) => {
        if (current) setFailure(`The release store could not be read: ${err.message}`);
      });
    return () => {
      current = false;
    };
  }, [open, given, project]);

  const release = given ?? available.find((r) => r.id === picked) ?? null;
  // The effect below needs the identity of the release, not the object: a
  // new array from every poll would otherwise re-ask the daemon for a
  // verdict it has already given.
  const releaseId = release?.id ?? '';

  useEffect(() => {
    if (open) {
      setTarget(stack ?? '');
      setVerdict(null);
      setFailure(null);
    }
  }, [open, stack, given?.id]);

  // The verdict belongs to one (release, stack) pair; changing either drops
  // it rather than leaving the previous answer under the new question.
  useEffect(() => {
    setVerdict(null);
    if (!open || !releaseId || !target) return undefined;
    let current = true;
    setChecking(true);
    projectRpc
      .checkRelease({ project, stack: target, release: releaseId })
      .then((answer) => {
        if (current) setVerdict(answer);
      })
      .catch((err: Error) => {
        if (current) setVerdict({ ok: false, because: `The daemon could not answer: ${err.message}` });
      })
      .finally(() => {
        if (current) setChecking(false);
      });
    return () => {
      current = false;
    };
  }, [open, project, target, releaseId]);

  const handleDeploy = useCallback(async () => {
    if (!release || !target) return;
    setDeploying(true);
    setFailure(null);
    try {
      await startStack(project, target, { release: release.id });
      const error = useProjectStore.getState().error;
      if (error) {
        setFailure(error);
        setDeploying(false);
        return;
      }
      onClose();
      navigate(`/stacks/${target}`);
    } catch (err) {
      // A deployment outlives the request that asked for it: six apps to a
      // node take minutes. The timeout says it is running, not that it failed.
      if (isRpcTimeout(err)) {
        onClose();
        navigate(`/stacks/${target}`);
        return;
      }
      setFailure((err as Error).message);
    } finally {
      setDeploying(false);
    }
  }, [release, target, project, startStack, navigate, onClose]);

  const chosen = stacks.find((s) => s.name === target);
  const requiresRelease = chosen?.config?.release?.mode === 'required';

  return (
    <Dialog open={open} onClose={deploying ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Deploy a release</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {!given && (
            <TextField
              select
              label="Release"
              value={picked}
              onChange={(e) => setPicked(e.target.value)}
              size="small"
              fullWidth
              disabled={deploying}
            >
              {available.length === 0 && (
                <MenuItem disabled value="">
                  Nothing has been built for {project} yet
                </MenuItem>
              )}
              {available.map((r) => (
                <MenuItem key={r.id} value={r.id}>
                  <Stack direction="row" spacing={1} sx={{ width: '100%', alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {r.id}
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <Typography
                      variant="caption"
                      sx={{
                        fontFamily: 'monospace',
                        color: r.gates.failed > 0 ? 'error.main' : r.gates.notRun > 0 ? 'warning.main' : 'success.main',
                      }}
                    >
                      {r.gates.passed}/{r.gates.total}
                    </Typography>
                    {r.statics && (
                      <Chip label={r.statics.stack} size="small" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                    )}
                  </Stack>
                </MenuItem>
              ))}
            </TextField>
          )}

          {release ? (
            <Box>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                {release.id}
              </Typography>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mt: 0.75 }}>
                <CommitPair
                  projectCommit={release.projectCommit}
                  omniCommit={release.omniCommit}
                  onRemote={release.onRemote}
                  project={release.project}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${release.artifacts.count} app${release.artifacts.count === 1 ? '' : 's'}`}
                  sx={{ height: 20, fontSize: 11 }}
                />
                {release.statics && (
                  <Chip size="small" variant="outlined" label={`statics: ${release.statics.stack}`} sx={{ height: 20, fontSize: 11 }} />
                )}
              </Stack>
            </Box>
          ) : (
            <Alert severity="warning">No release chosen.</Alert>
          )}

          <TextField
            select
            label="Stack"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            size="small"
            fullWidth
            disabled={deploying}
            helperText="A release is deployed to a remote or cluster stack; a local stack runs the working tree."
          >
            {stacks.length === 0 && (
              <MenuItem disabled value="">
                This project has no stacks
              </MenuItem>
            )}
            {stacks.map((s) => (
              <MenuItem key={s.name} value={s.name} disabled={s.type === 'local'}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', width: '100%' }}>
                  <Typography variant="body2">{s.name}</Typography>
                  <Chip label={s.type} size="small" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                  {s.config?.release?.mode === 'required' && (
                    <Chip label="releases only" size="small" color="info" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                  )}
                  <Box sx={{ flex: 1 }} />
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {s.status}
                  </Typography>
                </Stack>
              </MenuItem>
            ))}
          </TextField>

          {release && release.gates.total > 0 && (
            <Box>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {gateSentence(release.gateList)}
              </Typography>
              <Box sx={{ mt: 0.5 }}>
                <GateStrip gates={release.gateList} />
              </Box>
            </Box>
          )}

          {checking && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <CircularProgress size={16} />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Asking the daemon whether it would take this release…
              </Typography>
            </Stack>
          )}

          {verdict && (
            <Alert severity={verdict.ok ? 'success' : 'error'}>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {verdict.because}
              </Typography>
            </Alert>
          )}

          {requiresRelease && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {target} takes releases only — its plain Start is refused by the daemon on purpose.
            </Typography>
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
        <Button onClick={onClose} size="small" disabled={deploying}>
          Cancel
        </Button>
        <Button
          variant="contained"
          size="small"
          startIcon={deploying ? <CircularProgress size={14} color="inherit" /> : <DeployIcon />}
          disabled={!release || !target || deploying || checking || verdict?.ok !== true}
          onClick={handleDeploy}
        >
          {deploying ? 'Deploying…' : 'Deploy'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
