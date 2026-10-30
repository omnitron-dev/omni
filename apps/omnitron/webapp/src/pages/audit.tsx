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

import { Alert } from '@omnitron-dev/prism/components/alert';
import { Breadcrumbs } from 'src/components/page-breadcrumbs';
import { EmptyContent } from '@omnitron-dev/prism/components/empty-content';
import { Skeleton } from '@omnitron-dev/prism/components/skeleton';
import { outcomeOf, outcomeReason, type AuditOutcome } from '@omnitron-dev/omnitron/audit-outcome';
import type { IOmnitronAuditService } from '@omnitron-dev/omnitron/dto/services';
import { audit } from 'src/netron/client';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { useAuthStore } from 'src/auth/store';
import { actorWords } from 'src/utils/audit-actor';

type AuditRow = Awaited<ReturnType<IOmnitronAuditService['list']>>[number];

/**
 * The resource kinds this daemon records, as the actions name them.
 *
 * `release` joined when builds, stops, prunes and attestations started
 * writing rows; a filter that could not select them hid the whole release
 * trail behind «everything».
 */
const RESOURCE_TYPES = ['', 'stack', 'release', 'project', 'node', 'secret', 'terminal', 'account'] as const;

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

/** The colours `omnitron audit` gives an outcome. */
const OUTCOME_TONE: Record<AuditOutcome, 'success' | 'warning' | 'error'> = {
  ok: 'success',
  partial: 'warning',
  failed: 'error',
};

/**
 * What was done, to what, how it ended, and with which particulars.
 *
 * How it ended is the chip, and — when the row says why — a line in its
 * colour under it. The page read no outcome at all: `outcome=partial` was one
 * more `key=value` among the particulars, so a stack start in which two apps
 * never came up read like any other. The keys the ending was read from are
 * not repeated among them.
 */
function Event({ row }: { row: AuditRow }) {
  const outcome = outcomeOf(row);
  const reason = outcomeReason(row);
  const particulars = Object.entries(row.details ?? {}).filter(
    ([k, v]) => !(k === 'outcome' && v === outcome) && k !== reason?.key
  );
  return (
    <Stack spacing={0.5} sx={{ minWidth: 0 }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ display: { xs: 'flex', md: 'none' }, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: { xs: 'inline', sm: 'none' } }}
          title={new Date(row.createdAt).toLocaleString()}
        >
          {when(row.createdAt)}
        </Typography>
        <Actor actorId={row.actorId} actorType={row.actorType} />
        <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          {row.ipAddress ?? '—'}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600, overflowWrap: 'anywhere' }}>
          {row.action}
        </Typography>
        <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'text.secondary', overflowWrap: 'anywhere' }}>
          {row.resourceId ? `${row.resourceType}:${row.resourceId}` : row.resourceType}
        </Typography>
        {outcome && (
          <Chip
            size="small"
            variant="outlined"
            color={OUTCOME_TONE[outcome]}
            label={outcome}
            sx={{ height: 18, fontSize: 10 }}
          />
        )}
      </Stack>
      {outcome && reason && (
        <Typography variant="caption" sx={{ color: `${OUTCOME_TONE[outcome]}.main`, overflowWrap: 'anywhere' }}>
          {reason.text}
        </Typography>
      )}
      {particulars.length > 0 && (
        <Typography
          variant="caption"
          sx={{ fontFamily: 'monospace', color: 'text.secondary', overflowWrap: 'anywhere' }}
        >
          {particulars.map(([k, v]) => `${k}=${detailValue(v)}`).join(' · ')}
        </Typography>
      )}
    </Stack>
  );
}

/** `user` is a person; everything else is the machine, and says which. */
function Actor({ actorId, actorType }: { actorId: string | null; actorType: string }) {
  const me = useAuthStore((st) => st.user);
  if (actorType === 'user' && actorId && me && actorId === me.id) {
    return (
      <Tooltip title={actorId} arrow>
        <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>
          {me.username}{' '}
          <Box component="span" sx={{ color: 'text.secondary' }}>
            (you)
          </Box>
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
  return (
    <Chip size="small" variant="outlined" label={words.text} sx={{ height: 20, fontSize: 11 }} title={words.title} />
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
    <Box sx={{ minWidth: 0 }}>
      <Breadcrumbs heading="Audit" links={[{ name: 'Console', href: '/' }, { name: 'Audit' }]} sx={{ mb: 2 }} />

      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label="Resource"
          value={resourceType}
          onChange={(e) => setResourceType(e.target.value)}
          sx={{ flex: '1 1 160px', maxWidth: 240, minWidth: 0 }}
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
          sx={{ flex: '0 1 120px', minWidth: 100 }}
        >
          {PAGE_SIZES.map((n) => (
            <MenuItem key={n} value={n}>
              {n}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {loading && !data && <Skeleton variant="rectangular" height={280} />}

      {data && !data.available && (
        // An empty table would read as "nothing has happened".
        <Alert severity="info">This daemon has no audit trail — it has no omnitron database to record into.</Alert>
      )}

      {data?.available && data.rows.length === 0 && (
        <EmptyContent title="Nothing recorded yet" description="Actions taken through this console appear here." />
      )}

      {data?.available && data.rows.length > 0 && (
        <Card variant="outlined">
          <Table size="small" sx={{ tableLayout: 'fixed' }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 110, display: { xs: 'none', sm: 'table-cell' } }}>When</TableCell>
                <TableCell>Event</TableCell>
                <TableCell sx={{ width: 120, display: { xs: 'none', md: 'table-cell' } }}>Actor</TableCell>
                <TableCell sx={{ width: 140, display: { xs: 'none', md: 'table-cell' } }}>From</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.id} hover sx={{ verticalAlign: 'top' }}>
                  <TableCell
                    sx={{ whiteSpace: 'nowrap', display: { xs: 'none', sm: 'table-cell' } }}
                    title={new Date(row.createdAt).toLocaleString()}
                  >
                    {when(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Event row={row} />
                  </TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                    <Actor actorId={row.actorId} actorType={row.actorType} />
                  </TableCell>
                  <TableCell
                    sx={{
                      fontFamily: 'monospace',
                      color: 'text.secondary',
                      overflowWrap: 'anywhere',
                      display: { xs: 'none', md: 'table-cell' },
                    }}
                  >
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
