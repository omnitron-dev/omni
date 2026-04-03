/**
 * Dashboard Builder — Customizable monitoring dashboard for Omnitron
 *
 * Architecture-aware dashboard with panels tied to real daemon data:
 * - Stat panels: single metric from daemon status/list
 * - Chart panels: time-series CPU/memory from daemon polling
 * - App status panels: per-app health overview
 * - Alert panels: active alert summary
 * - Log panels: recent error/warning count
 *
 * Features:
 * - Multiple dashboards (localStorage persistence)
 * - Drag-to-reorder panels (via react-dnd or manual)
 * - Auto-refresh with configurable interval
 * - Add/remove panels with type-specific config
 * - Real data from daemon RPC (status, list, metrics)
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Grid from '@mui/material/Grid';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import Chip from '@mui/material/Chip';
import Skeleton from '@mui/material/Skeleton';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import LinearProgress from '@mui/material/LinearProgress';
import { alpha, useTheme } from '@mui/material/styles';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';

import {
  PlusIcon,
  CloseIcon,
  RefreshIcon,
} from 'src/assets/icons';
import { Breadcrumbs } from '@omnitron/prism';
import { daemon, alerts } from 'src/netron/client';
import { formatUptime, formatMemory } from 'src/utils/formatters';
import { STATUS_COLORS } from 'src/utils/constants';

import type { ProcessInfoDto, DaemonStatusDto } from '@omnitron-dev/omnitron/dto/services';

// =============================================================================
// Types
// =============================================================================

type PanelType = 'daemon-info' | 'app-grid' | 'cpu-chart' | 'memory-chart' | 'stat' | 'alert-summary' | 'recent-errors' | 'uptime-chart';

interface DashboardPanel {
  id: string;
  type: PanelType;
  title: string;
  size: 'small' | 'medium' | 'large' | 'full';
  config: Record<string, unknown>;
}

interface DashboardConfig {
  id: string;
  name: string;
  panels: DashboardPanel[];
  refreshInterval: number;
}

// =============================================================================
// Storage
// =============================================================================

const STORAGE_KEY = 'omnitron_dashboards_v2';

function loadDashboards(): DashboardConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveDashboards(configs: DashboardConfig[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
}

const SIZE_MAP: Record<string, Record<string, number>> = {
  small: { xs: 6, sm: 4, md: 3 },
  medium: { xs: 12, sm: 6, md: 4 },
  large: { xs: 12, md: 6 },
  full: { xs: 12 },
};

// =============================================================================
// Shared Data Context — single fetch, shared across all panels
// =============================================================================

interface DaemonData {
  status: DaemonStatusDto | null;
  apps: ProcessInfoDto[];
  loading: boolean;
  error: string | null;
}

function useDaemonData(refreshKey: number): DaemonData {
  const [data, setData] = useState<DaemonData>({ status: null, apps: [], loading: true, error: null });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [status, apps] = await Promise.all([
          daemon.status(),
          daemon.list(),
        ]);
        if (active) setData({ status, apps, loading: false, error: null });
      } catch (err: any) {
        if (active) setData((prev) => ({ ...prev, loading: false, error: err?.message ?? 'Failed to fetch' }));
      }
    })();
    return () => { active = false; };
  }, [refreshKey]);

  return data;
}

// =============================================================================
// Time-Series History — accumulates CPU/Memory snapshots over time
// =============================================================================

interface TimePoint {
  time: number;
  values: Record<string, number>;
}

function useTimeSeriesHistory(apps: ProcessInfoDto[], refreshKey: number, metric: 'cpu' | 'memory', maxPoints = 60) {
  const historyRef = useRef<TimePoint[]>([]);

  useEffect(() => {
    if (apps.length === 0) return;
    const now = Date.now();
    const values: Record<string, number> = {};
    for (const app of apps) {
      values[app.name] = metric === 'cpu' ? app.cpu : app.memory / (1024 * 1024);
    }
    historyRef.current.push({ time: now, values });
    if (historyRef.current.length > maxPoints) {
      historyRef.current = historyRef.current.slice(-maxPoints);
    }
  }, [apps, refreshKey, metric, maxPoints]);

  return historyRef.current;
}

// =============================================================================
// Panel Renderers
// =============================================================================

function DaemonInfoPanel({ data }: { data: DaemonData }) {
  const theme = useTheme();
  if (data.loading) return <Skeleton variant="rectangular" height={120} />;
  if (!data.status) return <Typography variant="body2" color="text.secondary">Daemon offline</Typography>;

  const { status } = data;
  const onlineApps = data.apps.filter((a) => a.status === 'online').length;

  const rows = [
    { label: 'PID', value: String(status.pid) },
    { label: 'Version', value: status.version },
    { label: 'Uptime', value: formatUptime(status.uptime) },
    { label: 'Memory', value: formatMemory(status.totalMemory) },
    { label: 'Apps', value: `${onlineApps} / ${data.apps.length}` },
  ];

  return (
    <Stack spacing={0.75}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: theme.palette.success.main }} />
        <Typography variant="caption" fontWeight={600} color="success.main">RUNNING</Typography>
      </Stack>
      {rows.map((r) => (
        <Stack key={r.label} direction="row" justifyContent="space-between">
          <Typography variant="caption" color="text.secondary">{r.label}</Typography>
          <Typography variant="caption" fontWeight={600}>{r.value}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function AppGridPanel({ data }: { data: DaemonData }) {
  const theme = useTheme();
  if (data.loading) return <Skeleton variant="rectangular" height={100} />;

  return (
    <Stack spacing={0.5}>
      {data.apps.map((app) => {
        const color =
          app.status === 'online' ? theme.palette.success.main
          : app.status === 'errored' || app.status === 'crashed' ? theme.palette.error.main
          : theme.palette.text.disabled;

        return (
          <Stack key={app.name} direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 0.5 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color }} />
              <Typography variant="body2" fontWeight={500}>{app.name}</Typography>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              {app.cpu > 0 && (
                <Typography variant="caption" color="text.secondary">{app.cpu.toFixed(1)}%</Typography>
              )}
              {app.memory > 0 && (
                <Typography variant="caption" color="text.secondary">{formatMemory(app.memory)}</Typography>
              )}
              <Chip
                label={app.status}
                size="small"
                sx={{
                  height: 18,
                  fontSize: '0.6rem',
                  fontWeight: 600,
                  bgcolor: alpha(color, 0.12),
                  color,
                }}
              />
            </Stack>
          </Stack>
        );
      })}
      {data.apps.length === 0 && (
        <Typography variant="caption" color="text.secondary">No applications configured</Typography>
      )}
    </Stack>
  );
}

function TimeSeriesChartPanel({
  data,
  refreshKey,
  metric,
}: {
  data: DaemonData;
  refreshKey: number;
  metric: 'cpu' | 'memory';
}) {
  const theme = useTheme();
  const history = useTimeSeriesHistory(data.apps, refreshKey, metric);

  const appNames = useMemo(() => data.apps.map((a) => a.name), [data.apps]);

  const series = useMemo(() => {
    return appNames.map((name) => ({
      name,
      data: history.map((pt) => ({
        x: pt.time,
        y: Math.round((pt.values[name] ?? 0) * 10) / 10,
      })),
    }));
  }, [appNames, history]);

  const options = useMemo<ApexOptions>(() => ({
    chart: { background: 'transparent', toolbar: { show: false }, animations: { enabled: true, easing: 'linear', dynamicAnimation: { speed: 1000 } } },
    theme: { mode: 'dark' },
    colors: ['#6366f1', '#22d3ee', '#f97316', '#a78bfa', '#22c55e'],
    grid: { borderColor: alpha(theme.palette.divider, 0.3), strokeDashArray: 3 },
    xaxis: { type: 'datetime', labels: { style: { colors: theme.palette.text.disabled, fontSize: '10px' }, datetimeFormatter: { hour: 'HH:mm', minute: 'HH:mm:ss' } }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: {
      labels: { style: { colors: theme.palette.text.disabled, fontSize: '10px' }, formatter: (val: number) => metric === 'memory' ? `${Math.round(val)}MB` : `${val.toFixed(1)}%` },
      min: 0,
    },
    stroke: { curve: 'smooth', width: 2 },
    fill: { type: 'gradient', gradient: { shadeIntensity: 0, opacityFrom: 0.3, opacityTo: 0.05 } },
    tooltip: { theme: 'dark', x: { format: 'HH:mm:ss' } },
    legend: { labels: { colors: theme.palette.text.secondary }, fontSize: '11px', position: 'bottom', offsetY: 4 },
  }), [theme, metric]);

  if (data.loading) return <Skeleton variant="rectangular" height={200} />;
  if (history.length < 2) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
        <Stack alignItems="center" spacing={1}>
          <Typography variant="caption" color="text.secondary">Collecting data...</Typography>
          <LinearProgress sx={{ width: 120 }} />
        </Stack>
      </Box>
    );
  }

  return <Chart type="area" height={200} options={options} series={series} />;
}

function StatPanel({ data, config }: { data: DaemonData; config: Record<string, unknown> }) {
  const theme = useTheme();
  const metric = (config.metric as string) ?? 'total_apps';

  if (data.loading) return <Skeleton width={80} height={50} />;

  let value: string | number = '--';
  let label = '';
  let color = theme.palette.primary.main;

  const onlineApps = data.apps.filter((a) => a.status === 'online').length;
  const totalCpu = data.status?.totalCpu ?? data.apps.reduce((s, a) => s + a.cpu, 0);
  const totalMem = data.status?.totalMemory ?? data.apps.reduce((s, a) => s + a.memory, 0);

  switch (metric) {
    case 'total_apps':
      value = data.apps.length;
      label = 'Total Apps';
      break;
    case 'online_apps':
      value = onlineApps;
      label = 'Online';
      color = onlineApps > 0 ? theme.palette.success.main : theme.palette.error.main;
      break;
    case 'errored_apps':
      value = data.apps.filter((a) => a.status === 'errored' || a.status === 'crashed').length;
      label = 'Errored';
      color = theme.palette.error.main;
      break;
    case 'total_cpu':
      value = `${totalCpu.toFixed(1)}%`;
      label = 'CPU';
      color = totalCpu > 80 ? theme.palette.error.main : totalCpu > 60 ? theme.palette.warning.main : theme.palette.success.main;
      break;
    case 'total_memory':
      value = formatMemory(totalMem);
      label = 'Memory';
      color = theme.palette.info.main;
      break;
    case 'uptime':
      value = data.status ? formatUptime(data.status.uptime) : '--';
      label = 'Uptime';
      color = theme.palette.success.main;
      break;
    case 'restarts':
      value = data.apps.reduce((s, a) => s + a.restarts, 0);
      label = 'Restarts';
      color = Number(value) > 0 ? theme.palette.warning.main : theme.palette.text.disabled;
      break;
  }

  return (
    <Box sx={{ textAlign: 'center', py: 1.5 }}>
      <Typography variant="h3" fontWeight={800} sx={{ color, lineHeight: 1.2 }}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary" fontWeight={600} textTransform="uppercase" letterSpacing={0.5}>
        {label}
      </Typography>
    </Box>
  );
}

function AlertSummaryPanel() {
  const theme = useTheme();
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await alerts.getSummary();
        setSummary(data);
      } catch {
        setSummary(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <Skeleton variant="rectangular" height={80} />;

  const items = [
    { label: 'Critical', count: summary?.bySeverity?.critical ?? 0, color: theme.palette.error.main },
    { label: 'Warning', count: summary?.bySeverity?.warning ?? 0, color: theme.palette.warning.main },
    { label: 'Info', count: summary?.bySeverity?.info ?? 0, color: theme.palette.info.main },
  ];

  return (
    <Stack spacing={1}>
      {items.map((item) => (
        <Stack key={item.label} direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 0.5, px: 1, borderRadius: 1, bgcolor: alpha(item.color, 0.06) }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: item.color }} />
            <Typography variant="body2" fontWeight={500}>{item.label}</Typography>
          </Stack>
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: item.color }}>{item.count}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function RecentErrorsPanel({ data }: { data: DaemonData }) {
  const theme = useTheme();
  const erroredApps = data.apps.filter((a) => a.status === 'errored' || a.status === 'crashed');
  const restartCount = data.apps.reduce((s, a) => s + a.restarts, 0);

  if (data.loading) return <Skeleton variant="rectangular" height={80} />;

  if (erroredApps.length === 0 && restartCount === 0) {
    return (
      <Box sx={{ py: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">No errors or restarts</Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={0.5}>
      {erroredApps.map((app) => (
        <Stack key={app.name} direction="row" alignItems="center" spacing={1} sx={{ py: 0.5, px: 1, borderRadius: 1, bgcolor: alpha(theme.palette.error.main, 0.06) }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: theme.palette.error.main }} />
          <Typography variant="caption" fontWeight={600}>{app.name}</Typography>
          <Typography variant="caption" color="text.secondary">{app.status}</Typography>
        </Stack>
      ))}
      {restartCount > 0 && (
        <Typography variant="caption" color="warning.main" sx={{ pt: 0.5 }}>
          {restartCount} total restart{restartCount !== 1 ? 's' : ''} across all apps
        </Typography>
      )}
    </Stack>
  );
}

// =============================================================================
// Panel Renderer (dispatch)
// =============================================================================

function PanelRenderer({ panel, data, refreshKey }: { panel: DashboardPanel; data: DaemonData; refreshKey: number }) {
  switch (panel.type) {
    case 'daemon-info': return <DaemonInfoPanel data={data} />;
    case 'app-grid': return <AppGridPanel data={data} />;
    case 'cpu-chart': return <TimeSeriesChartPanel data={data} refreshKey={refreshKey} metric="cpu" />;
    case 'memory-chart': return <TimeSeriesChartPanel data={data} refreshKey={refreshKey} metric="memory" />;
    case 'stat': return <StatPanel data={data} config={panel.config} />;
    case 'alert-summary': return <AlertSummaryPanel />;
    case 'recent-errors': return <RecentErrorsPanel data={data} />;
    default: return <Typography variant="body2" color="text.secondary">Unknown panel type</Typography>;
  }
}

// =============================================================================
// Panel Types Registry
// =============================================================================

const PANEL_TYPES: Array<{ value: PanelType; label: string; description: string; defaultSize: DashboardPanel['size'] }> = [
  { value: 'stat', label: 'Stat', description: 'Single metric value', defaultSize: 'small' },
  { value: 'daemon-info', label: 'Daemon Info', description: 'Daemon process information', defaultSize: 'medium' },
  { value: 'app-grid', label: 'App Status', description: 'Application status list', defaultSize: 'large' },
  { value: 'cpu-chart', label: 'CPU Chart', description: 'Per-app CPU usage over time', defaultSize: 'large' },
  { value: 'memory-chart', label: 'Memory Chart', description: 'Per-app memory usage over time', defaultSize: 'large' },
  { value: 'alert-summary', label: 'Alerts', description: 'Active alerts by severity', defaultSize: 'medium' },
  { value: 'recent-errors', label: 'Errors', description: 'Recent errors and restarts', defaultSize: 'medium' },
];

const STAT_METRICS = [
  { value: 'total_apps', label: 'Total Apps' },
  { value: 'online_apps', label: 'Online Apps' },
  { value: 'errored_apps', label: 'Errored Apps' },
  { value: 'total_cpu', label: 'Total CPU' },
  { value: 'total_memory', label: 'Total Memory' },
  { value: 'uptime', label: 'Daemon Uptime' },
  { value: 'restarts', label: 'Total Restarts' },
];

// =============================================================================
// Default Dashboard
// =============================================================================

function createDefaultDashboard(): DashboardConfig {
  return {
    id: crypto.randomUUID(),
    name: 'Overview',
    panels: [
      { id: crypto.randomUUID(), type: 'stat', title: 'Online', size: 'small', config: { metric: 'online_apps' } },
      { id: crypto.randomUUID(), type: 'stat', title: 'Errored', size: 'small', config: { metric: 'errored_apps' } },
      { id: crypto.randomUUID(), type: 'stat', title: 'CPU', size: 'small', config: { metric: 'total_cpu' } },
      { id: crypto.randomUUID(), type: 'stat', title: 'Memory', size: 'small', config: { metric: 'total_memory' } },
      { id: crypto.randomUUID(), type: 'cpu-chart', title: 'CPU Usage', size: 'large', config: {} },
      { id: crypto.randomUUID(), type: 'memory-chart', title: 'Memory Usage', size: 'large', config: {} },
      { id: crypto.randomUUID(), type: 'app-grid', title: 'Applications', size: 'large', config: {} },
      { id: crypto.randomUUID(), type: 'daemon-info', title: 'Daemon', size: 'medium', config: {} },
      { id: crypto.randomUUID(), type: 'recent-errors', title: 'Errors & Restarts', size: 'medium', config: {} },
    ],
    refreshInterval: 5_000,
  };
}

// =============================================================================
// Add Panel Dialog
// =============================================================================

function AddPanelDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (panel: DashboardPanel) => void }) {
  const [type, setType] = useState<PanelType>('stat');
  const [title, setTitle] = useState('');
  const [metric, setMetric] = useState('online_apps');
  const [size, setSize] = useState<DashboardPanel['size']>('small');

  useEffect(() => {
    const pt = PANEL_TYPES.find((p) => p.value === type);
    if (pt) setSize(pt.defaultSize);
  }, [type]);

  const handleAdd = () => {
    const config: Record<string, unknown> = {};
    if (type === 'stat') config.metric = metric;

    onAdd({
      id: crypto.randomUUID(),
      type,
      title: title || PANEL_TYPES.find((p) => p.value === type)?.label || 'Panel',
      size,
      config,
    });
    setTitle('');
    setType('stat');
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Add Panel</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          <TextField select label="Panel Type" value={type} onChange={(e) => setType(e.target.value as PanelType)} size="small" fullWidth>
            {PANEL_TYPES.map((pt) => (
              <MenuItem key={pt.value} value={pt.value}>
                <Stack>
                  <Typography variant="body2" fontWeight={600}>{pt.label}</Typography>
                  <Typography variant="caption" color="text.secondary">{pt.description}</Typography>
                </Stack>
              </MenuItem>
            ))}
          </TextField>
          <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} size="small" fullWidth placeholder="Optional custom title" />
          {type === 'stat' && (
            <TextField select label="Metric" value={metric} onChange={(e) => setMetric(e.target.value)} size="small" fullWidth>
              {STAT_METRICS.map((m) => (
                <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
              ))}
            </TextField>
          )}
          <TextField select label="Size" value={size} onChange={(e) => setSize(e.target.value as any)} size="small" fullWidth>
            <MenuItem value="small">Small (1/4 width)</MenuItem>
            <MenuItem value="medium">Medium (1/3 width)</MenuItem>
            <MenuItem value="large">Large (1/2 width)</MenuItem>
            <MenuItem value="full">Full width</MenuItem>
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small">Cancel</Button>
        <Button variant="contained" onClick={handleAdd} size="small">Add</Button>
      </DialogActions>
    </Dialog>
  );
}

// =============================================================================
// Dashboard Builder Page
// =============================================================================

export default function DashboardBuilderPage() {
  const theme = useTheme();
  const [dashboards, setDashboards] = useState<DashboardConfig[]>(() => loadDashboards());
  const [activeDashboard, setActiveDashboard] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Initialize with default dashboard if none exist
  useEffect(() => {
    if (dashboards.length === 0) {
      const defaultDash = createDefaultDashboard();
      setDashboards([defaultDash]);
      setActiveDashboard(defaultDash.id);
      saveDashboards([defaultDash]);
    } else if (!activeDashboard) {
      setActiveDashboard(dashboards[0]!.id);
    }
  }, [dashboards, activeDashboard]);

  const currentDashboard = dashboards.find((d) => d.id === activeDashboard);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh || !currentDashboard) return;
    const interval = setInterval(() => setRefreshKey((k) => k + 1), currentDashboard.refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, currentDashboard]);

  // Shared data — single fetch for all panels
  const data = useDaemonData(refreshKey);

  const updateDashboard = useCallback((updater: (d: DashboardConfig) => DashboardConfig) => {
    setDashboards((prev) => {
      const updated = prev.map((d) => d.id === activeDashboard ? updater(d) : d);
      saveDashboards(updated);
      return updated;
    });
  }, [activeDashboard]);

  const handleAddPanel = (panel: DashboardPanel) => {
    updateDashboard((d) => ({ ...d, panels: [...d.panels, panel] }));
  };

  const handleRemovePanel = (panelId: string) => {
    updateDashboard((d) => ({ ...d, panels: d.panels.filter((p) => p.id !== panelId) }));
  };

  const handleCreateDashboard = () => {
    const newDash: DashboardConfig = {
      id: crypto.randomUUID(),
      name: `Dashboard ${dashboards.length + 1}`,
      panels: [],
      refreshInterval: 5_000,
    };
    const updated = [...dashboards, newDash];
    setDashboards(updated);
    setActiveDashboard(newDash.id);
    saveDashboards(updated);
  };

  const handleDeleteDashboard = () => {
    if (!activeDashboard || dashboards.length <= 1) return;
    const updated = dashboards.filter((d) => d.id !== activeDashboard);
    setDashboards(updated);
    setActiveDashboard(updated[0]?.id ?? null);
    saveDashboards(updated);
  };

  return (
    <Stack spacing={2.5}>
      {/* Header */}
      <Breadcrumbs
        links={[{ name: 'Dashboard Builder' }]}
        action={
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="caption" color="text.secondary">Auto-refresh</Typography>
            <Switch size="small" checked={autoRefresh} onChange={(_, checked) => setAutoRefresh(checked)} />
            <Tooltip title="Refresh now">
              <IconButton size="small" onClick={() => setRefreshKey((k) => k + 1)}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        }
      />

      {/* Dashboard Tabs */}
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        {dashboards.map((d) => (
          <Chip
            key={d.id}
            label={d.name}
            onClick={() => setActiveDashboard(d.id)}
            color={d.id === activeDashboard ? 'primary' : 'default'}
            variant={d.id === activeDashboard ? 'filled' : 'outlined'}
            size="small"
          />
        ))}
        {dashboards.length > 1 && (
          <Button size="small" color="error" onClick={handleDeleteDashboard} sx={{ textTransform: 'none', fontSize: '0.75rem' }}>
            Delete
          </Button>
        )}
        <Button size="small" startIcon={<PlusIcon />} onClick={handleCreateDashboard} sx={{ textTransform: 'none', fontSize: '0.75rem' }}>
          New
        </Button>
      </Stack>

      {/* Panels Grid */}
      {currentDashboard && (
        <Grid container spacing={2.5}>
          {currentDashboard.panels.map((panel) => (
            <Grid key={panel.id} size={SIZE_MAP[panel.size] ?? SIZE_MAP.medium}>
              <Card
                variant="outlined"
                sx={{
                  height: '100%',
                  borderRadius: 2,
                  transition: 'box-shadow 0.2s',
                  '&:hover': { boxShadow: `0 0 0 1px ${alpha(theme.palette.primary.main, 0.2)}` },
                }}
              >
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, pt: 1.5, pb: 0 }}>
                  <Typography variant="caption" fontWeight={700} color="text.secondary" textTransform="uppercase" letterSpacing={0.5}>
                    {panel.title}
                  </Typography>
                  <IconButton size="small" onClick={() => handleRemovePanel(panel.id)} sx={{ opacity: 0.4, '&:hover': { opacity: 1 } }}>
                    <CloseIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Stack>
                <CardContent sx={{ pt: 1, pb: 2, '&:last-child': { pb: 2 } }}>
                  <PanelRenderer panel={panel} data={data} refreshKey={refreshKey} />
                </CardContent>
              </Card>
            </Grid>
          ))}

          {/* Add Panel */}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card
              variant="outlined"
              sx={{
                height: '100%',
                minHeight: 120,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                borderStyle: 'dashed',
                borderRadius: 2,
                transition: 'all 0.2s',
                '&:hover': { bgcolor: 'action.hover', borderColor: 'primary.main' },
              }}
              onClick={() => setAddDialogOpen(true)}
            >
              <Stack alignItems="center" spacing={0.5}>
                <PlusIcon sx={{ fontSize: 20, color: 'text.disabled' }} />
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  Add Panel
                </Typography>
              </Stack>
            </Card>
          </Grid>
        </Grid>
      )}

      <AddPanelDialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} onAdd={handleAddPanel} />
    </Stack>
  );
}
