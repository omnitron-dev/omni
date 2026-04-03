import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Alert from '@mui/material/Alert';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import LinearProgress from '@mui/material/LinearProgress';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import Tooltip from '@mui/material/Tooltip';
import Collapse from '@mui/material/Collapse';
import { alpha, useTheme, keyframes } from '@mui/material/styles';
import Chart from 'react-apexcharts';
import { RestartIcon, StopIcon, PlayIcon, RefreshIcon, CircleIcon, SearchIcon } from 'src/assets/icons';
import { Breadcrumbs } from '@omnitron/prism';

import { daemon, logs, metrics } from 'src/netron/client';
import { formatUptime, formatMemory, formatTimestamp } from 'src/utils/formatters';
import { STATUS_COLORS, LEVEL_COLORS } from 'src/utils/constants';
import { useStackContext } from 'src/hooks/use-stack-context';

import type { ProcessInfoDto, AppDiagnosticsDto, LogEntryRow } from '@omnitron-dev/omnitron/dto/services';

// ---------------------------------------------------------------------------
// Tab Panel
// ---------------------------------------------------------------------------

function TabPanel({ children, value, index }: { children: React.ReactNode; value: number; index: number }) {
  const [mounted, setMounted] = useState(value === index);
  useEffect(() => { if (value === index) setMounted(true); }, [value, index]);
  if (!mounted) return null;
  return (
    <Box sx={{ pt: 2, display: value === index ? 'block' : 'none' }}>
      {children}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Stat Card — compact metric display
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  const theme = useTheme();
  return (
    <Card
      variant="outlined"
      sx={{
        flex: 1,
        minWidth: 140,
        bgcolor: color ? alpha(color, 0.04) : undefined,
        borderColor: color ? alpha(color, 0.2) : undefined,
      }}
    >
      <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10 }}>
          {label}
        </Typography>
        <Typography variant="h5" fontWeight={700} sx={{ color: color ?? 'text.primary', mt: 0.25 }}>
          {value}
        </Typography>
        {sub && (
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: 11 }}>
            {sub}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Overview Tab
// ---------------------------------------------------------------------------

function OverviewTab({
  app,
  diagnostics,
  diagLoading,
}: {
  app: ProcessInfoDto;
  diagnostics: AppDiagnosticsDto | null;
  diagLoading: boolean;
}) {
  const theme = useTheme();

  const memPercent = diagnostics && diagnostics.memory.heapTotal > 0
    ? Math.round((diagnostics.memory.heapUsed / diagnostics.memory.heapTotal) * 100)
    : 0;
  const hasHeapData = diagnostics != null && diagnostics.memory.heapTotal > 0;

  return (
    <Stack spacing={3}>
      {/* Stat cards row */}
      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
        <StatCard
          label="CPU"
          value={app.cpu > 0 ? `${app.cpu.toFixed(1)}%` : '—'}
          color={app.cpu > 80 ? theme.palette.error.main : undefined}
        />
        <StatCard
          label="Memory"
          value={formatMemory(app.memory)}
          sub={diagnostics
            ? hasHeapData
              ? `Heap: ${formatMemory(diagnostics.memory.heapUsed)} / ${formatMemory(diagnostics.memory.heapTotal)}`
              : `RSS: ${formatMemory(diagnostics.memory.rss)}`
            : undefined}
        />
        <StatCard
          label="Uptime"
          value={formatUptime(app.uptime)}
        />
        <StatCard
          label="Restarts"
          value={app.restarts}
          color={app.restarts > 0 ? theme.palette.warning.main : undefined}
        />
        <StatCard
          label="Instances"
          value={app.instances}
        />
      </Stack>

      {/* Memory usage bar */}
      {diagnostics && (
        <Card variant="outlined">
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            {hasHeapData ? (
              <>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">Heap Usage</Typography>
                  <Typography variant="caption" fontWeight={600}>{memPercent}%</Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={memPercent}
                  sx={{
                    height: 6, borderRadius: 3,
                    bgcolor: alpha(theme.palette.primary.main, 0.08),
                    '& .MuiLinearProgress-bar': {
                      borderRadius: 3,
                      bgcolor: memPercent > 85 ? theme.palette.error.main : theme.palette.primary.main,
                    },
                  }}
                />
                <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
                  <Typography variant="caption" color="text.disabled">RSS: {formatMemory(diagnostics.memory.rss)}</Typography>
                  <Typography variant="caption" color="text.disabled">External: {formatMemory(diagnostics.memory.external)}</Typography>
                </Stack>
              </>
            ) : (
              <Stack spacing={0.5}>
                <Typography variant="caption" color="text.secondary">Memory (RSS)</Typography>
                <Typography variant="h6" fontWeight={600}>{formatMemory(diagnostics.memory.rss)}</Typography>
              </Stack>
            )}
          </CardContent>
        </Card>
      )}

      {/* Process Topology */}
      {app.processes && app.processes.length > 0 && (
        <Card variant="outlined">
          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
            <Typography variant="subtitle2" fontWeight={600} sx={{ px: 2, pt: 1.5, pb: 1 }}>
              Process Topology
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Process</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">PID</TableCell>
                    <TableCell>Uptime</TableCell>
                    <TableCell align="right">CPU</TableCell>
                    <TableCell align="right">Memory</TableCell>
                    <TableCell align="right">Restarts</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {app.processes.map((proc) => (
                    <TableRow key={proc.name}>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <CircleIcon sx={{
                            fontSize: 8,
                            color: proc.status === 'online'
                              ? theme.palette.success.main
                              : proc.status === 'stopped'
                                ? theme.palette.text.disabled
                                : theme.palette.error.main,
                          }} />
                          <Typography variant="body2" fontWeight={600}>{proc.name}</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Chip label={proc.type} size="small" variant="outlined" sx={{ fontSize: 11, height: 22 }} />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={proc.status}
                          size="small"
                          color={STATUS_COLORS[proc.status] || 'default'}
                          variant="outlined"
                          sx={{ fontSize: 11, height: 22 }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                          {proc.pid ?? '—'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontSize: 12 }}>
                          {formatUptime(proc.uptime)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" sx={{ fontSize: 12 }}>
                          {proc.cpu > 0 ? `${proc.cpu.toFixed(1)}%` : '—'}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" sx={{ fontSize: 12 }}>
                          {formatMemory(proc.memory)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" sx={{ fontSize: 12, color: proc.restarts > 0 ? theme.palette.warning.main : undefined }}>
                          {proc.restarts}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {/* Exposed Services (deduplicated) */}
      {diagnostics && diagnostics.services.length > 0 && (() => {
        const unique = [...new Set(diagnostics.services)];
        return (
          <Card variant="outlined">
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                Exposed Services
              </Typography>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                {unique.map((svc) => (
                  <Chip key={svc} label={svc} size="small" variant="outlined" sx={{ fontSize: 11, height: 24 }} />
                ))}
              </Stack>
            </CardContent>
          </Card>
        );
      })()}

      {/* Process Details */}
      <Card variant="outlined">
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
            Details
          </Typography>
          <Stack spacing={0.75}>
            <InfoRow label="Mode" value={app.mode} />
            <InfoRow label="PID" value={app.pid ?? '—'} mono />
            <InfoRow label="Port" value={app.port ?? '—'} mono />
            <InfoRow label="Critical" value={app.critical ? 'Yes' : 'No'} />
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center">
      <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontSize: 13, ...(mono && { fontFamily: 'monospace' }) }}>
        {value}
      </Typography>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Logs Tab — streaming log viewer with filtering
// ---------------------------------------------------------------------------

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
const LEVEL_LABELS: Record<string, string> = { trace: 'TRC', debug: 'DBG', info: 'INF', warn: 'WRN', error: 'ERR', fatal: 'FTL' };
const LEVEL_ROW_BG: Record<string, string> = { fatal: 'rgba(220,38,38,0.08)', error: 'rgba(239,68,68,0.05)', warn: 'rgba(245,158,11,0.04)' };
const MONO = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', monospace";
const STREAM_INTERVAL = 2000;
const SEARCH_DEBOUNCE = 300;

const slideIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
`;

function formatTimePrecise(ts: Date | string): string {
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function formatDateFull(ts: Date | string): string {
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  return `${d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function LogRow({ log, isNew }: { log: LogEntryRow; isNew?: boolean }) {
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
          gridTemplateColumns: '90px 36px 1fr',
          gap: 1,
          alignItems: 'baseline',
          px: 1.5,
          py: '3px',
          bgcolor: expanded ? 'rgba(255,255,255,0.04)' : rowBg,
          borderLeft: `2px solid ${expanded ? levelColor : 'transparent'}`,
          cursor: hasDetail ? 'pointer' : 'default',
          transition: 'background-color 0.15s ease',
          animation: isNew ? `${slideIn} 0.3s ease-out` : undefined,
          '&:hover': { bgcolor: 'rgba(255,255,255,0.04)' },
        }}
      >
        <Tooltip title={formatDateFull(log.timestamp)} placement="top-start" arrow enterDelay={400}>
          <Typography component="span" sx={{ fontFamily: MONO, fontSize: 11, color: '#5a6270', lineHeight: '20px', whiteSpace: 'nowrap', letterSpacing: '-0.02em' }}>
            {formatTimePrecise(log.timestamp)}
          </Typography>
        </Tooltip>
        <Typography component="span" sx={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: levelColor, lineHeight: '20px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {LEVEL_LABELS[log.level] ?? log.level.slice(0, 3).toUpperCase()}
        </Typography>
        <Typography component="span" sx={{
          fontFamily: MONO, fontSize: 11.5, lineHeight: '20px', overflow: 'hidden',
          color: log.level === 'error' || log.level === 'fatal' ? '#fca5a5' : '#c9d1d9',
          textOverflow: 'ellipsis', whiteSpace: expanded ? 'pre-wrap' : 'nowrap', wordBreak: expanded ? 'break-all' : undefined,
        }}>
          {log.message}
        </Typography>
      </Box>
      <Collapse in={expanded} unmountOnExit>
        <Box sx={{ ml: '14px', mr: 1.5, mb: 0.5, p: 1.5, bgcolor: 'rgba(255,255,255,0.025)', borderRadius: 1, borderLeft: `2px solid ${alpha(levelColor, 0.3)}` }}>
          <Box component="pre" sx={{ fontFamily: MONO, fontSize: 11, color: '#8b949e', m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.7 }}>
            {log.traceId && <span><span style={{ color: '#7c8493' }}>traceId: </span><span style={{ color: '#d2a8ff' }}>{log.traceId}</span>{'\n'}</span>}
            {log.spanId && <span><span style={{ color: '#7c8493' }}>spanId:  </span><span style={{ color: '#d2a8ff' }}>{log.spanId}</span>{'\n'}</span>}
            {log.labels && <span><span style={{ color: '#7c8493' }}>labels:  </span><span style={{ color: '#7ee787' }}>{JSON.stringify(log.labels, null, 2)}</span>{'\n'}</span>}
            {log.metadata && <span><span style={{ color: '#7c8493' }}>metadata:</span>{'\n'}<span style={{ color: '#e6edf3' }}>{JSON.stringify(log.metadata, null, 2)}</span></span>}
          </Box>
        </Box>
      </Collapse>
    </>
  );
}

function LogsTab({ appName }: { appName: string }) {
  // DB stores short app names ("main"), not namespaced ("omni/dev/main")
  const dbAppName = appName.includes('/') ? appName.split('/').pop()! : appName;

  const [logs, setLogs] = useState<LogEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [selectedLevels, setSelectedLevels] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const streamRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTimestampRef = useRef<string | null>(null);
  const newIdsRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Search debounce
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setDebouncedSearch(searchInput), SEARCH_DEBOUNCE);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchInput]);

  // Level toggle
  const toggleLevel = (level: string) => {
    setSelectedLevels((prev) => prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]);
  };

  // Stream filter
  const streamFilter = useMemo(() => {
    const f: Record<string, unknown> = { tail: 200, app: dbAppName };
    if (selectedLevels.length > 0) f.level = selectedLevels;
    if (debouncedSearch.trim()) f.search = debouncedSearch.trim();
    return f;
  }, [appName, selectedLevels, debouncedSearch]);

  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const entries: LogEntryRow[] = await logs.streamLogs(streamFilter as any);
        if (cancelled) return;
        const reversed = [...entries].reverse();
        setLogs(reversed);
        newIdsRef.current.clear();
        if (entries.length > 0) {
          lastTimestampRef.current = new Date(entries[entries.length - 1]!.timestamp).toISOString();
        }
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [streamFilter]);

  // Streaming interval
  useEffect(() => {
    if (streamRef.current) { clearInterval(streamRef.current); streamRef.current = null; }
    if (paused) return;

    streamRef.current = setInterval(async () => {
      try {
        const since = lastTimestampRef.current;
        const filter = { ...streamFilter, tail: 50 } as any;
        if (since) filter.since = since;

        const entries: LogEntryRow[] = await logs.streamLogs(filter);
        if (entries.length === 0) return;

        const existingIds = new Set(logs.map((l) => l.id));
        const fresh = entries.filter((e) => !existingIds.has(e.id));
        if (fresh.length === 0) return;

        fresh.forEach((e) => newIdsRef.current.add(e.id));
        setTimeout(() => { fresh.forEach((e) => newIdsRef.current.delete(e.id)); }, 2000);

        lastTimestampRef.current = new Date(fresh[fresh.length - 1]!.timestamp).toISOString();

        setLogs((prev) => {
          const merged = [...fresh.reverse(), ...prev];
          return merged.length > 2000 ? merged.slice(0, 2000) : merged;
        });
      } catch {
        // silent polling failure
      }
    }, STREAM_INTERVAL);

    return () => { if (streamRef.current) clearInterval(streamRef.current); };
  }, [paused, streamFilter, logs]);

  // Level counts from current logs
  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const log of logs) counts[log.level] = (counts[log.level] ?? 0) + 1;
    return counts;
  }, [logs]);

  return (
    <Stack spacing={1.5}>
      {/* Controls bar */}
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
        {/* Search */}
        <TextField
          size="small"
          placeholder="Search logs..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          slotProps={{
            input: {
              startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 16, color: 'text.disabled' }} /></InputAdornment>,
              sx: { fontSize: 13 },
            },
          }}
          sx={{ minWidth: 200, flex: 1, maxWidth: 320 }}
        />

        {/* Level chips */}
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
          {LEVELS.map((level) => (
            <Chip
              key={level}
              label={`${LEVEL_LABELS[level]} ${levelCounts[level] ?? 0}`}
              size="small"
              onClick={() => toggleLevel(level)}
              variant={selectedLevels.includes(level) ? 'filled' : 'outlined'}
              sx={{
                fontSize: 11,
                height: 24,
                fontFamily: MONO,
                fontWeight: 600,
                color: selectedLevels.includes(level) ? '#fff' : LEVEL_COLORS[level],
                borderColor: alpha(LEVEL_COLORS[level] ?? '#666', 0.4),
                bgcolor: selectedLevels.includes(level) ? alpha(LEVEL_COLORS[level] ?? '#666', 0.8) : undefined,
                '&:hover': { bgcolor: alpha(LEVEL_COLORS[level] ?? '#666', 0.2) },
              }}
            />
          ))}
        </Stack>

        <Box sx={{ flex: 1 }} />

        {/* Pause/Resume */}
        <Button
          size="small"
          variant="outlined"
          onClick={() => setPaused(!paused)}
          startIcon={paused ? <PlayIcon sx={{ fontSize: 16 }} /> : <StopIcon sx={{ fontSize: 16 }} />}
          sx={{ textTransform: 'none', fontSize: 12 }}
        >
          {paused ? 'Resume' : 'Pause'}
        </Button>
      </Stack>

      {/* Terminal */}
      <Card
        ref={scrollRef}
        variant="outlined"
        sx={{ bgcolor: '#0d1117', maxHeight: 600, overflow: 'auto', borderColor: 'rgba(255,255,255,0.1)' }}
      >
        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
          {loading ? (
            <Stack spacing={0.5} sx={{ p: 1.5 }}>
              {[...Array(12)].map((_, i) => <Skeleton key={i} height={20} sx={{ bgcolor: 'rgba(255,255,255,0.05)' }} />)}
            </Stack>
          ) : logs.length === 0 ? (
            <Typography variant="body2" sx={{ fontFamily: MONO, fontSize: 12, color: '#8b949e', textAlign: 'center', py: 6 }}>
              No log entries found.
            </Typography>
          ) : (
            logs.map((log) => (
              <LogRow key={log.id} log={log} isNew={newIdsRef.current.has(log.id)} />
            ))
          )}
        </CardContent>
      </Card>

      {/* Footer */}
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="caption" color="text.disabled" sx={{ fontFamily: MONO, fontSize: 11 }}>
          {logs.length} entries {!paused && '· streaming'}
        </Typography>
        {selectedLevels.length > 0 && (
          <Button size="small" onClick={() => setSelectedLevels([])} sx={{ textTransform: 'none', fontSize: 11 }}>
            Clear filters
          </Button>
        )}
      </Stack>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Metrics Tab — real-time CPU/Memory charts
