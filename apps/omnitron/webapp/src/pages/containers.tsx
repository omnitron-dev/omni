import { useState, useEffect, useCallback } from 'react';
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
import { Breadcrumbs } from '@omnitron-dev/prism';
import { infra } from 'src/netron/client';
import { useStackContext } from 'src/hooks/use-stack-context';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Container {
  id: string;
  name: string;
  image: string;
  status: 'running' | 'exited' | 'created' | 'restarting' | 'paused';
  health: 'healthy' | 'unhealthy' | 'none' | 'starting';
  ports: string[];
  createdAt: string;
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
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
          <Stack spacing={0.5}>
            <Typography variant="body2" color="text.secondary">
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
  const [allContainers, setAllContainers] = useState<Container[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter containers by stack context (container names: project-stack-service)
  const containers = allContainers.filter((c) => {
    if (!activeProject) return true;
    const prefix = activeStack ? `${activeProject}-${activeStack}-` : `${activeProject}-`;
    return c.name.startsWith(prefix) || c.name.startsWith('omnitron-');
  });

  // Log modal state
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logModalContainer, setLogModalContainer] = useState('');
  const [logModalLines, setLogModalLines] = useState<string[]>([]);

  const fetchContainers = useCallback(async () => {
    try {
      // Real data from infrastructure RPC service
      const result = await infra.listContainers();
      setAllContainers(Array.isArray(result) ? result : []);
      setError(null);
    } catch (err: any) {
      // Graceful fallback — infra service may not be available yet
      setAllContainers([]);
      setError(err?.message ?? 'Failed to fetch containers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContainers();
    const interval = setInterval(fetchContainers, 10000);
    return () => clearInterval(interval);
  }, [fetchContainers]);

  const totalCount = containers.length;
  const runningCount = containers.filter((c) => c.status === 'running').length;
  const stoppedCount = containers.filter((c) => c.status === 'exited').length;
  const unhealthyCount = containers.filter((c) => c.health === 'unhealthy').length;

  const handleStart = async (containerId: string) => {
    try {
      await infra.startContainer(containerId);
      fetchContainers();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to start container');
    }
  };

  const handleStop = async (containerId: string) => {
    try {
      await infra.stopContainer(containerId);
      fetchContainers();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to stop container');
    }
  };

  const handleRemove = async (containerId: string) => {
    try {
      await infra.removeContainer(containerId);
      fetchContainers();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to remove container');
    }
  };

  const handleViewLogs = async (container: Container) => {
    try {
      const lines = await infra.getContainerLogs(container.id, 100);
      setLogModalContainer(container.name);
      setLogModalLines(Array.isArray(lines) ? lines : []);
      setLogModalOpen(true);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to fetch container logs');
    }
  };

  return (
    <Stack spacing={3}>
      {/* Header */}
      <Breadcrumbs
        links={[{ name: 'Containers' }]}
        action={
          <IconButton size="small" onClick={fetchContainers} title="Refresh">
            <RefreshIcon />
          </IconButton>
        }
      />

      {error && (
        <Alert severity="warning" variant="outlined" onClose={() => setError(null)}>
          {error}
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
                <TableRow>
                  <TableCell colSpan={6} sx={{ textAlign: 'center', py: 6 }}>
                    <Typography variant="body2" color="text.secondary">
                      No containers found. Infrastructure containers will appear here when Docker is running.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                containers.map((container) => (
                  <TableRow
                    key={container.id}
                    hover
                    sx={{ '&:last-child td': { borderBottom: 0 } }}
                  >
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
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
                        label={container.health}
                        size="small"
                        color={HEALTH_COLORS[container.health] ?? 'default'}
                        variant="outlined"
                        sx={{ textTransform: 'capitalize' }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography
                        variant="caption"
                        sx={{ fontFamily: 'monospace', fontSize: 12 }}
                      >
                        {container.ports.length > 0 ? container.ports.join(', ') : '--'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title="Remove">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleRemove(container.id)}
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
                              onClick={() => handleStart(container.id)}
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
                              onClick={() => handleStop(container.id)}
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
