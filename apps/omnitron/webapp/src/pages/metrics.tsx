import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Skeleton from '@mui/material/Skeleton';
import Alert from '@mui/material/Alert';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import { alpha } from '@mui/material/styles';
import Chart from 'react-apexcharts';

import { MetricsIcon, AppsIcon, LogsIcon, RefreshIcon } from 'src/assets/icons';
import { Breadcrumbs } from '@omnitron-dev/prism';
import { daemon, metrics, logs as logsClient } from 'src/netron/client';
import { useStackContext } from 'src/hooks/use-stack-context';
import { usePollingEffect } from 'src/hooks/use-polled-resource';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MetricsSummary {
  totalCpuPercent: number;
  /**
   * Resident memory across managed apps, in bytes.
   *
   * This was `totalMemoryPercent`, computed as `memory / (1024 * 1024)` —
   * megabytes — rendered with a `%` suffix and coloured red above 80. The
   * card read "6162%" on this host, permanently in the error colour, for a
   * number that was never a percentage. There is no host memory total in
   * the API to divide by, so it is shown as what it is.
   */
  totalMemoryBytes: number;
  activeApps: number;
  /** Lines written per second, or null until two samples exist to compare. */
  logIngestionRate: number | null;
}

// ---------------------------------------------------------------------------
// Chart theme config
// ---------------------------------------------------------------------------

const baseChartOptions: ApexCharts.ApexOptions = {
  chart: { background: 'transparent', toolbar: { show: false } },
  theme: { mode: 'dark' },
  grid: { borderColor: 'rgba(255,255,255,0.1)' },
  xaxis: {
    type: 'datetime',
    labels: { style: { colors: '#999' }, datetimeUTC: false },
  },
  yaxis: { labels: { style: { colors: '#999' } } },
  stroke: { curve: 'smooth', width: 2 },
  tooltip: { theme: 'dark', x: { format: 'HH:mm:ss' } },
  legend: { labels: { colors: '#ccc' } },
};

/** "6.0 GB", "812 MB", "—" when unknown. */
function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** "1.2k", "340", "—" when there is nothing to compare against yet. */
function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '—';
  if (rate >= 1000) return `${(rate / 1000).toFixed(1)}k`;
  return rate < 10 ? rate.toFixed(1) : String(Math.round(rate));
}

// ---------------------------------------------------------------------------
// Gauge Card
// ---------------------------------------------------------------------------

interface GaugeCardProps {
  title: string;
  value: string | number;
  suffix?: string;
  icon: React.ReactNode;
  color: 'success' | 'warning' | 'error' | 'info' | 'primary';
  loading?: boolean;
}