// ---------------------------------------------------------------------------

const baseChartOptions: ApexCharts.ApexOptions = {
  chart: { background: 'transparent', toolbar: { show: false }, animations: { enabled: true, dynamicAnimation: { speed: 800 } } },
  theme: { mode: 'dark' },
  grid: { borderColor: 'rgba(255,255,255,0.08)', padding: { left: 8, right: 8 } },
  xaxis: { type: 'datetime', labels: { style: { colors: '#999', fontSize: '10px' }, datetimeUTC: false } },
  yaxis: { labels: { style: { colors: '#999', fontSize: '11px' } } },
  stroke: { curve: 'smooth', width: 2 },
  tooltip: { theme: 'dark', x: { format: 'HH:mm:ss' } },
  legend: { show: false },
  dataLabels: { enabled: false },
};

function MetricsGaugeCard({ title, value, suffix, color, loading }: {
  title: string; value: string | number; suffix?: string;
  color: 'success' | 'warning' | 'error' | 'info' | 'primary'; loading?: boolean;
}) {
  return (
    <Card variant="outlined" sx={{ flex: 1, minWidth: 120 }}>
      <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10 }}>
          {title}
        </Typography>
        {loading ? (
          <Skeleton width={50} height={36} />
        ) : (
          <Typography variant="h5" fontWeight={700} sx={{ color: `${color}.main`, mt: 0.25 }}>
            {value}
            {suffix && <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>{suffix}</Typography>}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

function MetricsTab({ appName }: { appName: string }) {
  // Metrics snapshot uses short app names ("main"), not namespaced ("omni/dev/main")
  const shortName = appName.includes('/') ? appName.split('/').pop()! : appName;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Gauges
  const [cpu, setCpu] = useState(0);
  const [memory, setMemory] = useState(0);
  const [requests, setRequests] = useState(0);
  const [errors, setErrors] = useState(0);

  // Time-series
  const [cpuSeries, setCpuSeries] = useState<any[]>([]);
  const [memSeries, setMemSeries] = useState<any[]>([]);

  const fetchMetrics = useCallback(async () => {
    try {
      // Try titan-metrics snapshot first
      let gotSnapshot = false;
      try {
        const snapshot: any = await metrics.getSnapshot();
        if (snapshot?.apps) {
          // Find this app in the snapshot — match by full name or short name
          const appEntry = snapshot.apps[shortName]
            ?? Object.entries(snapshot.apps).find(([k]) => k.endsWith(`/${appName.split('/').pop()}`))?.[1];
          if (appEntry) {
            setCpu(Math.round((appEntry as any).cpu * 10) / 10);
            setMemory((appEntry as any).memory ?? 0);
            setRequests((appEntry as any).requests ?? 0);
            setErrors((appEntry as any).errors ?? 0);
            gotSnapshot = true;
          }
        }
      } catch {
        // titan-metrics not available
      }

      // Fallback to daemon getMetrics
      if (!gotSnapshot) {
        try {
          const agg: any = await daemon.getMetrics({ name: appName });
          const appEntry = agg?.apps?.[appName] ?? agg?.apps?.[shortName];
          if (appEntry) {
            setCpu(Math.round(appEntry.cpu * 10) / 10);
            setMemory(appEntry.memory ?? 0);
            setRequests(appEntry.requests ?? 0);
            setErrors(appEntry.errors ?? 0);
          }
        } catch {
          // fallback also failed — gauges stay at 0
        }
      }

      // Fetch time-series
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      try {
        const [cpuData, memData]: [any[], any[]] = await Promise.all([
          metrics.querySeries({ names: ['cpu_percent'], apps: [shortName], from: fiveMinAgo, interval: '10s' }),
          metrics.querySeries({ names: ['memory_bytes'], apps: [shortName], from: fiveMinAgo, interval: '10s' }),
        ]);

        if (cpuData.length > 0) {
          setCpuSeries(cpuData.map((s: any) => ({
            name: 'CPU',
            data: s.points.map((p: any) => ({ x: new Date(p.timestamp).getTime(), y: Number(p.value.toFixed(1)) })),
          })));
        }
        if (memData.length > 0) {
          setMemSeries(memData.map((s: any) => ({
            name: 'Memory',
            data: s.points.map((p: any) => ({ x: new Date(p.timestamp).getTime(), y: Math.round(p.value / (1024 * 1024)) })),
          })));
        }
      } catch {
        // Time-series not available — charts stay empty
      }

      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to fetch metrics');
    } finally {
      setLoading(false);
    }
  }, [appName]);

  useEffect(() => {
    fetchMetrics();
    if (!autoRefresh) return;
    const interval = setInterval(fetchMetrics, 10_000);
    return () => clearInterval(interval);
  }, [fetchMetrics, autoRefresh]);

  const cpuChartOptions = useMemo<ApexCharts.ApexOptions>(() => ({
    ...baseChartOptions,
    colors: ['#6366f1'],
    yaxis: { ...baseChartOptions.yaxis, title: { text: 'CPU %', style: { color: '#666', fontSize: '11px' } }, max: 100, min: 0 },
    fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 100] } },
  }), []);

  const memChartOptions = useMemo<ApexCharts.ApexOptions>(() => ({
    ...baseChartOptions,
    colors: ['#a78bfa'],
    yaxis: { ...baseChartOptions.yaxis, title: { text: 'Memory (MB)', style: { color: '#666', fontSize: '11px' } }, min: 0 },
    fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 100] } },
  }), []);

  return (
    <Stack spacing={2.5}>
      {error && <Alert severity="warning" variant="outlined" onClose={() => setError(null)}>{error}</Alert>}

      {/* Gauge cards */}
      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
        <MetricsGaugeCard title="CPU" value={loading ? '—' : `${cpu}%`} color={cpu > 80 ? 'error' : cpu > 60 ? 'warning' : 'success'} loading={loading} />
        <MetricsGaugeCard title="Memory" value={loading ? '—' : formatMemory(memory)} color={memory > 512 * 1024 * 1024 ? 'warning' : 'primary'} loading={loading} />
        <MetricsGaugeCard title="Requests" value={loading ? '—' : String(requests)} color="info" loading={loading} />
        <MetricsGaugeCard title="Errors" value={loading ? '—' : String(errors)} color={errors > 0 ? 'error' : 'success'} loading={loading} />
      </Stack>

      {/* CPU Chart */}
      <Card variant="outlined">
        <CardHeader
          title="CPU Usage"
          titleTypographyProps={{ variant: 'subtitle2', fontWeight: 600 }}
          subheader="Last 5 minutes"
          subheaderTypographyProps={{ variant: 'caption' }}
          action={
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>Auto</Typography>
              <IconButton size="small" onClick={() => setAutoRefresh(!autoRefresh)} sx={{ color: autoRefresh ? 'primary.main' : 'text.disabled' }}>
                <RefreshIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Stack>
          }
          sx={{ pb: 0 }}
        />
        <CardContent sx={{ pt: 0.5, pb: 1, '&:last-child': { pb: 1 } }}>
          {loading ? (
            <Skeleton variant="rectangular" height={220} />
          ) : cpuSeries.length > 0 ? (
            <Chart type="area" height={220} options={cpuChartOptions} series={cpuSeries} />
          ) : (
            <Stack alignItems="center" justifyContent="center" sx={{ height: 220 }}>
              <Typography variant="body2" color="text.disabled">No CPU time-series data available</Typography>
              <Typography variant="caption" color="text.disabled">Metrics collection may not be active for this app</Typography>
            </Stack>
          )}
        </CardContent>
      </Card>

      {/* Memory Chart */}
      <Card variant="outlined">
        <CardHeader
          title="Memory Usage"
          titleTypographyProps={{ variant: 'subtitle2', fontWeight: 600 }}
          subheader="Last 5 minutes (MB)"
          subheaderTypographyProps={{ variant: 'caption' }}
          sx={{ pb: 0 }}
        />
        <CardContent sx={{ pt: 0.5, pb: 1, '&:last-child': { pb: 1 } }}>
          {loading ? (
            <Skeleton variant="rectangular" height={220} />
          ) : memSeries.length > 0 ? (
            <Chart type="area" height={220} options={memChartOptions} series={memSeries} />
          ) : (
            <Stack alignItems="center" justifyContent="center" sx={{ height: 220 }}>
              <Typography variant="body2" color="text.disabled">No memory time-series data available</Typography>
              <Typography variant="caption" color="text.disabled">Metrics collection may not be active for this app</Typography>
            </Stack>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// App Detail Page
// ---------------------------------------------------------------------------

export default function AppDetailPage() {
  const { name } = useParams<{ name: string }>();
  const { namespacePrefix } = useStackContext();

  // Resolve display name to daemon-namespaced name (e.g., "main" → "omni/dev/main")
  const daemonName = name && namespacePrefix ? `${namespacePrefix}${name}` : name;

  const [app, setApp] = useState<ProcessInfoDto | null>(null);
  const [diagnostics, setDiagnostics] = useState<AppDiagnosticsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [diagLoading, setDiagLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [tab, setTab] = useState(0);

  const fetchApp = useCallback(async () => {
    if (!daemonName) return;
    try {
      const info = await daemon.getApp({ name: daemonName });
      setApp(info);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? `Failed to fetch app "${name}"`);
    } finally {
      setLoading(false);
    }
  }, [daemonName, name]);

  const fetchDiagnostics = useCallback(async () => {
    if (!daemonName) return;
    try {
      const diag = await daemon.inspect({ name: daemonName });
      setDiagnostics(diag);
    } catch {
      // Diagnostics may fail for stopped apps
    } finally {
      setDiagLoading(false);
    }
  }, [daemonName]);

  useEffect(() => {
    fetchApp();
    fetchDiagnostics();
    const interval = setInterval(() => { fetchApp(); fetchDiagnostics(); }, 5000);
    return () => clearInterval(interval);
  }, [fetchApp, fetchDiagnostics]);

  const handleAction = async (action: 'start' | 'stop' | 'restart') => {
    if (!daemonName) return;
    setActionLoading(true);
    try {
      if (action === 'start') await daemon.startApp({ name: daemonName });
      else if (action === 'stop') await daemon.stopApp({ name: daemonName });
      else await daemon.restartApp({ name: daemonName });
      await fetchApp();
      await fetchDiagnostics();
    } catch (err: any) {
      setError(`Failed to ${action} "${name}": ${err?.message ?? 'Unknown error'}`);
    } finally {
      setActionLoading(false);
    }
  };

  const isStopped = app?.status === 'stopped' || app?.status === 'crashed' || app?.status === 'errored';

  return (
    <Stack spacing={3}>
      {/* Breadcrumbs — no backHref, breadcrumb links provide navigation */}
      <Breadcrumbs
        linkComponent={RouterLink}
        links={[
          { name: 'Applications', href: '/apps' },
          { name: name ?? '' },
        ]}
        action={
          app ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip
                label={app.status}
                color={STATUS_COLORS[app.status] || 'default'}
                variant="outlined"
                size="small"
              />
              {isStopped ? (
                <Button variant="outlined" color="success" size="small" startIcon={<PlayIcon />} disabled={actionLoading} onClick={() => handleAction('start')}>
                  Start
                </Button>
              ) : (
                <>
                  <Button variant="outlined" color="warning" size="small" startIcon={<RestartIcon />} disabled={actionLoading} onClick={() => handleAction('restart')}>
                    Restart
                  </Button>
                  <Button variant="outlined" color="error" size="small" startIcon={<StopIcon />} disabled={actionLoading} onClick={() => handleAction('stop')}>
                    Stop
                  </Button>
                </>
              )}
              <IconButton onClick={() => { fetchApp(); fetchDiagnostics(); }} size="small" title="Refresh">
                <RefreshIcon />
              </IconButton>
            </Stack>
          ) : undefined
        }
      />

      {error && (
        <Alert severity="error" variant="outlined" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Stack spacing={2}>
          <Stack direction="row" spacing={2}>
            {[...Array(5)].map((_, i) => <Skeleton key={i} height={80} variant="rounded" sx={{ flex: 1 }} />)}
          </Stack>
          <Skeleton height={200} variant="rounded" />
        </Stack>
      ) : !app ? (
        <Alert severity="warning" variant="outlined">
          Application "{name}" not found.
        </Alert>
      ) : (
        <>
          <Tabs value={tab} onChange={(_, v) => setTab(v)}>
            <Tab label="Overview" />
            <Tab label="Logs" />
            <Tab label="Metrics" />
          </Tabs>

          <TabPanel value={tab} index={0}>
            <OverviewTab app={app} diagnostics={diagnostics} diagLoading={diagLoading} />
          </TabPanel>
          <TabPanel value={tab} index={1}>
            <LogsTab appName={daemonName!} />
          </TabPanel>
          <TabPanel value={tab} index={2}>
            <MetricsTab appName={daemonName!} />
          </TabPanel>
        </>
      )}
    </Stack>
  );
}
