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
import { usePolledResource } from 'src/hooks/use-polled-resource';
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
  /**
   * The last values the nodes and alerts queries actually produced.
   *
   * Each poll rebuilds the whole object, so a sub-query that failed used to
   * contribute `0`. The bar renders its nodes and alerts chips only when the
   * count is above zero, so a failing `alerts.getSummary()` made the alert
   * chip disappear — and a chip that is not there reads as "nothing is
   * firing", which is a claim, not a silence.
   *
   * Carrying the last known count forward can show an alert that has since
   * cleared. That direction is the safe one: a stale count sends someone to
   * the alerts page, a false zero sends them nowhere.
   */
  const lastKnown = useRef({ nodesOnline: 0, nodesTotal: 0, firingAlerts: 0 });
  const wsConnected = useRealtimeStore((s) => s.connected);
  const lastEvent = useRealtimeStore((s) => s.lastEvent);

  // The status bar sits on every page, so its loop is the one that runs the
  // most — and it was the last hand-written one: three RPCs every ten seconds
  // from a hidden tab, forever, with no guard against a slow daemon making
  // them overlap.
  //
  // `daemonOnline: !!st` is kept as-is on purpose. Here a failed `status()`
  // really does mean the daemon did not answer, and the bar shows that as
  // "Offline" beside a stale timestamp rather than asserting anything about
  // why — the banner is the surface that tells an operator what to DO, and
  // that one now distinguishes a timeout from a refusal.
  const { data: polled } = usePolledResource(
    async () => {
      const [status, nodesList, alertsResult] = await Promise.allSettled([
        daemon.status(),
        nodesRpc.listNodes(),
        alerts.getSummary(),
      ]);

      const st = status.status === 'fulfilled' ? (status.value as any) : null;
      const nd = nodesList.status === 'fulfilled' ? (nodesList.value as any[]) : [];
      const al = alertsResult.status === 'fulfilled' ? (alertsResult.value as any) : null;

      const appList = st?.apps ?? [];
      const online = Array.isArray(appList) ? appList.filter((a: any) => a.status === 'online').length : 0;

      // A sub-query that failed contributes nothing rather than zero.
      if (nodesList.status === 'fulfilled' && Array.isArray(nd)) {
        lastKnown.current.nodesOnline = nd.filter((n: any) => n.status?.omnitronConnected).length;
        lastKnown.current.nodesTotal = nd.length;
      }
      if (alertsResult.status === 'fulfilled') {
        lastKnown.current.firingAlerts = al?.firing ?? 0;
      }

      return {
        daemonOnline: !!st,
        appsOnline: online,
        appsTotal: Array.isArray(appList) ? appList.length : 0,
        nodesOnline: lastKnown.current.nodesOnline,
        nodesTotal: lastKnown.current.nodesTotal,
        firingAlerts: lastKnown.current.firingAlerts,
        uptimeMs: st?.uptime ?? 0,
        version: st?.version ?? '',
        pid: st?.pid ?? 0,
        lastFetch: Date.now(),
      };
    },
    { intervalMs: wsConnected ? 30_000 : 10_000 }
  );

  useEffect(() => {
    if (polled) setData(polled);
  }, [polled]);

  // Instant re-fetch on relevant WS events.
  //
  // `alert.` is in the list of channels that trigger this, and the body used
  // to refresh only the daemon status — so an alert firing woke the bar and
  // left the alert count exactly as it was, until the 30-second poll came
  // round. The one event the chip exists for was the one it ignored.
  useEffect(() => {
    if (!lastEvent) return;
    const ch = lastEvent.channel;
    if (!(ch.startsWith('app.') || ch.startsWith('alert.') || ch.startsWith('daemon.') || ch.startsWith('stack.'))) {
      return;
    }
    (async () => {
      const [status, alertsResult] = await Promise.allSettled([
        daemon.status(),
        ch.startsWith('alert.') ? alerts.getSummary() : Promise.resolve(null),
      ]);

      if (alertsResult.status === 'fulfilled' && alertsResult.value) {
        lastKnown.current.firingAlerts = (alertsResult.value as any)?.firing ?? 0;
      }

      if (status.status === 'rejected') {
        // The poll will correct the app counts on its next tick; nothing here
        // is worth reporting on its own.
        return;
      }

      const st = status.value as any;
      const appList = st?.apps ?? [];
      const online = Array.isArray(appList) ? appList.filter((a: any) => a.status === 'online').length : 0;
      setData((prev) => prev ? {
        ...prev,
        daemonOnline: true,
        appsOnline: online,
        appsTotal: appList.length,
        firingAlerts: lastKnown.current.firingAlerts,
        uptimeMs: st?.uptime ?? prev.uptimeMs,
        version: st?.version ?? prev.version,
        pid: st?.pid ?? prev.pid,
        lastFetch: Date.now(),
      } : prev);
    })();
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
