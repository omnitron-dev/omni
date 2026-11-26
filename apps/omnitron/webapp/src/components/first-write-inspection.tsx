import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { FirstWriteInspection, InspectFirstWrite } from '@omnitron-dev/omnitron/dto/services';
import { invokeStackLifecycle } from 'src/netron/client';

export function FirstWriteInspector({ project, stack, release }: Omit<InspectFirstWrite, 'verifyRunId'>) {
  const [run, setRun] = useState('');
  const [report, setReport] = useState<FirstWriteInspection | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const inspect = async () => {
    const attempt = ++generation.current;
    setBusy(true); setReport(null); setError('');
    try {
      const result = await invokeStackLifecycle('inspectFirstWrite', { project, stack, release, ...(run.trim() && { verifyRunId: run.trim() }) });
      if (attempt === generation.current) setReport(result);
    } catch (err) {
      if (attempt === generation.current) setError((err as Error).message);
    } finally {
      if (attempt === generation.current) setBusy(false);
    }
  };
  return <Stack spacing={1}>
    <TextField label="Physical verify run ID (optional)" size="small" value={run} disabled={busy}
      onChange={event => { setRun(event.target.value); setReport(null); setError(''); }}
      helperText="A completed service-data-adopt verification lets the controller re-read a closed copy on both enrolled nodes." />
    <Button variant="outlined" disabled={busy} onClick={() => void inspect()}>
      {busy ? 'Inspecting first-write admission…' : 'Inspect first-write admission'}
    </Button>
    {error && <Alert severity="error">{error}</Alert>}
    {report && <Alert severity="warning">
      <Typography variant="body2">Production writes withheld. {report.owner.nodeId} is {report.owner.phase} at revision {report.owner.revision}.</Typography>
      <Box component="details" sx={{ typography: 'body2', overflowWrap: 'anywhere' }}>
        <summary>{report.owner.apps.length} supervised applications</summary>
        {report.owner.apps.map(app => <div key={app.name}>{app.name} · {app.generation} · {app.artifactSha256}</div>)}
      </Box>
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
        {report.physical.state === 'verified-closed-copy' ? 'Closed copy verified on ' + report.physical.evidence.receiver.nodeId +
          ' at stop ' + report.physical.evidence.sourceStop + '. Proof ' + report.physical.evidence.proofDigest : report.physical.reason}
      </Typography>
      <Box component="ul" sx={{ typography: 'body2', pl: 2 }}>
        {report.missing.map(item => <li key={item.authority}>{item.reason}</li>)}
      </Box>
    </Alert>}
  </Stack>;
}
