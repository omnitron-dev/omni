import { Breadcrumbs } from 'src/components/page-breadcrumbs';
/** Selected deployments, current resource readings and links to operational detail. */

import { useState, useEffect, useCallback, useRef } from 'react';
import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Button from '@mui/material/Button';
import { Link as RouterLink } from 'react-router-dom';
import { statusColor } from 'src/utils/constants';
import { formatBytes, formatCpu, resourceTotal } from 'src/utils/metric-series';
import { ResourceBreakdown } from 'src/components/resource-breakdown';

import { Alert } from '@omnitron-dev/prism/components/alert';
import { StatCard } from '@omnitron-dev/prism/components/card';
import { daemon, metrics, project as projectRpc } from 'src/netron/client';
import { formatUptime } from 'src/utils/formatters';
import { useRealtimeStore } from 'src/stores/realtime.store';
import { usePollingEffect } from 'src/hooks/use-polled-resource';
import { useActiveProjectStacks } from 'src/stores/project.store';
import { useStackContext } from 'src/hooks/use-stack-context';
import { shownApps, type ShownApp } from 'src/utils/app-address';

import type { IProjectAppStatus, ProcessInfoDto, MetricsSnapshot } from '@omnitron-dev/omnitron/dto/services';

// ---------------------------------------------------------------------------
// App Status Card
// ---------------------------------------------------------------------------

function AppStatusCard({ app }: { app: ShownApp }) {
  return (
    <Card
      variant="outlined"
      sx={{
        height: '100%',
        '& h4': { fontSize: { xs: 22, sm: 26 }, overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums' },
      }}
    >
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Stack direction="row" useFlexGap spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ minWidth: 0, flex: '1 1 100px', overflowWrap: 'anywhere' }}>
            {app.remote ? (
              app.name
            ) : (
              <Link
                component={RouterLink}
                to={`/apps/${encodeURIComponent(app.key)}`}
                color="inherit"
                underline="hover"
              >
                {app.name}
              </Link>
            )}
          </Typography>
          <Chip label={app.status} color={statusColor(app.status)} size="small" variant="outlined" />
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
          {[
            { label: 'CPU', value: formatCpu(app.cpu) },
            { label: 'Resident memory', value: formatBytes(app.memory) },
            { label: 'Uptime', value: formatUptime(app.uptime) },
            { label: 'Restarts', value: app.restarts },
          ].map((item) => (
            <Box key={item.label} sx={{ minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary">
                {item.label}
              </Typography>
              <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
                {item.value}
              </Typography>
            </Box>
          ))}
        </Box>
        {!!app.processes?.length && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
            {app.processes.filter((process) => process.status === 'online').length}/{app.processes.length} processes
            online
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// App Status Grid — groups by stack when showing all stacks
// ---------------------------------------------------------------------------

function AppStatusGrid({
  apps,
  activeStack,
  activeProject,
}: {
  apps: ShownApp[];
  activeStack: string | null;
  activeProject: string | null;
}) {
  // If a specific stack is selected, or no app belongs to one, show flat grid
  if (activeStack || apps.every((a) => a.stack === null)) {
    return (
      <Grid container spacing={1.5}>
        {apps.map((app) => (
          <Grid key={app.key} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
            <AppStatusCard app={app} />
          </Grid>
        ))}
      </Grid>
    );
  }

  // Group apps by the stack they belong to. Not by parsing the handle: a
  // remote stack's apps carry the node's naming, `sample/deployed/main`.
  const groups = new Map<string, ShownApp[]>();
  for (const app of apps) {
    const stackLabel = activeProject
      ? (app.stack ?? 'default')
      : app.key.includes('/')
        ? app.key.split('/').slice(0, 2).join('/')
        : 'Local';
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
              alignItems: 'center',
              gap: 1,
              flexWrap: 'wrap',
              mb: 1.5,
            }}
          >
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: stackApps.every((a) => a.status === 'online') ? 'success.main' : 'warning.main',
              }}
            />
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                overflowWrap: 'anywhere',
              }}
            >
              {stackName}
              {stackApps.some((a) => a.remote) ? ' · remote' : ''}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: 'text.secondary',
              }}
            >
              {stackApps.filter((a) => a.status === 'online').length}/{stackApps.length} online
            </Typography>
          </Stack>
          <Grid container spacing={1.5}>
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
          <StatCard
            label=""
            value=""
            loading
            sx={{
              height: '100%',
              '& h4': { fontSize: { xs: 22, sm: 26 }, overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums' },
            }}
          />
        </Grid>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Dashboard Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const { activeProject, activeStack } = useStackContext();
  return <DashboardReader key={JSON.stringify([activeProject, activeStack])} />;
}