function GaugeCard({ title, value, suffix, icon, color, loading }: GaugeCardProps) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack
          direction="row"
          spacing={2}
          sx={{
            alignItems: "center",
            justifyContent: "space-between"
          }}>
          <Stack spacing={0.5}>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              {title}
            </Typography>
            {loading ? (
              <Skeleton width={60} height={40} />
            ) : (
              <Typography variant="h4">
                {value}
                {suffix && (
                  <Typography
                    component="span"
                    variant="body2"
                    sx={{
                      color: "text.secondary",
                      ml: 0.5
                    }}>
                    {suffix}
                  </Typography>
                )}
              </Typography>
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
// Metrics Page
// ---------------------------------------------------------------------------

const DATA_POINTS = 30; // 5 minutes at 10s intervals
const INTERVAL_MS = 10_000;

export default function MetricsPage() {
  const { displayName, namespacePrefix } = useStackContext();
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Mock time-series data — regenerated on each fetch cycle
  const [cpuSeries, setCpuSeries] = useState<any[]>([]);
  const [memSeries, setMemSeries] = useState<any[]>([]);
  const [logSeries, setLogSeries] = useState<any[]>([]);

  /**
   * Last ingestion sample, for the rate.
   *
   * A ref rather than state: it feeds the next computation and nothing
   * renders from it, so writing it must not schedule a render.
   */
  const lastIngestion = useRef<{ total: number; at: number } | null>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      // Fetch metrics snapshot from titan-metrics
      let snapshot: any = null;
      try {
        snapshot = await metrics.getSnapshot();
      } catch {
        // Metrics service not available
      }

      // Lines actually written per second, from two samples of an in-memory
      // counter. The card was a hardcoded 0; the only other source is
      // `getLogStats`, which counts the whole table — 22.5 million rows here.
      // Null until there are two samples: a rate needs an interval, and
      // showing 0 for the first one would be a measurement nobody made.
      let ingestionRate: number | null = null;
      try {
        const stats = await logsClient.getIngestionStats();
        const now = Date.now();
        const previous = lastIngestion.current;
        if (previous && now > previous.at) {
          const delta = stats.ingestedTotal - previous.total;
          // A counter that went backwards means the daemon restarted; that is
          // not a negative rate, it is the absence of a comparable pair.
          ingestionRate = delta >= 0 ? (delta * 1000) / (now - previous.at) : null;
        }
        lastIngestion.current = { total: stats.ingestedTotal, at: now };
      } catch {
        // The counter is a nicety; losing it must not empty the page.
      }

      if (snapshot?.totals) {
        setSummary({
          totalCpuPercent: Math.round(snapshot.totals.cpu),
          totalMemoryBytes: snapshot.totals.memory ?? 0,
          activeApps: snapshot.totals.onlineApps ?? 0,
          logIngestionRate: ingestionRate,
        });
      } else {
        // Fallback to daemon status
        const result = await daemon.status();
        const apps = (result as any)?.apps ?? [];
        const activeCount = Array.isArray(apps) ? apps.filter((a: any) => a.status === 'online').length : 0;
        const totalCpu = Array.isArray(apps) ? apps.reduce((s: number, a: any) => s + (a.cpu ?? 0), 0) : 0;
        const totalMem = Array.isArray(apps) ? apps.reduce((s: number, a: any) => s + (a.memory ?? 0), 0) : 0;

        setSummary({
          totalCpuPercent: Math.round(totalCpu),
          totalMemoryBytes: totalMem,
          activeApps: activeCount,
          logIngestionRate: ingestionRate,
        });
      }

      // Fetch time-series from titan-metrics querySeries
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      let cpuData: any[] = [];
      let memData: any[] = [];
      try {
        cpuData = await metrics.querySeries({ names: ['cpu_percent'], from: fiveMinAgo, interval: '30s' });
        memData = await metrics.querySeries({ names: ['memory_bytes'], from: fiveMinAgo, interval: '30s' });
      } catch {
        // Not available yet
      }

      if (cpuData.length > 0) {
        // Filter series by stack context and strip namespace prefix from labels
        const filterSeries = (data: any[]) =>
          data
            .filter((s: any) => !namespacePrefix || s.app.startsWith(namespacePrefix) || !s.app.includes('/'))
            .map((s: any) => ({
              ...s,
              app: s.app.includes('/') ? s.app.split('/').pop() : s.app,
            }));

        const filteredCpu = filterSeries(cpuData);
        const filteredMem = filterSeries(memData);

        setCpuSeries(filteredCpu.map((s: any) => ({
          name: s.app,
          data: s.points.map((p: any) => ({ x: new Date(p.timestamp).getTime(), y: Number(p.value.toFixed(1)) })),
        })));
        setMemSeries(filteredMem.map((s: any) => ({
          name: s.app,
          data: s.points.map((p: any) => ({ x: new Date(p.timestamp).getTime(), y: Math.round(p.value / (1024 * 1024)) })),
        })));
      } else {
        // No series for this window — say so by drawing nothing.
        //
        // This used to fall back to `generateMockTimeSeries` for three
        // hardcoded app names, so a daemon that had just restarted showed an
        // operator plausible CPU and memory history for apps that might not
        // exist. Absence rendered as invented data is worse than absence
        // rendered as zero: there is nothing about it to disbelieve.
        setCpuSeries([]);
        setMemSeries([]);
      }

      // Log volume — query real log stats, fall back to mock if unavailable
      try {
        const { logs } = await import('src/netron/client');
        const logStats = await logs.getLogStats();
        if (logStats?.byLevel && logStats.byLevel.length > 0) {
          // `byLevel` is a cumulative count per level with no time dimension.
          // It used to be spread as `count / DATA_POINTS` across thirty
          // buckets and drawn on a time axis — a flat line presented as
          // history, under a y-axis labelled "Lines / interval". One bar per
          // level is what the data actually is.
          setLogSeries([
            {
              name: 'lines',
              data: logStats.byLevel.map(({ level, count }) => ({ x: level, y: count })),
            },
          ]);
        } else {
          throw new Error('no data');
        }
      } catch {
        // Same rule as the series above: nothing, rather than something made up.
        setLogSeries([]);
      }

      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to fetch metrics');
    } finally {
      setLoading(false);
    }
  }, []);

  // The page owns its several series in local state, so it takes the schedule
  // only. `autoRefresh` is the toggle the user controls; note that turning it
  // off used to skip the interval but still fetch once per render of this
  // effect, which is not what "off" means.
  usePollingEffect(() => void fetchMetrics(), { intervalMs: 10_000, enabled: autoRefresh });

  useEffect(() => {
    // One fetch on mount regardless of the toggle: an operator arriving with
    // auto-refresh off still expects to see numbers.
    void fetchMetrics();
  }, [fetchMetrics]);

  const cpuChartOptions = useMemo<ApexCharts.ApexOptions>(
    () => ({
      ...baseChartOptions,
      yaxis: {
        ...baseChartOptions.yaxis,
        title: { text: 'CPU %', style: { color: '#999' } },
        max: 100,
      },
      colors: ['#6366f1', '#22d3ee', '#f97316'],
    }),
    [],
  );

  const memChartOptions = useMemo<ApexCharts.ApexOptions>(
    () => ({
      ...baseChartOptions,
      yaxis: {
        ...baseChartOptions.yaxis,
        title: { text: 'Memory (MB)', style: { color: '#999' } },
      },
      colors: ['#a78bfa', '#34d399', '#fb923c'],
    }),
    [],
  );

  const logChartOptions = useMemo<ApexCharts.ApexOptions>(
    () => ({
      ...baseChartOptions,
      chart: { ...baseChartOptions.chart, type: 'bar' },
      plotOptions: { bar: { columnWidth: '40%', borderRadius: 2, distributed: true } },
      legend: { show: false },
      // A category axis, not a time axis. `byLevel` has no time dimension —
      // the shared `baseChartOptions` uses `datetime`, which is right for the
      // CPU and memory charts and wrong here.
      xaxis: { ...baseChartOptions.xaxis, type: 'category' },
      yaxis: {
        ...baseChartOptions.yaxis,
        title: { text: 'Lines (total)', style: { color: '#999' } },
      },
      colors: ['#3b82f6', '#f59e0b', '#ef4444', '#6b7280'],
    }),
    [],
  );

  return (
    <Stack spacing={3}>
      {/* Header */}
      <Breadcrumbs
        links={[{ name: 'Metrics' }]}
        action={
          <Stack direction="row" spacing={1} sx={{
            alignItems: "center"
          }}>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              Auto-refresh
            </Typography>
            <Switch
              size="small"
              checked={autoRefresh}
              onChange={(_, checked) => setAutoRefresh(checked)}
            />
            <IconButton size="small" onClick={fetchMetrics} title="Refresh">
              <RefreshIcon />
            </IconButton>
          </Stack>
        }
      />
      {error && (
        <Alert severity="warning" variant="outlined" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {/* Gauge Cards */}
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <GaugeCard
            title="Total CPU"
            value={summary?.totalCpuPercent ?? 0}
            suffix="%"
            icon={<MetricsIcon />}
            color={
              (summary?.totalCpuPercent ?? 0) > 80
                ? 'error'
                : (summary?.totalCpuPercent ?? 0) > 60
                  ? 'warning'
                  : 'success'
            }
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <GaugeCard
            title="Total Memory"
            value={formatBytes(summary?.totalMemoryBytes)}
            icon={<MetricsIcon />}
            // No threshold: without a host memory total there is nothing to
            // be a fraction of, and a colour picked from an absolute byte
            // count would be a judgement this page cannot make.
            color="info"
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <GaugeCard
            title="Active Apps"
            value={summary?.activeApps ?? 0}
            icon={<AppsIcon />}
            color="primary"
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <GaugeCard
            title="Log Ingestion"
            value={formatRate(summary?.logIngestionRate)}
            suffix="lines/s"
            icon={<LogsIcon />}
            color="info"
            loading={loading}
          />
        </Grid>
      </Grid>
      {/* CPU Chart */}
      <Card variant="outlined">
        <CardHeader
          title="CPU Usage"
          titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
          subheader="Per-application CPU usage (last 5 minutes)"
          subheaderTypographyProps={{ variant: 'caption' }}
        />
        <CardContent sx={{ pt: 0 }}>
          {loading ? (
            <Skeleton variant="rectangular" height={300} />
          ) : (
            <Chart type="area" height={300} options={cpuChartOptions} series={cpuSeries} />
          )}
        </CardContent>
      </Card>
      {/* Memory Chart */}
      <Card variant="outlined">
        <CardHeader
          title="Memory Usage"
          titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
          subheader="Per-application memory consumption (MB)"
          subheaderTypographyProps={{ variant: 'caption' }}
        />
        <CardContent sx={{ pt: 0 }}>
          {loading ? (
            <Skeleton variant="rectangular" height={300} />
          ) : (
            <Chart type="area" height={300} options={memChartOptions} series={memSeries} />
          )}
        </CardContent>
      </Card>
      {/* Log Volume Chart */}
      <Card variant="outlined">
        <CardHeader
          title="Log Lines by Level"
          titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
          subheader="Cumulative totals in the log store — not a rate over time"
          subheaderTypographyProps={{ variant: 'caption' }}
        />
        <CardContent sx={{ pt: 0 }}>
          {loading ? (
            <Skeleton variant="rectangular" height={300} />
          ) : (
            <Chart type="bar" height={300} options={logChartOptions} series={logSeries} />
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}
