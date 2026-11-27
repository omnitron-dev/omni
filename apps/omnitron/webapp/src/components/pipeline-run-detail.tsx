import type { ReactNode } from 'react';
import { Box, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import type { PipelineRun } from '@omnitron-dev/omnitron/dto/services';
import { formatDate, formatDuration } from 'src/utils/formatters';
import { LiveLogOutput } from './live-log-output';

export const runColors: Record<string, 'success' | 'error' | 'info' | 'warning' | 'default'> = {
  'awaiting-review': 'warning',
  success: 'success',
  failed: 'error',
  running: 'info',
  pending: 'default',
  cancelling: 'warning',
  interrupted: 'warning',
  cancelled: 'default',
};
export const activeRun = (run: Pick<PipelineRun, 'status'>) => ['pending', 'running', 'cancelling'].includes(run.status);
export const pipelineCodeSx = {
  m: 0,
  p: 1.5,
  borderRadius: 1,
  bgcolor: 'action.hover',
  fontFamily: 'monospace',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  maxHeight: 320,
  overflow: 'auto',
  minWidth: 0,
} as const;

export function PipelineRunDetail({
  run,
  targetLabel = (id) => id ?? 'Local daemon host',
  children,
  onPause,
}: {
  run: PipelineRun;
  targetLabel?: (id?: string) => string;
  children?: ReactNode;
  onPause?: () => void;
}) {
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        <Chip size="small" label={run.status} color={runColors[run.status] ?? 'default'} />
        <Typography variant="caption">
          {formatDate(run.startedAt)} · requested by {run.triggeredBy}
          {run.startedBy && ` · started by ${run.startedBy}`}
        </Typography>
      </Stack>
      <Typography variant="caption" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
        {run.id}
      </Typography>
      {activeRun(run) && <LinearProgress aria-label="Automation in progress" />}
      {run.status === 'interrupted' && (
        <Alert severity="warning" variant="outlined">
          The executor stopped before recording completion.
        </Alert>
      )}
      {run.recovery && <Alert severity={run.recovery.blocked.length ? 'warning' : 'info'} variant="outlined" sx={{ overflowWrap: 'anywhere' }}>
        {run.recovery.completed.length} confirmed · {run.recovery.pending.length} awaiting dispatch.
        {run.recovery.blocked.length > 0 && ` Continuation blocked by ${run.recovery.blocked.join(', ')}. Inspect the recorded effects.`}
      </Alert>}
      {children}
      {run.steps.map((step) => (
        <Box key={step.name} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5, minWidth: 0 }}>
          <Stack direction="row" sx={{ flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography variant="subtitle2" sx={{ flex: 1, overflowWrap: 'anywhere' }}>
              {step.name}
            </Typography>
            <Chip size="small" label={step.status} color={runColors[step.status] ?? 'default'} />
            <Typography variant="caption" color="text.secondary">
              {formatDuration(step.duration)}
              {step.attempts ? ` · attempt ${step.attempts}` : ''}
              {step.exitCode !== undefined && ` · exit ${step.exitCode}`}
            </Typography>
          </Stack>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mb: 1, overflowWrap: 'anywhere' }}
          >
            {step.kind === 'deploy'
              ? (step.deployment ? `Deployment · ${step.deployment.target.project}/${step.deployment.target.stack}` : 'Deployment')
              : `${step.kind ?? 'shell'} · ${targetLabel(step.nodeId)}`}
          </Typography>
          {step.error && (
            <Alert severity="error" variant="outlined" sx={{ mb: 1, overflowWrap: 'anywhere' }}>
              {step.error}
            </Alert>
          )}
          {step.output && <LiveLogOutput label={step.name + ' stdout'} text={step.output} live={activeRun(run)} onPause={onPause} />}
          {step.stderr && <LiveLogOutput label={step.name + ' stderr'} text={step.stderr} live={activeRun(run)} onPause={onPause} />}
          {step.outputTruncated && (
            <Typography variant="caption" color="warning.main">
              Output retention limit reached; earlier content was omitted.
            </Typography>
          )}
          {step.sourceHash && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mt: 1, overflowWrap: 'anywhere', fontFamily: 'monospace' }}
            >
              SHA-256 {step.sourceHash}
            </Typography>
          )}
          {step.executions?.map(execution => (
            <Box key={execution.attempt} sx={{ mt: 1 }}>
              {execution.state === 'unconfirmed' && (
                <Alert severity="warning" variant="outlined">
                  Attempt {execution.attempt} has unconfirmed effects. Automatic retries were refused; inspect the recorded process before running again.
                </Alert>
              )}
              <Box component="details" sx={{ typography: 'body2' }}>
                <summary>Release attempt {execution.attempt} · {execution.state}</summary>
                <Box component="pre" aria-label={`${step.name} release attempt ${execution.attempt}`} tabIndex={0} sx={pipelineCodeSx}>
                  {JSON.stringify(execution, null, 2)}
                </Box>
              </Box>
            </Box>
          ))}
          {step.deployment && <Box component="details" sx={{ typography: 'body2' }}>
            <summary>Deployment receipt · {step.deployment.state}</summary>
            <Box component="pre" aria-label={`${step.name} deployment evidence`} tabIndex={0} sx={pipelineCodeSx}>
              {JSON.stringify(step.deployment, null, 2)}
            </Box>
          </Box>}
        </Box>
      ))}
    </Stack>
  );
}
