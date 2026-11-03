/** Recorded control-plane actions, their admitted actors and original evidence. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { TableViewport } from '@omnitron-dev/prism/components/table';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { EmptyContent } from '@omnitron-dev/prism/components/empty-content';
import { Skeleton } from '@omnitron-dev/prism/components/skeleton';
import { useDebounce } from '@omnitron-dev/prism/core';
import type { IOmnitronAuditService } from '@omnitron-dev/omnitron/dto/services';
import { Breadcrumbs } from 'src/components/page-breadcrumbs';
import { AuditEntryRow } from 'src/components/audit-entry-row';
import { RefreshIcon, PlayIcon, PauseIcon } from 'src/assets/icons';
import { audit } from 'src/netron/client';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { useAuthStore } from 'src/auth/store';
import { useAccess } from 'src/auth/access';
import { LOCAL_CALLER } from 'src/utils/audit-actor';

type AuditRow = Awaited<ReturnType<IOmnitronAuditService['list']>>[number];
const RESOURCE_TYPES = [
  'stack',
  'release',
  'project',
  'node',
  'kernel-rollout',
  'pipeline',
  'secret',
  'terminal',
  'account',
  'app',
  'file',
];
const PAGE_SIZES = [50, 100, 250, 500];
interface AuditHistory {
  scope: string;
  rows: AuditRow[];
  pending: boolean;
  exhausted: boolean;
  error: string | null;
}
export default function AuditPage() {
  const [limit, setLimit] = useState(100);
  const [resourceType, setResourceType] = useState('');
  const [actor, setActor] = useState('');
  const [actionText, setActionText] = useState('');
  const action = useDebounce(actionText.trim(), 300);
  const [paused, setPaused] = useState(false);
  const user = useAuthStore((st) => st.user);
  const { can } = useAccess();
  const permitted = can('OmnitronAudit.list') && can('OmnitronAudit.available');
  const query = useMemo(
    () => ({
      limit,
      ...(resourceType && { resourceType }),
      ...(action && { action }),
      ...(actor === 'local' ? { actorType: 'user', actorId: LOCAL_CALLER } : actor ? { actorType: actor } : {}),
    }),
    [limit, resourceType, actor, action]
  );
  const scope = JSON.stringify([user?.id, permitted, query]);
  const scopeRef = useRef<string | null>(scope);
  scopeRef.current = scope;
  const historyRequest = useRef<symbol | null>(null);
  const [history, setHistory] = useState<AuditHistory | null>(null);
  useEffect(() => {
    setHistory(null);
    return () => {
      historyRequest.current = null;
    };
  }, [scope]);
  const currentHistory = history?.scope === scope ? history : null;
  const fetcher = useCallback(async () => {
    const available = await audit.available();
    if (!available.available) return { available: false, rows: [] as AuditRow[] };
    return { available: true, rows: await audit.list(query) };
  }, [query]);
  const { data, error, loading, refresh } = usePolledResource(fetcher, {
    intervalMs: 15_000,
    paused,
    enabled: permitted,
    resourceKey: scope,
    describeError: (err) => `Could not read the audit trail: ${err instanceof Error ? err.message : String(err)}`,
  });
  const rows = currentHistory?.rows ?? data?.rows ?? [];
  const refreshLatest = () => {
    historyRequest.current = null;
    setHistory(null);
    void refresh();
  };
  const toggleUpdates = () => {
    if (paused) {
      historyRequest.current = null;
      setHistory(null);
      void refresh();
    }
    setPaused((value) => !value);
  };
  const loadOlder = async () => {
    if (!permitted || historyRequest.current || currentHistory?.pending || !rows.length) return;
    const token = Symbol('audit-history');
    historyRequest.current = token;
    const snapshot = rows;
    setPaused(true);
    setHistory({ scope, rows: snapshot, pending: true, exhausted: false, error: null });
    try {
      // The server owns precise (timestamp, id) ordering. Do not round its
      // database timestamp through JavaScript when constructing a cursor.
      const older = await audit.list({ ...query, beforeId: snapshot[snapshot.length - 1]!.id });
      if (historyRequest.current !== token || scopeRef.current !== scope) return;
      const seen = new Set(snapshot.map((row) => row.id));
      const additions = older.filter((row) => !seen.has(row.id));
      if (older.length && !additions.length) throw Error('History cursor did not advance. Refresh the latest events.');
      setHistory({
        scope,
        rows: [...snapshot, ...additions],
        pending: false,
        exhausted: older.length < limit,
        error: null,
      });
    } catch (failure) {
      if (historyRequest.current !== token || scopeRef.current !== scope) return;
      setHistory({
        scope,
        rows: snapshot,
        pending: false,
        exhausted: false,
        error: `Could not read older events: ${failure instanceof Error ? failure.message : String(failure)}`,
      });
    } finally {
      if (historyRequest.current === token) historyRequest.current = null;
    }
  };
  const resources = [...new Set([...RESOURCE_TYPES, resourceType, ...rows.map((row) => row.resourceType)])]
    .filter(Boolean)
    .sort();
  const filtered = Boolean(resourceType || actor || actionText);
  return (
    <Box sx={{ minWidth: 0 }}>
      <Breadcrumbs heading="Audit" links={[{ name: 'Console', href: '/' }, { name: 'Audit' }]} sx={{ mb: 2 }} />
      <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 1.5 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: '1 1 180px' }}>
          Control-plane audit · all projects
        </Typography>
        {permitted && (
          <>
            <Typography variant="caption" role="status" color="text.secondary">
              {currentHistory?.pending
                ? 'Reading history…'
                : loading && !currentHistory
                  ? 'Reading…'
                  : data?.available
                    ? `${rows.length} matching events${currentHistory ? ' · history' : ' · latest'}`
                    : 'No reading'}
            </Typography>
            <Tooltip title={paused ? 'Resume audit updates' : 'Pause audit updates'}>
              <IconButton
                size="small"
                aria-label={paused ? 'Resume audit updates' : 'Pause audit updates'}
                onClick={toggleUpdates}
              >
                {paused ? <PlayIcon /> : <PauseIcon />}
              </IconButton>
            </Tooltip>
            <Chip size="small" variant="outlined" label={paused ? 'Paused' : 'Live'} sx={{ height: 22 }} />
            <Tooltip title="Refresh audit">
              <span>
                <IconButton
                  size="small"
                  aria-label="Refresh audit"
                  disabled={loading}
                  loading={loading}
                  onClick={refreshLatest}
                >
                  <RefreshIcon />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )}
      </Stack>
      {!permitted ? (
        <Alert severity="info">Your role cannot read the control-plane audit trail.</Alert>
      ) : (
        <>
          <Box
            component="section"
            aria-label="Audit filters"
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 128px), 1fr))',
              gap: 1.5,
              mb: 2,
            }}
          >
            <TextField
              fullWidth
              select
              size="small"
              label="Resource"
              value={resourceType}
              onChange={(event) => setResourceType(event.target.value)}
              slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}
              sx={{ minWidth: 0 }}
            >
              <MenuItem value="">All resources</MenuItem>
              {resources.map((type) => (
                <MenuItem key={type} value={type}>
                  {type}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              fullWidth
              select
              size="small"
              label="Actor"
              value={actor}
              onChange={(event) => setActor(event.target.value)}
              slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}
              sx={{ minWidth: 0 }}
            >
              <MenuItem value="">All actors</MenuItem>
              <MenuItem value="local">Local client</MenuItem>
              <MenuItem value="user">User identities</MenuItem>
              <MenuItem value="service">Service</MenuItem>
              <MenuItem value="system">System</MenuItem>
            </TextField>
            <TextField
              fullWidth
              size="small"
              label="Action (exact)"
              placeholder="stack.start"
              value={actionText}
              onChange={(event) => setActionText(event.target.value)}
              sx={{ minWidth: 0 }}
            />
            <TextField
              fullWidth
              select
              size="small"
              label="Latest entries"
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
              sx={{ minWidth: 0 }}
            >
              {PAGE_SIZES.map((size) => (
                <MenuItem key={size} value={size}>
                  {size}
                </MenuItem>
              ))}
            </TextField>
          </Box>
          {filtered && (
            <Button
              size="small"
              sx={{ mb: 1 }}
              onClick={() => {
                setResourceType('');
                setActor('');
                setActionText('');
              }}
            >
              Reset filters
            </Button>
          )}
          {error && (
            <Alert
              severity="error"
              sx={{ mb: 2 }}
              action={
                <Button color="inherit" size="small" onClick={() => void refresh()}>
                  Retry
                </Button>
              }
            >
              {error}
              {data && ' The last reading is retained.'}
            </Alert>
          )}
          {loading && !data && <Skeleton variant="rectangular" height={280} />}
          {data && !data.available && (
            <Alert severity="info">This daemon has no audit storage. No event history is available.</Alert>
          )}
          {data?.available && rows.length === 0 && (
            <EmptyContent
              title={filtered ? 'No matching events' : 'Nothing recorded yet'}
              description={
                filtered
                  ? 'Change the filters to read another part of the trail.'
                  : 'Recorded control-plane actions will appear here.'
              }
            />
          )}
          {data?.available && rows.length > 0 && (
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
              <TableViewport label="Audit events">
                <Table size="small" aria-label="Audit events" sx={{ tableLayout: 'fixed' }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 40, px: 0.5 }}>
                        <Box
                          component="span"
                          sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}
                        >
                          Details
                        </Box>
                      </TableCell>
                      <TableCell sx={{ width: 132, display: { xs: 'none', sm: 'table-cell' } }}>
                        <Tooltip title="Local time; exact UTC is available in the event details">
                          <span>Recorded</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell>Event / resource</TableCell>
                      <TableCell sx={{ width: 192, display: { xs: 'none', md: 'table-cell' } }}>Actor</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <AuditEntryRow key={row.id} row={row} />
                    ))}
                  </TableBody>
                </Table>
              </TableViewport>
            </Box>
          )}
          {currentHistory?.error && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {currentHistory.error}
            </Alert>
          )}
          {data?.available && rows.length > 0 && (
            <Stack direction="row" sx={{ mt: 1, gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="caption" color="text.secondary" sx={{ flex: '1 1 180px' }}>
                {currentHistory
                  ? 'Updates paused while reading history. Resume to return to the latest events.'
                  : 'Newest first. This count is the current reading, not the entire trail.'}
              </Typography>
              {(currentHistory ? !currentHistory.exhausted : rows.length === limit) && (
                <Button
                  size="small"
                  disabled={currentHistory?.pending}
                  loading={currentHistory?.pending}
                  onClick={() => void loadOlder()}
                >
                  {currentHistory?.error ? 'Retry older events' : 'Load older'}
                </Button>
              )}
              {currentHistory?.exhausted && (
                <Typography variant="caption" color="text.secondary">
                  Start of matching history
                </Typography>
              )}
            </Stack>
          )}
        </>
      )}
    </Box>
  );
}
