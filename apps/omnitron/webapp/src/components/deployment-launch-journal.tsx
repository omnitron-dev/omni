import { useState } from 'react';
import { Button, Stack, Typography } from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import type { IStackInfo } from '@omnitron-dev/omnitron/dto/services';
import { useAccess } from 'src/auth/access';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { logs, project as projectRpc } from 'src/netron/client';
import { formatDate } from 'src/utils/formatters';
import { LiveLogOutput } from './live-log-output';

type Confirmation = NonNullable<IStackInfo['launchConfirmation']>;

export function LaunchAttempts({ project, stack, release, manifest, nodeId }: {
  project: string; stack: string; release: string; manifest: string; nodeId: string;
}) {
  const { can } = useAccess();
  const [cursors, setCursors] = useState<string[]>([]);
  const beforeId = cursors.at(-1);
  const allowed = can('OmnitronProject.getReleaseLaunchAttempts');
  const result = usePolledResource(() => projectRpc.getReleaseLaunchAttempts({
    project, stack, id: release, manifestSha256: manifest, nodeId, ...(beforeId && { beforeId }),
  }), { enabled: allowed, paused: !!beforeId, intervalMs: 5000,
    resourceKey: JSON.stringify([project, stack, release, manifest, nodeId, beforeId]) });
  if (!allowed) return null;
  return <Stack spacing={0.75} component="section" aria-label="Launch attempts">
    <Typography component="h3" variant="subtitle2">Launch attempts</Typography>
    {result.error && <Alert severity="warning">{result.error}</Alert>}
    {result.loading && !result.data && <Typography role="status" variant="body2">Reading launch requests…</Typography>}
    {result.data?.attempts.length === 0 && <Typography variant="body2">No start requests recorded.</Typography>}
    {result.data?.attempts.slice().reverse().map(attempt => <Stack key={attempt.id} spacing={0.25}>
      <Typography variant="body2"><strong>{attempt.outcome === 'ok' ? 'Started' : attempt.outcome === 'failed' ? 'Start request failed' : attempt.outcome}</strong>
        {' · '}{formatDate(attempt.at)}</Typography>
      {attempt.message && <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{attempt.message}</Typography>}
      <Typography variant="caption" color="text.secondary">Receipt {attempt.id}{!attempt.manifestVerified && ' · Recorded by release ID'}</Typography>
    </Stack>)}
    <Stack direction="row" spacing={1}>{result.data?.next && <Button size="small" onClick={() => setCursors([...cursors, result.data!.next!])}>Earlier attempts</Button>}
      {beforeId && <Button size="small" onClick={() => setCursors(cursors.slice(0, -1))}>Later attempts</Button>}</Stack>
  </Stack>;
}

export function LaunchLogs({ confirmation }: { confirmation: Confirmation }) {
  const { can } = useAccess();
  const [page, setPage] = useState(0);
  const namespaces = [...new Set(confirmation.apps.map(app => app.handle.slice(0, app.handle.lastIndexOf('/') + 1)))];
  const allowed = can('OmnitronLogs.queryLogs') && Boolean(confirmation.startAfter) && namespaces.every(Boolean);
  const result = usePolledResource(() => logs.queryLogs({ appPrefixes: namespaces, nodeId: confirmation.nodeId,
    from: confirmation.startAfter!, to: confirmation.confirmedAt, limit: 200, offset: page * 200 }), {
    enabled: allowed, paused: true, intervalMs: 5000, resourceKey: JSON.stringify([confirmation, page]),
  });
  if (!allowed) return null;
  return <Stack spacing={0.75} component="section" aria-label="Startup logs">
    {result.error && <Alert severity="warning" action={<Button onClick={() => void result.refresh()}>Retry</Button>}>{result.error}</Alert>}
    {result.loading && !result.data && <Typography role="status" variant="body2">Reading startup logs…</Typography>}
    {result.data && <>
      <LiveLogOutput label="Startup logs" live={false} text={result.data.entries.slice().reverse().map(row =>
        [formatDate(row.timestamp), row.app, row.level, row.message].join('  ')).join('\n') || 'No application output was retained for this launch interval.'} />
      <Stack direction="row" spacing={1}>
        {result.data.hasMore && <Button size="small" onClick={() => setPage(page + 1)}>Earlier output</Button>}
        {page > 0 && <Button size="small" onClick={() => setPage(page - 1)}>Later output</Button>}
      </Stack>
    </>}
  </Stack>;
}
