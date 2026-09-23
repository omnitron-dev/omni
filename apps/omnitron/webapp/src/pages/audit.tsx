/**
 * Audit — who changed this control plane, and what they changed.
 *
 * `omnitron_audit_log` had no writer until this console could answer the
 * question it exists for: who stopped that stack, who took the database
 * password out of the vault, who removed that node. The rows name people and
 * addresses, so the RPC behind this page is admin-only — a viewer who opens
 * it is told that, rather than shown an empty table.
 */

import { useState, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { Alert, Breadcrumbs, EmptyContent, Skeleton } from '@omnitron-dev/prism';
import { audit } from 'src/netron/client';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { useAuthStore } from 'src/auth/store';
import { actorWords } from 'src/utils/audit-actor';

/**
 * The resource kinds this daemon records, as the actions name them.
 *
 * `release` joined when builds, stops, prunes and attestations started
 * writing rows; a filter that could not select them hid the whole release
 * trail behind «everything».
 */
const RESOURCE_TYPES = ['', 'stack', 'release', 'project', 'node', 'secret'] as const;

const PAGE_SIZES = [50, 100, 250, 500] as const;

function when(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return new Date(iso).toLocaleString();
}

/**
 * A detail value as a person reads it.
 *
 * `String(v)` printed `trees=[object Object]` for every `stack.start` — the
 * row records which trees were deployed and at which commits, and that is the
 * part nobody could read. Arrays and objects are written out, one level at a
 * time, the way they were recorded.
 */
function detailValue(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(detailValue).join(', ')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k}:${detailValue(x)}`)
      .join(' ')}}`;
  }
  return String(v);
}

/** `user` is a person; everything else is the machine, and says which. */
function Actor({ actorId, actorType }: { actorId: string | null; actorType: string }) {
  const me = useAuthStore((st) => st.user);
  if (actorId && me && actorId === me.id) {
    return (
      <Tooltip title={actorId} arrow>
        <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>
          {me.username} <Box component="span" sx={{ color: 'text.secondary' }}>(you)</Box>
        </Typography>
      </Tooltip>
    );
  }
  const words = actorWords(actorId, actorType);
  if (words.id) {
    // A UUID wrapped onto five lines in a narrow column; eight characters
    // tell rows apart, and the whole id is one hover away. A named account —
    // `omnitron-local`, the CLI — is shown whole.
    return (
      <Tooltip title={words.title} arrow>
        <Typography variant="body2" sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
          {words.text}
        </Typography>
      </Tooltip>
    );
  }
  return <Chip size="small" variant="outlined" label={words.text} sx={{ height: 20, fontSize: 11 }} title={words.title} />;
}

export default function AuditPage() {
  const [limit, setLimit] = useState<number>(100);
  const [resourceType, setResourceType] = useState<string>('');

  const fetcher = useCallback(async () => {
    const [available, rows] = await Promise.all([
      audit.available(),
      audit.list({ limit, ...(resourceType ? { resourceType } : {}) }),
    ]);
    return { available: available.available, rows };
  }, [limit, resourceType]);

  const { data, error, loading } = usePolledResource(fetcher, {
    intervalMs: 15_000,
    describeError: (err: unknown) =>
      `Could not read the audit trail: ${err instanceof Error ? err.message : String(err)}`,
  });

  return (
    <Box sx={{ p: 3 }}>
      <Breadcrumbs heading="Audit" links={[{ name: 'Console', href: '/' }, { name: 'Audit' }]} sx={{ mb: 3 }} />

      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label="Resource"
          value={resourceType}
          onChange={(e) => setResourceType(e.target.value)}
          sx={{ minWidth: 160 }}
        >
          {RESOURCE_TYPES.map((t) => (
            <MenuItem key={t || 'all'} value={t}>
              {t || 'everything'}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Entries"
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          sx={{ minWidth: 120 }}
        >
          {PAGE_SIZES.map((n) => (
            <MenuItem key={n} value={n}>
              {n}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading && !data && <Skeleton variant="rectangular" height={280} />}

      {data && !data.available && (
        // An empty table would read as "nothing has happened".
        <Alert severity="info">
          This daemon has no audit trail — it has no omnitron database to record into.
        </Alert>
      )}

      {data?.available && data.rows.length === 0 && (
        <EmptyContent title="Nothing recorded yet" description="Actions taken through this console appear here." />
      )}

      {data?.available && data.rows.length > 0 && (
        // Four columns, and the details UNDER the event rather than beside it.
        //
        // «Details» was a sixth column, and at a laptop's width it sat
        // entirely past the right edge of the card — `release=…`, `stack=…`,
        // the part that says what actually happened, reachable only by a
        // sideways scroll nobody knew was there. An event now reads as one
        // block: what was done, to what, and with which particulars.
        <Card sx={{ borderRadius: 2 }}>
          <Table size="small" sx={{ tableLayout: 'fixed' }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 110 }}>When</TableCell>
                <TableCell>Event</TableCell>
                <TableCell sx={{ width: 120 }}>Actor</TableCell>
                <TableCell sx={{ width: 140 }}>From</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.id} hover sx={{ verticalAlign: 'top' }}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }} title={new Date(row.createdAt).toLocaleString()}>
                    {when(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Stack spacing={0.25}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                          {row.action}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{ fontFamily: 'monospace', color: 'text.secondary', overflowWrap: 'anywhere' }}
                        >
                          {row.resourceId ? `${row.resourceType}:${row.resourceId}` : row.resourceType}
                        </Typography>
                      </Stack>
                      {row.details && Object.keys(row.details).length > 0 && (
                        <Typography
                          variant="caption"
                          sx={{ fontFamily: 'monospace', color: 'text.secondary', overflowWrap: 'anywhere' }}
                        >
                          {Object.entries(row.details)
                            .map(([k, v]) => `${k}=${detailValue(v)}`)
                            .join(' · ')}
                        </Typography>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Actor actorId={row.actorId} actorType={row.actorType} />
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', color: 'text.secondary', whiteSpace: 'nowrap' }}>
                    {row.ipAddress ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </Box>
  );
}
