/**
 * StackDetailPage — Detailed view of a single stack
 *
 * Shows:
 * - Overview: type, status, settings, port range
 * - Nodes: list with status, SSH info, sync status
 * - Infrastructure: provisioned services with connection info
 * - Apps: app status within this stack
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Alert from '@mui/material/Alert';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import { Breadcrumbs, PageContent } from '@omnitron/prism';
import { PlayIcon, StopIcon, RefreshIcon, SyncIcon, DeployIcon, DeleteIcon } from '../../assets/icons';
import {
  useProjectStore,
  useActiveProject,
  useActiveProjectStacks,
} from '../../stores/project.store';
import { formatUptime } from '../../utils/formatters';
import type { IStackInfo, IStackNodeStatus } from '@omnitron-dev/omnitron/dto/services';

const STATUS_COLORS: Record<string, string> = {
  running: '#22c55e',
  starting: '#eab308',
  stopping: '#eab308',
  degraded: '#f97316',
  error: '#ef4444',
  stopped: '#6b7280',
};

export default function StackDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const activeProject = useActiveProject();
  const stacks = useActiveProjectStacks();
  const fetchStacks = useProjectStore((s) => s.fetchStacks);
  const startStack = useProjectStore((s) => s.startStack);
  const stopStack = useProjectStore((s) => s.stopStack);
  const deleteStack = useProjectStore((s) => s.deleteStack);
  const pendingOps = useProjectStore((s) => s.pendingOps);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const stack = stacks.find((s) => s.name === name);
  const pendingOp = activeProject && name ? (pendingOps[`${activeProject}/${name}`] ?? null) : null;

  useEffect(() => {
    if (activeProject) fetchStacks(activeProject);
  }, [activeProject, fetchStacks]);

  const hasPendingOps = Object.keys(pendingOps).length > 0;
  useEffect(() => {
    if (!activeProject) return;
    const interval = hasPendingOps ? 3_000 : 10_000;
    const timer = setInterval(() => fetchStacks(activeProject), interval);
    return () => clearInterval(timer);
  }, [activeProject, fetchStacks, hasPendingOps]);

  const handleStart = useCallback(async () => {
    if (!activeProject || !name) return;
    try { await startStack(activeProject, name); } catch { /* error in store */ }
  }, [activeProject, name, startStack]);

  const handleStop = useCallback(async () => {
    if (!activeProject || !name) return;
    try { await stopStack(activeProject, name); } catch { /* error in store */ }
  }, [activeProject, name, stopStack]);

  const handleDelete = useCallback(async () => {
    if (!activeProject || !name) return;
    try {
      await deleteStack(activeProject, name);
      navigate('/stacks');
    } catch { /* error in store */ }
    setDeleteOpen(false);
  }, [activeProject, name, deleteStack, navigate]);

  if (!stack) {
    return (
      <PageContent>
        <Alert severity="warning">
          Stack "{name}" not found.{' '}
          <Button size="small" onClick={() => navigate('/stacks')}>
            Back to Stacks
          </Button>
        </Alert>
      </PageContent>
    );
  }

  const isRunning = stack.status === 'running';
  const isStopped = stack.status === 'stopped';
  const isTransitioning = stack.status === 'starting' || stack.status === 'stopping' || !!pendingOp;
  const busy = !!pendingOp;

  return (
    <PageContent>
      <Breadcrumbs
        linkComponent={RouterLink}
        links={[
          { name: 'Stacks', href: '/stacks' },
          { name: stack.name },
        ]}
        action={
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Chip
              label={stack.status.charAt(0).toUpperCase() + stack.status.slice(1)}
              size="small"
              sx={{
                bgcolor: STATUS_COLORS[stack.status] ?? STATUS_COLORS.stopped,
                color: 'white',
                fontWeight: 600,
              }}
            />
            {isStopped && !busy && (
              <IconButton size="small" color="error" onClick={() => setDeleteOpen(true)} title="Delete stack">
                <DeleteIcon />
              </IconButton>
            )}
            <IconButton size="small" onClick={() => activeProject && fetchStacks(activeProject)}>
              <RefreshIcon />
            </IconButton>
            {isTransitioning ? (
              <Button
                variant="outlined"
                size="small"
                disabled
                startIcon={<CircularProgress size={14} />}
              >
                {pendingOp === 'starting' || stack.status === 'starting' ? 'Starting...' : 'Stopping...'}
              </Button>
            ) : isStopped ? (
              <Button startIcon={<PlayIcon />} color="success" variant="contained" size="small" onClick={handleStart}>
                Start
              </Button>
            ) : isRunning ? (
              <Button startIcon={<StopIcon />} color="error" variant="outlined" size="small" onClick={handleStop}>
                Stop
              </Button>
            ) : null}
          </Box>
        }
      />

      {/* Deployment banner for remote/cluster stacks */}
      {stack.type !== 'local' && isRunning && (
        <Card variant="outlined" sx={{ mb: 2, p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <DeployIcon sx={{ fontSize: 20, color: 'primary.main' }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" fontWeight={600}>
                {stack.nodes.filter((n) => n.connected).length}/{stack.nodes.length} nodes connected
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {stack.type === 'remote' ? 'SSH' : 'Cluster'} deployment —
                {stack.nodes.some((n) => n.syncStatus?.pendingItems)
                  ? ` ${stack.nodes.reduce((sum, n) => sum + (n.syncStatus?.pendingItems ?? 0), 0)} items pending sync`
                  : ' all synced'}
              </Typography>
            </Box>
            {stack.nodes.some((n) => !n.connected) && (
              <Chip
                label={`${stack.nodes.filter((n) => !n.connected).length} offline`}
                size="small"
                color="warning"
                sx={{ height: 22, fontSize: '0.65rem' }}
              />
            )}
          </Box>
        </Card>
      )}

      {/* Applications — top priority */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="overline" sx={{ color: 'text.secondary', fontSize: '0.65rem', mb: 1, display: 'block' }}>
            Applications ({stack.apps.length})
          </Typography>
          {stack.apps.length > 0 ? (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>App</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>PID</TableCell>
                  <TableCell>Instances</TableCell>
                  <TableCell>Uptime</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stack.apps.map((app) => (
                  <TableRow key={app.handleKey}>
                    <TableCell sx={{ fontWeight: 600 }}>{app.name}</TableCell>
                    <TableCell>
                      <Chip
                        label={app.status}
                        size="small"
                        color={app.status === 'online' ? 'success' : app.status === 'crashed' || app.status === 'errored' ? 'error' : 'default'}
                        sx={{ height: 18, fontSize: '0.6rem' }}
                      />
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      {app.pid ?? '—'}
                    </TableCell>
                    <TableCell>{app.instances}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      {app.uptime > 0 ? formatUptime(app.uptime) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>
              No apps configured
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* Overview */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="overline" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
            Overview
          </Typography>
          <InfoRow label="Type" value={stack.type === 'local' ? 'Local' : stack.type === 'remote' ? 'Remote (SSH)' : 'Cluster'} />
          <InfoRow label="Apps" value={`${stack.apps.filter((a) => a.status === 'online').length} / ${stack.apps.length}`} />
          <InfoRow label="Nodes" value={`${stack.nodes.filter((n) => n.connected).length} / ${stack.nodes.length}`} />
          {stack.uptime > 0 && <InfoRow label="Uptime" value={formatUptime(stack.uptime)} />}
          {stack.portRange && (
            <InfoRow label="Port Range" value={`${stack.portRange.start}–${stack.portRange.end}`} mono />
          )}
          {stack.startedAt && <InfoRow label="Started" value={new Date(stack.startedAt).toLocaleString()} />}
        </CardContent>
      </Card>

      {/* Infrastructure cards */}
      <InfrastructureCards stack={stack} />

      {/* Sync Status (remote/cluster only) */}
      {stack.type !== 'local' && (
        <Card variant="outlined">
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
              <SyncIcon sx={{ fontSize: 16 }} />
              <Typography variant="overline" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
                Sync Status
              </Typography>
            </Box>
            {stack.nodes.map((node) => (
              <NodeSyncRow key={node.host} node={node} />
            ))}
            {stack.nodes.length === 0 && (
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                No nodes configured
              </Typography>
            )}
          </CardContent>
        </Card>
      )}

      {/* Nodes Table */}
      {stack.nodes.length > 0 && (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="overline" sx={{ color: 'text.secondary', fontSize: '0.65rem', mb: 1, display: 'block' }}>
              Nodes ({stack.nodes.length})
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Host</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Daemon</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Last Seen</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stack.nodes.map((node) => (
                  <TableRow key={node.host}>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      {node.host}:{node.port}
                      {node.label && (
                        <Typography component="span" variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
                          ({node.label})
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip label={node.role} size="small" sx={{ height: 18, fontSize: '0.6rem' }} />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={node.daemonRole}
                        size="small"
                        color={node.daemonRole === 'master' ? 'primary' : 'default'}
                        sx={{ height: 18, fontSize: '0.6rem' }}
                      />
                    </TableCell>
                    <TableCell>
                      <Box
                        component="span"
                        sx={{
                          display: 'inline-block',
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: node.connected ? '#22c55e' : '#ef4444',
                          mr: 0.5,
                        }}
                      />
                      {node.connected ? 'Connected' : 'Disconnected'}
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      {node.lastSeen ? new Date(node.lastSeen).toLocaleTimeString() : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <DialogTitle>Delete Stack</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete stack <strong>{stack.name}</strong>? This action cannot be undone.
            All infrastructure configuration for this stack will be removed.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained">Delete</Button>
        </DialogActions>
      </Dialog>
    </PageContent>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, ...(mono && { fontFamily: 'monospace', fontSize: '0.8rem' }) }}>
        {value}
      </Typography>
    </Box>
  );
}

function NodeSyncRow({ node }: { node: IStackNodeStatus }) {
  const sync = node.syncStatus;

  return (
    <Box sx={{ py: 0.75 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: node.connected ? '#22c55e' : '#ef4444',
              ...(node.connected && { boxShadow: '0 0 6px rgba(34,197,94,0.5)' }),
            }}
          />
          <Box>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', fontWeight: 600 }}>
              {node.host}:{node.port}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem' }}>
              {node.daemonRole}{node.label ? ` — ${node.label}` : ''}
            </Typography>
          </Box>
        </Box>

        {sync ? (
          <Box sx={{ textAlign: 'right' }}>
            <Chip
              label={
                sync.connected && sync.pendingItems === 0
                  ? 'Synced'
                  : sync.connected
                    ? `${sync.pendingItems} pending`
                    : sync.failedAttempts > 0
                      ? `Failed (${sync.failedAttempts}x)`
                      : 'Buffering'
              }
              size="small"
              color={
                sync.connected && sync.pendingItems === 0
                  ? 'success'
                  : sync.failedAttempts > 0
                    ? 'error'
                    : 'warning'
              }
              variant="outlined"
              sx={{ height: 20, fontSize: '0.6rem', fontWeight: 600 }}
            />
            {sync.lastSyncAt && (
              <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', fontSize: '0.5rem', mt: 0.25 }}>
                last sync {new Date(sync.lastSyncAt).toLocaleTimeString()}
              </Typography>
            )}
          </Box>
        ) : (
          <Chip
            label={node.connected ? 'Connected' : 'Offline'}
            size="small"
            color={node.connected ? 'success' : 'default'}
            variant="outlined"
            sx={{ height: 20, fontSize: '0.6rem' }}
          />
        )}
      </Box>

      {/* Sync progress bar for nodes with pending items */}
      {sync && sync.pendingItems > 0 && (
        <LinearProgress
          variant="indeterminate"
          color="warning"
          sx={{ mt: 0.5, height: 2, borderRadius: 1, opacity: 0.6 }}
        />
      )}

      {/* Error message */}
      {sync?.lastError && (
        <Typography variant="caption" sx={{ color: 'error.main', fontSize: '0.55rem', mt: 0.25, display: 'block', ml: 2.5 }}>
          {sync.lastError}
        </Typography>
      )}
    </Box>
  );
}

// =============================================================================
// Infrastructure Section
// =============================================================================

interface InfraProps { stack: IStackInfo }

function InfrastructureCards({ stack }: InfraProps) {
  const configInfra = stack.config?.infrastructure as any;
  const runtimeServices = stack.infrastructure?.services ?? {};
  const hasConfig = configInfra && Object.keys(configInfra).length > 0;
  const hasRuntime = Object.keys(runtimeServices).length > 0;

  if (!hasConfig && !hasRuntime) return null;

  const pg = configInfra?.postgres;
  const redis = configInfra?.redis;
  const minio = configInfra?.minio;

  return (
    <>
      {/* PostgreSQL */}
      {pg && (
        <Card variant="outlined">
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="overline" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
                PostgreSQL
              </Typography>
              <RuntimeChip name="postgres" runtime={runtimeServices} />
            </Box>
            <InfoRow label="Port" value={String(pg.port ?? 5432)} mono />
            {pg.databases && Object.keys(pg.databases).length > 0 && (
              <>
                <Typography variant="caption" sx={{ color: 'text.secondary', mt: 1, display: 'block' }}>
                  Databases ({Object.keys(pg.databases).length})
                </Typography>
                {Object.entries(pg.databases as Record<string, any>).map(([name, cfg]) => (
                  <Box key={name} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.25, pl: 1 }}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{name}</Typography>
                    {cfg?.migrate && <Chip label="migrate" size="small" sx={{ height: 16, fontSize: '0.55rem' }} />}
                  </Box>
                ))}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Redis */}
      {redis && (
        <Card variant="outlined">
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="overline" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
                Redis
              </Typography>
              <RuntimeChip name="redis" runtime={runtimeServices} />
            </Box>
            <InfoRow label="Port" value={String(redis.port ?? 6379)} mono />
            {redis.databases && Object.keys(redis.databases).length > 0 && (
              <>
                <Typography variant="caption" sx={{ color: 'text.secondary', mt: 1, display: 'block' }}>
                  DB Allocations ({Object.keys(redis.databases).length})
                </Typography>
                {Object.entries(redis.databases as Record<string, number>).map(([name, db]) => {
                  const isService = name.includes(':');
                  return (
                    <Box key={name} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.25, pl: 1 }}>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        {isService ? name.split(':')[1] : name}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                        {isService && (
                          <Chip label={name.split(':')[0]} size="small" variant="outlined" sx={{ height: 16, fontSize: '0.5rem' }} />
                        )}
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.secondary', minWidth: 28, textAlign: 'right' }}>
                          DB {db}
                        </Typography>
                      </Box>
                    </Box>
                  );
                })}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* MinIO / S3 */}
      {minio && (
        <Card variant="outlined">
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="overline" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
                MinIO / S3
              </Typography>
              <RuntimeChip name="minio" runtime={runtimeServices} />
            </Box>
            {minio.ports && (
              <>
                <InfoRow label="API Port" value={String(minio.ports.api ?? 9000)} mono />
                <InfoRow label="Console Port" value={String(minio.ports.console ?? 9001)} mono />
              </>
            )}
            {minio.buckets && minio.buckets.length > 0 && (
              <>
                <Typography variant="caption" sx={{ color: 'text.secondary', mt: 1, display: 'block' }}>
                  Buckets ({minio.buckets.length})
                </Typography>
                {minio.buckets.map((bucket: string) => (
                  <Typography key={bucket} variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', pl: 1, py: 0.25 }}>
                    {bucket}
                  </Typography>
                ))}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function RuntimeChip({ name, runtime }: { name: string; runtime: Record<string, any> }) {
  const svc = runtime[name];
  if (!svc) return <Chip label="Stopped" size="small" sx={{ height: 18, fontSize: '0.6rem' }} />;
  return (
    <Chip
      label={svc.status}
      size="small"
      color={svc.status === 'running' ? 'success' : svc.status === 'error' ? 'error' : 'default'}
      sx={{ height: 18, fontSize: '0.6rem' }}
    />
  );
}
