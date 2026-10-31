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
import { Tabs } from '@omnitron-dev/prism/components/tabs';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme, alpha } from '@mui/material/styles';
import { useAccess } from 'src/auth/access';
import { MetricChart } from 'src/components/metric-chart';
import { metricLines, formatBytes, formatCpu } from 'src/utils/metric-series';

import { CloseIcon, PlayIcon, StopIcon, RestartIcon } from 'src/assets/icons';
import { serviceState, useTopologyStore } from './topology-store';
import { getStatusColor } from './shared-styles';
import { formatUptime, formatTimestamp } from 'src/utils/formatters';
import { daemon, logs, metrics } from 'src/netron/client';
import { usePolledResource, usePollingEffect } from 'src/hooks/use-polled-resource';
import type { AppNodeData, InfraNodeData, GatewayNodeData, ServerNodeData } from './topology-store';
import type { LogEntryRow } from '@omnitron-dev/omnitron/dto/services';
import { Skeleton } from '@omnitron-dev/prism/components/skeleton';

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
// Overview for App
// ---------------------------------------------------------------------------

/** Start, restart, stop: a local app's. A remote app is its node's, and this daemon has no handle for it. */
function AppActions({ data }: { data: AppNodeData }) {
  const { restartApp, stopApp, startApp } = useTopologyStore();
  const { can } = useAccess();
  if (data.remote) {
    return (
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        Runs on the {data.stack} stack&apos;s node — start and stop it with the stack.
      </Typography>
    );
  }
  const isStopped = data.status === 'stopped' || data.status === 'crashed' || data.status === 'errored';
  return (
    <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
      {isStopped ? (
        <Button
          variant="contained"
          size="small"
          color="success"
          startIcon={<PlayIcon />}
          disabled={!can('OmnitronDaemon.startApp')}
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
            disabled={!can('OmnitronDaemon.restartApp')}
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
            disabled={!can('OmnitronDaemon.stopApp')}
            onClick={() => stopApp(data.name)}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Stop
          </Button>
        </>
      )}
    </Stack>
  );
}

