import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import { Alert } from '@omnitron-dev/prism/components/alert';
import type { IStackInfo } from '@omnitron-dev/omnitron/dto/services';

/** Uses the durable backend operation, including after a page or backend reload. */
export function StackStopNotice({ operation }: { operation: IStackInfo['stopOperation'] }) {
  if (!operation) return null;
  const failed = operation.phase === 'failed';
  const complete = operation.phase === 'stopped';
  const confirmed = operation.nodes.filter(node => node.outcome === 'stopped').length;
  const nodes = operation.nodes.map(node => (
    <Box key={node.node} sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.5, mt: 0.75 }}>
      <Typography variant="body2" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{node.node}</Typography>
      <Typography variant="body2">{node.outcome === 'unknown' ? 'Awaiting confirmation' : node.outcome}</Typography>
      {node.authority && <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>{node.authority.clusterId} · epoch {node.authority.epoch} · {node.authority.nodeId}</Typography>}
      {node.reason && <Typography variant="caption" sx={{ width: '100%', overflowWrap: 'anywhere' }}>{node.reason}</Typography>}
    </Box>
  ));
  const evidence = <Box sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
    <Typography variant="caption" component="div">Operation {operation.id}</Typography>
    {operation.startedAt && <Typography variant="caption" component="div">Requested {new Date(operation.startedAt).toLocaleString()}</Typography>}
    {operation.completedAt && <Typography variant="caption" component="div">Completed {new Date(operation.completedAt).toLocaleString()}</Typography>}
    {operation.supersededAt && <Typography variant="caption" component="div">Superseded {new Date(operation.supersededAt).toLocaleString()}</Typography>}
    {operation.keepInfrastructure && <Typography variant="caption" component="div">Requested infrastructure preservation</Typography>}
    {operation.error && <Typography variant="body2" color="error.main">{operation.error}</Typography>}
    {nodes}
  </Box>;
  if (complete || operation.supersededAt) return (
    <Box component="details" sx={{ minWidth: 0, typography: 'body2', '& summary': { cursor: 'pointer' } }}>
      <summary>{complete ? 'Stop confirmed' : `Previous stop · ${operation.phase}`}
        {operation.nodes.length > 0 && ` · ${confirmed}/${operation.nodes.length} nodes`}
        {operation.supersededAt && ' · superseded'}
      </summary>
      {evidence}
    </Box>
  );
  return (
    <Alert severity={failed ? 'error' : 'info'} sx={{ mb: 2, minWidth: 0 }}>
      <Box role="status" aria-live="polite" sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2">
          {failed ? (operation.intentCommitted ? 'Stop not confirmed' : 'Stop declined before execution') : operation.phase === 'preparing' ? 'Checking stop ownership' : 'Stopping stack'}
          {operation.nodes.length > 0 && ` · ${confirmed}/${operation.nodes.length} nodes confirmed`}
        </Typography>
        {!failed && <LinearProgress aria-label="Stack stop in progress" sx={{ mt: 1, mb: 1.5 }} />}
        {evidence}
      </Box>
    </Alert>
  );
}
