import { useState } from 'react';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
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
import Tooltip from '@mui/material/Tooltip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import { alpha } from '@mui/material/styles';

import {
  ContainersIcon,
  RefreshIcon,
  PlayIcon,
  StopIcon,
  CloseIcon,
  LogsIcon,
} from 'src/assets/icons';
import { Breadcrumbs, ConfirmDialog } from '@omnitron-dev/prism';
import { infra } from 'src/netron/client';
import { useStackContext } from 'src/hooks/use-stack-context';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { TableEmptyRow } from 'src/components/table-empty-row';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// The daemon's own shape. The page used to declare a lookalike with `id`,
// `createdAt` and `ports: string[]`; the service actually returns
// `containerId`, `startedAt` and `ports` as a name→port map, so half these
// fields were always undefined at runtime.
type Container = import('@omnitron-dev/omnitron/dto/services').ContainerState;

/** "5432→5432, 6379→6379" — or '--' when the container publishes nothing. */
function formatPorts(ports: Container['ports']): string {
  const entries = Object.entries(ports ?? {});
  if (entries.length === 0) return '--';
  return entries.map(([name, port]) => `${name}:${port}`).join(', ');
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, 'success' | 'error' | 'default' | 'warning' | 'info'> = {
  running: 'success',
  exited: 'error',
  created: 'default',
  restarting: 'warning',
  paused: 'info',
};

const HEALTH_COLORS: Record<string, 'success' | 'error' | 'default' | 'warning'> = {
  healthy: 'success',
  unhealthy: 'error',
  none: 'default',
  starting: 'warning',
};

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: 'success' | 'warning' | 'error' | 'info' | 'primary';
  loading?: boolean;
}

function StatCard({ title, value, icon, color, loading }: StatCardProps) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack
          direction="row"
          spacing={2}
          sx={{
            alignItems: "center",
            justifyContent: "space-between"
          }}>
          <Stack spacing={0.5}>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              {title}
            </Typography>
            {loading ? (
              <Skeleton width={60} height={40} />
            ) : (
              <Typography variant="h4">{value}</Typography>
            )}
          </Stack>
          <Box
            sx={{
              p: 1.5,
              borderRadius: 2,
              bgcolor: (t) => alpha(t.palette[color].main, 0.12),
              color: `${color}.main`,
              display: 'flex',
            }}
          >
            {icon}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Log Modal
// ---------------------------------------------------------------------------

interface LogModalProps {
  open: boolean;
  containerName: string;
  logs: string[];
  onClose: () => void;
}

