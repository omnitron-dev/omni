import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Stack, Typography } from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import type { InstalledReleaseInspection } from '@omnitron-dev/omnitron/dto/services';
import { daemonClient } from 'src/netron/client';
import { OperationStatus } from './operation-status';
import { when } from './release-bits';

/** An explicit expensive read, independent of both polling and historical launch receipts. */
export function InstalledFilesInspection({ project, stack }: { project: string; stack: string }) {
  const [report, setReport] = useState<InstalledReleaseInspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const inspect = async () => {
    setBusy(true); setError(false);
    try { setReport(await daemonClient.invoke<InstalledReleaseInspection>('daemon', 'OmnitronProject', 'inspectInstalledArtifacts', [{ project, stack }], { timeout: 90_000 })); }
    catch { setError(true); }
    finally { setBusy(false); }
  };
  return <Box sx={{ minWidth: 0, width: 1 }}>
    <Button size="small" variant="text" disabled={busy} onClick={() => void inspect()} sx={{ px: 0, justifyContent: 'flex-start' }}>
      {report ? 'Inspect installed files again' : 'Inspect installed files'}
    </Button>
    <OperationStatus active={busy} label="Comparing installed files and retained release archives…" detail="Read-only inspection; applications keep running." />
    {error && <Alert severity="warning">Inspection is unavailable. The backend may need an update; any results below are the previous observation.</Alert>}
    {report && <Stack spacing={0.75}>
      <Typography variant="caption" color="text.secondary">Installed files · {when(report.observedAt)}</Typography>
      {!report.catalogComplete && <Alert severity="warning">Release catalog is incomplete. {report.catalogReasons.join(' ')}</Alert>}
      {report.nodes.map((node, index) => <Typography key={`${node.node}:${index}`} variant="caption" color="warning.main">{node.node}: {node.error}</Typography>)}
      {report.apps.map((app, index) => <Box component="details" key={`${app.node}:${app.app}:${index}`} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        <Typography component="summary" variant="caption" sx={{ cursor: 'pointer', color: app.candidates.some(candidate => candidate.state === 'modified') || app.state !== 'observed' ? 'warning.main' : 'text.secondary' }}>
          {app.node} / {app.app.split('/').at(-1)} · {app.state !== 'observed' ? app.state.replaceAll('-', ' ')
            : app.candidates.length > 1 ? `Ambiguous base (${app.candidates.length} matches)`
              : !app.candidates.length ? 'No catalog match'
                : app.candidates[0]!.state === 'modified' ? 'Installed files modified'
                  : app.candidates[0]!.state === 'entry-matches' ? 'Entry matches (partial check)' : 'Comparison incomplete'}
        </Typography>
        <Stack spacing={0.5} sx={{ py: 0.5 }}>
          <Typography variant="caption" color="text.secondary">Observed PID {app.pid ?? 'none'} · {when(app.observedAt)}</Typography>
          {app.reasons.map(reason => <Typography key={reason} variant="caption" color="warning.main">{reason}</Typography>)}
          {app.candidates.map(candidate => <Box key={candidate.releaseId}>
            <Typography variant="caption" component="div">Retained archive matches <Typography component={RouterLink} variant="caption" to={`/releases/${encodeURIComponent(candidate.releaseId)}`} sx={{ color: 'primary.main', textDecoration: 'none', fontFamily: 'monospace' }}>{candidate.releaseId}</Typography></Typography>
            {candidate.reasons.map(reason => <Typography key={reason} variant="caption" component="div" color="warning.main">{reason}</Typography>)}
          </Box>)}
        </Stack>
      </Box>)}
      {report.apps.length === 0 && report.nodes.length === 0 && <Typography variant="caption" color="text.secondary">No application installation handles were reported.</Typography>}
      {report.limitations.map(limitation => <Typography key={limitation} variant="caption" color="text.secondary">{limitation}</Typography>)}
    </Stack>}
  </Box>;
}
