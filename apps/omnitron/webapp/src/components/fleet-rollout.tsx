/**
 * Upgrading the fleet — many machines, one decision.
 *
 * A production estate is not one server, and the console must not make an
 * operator press a button per machine and remember which ones they pressed.
 * So this is the whole shape of the operation: choose the nodes, SEE WHAT
 * WOULD HAPPEN TO EACH ONE before anything happens, set how many are touched
 * at once, and then watch every node at once — including the ones waiting
 * their turn, which on a fleet rolled out two at a time is most of them.
 *
 * Three things it refuses to hide:
 *
 * - the plan's `because` for every node it will NOT touch, in the daemon's
 *   own words, so «12 of 14» is never a number without an explanation;
 * - the nodes the rollout declined to queue, for the same reason — a rollout
 *   that quietly shrinks is how an operator comes to believe a machine was
 *   upgraded when it was not;
 * - what `Cancel` can and cannot do. A node still queued is dropped; one
 *   already installing is not interrupted, because stopping an upgrade
 *   between unpacking and activating leaves the node worse than either end.
 *
 * The rollout itself runs in the daemon. Closing this tab does not stop it,
 * and a second console watching sees the same queue.
 */

import { useCallback, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import type {
  INodeUpgradePlan,
  INodeWithStatus,
  NodeUpgradeProgress,
} from '@omnitron-dev/omnitron/dto/services';
import { DeployIcon, StopIcon } from 'src/assets/icons';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { daemonClient, nodes as nodesRpc } from 'src/netron/client';

import { when } from './release-bits';

const PHASE_TONE: Record<NodeUpgradeProgress['phase'], 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  queued: 'default',
  building: 'info',
  transferring: 'info',
  activating: 'warning',
  done: 'success',
  failed: 'error',
  refused: 'error',
};

/**
 * The plan, asked for with a deadline that fits what it does.
 *
 * `planUpgrade` BUILDS the bundle — that is how it can name a target version
 * and say «already on it» instead of listing every node as «upgrade». The
 * console's default deadline is 30 seconds and the build takes longer:
 * measured here, the typed call came back `Request timeout after 30000ms`
 * every time while the master went on building. So this one call is made
 * through the untyped invoke with a deadline of three minutes; everything
 * else on this page uses the typed proxy.
 */
function planUpgrade(data: { nodeIds?: string[] }): Promise<INodeUpgradePlan> {
  return daemonClient.invoke<INodeUpgradePlan>('daemon', 'OmnitronNodes', 'planUpgrade', [data], {
    timeout: 180_000,
  });
}

/** Phases that are still going, so the panel can separate live from finished. */
export function inFlight(phase: NodeUpgradeProgress['phase']): boolean {
  return phase !== 'done' && phase !== 'failed' && phase !== 'refused';
}

