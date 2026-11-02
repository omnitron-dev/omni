import { stackApps, stackCounts } from 'src/utils/stack-inventory';
/**
 * Status Bar — Fixed bottom bar with real-time system health
 *
 * Displays: daemon status, project context, apps, nodes, alerts, connection, uptime
 * Auto-refreshes via polling (10s without WS, 30s with WS) + instant on WS events.
 */

import { useState, useEffect, useRef } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useAccess } from 'src/auth/access';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { daemon, alerts, nodes as nodesRpc } from 'src/netron/client';
import { useRealtimeStore } from 'src/stores/realtime.store';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { useProjectStore, useActiveProjectStacks } from 'src/stores/project.store';
import { tally } from 'src/utils/app-address';

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

function StatusItem({ children, priority }: { children: React.ReactNode; priority?: 'detail' | 'extra' | 'context' }) {
  return (
    <Box
      data-priority={priority}
      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, whiteSpace: 'nowrap', minWidth: 0 }}
    >
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
        color: highlight ? 'text.primary' : 'text.secondary',
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
      {label}{' '}
      <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
        {value}
      </Box>
    </StatusText>
  );
}

// =============================================================================
// Types
// =============================================================================

interface StatusData {
  daemonOnline: boolean;
  appsCurrent: boolean;
  appsKnown: boolean;
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

export function StatusBar({ docked = false }: { docked?: boolean }) {
  const project = useProjectStore(s => s.activeProject);
  const stack = useProjectStore(s => s.activeStack);
  const lastKnown = useRef({ nodesOnline: 0, nodesTotal: 0, firingAlerts: 0, appsOnline: 0, appsTotal: 0, appsKnown: false });
  return <StatusBarReader key={JSON.stringify([project, stack])} docked={docked} lastKnown={lastKnown} />;
}

function StatusBarReader({ docked, lastKnown }: { docked: boolean; lastKnown: React.RefObject<{ nodesOnline: number; nodesTotal: number; firingAlerts: number; appsOnline: number; appsTotal: number; appsKnown: boolean }> }) {
  const { can } = useAccess();
  const showAlerts = can('OmnitronAlerts.getSummary') && can('OmnitronAlerts.getActiveAlerts') && can('OmnitronAlerts.getRules');
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
  const wsConnected = useRealtimeStore((s) => s.connected);
  const lastEvent = useRealtimeStore((s) => s.lastEvent);
  const initializeRealtime = useRealtimeStore((s) => s.initialize);
  // Fleet status is visible on every authenticated route, including direct
  // entry into Access or Terminal where no page owns an event subscription.
  useEffect(initializeRealtime, [initializeRealtime]);
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeStack = useProjectStore((s) => s.activeStack);
  const fetchStacks = useProjectStore(s => s.fetchStacks);
  const inventory = useProjectStore(s => activeProject ? s.stacksByProject?.[activeProject] : undefined);
  const inventoryError = useProjectStore(s => activeProject ? s.stackReadErrors?.[activeProject] : null);

  // The status bar sits on every page, so its loop is the one that runs the
  // most — and it was the last hand-written one: three RPCs every ten seconds
  // from a hidden tab, forever, with no guard against a slow daemon making
  // them overlap.
  //
  // Application inventory depends on the resident owner. Its failure does
  // not establish that the backend is offline: use the independent ping,
  // and mark retained application counts as stale.
  const { data: polled, refresh } = usePolledResource(
    async () => {
      const [status, , nodesList, alertsResult] = await Promise.allSettled([
        daemon.status(),
        activeProject ? fetchStacks(activeProject) : Promise.resolve(null),
        nodesRpc.listNodes(),
        showAlerts ? alerts.getSummary() : null,
      ]);

      const st = status.status === 'fulfilled' ? (status.value as any) : null;
      const reachable = st ? true : await daemon.ping().then(() => true, () => false);
      const nd = nodesList.status === 'fulfilled' ? (nodesList.value as any[]) : [];
      const al = alertsResult.status === 'fulfilled' ? (alertsResult.value as any) : null;

      const apps = st?.apps ?? null;
      if (apps) Object.assign(lastKnown.current, tally(apps), { appsKnown: true });

      // A sub-query that failed contributes nothing rather than zero.
      if (nodesList.status === 'fulfilled' && Array.isArray(nd)) {
        lastKnown.current.nodesOnline = nd.filter((n: any) => n.status?.omnitronConnected).length;
        lastKnown.current.nodesTotal = nd.length;
      }
      if (alertsResult.status === 'fulfilled') {
        lastKnown.current.firingAlerts = al?.firing ?? 0;
      }

      return {
        daemonOnline: reachable,
        appsCurrent: !!apps,
        appsKnown: lastKnown.current.appsKnown,
        appsOnline: lastKnown.current.appsOnline,
        appsTotal: lastKnown.current.appsTotal,
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

  // Another selection is another question: its answer should not wait a poll.
  useEffect(() => {
    void refresh();
  }, [activeProject, activeStack, showAlerts, refresh]);

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
    void refresh();
  }, [lastEvent, refresh]);

  if (!data) return null;
  const selectedApps = inventory ? stackApps(inventory).filter(app => !activeStack || app.stack === activeStack) : null;
  const unknownApps = selectedApps?.filter(app => app.status === 'unknown').length ?? 0;
  const observedApps = selectedApps ? tally(selectedApps) : null;
  const appCount = activeProject
    ? observedApps ? `${observedApps.appsOnline}/${observedApps.appsTotal}${inventoryError ? ' stale' : unknownApps ? ` · ${unknownApps} unknown` : ''}` : 'unknown'
    : data.appsKnown ? `${data.appsOnline}/${data.appsTotal}${data.appsCurrent ? '' : ' stale'}` : 'unknown';

  return (
    <Box
      aria-label={`Infrastructure status: ${data.daemonOnline ? 'online' : 'offline'}, applications ${appCount}, nodes ${data.nodesOnline}/${data.nodesTotal}${showAlerts ? `, ${data.firingAlerts} alerts` : ''}`}
      sx={{
        position: docked ? 'relative' : 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 'calc(28px + env(safe-area-inset-bottom, 0px))',
        pb: 'env(safe-area-inset-bottom, 0px)',
        flexShrink: 0,
        minWidth: 0,
        overflow: 'hidden',
        containerType: 'inline-size',
        bgcolor: (theme) => alpha(theme.palette.background.default, 0.96),
        backdropFilter: 'blur(12px)',
        borderTop: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        alignItems: 'center',
        px: { xs: 1, sm: 2 },
        gap: { xs: 1, md: 2.5 },
        zIndex: (theme) => theme.zIndex.appBar,
        fontSize: '0.68rem',
        userSelect: 'none',
        '@container (max-width: 800px)': { '& [data-priority="detail"]': { display: 'none' } },
        '@container (max-width: 600px)': { '& [data-priority="context"]': { display: 'none' } },
        '@container (max-width: 420px)': { '& [data-priority="extra"]': { display: 'none' } },
      }}
    >
      {/* Daemon status */}
      <StatusItem>
        <Dot color={data.daemonOnline ? '#22c55e' : '#ef4444'} pulse={data.daemonOnline} />
        <StatusText highlight={data.daemonOnline}>{data.daemonOnline ? 'Online' : 'Offline'}</StatusText>
      </StatusItem>

      {/* Separator */}
      <Box sx={{ width: '1px', height: 12, bgcolor: 'divider' }} />

      {/* Project context */}
      <ProjectStackIndicator />

      {/* Apps */}
      <StatusItem>
        <StatusLabel label="Apps" value={appCount} />
      </StatusItem>

      {/* Nodes */}
      {data.nodesTotal > 0 && (
        <StatusItem priority="extra">
          <StatusLabel label="Nodes" value={`${data.nodesOnline}/${data.nodesTotal}`} />
        </StatusItem>
      )}

      {/* Alerts */}
      {showAlerts && data.firingAlerts > 0 && (
        <Box
          component={RouterLink}
          to="/alerts#firing"
          aria-label={`View ${data.firingAlerts} firing ${data.firingAlerts === 1 ? 'alert' : 'alerts'} across all workspaces`}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.5, minHeight: 24, px: 0.5,
            whiteSpace: 'nowrap', flexShrink: 0, borderRadius: 0.5, textDecoration: 'none',
            color: 'error.main', fontWeight: 600,
            '&:hover': { textDecoration: 'underline' },
            '&:focus-visible': { outline: '2px solid currentColor', outlineOffset: -2 },
          }}
        >
          <Dot color="currentColor" />
          {data.firingAlerts} alert{data.firingAlerts > 1 ? 's' : ''}
        </Box>
      )}

      {/* Connection type */}
      <StatusItem priority="extra">
        <Dot color={wsConnected ? '#3b82f6' : '#6b7280'} />
        <StatusText>{wsConnected ? 'Live' : 'Polling'}</StatusText>
      </StatusItem>

      {/* Spacer */}
      <Box sx={{ flex: 1 }} />

      {/* Uptime */}
      {data.daemonOnline && data.uptimeMs > 0 && (
        <StatusItem priority="detail">
          <StatusLabel label="Uptime" value={formatUptimeMs(data.uptimeMs)} />
        </StatusItem>
      )}

      {/* Server clock */}
      <DaemonClock serverTimestamp={data.lastFetch} />

      {/* Cmd+K */}
      <Box
        data-priority="detail"
        sx={{
          px: 0.75,
          py: 0.1,
          borderRadius: 0.5,
          border: '1px solid',
          borderColor: 'divider',
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
  const [offset] = useState(() => (serverTimestamp ? serverTimestamp - Date.now() : 0));
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
    <StatusItem priority="detail">
      <StatusText>
        {hh}:{mm}:{ss}
      </StatusText>
    </StatusItem>
  );
}

function ProjectStackIndicator() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeStack = useProjectStore((s) => s.activeStack);
  const stacks = useActiveProjectStacks();

  const stale = useProjectStore(s => activeProject ? s.stackReadErrors?.[activeProject] : null);
  const known = useProjectStore(s => !!activeProject && s.stacksByProject[activeProject] !== undefined);
  const { runningStacks, totalStacks, unknownStacks } = stackCounts(stacks.filter(s => !activeStack || s.name === activeStack));
  if (!activeProject) return null;

  return (
    <StatusItem priority="context">
      <StatusText>
        <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
          {activeProject}
        </Box>
        {activeStack && (
          <Box component="span" sx={{ color: 'info.main' }}>
            {' '}
            / {activeStack}
          </Box>
        )}
        {(
          <span title={unknownStacks ? `${unknownStacks} stack states unknown` : 'Running / configured stacks'}>
            {' '}
            ({known ? `${runningStacks}/${totalStacks}` : 'unknown'} stacks{stale ? ' · stale' : unknownStacks > 0 ? ' · unknown' : ''})
          </span>
        )}
      </StatusText>
    </StatusItem>
  );
}
