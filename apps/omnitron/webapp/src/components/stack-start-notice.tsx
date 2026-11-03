import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Alert } from '@omnitron-dev/prism/components/alert';
import type { IStackInfo } from '@omnitron-dev/omnitron/dto/services';

/** Durable backend evidence, not the transient notification from this browser's start action. */
export function StackStartNotice({ stack, compact = false }: {
  stack: Pick<IStackInfo, 'notUp' | 'status'>;
  compact?: boolean;
}) {
  if (!stack.notUp?.length) return null;
  const issues = compact ? stack.notUp.slice(0, 1) : stack.notUp;
  return <Alert severity={stack.status === 'error' ? 'error' : 'warning'} sx={{ my: 2, minWidth: 0, '& .MuiAlert-message': { minWidth: 0 } }}>
    <Typography variant="subtitle2">Not up · {stack.notUp.length}</Typography>
    <Box component="ul" sx={{ m: 0, pl: 2, overflowWrap: 'anywhere' }}>
      {issues.map(issue => <Typography component="li" variant="body2" key={issue}>{issue}</Typography>)}
    </Box>
    {compact && stack.notUp.length > issues.length && <Typography variant="caption">
      {stack.notUp.length - issues.length} more · Open stack for details
    </Typography>}
  </Alert>;
}
