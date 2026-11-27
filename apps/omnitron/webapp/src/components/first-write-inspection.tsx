import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { FirstWriteInspection, InspectFirstWrite, MigrationRehearsalResult, PrepareRehearsalResult } from '@omnitron-dev/omnitron/dto/services';
import { invokeStackLifecycle } from 'src/netron/client';
import { useAccess } from 'src/auth/access';

export function FirstWriteInspector({ project, stack, release }: Omit<InspectFirstWrite, 'verifyRunId'>) {
  const [run, setRun] = useState('');
  const [report, setReport] = useState<FirstWriteInspection | null>(null);
  const { can } = useAccess();
  const [copy, setCopy] = useState<PrepareRehearsalResult | null>(null);
  const [app, setApp] = useState('');
  const [trial, setTrial] = useState<MigrationRehearsalResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const inspect = async () => {
    const attempt = ++generation.current;
    setBusy(true); setReport(null); setCopy(null); setTrial(null); setError('');
    try {
      const result = await invokeStackLifecycle('inspectFirstWrite', { project, stack, release, ...(run.trim() && { verifyRunId: run.trim() }) });
      if (attempt === generation.current) setReport(result);
    } catch (err) {
      if (attempt === generation.current) setError((err as Error).message);
    } finally {
      if (attempt === generation.current) setBusy(false);
    }
  };
  const prepare = async () => {
    if (report?.physical.state !== 'verified-closed-copy') return;
    const attempt = ++generation.current;
    setBusy(true); setError('');
    try {
      const result = await invokeStackLifecycle('prepareRehearsal', { project, stack, release,
        verifyRunId: report.physical.evidence.verifyRunId, operationId: copy?.plan.operationId ?? crypto.randomUUID(),
        ...(copy && { review: copy.plan.digest }) });
      if (generation.current === attempt) setCopy(result);
    } catch (err) {
      if (generation.current === attempt) setError((err as Error).message);
    } finally {
      if (generation.current === attempt) setBusy(false);
    }
  };
  const rehearse = async (confirm: boolean) => {
    if (copy?.state !== 'prepared' || !app.trim() || (confirm && trial?.state !== 'awaiting-confirmation')) return;
    const attempt = ++generation.current;
    setBusy(true); setError('');
    try {
      const result = await invokeStackLifecycle('rehearseMigrations', { project, stack, release, operationId: copy.plan.operationId,
        app: app.trim(), ...(confirm && trial && { review: trial.plan.digest }) });
      if (generation.current === attempt) setTrial(result);
    } catch (err) {
      if (generation.current === attempt) setError((err as Error).message);
    } finally {
      if (generation.current === attempt) setBusy(false);
    }
  };
  return <Stack spacing={1}>
    <TextField label="Physical verify run ID (optional)" size="small" value={run} disabled={busy}
      onChange={event => { setRun(event.target.value); setReport(null); setCopy(null); setTrial(null); setError(''); }}
      helperText="A completed service-data-adopt verification lets the controller re-read a closed copy on both enrolled nodes." />
    <Button variant="outlined" disabled={busy} onClick={() => void inspect()}>
      Inspect first-write admission
    </Button>
    {error && <Alert severity="error">{error}</Alert>}
    {report && <Alert severity="warning">
      <Typography variant="body2">Production writes withheld. {report.owner.nodeId} is {report.owner.phase} at revision {report.owner.revision}.</Typography>
      <Box component="details" sx={{ typography: 'body2', overflowWrap: 'anywhere' }}>
        <summary>{report.owner.apps.length} supervised applications</summary>
        {report.owner.apps.map(owner => <div key={owner.name}>{owner.name} · {owner.generation} · {owner.artifactSha256}</div>)}
      </Box>
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
        {report.physical.state === 'verified-closed-copy' ? 'Closed copy verified on ' + report.physical.evidence.receiver.nodeId +
          ' at stop ' + report.physical.evidence.sourceStop + '. Proof ' + report.physical.evidence.proofDigest : report.physical.reason}
      </Typography>
      <Box component="ul" sx={{ typography: 'body2', pl: 2 }}>
        {report.missing.map(item => <li key={item.authority}>{item.reason}</li>)}
      </Box>
    </Alert>}
    {report?.physical.state === 'verified-closed-copy' && can('OmnitronProject.prepareRehearsal') && <>
      {copy && <Alert severity={copy.state === 'prepared' ? 'success' : 'info'} sx={{ overflowWrap: 'anywhere' }}>
        <Typography variant="body2">{copy.state === 'prepared' ? 'Private data pair prepared.' : 'Review private PostgreSQL and MinIO copies.'}
          {' '}{copy.plan.logicalBytes} logical bytes on {copy.plan.receiver.nodeId}. Operation {copy.plan.operationId}.</Typography>
        <Typography variant="body2">Candidate {copy.plan.manifestSha256}. Review {copy.plan.digest}.</Typography>
        {copy.state === 'prepared' && copy.receipt.copies.map(item =>
          <Typography key={item.tag} variant="body2">{item.tag} · {item.device}/{item.inode} · {item.generation}</Typography>)}
      </Alert>}
      {copy?.state !== 'prepared' && <Button variant="outlined" disabled={busy} onClick={() => void prepare()}>
        {copy ? 'Prepare reviewed private copies' : 'Review private data copies'}
      </Button>}
    </>}
    {copy?.state === 'prepared' && can('OmnitronProject.rehearseMigrations') && <>
      <TextField size="small" label="Migration application" value={app} disabled={busy}
        onChange={event => { setApp(event.target.value); setTrial(null); setError(''); }} />
      <Button variant="outlined" disabled={busy || !app.trim()} onClick={() => void rehearse(false)}>
        {trial ? 'Read migration rehearsal' : 'Review migration rehearsal'}
      </Button>
      {trial && <Alert severity={trial.state === 'verified' ? 'success' : trial.state === 'awaiting-confirmation' ? 'info' : 'warning'}
        sx={{ overflowWrap: 'anywhere' }}>
        <Typography variant="body2">PostgreSQL {trial.plan.database}. Candidate archive {trial.plan.archiveSha256}.</Typography>
        {trial.state === 'awaiting-confirmation' && <Typography variant="body2">Expected additions: {trial.plan.added.join(', ')}. Review {trial.plan.digest}.</Typography>}
        {trial.state === 'verified' && <Box component="details">
          <summary>Verified {trial.receipt.after.length} migrations. View complete journal</summary>
          <Box component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(trial.receipt, null, 2)}</Box>
        </Box>}
        {(trial.state === 'unconfirmed' || trial.state === 'refused') && <Typography variant="body2">{trial.state}: {trial.reason}</Typography>}
      </Alert>}
      {trial?.state === 'awaiting-confirmation' && <Button variant="contained" disabled={busy} onClick={() => void rehearse(true)}>
        Run reviewed migrations on private copy
      </Button>}
    </>}
  </Stack>;
}
