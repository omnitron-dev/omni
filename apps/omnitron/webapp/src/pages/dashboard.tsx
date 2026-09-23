/**
 * Omnitron Console Dashboard
 *
 * Production-grade overview following portal admin dashboard patterns:
 * - 4 primary KPI stat cards (Prism StatCard)
 * - Application status grid with equal-height cards
 * - Daemon info card
 * - Recent activity log card
 *
 * All data loaded in parallel via Promise.allSettled with graceful fallbacks.
 * Auto-refresh every 5 seconds (silent — no skeleton flash after first load).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import { alpha, useTheme } from '@mui/material/styles';

import { AppsIcon, StacksIcon, MetricsIcon, ContainersIcon } from 'src/assets/icons';

import { Alert, StatCard } from '@omnitron-dev/prism';
import { daemon, metrics, project as projectRpc } from 'src/netron/client';
import { formatMemory, formatUptime } from 'src/utils/formatters';
import { useRealtimeStore } from 'src/stores/realtime.store';
import { usePollingEffect } from 'src/hooks/use-polled-resource';
import { useActiveProjectStacks } from 'src/stores/project.store';
import { useStackContext } from 'src/hooks/use-stack-context';
import { shownApps, type ShownApp } from 'src/utils/app-address';

import type { IProjectAppStatus, ProcessInfoDto } from '@omnitron-dev/omnitron/dto/services';

// ---------------------------------------------------------------------------
// App Status Card
// ---------------------------------------------------------------------------

function AppStatusCard({ app }: { app: ShownApp }) {
  const theme = useTheme();

  const statusColor =
    app.status === 'online'
      ? theme.palette.success.main
      : app.status === 'errored' || app.status === 'crashed'
        ? theme.palette.error.main
        : app.status === 'starting'
          ? theme.palette.warning.main
          : theme.palette.text.disabled;

  const rows = [
    { label: 'PID', value: app.pid ?? '--' },
    { label: 'Uptime', value: formatUptime(app.uptime) },
    { label: 'CPU', value: app.cpu > 0 ? `${app.cpu.toFixed(1)}%` : '--' },
    { label: 'Memory', value: formatMemory(app.memory) },
    { label: 'Restarts', value: app.restarts },
  ];

  return (
    <Card variant="outlined" sx={{ height: '100%', borderRadius: 2 }}>
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Stack
          direction="row"
          sx={{
            alignItems: "center",
            justifyContent: "space-between",
            mb: 1.5
          }}>
          <Typography variant="subtitle2" sx={{
            fontWeight: 700
          }}>
            {app.name}
          </Typography>
          <Chip
            label={app.status}
            size="small"
            sx={{
              height: 22,
              fontSize: '0.7rem',
              fontWeight: 600,
              bgcolor: alpha(statusColor, 0.12),
              color: statusColor,
              border: `1px solid ${alpha(statusColor, 0.3)}`,
            }}
          />
        </Stack>

        <Divider sx={{ mb: 1 }} />

        <Stack spacing={0.5}>
          {rows.map((row) => (
            <Stack
              key={row.label}
              direction="row"
              sx={{
                justifyContent: "space-between",
                alignItems: "center",
                py: 0.25
              }}>
              <Typography variant="caption" sx={{
                color: "text.secondary"
              }}>
                {row.label}
              </Typography>
              <Typography variant="caption" sx={{
                fontWeight: 600
              }}>
                {row.value}
              </Typography>
            </Stack>
          ))}
        </Stack>

        {app.processes && app.processes.length > 0 && (
          <>
            <Divider sx={{ my: 1 }} />
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                fontWeight: 600,
                mb: 0.5,
                display: 'block'
              }}>
              Processes
            </Typography>
            <Stack spacing={0.25}>
              {app.processes.map((p) => (
                <Stack
                  key={p.name}
                  direction="row"
                  sx={{
                    justifyContent: "space-between",
                    alignItems: "center"
                  }}>
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                      fontSize: '0.68rem'
                    }}>
                    {p.name}
                  </Typography>
                  <Chip
                    label={p.status}
                    size="small"
                    sx={{
                      height: 16,
                      fontSize: '0.6rem',
                      fontWeight: 600,
                      bgcolor: alpha(
                        p.status === 'online' ? '#22c55e' : p.status === 'stopped' ? '#6b7280' : '#ef4444',
                        0.1,
                      ),
                      color: p.status === 'online' ? '#22c55e' : p.status === 'stopped' ? '#6b7280' : '#ef4444',
                    }}
                  />
                </Stack>
              ))}
            </Stack>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// App Status Grid — groups by stack when showing all stacks
// ---------------------------------------------------------------------------

function AppStatusGrid({ apps, activeStack }: { apps: ShownApp[]; activeStack: string | null }) {
  // If a specific stack is selected, or no app belongs to one, show flat grid
  if (activeStack || apps.every((a) => a.stack === null)) {
    return (
      <Grid container spacing={2.5}>
        {apps.map((app) => (
          <Grid key={app.key} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
            <AppStatusCard app={app} />
          </Grid>
        ))}
      </Grid>
    );
  }

  // Group apps by the stack they belong to. Not by parsing the handle: a
  // remote stack's apps carry the node's naming, `daos/deployed/main`.
  const groups = new Map<string, ShownApp[]>();
  for (const app of apps) {
    const stackLabel = app.stack ?? 'default';
    if (!groups.has(stackLabel)) groups.set(stackLabel, []);
    groups.get(stackLabel)!.push(app);
  }

  return (
    <Stack spacing={3}>
      {Array.from(groups.entries()).map(([stackName, stackApps]) => (
        <Box key={stackName}>
          <Stack
            direction="row"
            sx={{
              alignItems: "center",
              gap: 1,
              mb: 1.5
            }}>
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: stackApps.every((a) => a.status === 'online') ? '#22c55e' : '#eab308',
              }}
            />
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 0.5
              }}>
              {stackName}
              {stackApps.some((a) => a.remote) ? ' · remote' : ''}
            </Typography>
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>
              {stackApps.filter((a) => a.status === 'online').length}/{stackApps.length} online
            </Typography>
          </Stack>
          <Grid container spacing={2.5}>
            {stackApps.map((app) => (
              <Grid key={app.key} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <AppStatusCard app={app} />
              </Grid>
            ))}
          </Grid>
        </Box>
      ))}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// KPI Skeleton
// ---------------------------------------------------------------------------

function KpiSkeleton() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <Grid key={i} size={{ xs: 6, sm: 3 }}>
          <StatCard label="" value="" loading sx={{ height: '100%' }} />
        </Grid>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Dashboard Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const theme = useTheme();

  const [processes, setProcesses] = useState<ProcessInfoDto[]>([]);
  /** The selected project's deployments, with the project they answer for. */
  const [deployments, setDeployments] = useState<{ project: string; apps: IProjectAppStatus[] } | null>(null);
  const [metricsSnapshot, setMetricsSnapshot] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isFirstLoad = useRef(true);

  const { activeProject, activeStack } = useStackContext();
  const stacks = useActiveProjectStacks();

  const fetchData = useCallback(async () => {
    try {
      const [projectApps, appList, snapshot] = await Promise.allSettled([
        activeProject ? projectRpc.getProjectApps({ project: activeProject }) : Promise.resolve(null),
        daemon.list(),
        metrics.getSnapshot(),
      ]);

      if (activeProject && projectApps.status === 'fulfilled' && projectApps.value) {
        setDeployments({ project: activeProject, apps: projectApps.value });
      }
      if (appList.status === 'fulfilled') setProcesses(appList.value);
      if (snapshot.status === 'fulfilled') setMetricsSnapshot(snapshot.value);

      // `allSettled` never rejects, so the `catch` below cannot see a failed
      // half — and clearing the error unconditionally turned a partial
      // failure into a positive claim of health: the dashboard kept showing
      // the last apps it had, with nothing to say they were stale. This
      // panel is where an operator looks first, so "the numbers are old" has
      // to be visible on it rather than inferred from them not moving.
      const failed = [
        projectApps.status === 'rejected' ? `${activeProject}'s apps` : null,
        appList.status === 'rejected' ? 'the app list' : null,
        snapshot.status === 'rejected' ? 'metrics' : null,
      ].filter(Boolean);

      if (failed.length > 0) {
        const reason =
          (projectApps.status === 'rejected' ? (projectApps.reason as Error)?.message : null) ??
          (appList.status === 'rejected' ? (appList.reason as Error)?.message : null) ??
          (snapshot.status === 'rejected' ? (snapshot.reason as Error)?.message : null) ??
          'the daemon did not answer';
        setError(`Could not refresh ${failed.join(' and ')} — ${reason}. Figures below are the last received.`);
        return;
      }

      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to connect to daemon');
    } finally {
      if (isFirstLoad.current) {
        setLoading(false);
        isFirstLoad.current = false;
      }
    }
  }, [activeProject]);

  // Another project is another question: ask it now rather than on the next
  // tick. The poll's own first tick covers the mount.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    void fetchData();
  }, [fetchData]);

  // Initialize WebSocket realtime connection
  const wsConnected = useRealtimeStore((s) => s.connected);
  const lastEvent = useRealtimeStore((s) => s.lastEvent);
  const initializeRealtime = useRealtimeStore((s) => s.initialize);

  useEffect(() => {
    const cleanup = initializeRealtime();
    return cleanup;
  }, [initializeRealtime]);

  // When WS is connected, increase poll interval to 15s (WS pushes trigger refresh).
  // When WS is not connected, poll every 5s as before.
  // Any WS event triggers an immediate data refresh.
  usePollingEffect(() => void fetchData(), {
    intervalMs: wsConnected ? 15_000 : 5_000,
  });

  // Re-fetch on any WS event (app started/crashed/restarted)
  useEffect(() => {
    if (lastEvent) fetchData();
  }, [lastEvent, fetchData]);

  const shown = shownApps(
    activeProject,
    activeStack,
    deployments?.project === activeProject ? deployments.apps : null,
    processes,
  );
  const apps = shown ?? [];

  // KPI source-of-truth rule: the daemon's `apps` list defines the SET we
  // count. The metrics snapshot is used only to enrich per-app cpu/memory
  // (titan-metrics samples those every 5s, often fresher than the daemon's
  // own bookkeeping). We never trust `snap.totals.*` directly because it
  // sums across the entire ring buffer — pre-staleness filter that meant
  // ghosts (stack-switched / renamed / dev-reloaded apps that no longer
  // report) would inflate the count; even with the filter it bypasses the
  // active stack filter the user has selected.
  // The snapshot is this daemon's: it enriches local apps only, by handle.
  const snapApps = metricsSnapshot?.apps ?? {};
  const sampled = (a: ShownApp) => (a.remote ? undefined : snapApps[a.key]);
  const totalApps = apps.length;
  const onlineCount = apps.filter((a) => a.status === 'online').length;
  const offlineCount = totalApps - onlineCount;
  const totalCpu = apps.reduce((sum, a) => sum + (sampled(a)?.cpu ?? a.cpu), 0);
  const totalMemory = apps.reduce((sum, a) => sum + (sampled(a)?.memory ?? a.memory), 0);
  const runningStacks = stacks.filter((s) => s.status === 'running').length;
  const cpuColor: 'success' | 'warning' | 'error' = totalCpu > 80 ? 'error' : totalCpu > 60 ? 'warning' : 'success';
  const memMb = totalMemory / (1024 * 1024);
  const memColor: 'info' | 'warning' | 'error' = memMb > 2048 ? 'error' : memMb > 1024 ? 'warning' : 'info';

  return (
    <Stack spacing={3}>
      {error && (
        <Alert severity="warning" variant="outlined">
          {error}
        </Alert>
      )}
      {/* Row 1: KPI Stat Cards */}
      <Grid container spacing={2.5}>
        {loading || shown === null ? (
          <KpiSkeleton />
        ) : (
          <>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatCard
                label="Applications"
                value={totalApps === 0 ? '0' : `${onlineCount}/${totalApps}`}
                subtitle={
                  totalApps === 0
                    ? 'No apps yet'
                    : offlineCount > 0
                      ? `${offlineCount} offline`
                      : 'All online'
                }
                icon={<AppsIcon sx={{ fontSize: 28 }} />}
                color={totalApps === 0 ? 'secondary' : offlineCount > 0 ? 'warning' : 'success'}
                sx={{ height: '100%' }}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatCard
                label="Stacks"
                value={stacks.length > 0 ? `${runningStacks}/${stacks.length}` : '1'}
                subtitle={stacks.length > 0 ? `${runningStacks} running` : 'Local'}
                icon={<StacksIcon sx={{ fontSize: 28 }} />}
                color={runningStacks > 0 ? 'primary' : 'secondary'}
                sx={{ height: '100%' }}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatCard
                label="CPU Usage"
                value={`${totalCpu.toFixed(1)}%`}
                icon={<MetricsIcon sx={{ fontSize: 28 }} />}
                color={cpuColor}
                sx={{ height: '100%' }}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatCard
                label="Memory"
                value={formatMemory(totalMemory)}
                icon={<ContainersIcon sx={{ fontSize: 28 }} />}
                color={memColor}
                sx={{ height: '100%' }}
              />
            </Grid>
          </>
        )}
      </Grid>
      {/* Row 2: Application Status Grid — grouped by stack when showing all */}
      {apps.length > 0 && (
        <Box>
          <Typography
            variant="h6"
            sx={{
              fontWeight: 700,
              mb: 2
            }}>
            Application Status
          </Typography>
          <AppStatusGrid apps={apps} activeStack={activeStack} />
        </Box>
      )}
    </Stack>
  );
}
