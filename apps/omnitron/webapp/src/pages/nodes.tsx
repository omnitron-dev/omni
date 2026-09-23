/**
 * Nodes Page — Infrastructure node management
 *
 * Card layout: PING + OMNITRON indicators, uptime bars from PG history.
 * Uptime bars: vertical 4px segments, green→red by uptime %, two rows.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import { alpha, keyframes, useTheme, type Theme } from '@mui/material/styles';

import { Breadcrumbs, EmptyContent, FormAlert, Skeleton, useSnackbar } from '@omnitron-dev/prism';
import { FleetRollout } from 'src/components/fleet-rollout';
import { nodes as nodesRpc } from 'src/netron/client';
import { usePollingEffect } from 'src/hooks/use-polled-resource';
// One contract, imported. These four were local copies of types the daemon
// already publishes, and they had drifted: this file declared
// `omnitronRole?: string` where the daemon says `'master' | 'slave'`, so a
// role it can never send would have type-checked here.
import type {
  INodeStatus, INodeWithStatus, IMeshNodeStatus, INodeIndicators, INodeSyncStatus, INodeRelayStats, INodeClusterState,
  INodeDaemonAnswer, DaemonStatusDto, NodeUpgradeProgress as INodeUpgradeProgress,
} from '@omnitron-dev/omnitron/dto/services';
import { verdictOf, omnitronVerdict, firstReason, clusterDisagreement, type LayerVerdict } from 'src/utils/node-diagnosis';
import { omnitronFinding } from '@omnitron-dev/omnitron/node-check';
import { useRealtimeStore } from 'src/stores/realtime.store';
import {
  PlusIcon,
  NodesIcon,
  DeployIcon,
  SettingsIcon,
  DeleteIcon,
  RefreshIcon,
  ChipIcon,
  EyeIcon,
} from 'src/assets/icons';
/**
 * Fallbacks for the bar's shape, used until the daemon answers.
 *
 * They used to be the whole story: a hard-coded 24-hour bucket and a request
 * for 200 of them, against a daemon that keeps 90 days of history — so three
 * of every four segments were "no data" by construction, and every poll asked
 * the database for a window that cannot exist. The daemon now says how wide a
 * segment is and how far back its history goes, and both are read from it.
 */
const DEFAULT_UPTIME_BUCKET_MS = 86_400_000; // 24h
const DEFAULT_RETENTION_DAYS = 90;

/** Segments to draw: the retention window, in buckets, capped for sanity. */
function bucketsFor(retentionDays: number, intervalMs: number): number {
  const span = retentionDays * 86_400_000;
  return Math.max(1, Math.min(400, Math.ceil(span / Math.max(1, intervalMs))));
}

/**
 * How often the bars are refetched.
 *
 * A bar segment is a DAY. Re-aggregating a 90-day window per node every
 * thirty seconds, alongside the node list, bought a picture that cannot
 * visibly change between two refreshes.
 */
const UPTIME_POLL_MS = 300_000;

/**
 * A reading older than this is called out rather than shown as current.
 *
 * The console displayed `checkedAt` nowhere. A fleet whose checker had
 * stopped rendered exactly like a healthy one — observed live: two days of
 * "PING ● / OMNITRON ●" taken from a worker that died shortly after boot.
 */
const STALE_AFTER_MS = 300_000;

