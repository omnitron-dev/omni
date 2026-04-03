/**
 * Logs Page — Production-grade streaming log viewer.
 *
 * Terminal-style dark log viewer with rich filtering, live streaming,
 * expandable row detail, virtualized rendering, and level-based stats.
 *
 * This is the most-used page in the Omnitron Console.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
import Skeleton from '@mui/material/Skeleton';
import Alert from '@mui/material/Alert';
import Fab from '@mui/material/Fab';
import Badge from '@mui/material/Badge';
import InputAdornment from '@mui/material/InputAdornment';
import { alpha, keyframes } from '@mui/material/styles';

import { SearchIcon, RefreshIcon, PlayIcon, StopIcon, CloseIcon, TerminalIcon } from 'src/assets/icons';
import { Breadcrumbs } from '@omnitron-dev/prism';
import { logs, daemon, fleet } from 'src/netron/client';
import { LEVEL_COLORS } from 'src/utils/constants';
import { useStackContext } from 'src/hooks/use-stack-context';

import type { LogEntryRow, LogStats } from '@omnitron-dev/omnitron/dto/services';

// =============================================================================
// Constants
// =============================================================================

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

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
}

function LogRow({ log, isNew }: LogRowProps) {
  const [expanded, setExpanded] = useState(false);

  const levelColor = LEVEL_COLORS[log.level] ?? '#6b7280';
  const rowBg = LEVEL_ROW_BG[log.level] ?? 'transparent';

  const hasDetail = log.labels || log.traceId || log.spanId || log.metadata;

  return (
    <>
      <Box
        onClick={() => hasDetail && setExpanded((v) => !v)}
        sx={{
          display: 'grid',
          gridTemplateColumns: '90px 72px 36px 1fr',
          gap: 1,
          alignItems: 'baseline',
          px: 1.5,
          py: '3px',
          bgcolor: expanded ? 'rgba(255,255,255,0.04)' : rowBg,
          borderLeft: `2px solid ${expanded ? levelColor : 'transparent'}`,
          cursor: hasDetail ? 'pointer' : 'default',
          transition: 'background-color 0.15s ease',
          animation: isNew ? `${slideIn} 0.3s ease-out` : undefined,
          '&:hover': {
            bgcolor: 'rgba(255,255,255,0.04)',
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
              color: '#5a6270',
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
            color: '#58a6ff',
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
            color: log.level === 'error' || log.level === 'fatal' ? '#fca5a5' : '#c9d1d9',
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
      <Collapse in={expanded} unmountOnExit>
        <Box
          sx={{
            ml: '14px',
            mr: 1.5,
            mb: 0.5,
            p: 1.5,
            bgcolor: 'rgba(255,255,255,0.025)',
            borderRadius: 1,
            borderLeft: `2px solid ${alpha(levelColor, 0.3)}`,
          }}
        >
          <Box
            component="pre"
            sx={{
              fontFamily: MONO,
              fontSize: 11,
              color: '#8b949e',
              m: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              lineHeight: 1.7,
            }}
          >
            {log.traceId && (
              <span>
                <span style={{ color: '#7c8493' }}>traceId: </span>
                <span style={{ color: '#d2a8ff' }}>{log.traceId}</span>
                {'\n'}
              </span>
            )}
            {log.spanId && (
              <span>
                <span style={{ color: '#7c8493' }}>spanId:  </span>
                <span style={{ color: '#d2a8ff' }}>{log.spanId}</span>
                {'\n'}
              </span>
            )}
            {log.labels && (
              <span>
                <span style={{ color: '#7c8493' }}>labels:  </span>
                <span style={{ color: '#7ee787' }}>
                  {JSON.stringify(log.labels, null, 2)}
                </span>
                {'\n'}
              </span>
            )}
            {log.metadata && (
              <span>
                <span style={{ color: '#7c8493' }}>metadata:</span>
                {'\n'}
                <span style={{ color: '#e6edf3' }}>
                  {JSON.stringify(log.metadata, null, 2)}
                </span>
              </span>
            )}
          </Box>
        </Box>
      </Collapse>
    </>
  );
}

// =============================================================================
// LogsPage — Main component
// =============================================================================

export default function LogsPage() {
  const { activeProject, filterApps, displayName } = useStackContext();
  const daemonMode = !activeProject;

  // ---- Filters ----
  const [app, setApp] = useState(daemonMode ? 'omnitron' : '');
  const [nodeFilter, setNodeFilter] = useState(''); // cluster node filter
  const [nodeNames, setNodeNames] = useState<Array<{ id: string; hostname: string }>>([]);
  const [selectedLevels, setSelectedLevels] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [timeRangeKey, setTimeRangeKey] = useState<TimeRangeKey>(daemonMode ? 'live' : '1h');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // ---- Data ----
  const [logRows, setLogRows] = useState<LogEntryRow[]>([]);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [appNames, setAppNames] = useState<string[]>([]);
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

  // ---- Fetch app names + cluster nodes ----
  useEffect(() => {
    (async () => {
      try {
        const list = await daemon.list();
        const filtered = filterApps(list);
        const names = [...new Set(filtered.map((a: any) => displayName(a.name)))];
        setAppNames(names);
      } catch {
        /* noop */
      }
      try {
        const nodes = await fleet.listNodes();
        if (Array.isArray(nodes) && nodes.length > 0) {
          setNodeNames(nodes.map((n: any) => ({ id: n.id, hostname: n.hostname })));
        }
      } catch {
        /* fleet not available — single node mode */
      }
    })();
  }, []);

  // ---- Fetch stats ----
  const fetchStats = useCallback(async () => {
    try {
      const s: LogStats = await logs.getLogStats();
      setStats(s);
      if (s.byApp.length > 0) {
        setAppNames((prev) => {
          const names = new Set([...prev, ...s.byApp.map((a) => a.app)]);
          return Array.from(names).sort();
        });
      }
    } catch {
      /* stats optional */
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

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

      // Node filter — adds nodeId to labels for cluster log filtering
      const labels = parseLabelInput(labelInput) ?? {};
      if (nodeFilter) labels['nodeId'] = nodeFilter;
      if (Object.keys(labels).length > 0) filter.labels = labels;

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
    try {
      setLoading(true);
      const result = await logs.queryLogs(buildFilter(0) as any);
      setLogRows(result.entries);
      setTotal(result.total);
      setHasMore(result.hasMore);
      setError(null);
      newIdsRef.current.clear();

      // Set last timestamp for streaming transition
      if (result.entries.length > 0) {
        lastTimestampRef.current = new Date(result.entries[0]!.timestamp).toISOString();
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to query logs');
    } finally {
      setLoading(false);
    }
  }, [buildFilter]);

  // ---- Load more (older entries) ----
  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const result = await logs.queryLogs(buildFilter(logRows.length) as any);
      setLogRows((prev) => [...prev, ...result.entries]);
      setHasMore(result.hasMore);
    } catch (err: any) {
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
    const f: Record<string, unknown> = { tail: 100 };
    if (app) f.app = app;
    if (selectedLevels.length > 0) f.level = selectedLevels;
    if (debouncedSearch.trim()) f.search = debouncedSearch.trim();
    return f;
  }, [app, selectedLevels, debouncedSearch]);

  // Initial live fetch
  useEffect(() => {
    if (!isLive) return;
    (async () => {
      try {
        setLoading(true);
        const entries: LogEntryRow[] = await logs.streamLogs(streamFilter as any);
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
        setError(err?.message ?? 'Failed to stream logs');
      } finally {
        setLoading(false);
      }
    })();
  }, [isLive, streamFilter]);

  // Polling interval for live mode
  useEffect(() => {
    if (streamRef.current) {
      clearInterval(streamRef.current);
      streamRef.current = null;
    }

    if (!streaming || paused) return;

    streamRef.current = setInterval(async () => {
      try {
        const since = lastTimestampRef.current;
        const filter = { ...streamFilter, tail: 50 } as any;
        if (since) filter.since = since;

        const entries: LogEntryRow[] = await logs.streamLogs(filter);
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
        /* silent polling failure */
      }
    }, STREAM_INTERVAL);

    return () => {
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
    setApp('');
    setNodeFilter('');
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
    selectedLevels.length > 0 ||
    debouncedSearch !== '' ||
    labelInput !== '';

  // ---- Stats breakdown (filtered) ----
  const filteredStats = useMemo(() => {
    if (!stats) return null;

    // Build level breakdown from stats or current log set
    const levelMap = new Map<string, number>();
    if (isLive) {
      for (const log of logRows) {
        levelMap.set(log.level, (levelMap.get(log.level) ?? 0) + 1);
      }
    } else {
      for (const entry of stats.byLevel) {
        levelMap.set(entry.level, entry.count);
      }
    }

    return LEVELS.filter((l) => levelMap.has(l)).map((l) => ({
      level: l,
      count: levelMap.get(l)!,
    }));
  }, [stats, logRows, isLive]);

  // ---- Refresh stats on filter change (non-live) ----
  useEffect(() => {
    if (!isLive) fetchStats();
  }, [buildFilter, isLive, fetchStats]);

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* ================================================================== */}
      {/* Filter Bar — glass-morphism header                                 */}
      {/* ================================================================== */}
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          mb: 2,
          p: 2,
          borderRadius: 2,
          bgcolor: alpha('#0a0a0f', 0.85),
          backdropFilter: 'blur(16px)',
          border: '1px solid',
          borderColor: alpha('#fff', 0.06),
        }}
      >
        {/* Row 1: Title + controls */}
        <Breadcrumbs
          links={[{ name: daemonMode ? 'Daemon Logs' : 'Logs' }]}
          sx={{ mb: 1.5 }}
          action={
            <Stack direction="row" spacing={0.5} alignItems="center">
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
                    color: paused ? '#f59e0b' : '#22c55e',
                    animation: !paused ? `${pulse} 2s ease-in-out infinite` : undefined,
                    border: '1px solid',
                    borderColor: paused ? alpha('#f59e0b', 0.3) : alpha('#22c55e', 0.3),
                  }}
                />
              )}
              {isLive && (
                <Tooltip title={paused ? 'Resume streaming' : 'Pause streaming'}>
                  <IconButton size="small" onClick={() => setPaused((v) => !v)} sx={{ color: paused ? '#f59e0b' : '#22c55e' }}>
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
                    fetchStats();
                  }}
                >
                  <RefreshIcon />
                </IconButton>
              </Tooltip>
              {hasActiveFilters && (
                <Tooltip title="Clear all filters">
                  <IconButton size="small" onClick={clearFilters} sx={{ color: '#ef4444' }}>
                    <CloseIcon />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          }
        />

        {/* Row 2: App + Search + Labels */}
        <Stack direction="row" spacing={1.5} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
          {!daemonMode && (
            <TextField
              select
              size="small"
              label="Application"
              value={app}
              onChange={(e) => setApp(e.target.value)}
              sx={{
                minWidth: 150,
                '& .MuiInputBase-root': { fontFamily: MONO, fontSize: 12 },
                '& .MuiInputLabel-root': { fontSize: 12 },
              }}
            >
              <MenuItem value="">
                <em>All Apps</em>
              </MenuItem>
              {appNames.map((name) => (
                <MenuItem key={name} value={name} sx={{ fontFamily: MONO, fontSize: 12 }}>
                  {name}
                </MenuItem>
              ))}
            </TextField>
          )}

          {/* Node selector — only visible when cluster has multiple nodes */}
          {!daemonMode && nodeNames.length > 0 && (
            <TextField
              select
              size="small"
              label="Node"
              value={nodeFilter}
              onChange={(e) => setNodeFilter(e.target.value)}
              sx={{
                minWidth: 140,
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
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 16, color: '#5a6270' }} />
                  </InputAdornment>
                ),
              },
            }}
            sx={{
              flex: 1,
              minWidth: 200,
              '& .MuiInputBase-root': { fontFamily: MONO, fontSize: 12 },
            }}
          />

          {!daemonMode && (
            <TextField
              size="small"
              placeholder="Labels: key=val, key2=val2"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              sx={{
                minWidth: 200,
                '& .MuiInputBase-root': { fontFamily: MONO, fontSize: 12 },
              }}
            />
          )}
        </Stack>

        {/* Row 3: Levels + Time range */}
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          {/* Level chips */}
          <Stack direction="row" spacing={0.5} alignItems="center">
            {LEVELS.map((level) => {
              const active = selectedLevels.includes(level);
              const color = LEVEL_COLORS[level] ?? '#6b7280';
              return (
                <Chip
                  key={level}
                  size="small"
                  label={
                    <Stack direction="row" spacing={0.5} alignItems="center">
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
                  onClick={() => toggleLevel(level)}
                  sx={{
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    height: 24,
                    borderColor: active ? color : alpha(color, 0.3),
                    color: active ? '#fff' : color,
                    bgcolor: active ? alpha(color, 0.8) : 'transparent',
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
          <Box sx={{ width: 1, height: 20, bgcolor: alpha('#fff', 0.08), mx: 0.5 }} />

          {/* Time range */}
          <ButtonGroup size="small" variant="outlined" sx={{ height: 28 }}>
            {TIME_RANGES.map((range) => {
              const active = timeRangeKey === range.key;
              return (
                <Button
                  key={range.key}
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
                          color: '#22c55e',
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
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                type="datetime-local"
                size="small"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                label="From"
                sx={{
                  width: 200,
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
                  width: 200,
                  '& .MuiInputBase-root': { fontSize: 11, fontFamily: MONO },
                  '& .MuiInputLabel-root': { fontSize: 11 },
                }}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>
          )}
        </Stack>
      </Box>

      {/* ================================================================== */}
      {/* Stats Bar                                                          */}
      {/* ================================================================== */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 1, px: 0.5 }}
      >
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography
            variant="caption"
            sx={{ fontFamily: MONO, fontSize: 11, color: '#5a6270' }}
          >
            {loading
              ? 'Loading...'
              : isLive
                ? `${logRows.length.toLocaleString()} entries`
                : `Showing ${logRows.length.toLocaleString()} of ${total.toLocaleString()}`}
          </Typography>

          {filteredStats && filteredStats.length > 0 && (
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box sx={{ width: 1, height: 12, bgcolor: alpha('#fff', 0.06) }} />
              {filteredStats.map((entry) => (
                <Stack key={entry.level} direction="row" spacing={0.5} alignItems="center">
                  <Box
                    sx={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      bgcolor: LEVEL_COLORS[entry.level] ?? '#6b7280',
                    }}
                  />
                  <Typography
                    variant="caption"
                    sx={{
                      fontFamily: MONO,
                      fontSize: 10,
                      color: '#5a6270',
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
              color: alpha('#22c55e', 0.6),
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
        <Alert
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
          minHeight: 400,
          borderRadius: 2,
          overflow: 'hidden',
          border: '1px solid',
          borderColor: alpha('#fff', 0.06),
          bgcolor: '#0a0a0f',
        }}
      >
        {/* Terminal title bar */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            height: 32,
            px: 1.5,
            bgcolor: alpha('#fff', 0.03),
            borderBottom: '1px solid',
            borderColor: alpha('#fff', 0.05),
          }}
        >
          <Stack direction="row" spacing={0.5} sx={{ mr: 1.5 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#ef4444' }} />
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#f59e0b' }} />
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#22c55e' }} />
          </Stack>
          <Typography
            variant="caption"
            sx={{ fontFamily: MONO, fontSize: 10, color: '#5a6270', letterSpacing: '0.04em' }}
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
              bgcolor: alpha('#fff', 0.1),
              borderRadius: 3,
              '&:hover': { bgcolor: alpha('#fff', 0.2) },
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
                    bgcolor: alpha('#fff', 0.03),
                    borderRadius: 0.5,
                    animationDuration: `${1.5 + (i % 5) * 0.2}s`,
                  }}
                />
              ))}
            </Stack>
          ) : logRows.length === 0 ? (
            <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', py: 8 }}>
              <TerminalIcon sx={{ fontSize: 40, color: alpha('#fff', 0.08), mb: 1.5 }} />
              <Typography
                sx={{
                  fontFamily: MONO,
                  fontSize: 12,
                  color: '#5a6270',
                  textAlign: 'center',
                }}
              >
                No log entries match the current filters.
              </Typography>
              <Typography
                sx={{
                  fontFamily: MONO,
                  fontSize: 11,
                  color: alpha('#fff', 0.15),
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
                <Stack alignItems="center" sx={{ py: 1 }}>
                  <Button
                    size="small"
                    variant="text"
                    onClick={loadMore}
                    disabled={loadingMore}
                    sx={{
                      fontFamily: MONO,
                      fontSize: 10,
                      color: '#58a6ff',
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
                <LogRow key={log.id} log={log} isNew={newIdsRef.current.has(log.id)} />
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
              color: '#58a6ff',
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
