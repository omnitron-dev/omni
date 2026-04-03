/**
 * StacksPage — Grid of stack cards per project
 *
 * Shows all configured stacks with status, type, node count,
 * app count, and start/stop actions.
 */

import { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActions from '@mui/material/CardActions';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Skeleton from '@mui/material/Skeleton';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import { alpha } from '@mui/material/styles';
import { Breadcrumbs, EmptyContent } from '@omnitron-dev/prism';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { PlayIcon, StopIcon, SyncIcon, RefreshIcon, PlusIcon, DeleteIcon } from '../../assets/icons';
import CreateStackDialog from './create-stack-dialog';
import {
  useProjectStore,
  useActiveProject,
  useActiveProjectStacks,
} from '../../stores/project.store';
import type { IStackInfo } from '@omnitron-dev/omnitron/dto/services';
import { formatUptime } from '../../utils/formatters';

// =============================================================================
// Status colors
// =============================================================================

const STATUS_CHIP: Record<string, { color: 'success' | 'warning' | 'error' | 'default'; label: string }> = {
  running: { color: 'success', label: 'Running' },
  starting: { color: 'warning', label: 'Starting' },
  stopping: { color: 'warning', label: 'Stopping' },
  degraded: { color: 'warning', label: 'Degraded' },
  error: { color: 'error', label: 'Error' },
  stopped: { color: 'default', label: 'Stopped' },
};

const TYPE_LABEL: Record<string, string> = {
  local: 'Local',
  remote: 'Remote (SSH)',
  cluster: 'Cluster',
};

// =============================================================================
// Page
// =============================================================================

export default function StacksPage() {
  const activeProject = useActiveProject();
  const stacks = useActiveProjectStacks();
  const loading = useProjectStore((s) => s.loading);
  const error = useProjectStore((s) => s.error);
  const clearError = useProjectStore((s) => s.clearError);
  const pendingOps = useProjectStore((s) => s.pendingOps);
  const fetchStacks = useProjectStore((s) => s.fetchStacks);
  const startStack = useProjectStore((s) => s.startStack);
  const stopStack = useProjectStore((s) => s.stopStack);
  const deleteStack = useProjectStore((s) => s.deleteStack);
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  useEffect(() => {
    if (activeProject) {
      fetchStacks(activeProject);
    }
  }, [activeProject, fetchStacks]);

  // Auto-refresh: 3s when operations are in-flight, 10s otherwise
  const hasPendingOps = Object.keys(pendingOps).length > 0;
  useEffect(() => {
    if (!activeProject) return;
    const interval = hasPendingOps ? 3_000 : 10_000;
    const timer = setInterval(() => fetchStacks(activeProject), interval);
    return () => clearInterval(timer);
  }, [activeProject, fetchStacks, hasPendingOps]);

  const handleStart = useCallback(
    async (stackName: string) => {
      if (!activeProject) return;
      try {
        await startStack(activeProject, stackName);
      } catch {
        // Error is in store
      }
    },
    [activeProject, startStack]
  );

  const handleStop = useCallback(
    async (stackName: string) => {
      if (!activeProject) return;
      try {
        await stopStack(activeProject, stackName);
      } catch {
        // Error is in store
      }
    },
    [activeProject, stopStack]
  );

  const handleDelete = useCallback(
    async () => {
      if (!activeProject || !deleteTarget) return;
      try {
        await deleteStack(activeProject, deleteTarget);
      } catch {
        // Error is in store
      }
      setDeleteTarget(null);
    },
    [activeProject, deleteTarget, deleteStack]
  );

  if (!activeProject) {
    return (
      <Stack spacing={3}>
        <Alert severity="info">No project selected. Register a project first.</Alert>
      </Stack>
    );
  }

  return (
    <Stack spacing={3} sx={{ flex: 1 }}>
      <Breadcrumbs
        linkComponent={RouterLink}
        links={[{ name: 'Stacks' }]}
        action={
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <IconButton size="small" onClick={() => fetchStacks(activeProject)} title="Refresh">
              <RefreshIcon />
            </IconButton>
            <Button
              variant="contained"
              size="small"
              startIcon={<PlusIcon />}
              onClick={() => setCreateOpen(true)}
            >
              Create
            </Button>
          </Box>
        }
      />

      <CreateStackDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          fetchStacks(activeProject!);
        }}
      />

      {error && (
        <Alert severity="error" onClose={clearError}>
          {error}
        </Alert>
      )}

      {loading && stacks.length === 0 ? (
        <Grid container spacing={2}>
          {[1, 2, 3].map((i) => (
            <Grid key={i} size={{ xs: 12, sm: 6, md: 4 }}>
              <Skeleton variant="rounded" height={200} />
            </Grid>
          ))}
        </Grid>
      ) : stacks.length === 0 ? (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <EmptyContent
            title="No stacks"
            description="Create your first stack to deploy applications."
          />
        </Box>
      ) : (
        <Grid container spacing={2}>
          {stacks.map((stack) => (
            <Grid key={stack.name} size={{ xs: 12, sm: 6, md: 4 }}>
              <StackCard
                stack={stack}
                pendingOp={activeProject ? (pendingOps[`${activeProject}/${stack.name}`] ?? null) : null}
                onStart={() => handleStart(stack.name)}
                onStop={() => handleStop(stack.name)}
                onDelete={() => setDeleteTarget(stack.name)}
                onDetail={() => navigate(`/stacks/${stack.name}`)}
              />
            </Grid>
          ))}
        </Grid>
      )}

      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete Stack</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete stack <strong>{deleteTarget}</strong>? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained">Delete</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

// =============================================================================
// StackCard
// =============================================================================

function StackCard({
  stack,
  pendingOp,
  onStart,
  onStop,
  onDelete,
  onDetail,
}: {
  stack: IStackInfo;
  pendingOp: 'starting' | 'stopping' | null;
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
  onDetail: () => void;
}) {
  const status = STATUS_CHIP[stack.status] ?? STATUS_CHIP.stopped!;
  const isRunning = stack.status === 'running';
  const isStopped = stack.status === 'stopped';
  const isTransitioning = stack.status === 'starting' || stack.status === 'stopping' || !!pendingOp;
  const busy = !!pendingOp;

  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        transition: 'border-color 0.2s',
        '&:hover': {
          borderColor: (t) => alpha(t.palette.primary.main, 0.3),
        },
      }}
      variant="outlined"
      onClick={onDetail}
    >
      <CardContent sx={{ flex: 1 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1.1rem' }}>
            {stack.name}
          </Typography>
          <Chip
            label={status.label}
            color={status.color}
            size="small"
            sx={{ height: 22, fontSize: '0.7rem' }}
          />
        </Box>

        {/* Type */}
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
          {TYPE_LABEL[stack.type] ?? stack.type}
        </Typography>

        {/* Stats grid */}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
          <StatItem label="Apps" value={`${stack.apps.filter((a) => a.status === 'online').length}/${stack.apps.length}`} />
          <StatItem label="Nodes" value={String(stack.nodes.length)} />
          {isRunning && stack.uptime > 0 && (
            <StatItem label="Uptime" value={formatUptime(stack.uptime)} />
          )}
          {stack.type !== 'local' && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <SyncIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {stack.nodes.filter((n) => n.connected).length}/{stack.nodes.length} synced
              </Typography>
            </Box>
          )}
        </Box>

        {/* Port range */}
        {stack.portRange && (
          <Typography
            variant="caption"
            sx={{ color: 'text.disabled', mt: 1, display: 'block', fontFamily: 'monospace' }}
          >
            Ports: {stack.portRange.start}–{stack.portRange.end}
          </Typography>
        )}
      </CardContent>

      <CardActions sx={{ px: 2, pb: 1.5, justifyContent: 'space-between' }} onClick={(e) => e.stopPropagation()}>
        <Box>
          {isStopped && !busy && (
            <IconButton size="small" color="error" onClick={onDelete} title="Delete stack">
              <DeleteIcon />
            </IconButton>
          )}
        </Box>
        <Box>
          {isTransitioning ? (
            <Button
              size="small"
              disabled
              startIcon={<CircularProgress size={14} />}
            >
              {pendingOp === 'starting' || stack.status === 'starting' ? 'Starting...' : 'Stopping...'}
            </Button>
          ) : isStopped ? (
            <Button
              size="small"
              startIcon={<PlayIcon />}
              color="success"
              onClick={onStart}
            >
              Start
            </Button>
          ) : isRunning ? (
            <Button
              size="small"
              startIcon={<StopIcon />}
              color="error"
              onClick={onStop}
            >
              Stop
            </Button>
          ) : (
            <Chip label={status.label} size="small" color={status.color} sx={{ height: 20, fontSize: '0.65rem' }} />
          )}
        </Box>
      </CardActions>
    </Card>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', textTransform: 'uppercase' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '0.85rem' }}>
        {value}
      </Typography>
    </Box>
  );
}
