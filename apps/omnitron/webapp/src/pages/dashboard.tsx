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
import Skeleton from '@mui/material/Skeleton';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import { alpha, useTheme } from '@mui/material/styles';

import { AppsIcon, StacksIcon, MetricsIcon, ContainersIcon } from 'src/assets/icons';

import { StatCard } from '@omnitron/prism';
import { daemon, metrics } from 'src/netron/client';
import { formatMemory, formatUptime } from 'src/utils/formatters';
import { STATUS_COLORS, LEVEL_COLORS } from 'src/utils/constants';
import { useRealtimeStore } from 'src/stores/realtime.store';
import { useActiveProjectStacks } from 'src/stores/project.store';
import { useStackContext } from 'src/hooks/use-stack-context';

import type { ProcessInfoDto } from '@omnitron-dev/omnitron/dto/services';

// ---------------------------------------------------------------------------
// App Status Card
// ---------------------------------------------------------------------------

function AppStatusCard({ app }: { app: ProcessInfoDto }) {
  const theme = useTheme();

  // Strip project/stack prefix from display name: "omni/dev/main" → "main"
  const displayName = app.name.includes('/') ? app.name.split('/').pop()! : app.name;

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
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Typography variant="subtitle2" fontWeight={700}>
            {displayName}
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
            <Stack key={row.label} direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 0.25 }}>
              <Typography variant="caption" color="text.secondary">
                {row.label}
              </Typography>
              <Typography variant="caption" fontWeight={600}>
                {row.value}
              </Typography>
            </Stack>
          ))}
        </Stack>

        {app.processes && app.processes.length > 0 && (
          <>
            <Divider sx={{ my: 1 }} />
            <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.5, display: 'block' }}>
              Processes
            </Typography>
            <Stack spacing={0.25}>
              {app.processes.map((p) => (
                <Stack key={p.name} direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.68rem' }}>
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

function AppStatusGrid({ apps, activeStack }: { apps: ProcessInfoDto[]; activeStack: string | null }) {
  // If a specific stack is selected, or apps aren't namespaced, show flat grid
  if (activeStack || apps.every((a) => !a.name.includes('/'))) {
    return (
      <Grid container spacing={2.5}>
        {apps.map((app) => (
          <Grid key={app.name} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
            <AppStatusCard app={app} />
          </Grid>
        ))}
      </Grid>
    );
  }

  // Group apps by stack (from namespaced handle: project/stack/app)
  const groups = new Map<string, ProcessInfoDto[]>();
  for (const app of apps) {
    const parts = app.name.split('/');
    const stackLabel = parts.length >= 3 ? parts[1]! : 'default';
    if (!groups.has(stackLabel)) groups.set(stackLabel, []);
    groups.get(stackLabel)!.push(app);
  }

  return (
    <Stack spacing={3}>
      {Array.from(groups.entries()).map(([stackName, stackApps]) => (
        <Box key={stackName}>
          <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 1.5 }}>
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: stackApps.every((a) => a.status === 'online') ? '#22c55e' : '#eab308',
              }}
            />
            <Typography variant="subtitle2" fontWeight={700} textTransform="uppercase" letterSpacing={0.5}>
              {stackName}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {stackApps.filter((a) => a.status === 'online').length}/{stackApps.length} online
            </Typography>
          </Stack>
          <Grid container spacing={2.5}>
            {stackApps.map((app) => (
              <Grid key={app.name} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
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

  const [allApps, setAllApps] = useState<ProcessInfoDto[]>([]);
  const [metricsSnapshot, setMetricsSnapshot] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isFirstLoad = useRef(true);

  const { filterApps, activeStack } = useStackContext();
  const stacks = useActiveProjectStacks();

  const fetchData = useCallback(async () => {
    try {
      const [appList, snapshot] = await Promise.allSettled([
        daemon.list(),
        metrics.getSnapshot(),
      ]);

      if (appList.status === 'fulfilled') setAllApps(appList.value);
      if (snapshot.status === 'fulfilled') setMetricsSnapshot(snapshot.value);

      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to connect to daemon');
    } finally {
      if (isFirstLoad.current) {
        setLoading(false);
        isFirstLoad.current = false;
      }
    }
  }, []);

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
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, wsConnected ? 15_000 : 5_000);
    return () => clearInterval(interval);
  }, [fetchData, wsConnected]);

  // Re-fetch on any WS event (app started/crashed/restarted)
  useEffect(() => {
    if (lastEvent) fetchData();
  }, [lastEvent, fetchData]);

  const apps = filterApps(allApps);

  // Use metrics snapshot if available (titan-metrics), fallback to daemon status
  const snap = metricsSnapshot;
  const onlineCount = snap?.totals?.onlineApps ?? apps.filter((a) => a.status === 'online').length;
  const totalApps = snap?.totals?.apps ?? apps.length;
  const offlineCount = totalApps - onlineCount;
  const totalCpu = snap?.totals?.cpu ?? apps.reduce((sum, a) => sum + a.cpu, 0);
  const totalMemory = snap?.totals?.memory ?? apps.reduce((sum, a) => sum + a.memory, 0);
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
        {loading ? (
          <KpiSkeleton />
        ) : (
          <>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatCard
                label="Applications"
                value={apps.length}
                subtitle={`${onlineCount} online / ${offlineCount} offline`}
                icon={<AppsIcon sx={{ fontSize: 28 }} />}
                color={offlineCount > 0 ? 'warning' : 'success'}
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
          <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>
            Application Status
          </Typography>
          <AppStatusGrid apps={apps} activeStack={activeStack} />
        </Box>
      )}

    </Stack>
  );
}
