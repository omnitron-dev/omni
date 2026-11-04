import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, Switch, Typography } from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { OperationStatus } from './operation-status';
import { TopologyMetadataDialog } from './topology/topology-metadata-dialog';
import { StackHostReadiness } from './stack-host-readiness';
import { Can } from 'src/auth/access';
import { daemonClient } from 'src/netron/client';
import type { StackDiagnosis } from '@omnitron-dev/omnitron/dto/services';

const COLORS = { pass: 'success', change: 'info', blocked: 'error', unknown: 'warning' } as const;
const LABELS = { pass: 'Verified', change: 'Planned change', blocked: 'Blocked', unknown: 'Not verified' } as const;
const VERDICTS = { ready: 'Prerequisites verified', changes: 'Changes required at start', blocked: 'Start blockers found', unknown: 'Verification incomplete' } as const;

/** On-demand observation, separate from deployment. Closing never starts or stops anything. */
export function StackDiagnosisDialog({ project, stack, onClose }: { project: string; stack: string; onClose: () => void }) {
  const [report, setReport] = useState<StackDiagnosis | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const generation = useRef({ value: 0 });
  const inspect = useCallback(async () => {
    const request = ++generation.current.value;
    setBusy(true); setError(null);
    try {
      const result = await daemonClient.invoke<StackDiagnosis>('daemon', 'OmnitronProject', 'diagnoseStack', [{ project, stack }], { timeout: 120_000 });
      if (request === generation.current.value) setReport(result);
    } catch (reason) {
      if (request === generation.current.value) setError(reason instanceof Error ? reason.message : 'Diagnosis failed');
    } finally { if (request === generation.current.value) setBusy(false); }
  }, [project, stack]);
  useEffect(() => { const requestState = generation.current; void inspect(); return () => { requestState.value++; }; }, [inspect]);
  return <>
    <Dialog open fullWidth maxWidth="md" onClose={onClose} aria-labelledby="stack-diagnosis-title">
      <DialogTitle id="stack-diagnosis-title">{project} / {stack} · Start prerequisites</DialogTitle>
      <DialogContent dividers sx={{ minWidth: 0 }}>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">Inspect configuration and host prerequisites without starting applications, provisioning services or applying migrations.</Typography>
          <OperationStatus active={busy} label="Checking stack prerequisites" detail="Reading declarations and Docker inventory; no services are changed" />
          {error && <Alert severity="error">{error}{report ? ' The previous report is retained below and is stale.' : ''}</Alert>}
          {report && <>
            <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="subtitle2" role="status">{VERDICTS[report.status]}</Typography>
              <Typography variant="caption" color="text.secondary">{new Date(report.checkedAt).toLocaleString()} · {(report.durationMs / 1000).toFixed(1)} s{busy || error ? ' · previous observation' : ''}</Typography>
              <FormControlLabel sx={{ ml: 'auto' }} control={<Switch size="small" checked={attentionOnly} onChange={(_, value) => setAttentionOnly(value)} />} label={<Typography variant="caption">Needs attention</Typography>} />
            </Stack>
            <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
              {report.checks.filter(check => !attentionOnly || check.state !== 'pass').map((check, index) => <Box component="li" key={`${check.code}/${check.resource}/${index}`} sx={{ py: 1.25, borderBottom: '1px solid', borderColor: 'divider', display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(130px, 1fr) 3fr' }, gap: 1, overflowWrap: 'anywhere' }}>
                <Box><Typography variant="body2" sx={{ fontWeight: 600 }}>{check.resource}</Typography><Chip size="small" variant="outlined" color={COLORS[check.state]} label={LABELS[check.state]} sx={{ mt: 0.5 }} /></Box>
                <Box><Typography variant="body2">{check.message}</Typography>{check.action && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{check.action}</Typography>}</Box>
              </Box>)}
            </Box>
            {attentionOnly && report.checks.every(check => check.state === 'pass') && <Typography variant="body2">No prerequisite warnings.</Typography>}
            {report.checks.some(check => check.code === 'remote.prerequisites') && <Can permission="OmnitronProject.inspectStackHost">
              <StackHostReadiness key={JSON.stringify([project, stack])} project={project} stack={stack} />
            </Can>}
            <Alert severity="info">Not verified: {report.deferred.join('; ')}. This report is an observation, not a guarantee that startup will succeed.</Alert>
          </>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        {report?.checks.some(check => check.code === 'declaration.unknown') && <Can permission="OmnitronProject.refreshTopologyMetadata"><Button disabled={busy} onClick={() => setMetadataOpen(true)}>Refresh declarations…</Button></Can>}
        <Button disabled={busy} onClick={() => void inspect()}>Check again</Button>
        <Button autoFocus onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
    {metadataOpen && <TopologyMetadataDialog project={project} stack={stack} onClose={() => setMetadataOpen(false)} onUpdated={inspect} />}
  </>;
}