function AppOverview({ data }: { data: AppNodeData }) {
  const theme = useTheme();
  const statusColor = getStatusColor(data.status, theme);
  const isOnline = data.status === 'online';

  return (
    <Stack spacing={2}>
      <AppActions data={data} />
      <Divider sx={{ borderColor: 'divider' }} />
      {/* Info rows */}
      <InfoRow label="Status">
        <Chip
          label={data.status}
          size="small"
          sx={{
            height: 22,
            fontSize: 11,
            fontWeight: 600,
            bgcolor: alpha(statusColor, 0.1),
            color: statusColor,
            border: `1px solid ${alpha(statusColor, 0.2)}`,
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
          <Divider sx={{ borderColor: 'divider' }} />

          <InfoRow label="CPU">{formatCpu(data.cpu)}</InfoRow>
          <InfoRow label="Resident memory">{formatBytes(data.memory)}</InfoRow>
          <Typography variant="caption" color="text.secondary">
            Process CPU can exceed 100%. No memory capacity limit is inferred.
          </Typography>
        </>
      )}
      {/* Sub-processes */}
      {data.processes && data.processes.length > 0 && (
        <>
          <Divider sx={{ borderColor: 'divider' }} />
          <Typography
            variant="caption"
            sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}
          >
            Process Topology
          </Typography>
          {data.processes.map((proc) => {
            const pc = getStatusColor(proc.status, theme);
            return (
              <Stack
                key={proc.name}
                direction="row"
                spacing={1}
                sx={{
                  alignItems: 'center',
                }}
              >
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: pc, flexShrink: 0 }} />
                <Typography variant="body2" sx={{ flex: 1, fontSize: 13 }}>
                  {proc.name}
                </Typography>
                <Chip
                  label={proc.type}
                  size="small"
                  sx={{ height: 20, fontSize: 10, bgcolor: 'action.hover', color: 'text.secondary' }}
                />
                {proc.pid && (
                  <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: 11, color: 'text.secondary' }}>
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
  const theme = useTheme();
  const statusColor = getStatusColor(serviceState(data), theme);
  return (
    <Stack spacing={2}>
      <InfoRow label="Service">{data.service}</InfoRow>
      <InfoRow label="For">{data.app ?? `the ${data.stack ?? 'daemon'} stack`}</InfoRow>
      <InfoRow label="Port">{data.port ?? '—'}</InfoRow>
      <InfoRow label="Status">
        <Chip
          label={data.status}
          size="small"
          sx={{
            height: 22,
            fontSize: 11,
            fontWeight: 600,
            bgcolor: alpha(statusColor, 0.1),
            color: statusColor,
            border: `1px solid ${alpha(statusColor, 0.2)}`,
            textTransform: 'capitalize',
          }}
        />
      </InfoRow>
      <InfoRow label="Health">{data.health === 'unknown' ? 'not inspected — on its node' : data.health}</InfoRow>
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
  const theme = useTheme();
  const statusColor = getStatusColor(serviceState(data), theme);
  return (
    <Stack spacing={2}>
      <InfoRow label="Port">{data.port ?? '—'}</InfoRow>
      <InfoRow label="Status">
        <Chip
          label={data.status}
          size="small"
          sx={{
            height: 22,
            fontSize: 11,
            fontWeight: 600,
            bgcolor: alpha(statusColor, 0.1),
            color: statusColor,
            border: `1px solid ${alpha(statusColor, 0.2)}`,
            textTransform: 'capitalize',
          }}
        />
      </InfoRow>
      <InfoRow label="Tor">{data.hasTor ? 'Active' : 'Disabled'}</InfoRow>
      {/* Its routes are the project's nginx.conf, which this daemon does not
          parse: the list that stood here was `/<app name>` → `localhost:<port>`
          for every app, made up on the page. */}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Overview for Server
// ---------------------------------------------------------------------------

function ServerOverview({ data }: { data: ServerNodeData }) {
  const theme = useTheme();
  const statusColor = getStatusColor(data.status, theme);
  return (
    <Stack spacing={2}>
      <InfoRow label="Hostname">{data.hostname}</InfoRow>
      <InfoRow label="Address">{data.address}</InfoRow>
      <InfoRow label="Stacks">{data.stacks.join(', ')}</InfoRow>
      <InfoRow label="Role">
        <Chip
          label={data.role}
          size="small"
          sx={{
            height: 22,
            fontSize: 11,
            fontWeight: 600,
            bgcolor: 'action.hover',
            color: 'text.primary',
            textTransform: 'capitalize',
          }}
        />
      </InfoRow>
      <InfoRow label="Status">
        <Chip
          label={data.status}
          size="small"
          sx={{
            height: 22,
            fontSize: 11,
            fontWeight: 600,
            bgcolor: alpha(statusColor, 0.1),
            color: statusColor,
            border: `1px solid ${alpha(statusColor, 0.2)}`,
            textTransform: 'capitalize',
          }}
        />
      </InfoRow>
      {data.apps.length > 0 && (
        <>
          <Divider sx={{ borderColor: 'divider' }} />
          <Typography
            variant="caption"
            sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}
          >
            Applications
          </Typography>
          <Stack
            direction="row"
            sx={{
              flexWrap: 'wrap',
              gap: 0.5,
            }}
          >
            {data.apps.map((a) => (
              <Chip
                key={a}
                label={a}
                size="small"
                sx={{ height: 22, fontSize: 11, bgcolor: 'action.hover', color: 'text.primary' }}
              />
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

function LogsTab({ appName }: { appName: string }) {
  const [logEntries, setLogEntries] = useState<LogEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const result = await logs.streamLogs({ app: appName, tail: 30 });
      setLogEntries(result);
      setError(null);
    } catch (err) {
      // Not `[]`. An empty log panel says "this app has been quiet", which
      // is a statement an operator acts on by looking elsewhere. A failed
      // fetch says nothing of the kind, and this polls every five seconds —
      // so one bad call used to erase thirty lines someone was reading.
      setError((err as Error)?.message ?? 'Could not read the log');
    } finally {
      setLoading(false);
    }
  }, [appName]);

  usePollingEffect(() => void fetchLogs(), { intervalMs: 5_000 });

  if (loading) {
    return (
      <Stack spacing={0.5}>
        {[...Array(8)].map((_, i) => (
          <Skeleton key={i} height={18} sx={{ bgcolor: 'action.hover' }} />
        ))}
      </Stack>
    );
  }

  if (logEntries.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: error ? 'warning.main' : 'text.secondary' }}>
        {error ? `Could not read the log — ${error}` : 'No recent logs.'}
      </Typography>
    );
  }

  return (
    <Stack spacing={0.5}>
      {error && (
        <Typography variant="caption" sx={{ color: 'warning.main' }}>
          Could not refresh — {error}. Showing the last lines received.
        </Typography>
      )}
      <Stack
        spacing={0}
        sx={{
          fontFamily: 'monospace',
          fontSize: 11,
          maxHeight: 400,
          overflow: 'auto',
          bgcolor: 'background.default',
          borderRadius: 1,
          p: 1,
        }}
      >
        {logEntries.map((log) => (
          <Stack
            key={log.id}
            direction="row"
            spacing={0.75}
            sx={{
              py: 0.25,
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Typography component="span" sx={{ fontSize: 10, color: 'text.secondary', flexShrink: 0 }}>
              {formatTimestamp(log.timestamp)}
            </Typography>
            <Typography
              component="span"
              sx={{
                fontSize: 10,
                color: LEVEL_COLORS[log.level] ?? '#6b7280',
                fontWeight: 600,
                flexShrink: 0,
                width: 36,
              }}
            >
              {log.level.toUpperCase()}
            </Typography>
            <Typography
              component="span"
              sx={{
                fontSize: 11,
                color: 'text.primary',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {log.message}
            </Typography>
          </Stack>
        ))}
      </Stack>
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
    daemon
      .inspect({ name: appName })
      .then((diag) => setConfig(diag.config ?? {}))
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, [appName]);

  if (loading) {
    return <Skeleton variant="rectangular" height={120} sx={{ borderRadius: 1, bgcolor: 'action.hover' }} />;
  }

  if (!config) {
    return (
      <Typography
        variant="body2"
        sx={{
          color: 'text.secondary',
        }}
      >
        Could not load configuration.
      </Typography>
    );
  }

  return (
    <Box
      component="pre"
      sx={{
        fontFamily: 'monospace',
        fontSize: 11,
        color: 'text.primary',
        bgcolor: 'background.default',
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
// Metrics Tab — retained metric history for this local application
// ---------------------------------------------------------------------------

function MetricsTab({ appName }: { appName: string }) {
  const history = usePolledResource(
    async () => {
      const to = Date.now();
      const from = to - 5 * 60_000;
      const series = await metrics.querySeries({
        apps: [appName],
        names: ['cpu_percent', 'memory_bytes'],
        from,
        to,
        interval: '10s',
        limit: 60,
      });
      return { series: series.filter((item) => item.app === appName && !item.labels?.node), from, to };
    },
    { intervalMs: 10_000 }
  );
  return (
    <Stack spacing={2}>
      {(['cpu_percent', 'memory_bytes'] as const).map((name) => (
        <MetricChart
          key={name}
          title={name === 'cpu_percent' ? 'CPU' : 'Resident memory'}
          description="5 minutes · 10 s averages · local time"
          lines={metricLines(history.data?.series ?? [], name, '', true, {}, 10_000)}
          format={name === 'cpu_percent' ? formatCpu : formatBytes}
          from={history.data?.from ?? Date.now() - 300_000}
          to={history.data?.to ?? Date.now()}
          loading={history.loading}
          error={history.error}
          height={180}
        />
      ))}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Detail Panel
// ---------------------------------------------------------------------------

export function DetailPanel({ container }: { container?: HTMLElement | null }) {
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('md'));
  const { detailPanel, closeDetail, edges, nodes, openDetail } = useTopologyStore();
  const { can } = useAccess();
  const [tab, setTab] = useState('Overview');
  useEffect(() => {
    setTab('Overview');
  }, [detailPanel.nodeId]);
  const { open, nodeType, data } = detailPanel;
  if (!data) return null;
  const app = nodeType === 'app' ? (data as AppNodeData) : null;
  const overview = (
    <>
      {nodeType === 'app' && <AppOverview data={data as AppNodeData} />}
      {nodeType === 'infra' && <InfraOverview data={data as InfraNodeData} />}
      {nodeType === 'gateway' && <GatewayOverview data={data as GatewayNodeData} />}
      {nodeType === 'server' && <ServerOverview data={data as ServerNodeData} />}
    </>
  );
  const tabs = [
    { value: 'Overview', label: 'Overview', content: overview },
    { value: 'Connections', label: 'Connections', content: <Stack spacing={1} sx={{ pt: 1 }}>
      <Typography variant="caption" color="text.secondary">Configuration and ownership evidence. Connection health is not measured by these links.</Typography>
      {edges.filter(edge => edge.source === detailPanel.nodeId || edge.target === detailPanel.nodeId).map(edge => {
        const outgoing = edge.source === detailPanel.nodeId;
        const peer = nodes.find(node => node.id === (outgoing ? edge.target : edge.source));
        if (!peer) return null;
        return <Box key={edge.id} sx={{ borderBottom: '1px solid', borderColor: 'divider', py: 1 }}>
          <Button size="small" sx={{ textAlign: 'left', overflowWrap: 'anywhere' }} onClick={() => openDetail(peer.id, peer.data.nodeType, peer.data)}>{outgoing ? '→' : '←'} {peer.data.label}</Button>
          <Typography variant="caption" component="div" sx={{ overflowWrap: 'anywhere' }}>{String(edge.label ?? 'Dependency')} · {String(edge.data?.evidence ?? 'declaration')} · {(edge.data?.via as string[] | undefined)?.join(', ')}</Typography>
          {typeof edge.data?.endpoint === 'string' && <Typography variant="caption">{edge.data.endpoint}</Typography>}
        </Box>;
      })}
      {!edges.some(edge => edge.source === detailPanel.nodeId || edge.target === detailPanel.nodeId) && <Typography variant="body2" color="text.secondary">No relationships could be established from the available configuration.</Typography>}
    </Stack> },
    ...(app && !app.remote
      ? [
          ...(can('OmnitronDaemon.inspect')
            ? [{ value: 'Config', label: 'Config', content: <ConfigTab key={app.name} appName={app.name} /> }]
            : []),
          { value: 'Metrics', label: 'Metrics', content: <MetricsTab key={app.name} appName={app.name} /> },
        ]
      : []),
    ...(app ? [{ value: 'Logs', label: 'Logs', content: <LogsTab key={app.name} appName={app.name} /> }] : []),
  ];
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={closeDetail}
      variant={wide ? 'persistent' : 'temporary'}
      container={container}
      onKeyDown={(event) => {
        if (event.key === 'Escape') closeDetail();
      }}
      sx={{ width: wide && open ? DRAWER_WIDTH : 0, flexShrink: 0 }}
      slotProps={{
        paper: {
          role: wide ? 'complementary' : 'dialog',
          'aria-modal': wide ? undefined : true,
          'aria-labelledby': 'topology-detail-title',
          sx: {
            width: DRAWER_WIDTH,
            maxWidth: '100%',
            minWidth: 0,
            height: '100%',
            maxHeight: '100dvh',
            position: wide ? 'absolute' : 'fixed',
            bgcolor: 'background.paper',
            color: 'text.primary',
            borderLeft: '1px solid',
            borderColor: 'divider',
          },
        },
      }}
    >
      <Stack
        direction="row"
        useFlexGap
        spacing={1}
        sx={{ alignItems: 'center', p: 2, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Typography id="topology-detail-title" variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>
            {data.label}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {nodeType} · {data.status}
          </Typography>
        </Stack>
        <IconButton size="small" aria-label="Close node details" onClick={closeDetail}>
          <CloseIcon />
        </IconButton>
      </Stack>
      <Box
        data-keyboard-region="Node details" tabIndex={-1}
        sx={{ p: 1.5, overflow: 'auto', minHeight: 0, minWidth: 0, flex: 1 }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') closeDetail();
        }}
      >
        <Tabs
          aria-label="Node details"
          tabs={tabs}
          value={tabs.some((item) => item.value === tab) ? tab : 'Overview'}
          onChange={setTab}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{ minHeight: 40, '& .MuiTab-root': { minWidth: 72, px: 1 } }}
        />
      </Box>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack
      direction="row"
      sx={{
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1.5,
        minWidth: 0,
      }}
    >
      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 12 }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          fontSize: 13,
          minWidth: 0,
          textAlign: 'right',
          overflowWrap: 'anywhere',
          fontFamily: typeof children === 'string' || typeof children === 'number' ? 'monospace' : undefined,
        }}
      >
        {children}
      </Typography>
    </Stack>
  );
}
