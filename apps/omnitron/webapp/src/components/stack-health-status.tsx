import { Stack, Chip, Typography } from '@omnitron-dev/prism/ui';
import { stackHealthReading, healthLabel } from '@omnitron-dev/omnitron/stack-reading';
import type { IStackInfo } from '@omnitron-dev/omnitron/dto/services';

/** Process counts, health and start prerequisites are deliberately distinct readings. */
export function StackHealthStatus({ stack, compact = false }: { stack: IStackInfo; compact?: boolean }) {
  const health = stackHealthReading(stack.health);
  if (stack.status === 'stopped' && !stack.health) return null;
  return <Stack spacing={0.5} sx={{ mt: 1.5, minWidth: 0 }}>
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
      <Chip size="small" variant="outlined" label={health.label}
        color={health.status === 'healthy' ? 'success' : health.status === 'unhealthy' ? 'error' : health.status === 'degraded' ? 'warning' : 'default'} />
      <Typography variant="caption" color="text.secondary">{health.detail}</Typography>
    </Stack>
    {!compact && health.findings.map(app => <Typography key={`${app.node}/${app.name}`} variant="caption" sx={{ overflowWrap: 'anywhere' }}>
      {app.node === 'local' ? app.name : `${app.node} / ${app.name}`} · {app.checks.filter(check => check.status !== 'pass').map(check => check.message || check.name).join(' · ') || app.status}
    </Typography>)}
    {!compact && stack.health?.observedAt && <Typography variant="caption" color="text.secondary">
      Health observed {new Date(stack.health.observedAt).toLocaleString()}
    </Typography>}
  </Stack>;
}

export function ApplicationHealthStatus({ status = 'unknown' }: { status?: NonNullable<IStackInfo['health']>['status'] }) {
  return <Chip size="small" variant="outlined" label={healthLabel(status)}
    color={status === 'healthy' ? 'success' : status === 'unhealthy' ? 'error' : status === 'degraded' ? 'warning' : 'default'} />;
}
