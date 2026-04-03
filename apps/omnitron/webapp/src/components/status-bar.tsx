/**
 * Status Bar — Fixed bottom bar with real-time system health
 *
 * Displays: daemon status, project context, apps, nodes, alerts, connection, uptime
 * Auto-refreshes via polling (10s without WS, 30s with WS) + instant on WS events.
 */

import { useState, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { daemon, alerts, nodes as nodesRpc } from 'src/netron/client';
import { useRealtimeStore } from 'src/stores/realtime.store';
import { useProjectStore, useActiveProjectStacks } from 'src/stores/project.store';

// =============================================================================
// Helpers
// =============================================================================

function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <Box
      sx={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        bgcolor: color,
        flexShrink: 0,
        ...(pulse && {
          boxShadow: `0 0 4px ${color}`,
          animation: 'pulse 2s ease-in-out infinite',
          '@keyframes pulse': {
            '0%, 100%': { opacity: 1 },
            '50%': { opacity: 0.5 },
          },
        }),
      }}
    />
  );
}

/** Format milliseconds to human-readable uptime */
function formatUptimeMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

function StatusItem({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      {children}
    </Box>
  );
}

function StatusText({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
  return (
    <Typography
      variant="caption"
      sx={{
        fontSize: 'inherit',
        color: highlight ? '#e4e4e7' : 'text.secondary',
        fontWeight: highlight ? 600 : 400,
      }}
    >
      {children}
    </Typography>
  );
}

function StatusLabel({ label, value }: { label: string; value: string | number }) {
  return (
    <StatusText>
      {label} <span style={{ color: '#e4e4e7', fontWeight: 600 }}>{value}</span>
    </StatusText>
  );
}

// =============================================================================
// Types
// =============================================================================

interface StatusData {
  daemonOnline: boolean;
  appsOnline: number;
  appsTotal: number;
  nodesOnline: number;
  nodesTotal: number;
  firingAlerts: number;
  uptimeMs: number;
  version: string;
  pid: number;
  lastFetch: number;
}

// =============================================================================
// Status Bar
// =============================================================================

export function StatusBar() {
  const [data, setData] = useState<StatusData | null>(null);
  const wsConnected = useRealtimeStore((s) => s.connected);
  const lastEvent = useRealtimeStore((s) => s.lastEvent);

  useEffect(() => {
    let active = true;

    const fetchStatus = async () => {
      try {
        const [status, nodesList, alertsResult] = await Promise.allSettled([
          daemon.status(),
          nodesRpc.listNodes(),
          alerts.getSummary(),
        ]);

        if (!active) return;

        const st = status.status === 'fulfilled' ? (status.value as any) : null;
        const nd = nodesList.status === 'fulfilled' ? (nodesList.value as any[]) : [];
        const al = alertsResult.status === 'fulfilled' ? (alerts.value as any) : null;

        const appList = st?.apps ?? [];
        const online = Array.isArray(appList) ? appList.filter((a: any) => a.status === 'online').length : 0;

        setData({
          daemonOnline: !!st,
          appsOnline: online,
          appsTotal: Array.isArray(appList) ? appList.length : 0,
          nodesOnline: Array.isArray(nd) ? nd.filter((n: any) => n.status?.omnitronConnected).length : 0,
          nodesTotal: Array.isArray(nd) ? nd.length : 0,
          firingAlerts: al?.firing ?? 0,
          uptimeMs: st?.uptime ?? 0,
          version: st?.version ?? '',
          pid: st?.pid ?? 0,
          lastFetch: Date.now(),
        });
      } catch {
        if (active) setData((prev) => prev ? { ...prev, daemonOnline: false } : null);
      }
    };

    fetchStatus();
    const timer = setInterval(fetchStatus, wsConnected ? 30_000 : 10_000);
    return () => { active = false; clearInterval(timer); };
  }, [wsConnected]);

  // Instant re-fetch on relevant WS events
  useEffect(() => {
    if (!lastEvent) return;
    const ch = lastEvent.channel;
    if (ch.startsWith('app.') || ch.startsWith('alert.') || ch.startsWith('daemon.') || ch.startsWith('stack.')) {
      (async () => {
        try {
          const st = await daemon.status() as any;
          const appList = st?.apps ?? [];
          const online = Array.isArray(appList) ? appList.filter((a: any) => a.status === 'online').length : 0;
          setData((prev) => prev ? {
            ...prev,
            daemonOnline: true,
            appsOnline: online,
            appsTotal: appList.length,
            uptimeMs: st?.uptime ?? prev.uptimeMs,
            version: st?.version ?? prev.version,
            pid: st?.pid ?? prev.pid,
            lastFetch: Date.now(),
          } : prev);
        } catch { /* non-critical */ }
      })();
    }
  }, [lastEvent]);

  if (!data) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 28,
        bgcolor: alpha('#0a0a10', 0.96),
        backdropFilter: 'blur(12px)',
        borderTop: '1px solid',
        borderColor: alpha('#fff', 0.06),
        display: 'flex',
        alignItems: 'center',
        px: 2,
        gap: 2.5,
        zIndex: 1300,
        fontSize: '0.68rem',
        userSelect: 'none',
      }}
    >
      {/* Daemon status */}
      <StatusItem>
        <Dot color={data.daemonOnline ? '#22c55e' : '#ef4444'} pulse={data.daemonOnline} />
        <StatusText highlight={data.daemonOnline}>
          {data.daemonOnline ? 'Online' : 'Offline'}
        </StatusText>
      </StatusItem>

      {/* Separator */}
      <Box sx={{ width: '1px', height: 12, bgcolor: alpha('#fff', 0.08) }} />

      {/* Project context */}
      <ProjectStackIndicator />

      {/* Apps */}
      <StatusItem>
        <StatusLabel label="Apps" value={`${data.appsOnline}/${data.appsTotal}`} />
      </StatusItem>

      {/* Nodes */}
      {data.nodesTotal > 0 && (
        <StatusItem>
          <StatusLabel label="Nodes" value={`${data.nodesOnline}/${data.nodesTotal}`} />
        </StatusItem>
      )}

      {/* Alerts */}
      {data.firingAlerts > 0 && (
        <StatusItem>
          <Dot color="#ef4444" pulse />
          <Typography variant="caption" sx={{ fontSize: 'inherit', color: '#ef4444', fontWeight: 600 }}>
            {data.firingAlerts} alert{data.firingAlerts > 1 ? 's' : ''}
          </Typography>
        </StatusItem>
      )}

      {/* Connection type */}
      <StatusItem>
        <Dot color={wsConnected ? '#3b82f6' : '#6b7280'} />
        <StatusText>{wsConnected ? 'Live' : 'Polling'}</StatusText>
      </StatusItem>

      {/* Spacer */}
      <Box sx={{ flex: 1 }} />

      {/* Uptime */}
      {data.daemonOnline && data.uptimeMs > 0 && (
        <StatusItem>
          <StatusLabel label="Uptime" value={formatUptimeMs(data.uptimeMs)} />
        </StatusItem>
      )}

      {/* Server clock */}
      <DaemonClock serverTimestamp={data.lastFetch} />

      {/* Cmd+K */}
      <Box
        sx={{
          px: 0.75,
          py: 0.1,
          borderRadius: 0.5,
          border: '1px solid',
          borderColor: alpha('#fff', 0.08),
          fontSize: 'inherit',
          color: 'text.disabled',
          lineHeight: 1,
        }}
      >
        ⌘K
      </Box>
    </Box>
  );
}

