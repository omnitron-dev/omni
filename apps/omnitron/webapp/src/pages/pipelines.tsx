import { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import LinearProgress from '@mui/material/LinearProgress';

import { PipelineIcon, PlayIcon, RefreshIcon, PlusIcon, CloseIcon } from 'src/assets/icons';
import { AdminDataTable, Alert, Breadcrumbs, ConfirmDialog, Skeleton, type ColumnDef } from '@omnitron-dev/prism';
import { pipelines } from 'src/netron/client';
import { formatDate, formatDuration } from 'src/utils/formatters';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { settledPair } from 'src/utils/settled-pair';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Pipeline {
  id: string;
  name: string;
  description: string | null;
  steps: Array<{ name: string; run: string; dependsOn?: string[] }>;
  triggers: Array<{ type: string; config: Record<string, unknown> }>;
  createdAt: string;
}

interface PipelineRun {
  id: string;
  pipelineId: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  steps: Array<{ name: string; status: string; duration: number; output?: string; error?: string }>;
  startedAt: string;
  completedAt: string | null;
  triggeredBy: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, 'success' | 'error' | 'info' | 'warning' | 'default'> = {
  success: 'success',
  failed: 'error',
  running: 'info',
  pending: 'warning',
  cancelled: 'default',
};



// ---------------------------------------------------------------------------
// Create Pipeline Dialog
// ---------------------------------------------------------------------------

interface CreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function CreatePipelineDialog({ open, onClose, onCreated }: CreateDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [stepsJson, setStepsJson] = useState('[\n  { "name": "build", "run": "echo building..." },\n  { "name": "test", "run": "echo testing...", "dependsOn": ["build"] }\n]');
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    try {
      const steps = JSON.parse(stepsJson);
      await pipelines.createPipeline({ name, description: description || undefined, steps });
      setName('');
      setDescription('');
      setError(null);
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create pipeline');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Create Pipeline</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {error && <Alert severity="error" variant="outlined">{error}</Alert>}
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            size="small"
            fullWidth
          />
          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            size="small"
            fullWidth
          />
          <TextField
            label="Steps (JSON)"
            value={stepsJson}
            onChange={(e) => setStepsJson(e.target.value)}
            size="small"
            fullWidth
            multiline
            rows={6}
            slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 12 } } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small">Cancel</Button>
        <Button variant="contained" onClick={handleCreate} size="small" disabled={!name}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Run Detail
// ---------------------------------------------------------------------------

function RunDetail({ run }: { run: PipelineRun }) {
  return (
    <Box sx={{ pl: 4, pr: 2, pb: 2 }}>
      {run.status === 'running' && <LinearProgress sx={{ mb: 1 }} />}
      <Typography
        variant="caption"
        sx={{
          color: "text.secondary",
          mb: 1,
          display: 'block'
        }}>
        Triggered by: {run.triggeredBy} | Started: {formatDate(run.startedAt)}
        {run.completedAt && ` | Completed: ${formatDate(run.completedAt)}`}
      </Typography>
      {run.steps.map((step, i) => (
        <Stack
          key={i}
          direction="row"
          spacing={1}
          sx={{
            alignItems: "center",
            py: 0.5
          }}>
          <Chip
            label={step.status}
            size="small"
            color={STATUS_COLORS[step.status] ?? 'default'}
            variant="filled"
            sx={{ minWidth: 70, fontWeight: 600, fontSize: 11 }}
          />
          <Typography variant="body2" sx={{
            fontWeight: 500
          }}>{step.name}</Typography>
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              fontFamily: 'monospace'
            }}>
            {formatDuration(step.duration)}
          </Typography>
          {step.error && (
            <Typography
              variant="caption"
              sx={{
                color: "error.main",
                fontFamily: 'monospace'
              }}>
              {step.error}
            </Typography>
          )}
        </Stack>
      ))}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Pipelines Page
// ---------------------------------------------------------------------------

export default function PipelinesPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  // Shared polling loop; `settledPair` keeps one RPC failing from blanking
  // the other AND says so, which the `allSettled` this replaces did not.
  const { data, loading, error, refresh: fetchData } = usePolledResource(
    async () => {
      const { first, second, partialFailure } = await settledPair<Pipeline[], PipelineRun[]>(
        [pipelines.listPipelines(), pipelines.listRuns({ limit: 50 })],
        [[], []]
      );
      return { pipelineList: first, runs: second, partialFailure };
    },
    { intervalMs: 10_000 }
  );

  // A failed button press is a different thing from a stale poll.
  const [actionError, setActionError] = useState<string | null>(null);
  // Deleting a pipeline used to happen on one click, next to the button that
  // runs it — and its run history goes with it.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [defPage, setDefPage] = useState(0);
  const [defPageSize, setDefPageSize] = useState(25);
  const [runPage, setRunPage] = useState(0);
  const [runPageSize, setRunPageSize] = useState(25);

  const pipelineList = data?.pipelineList ?? [];
  const runs = data?.runs ?? [];
  const partialFailure = data?.partialFailure ?? null;

  const handleRun = async (id: string) => {
    try {
      await pipelines.executePipeline({ id });
      fetchData();
    } catch (err: any) {
      setActionError(err?.message ?? 'Failed to execute pipeline');
    }
  };

  const handleDelete = async () => {
    const id = confirmDelete;
    if (!id) return;
    try {
      await pipelines.deletePipeline({ id });
      setConfirmDelete(null);
      await fetchData();
    } catch (err: any) {
      setActionError(err?.message ?? 'Failed to delete pipeline');
    }
  };

  const pendingDelete = pipelineList.find((p) => p.id === confirmDelete);

  const runRows = runs.slice(runPage * runPageSize, runPage * runPageSize + runPageSize);

  const runColumns: ColumnDef<PipelineRun>[] = [
    {
      key: 'pipeline',
      header: 'Pipeline',
      // The toggle lives in a cell, not on the row: `onRowClick` is reachable
      // by pointer only. This table used to be ONE `colSpan={5}` cell holding
      // a ButtonBase whose Stack imitated the five columns the header
      // declared — so the headers never lined up with anything. Real cells
      // now, and the control that opens the run keeps its focus, its role and
      // its Enter/Space.
      render: (run) => {
        const pipeline = pipelineList.find((p) => p.id === run.pipelineId);
        return (
          <ButtonBase
            aria-expanded={expandedRun === run.id}
            onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
            sx={{ fontWeight: 600, fontSize: '0.8125rem', textAlign: 'left' }}
          >
            {pipeline?.name ?? run.pipelineId.slice(0, 8)}
          </ButtonBase>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (run) => (
        <Chip
          label={run.status}
          size="small"
          color={STATUS_COLORS[run.status] ?? 'default'}
          variant="filled"
          sx={{ fontWeight: 600 }}
        />
      ),
    },
    {
      key: 'startedAt',
      header: 'Started',
      render: (run) => (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {formatDate(run.startedAt)}
        </Typography>
      ),
    },
    {
      key: 'completedAt',
      header: 'Completed',
      render: (run) => (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {run.completedAt ? formatDate(run.completedAt) : '--'}
        </Typography>
      ),
    },
    {
      key: 'triggeredBy',
      header: 'Triggered By',
      render: (run) => (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {run.triggeredBy}
        </Typography>
      ),
    },
  ];

  const definitionRows = pipelineList.slice(
    defPage * defPageSize,
    defPage * defPageSize + defPageSize,
  );

  const definitionColumns: ColumnDef<Pipeline>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (p) => (
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {p.name}
        </Typography>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      render: (p) => (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {p.description ?? '--'}
        </Typography>
      ),
    },
    { key: 'steps', header: 'Steps', render: (p) => p.steps.length },
    { key: 'triggers', header: 'Triggers', render: (p) => p.triggers.length },
    {
      key: 'createdAt',
      header: 'Created',
      render: (p) => (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {formatDate(p.createdAt)}
        </Typography>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (p) => (
        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
          <IconButton size="small" color="error" onClick={() => setConfirmDelete(p.id)} title="Delete">
            <CloseIcon />
          </IconButton>
          <IconButton size="small" onClick={() => handleRun(p.id)} title="Run">
            <PlayIcon />
          </IconButton>
        </Stack>
      ),
    },
  ];

  return (
    <Stack spacing={3}>
      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title="Delete pipeline?"
        content={
          <>
            <b>{pendingDelete?.name ?? confirmDelete}</b> and its run history will be removed.
          </>
        }
        confirmLabel="Delete"
        confirmColor="error"
      />
      {/* Header */}
      <Breadcrumbs
        links={[{ name: 'Pipelines' }]}
        action={
          <Stack direction="row" spacing={1}>
            <IconButton size="small" onClick={fetchData} title="Refresh">
              <RefreshIcon />
            </IconButton>
            <Button
              variant="contained"
              size="small"
              startIcon={<PlusIcon />}
              onClick={() => setDialogOpen(true)}
            >
              New Pipeline
            </Button>
          </Stack>
        }
      />
      {(error || actionError || partialFailure) && (
        <Alert closable severity="warning" variant="outlined" onClose={() => setActionError(null)}>
          {actionError ?? error ?? `Some data is unavailable: ${partialFailure}`}
        </Alert>
      )}
      {/* Pipeline Definitions */}
      <Card variant="outlined">
        <CardHeader slotProps={{ title: { variant: 'subtitle1', fontWeight: 600 } }}
          title="Pipeline Definitions"
          avatar={<PipelineIcon />}
        />
        {/*
          prism's AdminDataTable. The run-history table below still builds its
          own rows: it expands a row in place to show the steps, which this
          component has no shape for.
        */}
        <AdminDataTable<Pipeline>
          columns={definitionColumns}
          data={definitionRows}
          total={pipelineList.length}
          loading={loading}
          loadError={error ?? partialFailure ?? null}
          emptyMessage="No pipelines defined"
          rowKey={(p) => p.id}
          page={defPage}
          pageSize={defPageSize}
          onPageChange={setDefPage}
          onPageSizeChange={(size) => {
            setDefPageSize(size);
            setDefPage(0);
          }}
          dense
        />
      </Card>
      {/* Run History */}
      <Card variant="outlined">
        <CardHeader slotProps={{ title: { variant: 'subtitle1', fontWeight: 600 } }}
          title="Run History"
        />
        <AdminDataTable<PipelineRun>
          columns={runColumns}
          data={runRows}
          total={runs.length}
          loading={loading}
          loadError={error ?? partialFailure ?? null}
          emptyMessage="No pipeline runs yet"
          rowKey={(run) => run.id}
          renderExpanded={(run) =>
            expandedRun === run.id ? <RunDetail run={run} /> : null
          }
          page={runPage}
          pageSize={runPageSize}
          onPageChange={setRunPage}
          onPageSizeChange={(size) => {
            setRunPageSize(size);
            setRunPage(0);
          }}
          dense
        />
      </Card>
      {/* Create Pipeline Dialog */}
      <CreatePipelineDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={fetchData}
      />
    </Stack>
  );
}
