import { Box, Button, Stack, Typography } from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { useAsync } from '@omnitron-dev/prism/hooks';
import type { IProjectRpcService } from '@omnitron-dev/omnitron/dto/services';
import { daemonClient } from 'src/netron/client';
import { OperationStatus } from './operation-status';

type Readings = Awaited<ReturnType<IProjectRpcService['inspectStackHost']>>;

export function StackHostReadiness({ project, stack }: { project: string; stack: string }) {
  const { data, loading, error, execute } = useAsync(() =>
    daemonClient.invoke<Readings>('daemon', 'OmnitronProject', 'inspectStackHost', [{ project, stack }], {
      timeout: 120_000,
    })
  );
  return (
    <Stack spacing={1} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
      <Button
        size="small"
        sx={{ alignSelf: 'flex-start' }}
        disabled={loading}
        onClick={() => void execute().catch(() => undefined)}
      >
        {data ? 'Inspect hosts again' : 'Inspect hosts'}
      </Button>
      <OperationStatus
        active={loading}
        label="Inspecting target nodes"
        detail="Reading host services and local package indices"
      />
      {error && (
        <Alert severity="error">
          {error.message}
          {data && ' The previous host readings below are stale.'}
        </Alert>
      )}
      {data?.length === 0 && <Alert severity="warning">No target node returned a reading.</Alert>}
      {data?.map(({ node, inspection, error: nodeError }) => (
        <Box key={node} sx={{ borderTop: 1, borderColor: 'divider', pt: 1 }}>
          <Typography variant="subtitle2">{node}</Typography>
          {nodeError || !inspection ? (
            <Alert severity="warning">{nodeError || 'Host inspection unavailable.'}</Alert>
          ) : (
            <>
              {!inspection.services.length && <Typography variant="body2">No host services reported.</Typography>}
              {inspection.services.map(({ name, onHost, external }) => {
                const probe = onHost?.probe ?? external?.probe;
                const state = external
                  ? external.reachable
                    ? 'reachable'
                    : 'unreachable'
                  : (onHost?.unit?.state ?? 'no unit reported');
                return (
                  <Box key={name} sx={{ py: 0.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {name} · {state}
                    </Typography>
                    {onHost?.packages?.map((pkg) => (
                      <Typography
                        key={pkg.name}
                        variant="body2"
                        color={pkg.state === 'blocked' ? 'error.main' : 'text.secondary'}
                      >
                        {pkg.name} · installed {pkg.installed ?? '—'} · candidate {pkg.candidate ?? '—'} · {pkg.state} ·{' '}
                        {pkg.detail}
                      </Typography>
                    ))}
                    {onHost && !onHost.packages?.length && (
                      <Typography variant="caption" color="text.secondary">
                        No package version evidence reported.
                      </Typography>
                    )}
                    {probe && (
                      <Typography variant="body2">
                        {probe.ok ? 'Service probe passed' : (probe.error ?? 'Service probe failed')}
                      </Typography>
                    )}
                    {onHost?.actions.map((action) => (
                      <Typography key={action} variant="body2">
                        Would {action}
                      </Typography>
                    ))}
                    {onHost?.refusals.map((reason) => (
                      <Typography key={reason} variant="body2" color="error.main">
                        {reason}
                      </Typography>
                    ))}
                  </Box>
                );
              })}
            </>
          )}
        </Box>
      ))}
    </Stack>
  );
}
