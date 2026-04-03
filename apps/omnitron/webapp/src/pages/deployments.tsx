import { useState, useEffect, useCallback } from 'react';
import Card from '@mui/material/Card';
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
import MenuItem from '@mui/material/MenuItem';

import { DeployIcon, PlusIcon, RefreshIcon } from 'src/assets/icons';
import { Breadcrumbs } from '@omnitron/prism';
import { deploy } from 'src/netron/client';
import { formatDate } from 'src/utils/formatters';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Deployment {
  id: string;
  app: string;
  version: string;
  previousVersion: string;
  strategy: 'all-at-once' | 'rolling' | 'blue-green' | 'canary';
  status: 'success' | 'failed' | 'deploying' | 'rolled_back';
  startedAt: string;
  duration: number; // ms
  deployedBy: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, 'success' | 'error' | 'info' | 'warning'> = {
  success: 'success',
  failed: 'error',
  deploying: 'info',
  rolled_back: 'warning',
};

const STATUS_LABELS: Record<string, string> = {
  success: 'Success',
  failed: 'Failed',
  deploying: 'Deploying',
  rolled_back: 'Rolled Back',
};

const STRATEGIES: { value: string; label: string }[] = [
  { value: 'all-at-once', label: 'All at Once' },
  { value: 'rolling', label: 'Rolling' },
  { value: 'blue-green', label: 'Blue/Green' },
  { value: 'canary', label: 'Canary' },
];

function formatDuration(ms: number): string {
  if (ms <= 0) return '--';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

// ---------------------------------------------------------------------------
// Deploy Dialog
// ---------------------------------------------------------------------------

interface DeployDialogProps {
  open: boolean;
  onClose: () => void;
  onDeploy: (app: string, version: string, strategy: string) => void;
  apps: string[];
}

function DeployDialog({ open, onClose, onDeploy, apps }: DeployDialogProps) {
  const [app, setApp] = useState('');
  const [version, setVersion] = useState('');
  const [strategy, setStrategy] = useState('all-at-once');

  const handleSubmit = () => {
    if (!app || !version) return;
    onDeploy(app, version, strategy);
    setApp('');
    setVersion('');
    setStrategy('all-at-once');
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>New Deployment</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          <TextField
            select
            label="Application"
            value={app}
            onChange={(e) => setApp(e.target.value)}
            size="small"
            fullWidth
          >
            {apps.length > 0
              ? apps.map((a) => (
                  <MenuItem key={a} value={a}>
                    {a}
                  </MenuItem>
                ))
              : (
                  <MenuItem disabled value="">
                    No applications available
                  </MenuItem>
                )}
          </TextField>
          <TextField
            label="Version"
            placeholder="e.g. 1.2.0"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            size="small"
            fullWidth
          />
          <TextField
            select
            label="Strategy"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            size="small"
            fullWidth
          >
            {STRATEGIES.map((s) => (
              <MenuItem key={s.value} value={s.value}>
                {s.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small">
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          size="small"
          disabled={!app || !version}
          startIcon={<DeployIcon />}
        >
          Deploy
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Deployments Page
// ---------------------------------------------------------------------------

export default function DeploymentsPage() {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [availableApps, setAvailableApps] = useState<string[]>([]);

  const fetchDeployments = useCallback(async () => {
    try {
      const [history, apps] = await Promise.allSettled([
        deploy.listDeployments(),
        deploy.listDeployableApps(),
      ]);

      if (history.status === 'fulfilled')
        setDeployments(Array.isArray(history.value) ? history.value : []);
      if (apps.status === 'fulfilled')
        setAvailableApps(Array.isArray(apps.value) ? apps.value : []);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to fetch deployments');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDeployments();
    const interval = setInterval(fetchDeployments, 15000);
    return () => clearInterval(interval);
  }, [fetchDeployments]);

  const handleDeploy = async (app: string, version: string, strategy: string) => {
    try {
      await deploy.deploy({ app, version, strategy });
      fetchDeployments();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to start deployment');
    }
  };

  return (
    <Stack spacing={3}>
      {/* Header */}
      <Breadcrumbs
        links={[{ name: 'Deployments' }]}
        action={
          <Stack direction="row" spacing={1}>
            <IconButton size="small" onClick={fetchDeployments} title="Refresh">
              <RefreshIcon />
            </IconButton>
            <Button
              variant="contained"
              size="small"
              startIcon={<PlusIcon />}
              onClick={() => setDialogOpen(true)}
            >
              Deploy
            </Button>
          </Stack>
        }
      />

      {error && (
        <Alert severity="warning" variant="outlined" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Deployments Table */}
      <Card variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>App</TableCell>
                <TableCell>Version</TableCell>
                <TableCell>Previous</TableCell>
                <TableCell>Strategy</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Started</TableCell>
                <TableCell>Duration</TableCell>
                <TableCell>Deployed By</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                [...Array(3)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(8)].map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton width={80} height={20} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : deployments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} sx={{ textAlign: 'center', py: 6 }}>
                    <Typography variant="body2" color="text.secondary">
                      No deployments yet
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                deployments.map((dep) => (
                  <TableRow
                    key={dep.id}
                    hover
                    sx={{ '&:last-child td': { borderBottom: 0 } }}
                  >
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {dep.app}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography
                        variant="body2"
                        sx={{ fontFamily: 'monospace', fontSize: 13 }}
                      >
                        {dep.version}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontFamily: 'monospace', fontSize: 12 }}
                      >
                        {dep.previousVersion || '--'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={dep.strategy}
                        size="small"
                        variant="outlined"
                        sx={{ textTransform: 'capitalize', fontSize: 11 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={STATUS_LABELS[dep.status] ?? dep.status}
                        size="small"
                        color={STATUS_COLORS[dep.status] ?? 'default'}
                        variant="filled"
                        sx={{ fontWeight: 600 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {formatDate(dep.startedAt)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                        {formatDuration(dep.duration)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {dep.deployedBy}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Deploy Dialog */}
      <DeployDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onDeploy={handleDeploy}
        apps={availableApps}
      />
    </Stack>
  );
}
