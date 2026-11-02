import { Box, Button, Typography } from '@mui/material';
import type { IStackInfo } from '@omnitron-dev/omnitron/dto/services';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { formatTimestamp } from 'src/utils/formatters';
import { Can } from 'src/auth/access';

/** The daemon revalidates ownership, retained commands and authority before dispatch. */
export function hasInstalledRecovery(stack: IStackInfo): boolean {
  const stop = stack.stopOperation;
  return Boolean(stop?.phase === 'stopped' && !stop.supersededAt && stop.nodes.length &&
    stop.nodes.every(node => node.outcome === 'stopped' && node.authority));
}

export function StackRecoveryAction({ stack, onResume, onReviewStop }: {
  stack: IStackInfo;
  onResume: () => void;
  onReviewStop: () => void;
}) {
  if (!hasInstalledRecovery(stack)) return null;
  const stop = stack.stopOperation!;
  if (!stop.intentCommitted || stop.nodes.some(node => !node.operationId || !node.observedAt) || stack.resumeOperation?.stopOperationId === stop.id) {
    return <Can permission="OmnitronProject.reviewStackStop">
      <Button size="small" onClick={onReviewStop}>Review new stop…</Button>
    </Can>;
  }
  return <Can permission="OmnitronProject.resumeInstalledStack">
    <Button size="small" color="success" onClick={onResume}>Resume installed apps</Button>
  </Can>;
}

export function StackResumeNotice({ stack }: { stack: IStackInfo }) {
  const result = stack.resumeOperation;
  if (!result || result.stopOperationId !== stack.stopOperation?.id) return null;
  const complete = result.outcome === 'running';
  const confirmed = result.nodes.filter(node => node.outcome === 'running').length;
  return <Box component="details" open={!complete} sx={{ mb: 2, typography: 'body2', overflowWrap: 'anywhere' }}>
    <summary>Installed recovery · {result.outcome} · {confirmed}/{result.nodes.length} nodes confirmed</summary>
    {!complete && <Alert severity="warning">Inspect each node before requesting a new stop and recovery.</Alert>}
    <Typography variant="caption">Operation {result.operationId}</Typography>
    {result.nodes.map(node => (
      <Typography key={node.node} variant="body2">
        {[node.node, node.outcome, node.apps?.join(', '), node.reason, node.observedAt && formatTimestamp(node.observedAt)].filter(Boolean).join(' · ')}
      </Typography>
    ))}
  </Box>;
}