/** How long ago a status was taken, at the resolution an operator cares about. */
function formatAge(iso: string | undefined): string {
  if (!iso) return 'never';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return 'never';
  if (ms < 60_000) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Whether a status is old enough that it should not be read as current. */
function isStale(iso: string | undefined): boolean {
  if (!iso) return true;
  const ts = Date.parse(iso);
  return !Number.isFinite(ts) || Date.now() - ts > STALE_AFTER_MS;
}

// =============================================================================
// Types
// =============================================================================

interface SshKeyInfo { name: string; path: string; type: string }

/** The operator-tunable half of how the fleet is checked. */
interface NodeCheckConfig {
  pingEnabled: boolean;
  pingTimeout: number;
  sshTimeout: number;
  omnitronCheckTimeout: number;
  concurrency: number;
}

/** How much history the daemon keeps, and how wide one bar segment is. */
interface FleetHistoryConfig {
  uptimeIntervalMs: number;
  retentionDays: number;
}

/** Backend UptimeBucket — per-interval aggregation */
interface UptimeBucket {
  t: string;
  /** 0.0–1.0 uptime pct, -1 = no data */
  ping: number;
  /** 0.0–1.0 over the checks that could measure it; -1 when none could. */
  omnitron: number;
  checks: number;
  /**
   * Why `omnitron` is -1 on a bucket that ran checks: `absent` when they found
   * no omnitron installed, `unreachable` when they could not get to the
   * machine to look. Optional so a daemon that predates the field renders as
   * it did before rather than throwing.
   */
  omnitronUnmeasured?: 'absent' | 'unreachable' | 'unread';
}

// =============================================================================
// Animations
// =============================================================================

const spin = keyframes`
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
`;

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.3; }
`;

// =============================================================================
// Status Dot
// =============================================================================

type DotState = 'online' | 'offline' | 'unknown' | 'unchecked' | 'checking' | 'not-installed';

function StatusDot({ state, label, tooltip }: { state: DotState; label: string; tooltip?: string }) {
  const colors: Record<DotState, string> = {
    online: 'success.main', offline: 'error.main', unknown: 'warning.light', unchecked: 'text.disabled',
    checking: 'warning.main', 'not-installed': 'text.disabled',
  };
  const texts: Record<DotState, string> = {
    online: 'Connected', offline: 'Offline', unknown: 'Unknown', unchecked: 'Not checked',
    checking: 'Checking...', 'not-installed': 'Not installed',
  };

  return (
    <Tooltip title={tooltip ?? texts[state]} arrow>
      <Stack direction="row" spacing={0.5} sx={{
        alignItems: "center"
      }}>
        <Box sx={{
          width: 8, height: 8, borderRadius: '50%', bgcolor: colors[state], flexShrink: 0,
          ...(state === 'checking' && { animation: `${pulse} 1s ease-in-out infinite` }),
          ...(state === 'not-installed' && { border: '1px dashed', borderColor: 'text.disabled', bgcolor: 'transparent' }),
        }} />
        <Typography variant="caption" noWrap sx={{
          color: "text.secondary"
        }}>{label}</Typography>
      </Stack>
    </Tooltip>
  );
}

// =============================================================================
// Uptime Bar — vertical 4px segments, green→red gradient
// =============================================================================

/**
 * Precise uptime → color mapping via HSL interpolation.
 *
 * pct = ratio of successful checks in this bucket (0.0 = all failed, 1.0 = all passed).
 * Maps to hue: 0° (red) → 120° (green) through yellow/orange.
 * Saturation and lightness extracted from theme success/error colors.
 */
/**
 * The segment's colour.
 *
 * `pct < 0` carries two different facts and they are not the same news.
 * `getUptimeBar` returns `-1` for a bucket with no checks in it, and `-1`
 * again for a bucket whose every check reported that omnitron is not
 * installed on the node — a deliberate choice, because 0 would paint a
 * machine that was never meant to run one solid red. Painting them alike
 * instead tells the operator nothing was measured, when in fact something was
 * measured repeatedly and had a definite answer.
 *
 * `checks` is what separates them: a bucket that ran checks and still reports
 * `-1` is the "not installed" case.
 */
function uptimeColor(pct: number, theme: Theme, unmeasured?: 'absent' | 'unreachable' | 'unread'): string {
  if (pct < 0) {
    if (unmeasured === 'absent') return alpha(theme.palette.info.main, 0.35); // nothing installed here
    if (unmeasured === 'unreachable') return alpha(theme.palette.warning.main, 0.3); // could not look
    if (unmeasured === 'unread') return alpha(theme.palette.text.disabled, 0.25); // looked, read nothing
    return theme.palette.action.disabledBackground; // nothing recorded
  }

  // Parse theme colors to HSL for proper interpolation
  const gHsl = hexToHsl(theme.palette.success.main);
  const rHsl = hexToHsl(theme.palette.error.main);

  // Lerp H/S/L — hue goes red(~0°) → green(~120°) linearly
  const h = rHsl[0] + (gHsl[0] - rHsl[0]) * pct;
  const s = rHsl[1] + (gHsl[1] - rHsl[1]) * pct;
  const l = rHsl[2] + (gHsl[2] - rHsl[2]) * pct;

  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

/** Convert hex color (#rrggbb) to [h, s, l] */
function hexToHsl(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l * 100];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  // No initialiser: every branch below assigns, so `let h = 0` was a value
  // that could never be read.
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;

  return [h, s * 100, l * 100];
}

/**
 * UptimeStrip — Reusable uptime visualization component.
 *
 * Renders vertical colored segments (green→red by uptime %).
 * Dynamically calculates how many segments fit based on container width.
 *
 * Props:
 *   data        — array of { t, [metric]: 0.0–1.0 | -1 }
 *   metric      — key in data to read uptime from
 *   label       — strip label (e.g. "PING")
 *   segWidth    — segment width in px (default: 6)
 *   gap         — gap between segments in px (default: 4)
 *   height      — strip height in px (default: 10)
 */
function UptimeStrip<T extends Record<string, any>>({
  data,
  metric,
  label,
  segWidth = 6,
  gap = 4,
  height = 10,
  lastCheckAt,
}: {
  data: T[];
  metric: keyof T & string;
  label: string;
  segWidth?: number;
  gap?: number;
  height?: number;
  /** When the history last recorded a check for this node, if known. */
  lastCheckAt?: string | null;
}) {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const calc = () => {
      const w = el.clientWidth;
      // segments: n * segWidth + (n-1) * gap <= w  →  n <= (w + gap) / (segWidth + gap)
      setVisibleCount(Math.max(1, Math.floor((w + gap) / (segWidth + gap))));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [segWidth, gap]);

  // Pad data to fill visible area: take last N from data, pad front with empty
  const segments: Array<{ val: number; time: string; iso?: string; checks?: number; unmeasured?: 'absent' | 'unreachable' | 'unread' }> = [];
  if (visibleCount > 0) {
    const tail = data.slice(-visibleCount);
    // Left-pad with empty (no-data) segments so the strip is always full width
    for (let i = 0; i < visibleCount - tail.length; i++) {
      segments.push({ val: -1, time: '' });
    }
    for (const entry of tail) {
      const val = entry[metric] as number;
      const time = entry.t ? new Date(entry.t as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      segments.push({
        val,
        time,
        ...(entry.t ? { iso: entry.t as string } : {}),
        checks: entry.checks as number | undefined,
        // Only the omnitron metric has a reason to give; ping either ran or
        // it did not.
        unmeasured: entry['omnitronUnmeasured'] as 'absent' | 'unreachable' | 'unread' | undefined,
      });
    }
  }

  // Overall uptime %
  const withData = segments.filter((s) => s.val >= 0);
  const avgPct = withData.length > 0
    ? Math.round((withData.reduce((sum, s) => sum + s.val, 0) / withData.length) * 100)
    : -1;
  // A strip that measured plenty and has no percentage to show is saying
  // something — "nothing to run here" — and the blank corner said it as
  // though the page had simply not loaded.
  const notInstalled = avgPct < 0 && segments.some((s) => s.unmeasured === 'absent');
  // The percentage averages the buckets that HAVE checks, so a recorder that
  // stopped left its last day's figure on screen as though it were today's.
  // Measured 2026-09-22: no check recorded after 12:15 UTC, and at 18:17 both
  // remote nodes read «OMNITRON 0%» in red about daemons serving 6/6 apps.
  // When the newest buckets are empty and older ones are not, say how long
  // it has been instead of repeating an old number.
  // By the last RECORDED check, not by empty buckets: a bucket may be hours
  // wide, and one that still holds this morning's checks looks current.
  // Checks run every minute; five without one is a recorder that stopped.
  const staleFor =
    avgPct >= 0 && lastCheckAt && Date.now() - new Date(lastCheckAt).getTime() > 5 * 60_000
      ? Date.now() - new Date(lastCheckAt).getTime()
      : null;
  const lastMeasured = lastCheckAt
    ? { time: new Date(lastCheckAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
    : null;
  const staleWords =
    staleFor == null
      ? null
      : staleFor >= 3_600_000
        ? `${Math.round(staleFor / 3_600_000)}h`
        : `${Math.max(1, Math.round(staleFor / 60_000))}m`;

  return (
    <Stack spacing={0.25}>
      <Stack
        direction="row"
        sx={{
          justifyContent: "space-between",
          alignItems: "center"
        }}>
        <Typography
          variant="caption"
          sx={{
            color: "text.disabled",
            fontSize: 9,
            textTransform: 'uppercase',
            letterSpacing: 0.5
          }}>
          {label}
        </Typography>
        {staleWords ? (
          <Tooltip
            title={`Nothing has been recorded for ${staleWords} — the last check was at ${lastMeasured?.time}. The strip shows what was measured before that, not the node now.`}
            arrow
          >
            <Typography variant="caption" sx={{ fontSize: 9, color: 'warning.main' }}>
              no checks for {staleWords}
            </Typography>
          </Tooltip>
        ) : avgPct >= 0 ? (
          <Typography variant="caption" sx={{ fontSize: 9, color: avgPct >= 95 ? 'success.main' : avgPct >= 50 ? 'warning.main' : 'error.main' }}>
            {avgPct}%
          </Typography>
        ) : notInstalled ? (
          <Typography variant="caption" sx={{ fontSize: 9, color: 'info.main' }}>
            not installed
          </Typography>
        ) : null}
      </Stack>
      <Stack ref={containerRef} direction="row" sx={{ height, gap: `${gap}px` }}>
        {segments.map((seg, i) => {
          const bg = uptimeColor(seg.val, theme, seg.unmeasured);
          const checked = seg.checks != null ? ` (${seg.checks} checks)` : '';
          const tip = seg.val < 0
            ? seg.unmeasured === 'absent'
              ? `${seg.time} — omnitron not installed${checked}`
              : seg.unmeasured === 'unreachable'
                ? `${seg.time} — could not reach the node${checked}`
                : seg.unmeasured === 'unread'
                  ? `${seg.time} — not measured: the node was reached and nothing could be read${checked}`
                  : (seg.time ? `${seg.time} — no data` : 'No data')
            : `${seg.time} — ${Math.round(seg.val * 100)}% up${checked}`;
          return (
            <Tooltip key={i} title={tip} arrow>
              <Box sx={{
                width: segWidth, minWidth: segWidth, height: '100%', bgcolor: bg,
                borderRadius: '2px',
                transition: 'opacity 0.15s',
                '&:hover': { opacity: 0.6 },
              }} />
            </Tooltip>
          );
        })}
      </Stack>
    </Stack>
  );
}

// =============================================================================
// Omnitron dot state
// =============================================================================

/**
 * How a node's version compares with the rest of the fleet.
 *
 * Until recently every omnitron called itself `0.2.0` — the registry's copy
 * and a build from this morning alike — so a fleet view had nothing to
 * compare and the question "which of my nodes are behind" had no answer on
 * the page whose job is to answer it. A locally built omnitron now carries
 * `+local.<sha>.<stamp>`, which makes two builds different strings.
 *
 * The newest is decided by that stamp, not by semver: build metadata is
 * ignored in semver precedence, so `0.2.0+local.a.202609150345` and
 * `0.2.0+local.b.202608010000` compare EQUAL to any version library. Reading
 * them as equal is what would make a stale node look current.
 *
 * A node running a published version has no stamp, and the honest answer for
 * it is "different", not "older" — nothing on the page knows when `0.2.0`
 * was built.
 */
type VersionStanding = 'current' | 'behind' | 'differs' | 'unknown';

export function buildStampOf(version: string | undefined): string | null {
  const m = /\+local\.[0-9a-zA-Z]+\.(\d{12})$/.exec(version ?? '');
  return m?.[1] ?? null;
}

export function versionStanding(version: string | undefined, newest: string | undefined): VersionStanding {
  if (!version || !newest) return 'unknown';
  if (version === newest) return 'current';
  const mine = buildStampOf(version);
  const theirs = buildStampOf(newest);
  // Two local builds: the stamps order them.
  if (mine && theirs) return mine < theirs ? 'behind' : 'current';
  // One of them is a published version, and nothing here knows its age.
  return 'differs';
}

/** The newest version anything in the fleet reports, by build stamp. */
export function newestVersion(versions: readonly (string | undefined)[]): string | undefined {
  let best: string | undefined;
  let bestStamp = '';
  for (const v of versions) {
    if (!v) continue;
    const stamp = buildStampOf(v);
    if (!stamp) { best ??= v; continue; }
    if (stamp > bestStamp) { bestStamp = stamp; best = v; }
  }
  return best;
}

function getOmnitronDotState(status: INodeStatus | null, isLocal: boolean): { state: DotState; tooltip: string } {
  if (!status) return { state: 'unchecked', tooltip: 'Not checked' };
  if (isLocal) {
    return status.omnitronConnected
      ? { state: 'online', tooltip: `v${status.omnitronVersion ?? '?'} PID ${status.omnitronPid ?? '?'}` }
      : { state: 'offline', tooltip: status.omnitronError ?? 'Not running' };
  }
  // The uptime strip reads the same check the same way (`omnitronFinding`):
  // «offline» only when the node said omnitron is not running. A timeout,
  // output that was not JSON, an exec that failed were read as offline
  // here — and a timeout, whose text echoes «omnitron: command not found»,
  // as «Not installed on this node».
  const finding = omnitronFinding(status);
  switch (finding) {
    case 'running':
      return { state: 'online', tooltip: `v${status.omnitronVersion ?? '?'} (${status.omnitronRole ?? '?'})` };
    case 'not-running':
      return { state: 'offline', tooltip: status.omnitronError ?? 'Not running' };
    case 'not-installed':
      return { state: 'not-installed', tooltip: 'Not installed on this node' };
    case 'unreachable':
      // An SSH session that was REFUSED: the check never got far enough to
      // look. `null` is not that — it means this round did not use SSH.
      return { state: 'unchecked', tooltip: status.sshError ? `SSH refused: ${status.sshError}` : 'SSH refused' };
    case 'unread':
      // Asked, and nothing could be read — a timeout, output that was not
      // JSON, no path answering (`null`, 66dae3dc). Not «offline».
      return status.omnitronError
        ? { state: 'unknown', tooltip: `Unknown — ${status.omnitronError}` }
        : { state: 'unchecked', tooltip: 'Not checked yet' };
    default: {
      // Exhaustive at compile time; a finding added later fails to build here.
      const unexpected: never = finding;
      return { state: 'unchecked', tooltip: String(unexpected) };
    }
  }
}

// =============================================================================
// Node Card
// =============================================================================

/** Segment sizing constants */
const SEG_WIDTH = 6;
const SEG_GAP = 4;
const SEG_HEIGHT = 10;

// =============================================================================
// Why a node is down, not just that it was
// =============================================================================

/** The most history the daemon will return in one call. */
const MAX_HISTORY = 500;
const HISTORY_CHOICES = [50, 200, MAX_HISTORY] as const;

/** One check row, as the daemon records it. */
interface HealthCheckRow {
  nodeId: string;
  checkedAt: string;
  checkDurationMs: number;
  pingReachable: boolean;
  pingLatencyMs: number | null;
  pingError: string | null;
  sshConnected: boolean;
  sshLatencyMs: number | null;
  sshError: string | null;
  /** `null` when the check measured nothing about omnitron. */
  omnitronConnected: boolean | null;
  omnitronVersion: string | null;
  omnitronPid: number | null;
  omnitronUptime: number | null;
  omnitronRole: string | null;
  omnitronError: string | null;
  os: { platform: string; arch: string; hostname: string; release: string } | null;
}

const VERDICT_TONE: Record<LayerVerdict, 'success' | 'error' | 'warning' | 'default'> = {
  ok: 'success',
  failed: 'error',
  unknown: 'warning',
  unmeasured: 'default',
};

const VERDICT_WORD: Record<LayerVerdict, string> = {
  ok: 'reachable',
  failed: 'failed',
  unknown: 'unknown',
  unmeasured: 'not measured',
};

/** No result to show: nothing asked, or nothing read. */
const hollow = (verdict: LayerVerdict) => verdict === 'unmeasured' || verdict === 'unknown';

/**
 * One layer of the diagnosis, with its reason as CONTENT.
 *
 * Every field rendered here was already recorded on every check and already
 * reached this page — inside a `tooltip`. So the cause of an outage was
 * available by hovering one indicator on one card, one node at a time, and
 * nowhere else. A reason you have to hunt for is a reason most people do not
 * read.
 */
function DiagnosisLayer({
  label, verdict, latencyMs, error, detail,
}: {
  label: string;
  verdict: LayerVerdict;
  latencyMs?: number | null;
  error?: string | null;
  detail?: string;
}) {
  return (
    <Box sx={{ py: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 96 }}>{label}</Typography>
        <Chip
          size="small"
          label={VERDICT_WORD[verdict]}
          color={VERDICT_TONE[verdict]}
          variant={hollow(verdict) ? 'outlined' : 'filled'}
          sx={{ height: 20, fontSize: 11 }}
        />
        {latencyMs != null && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{latencyMs}ms</Typography>
        )}
        {detail && (
          <Typography variant="caption" noWrap sx={{ color: 'text.secondary' }}>{detail}</Typography>
        )}
      </Stack>
      {error && (
        <Typography
          variant="caption"
          component="pre"
          sx={{
            mt: 0.5, ml: '104px', p: 1, borderRadius: 1,
            bgcolor: (t) => alpha(t.palette.error.main, 0.08),
            color: 'error.main',
            fontFamily: 'monospace', fontSize: 11,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}
        >
          {error}
        </Typography>
      )}
    </Box>
  );
}

/** A history row: when, what each layer said, and the first reason given. */
function HistoryRow({ row, isLocal }: { row: HealthCheckRow; isLocal: boolean }) {
  const ping = verdictOf(row.pingReachable, row.pingError);
  const ssh = verdictOf(row.sshConnected, row.sshError);
  const omn = omnitronVerdict(row);
  const reason = firstReason(row);
  const layers: Array<[string, LayerVerdict]> = isLocal
    ? [['OMNITRON', omn]]
    : [['PING', ping], ['SSH', ssh], ['OMNITRON', omn]];

  return (
    <Box sx={{ py: 0.75, borderBottom: (t) => `1px solid ${t.palette.divider}` }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="caption" sx={{ fontFamily: 'monospace', minWidth: 148, color: 'text.secondary' }}>
          {new Date(row.checkedAt).toLocaleString()}
        </Typography>
        {layers.map(([name, v]) => (
          <Chip
            key={name}
            size="small"
            label={name}
            color={VERDICT_TONE[v]}
            variant={hollow(v) ? 'outlined' : 'filled'}
            sx={{ height: 18, fontSize: 10 }}
          />
        ))}
        <Typography variant="caption" sx={{ color: 'text.disabled', ml: 'auto' }}>
          {row.checkDurationMs}ms
        </Typography>
      </Stack>
      {reason && (
        <Typography
          variant="caption"
          sx={{
            display: 'block', mt: 0.25, ml: '156px',
            color: 'error.main', fontFamily: 'monospace', fontSize: 11,
            wordBreak: 'break-word',
          }}
        >
          {reason}
        </Typography>
      )}
    </Box>
  );
}

/**
 * What the node's own titan-health says.
 *
 * Every omnitron daemon runs `TitanHealthModule` and answers `Health@1.0.0`
 * with titan's built-in indicators — memory, event loop, disk, database,
 * redis — plus the two omnitron registers, docker and the apps it supervises.
 * Every remote node has had all of it since it was provisioned, and this
 * console never asked: its `health` client is bound to `daemonClient.daemon`,
 * so it only ever spoke to the daemon it was connected to.
 *
 * `reachable: false` is rendered as NOT ASKED, with the reason, and never as
 * a verdict. A node outside the mesh has reported nothing; saying "unhealthy"
 * about silence is how an operator ends up restarting a node that was fine.
 */
/**
 * What the node is actually running.
 *
 * Every other reading on this page answers "can we reach it" or "is it
 * well". None of them said what was ON it — so a node with six applications
 * deployed, migrated and started looked exactly like a node with none, and
 * the only way to find out was to open an SSH session.
 *
 * Asked over the mesh, like the indicators beside it: the node answers
 * `OmnitronDaemon.status` about itself, and `reachable: false` carries the
 * reason rather than an empty list, because "we could not ask" and "it runs
 * nothing" are not the same sentence.
 */
function NodeApps({ data }: { data: INodeDaemonAnswer<DaemonStatusDto> | null }) {
  if (!data) {
    return (
      <Typography variant="body2" sx={{ py: 1, color: 'text.secondary' }}>
        Not read.
      </Typography>
    );
  }

  if (!data.reachable || !data.answer) {
    return (
      <Stack direction="row" spacing={1} sx={{ py: 1, alignItems: 'baseline' }}>
        <Chip size="small" label="not asked" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
        <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
          {data.error ?? 'no reason given'}
        </Typography>
      </Stack>
    );
  }

  const status = data.answer;
  if (status.apps.length === 0) {
    return (
      <Typography variant="body2" sx={{ py: 1, color: 'text.secondary' }}>
        The node answered and is running no applications.
      </Typography>
    );
  }

  const tone = (st: string) =>
    st === 'online' ? 'success' : st === 'starting' ? 'warning' : st === 'stopped' ? 'default' : 'error';

  return (
    <Box sx={{ py: 0.5 }}>
      <Typography variant="caption" sx={{ display: 'block', mb: 1, color: 'text.secondary' }}>
        {status.apps.length} app(s) · {status.totalCpu.toFixed(1)}% CPU ·{' '}
        {(status.totalMemory / 1024 / 1024).toFixed(0)} MB
      </Typography>
      {status.apps.map((app) => (
        <Stack
          key={app.name}
          direction="row"
          spacing={1}
          sx={{ py: 0.5, alignItems: 'baseline', flexWrap: 'wrap' }}
        >
          <Chip
            size="small"
            label={app.status}
            color={tone(app.status) as 'success' | 'warning' | 'error' | 'default'}
            sx={{ height: 20, fontSize: 11 }}
          />
          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
            {app.name}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
            {[
              app.pid ? `pid ${app.pid}` : null,
              app.port ? `:${app.port}` : null,
              app.uptime > 0 ? `up ${formatUptime(app.uptime)}` : null,
              app.restarts > 0 ? `${app.restarts} restarts` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
        </Stack>
      ))}
    </Box>
  );
}

/**
 * Where an upgrade got to.
 *
 * The daemon builds the bundle and ships it, which takes minutes; this
 * dialog is the only place that work is visible, so it shows the phase, how
 * far along it is, and — once the build has named one — the version being
 * installed.
 */
function NodeUpgrade({ data }: { data: INodeUpgradeProgress }) {
  const tone =
    data.phase === 'done'
      ? 'success'
      : data.phase === 'failed' || data.phase === 'refused'
        ? 'error'
        : 'warning';
  const running = data.phase !== 'done' && data.phase !== 'failed' && data.phase !== 'refused';

  return (
    <Box sx={{ py: 0.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Chip
          size="small"
          label={data.phase}
          color={tone as 'success' | 'warning' | 'error'}
          sx={{ height: 20, fontSize: 11 }}
        />
        <Typography variant="body2">{data.message}</Typography>
      </Stack>
      {data.version && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary', fontFamily: 'monospace' }}>
          {data.version}
        </Typography>
      )}
      {running && <LinearProgress variant="determinate" value={data.percent} sx={{ mt: 1, height: 4, borderRadius: 2 }} />}
      <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.disabled' }}>
        {new Date(data.at).toLocaleString()}
      </Typography>
    </Box>
  );
}

function NodeIndicators({ data }: { data: INodeIndicators | null }) {
  if (!data) {
    return (
      <Typography variant="body2" sx={{ py: 1, color: 'text.secondary' }}>
        Not read.
      </Typography>
    );
  }

  if (!data.reachable) {
    return (
      <Stack direction="row" spacing={1} sx={{ py: 1, alignItems: 'baseline' }}>
        <Chip size="small" label="not asked" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
        <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
          {data.error ?? 'no reason given'}
        </Typography>
      </Stack>
    );
  }

  const entries = Object.entries(data.indicators ?? {}) as Array<[string, { status?: string; message?: string; details?: Record<string, unknown> }]>;
  if (entries.length === 0) {
    return (
      <Typography variant="body2" sx={{ py: 1, color: 'text.secondary' }}>
        The node answered and registered no indicators.
      </Typography>
    );
  }

  const tone = (st: string | undefined) =>
    st === 'healthy' ? 'success' : st === 'degraded' ? 'warning' : st === 'unhealthy' ? 'error' : 'default';

  return (
    <Box sx={{ py: 0.5 }}>
      {data.status && (
        <Chip
          size="small"
          label={`overall: ${data.status}`}
          color={tone(data.status) as 'success' | 'warning' | 'error' | 'default'}
          sx={{ height: 20, fontSize: 11, mb: 1 }}
        />
      )}
      {entries.map(([name, ind]) => (
        <Stack key={name} direction="row" spacing={1} sx={{ py: 0.4, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <Typography variant="body2" sx={{ minWidth: 120, fontWeight: 500 }}>{name}</Typography>
          <Chip
            size="small"
            label={ind?.status ?? 'unknown'}
            color={tone(ind?.status) as 'success' | 'warning' | 'error' | 'default'}
            variant={ind?.status ? 'filled' : 'outlined'}
            sx={{ height: 18, fontSize: 10 }}
          />
          {ind?.message && (
            <Typography variant="caption" sx={{ color: ind.status === 'healthy' ? 'text.secondary' : 'error.main' }}>
              {ind.message}
            </Typography>
          )}
        </Stack>
      ))}
    </Box>
  );
}

/**
 * Whether the node's data is MOVING.
 *
 * Every other reading here answers "can we reach it". A node can be green on
 * all of them and deliver nothing: 47,407 entries buffered on one node, none
 * delivered, over eleven hours, while the page showed it healthy. Membership
 * in the mesh and movement through it are different questions.
 *
 * `pendingItems` climbing while `lastSyncAt` stands still is the whole
 * diagnosis, and `OmnitronSync.getSyncStatus` has answered it since it was
 * written — its own docblock says "for webapp monitoring", and this console
 * never knew the service existed.
 */
function NodeSyncStatus({ data }: { data: INodeSyncStatus | null }) {
  if (!data) {
    return <Typography variant="body2" sx={{ py: 1, color: 'text.secondary' }}>Not read.</Typography>;
  }
  if (!data.reachable || !data.sync) {
    return (
      <Stack direction="row" spacing={1} sx={{ py: 1, alignItems: 'baseline' }}>
        <Chip size="small" label="not asked" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
        <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
          {data.error ?? 'no reason given'}
        </Typography>
      </Stack>
    );
  }

  const s = data.sync;
  const stalled = s.pendingItems > 0 && !s.connected;
  return (
    <Box sx={{ py: 0.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 0.5 }}>
        <Chip
          size="small"
          label={s.connected ? 'delivering' : s.pendingItems > 0 ? 'holding' : 'idle'}
          color={stalled ? 'warning' : s.connected ? 'success' : 'default'}
          sx={{ height: 20, fontSize: 11 }}
        />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {/* A count with no age is half the answer: a buffer of 40,000 that
              drained a second ago is healthy, and one of 12 that has not moved
              since yesterday is not. */}
          {s.pendingItems} pending · {Math.round(s.bufferSize / 1024)} KB · last delivery{' '}
          {s.lastSyncAt ? formatAge(new Date(s.lastSyncAt).toISOString()) : 'never'}
        </Typography>
        {s.failedAttempts > 0 && (
          <Chip size="small" color="error" label={`${s.failedAttempts} failed attempts`} sx={{ height: 18, fontSize: 10 }} />
        )}
      </Stack>
      {s.lastError && (
        <Typography
          variant="caption"
          sx={{ display: 'block', color: 'error.main', fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-word' }}
        >
          {s.lastError}
        </Typography>
      )}
    </Box>
  );
}

/**
 * Whether the fleet agrees on who leads it.
 *
 * The only reading here that is meaningless per node. One node naming a leader
 * is unremarkable; two naming DIFFERENT leaders, or sitting in different
 * terms, is a split brain — every node individually healthy and the fleet not.
 * Shown once at the top rather than on each card, because a disagreement has
 * no single card to live on.
 *
 * Silent when the fleet agrees, and silent when fewer than two nodes could be
 * asked: one answer cannot disagree with anything, and drawing "consistent"
 * from a sample of one is how a check gets believed for the wrong reason.
 */
function ClusterAgreement({ states }: { states: Record<string, INodeClusterState> }) {
  const d = clusterDisagreement(Object.values(states) as never);
  if (d.kind === 'none') return null;

  return (
    <FormAlert severity="warning">
      {d.kind === 'leaders'
        ? `${d.answered} nodes name ${d.groups.length} different leaders: ` +
          d.groups.map(([l, ids]) => `${l} (${ids.length})`).join(', ')
        : `${d.answered} nodes are in ${d.terms.length} different election terms: ${d.terms.join(', ')}`}
    </FormAlert>
  );
}

/**
 * The telemetry relay, and the one counter in the fleet that reports LOSS.
 *
 * `NodeSyncStatus` above is the log/metric replication; this is the other
 * pipe. `totalDropped` is what the relay's buffer threw away because it was
 * full — a number that only ever goes up, and which nothing has ever
 * displayed, so a gap in a chart is discovered from the chart.
 *
 * `OmnitronTelemetry.getRelayStats` has answered this since it was written;
 * the file's own header says "Webapp → Leader telemetry stats (relay
 * health)", and the console never called it.
 */
export function NodeRelay({ data }: { data: INodeRelayStats | null }) {
  // Not read at all — the dialog has not asked yet. Nothing to say.
  if (!data) return null;

  // Asked and refused. This was `return null` alongside the other two
  // branches, so a node that could not answer looked exactly like a node
  // with a healthy relay: the row simply was not there. `NodeIndicators` and
  // `NodeSyncStatus` beside it both say «not asked» and print the reason,
  // and this is the third copy of that decision, written the other way.
  //
  // It mattered more than it looks: until `getRelayStats` was moved to
  // CONTROL_PLANE_READ_ROLES today, every node refused this read with
  // «Missing required role», so the empty space WAS the permanent state and
  // nothing anywhere said why.
  if (!data.reachable || !data.relay) {
    return (
      <Stack direction="row" spacing={1} sx={{ py: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="caption" sx={{ minWidth: 96, color: 'text.secondary' }}>telemetry</Typography>
        <Chip size="small" label="not asked" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
        <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
          {data.error ?? 'no reason given'}
        </Typography>
      </Stack>
    );
  }

  const r = data.relay as {
    buffer?: { size?: number; totalPushed?: number; totalDropped?: number; totalFlushed?: number };
    wal?: { size?: number } | null;
    totalSent?: number;
    totalFailed?: number;
    totalReceived?: number;
    transportConnected?: boolean;
  };
  const dropped = r.buffer?.totalDropped ?? 0;

  return (
    <Stack direction="row" spacing={1} sx={{ py: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
      <Typography variant="caption" sx={{ minWidth: 96, color: 'text.secondary' }}>telemetry</Typography>
      <Chip
        size="small"
        label={r.transportConnected ? 'transport up' : 'transport down'}
        color={r.transportConnected ? 'success' : 'default'}
        variant={r.transportConnected ? 'filled' : 'outlined'}
        sx={{ height: 18, fontSize: 10 }}
      />
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {r.buffer?.size ?? 0} buffered · {r.totalSent ?? 0} sent · {r.totalFailed ?? 0} failed
      </Typography>
      {dropped > 0 && (
        // Loud, and only when it has happened: a zero here is the normal case
        // and a chip that is always present stops being read.
        <Chip size="small" color="error" label={`${dropped} DROPPED`} sx={{ height: 18, fontSize: 10 }} />
      )}
    </Stack>
  );
}

/**
 * Everything the daemon already knows about why a node is unwell.
 *
 * Each check records three layers with their own error string — whether the
 * box answers, whether SSH lets you in, whether the daemon replies — and they
 * are three different problems with three different remedies. `getCheckHistory`
 * returned all of it and had no caller anywhere in this console; the uptime
 * bar showed THAT a node was down and never why.
 */
function NodeDiagnosisDialog({
  open, onClose, node,
}: {
  open: boolean;
  onClose: () => void;
  node: INodeWithStatus | null;
}) {
  const [history, setHistory] = useState<HealthCheckRow[]>([]);
  const [indicators, setIndicators] = useState<INodeIndicators | null>(null);
  const [sync, setSync] = useState<INodeSyncStatus | null>(null);
  const [relay, setRelay] = useState<INodeRelayStats | null>(null);
  const [summary, setSummary] = useState<{ status: string; lastSeenOnline: string | null; consecutiveFailures: number } | null>(null);
  const [limit, setLimit] = useState<number>(50);
  const [apps, setApps] = useState<INodeDaemonAnswer<DaemonStatusDto> | null>(null);
  const [upgrade, setUpgrade] = useState<INodeUpgradeProgress | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const snackbar = useSnackbar();

  const load = useCallback(async (nodeId: string, n: number) => {
    setLoading(true);
    setError(null);
    try {
      // Two independent answers, so one failing must not blank the other: the
      // history comes from this master's database and the indicators from the
      // node itself, and a node that cannot be reached still has a history
      // worth reading — that history is how you find out when it stopped.
      const [rows, ind, syn, rel, sums, running, upgrades] = await Promise.allSettled([
        nodesRpc.getCheckHistory({ nodeId, limit: n }),
        nodesRpc.getNodeIndicators({ nodeId }),
        nodesRpc.getNodeSyncStatus({ nodeId }),
        nodesRpc.getNodeRelayStats({ nodeId }),
        nodesRpc.getNodeHealthSummaries(),
        nodesRpc.getNodeDaemonStatus({ nodeId }),
        nodesRpc.getUpgradeProgress(),
      ]);
      setApps(running.status === 'fulfilled' ? (running.value as INodeDaemonAnswer<DaemonStatusDto>) : null);
      setUpgrade(
        upgrades.status === 'fulfilled'
          ? ((upgrades.value as INodeUpgradeProgress[]).find((u) => u.nodeId === nodeId) ?? null)
          : null,
      );
      setIndicators(ind.status === 'fulfilled' ? (ind.value as INodeIndicators) : null);
      setSync(syn.status === 'fulfilled' ? (syn.value as INodeSyncStatus) : null);
      setRelay(rel.status === 'fulfilled' ? (rel.value as INodeRelayStats) : null);
      // `consecutiveFailures` and `lastSeenOnline` live only here: a node that
      // blinked once and a node that has been down since Tuesday look the same
      // in every other reading on this page, and they are not the same
      // problem. The worker keeps this; nothing displayed it.
      setSummary(
        sums.status === 'fulfilled'
          ? ((sums.value as Array<{ nodeId: string; status: string; lastSeenOnline: string | null; consecutiveFailures: number }>)
              .find((x) => x.nodeId === nodeId) ?? null)
          : null,
      );
      if (rows.status === 'rejected') throw rows.reason;
      setHistory(rows.value as HealthCheckRow[]);
    } catch (err) {
      // An empty list and a failed read are different answers, and a reader
      // who cannot tell them apart concludes the node has never been checked.
      setError(err instanceof Error ? err.message : String(err));
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && node) void load(node.id, limit);
  }, [open, node, limit, load]);

  // While an upgrade is running, this dialog is the only place it is
  // visible. Five seconds is slow enough not to matter and fast enough that
  // a phase change does not look like a hang.
  const upgradeRunning =
    upgrade !== null && upgrade.phase !== 'done' && upgrade.phase !== 'failed' && upgrade.phase !== 'refused';
  usePollingEffect(
    () => {
      if (open && node) void load(node.id, limit);
    },
    { intervalMs: 5_000, enabled: open && upgradeRunning },
  );

  /**
   * Start an upgrade and keep polling while it runs.
   *
   * The daemon builds the bundle, so this returns as soon as the work is
   * under way — a build is minutes — and the dialog's own refresh shows
   * where it got to.
   */
  const startUpgrade = useCallback(async () => {
    if (!node) return;
    setUpgrading(true);
    try {
      const outcome = await nodesRpc.upgradeNode({ nodeId: node.id });
      if (!outcome.started) {
        snackbar.warning(outcome.reason ?? 'The daemon refused to start an upgrade');
        return;
      }
      snackbar.info('Building a bundle — this takes a few minutes');
      await load(node.id, limit);
    } catch (err) {
      snackbar.error(err instanceof Error ? err.message : 'Could not start the upgrade');
    } finally {
      setUpgrading(false);
    }
  }, [node, limit, load, snackbar]);

  const recheck = useCallback(async () => {
    if (!node) return;
    setChecking(true);
    try {
      await nodesRpc.triggerNodeCheck({ nodeId: node.id });
      await load(node.id, limit);
      snackbar.success('Check complete');
    } catch (err) {
      snackbar.error(err instanceof Error ? err.message : 'Check failed');
    } finally {
      setChecking(false);
    }
  }, [node, limit, load, snackbar]);

  if (!node) return null;
  const s = node.status;
  const isLocal = node.isLocal;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Box component="span">Diagnostics — {node.name}</Box>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {isLocal ? 'this daemon' : `${node.host}:${node.daemonPort}`}
          </Typography>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        <Typography variant="overline" sx={{ color: 'text.secondary' }}>Last check</Typography>
        {summary && (summary.consecutiveFailures > 0 || summary.lastSeenOnline) && (
          <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            {summary.consecutiveFailures > 0 && (
              <Chip
                size="small"
                color={summary.consecutiveFailures > 3 ? 'error' : 'warning'}
                label={`${summary.consecutiveFailures} consecutive failures`}
                sx={{ height: 20, fontSize: 11 }}
              />
            )}
            {summary.lastSeenOnline && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                last seen online {formatAge(summary.lastSeenOnline)}
              </Typography>
            )}
          </Stack>
        )}
        {s ? (
          <Box sx={{ mb: 2 }}>
            {!isLocal && (
              <>
                <DiagnosisLayer
                  label="PING"
                  verdict={verdictOf(s.pingReachable, s.pingError)}
                  latencyMs={s.pingLatencyMs}
                  error={s.pingError ?? null}
                />
                <DiagnosisLayer
                  label="SSH"
                  verdict={verdictOf(s.sshConnected, s.sshError)}
                  latencyMs={s.sshLatencyMs}
                  error={s.sshError ?? null}
                  detail={s.sshConnected == null && !s.sshError ? 'this check reaches the node over Netron' : undefined}
                />
              </>
            )}
            <DiagnosisLayer
              label="OMNITRON"
              verdict={omnitronVerdict(s)}
              error={s.omnitronError ?? null}
              detail={s.omnitronConnected
                ? [s.omnitronVersion && `v${s.omnitronVersion}`, s.omnitronPid && `pid ${s.omnitronPid}`,
                   s.omnitronUptime != null && s.omnitronUptime > 0 && `up ${formatUptime(s.omnitronUptime)}`]
                  .filter(Boolean).join(' · ')
                : undefined}
            />
            <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.disabled' }}>
              {s.checkedAt ? `Taken ${new Date(s.checkedAt).toLocaleString()}` : 'Never checked'}
            </Typography>
          </Box>
        ) : (
          <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
            This node has never been checked.
          </Typography>
        )}

        <Divider sx={{ my: 2 }} />

        <Typography variant="overline" sx={{ color: 'text.secondary' }}>
          Indicators, from the node&apos;s own titan-health
        </Typography>
        <NodeIndicators data={indicators} />

        <Divider sx={{ my: 2 }} />

        <Typography variant="overline" sx={{ color: 'text.secondary' }}>
          Running on this node
        </Typography>
        <NodeApps data={apps} />

        <Divider sx={{ my: 2 }} />

        <Typography variant="overline" sx={{ color: 'text.secondary' }}>Replication</Typography>
        <NodeSyncStatus data={sync} />
        <NodeRelay data={relay} />

        <Divider sx={{ my: 2 }} />

        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
          <Typography variant="overline" sx={{ color: 'text.secondary' }}>History</Typography>
          <FormControl size="small" sx={{ ml: 'auto', minWidth: 120 }}>
            <Select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              sx={{ height: 30, fontSize: 12 }}
            >
              {HISTORY_CHOICES.map((n) => (
                <MenuItem key={n} value={n} sx={{ fontSize: 12 }}>last {n} checks</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>

        {error && <FormAlert onClose={() => setError(null)}>{error}</FormAlert>}

        {loading && history.length === 0 ? (
          <Skeleton height={120} />
        ) : history.length === 0 && !error ? (
          <Typography variant="body2" sx={{ py: 2, color: 'text.secondary' }}>
            No checks recorded. History is kept by the daemon that runs the health worker.
          </Typography>
        ) : (
          <Box sx={{ maxHeight: 360, overflowY: 'auto' }}>
            {history.map((row) => (
              <HistoryRow key={`${row.nodeId}-${row.checkedAt}`} row={row} isLocal={isLocal} />
            ))}
          </Box>
        )}
        {upgrade && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>
              Omnitron upgrade
            </Typography>
            <NodeUpgrade data={upgrade} />
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={recheck} disabled={checking} startIcon={<RefreshIcon sx={{ fontSize: 16 }} />}>
          {checking ? 'Checking…' : 'Check now'}
        </Button>
        {!isLocal && (
          <Button
            onClick={startUpgrade}
            disabled={upgrading || upgradeRunning}
            startIcon={<DeployIcon sx={{ fontSize: 16 }} />}
          >
            {upgradeRunning ? 'Upgrading…' : 'Upgrade omnitron'}
          </Button>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function NodeCard({
  node, onEdit, onRemove, onCheckSsh, onDiagnose, checking, uptimeData, lastCheckAt, newest, mesh,
}: {
  node: INodeWithStatus;
  onEdit: (n: INodeWithStatus) => void;
  onRemove: (id: string) => void;
  onCheckSsh: (id: string) => void;
  onDiagnose: (n: INodeWithStatus) => void;
  checking: boolean;
  uptimeData: UptimeBucket[];
  lastCheckAt: string | null;
  /** The newest version anything in this fleet reports. */
  newest: string | undefined;
  /** Whether this node is replicating, or undefined before the first answer. */
  mesh: IMeshNodeStatus | undefined;
}) {
  const { status } = node;
  // PING/OMNITRON dots reflect periodic worker checks — NOT the SSH button state
  const omnState = getOmnitronDotState(status, node.isLocal);
  const pingState: DotState = status?.pingReachable == null ? 'unchecked'
    : status.pingReachable ? 'online' : 'offline';
  // The local node's facts are read from this daemon's own process on every
  // request, so they are never stale; only a remote node's reading has an age.
  const stale = !node.isLocal && isStale(status?.checkedAt);

  return (
    <Card sx={{
      height: '100%', display: 'flex', flexDirection: 'column',
      transition: 'box-shadow 0.2s', '&:hover': { boxShadow: (t) => t.shadows[8] },
    }}>
      <CardContent sx={{ pb: '12px !important', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <Stack
          direction="row"
          sx={{
            alignItems: "flex-start",
            justifyContent: "space-between",
            mb: 1.5
          }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: "center",
              minWidth: 0
            }}>
            {node.isLocal
              ? <ChipIcon sx={{ fontSize: 24, color: 'primary.main', flexShrink: 0 }} />
              : <NodesIcon sx={{ fontSize: 24, color: 'text.secondary', flexShrink: 0 }} />}
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" noWrap>{node.name}</Typography>
              <Typography variant="caption" noWrap sx={{
                color: "text.disabled"
              }}>
                {node.host}{node.isLocal ? '' : `:${node.sshPort}`}
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={0}>
            {!node.isLocal && (
              <Tooltip title={checking ? 'Checking...' : 'Check SSH connection'}>
                {/* MUI needs a span to hold a tooltip over a DISABLED button,
                    and the tooltip's label lands on that span rather than on
                    the button — so the button itself announced as just
                    "button". Every other icon button in the console gets its
                    name from its tooltip; this one has to say it directly. */}
                <span>
                  <IconButton
                    size="small"
                    aria-label="Check SSH connection"
                    onClick={() => onCheckSsh(node.id)}
                    disabled={checking}
                  >
                    <RefreshIcon sx={{ fontSize: 18, ...(checking && { animation: `${spin} 1s linear infinite` }) }} />
                  </IconButton>
                </span>
              </Tooltip>
            )}
            {/* Available for the local node too: a daemon can be unwell on the
                machine you are standing on, and the reason is recorded the
                same way. */}
            <Tooltip title="Diagnostics">
              <IconButton size="small" onClick={() => onDiagnose(node)}>
                <EyeIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            {!node.isLocal && (
              <>
                <Tooltip title="Edit"><IconButton size="small" onClick={() => onEdit(node)}><SettingsIcon sx={{ fontSize: 18 }} /></IconButton></Tooltip>
                <Tooltip title="Remove"><IconButton size="small" onClick={() => onRemove(node.id)} color="error"><DeleteIcon sx={{ fontSize: 18 }} /></IconButton></Tooltip>
              </>
            )}
          </Stack>
        </Stack>

        {/* Status dots: PING + OMNITRON, and when the reading was taken */}
        <Stack
          direction="row"
          spacing={2}
          sx={{ mb: 1.5, alignItems: 'center' }}
        >
          {node.isLocal ? (
            <StatusDot state={omnState.state} label="OMNITRON" tooltip={omnState.tooltip} />
          ) : (
            <>
              <StatusDot state={pingState} label="PING"
                tooltip={status?.pingReachable ? `${status.pingLatencyMs ?? '?'}ms` : status?.pingError ?? 'Not checked'} />
              <StatusDot state={omnState.state} label="OMNITRON" tooltip={omnState.tooltip} />
            </>
          )}
          {/* A reachability answer is worth what its age says it is worth.
              Without this the card showed a two-day-old reading and a
              freshly-taken one identically. */}
          <Tooltip
            arrow
            title={
              status?.checkedAt
                ? `Last checked ${new Date(status.checkedAt).toLocaleString()}`
                : 'This node has never been checked'
            }
          >
            <Typography
              variant="caption"
              noWrap
              sx={{
                ml: 'auto',
                fontSize: 10,
                color: stale ? 'warning.main' : 'text.disabled',
              }}
            >
              {formatAge(status?.checkedAt)}
            </Typography>
          </Tooltip>
        </Stack>

        <Divider sx={{ mb: 1.5 }} />

        {/* Details */}
        <Stack spacing={0.5}>
          {status?.omnitronVersion && (
            <VersionRow version={status.omnitronVersion} standing={versionStanding(status.omnitronVersion, newest)} />
          )}
          <DetailRow label="Runtime" value={node.runtime} />
          <DetailRow label="Daemon Port" value={String(node.daemonPort)} />
          {!node.isLocal && <DetailRow label="SSH User" value={node.sshUser} />}
          {status?.os && <DetailRow label="OS" value={`${status.os.platform} ${status.os.arch}`} />}
          {status?.omnitronUptime != null && status.omnitronUptime > 0 && (
            <DetailRow label="Uptime" value={formatUptime(status.omnitronUptime)} />
          )}
          {!node.isLocal && <MeshRow mesh={mesh} />}
        </Stack>

        {node.tags.length > 0 && (
          <Stack
            direction="row"
            spacing={0.5}
            useFlexGap
            sx={{
              mt: 1.5,
              flexWrap: "wrap"
            }}>
            {node.tags.map((tag) => (
              <Chip key={tag} label={tag} size="small" variant="outlined" sx={{ height: 22, fontSize: 11 }} />
            ))}
          </Stack>
        )}

        {/* Uptime bars — remote nodes only */}
        {!node.isLocal && (
          <Box sx={{ mt: 'auto', pt: 1.5 }}>
            <Stack spacing={0.75}>
              <UptimeStrip data={uptimeData} metric="ping" label="PING" segWidth={SEG_WIDTH} gap={SEG_GAP} height={SEG_HEIGHT} lastCheckAt={lastCheckAt} />
              <UptimeStrip data={uptimeData} metric="omnitron" label="OMNITRON" segWidth={SEG_WIDTH} gap={SEG_GAP} height={SEG_HEIGHT} lastCheckAt={lastCheckAt} />
            </Stack>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Whether a node's data is reaching this master.
 *
 * Every other signal on this card answers "can we reach it" — SSH, a ping, a
 * daemon that replies with its version. A node can be green on all of them
 * and replicate nothing, and for every registered node that no stack had
 * been deployed onto, that is exactly what happened: 47,407 entries buffered
 * on one, none delivered, over eleven hours, while this page showed it
 * healthy. Reachability and membership are different questions and the card
 * now asks both.
 */
export type MeshStanding =
  | { text: 'not joined'; tone: 'idle'; tooltip: string }
  | { text: 'failing'; tone: 'bad'; tooltip: string }
  | { text: 'joining'; tone: 'quiet'; tooltip: string }
  | { text: 'unauthenticated'; tone: 'warn'; tooltip: string }
  | { text: 'over SSH'; tone: 'info'; tooltip: string }
  | { text: 'direct'; tone: 'good'; tooltip: string };

/**
 * What to say about a node's membership, given what the daemon reported.
 *
 * Its own function because the order of these tests is the whole content of
 * the row, and it is the part that is easy to get wrong: `connected` is
 * checked BEFORE `authenticated`, so a live connection that can pull nothing
 * reads as a warning rather than as health. That state — pings fine,
 * replicates nothing — is the one that looks best and carries least.
 */
export function meshStanding(mesh: IMeshNodeStatus): MeshStanding {
  const heartbeat = mesh.lastHeartbeat
    ? ` Last heartbeat ${formatAge(new Date(mesh.lastHeartbeat).toISOString())}.`
    : '';

  if (!mesh.inMesh || mesh.status === 'disconnected') {
    return {
      text: 'not joined',
      tone: 'idle',
      tooltip: mesh.lastError ?? 'This master is not connected to the node. Nothing it collects is being replicated.',
    };
  }
  if (mesh.status === 'error') {
    return { text: 'failing', tone: 'bad', tooltip: mesh.lastError ?? 'The connection to this node is failing.' };
  }
  if (mesh.status === 'connecting') {
    return { text: 'joining', tone: 'quiet', tooltip: 'Connecting.' };
  }
  if (!mesh.authenticated) {
    return {
      text: 'unauthenticated',
      tone: 'warn',
      tooltip: 'Connected, but without a credential this node accepts — it answers pings and replicates nothing.',
    };
  }
  if (mesh.via === 'ssh-tunnel') {
    return {
      text: 'over SSH',
      tone: 'info',
      tooltip: `Replicating through an SSH tunnel: this node's daemon port is not open to this master.${heartbeat}`,
    };
  }
  return {
    text: 'direct',
    tone: 'good',
    tooltip: `Replicating over a direct connection to the daemon port.${heartbeat}`,
  };
}

