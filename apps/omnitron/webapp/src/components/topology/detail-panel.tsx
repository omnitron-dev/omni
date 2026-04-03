/**
 * DetailPanel — Right-side drawer showing node details, metrics, config, and actions.
 * Slides in when a node is selected in the topology view.
 */

import { useState, useCallback, useEffect } from 'react';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Skeleton from '@mui/material/Skeleton';
import { alpha } from '@mui/material/styles';

import {
  CloseIcon,
  PlayIcon,
  StopIcon,
  RestartIcon,
  LogsIcon,
} from 'src/assets/icons';
import { useTopologyStore } from './topology-store';
import { getStatusColor, miniBarSx } from './shared-styles';
import { formatUptime, formatMemory, formatTimestamp } from 'src/utils/formatters';
import { daemon, logs } from 'src/netron/client';
import type { AppNodeData, InfraNodeData, GatewayNodeData, ServerNodeData } from './topology-store';
import type { LogEntryRow } from '@omnitron-dev/omnitron/dto/services';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DRAWER_WIDTH = 400;

const LEVEL_COLORS: Record<string, string> = {
  fatal: '#dc2626',
  error: '#ef4444',
  warn: '#f59e0b',
  info: '#3b82f6',
  debug: '#6b7280',
  trace: '#9ca3af',
};

// ---------------------------------------------------------------------------
// Tab Panel
// ---------------------------------------------------------------------------

function TabPanel({ value, index, children }: { value: number; index: number; children: React.ReactNode }) {
  return value === index ? <Box sx={{ py: 2 }}>{children}</Box> : null;
}

// ---------------------------------------------------------------------------
// Overview for App
// ---------------------------------------------------------------------------

