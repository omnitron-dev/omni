import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Autocomplete, Box, Button, Card, CardContent, Checkbox, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControlLabel, LinearProgress, Stack, TextField, Typography } from '@mui/material';
import type { INodeWithStatus, KernelRollout, KernelRolloutTarget } from '@omnitron-dev/omnitron/dto/services';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { daemon, nodes as nodesRpc } from 'src/netron/client';
import { useAccess } from 'src/auth/access';
import { when } from './release-bits';

type Tone = 'default' | 'info' | 'success' | 'warning' | 'error';
const tone: Record<KernelRollout['state'] | KernelRolloutTarget['state'], Tone> = {
  pending: 'default', planning: 'info', planned: 'default', ready: 'info', running: 'info', succeeded: 'success', current: 'success',
  blocked: 'warning', uncertain: 'warning', failed: 'error', 'rolled-back': 'warning',
};

function RolloutReceipt({ receipt }: { receipt: KernelRollout }) {
  const confirmed = receipt.targets.filter(t => t.state === 'succeeded' || t.state === 'current').length;
  const checking = receipt.state === 'planning';
  const completed = checking ? receipt.targets.filter(t => t.state !== 'pending').length : confirmed;
  return (
    <Stack spacing={1.25} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip size="small" color={tone[receipt.state]} label={receipt.state} />
        <Typography variant="body2" aria-live="polite">{completed}/{receipt.targets.length} {checking ? 'nodes checked' : 'on target'}</Typography>
        <Typography variant="caption" color="text.secondary">Updated {when(receipt.updatedAt)}</Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary" component="div">
        Commit <code>{receipt.commit}</code><br />Plan <code>{receipt.id}</code>
      </Typography>
      {(checking || receipt.state === 'running') && <LinearProgress aria-label={checking ? 'Node preflight checks completed' : 'Nodes confirmed on the target build'}
        variant="determinate" value={completed / Math.max(1, receipt.targets.length) * 100} />}
      {receipt.reason && <Alert severity={receipt.state === 'failed' ? 'error' : 'warning'}>{receipt.reason}</Alert>}
      {receipt.state === 'uncertain' && <Typography variant="body2">Reconciliation reads the recorded node outcome without replaying activation. Inspect its owner and rollback target before planning another update.</Typography>}
      <Stack component="ol" spacing={1} sx={{ m: 0, pl: 0, listStyle: 'none' }}>
        {receipt.targets.map((target, index) => (
          <Box component="li" key={target.nodeId} sx={{ minWidth: 0, borderTop: 1, borderColor: 'divider', pt: 1 }}>
            <Stack direction="row" useFlexGap spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{index + 1}. {target.name}</Typography>
              <Chip size="small" variant="outlined" color={tone[target.state]} label={target.state} />
            </Stack>
            {target.reason && <Typography variant="body2">{target.reason}</Typography>}
            <Box component="details" open={['blocked', 'failed', 'rolled-back', 'uncertain'].includes(target.state)}
              sx={{ typography: 'caption', color: 'text.secondary', '& summary': { cursor: 'pointer' } }}>
              <summary>Owner and rollback details</summary>
              Node <code>{target.nodeId}</code> · Owner <code>{target.ownerId ?? 'unconfirmed'}</code>
              {target.ownerPid !== null && <> · PID {target.ownerPid}</>}<br />
              Rollback target <code>{target.previous ?? 'unconfirmed'}</code><br />
              Candidate <code>{target.candidate ?? 'unconfirmed'}</code>
            </Box>
          </Box>
        ))}
      </Stack>
    </Stack>
  );
}

