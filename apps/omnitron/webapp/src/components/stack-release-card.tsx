import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { readStackRelease, stackDeploymentHistory } from '@omnitron-dev/omnitron/release-reading';
import type { IStackInfo } from '@omnitron-dev/omnitron/dto/services';
import { useAccess } from 'src/auth/access';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { releaseApi } from 'src/netron/release-wire';
import { OperationStatus } from './operation-status';
import { LaunchEvidence, RecordedDeployment, useCanReadDeploymentHistory } from './release-deployment-state';

/** The detail page already owns the live stack observation. Only its journal needs a separate read. */
export function StackReleaseCard({ project, stack }: { project: string; stack: IStackInfo }) {
  const { can } = useAccess();
  const permitted = useCanReadDeploymentHistory();
  const trail = usePolledResource(() => releaseApi.deployments(), {
    intervalMs: 20_000, enabled: permitted, resourceKey: JSON.stringify([project, stack.name, permitted]),
  });
  const history = permitted && trail.data ? stackDeploymentHistory(project, stack, trail.data) : null;
  return <Card component="section" aria-label="Release and deployment evidence" variant="outlined">
    <CardContent sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' } }}>
      <Stack spacing={0.75} sx={{ minWidth: 0, alignItems: 'flex-start', overflowWrap: 'anywhere' }}>
        <Typography component="h2" variant="subtitle1">Launch release</Typography>
        <LaunchEvidence project={project} stack={stack.name} row={readStackRelease(stack)} />
      </Stack>
      <Box>
        <Typography component="h2" variant="subtitle1" sx={{ mb: 0.75 }}>Last recorded deployment</Typography>
        {!permitted ? <Typography variant="body2" color="text.secondary">Deployment history is unavailable with your permissions.</Typography>
          : <Stack spacing={0.75}>
            <OperationStatus active={trail.loading && !history} label="Reading deployment history" />
            {trail.error && <Alert severity="warning">{trail.error}{history && ' Showing the last observation.'}</Alert>}
            {history && <RecordedDeployment history={history} />}
          </Stack>}
        {can('OmnitronAudit.available') && can('OmnitronAudit.list') &&
          <Button component={RouterLink} to="/audit" size="small" sx={{ mt: 1 }}>Open controller audit</Button>}
      </Box>
    </CardContent>
  </Card>;
}
