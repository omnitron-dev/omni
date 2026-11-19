import { appHref, stackHref, workspaceHref } from 'src/routes/workspace';
import { processWorkspace } from 'src/utils/project-scope';
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Button, Chip, Grid, Link, Stack, Typography } from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { StatCard, type StatCardProps } from '@omnitron-dev/prism/components/card';
import { Table, type TableColumn } from '@omnitron-dev/prism/components/table';
import { healthLabel } from '@omnitron-dev/omnitron/stack-reading';
import { useAccess } from 'src/auth/access';
import { Breadcrumbs } from 'src/components/page-breadcrumbs';
import { ResourceBreakdown } from 'src/components/resource-breakdown';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { useStackContext } from 'src/hooks/use-stack-context';
import { daemon, metrics } from 'src/netron/client';
import { useProjectStore } from 'src/stores/project.store';
import { useRealtimeStore } from 'src/stores/realtime.store';
import { shownApps, type ShownApp } from 'src/utils/app-address';
import { statusColor } from 'src/utils/constants';
import { formatUptime } from 'src/utils/formatters';
import { formatBytes, formatCpu, resourceTotal } from 'src/utils/metric-series';
import { stackApps, stackCounts, stacksInScope } from 'src/utils/stack-inventory';

function attention(app: ShownApp) {
  return (
    statusColor(app.status) === 'error' ||
    app.status === 'degraded' ||
    app.health === 'unhealthy' ||
    app.health === 'degraded'
  );
}