function AppOverview({ data }: { data: AppNodeData }) {
  const { restartApp, stopApp, startApp } = useTopologyStore();
  const statusColor = getStatusColor(data.status);
  const isOnline = data.status === 'online';
  const isStopped = data.status === 'stopped' || data.status === 'crashed' || data.status === 'errored';

  return (
    <Stack spacing={2}>
      {/* Actions */}
      <Stack direction="row" spacing={1}>
        {isStopped ? (
          <Button
            variant="contained"
            size="small"
            color="success"
            startIcon={<PlayIcon />}
            onClick={() => startApp(data.name)}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Start
          </Button>
        ) : (
          <>
            <Button
              variant="outlined"
              size="small"
              color="warning"
              startIcon={<RestartIcon />}
              onClick={() => restartApp(data.name)}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Restart
            </Button>
            <Button
              variant="outlined"
              size="small"
              color="error"
              startIcon={<StopIcon />}
              onClick={() => stopApp(data.name)}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Stop
            </Button>
          </>
        )}
      </Stack>

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />

      {/* Info rows */}
      <InfoRow label="Status">
        <Chip
          label={data.status}
          size="small"
          sx={{
            height: 22,
            fontSize: 11,
            fontWeight: 600,
            bgcolor: `${statusColor}18`,
            color: statusColor,
            border: `1px solid ${statusColor}33`,
            textTransform: 'capitalize',
          }}
        />
      </InfoRow>
      <InfoRow label="PID">{data.pid ?? '--'}</InfoRow>
      <InfoRow label="Port">{data.port ?? '--'}</InfoRow>
      <InfoRow label="Instances">{data.instances}</InfoRow>
      <InfoRow label="Uptime">{formatUptime(data.uptime)}</InfoRow>
      <InfoRow label="Restarts">{data.restarts}</InfoRow>

      {isOnline && (
        <>
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />

          <Stack spacing={1}>
            <Typography variant="caption" sx={{ fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Resources
            </Typography>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="caption" sx={{ fontSize: 12, color: '#94a3b8', width: 60 }}>CPU</Typography>
              <Box sx={{ flex: 1, ...miniBarSx(data.cpu, data.cpu > 80 ? '#ef4444' : '#22c55e', 6) }} />
              <Typography variant="caption" sx={{ fontSize: 12, color: '#e2e8f0', width: 50, textAlign: 'right' }}>
                {data.cpu.toFixed(1)}%
              </Typography>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="caption" sx={{ fontSize: 12, color: '#94a3b8', width: 60 }}>Memory</Typography>
              <Box sx={{ flex: 1, ...miniBarSx(Math.min(100, (data.memory / (512 * 1024 * 1024)) * 100), '#3b82f6', 6) }} />
              <Typography variant="caption" sx={{ fontSize: 12, color: '#e2e8f0', width: 50, textAlign: 'right' }}>
                {formatMemory(data.memory)}
              </Typography>
            </Stack>
          </Stack>
        </>
      )}

      {/* Sub-processes */}
      {data.processes && data.processes.length > 0 && (
        <>
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />
          <Typography variant="caption" sx={{ fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Process Topology
          </Typography>
          {data.processes.map((proc) => {
            const pc = getStatusColor(proc.status);
            return (
              <Stack key={proc.name} direction="row" alignItems="center" spacing={1}>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: pc, flexShrink: 0 }} />
                <Typography variant="body2" sx={{ flex: 1, fontSize: 13 }}>{proc.name}</Typography>
                <Chip
                  label={proc.type}
                  size="small"
                  sx={{ height: 20, fontSize: 10, bgcolor: 'rgba(255,255,255,0.06)', color: '#94a3b8' }}
                />
                {proc.pid && (
                  <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: 11, color: '#64748b' }}>
                    {proc.pid}
                  </Typography>
                )}
              </Stack>
            );
          })}
        </>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Overview for Infra
// ---------------------------------------------------------------------------

function InfraOverview({ data }: { data: InfraNodeData }) {
  const statusColor = getStatusColor(data.health === 'none' ? data.status : data.health);
  return (
    <Stack spacing={2}>
      <InfoRow label="Service">{data.service}</InfoRow>
      <InfoRow label="Port">{data.port}</InfoRow>
      <InfoRow label="Status">
        <Chip
          label={data.status}
          size="small"
          sx={{
            height: 22, fontSize: 11, fontWeight: 600,
            bgcolor: `${statusColor}18`, color: statusColor,
            border: `1px solid ${statusColor}33`, textTransform: 'capitalize',
          }}
        />
      </InfoRow>
      <InfoRow label="Health">{data.health}</InfoRow>
      {data.containerId && <InfoRow label="Container">{data.containerId.slice(0, 12)}</InfoRow>}
      {data.image && <InfoRow label="Image">{data.image}</InfoRow>}
      {data.startedAt && <InfoRow label="Started">{formatTimestamp(data.startedAt)}</InfoRow>}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Overview for Gateway
// ---------------------------------------------------------------------------

function GatewayOverview({ data }: { data: GatewayNodeData }) {
  const statusColor = getStatusColor(data.health === 'none' ? data.status : data.health);
  return (
    <Stack spacing={2}>
      <InfoRow label="Port">{data.port}</InfoRow>
      <InfoRow label="Status">
        <Chip
          label={data.status}
          size="small"
          sx={{
            height: 22, fontSize: 11, fontWeight: 600,
            bgcolor: `${statusColor}18`, color: statusColor,
            border: `1px solid ${statusColor}33`, textTransform: 'capitalize',
          }}
        />
      </InfoRow>
      <InfoRow label="Tor">{data.hasTor ? 'Active' : 'Disabled'}</InfoRow>
      <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />
      <Typography variant="caption" sx={{ fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Routes ({data.routes.length})
      </Typography>
      {data.routes.map((r) => (
        <Stack key={r.path} direction="row" spacing={1}>
          <Typography variant="caption" sx={{ fontFamily: 'monospace', color: '#60a5fa', fontSize: 12 }}>{r.path}</Typography>
          <Typography variant="caption" sx={{ fontFamily: 'monospace', color: '#64748b', fontSize: 12 }}>{r.target}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Overview for Server
// ---------------------------------------------------------------------------

function ServerOverview({ data }: { data: ServerNodeData }) {
  const statusColor = getStatusColor(data.status);
  return (
    <Stack spacing={2}>
      <InfoRow label="Hostname">{data.hostname}</InfoRow>
      <InfoRow label="Address">{data.address}</InfoRow>
      <InfoRow label="Role">
        <Chip
          label={data.role}
          size="small"
          sx={{ height: 22, fontSize: 11, fontWeight: 600, bgcolor: 'rgba(255,255,255,0.06)', color: '#cbd5e1', textTransform: 'capitalize' }}
        />
      </InfoRow>
      <InfoRow label="Status">
        <Chip
          label={data.status}
          size="small"
          sx={{
            height: 22, fontSize: 11, fontWeight: 600,
            bgcolor: `${statusColor}18`, color: statusColor,
            border: `1px solid ${statusColor}33`, textTransform: 'capitalize',
          }}
        />
      </InfoRow>
      {data.apps.length > 0 && (
        <>
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />
          <Typography variant="caption" sx={{ fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Applications
          </Typography>
          <Stack direction="row" flexWrap="wrap" gap={0.5}>
            {data.apps.map((a) => (
              <Chip key={a} label={a} size="small" sx={{ height: 22, fontSize: 11, bgcolor: 'rgba(255,255,255,0.06)', color: '#cbd5e1' }} />
            ))}
          </Stack>
        </>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Logs Tab
// ---------------------------------------------------------------------------

function LogsTab({ appName }: { appName?: string }) {
  const [logs, setLogs] = useState<LogEntryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    try {
      const result = await logs.streamLogs({ app: appName, tail: 30 });
      setLogs(result);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [appName]);

  useEffect(() => {
    fetchLogs();
    const iv = setInterval(fetchLogs, 5000);
    return () => clearInterval(iv);
  }, [fetchLogs]);

  if (loading) {
    return (
      <Stack spacing={0.5}>
        {[...Array(8)].map((_, i) => <Skeleton key={i} height={18} sx={{ bgcolor: 'rgba(255,255,255,0.04)' }} />)}
      </Stack>
    );
  }

  if (logs.length === 0) {
    return <Typography variant="body2" color="text.secondary">No recent logs.</Typography>;
  }

  return (
    <Stack
      spacing={0}
      sx={{
        fontFamily: 'monospace',
        fontSize: 11,
        maxHeight: 400,
        overflow: 'auto',
        bgcolor: 'rgba(0,0,0,0.3)',
        borderRadius: 1,
        p: 1,
      }}
    >
      {logs.map((log) => (
        <Stack
          key={log.id}
          direction="row"
          spacing={0.75}
          sx={{
            py: 0.25,
            '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' },
          }}
        >
          <Typography
            component="span"
            sx={{ fontSize: 10, color: '#475569', flexShrink: 0 }}
          >
            {formatTimestamp(log.timestamp)}
          </Typography>
          <Typography
            component="span"
            sx={{ fontSize: 10, color: LEVEL_COLORS[log.level] ?? '#6b7280', fontWeight: 600, flexShrink: 0, width: 36 }}
          >
            {log.level.toUpperCase()}
          </Typography>
          <Typography
            component="span"
            sx={{ fontSize: 11, color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {log.message}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Config Tab
// ---------------------------------------------------------------------------

function ConfigTab({ appName }: { appName: string }) {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    daemon.inspect({ name: appName })
      .then((diag) => setConfig(diag.config ?? {}))
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, [appName]);

  if (loading) {
    return <Skeleton variant="rectangular" height={120} sx={{ borderRadius: 1, bgcolor: 'rgba(255,255,255,0.04)' }} />;
  }

  if (!config) {
    return <Typography variant="body2" color="text.secondary">Could not load configuration.</Typography>;
  }

  return (
    <Box
      component="pre"
      sx={{
        fontFamily: 'monospace',
        fontSize: 11,
        color: '#cbd5e1',
        bgcolor: 'rgba(0,0,0,0.3)',
        borderRadius: 1,
        p: 1.5,
        overflow: 'auto',
        maxHeight: 400,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {JSON.stringify(config, null, 2)}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Metrics Tab — Mini CPU/Memory sparkline charts (last 5 min)
// ---------------------------------------------------------------------------

interface MetricSample {
  ts: number;
  value: number;
}

function MetricsTab({ appName, cpu, memory }: { appName?: string; cpu?: number; memory?: number }) {
  const [cpuHistory, setCpuHistory] = useState<MetricSample[]>([]);
  const [memHistory, setMemHistory] = useState<MetricSample[]>([]);

  // Accumulate samples every 5s (auto-refresh from parent drives re-renders)
  useEffect(() => {
    const now = Date.now();
    const cutoff = now - 5 * 60 * 1000; // 5 min window

    if (cpu !== undefined) {
      setCpuHistory((prev) => [...prev.filter((s) => s.ts > cutoff), { ts: now, value: cpu }]);
    }
    if (memory !== undefined) {
      setMemHistory((prev) => [...prev.filter((s) => s.ts > cutoff), { ts: now, value: memory }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpu, memory]);

  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="caption" sx={{ fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            CPU Usage
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: 'monospace', color: '#e2e8f0', fontSize: 12 }}>
            {cpu !== undefined ? `${cpu.toFixed(1)}%` : '--'}
          </Typography>
        </Stack>
        <MiniSparkline data={cpuHistory} maxValue={100} color="#22c55e" warnColor="#f59e0b" dangerColor="#ef4444" />
      </Stack>

      <Stack spacing={1}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="caption" sx={{ fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Memory Usage
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: 'monospace', color: '#e2e8f0', fontSize: 12 }}>
            {memory !== undefined ? formatMemory(memory) : '--'}
          </Typography>
        </Stack>
        <MiniSparkline
          data={memHistory.map((s) => ({ ...s, value: s.value / (1024 * 1024) }))}
          maxValue={512}
          color="#3b82f6"
          warnColor="#f59e0b"
          dangerColor="#ef4444"
          formatValue={(v) => `${v.toFixed(0)}MB`}
        />
      </Stack>

      {cpuHistory.length < 3 && (
        <Typography variant="caption" sx={{ color: '#475569', textAlign: 'center', pt: 1 }}>
          Collecting samples... metrics will populate over the next few seconds.
        </Typography>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Mini Sparkline — SVG-based sparkline chart
// ---------------------------------------------------------------------------

function MiniSparkline({
  data,
  maxValue,
  color,
  warnColor,
  dangerColor,
  formatValue,
}: {
  data: MetricSample[];
  maxValue: number;
  color: string;
  warnColor: string;
  dangerColor: string;
  formatValue?: (v: number) => string;
}) {
  const width = 340;
  const height = 60;
  const padY = 4;

  if (data.length < 2) {
    return (
      <Box sx={{ width: '100%', height, bgcolor: 'rgba(0,0,0,0.2)', borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="caption" sx={{ color: '#334155', fontSize: 10 }}>Waiting for data...</Typography>
      </Box>
    );
  }

  const minTs = data[0]!.ts;
  const maxTs = data[data.length - 1]!.ts;
  const tRange = Math.max(maxTs - minTs, 1);

  const points = data.map((s) => {
    const x = ((s.ts - minTs) / tRange) * width;
    const y = height - padY - ((Math.min(s.value, maxValue) / maxValue) * (height - padY * 2));
    return `${x},${y}`;
  });

  const lastVal = data[data.length - 1]!.value;
  const lineColor = lastVal > maxValue * 0.8 ? dangerColor : lastVal > maxValue * 0.5 ? warnColor : color;

  const areaPoints = `0,${height} ${points.join(' ')} ${width},${height}`;

  return (
    <Box sx={{ width: '100%', bgcolor: 'rgba(0,0,0,0.2)', borderRadius: 1, overflow: 'hidden' }}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map((pct) => (
          <line
            key={pct}
            x1={0}
            y1={height - padY - pct * (height - padY * 2)}
            x2={width}
            y2={height - padY - pct * (height - padY * 2)}
            stroke="rgba(255,255,255,0.04)"
            strokeWidth={1}
          />
        ))}
        {/* Area fill */}
        <polygon points={areaPoints} fill={lineColor} fillOpacity={0.08} />
        {/* Line */}
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke={lineColor}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Current value dot */}
        {data.length > 0 && (
          <circle
            cx={width}
            cy={height - padY - ((Math.min(lastVal, maxValue) / maxValue) * (height - padY * 2))}
            r={3}
            fill={lineColor}
          />
        )}
      </svg>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Detail Panel
// ---------------------------------------------------------------------------

export function DetailPanel() {
  const { detailPanel, closeDetail } = useTopologyStore();
  const [tab, setTab] = useState(0);

  // Reset tab when panel changes
  useEffect(() => {
    setTab(0);
  }, [detailPanel.nodeId]);

  const { open, nodeType, data } = detailPanel;
  if (!data) return null;

  const isApp = nodeType === 'app';
  const appName = isApp ? (data as AppNodeData).name : undefined;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={closeDetail}
      variant="persistent"
      sx={{
        width: open ? DRAWER_WIDTH : 0,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: DRAWER_WIDTH,
          bgcolor: '#0c0c14',
          borderLeft: '1px solid rgba(255,255,255,0.06)',
          color: '#e2e8f0',
          pt: 0,
        },
      }}
    >
      {/* Header */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{
          px: 2.5,
          py: 2,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          bgcolor: 'rgba(0,0,0,0.2)',
        }}
      >
        <Stack spacing={0.25}>
          <Typography variant="h6" fontWeight={700} sx={{ fontSize: 16 }}>
            {data.label}
          </Typography>
          <Typography variant="caption" sx={{ color: '#64748b', textTransform: 'capitalize' }}>
            {nodeType} node
          </Typography>
        </Stack>
        <IconButton size="small" onClick={closeDetail} sx={{ color: '#94a3b8' }}>
          <CloseIcon />
        </IconButton>
      </Stack>

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="fullWidth"
        sx={{
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          minHeight: 40,
          '& .MuiTab-root': {
            color: '#64748b',
            fontSize: 12,
            fontWeight: 600,
            minHeight: 40,
            textTransform: 'none',
            '&.Mui-selected': { color: '#e2e8f0' },
          },
          '& .MuiTabs-indicator': { bgcolor: '#818cf8' },
        }}
      >
        <Tab label="Overview" />
        {isApp && <Tab label="Config" />}
        {isApp && <Tab label="Metrics" />}
        <Tab label="Logs" />
      </Tabs>

      {/* Tab Content */}
      <Box sx={{ px: 2.5, overflow: 'auto', flex: 1 }}>
        <TabPanel value={tab} index={0}>
          {nodeType === 'app' && <AppOverview data={data as AppNodeData} />}
          {nodeType === 'infra' && <InfraOverview data={data as InfraNodeData} />}
          {nodeType === 'gateway' && <GatewayOverview data={data as GatewayNodeData} />}
          {nodeType === 'server' && <ServerOverview data={data as ServerNodeData} />}
        </TabPanel>

        {isApp && (
          <TabPanel value={tab} index={1}>
            <ConfigTab appName={appName!} />
          </TabPanel>
        )}

        {isApp && (
          <TabPanel value={tab} index={2}>
            <MetricsTab
              appName={appName}
              cpu={(data as AppNodeData).cpu}
              memory={(data as AppNodeData).memory}
            />
          </TabPanel>
        )}

        <TabPanel value={tab} index={isApp ? 3 : 1}>
          <LogsTab appName={appName} />
        </TabPanel>
      </Box>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between">
      <Typography variant="caption" sx={{ color: '#64748b', fontSize: 12 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontSize: 13, fontFamily: typeof children === 'string' || typeof children === 'number' ? 'monospace' : undefined }}>
        {children}
      </Typography>
    </Stack>
  );
}