export function FleetRollout({ nodes }: { nodes: INodeWithStatus[] }) {
  const [open, setOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // One poll for the whole fleet's progress. Three seconds while anything is
  // moving — an upgrade is minutes long and its phases are seconds apart —
  // and a slow beat when nothing is, so a fleet page left open costs nothing.
  const [fast, setFast] = useState(false);
  const { data: progress, refresh } = usePolledResource<NodeUpgradeProgress[]>(
    async () => {
      const rows = await nodesRpc.getUpgradeProgress();
      setFast(rows.some((r) => inFlight(r.phase)));
      return rows;
    },
    { intervalMs: fast ? 3_000 : 20_000 },
  );

  const rows = progress ?? [];
  const live = rows.filter((r) => inFlight(r.phase));
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const cancel = useCallback(
    async (nodeId: string) => {
      try {
        const answer = await nodesRpc.cancelUpgrade({ nodeId });
        setActionError(answer.stopped ? null : answer.because);
        await refresh();
      } catch (err) {
        setActionError((err as Error).message);
      }
    },
    [refresh],
  );

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: live.length > 0 || rows.length > 0 ? 1.5 : 0 }}>
          <Typography variant="overline" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
            Fleet upgrade
          </Typography>
          {live.length > 0 && (
            <Chip
              size="small"
              color="info"
              label={`${live.length} of ${rows.length} in flight`}
              sx={{ height: 20, fontSize: 11 }}
            />
          )}
          <Box sx={{ flex: 1 }} />
          <Button size="small" variant="contained" startIcon={<DeployIcon />} onClick={() => setOpen(true)}>
            Upgrade nodes…
          </Button>
        </Stack>

        {actionError && (
          <Alert severity="warning" variant="outlined" sx={{ mb: 1.5 }} onClose={() => setActionError(null)}>
            {actionError}
          </Alert>
        )}

        {rows.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            No upgrade has been run from this master since it started.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {rows.map((row) => {
              const node = byId.get(row.nodeId);
              return (
                <Box key={row.nodeId}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 140 }}>
                      {node?.name ?? row.nodeId}
                    </Typography>
                    <Chip size="small" color={PHASE_TONE[row.phase]} label={row.phase} sx={{ height: 20, fontSize: 11 }} />
                    {row.phase === 'queued' && row.position != null && (
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        #{row.position} in the queue
                      </Typography>
                    )}
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {row.message}
                    </Typography>
                    {row.version && (
                      <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                        {row.version}
                      </Typography>
                    )}
                    <Box sx={{ flex: 1 }} />
                    <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                      {when(row.at)}
                    </Typography>
                    {inFlight(row.phase) && (
                      <Tooltip
                        title={
                          row.phase === 'queued'
                            ? 'Drop this node from the queue'
                            : 'A node already installing is not interrupted — the daemon will say so'
                        }
                        arrow
                      >
                        <span>
                          <Button size="small" color="warning" startIcon={<StopIcon />} onClick={() => void cancel(row.nodeId)}>
                            Cancel
                          </Button>
                        </span>
                      </Tooltip>
                    )}
                  </Stack>
                  {inFlight(row.phase) && row.phase !== 'queued' && (
                    <LinearProgress variant="determinate" value={row.percent} sx={{ mt: 0.5, height: 4, borderRadius: 2 }} />
                  )}
                </Box>
              );
            })}
          </Stack>
        )}
      </CardContent>

      <RolloutDialog
        open={open}
        onClose={() => setOpen(false)}
        nodes={nodes}
        onStarted={() => {
          setFast(true);
          void refresh();
        }}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The dialog: choose, plan, start
// ---------------------------------------------------------------------------