const MESH_TONE: Record<MeshStanding['tone'], string> = {
  idle: 'text.disabled',
  quiet: 'text.secondary',
  bad: 'error.main',
  warn: 'warning.main',
  info: 'info.main',
  good: 'success.main',
};

function MeshRow({ mesh }: { mesh: IMeshNodeStatus | undefined }) {
  if (!mesh) return null;
  const standing = meshStanding(mesh);

  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 11 }}>Mesh</Typography>
      <Tooltip arrow title={standing.tooltip}>
        <Typography variant="caption" noWrap sx={{ fontSize: 11, color: MESH_TONE[standing.tone], maxWidth: 190 }}>
          {standing.text}
        </Typography>
      </Tooltip>
    </Stack>
  );
}

/**
 * The version a node runs, and whether it is the newest the fleet has.
 *
 * Shown as a row rather than only in the dot's tooltip, because "which of my
 * nodes are behind" is a question about the fleet and a tooltip answers it
 * one hover at a time.
 *
 * A local build's version is long — `0.2.0+local.<12 chars>.<12 digits>` — so
 * the row shows the base and the short commit, with the whole string on
 * hover. The commit is what identifies the build to a person; the stamp is
 * what orders them, and it is in the tooltip where it can be read exactly.
 */
function VersionRow({ version, standing }: { version: string; standing: VersionStanding }) {
  const [base, local] = version.split('+');
  const commit = local?.split('.')[1];
  const shown = commit ? `${base} · ${commit.slice(0, 7)}` : base!;

  const mark =
    standing === 'behind' ? { text: 'behind', color: 'warning.main' as const }
    : standing === 'differs' ? { text: 'differs', color: 'info.main' as const }
    : null;

  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 11 }}>Version</Typography>
      <Tooltip arrow title={version}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          {mark && (
            <Typography variant="caption" sx={{ fontSize: 10, color: mark.color }}>{mark.text}</Typography>
          )}
          <Typography variant="caption" noWrap sx={{ fontSize: 11, maxWidth: 190 }}>{shown}</Typography>
        </Stack>
      </Tooltip>
    </Stack>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack
      direction="row"
      sx={{
        justifyContent: "space-between",
        alignItems: "center"
      }}>
      <Typography variant="caption" sx={{
        color: "text.disabled"
      }}>{label}</Typography>
      <Typography variant="caption" sx={{
        fontWeight: 500
      }}>{value}</Typography>
    </Stack>
  );
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

