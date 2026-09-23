import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import { Alert, Breadcrumbs, Table, type TableColumn } from '@omnitron-dev/prism';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Link from '@mui/material/Link';

import { RestartIcon, StopIcon, PlayIcon, RefreshIcon } from 'src/assets/icons';

import { daemon, project as projectRpc } from 'src/netron/client';
import { formatUptime, formatMemoryMb } from 'src/utils/formatters';
import { STATUS_COLORS } from 'src/utils/constants';
import { useStackContext } from 'src/hooks/use-stack-context';
import { useRealtimeStore } from 'src/stores/realtime.store';
import { usePollingEffect } from 'src/hooks/use-polled-resource';
import { deploymentsIn, detailHref, isLocal } from 'src/utils/app-address';

import type { IProjectAppStatus } from '@omnitron-dev/omnitron/dto/services';

// ---------------------------------------------------------------------------
// Apps List Page
// ---------------------------------------------------------------------------

export default function AppsListPage() {
  const navigate = useNavigate();
  const [allApps, setAllApps] = useState<IProjectAppStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // The route is behind ProjectRoute: there is always a project here.
  const { activeProject, activeStack } = useStackContext();

  const fetchApps = useCallback(async () => {
    if (!activeProject) return;
    try {
      // Every deployment, stopped ones included, each with its stack.
      setAllApps(await projectRpc.getProjectApps({ project: activeProject }));
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to fetch applications');
    } finally {
      setLoading(false);
    }
  }, [activeProject]);

  // One row per deployment. With a stack selected, that stack's; with all of
  // them, the same app appears once per stack and the Stack column tells the
  // rows apart.
  const apps = deploymentsIn(allApps, activeStack);

  // Subscribe to the realtime WS — same pattern as Dashboard. The
  // store's refcount keeps the shared socket alive across page
  // changes; the Apps page no longer has to wait up to 5s for the
  // next poll to surface a crashed/restarted app.
  const wsConnected = useRealtimeStore((s) => s.connected);
  const lastEvent = useRealtimeStore((s) => s.lastEvent);
  const initializeRealtime = useRealtimeStore((s) => s.initialize);

  useEffect(() => {
    const cleanup = initializeRealtime();
    return cleanup;
  }, [initializeRealtime]);

  // When WS is up, push events trigger refreshes — slow the poll down to 15s
  // as a safety net. When WS is down, fall back to the 5s cadence.
  usePollingEffect(() => void fetchApps(), {
    intervalMs: wsConnected ? 15_000 : 5_000,
  });

  // Any app-lifecycle event → refetch immediately so the table
  // reflects the new state without waiting for the next interval.
  useEffect(() => {
    if (lastEvent) fetchApps();
  }, [lastEvent, fetchApps]);

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
      // `stopApp` does NOT throw on failure — it answers
      // `{ success: false, error }` on purpose, so a Netron client can render
      // the reason. The `catch` below is therefore on the wrong path: it
      // exists, reads as error handling, and never runs, so a stop that
      // failed looked exactly like one that worked.
      const result = await daemon.stopApp({ name });
      if (!result.success) {
        setError(`Failed to stop ${name}: ${result.error ?? 'the daemon reported failure'}`);
        return;
      }
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

  // Columns are data, so they live outside the JSX. `render` gets the whole
  // row, which is what every cell here needs.
  const columns: TableColumn<IProjectAppStatus>[] = [
    {
      id: 'name',
      label: 'Name',
      render: (app) =>
        isLocal(app) ? (
          // A real link, not just a clickable row. The row's onClick is a
          // convenience for a pointer; it is not reachable by keyboard and
          // announces nothing, so it was the only way into an app's detail
          // page and a keyboard user had none.
          <Link
            component={RouterLink}
            to={detailHref(app)}
            variant="body2"
            underline="hover"
            sx={{ fontWeight: 600, color: 'text.primary' }}
            onClick={(e) => e.stopPropagation()}
          >
            {app.name}
          </Link>
        ) : (
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {app.name}
          </Typography>
        ),
    },
    ...(activeStack
      ? []
      : [
          {
            id: 'stack',
            label: 'Stack',
            render: (app: IProjectAppStatus) => (
              <Link
                component={RouterLink}
                to={`/stacks/${encodeURIComponent(app.stack)}`}
                variant="body2"
                underline="hover"
                onClick={(e) => e.stopPropagation()}
              >
                {isLocal(app) ? app.stack : `${app.stack} · ${app.stackType}`}
              </Link>
            ),
          },
        ]),
    {
      id: 'status',
      label: 'Status',
      render: (app) => (
        <Chip
          label={app.status}
          size="small"
          color={STATUS_COLORS[app.status] || 'default'}
          variant="outlined"
        />
      ),
    },
    { id: 'instances', label: 'Instances', align: 'right' },
    {
      id: 'pid',
      label: 'PID',
      align: 'right',
      render: (app) => (
        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
          {app.pid ?? '--'}
        </Typography>
      ),
    },
    { id: 'uptime', label: 'Uptime', render: (app) => formatUptime(app.uptime) },
    {
      id: 'cpu',
      label: 'CPU %',
      align: 'right',
      render: (app) => (app.cpu > 0 ? app.cpu.toFixed(1) : '--'),
    },
    {
      id: 'memory',
      label: 'Memory MB',
      align: 'right',
      render: (app) => formatMemoryMb(app.memory),
    },
    {
      id: 'actions',
      label: 'Actions',
      align: 'center',
      render: (app) =>
        !isLocal(app) ? (
          <Tooltip title="Runs on a node — started and stopped with its stack">
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>
              on node
            </Typography>
          </Tooltip>
        ) : (
          // The handle, not the bare name: two local stacks running `main`
          // make `main` ambiguous, and the daemon refuses it.
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ justifyContent: 'center' }}
            onClick={(e) => e.stopPropagation()}
          >
            {app.status === 'stopped' || app.status === 'crashed' || app.status === 'errored' ? (
              <Tooltip title="Start">
                <IconButton
                  size="small"
                  color="success"
                  disabled={actionLoading === app.handleKey}
                  onClick={() => handleStart(app.handleKey)}
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
                    disabled={actionLoading === app.handleKey}
                    onClick={() => handleRestart(app.handleKey)}
                  >
                    <RestartIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Stop">
                  <IconButton
                    size="small"
                    color="error"
                    disabled={actionLoading === app.handleKey}
                    onClick={() => handleStop(app.handleKey)}
                  >
                    <StopIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
              </>
            )}
          </Stack>
        ),
    },
  ];

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
        <Alert closable severity="error" variant="outlined" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {/*
        prism's Table, not a hand-built one: the header, the hover/selected
        row styling, the empty state and the loading placeholders are the
        design system's, so this page describes its COLUMNS and nothing else.
      */}
      <Table<IProjectAppStatus>
        columns={columns}
        data={apps}
        rowKey={(app) => `${app.stack}/${app.name}`}
        loading={loading}
        loadingRows={3}
        onRowClick={(app) => navigate(isLocal(app) ? detailHref(app) : `/stacks/${encodeURIComponent(app.stack)}`)}
        emptyContent={
          <Stack spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              No applications deployed yet.
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>
              Use <code>omnitron deploy</code> to get started.
            </Typography>
          </Stack>
        }
      />
      <Typography
        variant="caption"
        sx={{
          color: "text.disabled",
          mt: 1,
          display: 'block'
        }}>
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