function DashboardReader() {
  const [processes, setProcesses] = useState<ProcessInfoDto[]>([]);
  /** The selected project's deployments, with the project they answer for. */
  const [deployments, setDeployments] = useState<{ project: string; apps: IProjectAppStatus[] } | null>(null);
  const [metricsSnapshot, setMetricsSnapshot] = useState<MetricsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isFirstLoad = useRef(true);
  const busy = useRef(false);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);

  const { activeProject, activeStack } = useStackContext();
  const stacks = useActiveProjectStacks().filter((stack) => !activeStack || stack.name === activeStack);

  const fetchData = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
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
      setReceivedAt(Date.now());
    } catch (err: any) {
      setError(err?.message ?? 'Failed to connect to daemon');
    } finally {
      busy.current = false;
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
    processes
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
  const sampled = (a: ShownApp) => (a.remote || a.status !== 'online' ? undefined : snapApps[a.key]);
  const totalApps = apps.length;
  const onlineCount = apps.filter((a) => a.status === 'online').length;
  const offlineCount = totalApps - onlineCount;
  const totalCpu = resourceTotal(apps.map((a) => sampled(a)?.cpu ?? a.cpu));
  const totalMemory = resourceTotal(apps.map((a) => sampled(a)?.memory ?? a.memory));
  const runningStacks = stacks.filter((s) => s.status === 'running').length;

  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Breadcrumbs
        heading="Overview"
        links={[{ name: 'Overview' }]}
        action={
          activeProject ? (
            <Stack direction="row" spacing={1}>
              <Button component={RouterLink} to="/metrics" size="small">
                Metrics
              </Button>
              <Button component={RouterLink} to="/topology" size="small">
                Topology
              </Button>
            </Stack>
          ) : undefined
        }
      />
      {error && (
        <Alert severity="warning" variant="outlined">
          {error}
        </Alert>
      )}
      {/* Row 1: KPI Stat Cards */}
      <Grid container spacing={1.5}>
        {loading || shown === null ? (
          <KpiSkeleton />
        ) : (
          <>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatCard
                label="Applications"
                value={totalApps === 0 ? '0' : `${onlineCount}/${totalApps}`}
                subtitle={totalApps === 0 ? 'No apps yet' : offlineCount > 0 ? `${offlineCount} offline` : 'All online'}
                color={totalApps === 0 ? 'secondary' : offlineCount > 0 ? 'warning' : 'success'}
                sx={{
                  height: '100%',
                  '& h4': {
                    fontSize: { xs: 22, sm: 26 },
                    overflowWrap: 'anywhere',
                    fontVariantNumeric: 'tabular-nums',
                  },
                }}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatCard
                label="Stacks"
                value={
                  activeProject
                    ? `${runningStacks}/${stacks.length}`
                    : new Set(apps.map((a) => a.key.split('/').slice(0, -1).join('/') || 'local')).size
                }
                subtitle={activeProject ? `${runningStacks} running` : 'On this daemon'}
                color={runningStacks > 0 ? 'primary' : 'secondary'}
                sx={{
                  height: '100%',
                  '& h4': {
                    fontSize: { xs: 22, sm: 26 },
                    overflowWrap: 'anywhere',
                    fontVariantNumeric: 'tabular-nums',
                  },
                }}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatCard
                label="CPU"
                value={formatCpu(totalCpu)}
                subtitle="Sum across selected apps"
                color="primary"
                sx={{
                  height: '100%',
                  '& h4': {
                    fontSize: { xs: 22, sm: 26 },
                    overflowWrap: 'anywhere',
                    fontVariantNumeric: 'tabular-nums',
                  },
                }}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatCard
                label="Memory"
                value={formatBytes(totalMemory)}
                subtitle="Resident bytes"
                color="info"
                sx={{
                  height: '100%',
                  '& h4': {
                    fontSize: { xs: 22, sm: 26 },
                    overflowWrap: 'anywhere',
                    fontVariantNumeric: 'tabular-nums',
                  },
                }}
              />
            </Grid>
          </>
        )}
      </Grid>
      {receivedAt && (
        <Typography variant="caption" color="text.secondary">
          {activeProject ? 'Selected deployments' : 'This daemon’s applications'} · received{' '}
          {new Date(receivedAt).toLocaleTimeString()}. CPU can exceed 100%; memory has no inferred capacity limit.
        </Typography>
      )}
      {!loading && apps.length > 0 && (
        <ResourceBreakdown
          apps={apps.map((a) => ({ ...a, cpu: sampled(a)?.cpu ?? a.cpu, memory: sampled(a)?.memory ?? a.memory }))}
        />
      )}
      {!loading && shown !== null && apps.length === 0 && (
        <Alert severity="info" variant="outlined">
          No applications in this selection.
        </Alert>
      )}
      {/* Row 2: Applications Grid — grouped by stack when showing all */}
      {apps.length > 0 && (
        <Box>
          <Typography
            variant="h6"
            sx={{
              fontWeight: 700,
              mb: 2,
            }}
          >
            Applications
          </Typography>
          <AppStatusGrid apps={apps} activeStack={activeStack} activeProject={activeProject} />
        </Box>
      )}
    </Stack>
  );
}