// =============================================================================
// Add/Edit Dialog
// =============================================================================

interface NodeFormData {
  name: string; host: string; sshPort: number; sshUser: string;
  sshAuthMethod: 'password' | 'key'; sshPrivateKey: string; sshPassphrase: string; sshPassword: string;
  runtime: 'node' | 'bun'; daemonPort: number; tags: string;
}

const INITIAL_FORM: NodeFormData = {
  name: '', host: '', sshPort: 22, sshUser: 'root', sshAuthMethod: 'key',
  sshPrivateKey: '', sshPassphrase: '', sshPassword: '', runtime: 'node', daemonPort: 9700, tags: '',
};

function NodeDialog({ open, onClose, onSubmit, editNode, sshKeys, loading, error, onDismissError }: {
  open: boolean; onClose: () => void; onSubmit: (d: NodeFormData) => void;
  editNode: INodeWithStatus | null; sshKeys: SshKeyInfo[]; loading: boolean;
  error: string | null; onDismissError: () => void;
}) {
  const [form, setForm] = useState<NodeFormData>(INITIAL_FORM);
  useEffect(() => {
    if (!open) return;
    if (editNode) {
      setForm({
        name: editNode.name, host: editNode.host, sshPort: editNode.sshPort,
        sshUser: editNode.sshUser, sshAuthMethod: editNode.sshAuthMethod,
        sshPrivateKey: editNode.sshPrivateKey ?? '', sshPassphrase: '', sshPassword: '',
        runtime: editNode.runtime, daemonPort: editNode.daemonPort, tags: editNode.tags.join(', '),
      });
    } else {
      setForm({ ...INITIAL_FORM, sshPrivateKey: sshKeys[0]?.path ?? '' });
    }
  }, [editNode, sshKeys, open]);

  const up = (f: keyof NodeFormData, v: string | number) => setForm((p) => ({ ...p, [f]: v }));
  const isEdit = !!editNode;
  const canSubmit = form.name.trim() && form.host.trim();

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? `Edit "${editNode.name}"` : 'Add Node'}</DialogTitle>
      <DialogContent sx={{ pt: '8px !important' }}>
        {error && <FormAlert onClose={onDismissError}>{error}</FormAlert>}
        <Stack spacing={2.5} sx={{
          mt: 1
        }}>
          <TextField label="Name" value={form.name} onChange={(e) => up('name', e.target.value)} fullWidth placeholder="production-server-1" autoFocus />
          <Stack direction="row" spacing={2}>
            <TextField label="Host" value={form.host} onChange={(e) => up('host', e.target.value)} fullWidth placeholder="192.168.1.100" />
            <TextField label="SSH Port" value={form.sshPort} onChange={(e) => up('sshPort', parseInt(e.target.value, 10) || 22)} sx={{ width: 120 }} type="number" />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField label="SSH User" value={form.sshUser} onChange={(e) => up('sshUser', e.target.value)} fullWidth />
            <FormControl sx={{ minWidth: 160 }}>
              <InputLabel>Auth Method</InputLabel>
              <Select value={form.sshAuthMethod} label="Auth Method" onChange={(e) => up('sshAuthMethod', e.target.value)}>
                <MenuItem value="key">SSH Key</MenuItem>
                <MenuItem value="password">Password</MenuItem>
              </Select>
            </FormControl>
          </Stack>
          {form.sshAuthMethod === 'key' ? (
            <>
              <FormControl fullWidth>
                <InputLabel>SSH Private Key</InputLabel>
                <Select value={form.sshPrivateKey} label="SSH Private Key" onChange={(e) => up('sshPrivateKey', e.target.value as string)}>
                  {sshKeys.map((key) => (
                    <MenuItem key={key.path} value={key.path}>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{
                          alignItems: "center",
                          width: '100%'
                        }}>
                        <Typography variant="body2" sx={{
                          fontWeight: 500
                        }}>{key.name}</Typography>
                        <Chip label={key.type} size="small" sx={{ height: 20, fontSize: 11 }} />
                        <Typography
                          variant="caption"
                          noWrap
                          sx={{
                            color: "text.disabled",
                            ml: 'auto'
                          }}>{key.path}</Typography>
                      </Stack>
                    </MenuItem>
                  ))}
                  {sshKeys.length === 0 && <MenuItem disabled><Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>No SSH keys found</Typography></MenuItem>}
                </Select>
              </FormControl>
              <TextField
                label="Key Passphrase"
                value={form.sshPassphrase}
                onChange={(e) => up('sshPassphrase', e.target.value)}
                fullWidth
                type="password"
                placeholder={editNode?.hasPassphrase ? 'Encrypted — leave empty to keep' : 'Leave empty if key is not encrypted'}
                size="small"
                helperText={editNode?.hasPassphrase ? 'Passphrase is stored encrypted. Enter new value to change.' : undefined}
              />
            </>
          ) : (
            <TextField
              label="SSH Password"
              value={form.sshPassword}
              onChange={(e) => up('sshPassword', e.target.value)}
              fullWidth
              type="password"
              placeholder={editNode?.hasPassword ? 'Stored — leave empty to keep' : ''}
              helperText={editNode?.hasPassword ? 'Password is stored encrypted. Enter a new value to change it.' : undefined}
            />
          )}
          <Divider />
          <Stack direction="row" spacing={2}>
            <FormControl sx={{ minWidth: 140 }}>
              <InputLabel>Runtime</InputLabel>
              <Select value={form.runtime} label="Runtime" onChange={(e) => up('runtime', e.target.value)}>
                <MenuItem value="node">Node.js</MenuItem>
                <MenuItem value="bun">Bun</MenuItem>
              </Select>
            </FormControl>
            <TextField label="Daemon Port" value={form.daemonPort} onChange={(e) => up('daemonPort', parseInt(e.target.value, 10) || 9700)} sx={{ width: 140 }} type="number" />
            <TextField label="Tags" value={form.tags} onChange={(e) => up('tags', e.target.value)} fullWidth placeholder="production, gpu" helperText="Comma-separated" />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">Cancel</Button>
        <Button variant="contained" onClick={() => onSubmit(form)} disabled={!canSubmit || loading}>{isEdit ? 'Save' : 'Add Node'}</Button>
      </DialogActions>
    </Dialog>
  );
}