function RolloutDialog({
  open,
  onClose,
  nodes,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  nodes: INodeWithStatus[];
  onStarted: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<INodeUpgradePlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [concurrency, setConcurrency] = useState(1);
  const [failure, setFailure] = useState<string | null>(null);
  const [started, setStarted] = useState<{ accepted: string[]; refused: Array<{ nodeId: string; because: string }> } | null>(null);

  // The local machine is not upgraded by a rollout: it IS the rollout.
  const candidates = useMemo(() => nodes.filter((n) => !n.isLocal), [nodes]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const toggle = (id: string) =>
    setPicked((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setPlan(null);
      return next;
    });

  const allPicked = picked.size > 0 && picked.size === candidates.length;

  const buildPlan = useCallback(async () => {
    setPlanning(true);
    setFailure(null);
    try {
      setPlan(await planUpgrade(picked.size > 0 ? { nodeIds: [...picked] } : {}));
    } catch (err) {
      setFailure((err as Error).message);
      setPlan(null);
    } finally {
      setPlanning(false);
    }
  }, [picked]);

  const upgradeRows = plan?.rows.filter((r) => r.action === 'upgrade') ?? [];

  const start = async () => {
    setStarting(true);
    setFailure(null);
    try {
      const answer = await nodesRpc.upgradeNodes({ nodeIds: upgradeRows.map((r) => r.nodeId), concurrency });
      setStarted(answer);
      onStarted();
    } catch (err) {
      setFailure((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <Dialog open={open} onClose={starting ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>Upgrade nodes</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            The master builds one bundle and installs it on each node in turn. The rollout runs in the daemon — closing
            this window does not stop it.
          </Typography>

          <Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
              <Checkbox
                size="small"
                checked={allPicked}
                indeterminate={picked.size > 0 && !allPicked}
                onChange={() => {
                  setPlan(null);
                  setPicked(allPicked ? new Set() : new Set(candidates.map((n) => n.id)));
                }}
              />
              <Typography variant="body2">
                {picked.size === 0 ? 'every node' : `${picked.size} of ${candidates.length} selected`}
              </Typography>
            </Stack>
            <Box sx={{ maxHeight: 220, overflowY: 'auto' }}>
              <Table size="small">
                <TableBody>
                  {candidates.map((n) => (
                    <TableRow key={n.id} hover onClick={() => toggle(n.id)} sx={{ cursor: 'pointer' }}>
                      <TableCell padding="checkbox">
                        <Checkbox size="small" checked={picked.has(n.id)} />
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{n.name}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                        {n.host}:{n.sshPort}
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                        {n.status?.omnitronVersion ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={n.status?.pingReachable ? 'reachable' : 'not reachable'}
                          color={n.status?.pingReachable ? 'success' : 'default'}
                          variant="outlined"
                          sx={{ height: 18, fontSize: 10 }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Box>

          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Button size="small" variant="outlined" onClick={() => void buildPlan()} disabled={planning || starting}>
              {planning ? 'Planning…' : 'Plan'}
            </Button>
            {planning && <CircularProgress size={16} />}
            <TextField
              select
              label="At once"
              size="small"
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              sx={{ width: 120 }}
              disabled={starting}
            >
              {[1, 2, 3, 4, 6, 8].map((n) => (
                <MenuItem key={n} value={n}>
                  {n}
                </MenuItem>
              ))}
            </TextField>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {planning
                ? 'The master is building the bundle so the plan can name a target version — up to a few minutes.'
                : "An upgrade restarts the node's daemon, so one at a time is the safe default."}
            </Typography>
          </Stack>

          {plan && (
            <Box>
              {plan.refusal && (
                <Alert severity="error" sx={{ mb: 1 }}>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {plan.refusal}
                  </Typography>
                </Alert>
              )}
              <Typography variant="body2" sx={{ mb: 1 }}>
                Target <strong style={{ fontFamily: 'monospace' }}>{plan.targetVersion}</strong> —{' '}
                {upgradeRows.length} would be upgraded, {plan.rows.filter((r) => r.action === 'skip').length} already there,{' '}
                {plan.rows.filter((r) => r.action === 'refuse').length} refused.
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Node</TableCell>
                    <TableCell>Now</TableCell>
                    <TableCell>Action</TableCell>
                    <TableCell>Why</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {plan.rows.map((r) => (
                    <TableRow key={r.nodeId}>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {r.label}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
                          {r.host ?? 'no address'}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{r.currentVersion ?? '—'}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={r.action}
                          color={r.action === 'upgrade' ? 'info' : r.action === 'skip' ? 'success' : 'warning'}
                          variant="outlined"
                          sx={{ height: 18, fontSize: 10 }}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {r.because}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}

          {started && (
            <Box>
              <Divider sx={{ mb: 1.5 }} />
              <Alert severity={started.refused.length > 0 ? 'warning' : 'success'}>
                Queued {started.accepted.length} node{started.accepted.length === 1 ? '' : 's'}
                {started.refused.length > 0 ? `; ${started.refused.length} not taken` : ''}.
              </Alert>
              {started.refused.map((r) => (
                <Typography key={r.nodeId} variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
                  <strong>{byId.get(r.nodeId)?.name ?? r.nodeId}</strong> — {r.because}
                </Typography>
              ))}
            </Box>
          )}

          {failure && (
            <Alert severity="error">
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {failure}
              </Typography>
              {/*
                Measured, not guessed: the plan builds the bundle before it
                can name a target version, and the gateway in front of the
                daemon gives up at 120 seconds. Saying so turns «504» into
                something the operator can act on — and the hint disappears
                on its own once the plan stops being a request that waits.
              */}
              {/^(HTTP 50\d|Request timeout)/.test(failure) && (
                <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                  The plan builds the bundle first — that is how it can say «already on the target version» instead of
                  listing every node as an upgrade — and the request outlived the gateway&apos;s 120-second deadline. The
                  master is still building; the CLI (<code>omnitron fleet upgrade --dry-run</code>) has no such deadline.
                </Typography>
              )}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small" disabled={starting}>
          {started ? 'Close' : 'Cancel'}
        </Button>
        <Button
          variant="contained"
          size="small"
          startIcon={starting ? <CircularProgress size={14} color="inherit" /> : <DeployIcon />}
          disabled={starting || !plan || upgradeRows.length === 0 || Boolean(plan.refusal) || started !== null}
          onClick={start}
        >
          {starting ? 'Queueing…' : `Start rollout (${upgradeRows.length})`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
