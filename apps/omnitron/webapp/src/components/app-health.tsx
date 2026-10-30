import { useEffect } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { daemon } from 'src/netron/client';
import { usePolledResource } from 'src/hooks/use-polled-resource';

/** Separate from process lifecycle: an online worker can have failed dependencies. */
export function AppHealth({ appName, refreshToken, onLogs }: {
  appName: string;
  refreshToken: number;
  onLogs: () => void;
}) {
  const { data, error, loading, refresh } = usePolledResource(async () => {
    const report = await daemon.getHealth({ name: appName });
    const app = report.apps[appName];
    if (!app) throw new Error('The daemon returned no health answer for this application.');
    return { ...app, timestamp: report.timestamp };
  }, { intervalMs: 5_000 });
  useEffect(() => { if (refreshToken > 0) void refresh(); }, [refreshToken, refresh]);

  const stale = data !== null && (!Number.isFinite(data.timestamp) ||
    Date.now() - data.timestamp >= 30_000 || data.timestamp > Date.now() + 5_000);
  const verified = data !== null && !error && !stale;
  const status = verified ? data.status : 'unverified';
  const color = status === 'healthy' ? 'success' : status === 'unhealthy' ? 'error' : 'warning';
  const ordered = data ? [...data.checks].sort((a, b) =>
    ({ fail: 0, warn: 1, pass: 2 }[a.status]) - ({ fail: 0, warn: 1, pass: 2 }[b.status])) : [];

  return (
    <Card variant="outlined" component="section" aria-label="Application readiness" sx={{ minWidth: 0 }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Stack direction="row" useFlexGap spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1.5 }}>
          <Typography variant="subtitle2">Readiness</Typography>
          <Chip size="small" variant="outlined" color={color} label={loading && !data ? 'Checking' : status} />
          {data && Number.isFinite(data.timestamp) && <Typography variant="caption" color="text.secondary">
            {verified ? 'Checked' : 'Last observation'} {new Date(data.timestamp).toLocaleTimeString()}
          </Typography>}
          <Button size="small" onClick={onLogs} sx={{ ml: 'auto' }}>View logs</Button>
        </Stack>
        {(error || stale) && <Alert severity="warning" variant="outlined" sx={{ mb: 1.5 }}>
          {error ?? 'Health observation is stale. Waiting for a fresh answer.'}
          {data ? ' The checks below are the last observation, not a current health verdict.' : ''}
        </Alert>}
        {!data && !error && <Typography variant="body2" color="text.secondary">Waiting for the application health probe.</Typography>}
        {data && ordered.length === 0 && <Typography variant="body2" color="text.secondary">
          The application reported {data.status} without individual checks. Add named readiness checks to its bootstrap.
        </Typography>}
        <Stack spacing={1.5}>
          {ordered.map((check, index) => (
            <Box key={`${check.name}-${index}`} sx={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: 1, alignItems: 'start' }}>
              <Chip size="small" variant="outlined" label={check.status} color={check.status === 'pass' ? 'success' : check.status === 'fail' ? 'error' : 'warning'} />
              <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{check.name.startsWith(`${appName}/`) ? check.name.slice(appName.length + 1) : check.name}</Typography>
                <Typography variant="body2" color="text.secondary">{check.message ?? 'No diagnostic message was supplied by the application.'}</Typography>
              </Box>
            </Box>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}
