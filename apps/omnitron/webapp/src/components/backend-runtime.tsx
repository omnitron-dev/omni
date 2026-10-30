import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { backendRuntime } from 'src/netron/client';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { formatDateShort } from 'src/utils/formatters';

/** This endpoint stays readable when the owner cannot supply app inventory. */
export function BackendRuntimeCard() {
  const { data, error } = usePolledResource(() => backendRuntime.status(), { intervalMs: 5000 });
  const connection = data?.connection;
  return (
    <Card variant="outlined" sx={{ minWidth: 0, maxWidth: 480 }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Stack spacing={1.5}>
          <Typography variant="subtitle2">Execution control</Typography>
          {error && <Alert severity="warning">Cannot refresh execution control: {error}. Any values below are the last observation.</Alert>}
          {!data && !error && <Typography variant="body2" color="text.secondary">Waiting for the backend.</Typography>}
          {data && <>
            <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
              <Chip size="small" variant="outlined" label={data.mode === 'resident' ? 'Resident owner' : 'Coupled execution'} />
              {connection && <Chip size="small" variant="outlined" color={error ? 'default' : connection.status === 'connected' ? 'success' : 'warning'}
                label={error ? 'Last observed' : connection.status === 'connected' ? 'Owner connected' : connection.status === 'owner-changed' ? 'Owner identity changed' : 'Owner unavailable'} />}
            </Stack>
            {data.owner && <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
              Owner PID {data.owner.pid} · epoch {data.epoch} · {data.phase}
            </Typography>}
            {data.supervision && <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              Independent OS supervision · guardian PID {data.supervision.guardianPid}
            </Typography>}
            {connection?.observedAt && <Typography variant="caption" color="text.secondary">
              Last owner observation: {formatDateShort(connection.observedAt)}
            </Typography>}
            {!error && connection?.error && <Alert severity="warning">{connection.error}. Application state is unknown; a lost control channel does not establish that applications stopped.</Alert>}
            {data.reason && <Typography variant="body2" color="text.secondary">{data.reason}</Typography>}
            {data.mode === 'resident' && !connection && <Typography variant="body2" color="text.secondary">This backend does not report owner connection freshness.</Typography>}
            {data.recovery && <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              Recovery checkpoint: {data.recovery.status}{data.recovery.reason ? ` · ${data.recovery.reason}` : ''}
            </Typography>}
          </>}
        </Stack>
      </CardContent>
    </Card>
  );
}
