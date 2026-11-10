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

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Autocomplete from '@mui/material/Autocomplete';
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

import type { DeployProgressRecord, IStackInfo, ReleaseAdmission, ReleaseSummary } from '@omnitron-dev/omnitron/dto/services';
import { observeStackStart } from '@omnitron-dev/omnitron/release-reading';
import { invokeStackLifecycle, project as projectRpc } from 'src/netron/client';
import { releaseApi } from 'src/netron/release-wire';
import { useProjectStore } from 'src/stores/project.store';
import { DeployIcon } from 'src/assets/icons';

import { CommitPair, GateStrip, gateSentence } from './release-bits';
import { DeployProgressList } from './deploy-progress';

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
  const location = useLocation();
  const inspect = (target: string) => {
    const store = useProjectStore.getState();
    if (store.activeProject !== project) store.selectProject(project,location.pathname);
    onClose();
    navigate(`/stacks/${encodeURIComponent(target)}`);
  };
  const stacksByProject = useProjectStore((s) => s.stacksByProject);
  const fetchStacks = useProjectStore((s) => s.fetchStacks);
  const startStack = useProjectStore((s) => s.startStack);

  const stacks: IStackInfo[] = stacksByProject[project] ?? [];
  const stackError = useProjectStore(s => s.stackReadErrors[project]);
  const [loadingReleases, setLoadingReleases] = useState(false);
  const [available, setAvailable] = useState<ReleaseSummary[]>([]);
  const [picked, setPicked] = useState('');
  const [target, setTarget] = useState(stack ?? '');
  const [answer, setVerdict] = useState<(ReleaseAdmission & { key: string }) | null>(null);
  const [checking, setChecking] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const selection = useRef(0);
  const [deploying, setDeploying] = useState(false);
  const [activity, setActivity] = useState<{ records: DeployProgressRecord[]; available: boolean }>({ records: [], available: true });
  const [inspectTarget, setInspectTarget] = useState(false);
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
    setLoadingReleases(true);
    setAvailable([]); setPicked('');
    releaseApi
      .list()
      .then(({ releases }) => {
        if (!current) return;
        const mine = releases.filter((r) => r.project === project && r.complete);
        setAvailable(mine);
      })
      .catch((err: Error) => {
        if (current) setFailure(`The release store could not be read: ${err.message}`);
      }).finally(() => { if (current) setLoadingReleases(false); });
    return () => {
      current = false;
    };
  }, [open, given, project]);

  const release = given ?? available.find((r) => r.id === picked) ?? null;
  // The effect below needs the identity of the release, not the object: a
  // new array from every poll would otherwise re-ask the daemon for a
  // verdict it has already given.
  const releaseId = given?.id ?? picked.trim();
  const key = JSON.stringify([project,target,releaseId]);
  const verdict = answer?.key === key ? answer : null;

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
    const generation = ++selection.current;
    setVerdict(null);
    setPreparing(false);
    setDeploying(false);
    setActivity({ records: [], available: true });
    setInspectTarget(false);
    setFailure(null);
    setChecking(false);
    if (!open || !releaseId || !target) return undefined;
    let current = true;
    setChecking(true);
    const timeout = window.setTimeout(() => {
      void invokeStackLifecycle('checkRelease', { project, stack: target, release: releaseId })
      .then((response) => {
        if (current) setVerdict({ ...response, key });
      })
      .catch((err: Error) => {
        if (current) setVerdict({ key, ok: false, because: `The daemon could not answer: ${err.message}` });
      })
      .finally(() => {
        if (current) setChecking(false);
      });
    }, 250);
    return () => { current = false; selection.current = generation + 1; window.clearTimeout(timeout); };
  }, [open, project, target, releaseId, key]);

  const handlePrepare = async () => {
    const request = selection.current;
    setPreparing(true);
    setFailure(null);
    try {
      const response = await invokeStackLifecycle('checkRelease', { project, stack: target, release: releaseId, prepare: true });
      if (request === selection.current) setVerdict({ ...response, key });
    } catch (err) {
      if (request === selection.current) setFailure((err as Error).message);
    } finally {
      if (request === selection.current) setPreparing(false);
    }
  };

  const handleDeploy = async () => {
    if (!releaseId || !target || !verdict?.ok) return;
    setDeploying(true);
    setFailure(null);
    const attempt = selection.current;
    try {
      const outcome = await observeStackStart({ project, stack: target, release: releaseId },
        () => startStack(project, target, { release: releaseId }),
        () => projectRpc.getDeployProgress({ project, stack: target }),
        (records, _changed, observable) => {
          if (selection.current === attempt) setActivity({ records, available: observable });
        });
      if (selection.current !== attempt) return;
      if (outcome.state !== 'confirmed') {
        setFailure(outcome.message);
        setInspectTarget(outcome.state !== 'failed');
        return;
      }
      inspect(target);
    } catch (err) {
      if (selection.current === attempt) setFailure((err as Error).message);
    } finally {
      if (selection.current === attempt) setDeploying(false);
    }
  };

  const chosen = stacks.find((s) => s.name === target);
  const needsPreparation = verdict?.state === 'unprepared' || verdict?.state === 'missing';
  const requiresRelease = chosen?.config?.release?.mode === 'required';

  return (
    <Dialog open={open} onClose={deploying ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Deploy a release</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {!given && (
            <Autocomplete
              freeSolo
              size="small"
              disabled={deploying || preparing}
              loading={loadingReleases}
              options={available.map(item => item.id)}
              value={picked || null}
              inputValue={picked}
              onChange={(_, value) => setPicked(value ?? '')}
              onInputChange={(_, value) => setPicked(value)}
              renderInput={params => <TextField {...params} label="Release ID" placeholder="Select or enter a release ID" />}
            />
          )}

          {release && (
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
          )}

          <TextField
            select
            label="Stack"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            size="small"
            fullWidth
            disabled={deploying || preparing}
            helperText={chosen?.type === 'local' ? 'Local stacks keep the selected release across restarts. Stop their applications before changing it.' : undefined}
          >
            {stacks.length === 0 && (
              <MenuItem disabled value="">
                {stackError ? 'Stack inventory unavailable' : !stacksByProject[project] ? 'Reading stack inventory…' : 'This project has no stacks'}
              </MenuItem>
            )}
            {stacks.map((s) => (
              <MenuItem key={s.name} value={s.name} disabled={Boolean(s.config?.managedOrigin)}>
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

          {(checking || preparing) && (
            <Stack direction="row" spacing={1} role="status" sx={{ alignItems: 'center' }}>
              <CircularProgress size={16} />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {preparing ? 'Preparing and verifying release files…' : 'Checking this release against the stack…'}
              </Typography>
            </Stack>
          )}

          {verdict && !preparing && (
            <Alert severity={verdict.ok ? 'success' : verdict.state ? 'info' : 'error'}>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {verdict.because}
              </Typography>
            </Alert>
          )}

          {stackError && <Alert severity="warning">Stack inventory unavailable · {stackError}</Alert>}
          {deploying && !activity.records.length && <Typography variant="body2" role="status" color="text.secondary">
            {activity.available ? 'Start submitted. Waiting for target observations…' : 'Transfer observations unavailable. Waiting for the stack reply…'}
          </Typography>}
          <DeployProgressList records={activity.records} unavailable={!activity.available} />
          {requiresRelease && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {target} requires an immutable release.
            </Typography>
          )}

          {failure && (
            <Alert severity={inspectTarget ? 'warning' : 'error'}>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {failure}
              </Typography>
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={deploying ? () => inspect(target) : onClose} size="small">
          {deploying ? 'Open stack' : preparing ? 'Close' : 'Cancel'}
        </Button>
        <Button
          variant="contained"
          size="small"
          startIcon={deploying ? <CircularProgress size={14} color="inherit" /> : <DeployIcon />}
          disabled={!releaseId || !target || deploying || preparing || checking || (!inspectTarget && !needsPreparation && verdict?.ok !== true)}
          onClick={inspectTarget ? () => inspect(target) : needsPreparation ? handlePrepare : handleDeploy}
        >
          {deploying ? 'Deploying…' : preparing ? 'Preparing…' : inspectTarget ? 'Inspect stack' : verdict?.state === 'missing' ? 'Fetch and verify' : needsPreparation ? 'Prepare release' : 'Deploy'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
