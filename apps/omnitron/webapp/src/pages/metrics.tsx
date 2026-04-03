import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { Breadcrumbs } from '@omnitron/prism';
import { daemon, metrics } from 'src/netron/client';
import { useStackContext } from 'src/hooks/use-stack-context';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MetricsSummary {
  totalCpuPercent: number;
  totalMemoryPercent: number;
  activeApps: number;
  logIngestionRate: number; // lines/sec
}

interface TimeSeriesPoint {
  x: number; // timestamp ms
  y: number;
}

// ---------------------------------------------------------------------------
// Mock data generators (will be replaced with real metrics_raw queries in Phase 2)
// ---------------------------------------------------------------------------

function generateMockTimeSeries(
  points: number,
  minVal: number,
  maxVal: number,
  intervalMs: number,
): TimeSeriesPoint[] {
  const now = Date.now();
  const data: TimeSeriesPoint[] = [];
  let value = minVal + Math.random() * (maxVal - minVal) * 0.5;
  for (let i = points - 1; i >= 0; i--) {
    // Random walk with mean-reversion
    value += (Math.random() - 0.5) * (maxVal - minVal) * 0.1;
    value = Math.max(minVal, Math.min(maxVal, value));
    data.push({ x: now - i * intervalMs, y: Math.round(value * 10) / 10 });
  }
  return data;
}

function generateMockLogVolume(points: number, intervalMs: number) {
  const now = Date.now();
  const levels = ['info', 'warn', 'error', 'debug'] as const;
  const ranges: Record<string, [number, number]> = {
    info: [20, 80],
    warn: [2, 15],
    error: [0, 5],
    debug: [10, 40],
  };
  return Object.fromEntries(
    levels.map((level) => {
      const [min, max] = ranges[level]!;
      const data: TimeSeriesPoint[] = [];
      for (let i = points - 1; i >= 0; i--) {
        data.push({
          x: now - i * intervalMs,
          y: Math.round(min + Math.random() * (max - min)),
        });
      }
      return [level, data];
    }),
  );
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
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
          <Stack spacing={0.5}>
            <Typography variant="body2" color="text.secondary">
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
                    color="text.secondary"
                    sx={{ ml: 0.5 }}
                  >
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

const MOCK_APPS = ['main', 'storage', 'worker'];
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

  const fetchMetrics = useCallback(async () => {
    try {
      // Fetch metrics snapshot from titan-metrics
      let snapshot: any = null;
      try {
        snapshot = await metrics.getSnapshot();
      } catch {
        // Metrics service not available
      }

      if (snapshot?.totals) {
        setSummary({
          totalCpuPercent: Math.round(snapshot.totals.cpu),
          totalMemoryPercent: Math.round(snapshot.totals.memory / (1024 * 1024)),
          activeApps: snapshot.totals.onlineApps ?? 0,
          logIngestionRate: 0,
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
          totalMemoryPercent: Math.round(totalMem / (1024 * 1024)),
          activeApps: activeCount,
          logIngestionRate: 0,
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
        // Fallback: mock time-series
        setCpuSeries(
          MOCK_APPS.map((app) => ({
            name: app,
            data: generateMockTimeSeries(DATA_POINTS, 5, 60, INTERVAL_MS),
          })),
        );
        setMemSeries(
          MOCK_APPS.map((app) => ({
            name: app,
            data: generateMockTimeSeries(DATA_POINTS, 50, 500, INTERVAL_MS),
          })),
        );
      }

      // Log volume (always mock for now — needs log aggregation query)
      const logVol = generateMockLogVolume(DATA_POINTS, INTERVAL_MS);
      setLogSeries(
        Object.entries(logVol).map(([level, data]) => ({
          name: level,
          data,
        })),
      );

      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to fetch metrics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    if (!autoRefresh) return;
    const interval = setInterval(fetchMetrics, 10000);
    return () => clearInterval(interval);
  }, [fetchMetrics, autoRefresh]);

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
      chart: { ...baseChartOptions.chart, type: 'bar', stacked: true },
      plotOptions: { bar: { columnWidth: '60%', borderRadius: 2 } },
      yaxis: {
        ...baseChartOptions.yaxis,
        title: { text: 'Lines / interval', style: { color: '#999' } },
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
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="body2" color="text.secondary">
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
            value={summary?.totalMemoryPercent ?? 0}
            suffix="%"
            icon={<MetricsIcon />}
            color={
              (summary?.totalMemoryPercent ?? 0) > 80
                ? 'error'
                : (summary?.totalMemoryPercent ?? 0) > 60
                  ? 'warning'
                  : 'success'
            }
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
            value={summary?.logIngestionRate ?? 0}
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
          title="Log Volume"
          titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
          subheader="Log lines grouped by level"
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