// =============================================================================
// Check settings
// =============================================================================

/**
 * How the fleet is checked.
 *
 * These values existed on the daemon, were readable and writable over RPC,
 * and had no surface anywhere — and would not have worked if they had: they
 * were held in a field that only the daemon's own fallback path read, never
 * persisted, and never sent to the worker that performs the checks. All
 * three are fixed on the daemon side; this is the control that was missing.
 */
function CheckSettingsDialog({ open, onClose, onSaved }: {
  open: boolean;
  onClose: () => void;
  onSaved: (config: NodeCheckConfig) => void;
}) {
  const [config, setConfig] = useState<NodeCheckConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    nodesRpc.getCheckConfig()
      .then((c: NodeCheckConfig) => setConfig(c))
      .catch((err: Error) => setError(err?.message ?? 'Could not read the current settings'));
  }, [open]);

  const up = (field: keyof NodeCheckConfig, value: number | boolean) =>
    setConfig((prev) => (prev ? { ...prev, [field]: value } : prev));

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      // The daemon clamps these and answers with what it stored, which is
      // not always what was sent — so the caller is handed back the stored
      // values rather than the typed ones.
      const saved: NodeCheckConfig = await nodesRpc.setCheckConfig(config);
      onSaved(saved);
      onClose();
    } catch (err) {
      setError((err as Error)?.message ?? 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Check Settings</DialogTitle>
      <DialogContent sx={{ pt: '8px !important' }}>
        {error && <FormAlert onClose={() => setError(null)}>{error}</FormAlert>}
        {!config ? (
          <Skeleton variant="rounded" height={220} />
        ) : (
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>ICMP Ping</InputLabel>
              <Select
                value={config.pingEnabled ? 'on' : 'off'}
                label="ICMP Ping"
                onChange={(e) => up('pingEnabled', e.target.value === 'on')}
              >
                <MenuItem value="on">Enabled</MenuItem>
                <MenuItem value="off">Disabled</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Ping timeout (ms)" type="number" fullWidth value={config.pingTimeout}
              onChange={(e) => up('pingTimeout', parseInt(e.target.value, 10) || 0)}
              helperText="250-60000"
              disabled={!config.pingEnabled}
            />
            <TextField
              label="SSH timeout (ms)" type="number" fullWidth value={config.sshTimeout}
              onChange={(e) => up('sshTimeout', parseInt(e.target.value, 10) || 0)}
              helperText="1000-120000"
            />
            <TextField
              label="Omnitron probe timeout (ms)" type="number" fullWidth value={config.omnitronCheckTimeout}
              onChange={(e) => up('omnitronCheckTimeout', parseInt(e.target.value, 10) || 0)}
              helperText="1000-120000"
            />
            <TextField
              label="Concurrent checks" type="number" fullWidth value={config.concurrency}
              onChange={(e) => up('concurrency', parseInt(e.target.value, 10) || 0)}
              helperText="1-100 - how many nodes are checked at once"
            />
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={!config || saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// =============================================================================
// Page
// =============================================================================

export default function NodesPage() {
  const [nodeList, setNodeList] = useState<INodeWithStatus[]>([]);
  const [sshKeys, setSshKeys] = useState<SshKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editNode, setEditNode] = useState<INodeWithStatus | null>(null);
  const [diagnoseNode, setDiagnoseNode] = useState<INodeWithStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uptimeBars, setUptimeBars] = useState<Record<string, UptimeBucket[]>>({});
  // When each node's history last RECORDED a check — the only honest answer
  // to «is this strip current». A bucket can be hours wide, so an empty
  // newest bucket proves nothing either way.
  const [lastCheckAt, setLastCheckAt] = useState<Record<string, string | null>>({});
  const [listError, setListError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [history, setHistory] = useState<FleetHistoryConfig>({
    uptimeIntervalMs: DEFAULT_UPTIME_BUCKET_MS,
    retentionDays: DEFAULT_RETENTION_DAYS,
  });
  const historyRef = useRef(history);
  historyRef.current = history;

  /** Why the uptime bars are not current, when they are not. */
  const [barsError, setBarsError] = useState<string | null>(null);

  /** The last list that arrived, so a failed poll can return it unchanged. */
  const nodeListRef = useRef<INodeWithStatus[]>([]);
  nodeListRef.current = nodeList;

  const [mesh, setMesh] = useState<Record<string, IMeshNodeStatus>>({});
  const [clusterStates, setClusterStates] = useState<Record<string, INodeClusterState>>({});

  const fetchNodes = useCallback(async () => {
    try {
      const list: INodeWithStatus[] = await nodesRpc.listNodes();
      setNodeList(list);
      setListError(null);
      return list;
    } catch (err) {
      // Keep whatever was on screen. This page polls, so blanking the list
      // on a failed call means one bad poll reports an EMPTY FLEET — on the
      // page whose entire job is to show the fleet, and indistinguishably
      // from a fleet with nothing registered. The last good answer plus a
      // visible reason is strictly more information than an empty grid.
      setListError((err as Error)?.message ?? 'Could not reach the daemon');
      return nodeListRef.current;
    } finally { setLoading(false); }
  }, []);

  const fetchMesh = useCallback(async () => {
    try {
      const rows: IMeshNodeStatus[] = await nodesRpc.getMeshStatus();
      setMesh(Object.fromEntries(rows.map((r) => [r.nodeId, r])));
    } catch {
      // Left as it was. An unanswered call says nothing about whether a node
      // is replicating, and showing "not joined" because the daemon was busy
      // reports an outage this page invented.
    }
  }, []);

  /**
   * Each node's view of who leads the fleet.
   *
   * One call per node, because the question is asked OF the node — a master
   * that answered for everyone would be reporting its own opinion several
   * times, which is exactly the disagreement this is meant to detect.
   *
   * `allSettled`, and only the answers that came back are merged: a node that
   * could not be asked must not read as a node that named nobody, or every
   * unreachable node would manufacture a split brain.
   */
  const fetchClusterStates = useCallback(async (nodes: INodeWithStatus[]) => {
    const settled = await Promise.allSettled(
      nodes.map((n) => nodesRpc.getNodeClusterState({ nodeId: n.id })),
    );
    const next: Record<string, INodeClusterState> = {};
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) next[r.value.nodeId] = r.value as INodeClusterState;
    }
    if (Object.keys(next).length > 0) setClusterStates(next);
  }, []);

  const fetchUptimeBars = useCallback(async (nodes: INodeWithStatus[]) => {
    const results: Record<string, UptimeBucket[]> = {};
    const lastChecks: Record<string, string | null> = {};
    let failure: string | null = null;
    await Promise.allSettled(nodes.map(async (node) => {
      try {
        // Request more buckets than can fit — UptimeStrip will trim to visible width
        const { uptimeIntervalMs, retentionDays } = historyRef.current;
        const [bars, latest] = await Promise.all([
          nodesRpc.getUptimeBar({
            nodeId: node.id,
            bucketCount: bucketsFor(retentionDays, uptimeIntervalMs),
            intervalMs: uptimeIntervalMs,
          }),
          nodesRpc.getCheckHistory({ nodeId: node.id, limit: 1 }).catch(() => null),
        ]);
        results[node.id] = bars;
        if (latest) lastChecks[node.id] = latest[0]?.checkedAt ?? null;
      } catch (err) {
        // Two things this used to do, both wrong in the same way as blanking
        // the list above. It wrote `[]`, which the strip draws as a row of
        // "no data" — a definite statement that nothing was ever recorded,
        // made on the strength of one failed call. And it swallowed the
        // reason entirely: a bar that is empty because the query failed and
        // one that is empty because the node is new are the same picture.
        failure ??= (err as Error)?.message ?? 'Could not load uptime history';
      }
    }));
    // Merge, so a node whose call failed keeps the bars it had.
    setUptimeBars((previous) => ({ ...previous, ...results }));
    setLastCheckAt((previous) => ({ ...previous, ...lastChecks }));
    setBarsError(failure);
  }, []);

  const fetchSshKeys = useCallback(async () => {
    // Same reasoning, higher stakes: the key list feeds the Add Node dialog,
    // and "no keys" invites an operator to add one that already exists.
    try { setSshKeys(await nodesRpc.listSshKeys()); } catch { /* keep the last good list */ }
  }, []);

  // The shared daemon socket. The store's refcount keeps it alive across
  // page changes; this page used to poll blind while the daemon pushed a
  // `node.*` event on every check round that nothing was listening for.
  const wsConnected = useRealtimeStore((st) => st.connected);
  const lastNodeEvent = useRealtimeStore((st) => st.lastNodeEvent);
  const initializeRealtime = useRealtimeStore((st) => st.initialize);

  useEffect(() => initializeRealtime(), [initializeRealtime]);

  // With the socket up the poll is only a safety net. Without it, it is the
  // whole mechanism — so it keeps the old cadence.
  usePollingEffect(() => void fetchNodes(), { intervalMs: wsConnected ? 120_000 : 30_000 });

  // Mesh membership on its own tick, and a faster one than the node list.
  // It changes for reasons the node list never hears about — a tunnel drops,
  // a credential expires, a reconnect succeeds — and none of those produce
  // the events that refresh the list.
  usePollingEffect(() => void fetchMesh(), { intervalMs: 15_000 });

  // Who each node thinks leads the fleet. Slower than the mesh tick: an
  // election settles in seconds and a disagreement that outlives a minute is
  // the one worth showing, so a faster poll would only add N calls per node
  // for a question whose answer rarely changes.
  usePollingEffect(() => void fetchClusterStates(nodeListRef.current), { intervalMs: 60_000 });

  // A check round finished, or a node changed state: read the new list now
  // rather than at the next tick.
  useEffect(() => {
    if (lastNodeEvent) void fetchNodes();
  }, [lastNodeEvent, fetchNodes]);

  // The bars are on their own, much slower schedule: a segment is a day wide,
  // and re-aggregating 90 days per node every half-minute cannot change what
  // is drawn.
  usePollingEffect(
    () => void (async () => { await fetchUptimeBars(nodeListRef.current); })(),
    { intervalMs: UPTIME_POLL_MS }
  );

  // ...but a node that has just appeared needs its bars now, not in five
  // minutes. Keyed on the id SET rather than the list: the list object is new
  // on every poll, and re-running this on each one would put the slow query
  // back on the fast schedule by another route.
  const nodeIdKey = nodeList.map((n) => n.id).sort().join(',');
  useEffect(() => {
    if (!nodeIdKey) return;
    void fetchUptimeBars(nodeListRef.current);
  }, [nodeIdKey, fetchUptimeBars]);

  useEffect(() => {
    // SSH keys change only when an operator edits them; once is enough.
    void fetchSshKeys();
  }, [fetchSshKeys]);

  useEffect(() => {
    // Daemon configuration; it changes when the daemon is reconfigured, which
    // this page will not outlive.
    //
    // Called through `Promise.resolve().then` so a daemon that does not have
    // this endpoint is a rejected promise rather than a synchronous
    // `is not a function` thrown inside an effect — which React answers with a
    // blank page. The console and the daemon are versioned separately; a
    // console one release ahead must fall back to its defaults, not
    // white-screen the fleet view.
    Promise.resolve()
      .then(() => nodesRpc.getHistoryConfig())
      .then((c: FleetHistoryConfig) => setHistory(c))
      .catch(() => { /* the defaults above are the fallback */ });
  }, []);

  // Computed over the whole list rather than per card: "behind" is a
  // statement about the fleet, and a card cannot make it alone.
  const newestInFleet = useMemo(
    () => newestVersion(nodeList.map((n) => n.status?.omnitronVersion)),
    [nodeList],
  );

  const snackbar = useSnackbar();

  const handleCheckSsh = useCallback(async (id: string) => {
    const node = nodeList.find((n) => n.id === id);
    const label = node?.name ?? id;
    setCheckingId(id);
    try {
      // checkNodeStatus triggers a full check via the worker — we only care about SSH result
      const result: INodeStatus = await nodesRpc.checkNodeStatus({ id });
      if (result.sshConnected) {
        const latency = result.sshLatencyMs != null ? ` (${result.sshLatencyMs}ms)` : '';
        snackbar.success(`${label}: SSH connected${latency}`);
      } else if (result.sshConnected === false) {
        snackbar.error(`${label}: SSH failed — ${result.sshError ?? 'Connection refused'}`);
      } else {
        // The round that answered did not use SSH — the daemon serves these
        // itself whenever the health-monitor worker is down. Reporting "SSH
        // failed" here blames the node for the daemon's state.
        snackbar.warning(`${label}: this check did not use SSH — ${result.omnitronConnected ? 'omnitron answered on its Netron port' : result.omnitronError ?? 'no answer on the Netron port'}`);
      }
    } catch (err: any) {
      snackbar.error(`${label}: ${err?.message ?? 'Check failed'}`);
    } finally {
      setCheckingId(null);
    }
  }, [nodeList, snackbar]);

  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const removingRef = useRef(false);
  const confirmRemoveNode = nodeList.find((n) => n.id === confirmRemoveId);

  const handleRemove = useCallback(async () => {
    // The dialog used to close in a `finally`, so it dismissed itself whether
    // or not the node was removed, and the reason went to `console.error`.
    // What the operator saw on a failure was a dialog that closed and a node
    // still in the list — indistinguishable from a click that never
    // registered, so the next thing they do is click Remove again. The dialog
    // now closes only on success and shows the reason otherwise.
    //
    // `confirmRemoveId` cannot serve as the busy flag either: it is cleared
    // after the await, so it gates the caller arriving once the request has
    // returned, not the one arriving while it is still open.
    if (!confirmRemoveId || removingRef.current) return;
    removingRef.current = true;
    setRemoving(true);
    setRemoveError(null);
    try {
      await nodesRpc.removeNode({ id: confirmRemoveId });
      await fetchNodes();
      setConfirmRemoveId(null);
    } catch (err) {
      setRemoveError((err as Error)?.message ?? 'Failed to remove node.');
    } finally {
      removingRef.current = false;
      setRemoving(false);
    }
  }, [confirmRemoveId, fetchNodes]);

  const closeRemoveDialog = useCallback(() => {
    if (removingRef.current) return;
    setConfirmRemoveId(null);
    setRemoveError(null);
  }, []);

  const handleOpenAdd = useCallback(() => { setEditNode(null); setSubmitError(null); setDialogOpen(true); }, []);
  const handleOpenEdit = useCallback((n: INodeWithStatus) => { setEditNode(n); setSubmitError(null); setDialogOpen(true); }, []);
  const handleCloseDialog = useCallback(() => { setDialogOpen(false); setEditNode(null); setSubmitError(null); }, []);

  const handleSubmit = useCallback(async (form: NodeFormData) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = {
        name: form.name.trim(), host: form.host.trim(), sshPort: form.sshPort,
        sshUser: form.sshUser.trim(), sshAuthMethod: form.sshAuthMethod,
        sshPrivateKey: form.sshAuthMethod === 'key' ? form.sshPrivateKey : undefined,
        // An empty secret field means "leave it alone", never "clear it".
        // The passphrase was already read that way; the password was not, so
        // opening an existing password-auth node, changing its NAME and
        // pressing Save sent `sshPassword: ''` — and the daemon reads an
        // empty string as an instruction to delete the stored credential.
        // The node then failed every check with no sign of what had happened,
        // because the form never showed the password in the first place.
        // A stored credential is dropped by switching the auth method, which
        // is the only gesture that says so.
        sshPassphrase: form.sshAuthMethod === 'key' && form.sshPassphrase ? form.sshPassphrase : undefined,
        sshPassword: form.sshAuthMethod === 'password' && form.sshPassword ? form.sshPassword : undefined,
        runtime: form.runtime, daemonPort: form.daemonPort,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      };
      if (editNode) await nodesRpc.updateNode({ id: editNode.id, ...payload });
      else await nodesRpc.addNode(payload);
      handleCloseDialog();
      await fetchNodes();
    } catch (err) {
      // The reason used to go to `console.error` alone. On a failure the
      // dialog stayed open with every field intact, the Save button
      // re-enabled, and nothing on screen changed — so a rejected host or a
      // duplicate name looked exactly like a click that never registered,
      // and the operator's only move was to press Save again.
      setSubmitError((err as Error)?.message ?? 'Failed to save node.');
    } finally { setSubmitting(false); }
  }, [editNode, fetchNodes, handleCloseDialog]);

  const sorted = [...nodeList].sort((a, b) => {
    if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <Stack spacing={3}>
      <Breadcrumbs
        links={[{ name: 'Nodes' }]}
        action={
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" size="small" startIcon={<SettingsIcon sx={{ fontSize: 18 }} />}
              onClick={() => setSettingsOpen(true)}>
              Check Settings
            </Button>
            <Button variant="outlined" size="small" startIcon={<RefreshIcon sx={{ fontSize: 18 }} />}
              onClick={async () => { const n = await fetchNodes(); await fetchUptimeBars(n); }}>
              Refresh
            </Button>
            <Button variant="contained" size="small" startIcon={<PlusIcon sx={{ fontSize: 18 }} />} onClick={handleOpenAdd}>
              Add Node
            </Button>
          </Stack>
        }
      />

      <ClusterAgreement states={clusterStates} />

      {/*
        Upgrading the fleet, as one operation rather than a button per card.
        A production estate is many machines, and «press upgrade on each and
        remember which ones you pressed» is not a procedure — it is how a
        node gets left three versions behind.
      */}
      <FleetRollout nodes={nodeList} />

      {listError && (
        <FormAlert severity="warning" onClose={() => setListError(null)}>
          Could not refresh the node list — {listError}. The cards below are the
          last state the daemon reported.
        </FormAlert>
      )}

      {barsError && (
        <FormAlert severity="warning" onClose={() => setBarsError(null)}>
          Could not refresh the uptime history — {barsError}. The strips below are
          the last aggregation that arrived, and may be behind the cards.
        </FormAlert>
      )}

      {loading ? (
        <Grid container spacing={3}>
          {[1, 2, 3].map((i) => <Grid key={i} size={{ xs: 12, sm: 6, md: 4 }}><Skeleton variant="rounded" height={300} /></Grid>)}
        </Grid>
      ) : sorted.length === 0 ? (
        <EmptyContent
          title={listError ? 'No nodes to show' : 'No nodes registered'}
          description={
            listError
              ? 'The list could not be refreshed, so this may not be the whole picture.'
              : 'Add a node to manage a remote host from here.'
          }
        />
      ) : (
        <Grid container spacing={3}>
          {sorted.map((node) => (
            <Grid key={node.id} size={{ xs: 12, sm: 6, md: 4 }}>
              <NodeCard node={node} onEdit={handleOpenEdit} onRemove={setConfirmRemoveId}
                onCheckSsh={handleCheckSsh} onDiagnose={setDiagnoseNode} checking={checkingId === node.id}
                uptimeData={uptimeBars[node.id] ?? []} lastCheckAt={lastCheckAt[node.id] ?? null}
                newest={newestInFleet} mesh={mesh[node.id]} />
            </Grid>
          ))}
        </Grid>
      )}

      <NodeDiagnosisDialog
        open={!!diagnoseNode}
        onClose={() => setDiagnoseNode(null)}
        node={diagnoseNode ? (nodeList.find((n) => n.id === diagnoseNode.id) ?? diagnoseNode) : null}
      />

      <Dialog open={!!confirmRemoveId} onClose={closeRemoveDialog} maxWidth="xs" fullWidth>
        <DialogTitle>Remove Node</DialogTitle>
        <DialogContent>
          <Typography variant="body2">Remove <strong>{confirmRemoveNode?.name ?? confirmRemoveId}</strong>? This cannot be undone.</Typography>
          {removeError && (
            <FormAlert onClose={() => setRemoveError(null)}>{removeError}</FormAlert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeRemoveDialog} color="inherit" disabled={removing}>Cancel</Button>
          <Button onClick={handleRemove} color="error" variant="contained" disabled={removing}>
            {removing ? 'Removing…' : 'Remove'}
          </Button>
        </DialogActions>
      </Dialog>

      <NodeDialog open={dialogOpen} onClose={handleCloseDialog} onSubmit={handleSubmit}
        editNode={editNode} sshKeys={sshKeys} loading={submitting}
        error={submitError} onDismissError={() => setSubmitError(null)} />

      <CheckSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(cfg) => {
          snackbar.success(
            `Check settings saved — ping ${cfg.pingEnabled ? 'on' : 'off'}, SSH timeout ${cfg.sshTimeout}ms`,
          );
          void fetchNodes();
        }}
      />
    </Stack>
  );
}
