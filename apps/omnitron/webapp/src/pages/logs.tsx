import { ArrowUpIcon } from '@omnitron-dev/prism/icons';
import { readLogIngestion } from '../../../src/shared/log-ingestion-reading';
import type { LogIngestionStats } from '@omnitron-dev/omnitron/dto/services';
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
import InputAdornment from '@mui/material/InputAdornment';
import { alpha, keyframes, useTheme } from '@mui/material/styles';

import { SearchIcon, RefreshIcon, PlayIcon, StopIcon, CloseIcon, TerminalIcon } from 'src/assets/icons';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { Breadcrumbs } from 'src/components/page-breadcrumbs';
import { LogEntryRowView, logLevelColor } from 'src/components/log-entry-row';
import { Skeleton } from '@omnitron-dev/prism/components/skeleton';
import { useCopyToClipboard } from '@omnitron-dev/prism/core';
import { logs, daemon, nodes as nodesRpc } from 'src/netron/client';
import { useStackContext } from 'src/hooks/use-stack-context';
import { LogLevelFilter } from 'src/components/log-level-filter';
import { DEFAULT_LOG_LEVELS } from 'src/utils/log-levels';
import { logCommand } from 'src/utils/log-location';

import type { LogEntryRow, LevelCount } from '@omnitron-dev/omnitron/dto/services';

// =============================================================================
// Constants
// =============================================================================

/**
 * The known levels in severity order, then any other a writer recorded, as
 * recorded — `medium`, `None`: an app that logs its own `level` field
 * overwrites the record's. Dropping those made the breakdown fall short of
 * the total beside it.
 */
function inLevelOrder(counts: readonly LevelCount[]): LevelCount[] {
  const rank = (level: string) => {
    const known = DEFAULT_LOG_LEVELS.indexOf(level);
    return known === -1 ? DEFAULT_LOG_LEVELS.length : known;
  };
  return [...counts].sort((a, b) => rank(a.level) - rank(b.level));
}

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
const LIVE_TAIL_SIZE = 50;
const SEARCH_DEBOUNCE = 300;
const SCROLL_THRESHOLD = 80; // px from bottom to consider "at bottom"