function ApplicationInventory({
  apps,
  project,
  stack,
}: {
  apps: ShownApp[];
  project: string | null;
  stack: string | null;
}) {
  const [onlyAttention, setOnlyAttention] = useState(false);
  const { can } = useAccess();
  const projects = useProjectStore(s => s.projects);
  const issues = apps.filter(attention);
  const columns: TableColumn<ShownApp>[] = [
    {
      id: 'name',
      label: 'Application',
      rowHeader: true,
      render: (app) => {
        const owner = project && app.stack ? { project, stack: app.stack }
          : app.workspace === undefined ? processWorkspace(projects, app.key) : app.workspace;
        const href = app.remote
          ? owner && can('OmnitronProject.listStacks') && stackHref(owner.project, owner.stack)
          : can('OmnitronDaemon.getApp') && (owner ? appHref(owner.project, owner.stack, app.name) : '/processes/' + encodeURIComponent(app.key));
        const scope = project ? app.stack : owner ? owner.project + '/' + owner.stack : app.key.split('/').slice(0, -1).join('/');
        const processes = app.processes?.length
          ? `${app.processes.filter((process) => process.status === 'online').length}/${app.processes.length} processes online`
          : app.instances && app.instances > 1
            ? `${app.instances} instances`
            : '';
        const detail = [!stack && scope, app.remote && 'Remote', processes].filter(Boolean).join(' · ');
        return (
          <>
            {href ? (
              <Link
                component={RouterLink}
                to={href}
                underline="hover"
                color="inherit"
                aria-label={app.remote ? `Open stack ${app.stack} for ${app.name}` : undefined}
              >
                {app.name}
              </Link>
            ) : (
              app.name
            )}
            {detail && (
              <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {detail}
              </Typography>
            )}
          </>
        );
      },
    },
    {
      id: 'status',
      label: 'Process',
      render: (app) => <Chip size="small" variant="outlined" label={app.status} color={statusColor(app.status)} />,
    },
    {
      id: 'health',
      label: 'Health',
      render: (app) => (
        <Typography
          variant="body2"
          color={
            app.health === 'unhealthy' ? 'error.main' : app.health === 'degraded' ? 'warning.main' : 'text.secondary'
          }
        >
          {healthLabel(app.health)}
        </Typography>
      ),
    },
    { id: 'cpu', label: 'CPU', align: 'right', render: (app) => formatCpu(app.cpu) },
    { id: 'memory', label: 'Memory', align: 'right', render: (app) => formatBytes(app.memory) },
    { id: 'uptime', label: 'Uptime', align: 'right', render: (app) => formatUptime(app.uptime) },
    {
      id: 'restarts',
      label: 'Restarts',
      align: 'right',
      render: (app) => (Number.isFinite(app.restarts) && app.restarts >= 0 ? app.restarts : '—'),
    },
  ];

  const rows = (onlyAttention ? issues : [...apps]).sort(
    (a, b) => Number(attention(b)) - Number(attention(a)) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key)
  );
  return (
    <Stack component="section" aria-labelledby="overview-applications" spacing={1}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Typography component="h2" variant="h6" id="overview-applications">
          Applications
        </Typography>
        {(issues.length > 0 || onlyAttention) && (
          <Button
            size="small"
            variant={onlyAttention ? 'contained' : 'outlined'}
            aria-pressed={onlyAttention}
            onClick={() => setOnlyAttention((value) => !value)}
          >
            Needs attention ({issues.length})
          </Button>
        )}
      </Stack>
      <Table
        aria-label="Applications"
        scrollLabel="Application inventory"
        rowKey="key"
        columns={columns}
        data={rows}
        dense
        emptyContent={
          onlyAttention ? 'No applications currently need attention.' : 'No applications in this selection.'
        }
        sx={{ '& td, & th': { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' } }}
      />
    </Stack>
  );
}

export default function DashboardPage() {
  const { activeProject, activeStack } = useStackContext();
  const { can, snapshot } = useAccess();
  const readProcesses = !activeProject && can('OmnitronDaemon.list');
  const readStacks = !!activeProject && can('OmnitronProject.listStacks');
  const readMetrics = can('OmnitronMetrics.getSnapshot');
  return (
    <DashboardReader
      key={JSON.stringify([activeProject, activeStack, snapshot?.userId, readStacks, readProcesses, readMetrics])}
      project={activeProject}
      stack={activeStack}
      readStacks={readStacks}
      readProcesses={readProcesses}
      readMetrics={readMetrics}
    />
  );
}

function DashboardReader({
  project,
  stack,
  readStacks,
  readProcesses,
  readMetrics,
}: {
  project: string | null;
  stack: string | null;
  readStacks: boolean;
  readProcesses: boolean;
  readMetrics: boolean;
}) {
  const { can } = useAccess();
  // The shell owns the project's inventory subscription. All project counts and rows
  // use that same observation, including a failed refresh and the last good result.
  const inventory = useProjectStore((s) => (readStacks && project ? s.stacksByProject[project] : undefined));
  const inventoryError = useProjectStore((s) => (readStacks && project ? s.stackReadErrors[project] : null));
  const connected = useRealtimeStore((s) => s.connected);
  const lastAppEvent = useRealtimeStore((s) => s.appEvents[0]);
  const intervalMs = connected ? 15_000 : 5_000;
  const processes = usePolledResource(() => daemon.list({ workspaces: true }), { intervalMs, enabled: readProcesses });
  const refreshProcesses = processes.refresh;
  useEffect(() => {
    if (readProcesses && lastAppEvent && document.visibilityState === 'visible') void refreshProcesses();
  }, [readProcesses, lastAppEvent, refreshProcesses]);

  const selected = inventory && stacksInScope(inventory, stack);
  const apps = project
    ? selected
      ? shownApps(project, stack, stackApps(selected), [])
      : null
    : processes.data && shownApps(null, null, null, processes.data);
  const hasLocalReadings = !!apps?.some((app) => !app.remote && app.status === 'online');
  const sample = usePolledResource(() => metrics.getSnapshot(), {
    intervalMs,
    enabled: readMetrics && hasLocalReadings,
  });
  const readings = apps?.map((app) => {
    const value = !app.remote && app.status === 'online' ? sample.data?.apps?.[app.key] : undefined;
    return value ? { ...app, cpu: value.cpu ?? app.cpu, memory: value.memory ?? app.memory } : app;
  });
  const online = apps?.filter((app) => app.status === 'online').length ?? 0;
  const counts = selected && stackCounts(selected);
  const loading = readStacks ? !inventory && !inventoryError : readProcesses && processes.loading;
  const failure = inventoryError || processes.error;
  const retry = () => {
    if (project && readStacks) void useProjectStore.getState().fetchStacks(project);
    if (readProcesses) void processes.refresh();
  };
  const summary: Pick<StatCardProps, 'label' | 'value' | 'subtitle'>[] = [
    { label: 'Applications', value: apps ? `${online}/${apps.length}` : '—', subtitle: 'Applications online' },
    {
      label: 'Stacks',
      value:
        selected && counts
          ? `${counts.runningStacks}/${selected.length}`
          : apps
            ? new Set(apps.map((app) => app.key.split('/').slice(0, -1).join('/') || 'local')).size
            : '—',
      subtitle: project
        ? counts?.unknownStacks
          ? `${counts.unknownStacks} unknown`
          : 'Stacks running'
        : 'On this daemon',
    },
    {
      label: 'CPU',
      value: formatCpu(readings && resourceTotal(readings.map((app) => app.cpu))),
      subtitle: 'Across selected apps',
    },
    {
      label: 'Memory',
      value: formatBytes(readings && resourceTotal(readings.map((app) => app.memory))),
      subtitle: 'Resident memory',
    },
  ];

  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Breadcrumbs
        heading="Overview"
        links={[{ name: 'Overview' }]}
        action={
          stack && readStacks ? (
            <Button size="small" component={RouterLink} to={stackHref(project!, stack)}>
              Open stack
            </Button>
          ) : project && can('OmnitronMetrics.getSnapshot') ? (
            <Button size="small" component={RouterLink} to={workspaceHref({ project, stack }, '/metrics')}>
              Metrics
            </Button>
          ) : undefined
        }
      />
      {failure && (
        <Alert severity="warning" variant="outlined" action={<Button onClick={retry}>Retry</Button>}>
          {apps ? 'Showing the last available application inventory.' : 'Application inventory is unavailable.'}{' '}
          {failure}
        </Alert>
      )}
      {!readStacks && !readProcesses && (
        <Alert severity="info">Application inventory is unavailable with your current access.</Alert>
      )}
      {readMetrics && hasLocalReadings && sample.error && (
        <Alert
          severity="warning"
          variant="outlined"
          action={<Button onClick={() => void sample.refresh()}>Retry</Button>}
        >
          Resource sampling is unavailable. {sample.data ? 'Showing the last samples.' : 'Showing inventory readings.'}{' '}
          {sample.error}
        </Alert>
      )}
      <Grid container spacing={1} aria-label="Workspace summary">
        {summary.map((stat) => (
          <Grid key={stat.label} size={{ xs: 6, sm: 3 }}>
            <StatCard
              {...stat}
              loading={loading}
              sx={{ height: '100%', '& h4': { fontSize: { xs: 22, sm: 26 }, fontVariantNumeric: 'tabular-nums' } }}
            />
          </Grid>
        ))}
      </Grid>
      {readings && <ApplicationInventory apps={readings} stack={stack} project={project} />}
      {!!readings?.length && <ResourceBreakdown apps={readings} />}
    </Stack>
  );
}
