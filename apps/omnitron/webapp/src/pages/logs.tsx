/**
 * Logs Page — Production-grade streaming log viewer.
 *
 * Terminal-style dark log viewer with rich filtering, live streaming,
 * expandable row detail, a bounded live buffer, and level-based stats.
 *
 * This is the most-used page in the Omnitron Console.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Button from '@mui/material/Button';
import ButtonGroup from '@mui/material/ButtonGroup';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Collapse from '@mui/material/Collapse';
import Fab from '@mui/material/Fab';
import Badge from '@mui/material/Badge';
import InputAdornment from '@mui/material/InputAdornment';
import { alpha, keyframes, useTheme, type Theme } from '@mui/material/styles';

import { SearchIcon, RefreshIcon, PlayIcon, StopIcon, CloseIcon, TerminalIcon } from 'src/assets/icons';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { Breadcrumbs } from 'src/components/page-breadcrumbs';
import { Skeleton } from '@omnitron-dev/prism/components/skeleton';
import { useCopyToClipboard } from '@omnitron-dev/prism/core';
import { logs, daemon, nodes as nodesRpc } from 'src/netron/client';
import { useStackContext } from 'src/hooks/use-stack-context';
import { logCommand } from 'src/utils/log-location';

import type { LogEntryRow, LevelCount } from '@omnitron-dev/omnitron/dto/services';

// =============================================================================
// Constants
// =============================================================================

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

/**
 * The known levels in severity order, then any other a writer recorded, as
 * recorded — `medium`, `None`: an app that logs its own `level` field
 * overwrites the record's. Dropping those made the breakdown fall short of
 * the total beside it.
 */
function inLevelOrder(counts: readonly LevelCount[]): LevelCount[] {
  const rank = (level: string) => {
    const known = (LEVELS as readonly string[]).indexOf(level);
    return known === -1 ? LEVELS.length : known;
  };
  return [...counts].sort((a, b) => rank(a.level) - rank(b.level));
}

const LEVEL_LABELS: Record<string, string> = {
  trace: 'TRC',
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
  fatal: 'FTL',
};

/** Extended level backgrounds for the terminal view */
const LEVEL_ROW_BG: Record<string, string> = {
  fatal: 'rgba(220,38,38,0.08)',
  error: 'rgba(239,68,68,0.05)',
  warn: 'rgba(245,158,11,0.04)',
  info: 'transparent',
  debug: 'transparent',
  trace: 'transparent',
};

const MONO = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', monospace";

const TIME_RANGES = [
  { key: 'live', label: 'Live', minutes: 0 },
  { key: '15m', label: '15m', minutes: 15 },
  { key: '1h', label: '1h', minutes: 60 },
  { key: '6h', label: '6h', minutes: 360 },
  { key: '24h', label: '24h', minutes: 1440 },
  { key: 'custom', label: 'Custom', minutes: -1 },
] as const;

type TimeRangeKey = (typeof TIME_RANGES)[number]['key'];

const PAGE_SIZE = 100;
const STREAM_INTERVAL = 2000;
const SEARCH_DEBOUNCE = 300;
const SCROLL_THRESHOLD = 80; // px from bottom to consider "at bottom"

// Animations
const slideIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.5; }
`;

// =============================================================================
// Helpers
// =============================================================================

function formatTimePrecise(ts: Date | string): string {
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

function formatDateFull(ts: Date | string): string {
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  const base = d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${base}.${ms}`;
}

function parseLabelInput(input: string): Record<string, string> | undefined {
  if (!input.trim()) return undefined;
  const labels: Record<string, string> = {};
  for (const pair of input.split(',')) {
    const [k, v] = pair.split('=').map((s) => s.trim());
    if (k && v) labels[k] = v;
  }
  return Object.keys(labels).length > 0 ? labels : undefined;
}

// =============================================================================
// LogRow — single expandable log entry
// =============================================================================

interface LogRowProps {
  log: LogEntryRow;
  isNew?: boolean;
  /** Node uuid → the name an operator gave it. */
  nodeNames?: Record<string, string>;
}

function logLevelColor(level: string, theme: Theme): string {
  const tones = { info: 'info', warn: 'warning', error: 'error', fatal: 'error' } as const;
  const tone = tones[level as keyof typeof tones];
  return tone ? theme.palette[tone][theme.palette.mode === 'light' ? 'dark' : 'light'] : theme.palette.text.secondary;
}

