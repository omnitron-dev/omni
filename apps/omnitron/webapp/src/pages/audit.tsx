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
import Typography from '@mui/material/Typography';

import { Alert, Breadcrumbs, EmptyContent, Skeleton } from '@omnitron-dev/prism';
import { audit } from 'src/netron/client';
import { usePolledResource } from 'src/hooks/use-polled-resource';

/** The resource kinds this daemon records, as the actions name them. */
const RESOURCE_TYPES = ['', 'stack', 'project', 'node', 'secret'] as const;

const PAGE_SIZES = [50, 100, 250, 500] as const;

function when(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return new Date(iso).toLocaleString();
}

/** `user` is a person; everything else is the machine, and says which. */
function Actor({ actorId, actorType }: { actorId: string | null; actorType: string }) {
  if (actorId) {
    return (
      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
        {actorId}
      </Typography>
    );
  }
  return (
    <Chip
      size="small"
      variant="outlined"
      label={actorType}
      sx={{ height: 20, fontSize: 11 }}
      title={
        actorType === 'system'
          ? 'A local call over the unix socket — the trust is the socket, not a session'
          : 'Another omnitron acting as the control plane'
      }
    />
  );
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
        <Card sx={{ borderRadius: 2, overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>When</TableCell>
                <TableCell>Action</TableCell>
                <TableCell>Resource</TableCell>
                <TableCell>Actor</TableCell>
                <TableCell>From</TableCell>
                <TableCell>Details</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap' }} title={new Date(row.createdAt).toLocaleString()}>
                    {when(row.createdAt)}
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{row.action}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>
                    {row.resourceId ? `${row.resourceType}:${row.resourceId}` : row.resourceType}
                  </TableCell>
                  <TableCell>
                    <Actor actorId={row.actorId} actorType={row.actorType} />
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                    {row.ipAddress ?? '—'}
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', color: 'text.secondary', fontSize: 12 }}>
                    {row.details
                      ? Object.entries(row.details)
                          .map(([k, v]) => `${k}=${String(v)}`)
                          .join(' · ')
                      : '—'}
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
