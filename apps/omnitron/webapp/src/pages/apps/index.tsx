import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import Card from '@mui/material/Card';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import { Breadcrumbs } from '@omnitron-dev/prism';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Skeleton from '@mui/material/Skeleton';
import Alert from '@mui/material/Alert';

import { RestartIcon, StopIcon, PlayIcon, RefreshIcon } from 'src/assets/icons';

import { daemon, project as projectRpc } from 'src/netron/client';
import { formatUptime, formatMemoryMb } from 'src/utils/formatters';
import { STATUS_COLORS } from 'src/utils/constants';
import { useStackContext } from 'src/hooks/use-stack-context';
import { useActiveProject } from 'src/stores/project.store';

import type { ProcessInfoDto } from '@omnitron-dev/omnitron/dto/services';

// ---------------------------------------------------------------------------
// Apps List Page
// ---------------------------------------------------------------------------

export default function AppsListPage() {
  const navigate = useNavigate();
  const [allApps, setAllApps] = useState<ProcessInfoDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const activeProject = useActiveProject();
  const { filterApps, displayName } = useStackContext();

  const fetchApps = useCallback(async () => {
    try {
      if (activeProject) {
        // In project workspace: get configured apps (includes stopped)
        const stackApps = await projectRpc.getProjectApps({ project: activeProject });
        // Map IStackAppStatus → ProcessInfoDto shape
        const mapped: ProcessInfoDto[] = stackApps.map((a: any) => ({
          name: a.name,
          pid: a.pid ?? null,
          status: a.status ?? 'stopped',
          cpu: 0,
          memory: 0,
          uptime: a.uptime ?? 0,
          restarts: 0,
          instances: a.instances ?? 0,
          port: null,
          mode: 'bootstrap' as const,
          critical: false,
        }));
        setAllApps(mapped);
      } else {
        // Omnitron workspace: show running daemon processes
        const list = await daemon.list();
        setAllApps(list);
      }
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to fetch applications');
    } finally {
      setLoading(false);
    }
  }, [activeProject]);

  // In project mode, no namespace filtering needed — getProjectApps returns clean names
  const apps = activeProject ? allApps : filterApps(allApps);

  useEffect(() => {
    fetchApps();
    const interval = setInterval(fetchApps, 5000);
    return () => clearInterval(interval);
  }, [fetchApps]);

  const handleRestart = async (name: string) => {
    setActionLoading(name);
    try {
      await daemon.restartApp({ name });
      await fetchApps();
    } catch (err: any) {
      setError(`Failed to restart ${name}: ${err?.message ?? 'Unknown error'}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStop = async (name: string) => {
    setActionLoading(name);
    try {
      await daemon.stopApp({ name });
      await fetchApps();
    } catch (err: any) {
      setError(`Failed to stop ${name}: ${err?.message ?? 'Unknown error'}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStart = async (name: string) => {
    setActionLoading(name);
    try {
      await daemon.startApp({ name });
      await fetchApps();
    } catch (err: any) {
      setError(`Failed to start ${name}: ${err?.message ?? 'Unknown error'}`);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <Stack spacing={3}>
      <Breadcrumbs
        linkComponent={RouterLink}
        links={[{ name: 'Applications' }]}
        action={
          <IconButton onClick={fetchApps} title="Refresh">
            <RefreshIcon />
          </IconButton>
        }
      />

      {error && (
        <Alert severity="error" variant="outlined" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card variant="outlined">
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Instances</TableCell>
                <TableCell align="right">PID</TableCell>
                <TableCell>Uptime</TableCell>
                <TableCell align="right">CPU %</TableCell>
                <TableCell align="right">Memory MB</TableCell>
                <TableCell align="center">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                [...Array(3)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(8)].map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton width={j === 0 ? 120 : 60} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : apps.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8}>
                    <Stack alignItems="center" spacing={1} sx={{ py: 4 }}>
                      <Typography variant="body2" color="text.secondary">
                        No applications deployed yet.
                      </Typography>
                      <Typography variant="caption" color="text.disabled">
                        Use <code>omnitron deploy</code> to get started.
                      </Typography>
                    </Stack>
                  </TableCell>
                </TableRow>
              ) : (
                apps.map((app) => (
                  <TableRow
                    key={app.name}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/apps/${app.name}`)}
                  >
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {app.name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={app.status}
                        size="small"
                        color={STATUS_COLORS[app.status] || 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell align="right">{app.instances}</TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {app.pid ?? '--'}
                      </Typography>
                    </TableCell>
                    <TableCell>{formatUptime(app.uptime)}</TableCell>
                    <TableCell align="right">
                      {app.cpu > 0 ? app.cpu.toFixed(1) : '--'}
                    </TableCell>
                    <TableCell align="right">{formatMemoryMb(app.memory)}</TableCell>
                    <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                      <Stack direction="row" spacing={0.5} justifyContent="center">
                        {app.status === 'stopped' || app.status === 'crashed' || app.status === 'errored' ? (
                          <Tooltip title="Start">
                            <IconButton
                              size="small"
                              color="success"
                              disabled={actionLoading === app.name}
                              onClick={() => handleStart(app.name)}
                            >
                              <PlayIcon sx={{ fontSize: 18 }} />
                            </IconButton>
                          </Tooltip>
                        ) : (
                          <>
                            <Tooltip title="Restart">
                              <IconButton
                                size="small"
                                color="warning"
                                disabled={actionLoading === app.name}
                                onClick={() => handleRestart(app.name)}
                              >
                                <RestartIcon sx={{ fontSize: 18 }} />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Stop">
                              <IconButton
                                size="small"
                                color="error"
                                disabled={actionLoading === app.name}
                                onClick={() => handleStop(app.name)}
                              >
                                <StopIcon sx={{ fontSize: 18 }} />
                              </IconButton>
                            </Tooltip>
                          </>
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

      <Typography variant="caption" color="text.disabled" sx={{ mt: 2, display: 'block' }}>
        <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
          <Chip label="online" size="small" color="success" variant="outlined" />
          <Chip label="stopped" size="small" color="default" variant="outlined" />
          <Chip label="errored" size="small" color="error" variant="outlined" />
          <Chip label="starting" size="small" color="warning" variant="outlined" />
        </Stack>
      </Typography>
    </Stack>
  );
}