// =============================================================================
// Project + Stack Context
// =============================================================================

/**
 * Server clock — syncs offset with daemon timestamp, ticks locally.
 * On each status fetch, we compute the delta between server and client time.
 * Between fetches, we tick locally with that offset applied.
 */
function DaemonClock({ serverTimestamp }: { serverTimestamp: number }) {
  const [offset] = useState(() => serverTimestamp ? serverTimestamp - Date.now() : 0);
  const [now, setNow] = useState(() => Date.now() + offset);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(timer);
  }, [offset]);

  const d = new Date(now);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');

  return (
    <StatusItem>
      <StatusText>{hh}:{mm}:{ss}</StatusText>
    </StatusItem>
  );
}

function ProjectStackIndicator() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeStack = useProjectStore((s) => s.activeStack);
  const stacks = useActiveProjectStacks();

  if (!activeProject) return null;

  const runningCount = stacks.filter((s) => s.status === 'running').length;

  return (
    <StatusItem>
      <StatusText>
        <span style={{ color: '#e4e4e7', fontWeight: 600 }}>{activeProject}</span>
        {activeStack && (
          <span style={{ color: '#60a5fa' }}> / {activeStack}</span>
        )}
        {runningCount > 0 && !activeStack && (
          <span style={{ color: '#6b7280' }}> ({runningCount} stack{runningCount > 1 ? 's' : ''})</span>
        )}
      </StatusText>
    </StatusItem>
  );
}
