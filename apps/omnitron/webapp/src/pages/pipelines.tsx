import { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Alert from '@mui/material/Alert';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Collapse from '@mui/material/Collapse';
import LinearProgress from '@mui/material/LinearProgress';

import { PipelineIcon, PlayIcon, RefreshIcon, PlusIcon, CloseIcon } from 'src/assets/icons';
import { Breadcrumbs } from '@omnitron/prism';
import { pipelines } from 'src/netron/client';
import { formatDate } from 'src/utils/formatters';

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

function formatDuration(ms: number): string {
  if (ms <= 0) return '--';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

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
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
        Triggered by: {run.triggeredBy} | Started: {formatDate(run.startedAt)}
        {run.completedAt && ` | Completed: ${formatDate(run.completedAt)}`}
      </Typography>
      {run.steps.map((step, i) => (
        <Stack key={i} direction="row" alignItems="center" spacing={1} sx={{ py: 0.5 }}>
          <Chip
            label={step.status}
            size="small"
            color={STATUS_COLORS[step.status] ?? 'default'}
            variant="filled"
            sx={{ minWidth: 70, fontWeight: 600, fontSize: 11 }}
          />
          <Typography variant="body2" fontWeight={500}>{step.name}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
            {formatDuration(step.duration)}
          </Typography>
          {step.error && (
            <Typography variant="caption" color="error.main" sx={{ fontFamily: 'monospace' }}>
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
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [pipelineResult, runsResult] = await Promise.allSettled([
        pipelines.listPipelines(),
        pipelines.listRuns({ limit: 50 }),
      ]);

      if (pipelineResult.status === 'fulfilled')
        setPipelines(Array.isArray(pipelineResult.value) ? pipelineResult.value : []);
      if (runsResult.status === 'fulfilled')
        setRuns(Array.isArray(runsResult.value) ? runsResult.value : []);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to fetch pipelines');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleRun = async (id: string) => {
    try {
      await pipelines.executePipeline({ id });
      fetchData();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to execute pipeline');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await pipelines.deletePipeline({ id });
      fetchData();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to delete pipeline');
    }
  };

  return (
    <Stack spacing={3}>
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

      {error && (
        <Alert severity="warning" variant="outlined" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Pipeline Definitions */}
      <Card variant="outlined">
        <CardHeader
          title="Pipeline Definitions"
          titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
          avatar={<PipelineIcon />}
        />
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Steps</TableCell>
                <TableCell>Triggers</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                [...Array(2)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(6)].map((__, j) => (
                      <TableCell key={j}><Skeleton width={80} height={20} /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : pipelines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} sx={{ textAlign: 'center', py: 6 }}>
                    <Typography variant="body2" color="text.secondary">
                      No pipelines defined
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                pipelines.map((p) => (
                  <TableRow key={p.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{p.name}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {p.description ?? '--'}
                      </Typography>
                    </TableCell>
                    <TableCell>{p.steps.length}</TableCell>
                    <TableCell>{p.triggers.length}</TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {formatDate(p.createdAt)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <IconButton size="small" color="error" onClick={() => handleDelete(p.id)} title="Delete">
                          <CloseIcon />
                        </IconButton>
                        <IconButton size="small" onClick={() => handleRun(p.id)} title="Run">
                          <PlayIcon />
                        </IconButton>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Run History */}
      <Card variant="outlined">
        <CardHeader
          title="Run History"
          titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
        />
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Pipeline</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Started</TableCell>
                <TableCell>Completed</TableCell>
                <TableCell>Triggered By</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                [...Array(3)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(5)].map((__, j) => (
                      <TableCell key={j}><Skeleton width={80} height={20} /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : runs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} sx={{ textAlign: 'center', py: 6 }}>
                    <Typography variant="body2" color="text.secondary">
                      No pipeline runs yet
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                runs.map((run) => {
                  const pipeline = pipelines.find((p) => p.id === run.pipelineId);
                  return (
                    <TableRow key={run.id}>
                      <TableCell colSpan={5} sx={{ p: 0 }}>
                        <Box
                          sx={{ cursor: 'pointer', px: 2, py: 1 }}
                          onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                        >
                          <Stack direction="row" spacing={2} alignItems="center">
                            <Typography variant="body2" fontWeight={600} sx={{ minWidth: 120 }}>
                              {pipeline?.name ?? run.pipelineId.slice(0, 8)}
                            </Typography>
                            <Chip
                              label={run.status}
                              size="small"
                              color={STATUS_COLORS[run.status] ?? 'default'}
                              variant="filled"
                              sx={{ fontWeight: 600 }}
                            />
                            <Typography variant="caption" color="text.secondary">
                              {formatDate(run.startedAt)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {run.completedAt ? formatDate(run.completedAt) : '--'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {run.triggeredBy}
                            </Typography>
                          </Stack>
                        </Box>
                        <Collapse in={expandedRun === run.id}>
                          <RunDetail run={run} />
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
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
