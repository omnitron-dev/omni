import { useEffect, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  FormControlLabel,
  Grid,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { StatCard } from '@omnitron-dev/prism/components/card';
import { Chart, useChart } from '@omnitron-dev/prism/components/chart';
import { Breadcrumbs } from 'src/components/page-breadcrumbs';
import { MetricChart } from 'src/components/metric-chart';
import { RefreshIcon } from 'src/assets/icons';
import { daemon, metrics, project, logs, nodes } from 'src/netron/client';
import { useStackContext } from 'src/hooks/use-stack-context';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { shownApps } from 'src/utils/app-address';
import {
  formatBytes,
  formatCpu,
  metricLines,
  metricScope,
  METRIC_WINDOWS,
  resourceTotal,
  type MetricWindow,
} from 'src/utils/metric-series';

export { seriesLabel } from 'src/utils/metric-series';

/** Remount the reader when scope changes: a late answer cannot populate a new selection. */
export default function MetricsPage() {
  const { activeProject, activeStack } = useStackContext();
  const [window, setWindow] = useState<MetricWindow>('5m');
  const [autoRefresh, setAutoRefresh] = useState(true);
  return (
    <MetricsReader
      key={JSON.stringify([activeProject, activeStack, window])}
      window={window}
      setWindow={setWindow}
      autoRefresh={autoRefresh}
      setAutoRefresh={setAutoRefresh}
    />
  );
}

function MetricsReader({
  window,
  setWindow,
  autoRefresh,
  setAutoRefresh,
}: {
  window: MetricWindow;
  setWindow: (value: MetricWindow) => void;
  autoRefresh: boolean;
  setAutoRefresh: (value: boolean) => void;
}) {
  const { activeProject, activeStack, namespacePrefix } = useStackContext();
  const [includeProcesses, setIncludeProcesses] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const previousIngestion = useRef<{ total: number; at: number } | null>(null);
  const period = METRIC_WINDOWS[window];

  const inventory = usePolledResource(
    async () => {
      const [processes, deployments] = await Promise.all([
        daemon.list(),
        activeProject ? project.getProjectApps({ project: activeProject }) : Promise.resolve(null),
      ]);
      const apps = shownApps(activeProject, activeStack, deployments, processes)!;
      return {
        apps,
        cpu: resourceTotal(apps.map((a) => a.cpu)),
        memory: resourceTotal(apps.map((a) => a.memory)),
        at: Date.now(),
      };
    },
    { intervalMs: 10_000, enabled: autoRefresh }
  );

  const history = usePolledResource(
    async () => {
      const to = Date.now();
      const from = to - period.duration;
      // One bounded query for both metrics; filtering preserves metric/node identity.
      const [series, stacks, registry] = await Promise.all([
        metrics.querySeries({
          names: ['cpu_percent', 'memory_bytes'],
          from,
          to,
          interval: period.interval,
          limit: 120,
        }),
        activeProject ? project.listStacks({ project: activeProject }) : Promise.resolve([]),
        nodes.listNodes(),
      ]);
      return {
        series,
        from,
        to,
        nodeNames: Object.fromEntries(registry.map((node) => [node.id, node.name])),
        scope: activeProject ? metricScope(activeProject, activeStack, stacks, registry) : undefined,
      };
    },
    { intervalMs: 10_000, enabled: autoRefresh }
  );

  const ingestion = usePolledResource(
    async () => {
      const stats = await logs.getIngestionStats();
      const at = Date.now();
      const previous = previousIngestion.current;
      const delta = previous ? stats.ingestedTotal - previous.total : -1;
      const rate = previous && at > previous.at && delta >= 0 ? (delta * 1000) / (at - previous.at) : null;
      previousIngestion.current = { total: stats.ingestedTotal, at };
      return rate;
    },
    { intervalMs: 10_000, enabled: autoRefresh }
  );

  // Explicit scope/window selection asks once, even while automatic refresh is paused.
  useEffect(() => {
    void inventory.refresh();
    void history.refresh();
    void ingestion.refresh();
  }, []);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([inventory.refresh(), history.refresh(), ingestion.refresh()]);
    } finally {
      setRefreshing(false);
    }
  };

  const from = history.data?.from ?? Date.now() - period.duration;
  const to = history.data?.to ?? Date.now();
  const lines = (name: string) =>
    metricLines(
      history.data?.series ?? [],
      name,
      namespacePrefix,
      includeProcesses,
      history.data?.nodeNames ?? {},
      period.bucket,
      history.data?.scope
    );
  const data = inventory.data;
  const caption = `${period.interval} averages · local time · ${includeProcesses ? 'apps and child processes' : 'application totals'}`;

  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Breadcrumbs
        heading="Metrics"
        links={[{ name: 'Metrics' }]}
        action={
          <Stack direction="row" spacing={1} useFlexGap>
            <FormControlLabel
              sx={{ m: 0 }}
              control={<Switch size="small" checked={autoRefresh} onChange={(_, value) => setAutoRefresh(value)} />}
              label={<Typography variant="caption">Live</Typography>}
            />
            <IconButton size="small" aria-label="Refresh metrics" disabled={refreshing} onClick={refresh}>
              <RefreshIcon />
            </IconButton>
          </Stack>
        }
      />
      {inventory.error && (
        <Alert severity="warning" variant="outlined">
          Application readings: {inventory.error}.{' '}
          {data ? 'Showing the last received values.' : 'No readings available.'}
        </Alert>
      )}
      <Grid container spacing={1.5}>
        {[
          {
            label: 'Applications',
            value: data ? `${data.apps.filter((a) => a.status === 'online').length}/${data.apps.length}` : '—',
            subtitle: 'Online in this selection',
          },
          { label: 'CPU', value: formatCpu(data?.cpu), subtitle: 'Sum across selected apps' },
          { label: 'Resident memory', value: formatBytes(data?.memory), subtitle: 'Sum across selected apps' },
          {
            label: 'Log ingestion',
            value: ingestion.error ? '—' : ingestion.data == null ? '—' : `${ingestion.data.toFixed(1)}/s`,
            subtitle: ingestion.error ? 'Counter unavailable' : 'Daemon · all projects',
          },
        ].map((item) => (
          <Grid key={item.label} size={{ xs: 6, md: 3 }}>
            <StatCard
              {...item}
              loading={item.label === 'Log ingestion' ? ingestion.loading : inventory.loading}
              color="primary"
              sx={{
                height: '100%',
                '& h4': { fontSize: { xs: 22, sm: 26 }, overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums' },
              }}
            />
          </Grid>
        ))}
      </Grid>
      <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          select
          size="small"
          label="Time window"
          value={window}
          onChange={(event) => setWindow(event.target.value as MetricWindow)}
          sx={{ minWidth: 140 }}
        >
          {Object.entries(METRIC_WINDOWS).map(([value, item]) => (
            <MenuItem key={value} value={value}>
              {item.label}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          sx={{ m: 0 }}
          control={
            <Switch size="small" checked={includeProcesses} onChange={(_, value) => setIncludeProcesses(value)} />
          }
          label={<Typography variant="caption">Include child processes</Typography>}
        />
        <Typography variant="caption" color="text.secondary" sx={{ ml: { sm: 'auto' } }}>
          {autoRefresh ? 'Every 10 s' : 'Paused'}
          {history.data ? ` · received ${new Date(history.data.to).toLocaleTimeString()}` : ''}
        </Typography>
      </Stack>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <MetricChart
            title="CPU"
            description={caption}
            lines={lines('cpu_percent')}
            format={formatCpu}
            from={from}
            to={to}
            loading={history.loading}
            error={history.error}
          />
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <MetricChart
            title="Resident memory"
            description={caption}
            lines={lines('memory_bytes')}
            format={formatBytes}
            from={from}
            to={to}
            loading={history.loading}
            error={history.error}
          />
        </Grid>
      </Grid>
      <Typography variant="caption" color="text.secondary">
        CPU is summed process usage and can exceed 100%. Memory is resident bytes, not a percentage of host capacity.
        Child processes are shown separately and must not be added to their application totals.
      </Typography>
      <LogStoreSummary />
    </Stack>
  );
}

/** An expensive cumulative store scan is opt-in, never part of the live metrics poll. */
function LogStoreSummary() {
  const [open, setOpen] = useState(false);
  const stats = usePolledResource(() => logs.getLogStats(), { intervalMs: 60_000, enabled: open });
  const levels = stats.data?.byLevel ?? [];
  const options = useChart({
    chart: { animations: { enabled: false } },
    xaxis: { type: 'category', categories: levels.map((item) => item.level) },
    yaxis: {
      min: 0,
      labels: { formatter: (value: number) => value.toLocaleString(undefined, { notation: 'compact' }) },
    },
    tooltip: { y: { formatter: (value) => value.toLocaleString() } },
  });
  return (
    <Accordion
      expanded={open}
      onChange={(_, value) => setOpen(value)}
      disableGutters
      variant="outlined"
      sx={{ '&::before': { display: 'none' } }}
    >
      <AccordionSummary aria-controls="log-store-data" id="log-store-toggle">
        <Typography variant="body2">{open ? '−' : '+'} Log store · all projects</Typography>
      </AccordionSummary>
      <AccordionDetails id="log-store-data">
        <Typography variant="caption" color="text.secondary">
          Cumulative lines by level in this daemon’s log store. Independent of the selected project and time window.
          Refreshes every minute while expanded.
        </Typography>
        {stats.error && <Alert severity="warning">{stats.error}</Alert>}
        {levels.length ? (
          <>
            <Chart
              type="bar"
              height={220}
              options={options}
              series={[{ name: 'Lines', data: levels.map((item) => item.count) }]}
              role="img"
              aria-label="Cumulative log lines by level"
            />
            <Stack direction="row" useFlexGap spacing={2} sx={{ flexWrap: 'wrap' }}>
              {levels.map((item) => (
                <Typography key={item.level} variant="caption">
                  {item.level}: {item.count.toLocaleString()}
                </Typography>
              ))}
            </Stack>
          </>
        ) : (
          <Typography sx={{ py: 2 }} variant="body2">
            {stats.loading ? 'Reading log store…' : 'No log totals available'}
          </Typography>
        )}
      </AccordionDetails>
    </Accordion>
  );
}