function PlanDialog({ nodes, close, review }: {
  nodes: INodeWithStatus[]; close: () => void; review: (id: string) => void;
}) {
  const [commit, setCommit] = useState('');
  const [targets, setTargets] = useState<INodeWithStatus[]>([]);
  const [stage, setStage] = useState(false);
  const [allTargets, setAllTargets] = useState(false);
  const { can } = useAccess();
  const canReadBuild = can('OmnitronDaemon.status');
  const canListBuilds = can('OmnitronNodes.listKernelBuilds');
  const catalog = usePolledResource(() => nodesRpc.listKernelBuilds(), {
    enabled: canListBuilds, paused: true, intervalMs: 30_000, resourceKey: String(canListBuilds),
  });
  const catalogByCommit = useMemo(() => {
    const entries = new Map<string, string[]>();
    for (const build of canListBuilds ? catalog.data ?? [] : []) {
      const variants = entries.get(build.commit) ?? [];
      variants.push(`${build.platform}/${build.arch} · Node ${build.nodeVersion}`);
      entries.set(build.commit, variants);
    }
    return entries;
  }, [canListBuilds, catalog.data]);
  const controller = usePolledResource(async () => {
    const { build } = await daemon.status();
    return build?.dirty === false && /^[a-f0-9]{40}$/.test(build.commit) ? build.commit : null;
  }, { enabled: canReadBuild, paused: true, intervalMs: 30_000, resourceKey: String(canReadBuild) });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const lastRequest = useRef<{ inputs: string; id: string } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const normalized = commit.trim().toLowerCase();
  const valid = /^[a-f0-9]{40}$/.test(normalized) && (allTargets || targets.length > 0);
  const plan = async () => {
    if (!valid || pending) return;
    setPending(true); setError(null);
    try {
      const input = { commit: normalized, ...(targets.length ? { nodeIds: targets.map(node => node.id) } : {}), ...(stage && { stage: true }) };
      const inputs = JSON.stringify(input);
      if (!lastRequest.current || lastRequest.current.inputs !== inputs) lastRequest.current = { inputs, id: crypto.randomUUID() };
      const prepared = await nodesRpc.planKernelRollout({ ...input, requestId: lastRequest.current.id });
      if (prepared.id !== lastRequest.current.id) throw Error('Controller returned a different request ID.');
      if (mounted.current) review(prepared.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(false); }
  };
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={() => { if (!pending) close(); }} aria-labelledby="kernel-plan-title">
      <DialogTitle id="kernel-plan-title">Plan backend update</DialogTitle>
      <Box component="form" onSubmit={event => { event.preventDefault(); void plan(); }}>
        <DialogContent>
          <Stack spacing={2}>
            <Autocomplete freeSolo disabled={pending} options={[...catalogByCommit.keys()]} loading={canListBuilds && catalog.loading}
              inputValue={commit} onInputChange={(_, next) => setCommit(next)}
              renderOption={({ key, ...props }, sha) => <Box key={key} component="li" {...props}>
                <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  <code>{sha}</code><Typography component="div" variant="caption">{catalogByCommit.get(sha)?.join(', ')}</Typography>
                </Box></Box>}
              renderInput={params => <TextField {...params} label="Target commit" autoFocus required fullWidth
                helperText={catalog.error ? `Catalog unavailable. Enter the commit manually. ${catalog.error}`
                  : 'Choose a catalog build or enter the full 40-character Git commit.'} />} />
            {canReadBuild && controller.data && <Button size="small" sx={{ alignSelf: 'flex-start' }} disabled={pending}
              onClick={() => setCommit(controller.data!)}>Use controller commit {controller.data.slice(0, 12)}</Button>}
            <Autocomplete multiple disabled={pending || allTargets} options={nodes.filter(node => !node.isLocal)} value={targets}
              getOptionLabel={node => node.name + ' · ' + node.host} getOptionKey={node => node.id} isOptionEqualToValue={(a, b) => a.id === b.id}
              onChange={(_, next) => setTargets(next)} renderInput={params => <TextField {...params}
                label="Target nodes" helperText="Select nodes in update order, or explicitly choose all registered remote nodes." />} />
            <FormControlLabel control={<Checkbox checked={allTargets} disabled={pending} onChange={e => {
              setAllTargets(e.target.checked); if (e.target.checked) setTargets([]);
            }} />} label="All registered remote nodes" />
            <FormControlLabel control={<Checkbox checked={stage} disabled={pending} onChange={e => setStage(e.target.checked)} />}
              label="Stage from controller catalog" />
            {stage && <Typography variant="caption" color="text.secondary">
              Preparation transfers missing runtimes from the controller and installs them for native checks. Applying the reviewed plan activates them.
            </Typography>}
            {error && <Alert severity="warning" action={lastRequest.current && <Button size="small" color="inherit"
              onClick={() => review(lastRequest.current!.id)}>Check last request</Button>}>{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={pending}>Cancel</Button>
          <Button type="submit" variant="contained" loading={pending} disabled={!valid}>Prepare plan</Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

export function ManagedFleetRollout({ nodes, canPlan, canApply, canReconcile }: {
  nodes: INodeWithStatus[]; canPlan: boolean; canApply: boolean; canReconcile: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('rollout');
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState<KernelRollout | null>(null);
  const [revision, reload] = useReducer(n => n + 1, 0);
  const [running, setRunning] = useState(false);
  const { data: observed, error, loading } = usePolledResource(async () => {
    const result = await nodesRpc.getKernelRollout(selectedId ? { id: selectedId } : {});
    if (selectedId && result && result.id !== selectedId) throw Error('Controller returned another rollout receipt.');
    return result;
  }, { intervalMs: running ? 3_000 : 20_000, resourceKey: JSON.stringify([selectedId, revision]) });

  // Terminal receipts are immutable. Keep the acknowledged result when a
  // follow-up read is delayed, fails, or still returns the pre-action state.
  const receipt = acknowledged?.id === selectedId && (
    ['succeeded', 'failed', 'blocked'].includes(acknowledged.state) || !observed ||
    observed.id === acknowledged.id && observed.state === 'planned' && acknowledged.state === 'running'
  ) ? acknowledged : observed;
  useEffect(() => { setRunning(receipt?.state === 'running' || receipt?.state === 'planning'); }, [receipt?.state]);

  const select = (id: string | null) => {
    setActionError(null); setAcknowledged(null);
    setParams(current => {
      const next = new URLSearchParams(current);
      if (id) next.set('rollout', id); else next.delete('rollout');
      return next;
    });
  };
  const submit = async (operation: 'apply' | 'reconcile') => {
    if (applying || error || !receipt || receipt.id !== selectedId) return;
    if (operation === 'apply' ? !canApply || receipt.state !== 'planned' : !canReconcile || receipt.state !== 'uncertain') return;
    setApplying(true); setActionError(null);
    try {
      const result = operation === 'apply' ? await nodesRpc.startKernelRollout({ id: receipt.id })
        : await nodesRpc.reconcileKernelRollout({ id: receipt.id });
      if (result.id !== receipt.id) throw Error('Controller returned another rollout receipt.');
      setAcknowledged(result);
    }
    catch (cause) {
      setActionError('Request was not confirmed. Check the controller receipt. ' + (cause instanceof Error ? cause.message : String(cause)));
    } finally { setApplying(false); reload(); }
  };
  return (
    <Card variant="outlined" component="section" aria-label="Managed backend updates" sx={{ minWidth: 0 }}>
      <CardContent>
        <Stack spacing={1.5}>
          <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <Typography variant="subtitle2" sx={{ flex: '1 1 auto' }}>Managed backend updates</Typography>
            {selectedId && <Button size="small" disabled={applying} onClick={() => select(null)}>Latest rollout</Button>}
            {canPlan && <Button size="small" variant="outlined" disabled={applying || receipt?.state === 'running' || receipt?.state === 'planning'} onClick={() => setPlanning(true)}>Plan update…</Button>}
          </Stack>
          {loading && <LinearProgress aria-label="Reading rollout receipt" />}
          {error && <Alert severity="warning" action={<Button color="inherit" size="small" onClick={reload}>Retry</Button>}>
            Could not read the rollout receipt. {error}
          </Alert>}
          {actionError && <Alert severity="warning">{actionError}</Alert>}
          {receipt ? <>
            <RolloutReceipt receipt={receipt} />
            {canApply && receipt.state === 'planned' && <Box>
              {receipt.id === selectedId
                ? <Button color="primary" variant="contained" loading={applying} disabled={Boolean(error) || loading} onClick={() => void submit('apply')}>Apply reviewed plan</Button>
                : <Button variant="outlined" disabled={Boolean(error)} onClick={() => select(receipt.id)}>Review plan</Button>}
            </Box>}
            {canReconcile && receipt.state === 'uncertain' && <Box>
              {receipt.id === selectedId
                ? <Button variant="outlined" loading={applying} disabled={Boolean(error) || loading} onClick={() => void submit('reconcile')}>Reconcile node status</Button>
                : <Button variant="outlined" disabled={Boolean(error)} onClick={() => select(receipt.id)}>Inspect uncertain rollout</Button>}
            </Box>}
          </> : !loading && !error && <Typography variant="body2" color="text.secondary">
            {selectedId ? 'The controller has no receipt for this rollout.' : 'No managed backend update has been planned.'}
          </Typography>}
        </Stack>
      </CardContent>
      {canPlan && planning && <PlanDialog nodes={nodes} close={() => setPlanning(false)} review={id => {
        select(id); setPlanning(false); reload();
      }} />}
    </Card>
  );
}
