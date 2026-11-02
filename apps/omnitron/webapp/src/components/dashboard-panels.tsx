import { Box, Chip, Stack, Typography } from '@mui/material';
import { DashboardBlock } from '@omnitron-dev/prism/blocks';
import type { ReactNode } from 'react';
import type { AlertSummary, DaemonStatusDto, MetricsTimeSeries } from '@omnitron-dev/omnitron/dto/services';
import { MetricChart } from './metric-chart';
import type { ShownApp } from 'src/utils/app-address';
import { daemonMemoryOf } from 'src/utils/daemon-memory';
import { formatMemory, formatUptime } from 'src/utils/formatters';
import {
  METRIC_WINDOWS,
  metricLines,
  formatBytes,
  formatCpu,
  resourceTotal,
  type MetricScope,
} from 'src/utils/metric-series';
import { STAT_METRICS, type DashboardPanel, type DashboardConfig } from 'src/utils/dashboard-layout';
import type { PollState } from 'src/utils/poll-runner';

export interface ChartData {
  series: MetricsTimeSeries[];
  from: number;
  to: number;
  names: Record<string, string>;
  scope?: MetricScope | undefined;
}
export interface DashboardSources {
  apps: PollState<ShownApp[]>;
  status: PollState<DaemonStatusDto>;
  alerts: PollState<AlertSummary>;
  history: PollState<ChartData>;
  prefix: string;
  subject: string;
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'baseline', gap: 1 }}>
      <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
        {label}
      </Typography>
      <Typography component="span" variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Box>
  );
}

function appStat(metric: keyof typeof STAT_METRICS, apps: ShownApp[]): string | number {
  switch (metric) {
    case 'total_apps':
      return apps.length;
    case 'online_apps':
      return apps.filter((app) => app.status === 'online').length;
    case 'errored_apps':
      return apps.filter((app) => ['crashed', 'errored'].includes(app.status)).length;
    case 'restarts':
      return resourceTotal(apps.map((app) => app.restarts)) ?? '—';
    case 'total_cpu':
      return formatCpu(resourceTotal(apps.map((app) => app.cpu)));
    case 'total_memory': {
      const bytes = resourceTotal(apps.map((app) => app.memory));
      return bytes === null ? '—' : formatMemory(bytes);
    }
    default:
      return '—';
  }
}

export function DashboardWidget({
  panel,
  board,
  sources,
  actions,
}: {
  panel: DashboardPanel;
  board: DashboardConfig;
  sources: DashboardSources;
  actions: ReactNode;
}) {
  const metric = panel.config.metric ?? 'online_apps';
  const name = panel.config.app;
  const apps = name ? sources.apps.data?.filter((app) => app.name === name) : sources.apps.data;
  const subtitle = name ? `${sources.subject} · ${name}` : sources.subject;
  if (panel.type === 'cpu-chart' || panel.type === 'memory-chart') {
    const history = sources.history;
    const period = METRIC_WINDOWS[board.window];
    const cpu = panel.type === 'cpu-chart';
    const series = (history.data?.series ?? []).filter((item) => !name || item.app.split('/').at(-1) === name);
    return (
      <MetricChart
        title={panel.title}
        actions={actions}
        description={`${subtitle} · ${period.label} · ${period.interval} averages`}
        lines={metricLines(
          series,
          cpu ? 'cpu_percent' : 'memory_bytes',
          sources.prefix,
          false,
          history.data?.names ?? {},
          period.bucket,
          history.data?.scope
        )}
        format={cpu ? formatCpu : formatBytes}
        from={history.data?.from ?? Date.now() - period.duration}
        to={history.data?.to ?? Date.now()}
        loading={history.loading}
        error={history.error}
        height={220}
      />
    );
  }
  const controller =
    panel.type === 'daemon-info' || panel.type === 'alert-summary' || (panel.type === 'stat' && metric === 'uptime');
  const source = panel.type === 'alert-summary' ? sources.alerts : controller ? sources.status : sources.apps;
  let body: ReactNode;
  if (panel.type === 'stat') {
    const value =
      metric === 'uptime'
        ? sources.status.data
          ? formatUptime(sources.status.data.uptime)
          : '—'
        : apps && (!name || apps.length)
          ? appStat(metric, apps)
          : '—';
    body = (
      <Typography variant="h4" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    );
  } else if (panel.type === 'daemon-info' && sources.status.data) {
    const status = sources.status.data;
    body = (
      <Stack spacing={0.75}>
        <Fact label="Version" value={status.version} />
        <Fact label="PID" value={status.pid} />
        <Fact label="Uptime" value={formatUptime(status.uptime)} />
        <Fact label="Resident memory" value={formatMemory(daemonMemoryOf(status))} />
      </Stack>
    );
  } else if (panel.type === 'alert-summary' && sources.alerts.data) {
    const summary = sources.alerts.data;
    body = (
      <Stack spacing={0.75}>
        <Fact label="Firing" value={summary.firing} />
        <Fact label="Acknowledged" value={summary.acknowledged} />
        {Object.entries(summary.bySeverity).map(([level, count]) => (
          <Fact key={level} label={level} value={count} />
        ))}
      </Stack>
    );
  } else if (apps && (panel.type === 'app-grid' || panel.type === 'recent-errors')) {
    const rows =
      panel.type === 'app-grid'
        ? apps
        : apps.filter((app) => ['crashed', 'errored'].includes(app.status) || app.restarts > 0);
    body = rows.length ? (
      <Stack spacing={0.75}>
        {rows.map((app) => (
          <Fact
            key={app.key}
            label={[app.stack, app.name].filter(Boolean).join(' / ')}
            value={
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                {panel.type === 'recent-errors' && <span>{app.restarts} restarts</span>}
                <Chip size="small" variant="outlined" label={app.status} />
              </Stack>
            }
          />
        ))}
      </Stack>
    ) : (
      <Typography variant="body2" color="text.secondary">
        {panel.type === 'app-grid'
          ? 'No applications in this scope.'
          : 'No observed failures or restarts in this scope.'}
      </Typography>
    );
  }
  return (
    <DashboardBlock
      title={panel.title}
      subtitle={controller ? 'Connected daemon' : subtitle}
      actions={actions}
      variant="outlined"
      size="small"
      sx={{ height: '100%', minWidth: 0 }}
      loading={source.loading}
      error={!source.data && Boolean(source.error)}
      errorConfig={{ message: source.error ?? 'Measurement unavailable' }}
    >
      {source.error && source.data && (
        <Typography variant="caption" color="warning.main">
          Last observation · {source.error}
        </Typography>
      )}
      {body}
    </DashboardBlock>
  );
}