function LogModal({ open, containerName, logs, onClose }: LogModalProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontFamily: 'monospace' }}>
        Logs: {containerName}
      </DialogTitle>
      <DialogContent dividers>
        <Box
          sx={{
            bgcolor: '#0d1117',
            color: '#c9d1d9',
            fontFamily: 'monospace',
            fontSize: 12,
            lineHeight: 1.6,
            p: 2,
            borderRadius: 1,
            maxHeight: 400,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {logs.length === 0
            ? 'No logs available.'
            : logs.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Containers Page
// ---------------------------------------------------------------------------

export default function ContainersPage() {
  const { activeProject, activeStack } = useStackContext();
  // One shared polling loop (see `use-polled-resource`): no overlapping
  // requests when the daemon is slow, no polling from a hidden tab, and a
  // failed poll no longer blanks the table — it used to set `[]`, so the view
  // an operator was reading disappeared exactly when something went wrong.
  const {
    data: allContainers,
    loading,
    error,
    refresh: fetchContainers,
  } = usePolledResource<Container[]>(
    async () => {
      const result = await infra.listContainers();
      return Array.isArray(result) ? result : [];
    },
    { intervalMs: 10_000 }
  );

  // Filter containers by stack context (container names: project-stack-service)
  const [actionError, setActionError] = useState<string | null>(null);
  // Removing a container used to happen on one click. These are the project's
  // Postgres, Redis and MinIO: the container goes, and with it anything not on
  // a named volume.
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const containers = (allContainers ?? []).filter((c: Container) => {
    if (!activeProject) return true;
    const prefix = activeStack ? `${activeProject}-${activeStack}-` : `${activeProject}-`;
    return c.name.startsWith(prefix) || c.name.startsWith('omnitron-');
  });

  // Log modal state
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logModalContainer, setLogModalContainer] = useState('');
  const [logModalLines, setLogModalLines] = useState<string[]>([]);

  const totalCount = containers.length;
  const runningCount = containers.filter((c) => c.status === 'running').length;
  const stoppedCount = containers.filter((c) => c.status === 'exited').length;
  const unhealthyCount = containers.filter((c) => c.health === 'unhealthy').length;

  const handleStart = async (containerName: string) => {
    try {
      await infra.startContainer({ name: containerName });
      fetchContainers();
    } catch (err: any) {
      setActionError(err?.message ?? 'Failed to start container');
    }
  };

  const handleStop = async (containerName: string) => {
    try {
      await infra.stopContainer({ name: containerName });
      fetchContainers();
    } catch (err: any) {
      setActionError(err?.message ?? 'Failed to stop container');
    }
  };

  const handleRemove = async () => {
    const containerName = confirmRemove;
    if (!containerName) return;
    try {
      await infra.removeContainer({ name: containerName });
      setConfirmRemove(null);
      await fetchContainers();
    } catch (err: any) {
      setActionError(err?.message ?? 'Failed to remove container');
    }
  };

  const handleViewLogs = async (container: Container) => {
    try {
      const { logs } = await infra.getContainerLogs({ name: container.name, tail: 200 });
      setLogModalContainer(container.name);
      setLogModalLines(logs ? logs.split('\n') : []);
      setLogModalOpen(true);
    } catch (err: any) {
      setActionError(err?.message ?? 'Failed to fetch container logs');
    }
  };

  return (
    <Stack spacing={3}>
      <ConfirmDialog
        open={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        onConfirm={handleRemove}
        title="Remove container?"
        content={
          <>
            <b>{confirmRemove}</b> will be removed. Data outside a named volume is lost, and the
            daemon recreates the container on the next <code>omnitron up</code>.
          </>
        }
        confirmLabel="Remove"
        confirmColor="error"
      />
      {/* Header */}
      <Breadcrumbs
        links={[{ name: 'Containers' }]}
        action={
          <IconButton size="small" onClick={fetchContainers} title="Refresh">
            <RefreshIcon />
          </IconButton>
        }
      />
      {(error || actionError) && (
        <Alert severity="warning" variant="outlined" onClose={() => setActionError(null)}>
          {actionError ?? error}
        </Alert>
      )}
      {/* Summary Cards */}
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Total"
            value={totalCount}
            icon={<ContainersIcon />}
            color="primary"
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Running"
            value={runningCount}
            icon={<ContainersIcon />}
            color="success"
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Stopped"
            value={stoppedCount}
            icon={<ContainersIcon />}
            color={stoppedCount > 0 ? 'error' : 'info'}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Unhealthy"
            value={unhealthyCount}
            icon={<ContainersIcon />}
            color={unhealthyCount > 0 ? 'error' : 'success'}
            loading={loading}
          />
        </Grid>
      </Grid>
      {/* Containers Table */}
      <Card variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Image</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Health</TableCell>
                <TableCell>Ports</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                [...Array(3)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(6)].map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton width={80} height={20} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : containers.length === 0 ? (
                <TableEmptyRow
                      colSpan={6}
                      message="No containers found. Infrastructure containers will appear here when Docker is running."
                      error={error}
                    />
              ) : (
                containers.map((container) => (
                  <TableRow
                    key={container.name}
                    hover
                    sx={{ '&:last-child td': { borderBottom: 0 } }}
                  >
                    <TableCell>
                      <Typography variant="body2" sx={{
                        fontWeight: 600
                      }}>
                        {container.name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography
                        variant="body2"
                        sx={{ fontFamily: 'monospace', fontSize: 13 }}
                      >
                        {container.image}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={container.status}
                        size="small"
                        color={STATUS_COLORS[container.status] ?? 'default'}
                        variant="filled"
                        sx={{ textTransform: 'capitalize', fontWeight: 600 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={container.health ?? 'none'}
                        size="small"
                        color={HEALTH_COLORS[container.health ?? 'none'] ?? 'default'}
                        variant="outlined"
                        sx={{ textTransform: 'capitalize' }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography
                        variant="caption"
                        sx={{ fontFamily: 'monospace', fontSize: 12 }}
                      >
                        {formatPorts(container.ports)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} sx={{
                        justifyContent: "flex-end"
                      }}>
                        <Tooltip title="Remove">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => setConfirmRemove(container.name)}
                          >
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Logs">
                          <IconButton
                            size="small"
                            onClick={() => handleViewLogs(container)}
                          >
                            <LogsIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {container.status !== 'running' && (
                          <Tooltip title="Start">
                            <IconButton
                              size="small"
                              color="success"
                              onClick={() => handleStart(container.name)}
                            >
                              <PlayIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        {container.status === 'running' && (
                          <Tooltip title="Stop">
                            <IconButton
                              size="small"
                              color="warning"
                              onClick={() => handleStop(container.name)}
                            >
                              <StopIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
      {/* Log Modal */}
      <LogModal
        open={logModalOpen}
        containerName={logModalContainer}
        logs={logModalLines}
        onClose={() => setLogModalOpen(false)}
      />
    </Stack>
  );
}
