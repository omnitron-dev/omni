import { useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Alert from '@mui/material/Alert';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Collapse from '@mui/material/Collapse';
import Grid from '@mui/material/Grid';
import { alpha } from '@mui/material/styles';

import { TraceIcon, RefreshIcon, SearchIcon } from 'src/assets/icons';
import { AdminDataTable, Breadcrumbs, type ColumnDef } from '@omnitron-dev/prism';
import { traces } from 'src/netron/client';
import { formatDate } from 'src/utils/formatters';
import { useStackContext } from 'src/hooks/use-stack-context';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { TableEmptyRow } from 'src/components/table-empty-row';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  operationName: string;
  serviceName: string;
  startTime: string;
  endTime: string;
  duration: number;
  status: 'ok' | 'error';
  tags: Record<string, string>;
}

interface Trace {
  traceId: string;
  spans: TraceSpan[];
  duration: number;
  serviceName: string;
  operationName: string;
  startTime: string;
}

interface ServiceMapEntry {
  source: string;
  target: string;
  callCount: number;
  avgDuration: number;
  errorRate: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

// ---------------------------------------------------------------------------
// Span Waterfall
// ---------------------------------------------------------------------------

function SpanWaterfall({ spans }: { spans: TraceSpan[] }) {
  if (spans.length === 0) return null;

  const traceStart = Math.min(...spans.map((s) => new Date(s.startTime).getTime()));
  const traceEnd = Math.max(...spans.map((s) => new Date(s.endTime).getTime()));
  const totalDuration = traceEnd - traceStart || 1;

  // Build tree hierarchy
  const roots = spans.filter((s) => !s.parentSpanId);
  const childrenMap = new Map<string, TraceSpan[]>();
  for (const span of spans) {
    if (span.parentSpanId) {
      const existing = childrenMap.get(span.parentSpanId) ?? [];
      existing.push(span);
      childrenMap.set(span.parentSpanId, existing);
    }
  }

  function renderSpan(span: TraceSpan, depth: number): React.ReactNode {
    const start = new Date(span.startTime).getTime() - traceStart;
    const dur = span.duration;
    const leftPct = (start / totalDuration) * 100;
    const widthPct = Math.max((dur / totalDuration) * 100, 0.5);
    const children = childrenMap.get(span.spanId) ?? [];

    return (
      <Box key={span.spanId}>
        <Stack
          direction="row"
          sx={{
            alignItems: "center",
            py: 0.25,
            pl: depth * 2
          }}>
          <Typography variant="caption" sx={{ minWidth: 120, fontWeight: 500 }} noWrap>
            {span.serviceName}
          </Typography>
          <Typography
            variant="caption"
            noWrap
            sx={{
              color: "text.secondary",
              minWidth: 140
            }}>
            {span.operationName}
          </Typography>
          <Box sx={{ flex: 1, position: 'relative', height: 16, mx: 1 }}>
            <Box
              sx={{
                position: 'absolute',
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                height: '100%',
                borderRadius: 0.5,
                bgcolor: span.status === 'error'
                  ? (t) => alpha(t.palette.error.main, 0.7)
                  : (t) => alpha(t.palette.primary.main, 0.5),
              }}
            />
          </Box>
          <Typography variant="caption" sx={{ minWidth: 60, textAlign: 'right', fontFamily: 'monospace' }}>
            {formatDuration(dur)}
          </Typography>
          <Chip
            label={span.status}
            size="small"
            color={span.status === 'error' ? 'error' : 'success'}
            variant="outlined"
            sx={{ ml: 1, fontSize: 10, height: 18 }}
          />
        </Stack>
        {children.map((child) => renderSpan(child, depth + 1))}
      </Box>
    );
  }

  return (
    <Box sx={{ py: 1 }}>
      {roots.length > 0
        ? roots.map((root) => renderSpan(root, 0))
        : spans.map((span) => renderSpan(span, 0))
      }
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Traces Page
// ---------------------------------------------------------------------------

export default function TracesPage() {
  const { displayName, namespacePrefix } = useStackContext();
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);

  // Filters
  const [serviceFilter, setServiceFilter] = useState('');
  const [operationFilter, setOperationFilter] = useState('');
  const [minDuration, setMinDuration] = useState('');
  const [mapPage, setMapPage] = useState(0);
  const [mapPageSize, setMapPageSize] = useState(25);

  // Shared polling loop — see `use-polled-resource`.
  //
  // `Promise.allSettled` is kept: the trace list and the service map come
  // from separate RPCs, and one being unavailable should not blank the other.
  // What changes is that a rejection is no longer silently discarded — the
  // old code checked only `status === 'fulfilled'` and left the failed half
  // showing its previous value with no indication anything was wrong.
  const { data, loading, error, refresh } = usePolledResource(
    async () => {
      const filter: any = { limit: 50 };
      if (serviceFilter) filter.service = serviceFilter;
      if (operationFilter) filter.operation = operationFilter;
      if (minDuration) filter.minDuration = parseInt(minDuration, 10);

      const [tracesResult, mapResult] = await Promise.allSettled([
        traces.queryTraces(filter),
        traces.getServiceMap(),
      ]);

      const failures = [tracesResult, mapResult]
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => (r.reason as { message?: string })?.message ?? 'request failed');
      if (failures.length === 2) throw new Error(failures[0]);

      return {
        traceList: tracesResult.status === 'fulfilled' && Array.isArray(tracesResult.value)
          ? (tracesResult.value as Trace[])
          : [],
        serviceMap: mapResult.status === 'fulfilled' && Array.isArray(mapResult.value)
          ? (mapResult.value as ServiceMapEntry[])
          : [],
        partialFailure: failures.length === 1 ? failures[0] : null,
      };
    },
    { intervalMs: 15_000 }
  );

  const traceList = data?.traceList ?? [];
  const serviceMap = data?.serviceMap ?? [];
  const partialFailure = data?.partialFailure ?? null;

  const serviceMapRows = serviceMap.slice(
    mapPage * mapPageSize,
    mapPage * mapPageSize + mapPageSize,
  );

  const serviceMapColumns: ColumnDef<ServiceMapEntry>[] = [
    {
      key: 'source',
      header: 'Source',
      render: (entry) => (
        <Typography variant="caption" sx={{ fontWeight: 500 }}>
          {entry.source}
        </Typography>
      ),
    },
    {
      key: 'target',
      header: 'Target',
      render: (entry) => <Typography variant="caption">{entry.target}</Typography>,
    },
    {
      key: 'callCount',
      header: 'Calls',
      align: 'right',
      render: (entry) => (
        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
          {entry.callCount}
        </Typography>
      ),
    },
    {
      key: 'avgDuration',
      header: 'Avg',
      align: 'right',
      render: (entry) => (
        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
          {formatDuration(entry.avgDuration)}
        </Typography>
      ),
    },
    {
      key: 'errorRate',
      header: 'Err%',
      align: 'right',
      render: (entry) => (
        <Typography
          variant="caption"
          sx={{ fontFamily: 'monospace' }}
          color={entry.errorRate > 0.05 ? 'error.main' : 'text.secondary'}
        >
          {(entry.errorRate * 100).toFixed(1)}%
        </Typography>
      ),
    },
  ];

  return (
    <Stack spacing={3}>
      {/* Header */}
      <Breadcrumbs
        links={[{ name: 'Traces' }]}
        action={
          <IconButton size="small" onClick={() => void refresh()} title="Refresh">
            <RefreshIcon />
          </IconButton>
        }
      />
      {(error || partialFailure) && (
        <Alert severity="warning" variant="outlined">
          {error ?? `Some trace data is unavailable: ${partialFailure}`}
        </Alert>
      )}
      {/* Filters */}
      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" spacing={2} sx={{
            alignItems: "center"
          }}>
            <SearchIcon />
            <TextField
              label="Service"
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              size="small"
              sx={{ minWidth: 150 }}
            />
            <TextField
              label="Operation"
              value={operationFilter}
              onChange={(e) => setOperationFilter(e.target.value)}
              size="small"
              sx={{ minWidth: 150 }}
            />
            <TextField
              label="Min Duration (ms)"
              value={minDuration}
              onChange={(e) => setMinDuration(e.target.value)}
              size="small"
              type="number"
              sx={{ minWidth: 130 }}
            />
          </Stack>
        </CardContent>
      </Card>
      <Grid container spacing={3}>
        {/* Trace List */}
        <Grid size={{ xs: 12, lg: 8 }}>
          <Card variant="outlined">
            <CardHeader slotProps={{ title: { variant: 'subtitle1', fontWeight: 600 } }}
              title="Recent Traces"
              avatar={<TraceIcon />}
            />
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Service</TableCell>
                    <TableCell>Operation</TableCell>
                    <TableCell>Duration</TableCell>
                    <TableCell>Spans</TableCell>
                    <TableCell>Started</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {loading ? (
                    [...Array(5)].map((_, i) => (
                      <TableRow key={i}>
                        {[...Array(5)].map((__, j) => (
                          <TableCell key={j}><Skeleton width={80} height={20} /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : traceList.length === 0 ? (
                    <TableEmptyRow
                      colSpan={5}
                      message="No traces collected yet"
                      error={error ?? partialFailure}
                    />
                  ) : (
                    traceList.map((trace) => {
                      const hasErrors = trace.spans.some((s) => s.status === 'error');
  return (
                        <TableRow key={trace.traceId}>
                          <TableCell colSpan={5} sx={{ p: 0 }}>
                            {/* A button, not a clickable Box: expanding a trace was
                                reachable by pointer only. `component="div"` keeps the
                                layout while giving it focus, a role, and Enter/Space. */}
                            <ButtonBase
                              component="div"
                              aria-expanded={expandedTrace === trace.traceId}
                              sx={{ cursor: 'pointer', px: 2, py: 1, width: '100%', display: 'block', textAlign: 'left', '&:hover': { bgcolor: 'action.hover' } }}
                              onClick={() => setExpandedTrace(expandedTrace === trace.traceId ? null : trace.traceId)}
                            >
                              <Stack direction="row" spacing={2} sx={{
                                alignItems: "center"
                              }}>
                                <Typography
                                  variant="body2"
                                  sx={{
                                    fontWeight: 600,
                                    minWidth: 100
                                  }}>
                                  {trace.serviceName}
                                </Typography>
                                <Typography
                                  variant="body2"
                                  sx={{
                                    color: "text.secondary",
                                    minWidth: 140
                                  }}>
                                  {trace.operationName}
                                </Typography>
                                <Chip
                                  label={formatDuration(trace.duration)}
                                  size="small"
                                  color={trace.duration > 1000 ? 'warning' : 'default'}
                                  variant="outlined"
                                  sx={{ fontFamily: 'monospace', fontSize: 11 }}
                                />
                                <Typography variant="caption" sx={{
                                  color: "text.secondary"
                                }}>
                                  {trace.spans.length} spans
                                </Typography>
                                {hasErrors && (
                                  <Chip label="errors" size="small" color="error" variant="filled" sx={{ fontSize: 10, height: 18 }} />
                                )}
                                <Typography
                                  variant="caption"
                                  sx={{
                                    color: "text.secondary",
                                    ml: 'auto !important'
                                  }}>
                                  {formatDate(trace.startTime)}
                                </Typography>
                              </Stack>
                            </ButtonBase>
                            <Collapse in={expandedTrace === trace.traceId}>
                              <Box sx={{ px: 2, pb: 1 }}>
                                <Typography
                                  variant="caption"
                                  sx={{
                                    color: "text.secondary",
                                    fontFamily: 'monospace',
                                    mb: 1,
                                    display: 'block'
                                  }}>
                                  Trace ID: {trace.traceId}
                                </Typography>
                                <SpanWaterfall spans={trace.spans} />
                              </Box>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Grid>

        {/* Service Map */}
        <Grid size={{ xs: 12, lg: 4 }}>
          <Card variant="outlined">
            <CardHeader slotProps={{ subheader: { variant: 'caption' }, title: { variant: 'subtitle1', fontWeight: 600 } }}
              title="Service Map"
              subheader="Service-to-service call counts"
            />
            {/*
              The trace list above still builds its own rows — each is a single
              full-width cell holding a button that expands the spans, which is
              not a shape AdminDataTable has. This one is an ordinary table.
            */}
            <AdminDataTable<ServiceMapEntry>
              columns={serviceMapColumns}
              data={serviceMapRows}
              total={serviceMap.length}
              loading={loading}
              loadError={error ?? partialFailure ?? null}
              emptyMessage="No service map data"
              rowKey={(entry) => `${entry.source}->${entry.target}`}
              page={mapPage}
              pageSize={mapPageSize}
              onPageChange={setMapPage}
              onPageSizeChange={(size) => {
                setMapPageSize(size);
                setMapPage(0);
              }}
              dense
            />
          </Card>
        </Grid>
      </Grid>
    </Stack>
  );
}