function LogRow({ log, isNew, nodeNames }: LogRowProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const levelColor = logLevelColor(log.level, theme);
  const rowBg = LEVEL_ROW_BG[log.level] ?? 'transparent';

  // `nodeId` counts as detail. A line the master collected itself has none;
  // one pulled from a node carries the node that produced it, and until this
  // there was nowhere in the viewer that said so — every machine's lines
  // interleaved under the same four columns.
  const hasDetail = log.labels || log.traceId || log.spanId || log.metadata || log.nodeId;

  return (
    <>
      <Box
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${formatTimePrecise(log.timestamp)} ${log.app} ${log.level}: ${log.message}`}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setExpanded((value) => !value);
          }
        }}
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '90px minmax(0, 1fr) 36px', sm: '90px 120px 36px minmax(0, 1fr)' },
          gap: 1,
          alignItems: 'baseline',
          px: 1.5,
          py: '3px',
          bgcolor: expanded ? 'action.hover' : rowBg,
          borderLeft: `2px solid ${expanded ? levelColor : 'transparent'}`,
          cursor: 'pointer',
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
          transition: 'background-color 0.15s ease',
          animation: isNew ? `${slideIn} 0.3s ease-out` : undefined,
          '&:hover': {
            bgcolor: 'action.hover',
          },
        }}
      >
        {/* Timestamp */}
        <Tooltip title={formatDateFull(log.timestamp)} placement="top-start" arrow enterDelay={400}>
          <Typography
            component="span"
            sx={{
              fontFamily: MONO,
              fontSize: 11,
              color: 'text.secondary',
              lineHeight: '20px',
              whiteSpace: 'nowrap',
              letterSpacing: '-0.02em',
            }}
          >
            {formatTimePrecise(log.timestamp)}
          </Typography>
        </Tooltip>

        {/* App */}
        <Typography
          component="span"
          sx={{
            fontFamily: MONO,
            fontSize: 11,
            color: theme.palette.info[theme.palette.mode === 'light' ? 'dark' : 'light'],
            lineHeight: '20px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontWeight: 500,
          }}
        >
          {log.app}
        </Typography>

        {/* Level */}
        <Typography
          component="span"
          sx={{
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 700,
            color: levelColor,
            lineHeight: '20px',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          {LEVEL_LABELS[log.level] ?? log.level.slice(0, 3).toUpperCase()}
        </Typography>

        {/* Message */}
        <Typography
          component="span"
          sx={{
            fontFamily: MONO,
            fontSize: 11.5,
            color: log.level === 'error' || log.level === 'fatal' ? levelColor : 'text.primary',
            gridColumn: { xs: '1 / -1', sm: 'auto' },
            minWidth: 0,
            lineHeight: '20px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: expanded ? 'pre-wrap' : 'nowrap',
            wordBreak: expanded ? 'break-all' : undefined,
          }}
        >
          {log.message}
        </Typography>
      </Box>

      {/* Expanded detail */}
      {hasDetail && <Collapse in={expanded} unmountOnExit>
        <Box
          sx={{
            ml: '14px',
            mr: 1.5,
            mb: 0.5,
            p: 1.5,
            bgcolor: 'action.hover',
            borderRadius: 1,
            borderLeft: `2px solid ${alpha(levelColor, 0.3)}`,
          }}
        >
          <Box
            component="pre"
            sx={{
              fontFamily: MONO,
              fontSize: 11,
              color: 'text.secondary',
              m: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              lineHeight: 1.7,
            }}
          >
            {log.nodeId && (
              <span>
                <Box component="span" sx={{ color: 'text.secondary' }}>node:    </Box>
                <Box component="span" sx={{ color: theme.palette.info[theme.palette.mode === 'light' ? 'dark' : 'light'] }}>{nodeNames?.[log.nodeId] ?? log.nodeId}</Box>
                {'\n'}
              </span>
            )}
            {log.traceId && (
              <span>
                <Box component="span" sx={{ color: 'text.secondary' }}>traceId: </Box>
                <Box component="span" sx={{ color: theme.palette.secondary[theme.palette.mode === 'light' ? 'dark' : 'light'] }}>{log.traceId}</Box>
                {'\n'}
              </span>
            )}
            {log.spanId && (
              <span>
                <Box component="span" sx={{ color: 'text.secondary' }}>spanId:  </Box>
                <Box component="span" sx={{ color: theme.palette.secondary[theme.palette.mode === 'light' ? 'dark' : 'light'] }}>{log.spanId}</Box>
                {'\n'}
              </span>
            )}
            {log.labels && (
              <span>
                <Box component="span" sx={{ color: 'text.secondary' }}>labels:  </Box>
                <Box component="span" sx={{ color: theme.palette.success[theme.palette.mode === 'light' ? 'dark' : 'light'] }}>
                  {JSON.stringify(log.labels, null, 2)}
                </Box>
                {'\n'}
              </span>
            )}
            {log.metadata && (
              <span>
                <Box component="span" sx={{ color: 'text.secondary' }}>metadata:</Box>
                {'\n'}
                <Box component="span" sx={{ color: 'text.primary' }}>
                  {JSON.stringify(log.metadata, null, 2)}
                </Box>
              </span>
            )}
          </Box>
        </Box>
      </Collapse>}
    </>
  );
}

// =============================================================================
// LogsPage — Main component
// =============================================================================

export default function LogsPage() {
  const theme = useTheme();
  const { activeProject, namespacePrefix, filterApps, displayName } = useStackContext();
  const daemonMode = !activeProject;
  const [params, setParams] = useSearchParams();
  const clipboard = useCopyToClipboard();

  // ---- Filters ----
  const app = params.get('app') ?? (daemonMode ? 'omnitron' : '');
  const nodeFilter = params.get('node') ?? '';
  const setApp = (value: string) => setParams((previous) => {
    const next = new URLSearchParams(previous);
    next.set('app', value);
    return next;
  }, { replace: true });
  const setNodeFilter = (value: string) => setParams((previous) => {
    const next = new URLSearchParams(previous);
    if (value) next.set('node', value); else next.delete('node');
    return next;
  }, { replace: true });
  const [nodeNames, setNodeNames] = useState<Array<{ id: string; hostname: string }>>([]);
  /** The same list the Node dropdown shows, keyed for the row detail. */
  const nodeNameById = useMemo(
    () => Object.fromEntries(nodeNames.map((n) => [n.id, n.hostname])),
    [nodeNames],
  );
  const [selectedLevels, setSelectedLevels] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [labelInput, setLabelInput] = useState('');
  const [timeRangeKey, setTimeRangeKey] = useState<TimeRangeKey>('live');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // ---- Data ----
  const [logRows, setLogRows] = useState<LogEntryRow[]>([]);
  const [levelCounts, setLevelCounts] = useState<LevelCount[]>([]);
  // The app filter has two sources, kept apart because they mean different
  // things: what is RUNNING in the active project, and what has LOGGED at any
  // point. Both hold fully-namespaced names — the value the daemon actually
  // stores in `logs.app` — and the short form is a display concern only.
  const [liveApps, setLiveApps] = useState<string[]>([]);
  const [loggedApps, setLoggedApps] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Streaming ----
  const [streaming, setStreaming] = useState(false);
  const [paused, setPaused] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const streamRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTimestampRef = useRef<string | null>(null);
  const newIdsRef = useRef<Set<string>>(new Set());
  const viewGeneration = useRef(0);

  // A late answer for another node must never appear under the new node's name.
  useEffect(() => {
    viewGeneration.current++;
    setLogRows([]);
    setTotal(0);
    setHasMore(false);
    setNewCount(0);
    lastTimestampRef.current = null;
    return () => { viewGeneration.current++; };
  }, [app, nodeFilter, selectedLevels, debouncedSearch, labelInput, timeRangeKey, customFrom, customTo]);

  // ---- Scroll ----
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtTopRef = useRef(true);

  // ---- Search debounce ----
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, SEARCH_DEBOUNCE);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchInput]);

  // ---- Computed: is live mode ----
  const isLive = timeRangeKey === 'live';

  // Start streaming when entering live mode
  useEffect(() => {
    if (isLive && !paused) {
      setStreaming(true);
    } else {
      setStreaming(false);
    }
  }, [isLive, paused]);

  // ---- Fetch app names ----
  //
  // Scoped to the active project/stack, so it re-runs when that changes.
  // `filterApps` and `displayName` come from the stack context and are rebuilt
  // on every switch; running this once on mount left the app dropdown listing
  // the apps of whichever project happened to be active at mount, with no way
  // to refresh it short of a reload. The two calls used to share one effect —
  // the node list below is cluster-wide and has nothing to do with the
  // project, so it stays on its own.
  useEffect(() => {
    (async () => {
      try {
        const list = await daemon.list();
        setLiveApps(filterApps(list).map((a: any) => a.name));
      } catch {
        /* noop */
      }
    })();
  }, [filterApps]);

  // ---- Fetch cluster nodes ----
  //
  // From the NODE REGISTRY, not the fleet table.
  //
  // This listed `fleet.listNodes()`, and that table holds one row — the
  // master's own; every remote machine lives in the node registry instead.
  // So the dropdown could only ever offer the node you are already looking
  // at. Worse, the two registries mint their ids separately, and a
  // replicated log row carries the REGISTRY id (that is what the master
  // stamps when it pulls), so a fleet id selected here would have matched no
  // row even if the table had held one: an empty result, on a filter that
  // looks like it worked.
  useEffect(() => {
    (async () => {
      try {
        const list = await nodesRpc.listNodes();
        // Remote nodes only. The master's own lines are written with no
        // `nodeId` at all — the column is stamped when a batch is PULLED —
        // so an entry for this machine would be a filter that returns
        // nothing, which is worse than one that is absent. Its lines are in
        // the unfiltered view, which is the default.
        const remote = Array.isArray(list) ? list.filter((n: { isLocal: boolean }) => !n.isLocal) : [];
        if (remote.length > 0) {
          setNodeNames(remote.map((n: { id: string; name: string }) => ({ id: n.id, hostname: n.name })));
        }
      } catch {
        /* node registry not available — single node mode */
      }
    })();
  }, []);

  // ---- Apps that have logged ----
  //
  // `getLogStats` groups the whole table, so it is asked when the page opens
  // and on Refresh — not on every change of filter, which it answers nothing
  // about.
  const fetchLoggedApps = useCallback(async () => {
    try {
      const s = await logs.getLogStats();
      // Replaced, not unioned: `byApp` is the complete grouping of the log
      // table, so a union only ever accumulated names that had already gone.
      setLoggedApps(s.byApp.map((a) => a.app));
    } catch {
      /* the running apps still fill the filter */
    }
  }, []);

  useEffect(() => {
    fetchLoggedApps();
  }, [fetchLoggedApps]);

  // ---- App filter options ----
  //
  // The value sent to the daemon MUST be the namespaced name: `queryLogs`
  // matches `app` by equality, so picking the short `main` asked for rows
  // written under that exact string. Measured on this stand: `main` answers
  // 36 rows whose newest is five days old, left behind by the pre-project
  // standalone layout, while the app the operator meant is `acme/dev/main`
  // with 81 783 rows and a newest entry seconds old. The page built the short
  // names itself, so it was offering a filter that could only mislead.
  const appOptions = useMemo(() => {
    // Un-namespaced names — the daemon's own `omnitron`, plus those standalone
    // leftovers — have no prefix to match, so they stay visible in every
    // scope. Same rule the metrics page applies to its series.
    const inScope = (name: string) =>
      name === app || !namespacePrefix || name.startsWith(namespacePrefix) || !name.includes('/');
    const values = [...new Set([...liveApps, ...loggedApps, ...(app ? [app] : [])])].filter(inScope).sort();

    // Two values can render to one label — `main` and `acme/dev/main` both
    // display as `main`. Where that happens, show the full value: a dropdown
    // with two identical entries querying different data is worse than a long
    // one.
    const labelCounts = new Map<string, number>();
    for (const value of values) {
      const label = displayName(value);
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    }

    return values.map((value) => {
      const label = displayName(value);
      return { value, label: daemonMode || labelCounts.get(label)! > 1 ? value : label };
    });
  }, [liveApps, loggedApps, namespacePrefix, displayName, app, daemonMode]);

  // ---- Build filter ----
  const buildFilter = useCallback(
    (offset = 0) => {
      const filter: Record<string, unknown> = {
        limit: PAGE_SIZE,
        offset,
      };
      if (app) filter.app = app;
      if (selectedLevels.length > 0) filter.level = selectedLevels;
      if (debouncedSearch.trim()) filter.search = debouncedSearch.trim();

      // The node filter is a COLUMN, not a label. It used to be folded into
      // `labels` — where the daemon ignored the whole field, so choosing a
      // node narrowed nothing while its chip stayed lit.
      if (nodeFilter) filter.nodeId = nodeFilter;

      const labels = parseLabelInput(labelInput);
      if (labels && Object.keys(labels).length > 0) filter.labels = labels;

      if (timeRangeKey === 'custom') {
        if (customFrom) filter.from = new Date(customFrom).toISOString();
        if (customTo) filter.to = new Date(customTo).toISOString();
      } else if (timeRangeKey !== 'live') {
        const range = TIME_RANGES.find((r) => r.key === timeRangeKey);
        if (range && range.minutes > 0) {
          filter.from = new Date(Date.now() - range.minutes * 60 * 1000).toISOString();
        }
      }

      return filter;
    },
    [app, nodeFilter, selectedLevels, debouncedSearch, labelInput, timeRangeKey, customFrom, customTo],
  );

  // ---- Fetch logs (paginated mode) ----
  const fetchLogs = useCallback(async () => {
    const generation = viewGeneration.current;
    try {
      setLoading(true);
      const result = await logs.queryLogs(buildFilter(0) as any);
      if (generation !== viewGeneration.current) return;
      setLogRows(result.entries);
      setTotal(result.total);
      setLevelCounts(result.byLevel);
      setHasMore(result.hasMore);
      setError(null);
      newIdsRef.current.clear();

      // Set last timestamp for streaming transition
      if (result.entries.length > 0) {
        lastTimestampRef.current = new Date(result.entries[0]!.timestamp).toISOString();
      }
    } catch (err: any) {
      if (generation !== viewGeneration.current) return;
      setError(err?.message ?? 'Failed to query logs');
    } finally {
      if (generation === viewGeneration.current) setLoading(false);
    }
  }, [buildFilter]);

  // ---- Load more (older entries) ----
  const loadMore = async () => {
    const generation = viewGeneration.current;
    setLoadingMore(true);
    try {
      const result = await logs.queryLogs(buildFilter(logRows.length) as any);
      if (generation !== viewGeneration.current) return;
      setLogRows((prev) => [...prev, ...result.entries]);
      setHasMore(result.hasMore);
    } catch (err: any) {
      if (generation !== viewGeneration.current) return;
      setError(err?.message ?? 'Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  };

  // ---- Initial fetch + re-fetch on filter change (non-live mode) ----
  useEffect(() => {
    if (!isLive) {
      fetchLogs();
    }
  }, [fetchLogs, isLive]);

  // ---- Live streaming ----
  const streamFilter = useMemo(() => {
    // Every filter the paginated view applies, minus the time range, which
    // a live tail has no use for. It used to carry app, level and search
    // only — so pressing Live silently widened the node and label filters
    // while their chips stayed on screen, and the viewer answered a
    // different question than the one it was showing.
    const f: Record<string, unknown> = { tail: 100 };
    if (app) f.app = app;
    if (selectedLevels.length > 0) f.level = selectedLevels;
    if (debouncedSearch.trim()) f.search = debouncedSearch.trim();
    if (nodeFilter) f.nodeId = nodeFilter;

    const labels = parseLabelInput(labelInput);
    if (labels && Object.keys(labels).length > 0) f.labels = labels;

    return f;
  }, [app, selectedLevels, debouncedSearch, nodeFilter, labelInput]);

  // Initial live fetch
  useEffect(() => {
    if (!isLive) return undefined;
    let active = true;
    (async () => {
      try {
        setLoading(true);
        const entries: LogEntryRow[] = await logs.streamLogs(streamFilter as any);
        if (!active) return;
        // Newest first
        const reversed = [...entries].reverse();
        setLogRows(reversed);
        setTotal(entries.length);
        setHasMore(false);
        setError(null);
        newIdsRef.current.clear();
        if (entries.length > 0) {
          lastTimestampRef.current = new Date(entries[entries.length - 1]!.timestamp).toISOString();
        }
      } catch (err: any) {
        if (!active) return;
        setError(err?.message ?? 'Failed to stream logs');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [isLive, streamFilter]);

  // Polling interval for live mode
  useEffect(() => {
    if (streamRef.current) {
      clearInterval(streamRef.current);
      streamRef.current = null;
    }

    if (!streaming || paused) return undefined;

    let active = true;
    let pending = false;

    streamRef.current = setInterval(async () => {
      if (pending) return;
      pending = true;
      try {
        const since = lastTimestampRef.current;
        const filter = { ...streamFilter, tail: 50 } as any;
        if (since) filter.since = since;

        const entries: LogEntryRow[] = await logs.streamLogs(filter);
        if (!active) return;
        setError(null);
        if (entries.length === 0) return;

        // Deduplicate by id
        const existingIds = new Set(logRows.map((l) => l.id));
        const fresh = entries.filter((e) => !existingIds.has(e.id));
        if (fresh.length === 0) return;

        // Track new entries for animation
        fresh.forEach((e) => newIdsRef.current.add(e.id));
        // Auto-clear animation markers after 2s
        setTimeout(() => {
          fresh.forEach((e) => newIdsRef.current.delete(e.id));
        }, 2000);

        lastTimestampRef.current = new Date(fresh[fresh.length - 1]!.timestamp).toISOString();

        setLogRows((prev) => {
          // Newest first — prepend fresh entries (reversed so newest is at index 0)
          const merged = [...fresh.reverse(), ...prev];
          // Keep first 2000 entries to avoid memory bloat
          return merged.length > 2000 ? merged.slice(0, 2000) : merged;
        });

        setTotal((prev) => prev + fresh.length);

        if (!isAtTopRef.current) {
          setNewCount((prev) => prev + fresh.length);
        }
      } catch {
        if (active) setError('Live log stream unavailable. Retrying.');
      } finally {
        pending = false;
      }
    }, STREAM_INTERVAL);

    return () => {
      active = false;
      if (streamRef.current) clearInterval(streamRef.current);
    };
  }, [streaming, paused, streamFilter, logRows]);

  // Auto-scroll to top when new entries arrive (newest first)
  useEffect(() => {
    if (isAtTopRef.current && scrollContainerRef.current) {
      const el = scrollContainerRef.current;
      requestAnimationFrame(() => {
        el.scrollTop = 0;
      });
    }
  }, [logRows]);

  // ---- Scroll tracking ----
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atTop = el.scrollTop < SCROLL_THRESHOLD;
    isAtTopRef.current = atTop;
    setIsAtBottom(atTop); // reuse state name for "at newest position"
    if (atTop) setNewCount(0);
  }, []);

  const scrollToTop = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, behavior: 'smooth' });
    setNewCount(0);
  }, []);

  // ---- Level toggle ----
  const toggleLevel = (level: string) => {
    setSelectedLevels((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level],
    );
  };

  // ---- Clear all filters ----
  const clearFilters = () => {
    setParams({ app: '' }, { replace: true });
    setSelectedLevels([]);
    setSearchInput('');
    setDebouncedSearch('');
    setLabelInput('');
    setTimeRangeKey('1h');
    setCustomFrom('');
    setCustomTo('');
  };

  const hasActiveFilters =
    app !== '' ||
    nodeFilter !== '' ||
    selectedLevels.length > 0 ||
    debouncedSearch !== '' ||
    labelInput !== '';

  // ---- Level breakdown ----
  //
  // Of the rows the count beside it counts: the query's own breakdown, or,
  // live, the entries on screen. It was the whole table's levels, refetched
  // on every change of filter and narrowed by none of them.
  const levelBreakdown = useMemo(() => {
    if (!isLive) return inLevelOrder(levelCounts);
    const onScreen = new Map<string, number>();
    for (const row of logRows) onScreen.set(row.level, (onScreen.get(row.level) ?? 0) + 1);
    return inLevelOrder([...onScreen].map(([level, count]) => ({ level, count })));
  }, [isLive, levelCounts, logRows]);

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0 }}>
      {/* ================================================================== */}
      {/* Filter Bar — glass-morphism header                                 */}
      {/* ================================================================== */}
      <Box
        sx={{
          position: 'relative',
          flexShrink: 0,
          zIndex: 10,
          mb: 2,
          p: { xs: 1.5, sm: 2 },
          borderRadius: 2,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        {/* Row 1: Title + controls */}
        <Breadcrumbs
          links={[{ name: 'Logs' }]}
          sx={{ mb: 1.5 }}
          action={
            <Stack direction="row" spacing={0.5} sx={{
              alignItems: "center", flexWrap: 'wrap'
            }}>
              {isLive && (
                <Chip
                  label={paused ? 'PAUSED' : 'LIVE'}
                  size="small"
                  sx={{
                    height: 20,
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: MONO,
                    letterSpacing: '0.08em',
                    bgcolor: paused ? alpha('#f59e0b', 0.15) : alpha('#22c55e', 0.15),
                    color: theme.palette[paused ? 'warning' : 'success'][theme.palette.mode === 'light' ? 'dark' : 'light'],
                    animation: !paused ? `${pulse} 2s ease-in-out infinite` : undefined,
                    border: '1px solid',
                    borderColor: paused ? alpha('#f59e0b', 0.3) : alpha('#22c55e', 0.3),
                  }}
                />
              )}
              {isLive && (
                <Tooltip title={paused ? 'Resume streaming' : 'Pause streaming'}>
                  <IconButton size="small" onClick={() => setPaused((v) => !v)} sx={{ color: theme.palette[paused ? 'warning' : 'success'][theme.palette.mode === 'light' ? 'dark' : 'light'] }}>
                    {paused ? <PlayIcon /> : <StopIcon />}
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip title="Refresh">
                <IconButton
                  size="small"
                  onClick={() => {
                    if (isLive) {
                      lastTimestampRef.current = null;
                    }
                    fetchLogs();
                    fetchLoggedApps();
                  }}
                >
                  <RefreshIcon />
                </IconButton>
              </Tooltip>
              {hasActiveFilters && (
                <Tooltip title="Clear all filters">
                  <IconButton size="small" onClick={clearFilters} sx={{ color: 'error.main' }}>
                    <CloseIcon />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          }
        />

        {/* Row 2: App + Search + Labels */}
        <Stack
          direction="row"
          spacing={1.5}
          useFlexGap
          sx={{
            flexWrap: "wrap",
            mb: 1.5
          }}>
            <TextField
              select
              size="small"
              label="Application"
              value={app}
              onChange={(e) => setApp(e.target.value)}
              sx={{
                minWidth: 0, flex: '1 1 160px',
                '& .MuiInputBase-root': { fontFamily: MONO, fontSize: 12 },
                '& .MuiInputLabel-root': { fontSize: 12 },
              }}
            >
              <MenuItem value="">
                <em>All Apps</em>
              </MenuItem>
              {appOptions.map(({ value, label }) => (
                <MenuItem key={value} value={value} sx={{ fontFamily: MONO, fontSize: 12 }}>
                  {label}
                </MenuItem>
              ))}
            </TextField>

          {/* Node selector — only visible when cluster has multiple nodes */}
          {nodeNames.length > 0 && (
            <TextField
              select
              size="small"
              label="Node"
              value={nodeFilter}
              onChange={(e) => setNodeFilter(e.target.value)}
              sx={{
                minWidth: 0, flex: '1 1 150px',
                '& .MuiInputBase-root': { fontFamily: MONO, fontSize: 12 },
                '& .MuiInputLabel-root': { fontSize: 12 },
              }}
            >
              <MenuItem value="">
                <em>All Nodes</em>
              </MenuItem>
              {nodeNames.map((node) => (
                <MenuItem key={node.id} value={node.id} sx={{ fontFamily: MONO, fontSize: 12 }}>
                  {node.hostname}
                </MenuItem>
              ))}
            </TextField>
          )}

          <TextField
            size="small"
            placeholder="Search messages..."
            label="Search messages"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                  </InputAdornment>
                ),
              },
            }}
            sx={{
              flex: '2 1 220px',
              minWidth: 0,
              '& .MuiInputBase-root': { fontFamily: MONO, fontSize: 12 },
            }}
          />

          <Button
            size="small"
            aria-expanded={filtersOpen}
            aria-controls="log-filter-options"
            variant={filtersOpen ? 'outlined' : 'text'}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            Filters{(selectedLevels.length > 0 || labelInput || timeRangeKey !== 'live') ? ` · ${Number(selectedLevels.length > 0) + Number(!!labelInput) + Number(timeRangeKey !== 'live')}` : ''}
          </Button>
        </Stack>

        {nodeFilter && (
          <Typography variant="caption" sx={{ display: 'block', mb: 1, color: 'text.secondary' }}>
            Replicated logs from {nodeNameById[nodeFilter] ?? nodeFilter}. An empty result does not prove that an operation was not attempted.
          </Typography>
        )}
        <Collapse in={filtersOpen} id="log-filter-options">
          <Box sx={{ pt: 1, pb: 1.5 }}>
            <TextField
              size="small"
              placeholder="key=val, key2=val2"
              label="Labels"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              sx={{
                width: '100%', maxWidth: 480, minWidth: 0,
                '& .MuiInputBase-root': { fontFamily: MONO, fontSize: 12 },
              }}
            />
          </Box>
        {app && (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1, minWidth: 0 }}>
            <Typography component="code" variant="caption" sx={{ fontFamily: MONO, overflowWrap: 'anywhere' }}>
              {logCommand(app, nodeFilter)}
            </Typography>
            <Button size="small" onClick={() => void clipboard.copy(logCommand(app, nodeFilter))}>
              {clipboard.state === 'success' ? 'Copied' : clipboard.state === 'error' ? 'Retry copy' : 'Copy app/node command'}
            </Button>
          </Stack>
        )}

        {/* Row 3: Levels + Time range */}
        <Stack
          direction="row"
          spacing={2}
          useFlexGap
          sx={{
            alignItems: "center",
            flexWrap: "wrap"
          }}>
          {/* Level chips */}
          <Stack direction="row" spacing={0.5} sx={{
            alignItems: "center", flexWrap: 'wrap'
          }}>
            {LEVELS.map((level) => {
              const active = selectedLevels.includes(level);
              const color = logLevelColor(level, theme);
              return (
                <Chip
                  key={level}
                  size="small"
                  label={
                    <Stack direction="row" spacing={0.5} sx={{
                      alignItems: "center"
                    }}>
                      <Box
                        sx={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          bgcolor: color,
                          flexShrink: 0,
                          boxShadow: active ? `0 0 6px ${color}` : undefined,
                        }}
                      />
                      <span>{level}</span>
                    </Stack>
                  }
                  variant={active ? 'filled' : 'outlined'}
                  aria-pressed={active}
                  onClick={() => toggleLevel(level)}
                  sx={{
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    height: 24,
                    borderColor: active ? color : alpha(color, 0.3),
                    color: active ? theme.palette.getContrastText(color) : color,
                    bgcolor: active ? color : 'transparent',
                    '&:hover': {
                      bgcolor: active ? alpha(color, 0.9) : alpha(color, 0.12),
                    },
                    transition: 'all 0.15s ease',
                  }}
                />
              );
            })}
          </Stack>

          {/* Divider */}
          <Box sx={{ width: '1px', height: 20, bgcolor: 'text.disabled', mx: 0.5 }} />

          {/* Time range */}
          <ButtonGroup size="small" variant="outlined" sx={{ flexWrap: 'wrap', maxWidth: '100%', rowGap: 0.5 }}>
            {TIME_RANGES.map((range) => {
              const active = timeRangeKey === range.key;
              return (
                <Button
                  key={range.key}
                  aria-pressed={active}
                  onClick={() => setTimeRangeKey(range.key)}
                  variant={active ? 'contained' : 'outlined'}
                  sx={{
                    minWidth: range.key === 'live' ? 52 : 36,
                    px: 1,
                    fontSize: 11,
                    fontFamily: MONO,
                    fontWeight: active ? 700 : 400,
                    ...(range.key === 'live' && active
                      ? {
                          bgcolor: alpha('#22c55e', 0.2),
                          color: theme.palette.success[theme.palette.mode === 'light' ? 'dark' : 'light'],
                          borderColor: alpha('#22c55e', 0.4),
                          '&:hover': { bgcolor: alpha('#22c55e', 0.3) },
                        }
                      : {}),
                  }}
                >
                  {range.label}
                </Button>
              );
            })}
          </ButtonGroup>

          {/* Custom date pickers */}
          {timeRangeKey === 'custom' && (
            <Stack direction="row" spacing={1} sx={{
              alignItems: "center", flexWrap: 'wrap'
            }}>
              <TextField
                type="datetime-local"
                size="small"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                label="From"
                sx={{
                  width: 200, maxWidth: '100%', minWidth: 0,
                  '& .MuiInputBase-root': { fontSize: 11, fontFamily: MONO },
                  '& .MuiInputLabel-root': { fontSize: 11 },
                }}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                type="datetime-local"
                size="small"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                label="To"
                sx={{
                  width: 200, maxWidth: '100%', minWidth: 0,
                  '& .MuiInputBase-root': { fontSize: 11, fontFamily: MONO },
                  '& .MuiInputLabel-root': { fontSize: 11 },
                }}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>
          )}
        </Stack>
        </Collapse>
      </Box>
      {/* ================================================================== */}
      {/* Stats Bar                                                          */}
      {/* ================================================================== */}
      <Stack
        direction="row"
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: 'wrap', gap: 1,
          mb: 1,
          px: 0.5
        }}>
        <Stack direction="row" spacing={2} sx={{
          alignItems: "center", flexWrap: 'wrap'
        }}>
          <Typography
            variant="caption"
            sx={{ fontFamily: MONO, fontSize: 11, color: 'text.secondary' }}
          >
            {loading
              ? 'Loading...'
              : isLive
                ? `${logRows.length.toLocaleString()} entries`
                : `Showing ${logRows.length.toLocaleString()} of ${total.toLocaleString()}`}
          </Typography>

          {!loading && levelBreakdown.length > 0 && (
            <Stack direction="row" spacing={1.5} sx={{
              alignItems: "center", flexWrap: 'wrap'
            }}>
              <Box sx={{ width: '1px', height: 12, bgcolor: 'divider' }} />
              {levelBreakdown.map((entry) => (
                <Stack key={entry.level} direction="row" spacing={0.5} sx={{
                  alignItems: "center"
                }}>
                  <Box
                    sx={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      bgcolor: logLevelColor(entry.level, theme),
                    }}
                  />
                  <Typography
                    variant="caption"
                    sx={{
                      fontFamily: MONO,
                      fontSize: 10,
                      color: 'text.secondary',
                    }}
                  >
                    {entry.level}: {entry.count.toLocaleString()}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </Stack>

        {streaming && !paused && (
          <Typography
            variant="caption"
            sx={{
              fontFamily: MONO,
              fontSize: 10,
              color: theme.palette.success[theme.palette.mode === 'light' ? 'dark' : 'light'],
              animation: `${pulse} 2s ease-in-out infinite`,
            }}
          >
            streaming every 2s
          </Typography>
        )}
      </Stack>
      {/* ================================================================== */}
      {/* Error banner                                                       */}
      {/* ================================================================== */}
      {error && (
        <Alert closable
          severity="error"
          variant="outlined"
          onClose={() => setError(null)}
          sx={{ mb: 1, fontFamily: MONO, fontSize: 12 }}
        >
          {error}
        </Alert>
      )}
      {/* ================================================================== */}
      {/* Log Viewer — Terminal-style container                               */}
      {/* ================================================================== */}
      <Box
        sx={{
          position: 'relative',
          flex: 1,
          minHeight: 320,
          flexShrink: 0,
          borderRadius: 2,
          overflow: 'hidden',
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        {/* Terminal title bar */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            height: 32,
            px: 1.5,
            bgcolor: 'action.hover',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <TerminalIcon sx={{ fontSize: 16, color: 'text.secondary', mr: 1 }} />
          <Typography
            variant="caption"
            sx={{ fontFamily: MONO, fontSize: 10, color: 'text.secondary', letterSpacing: '0.04em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {daemonMode ? 'omnitron-daemon' : 'omnitron-logs'}
            {app ? ` — ${app}` : ''}
          </Typography>
        </Box>

        {/* Scrollable log area */}
        <Box
          ref={scrollContainerRef}
          onScroll={handleScroll}
          sx={{
            height: 'calc(100% - 32px)',
            overflowY: 'auto',
            overflowX: 'hidden',
            py: 0.5,
            // Custom scrollbar
            '&::-webkit-scrollbar': { width: 6 },
            '&::-webkit-scrollbar-track': { bgcolor: 'transparent' },
            '&::-webkit-scrollbar-thumb': {
              bgcolor: 'action.selected',
              borderRadius: 3,
              '&:hover': { bgcolor: 'text.disabled' },
            },
          }}
        >
          {loading ? (
            <Stack spacing={0.25} sx={{ p: 1.5 }}>
              {Array.from({ length: 20 }, (_, i) => (
                <Skeleton
                  key={i}
                  height={18}
                  sx={{
                    bgcolor: 'action.hover',
                    borderRadius: 0.5,
                    animationDuration: `${1.5 + (i % 5) * 0.2}s`,
                  }}
                />
              ))}
            </Stack>
          ) : logRows.length === 0 ? (
            <Stack
              sx={{
                alignItems: "center",
                justifyContent: "center",
                height: '100%',
                py: 8
              }}>
              <TerminalIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1.5 }} />
              <Typography
                sx={{
                  fontFamily: MONO,
                  fontSize: 12,
                  color: 'text.secondary',
                  textAlign: 'center',
                }}
              >
                No log entries match the current filters.
              </Typography>
              <Typography
                sx={{
                  fontFamily: MONO,
                  fontSize: 11,
                  color: 'text.secondary',
                  mt: 0.5,
                }}
              >
                {hasActiveFilters ? 'Try adjusting your filters.' : 'Waiting for log data...'}
              </Typography>
            </Stack>
          ) : (
            <>
              {/* Load more button at top (for paginated mode) */}
              {hasMore && !isLive && (
                <Stack
                  sx={{
                    alignItems: "center",
                    py: 1
                  }}>
                  <Button
                    size="small"
                    variant="text"
                    onClick={loadMore}
                    disabled={loadingMore}
                    sx={{
                      fontFamily: MONO,
                      fontSize: 10,
                      color: theme.palette.info[theme.palette.mode === 'light' ? 'dark' : 'light'],
                      textTransform: 'none',
                      '&:hover': { bgcolor: alpha('#58a6ff', 0.08) },
                    }}
                  >
                    {loadingMore ? 'Loading...' : `Load older entries (${(total - logRows.length).toLocaleString()} remaining)`}
                  </Button>
                </Stack>
              )}

              {/* Log rows — newest at bottom for live, newest at top for paginated */}
              {logRows.map((log) => (
                <LogRow key={log.id} log={log} isNew={newIdsRef.current.has(log.id)} nodeNames={nodeNameById} />
              ))}
            </>
          )}
        </Box>

        {/* "Scroll to top" FAB + new entries badge */}
        {isLive && !isAtBottom && (
          <Fab
            size="small"
            onClick={scrollToTop}
            sx={{
              position: 'absolute',
              top: 48,
              right: 16,
              bgcolor: alpha('#58a6ff', 0.15),
              color: theme.palette.info[theme.palette.mode === 'light' ? 'dark' : 'light'],
              backdropFilter: 'blur(8px)',
              border: '1px solid',
              borderColor: alpha('#58a6ff', 0.2),
              '&:hover': { bgcolor: alpha('#58a6ff', 0.25) },
              width: 36,
              height: 36,
            }}
          >
            <Badge
              badgeContent={newCount > 0 ? newCount : undefined}
              color="primary"
              sx={{
                '& .MuiBadge-badge': {
                  fontFamily: MONO,
                  fontSize: 9,
                  minWidth: 16,
                  height: 16,
                },
              }}
            >
              <Box
                sx={{
                  width: 0,
                  height: 0,
                  borderLeft: '5px solid transparent',
                  borderRight: '5px solid transparent',
                  borderBottom: '6px solid currentColor',
                }}
              />
            </Badge>
          </Fab>
        )}
      </Box>
    </Box>
  );
}