// Animations
const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.5; }
`;

// =============================================================================
// Helpers
// =============================================================================

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
// LogsPage — Main component
// =============================================================================

export default function LogsPage() {
  const [ingestion, setIngestion] = useState<LogIngestionStats | null>(null);
  const ingestionReading = readLogIngestion(ingestion);
  useEffect(() => {
    let active = true;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try { const value = await logs.getIngestionStats(); if (active) setIngestion(value); }
      catch { if (active) setIngestion(null); }
      finally { inFlight = false; }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const theme = useTheme();
  const { activeProject, namespacePrefixes, matchesNamespace, filterApps, displayName } = useStackContext();
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
  useEffect(() => {
    if (activeProject && app && !matchesNamespace(app)) {
      setParams(previous => { const next = new URLSearchParams(previous); next.set('app', ''); return next; }, { replace: true });
    }
  }, [activeProject, app, matchesNamespace, setParams]);
  /** The same list the Node dropdown shows, keyed for the row detail. */
  const nodeNameById = useMemo(
    () => Object.fromEntries(nodeNames.map((n) => [n.id, n.hostname])),
    [nodeNames],
  );
  const selectedLevels = useMemo(() => [...new Set(params.getAll('level'))], [params]);
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
  const [tailLimited, setTailLimited] = useState(false);
  const [paused, setPaused] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const streamRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTimestampRef = useRef<string | null>(null);
  const newIdsRef = useRef<Set<string>>(new Set());
  const viewGeneration = useRef(0);

  // A late answer for another node must never appear under the new node's name.
  useEffect(() => {
    const generation = viewGeneration;
    generation.current++;
    setLogRows([]);
    setTotal(0);
    setHasMore(false);
    setNewCount(0);
    lastTimestampRef.current = null;
    setTailLimited(false);
    return () => { generation.current++; };
  }, [app, namespacePrefixes, nodeFilter, selectedLevels, debouncedSearch, labelInput, timeRangeKey, customFrom, customTo]);

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
      name === app || matchesNamespace(name) || !name.includes('/');
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
  }, [liveApps, loggedApps, matchesNamespace, displayName, app, daemonMode]);

  // ---- Build filter ----
  const buildFilter = useCallback(
    (offset = 0) => {
      const filter: Record<string, unknown> = {
        limit: PAGE_SIZE,
        offset,
      };
      if (app) filter['app'] = app;
      if (activeProject) filter['appPrefixes'] = namespacePrefixes;
      if (selectedLevels.length > 0) filter['level'] = selectedLevels;
      if (debouncedSearch.trim()) filter['search'] = debouncedSearch.trim();

      // The node filter is a COLUMN, not a label. It used to be folded into
      // `labels` — where the daemon ignored the whole field, so choosing a
      // node narrowed nothing while its chip stayed lit.
      if (nodeFilter) filter['nodeId'] = nodeFilter;

      const labels = parseLabelInput(labelInput);
      if (labels && Object.keys(labels).length > 0) filter['labels'] = labels;

      if (timeRangeKey === 'custom') {
        if (customFrom) filter['from'] = new Date(customFrom).toISOString();
        if (customTo) filter['to'] = new Date(customTo).toISOString();
      } else if (timeRangeKey !== 'live') {
        const range = TIME_RANGES.find((r) => r.key === timeRangeKey);
        if (range && range.minutes > 0) {
          filter['from'] = new Date(Date.now() - range.minutes * 60 * 1000).toISOString();
        }
      }

      return filter;
    },
    [app, activeProject, namespacePrefixes, nodeFilter, selectedLevels, debouncedSearch, labelInput, timeRangeKey, customFrom, customTo],
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
    if (app) f['app'] = app;
    if (activeProject) f['appPrefixes'] = namespacePrefixes;
    if (selectedLevels.length > 0) f['level'] = selectedLevels;
    if (debouncedSearch.trim()) f['search'] = debouncedSearch.trim();
    if (nodeFilter) f['nodeId'] = nodeFilter;

    const labels = parseLabelInput(labelInput);
    if (labels && Object.keys(labels).length > 0) f['labels'] = labels;

    return f;
  }, [app, activeProject, namespacePrefixes, selectedLevels, debouncedSearch, nodeFilter, labelInput]);

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
        const filter = { ...streamFilter, tail: LIVE_TAIL_SIZE, ...(since ? { since } : {}) };

        const entries: LogEntryRow[] = await logs.streamLogs(filter);
        if (!active) return;
        setError(null);
        if (entries.length === LIVE_TAIL_SIZE) setTailLimited(true);
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
    el.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setNewCount(0);
  }, []);

  // ---- Level toggle ----
  const setLevels = (levels: string[]) => setParams(previous => {
    const next = new URLSearchParams(previous);
    next.delete('level');
    for (const level of levels) next.append('level', level);
    return next;
  }, { replace: true });

  // ---- Clear all filters ----
  const clearFilters = () => {
    setParams({ app: '' }, { replace: true });
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
              <Tooltip title={`Current node: ${ingestionReading.detail}`}>
                <Chip size="small" color={ingestionReading.severity} variant="outlined" label={ingestionReading.title} />
              </Tooltip>
              {isLive && (
                <Chip
                  label={paused ? 'PAUSED' : 'LIVE TAIL'}
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
              <Tooltip title="Refresh (R)">
                <IconButton data-console-command="refresh" aria-label="Refresh logs"
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

          <TextField data-console-command="search"
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
          <LogLevelFilter selected={selectedLevels} counts={new Map(levelBreakdown.map(row => [row.level, row.count]))} onChange={setLevels} />

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
              color: theme.palette[tailLimited ? 'warning' : 'success'][theme.palette.mode === 'light' ? 'dark' : 'light'],
              animation: `${pulse} 2s ease-in-out infinite`,
            }}
          >
            {tailLimited ? 'Tail window filled · use history for the full record' : 'Recent tail · every 2s · up to 50 events per poll'}
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
                <LogEntryRowView key={log.id} log={log} isNew={newIdsRef.current.has(log.id)} nodeNames={nodeNameById} />
              ))}
            </>
          )}
        </Box>

        {isLive && !isAtBottom && (
          <Button
            size="small"
            variant="contained"
            onClick={scrollToTop}
            aria-label={newCount ? `Jump to latest logs, ${newCount} new entries` : 'Jump to latest logs'}
            data-console-command="latest"
            startIcon={<ArrowUpIcon />}
            sx={{
              position: 'absolute',
              bottom: { xs: 12, sm: 16 },
              right: { xs: 12, sm: 16 },
              minHeight: { xs: 44, sm: 36 },
              px: 1.5,
              gap: 0.75,
              bgcolor: 'background.paper',
              color: 'primary.main',
              border: 1,
              borderColor: 'divider',
              boxShadow: theme.shadows[3],
              '&:hover': { bgcolor: 'action.hover' },
              '& .MuiButton-startIcon': { mr: 0.25 },
            }}
          >
            Latest
            {newCount > 0 && (
              <Box
                component="span"
                aria-hidden="true"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 22,
                  height: 22,
                  px: 0.75,
                  borderRadius: 0.75,
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  fontSize: 11,
                  fontWeight: 600,
                  lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {newCount > 999 ? '999+' : newCount}
              </Box>
            )}
          </Button>
        )}
      </Box>
    </Box>
  );
}
