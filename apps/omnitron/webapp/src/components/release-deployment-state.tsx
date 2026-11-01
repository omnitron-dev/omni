import { Link as RouterLink, useLocation } from 'react-router-dom';
import { Box, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { readReleaseDeploymentState } from '@omnitron-dev/omnitron/release-reading';
import { RefreshIcon } from 'src/assets/icons';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { releaseApi } from 'src/netron/release-wire';
import { useProjectStore } from 'src/stores/project.store';
import { OperationStatus } from './operation-status';
import { when } from './release-bits';

/** Remount on project changes so a late answer never labels another workspace. */
export function ReleaseDeploymentState({ project, stack }: { project: string; stack?: string }) {
  const location = useLocation();
  const { data, loading, error, refresh } = usePolledResource(() => readReleaseDeploymentState(project, {
    stacks: async () => {
      const value = await useProjectStore.getState().fetchStacks(project);
      if (!value) throw new Error('Stack inventory unavailable');
      return value;
    },
    deployments: () => releaseApi.deployments(),
  }), { intervalMs: 20_000 });
  const rows = data?.stacks.filter(row => !stack || row.stack === stack) ?? [];
  return <Box component="section" aria-label="Deployment state" sx={{ minWidth: 0 }}>
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
      <Typography variant="subtitle2" sx={{ flex: 1 }}>Deployment state</Typography>
      {data && <Typography variant="caption" color="text.secondary">Observed {when(data.observedAt)}</Typography>}
      <Tooltip title="Refresh deployment state"><span><IconButton size="small" aria-label="Refresh deployment state" disabled={loading} onClick={() => void refresh()}><RefreshIcon /></IconButton></span></Tooltip>
    </Stack>
    <OperationStatus active={loading && !data} label="Reading stack state and deployment history…" />
    {error && <Alert severity="warning">Cannot refresh deployment state. Any values below are the last observation.</Alert>}
    {data && !data.inventory.known && <Alert severity="warning">{data.inventory.why}</Alert>}
    {data?.inventory.known && rows.length === 0 && <Typography variant="body2" color="text.secondary">{stack ? 'This stack is no longer in the project inventory.' : 'No stacks configured for this project.'}</Typography>}
    {rows.map(row => <Box key={row.stack} sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(140px, .7fr) minmax(180px, 1fr) minmax(0, 1.3fr)' },
      gap: { xs: 1, md: 2 }, py: 1.5, borderBottom: 1, borderColor: 'divider', overflowWrap: 'anywhere' }}>
      <Stack spacing={0.5} sx={{ minWidth: 0 }}>
        <Typography component={RouterLink} to={`/stacks/${encodeURIComponent(row.stack)}`} variant="body2"
          onClick={() => { const store = useProjectStore.getState(); store.selectProject(project, location.pathname); store.selectStack(row.stack); }}
          sx={{ color: 'primary.main', textDecoration: 'none', fontWeight: 600 }}>{row.stack}</Typography>
        <Typography variant="caption" color="text.secondary">{row.type === 'local' ? 'Controller node' : row.type === 'cluster' ? 'Distributed stack' : 'Remote stack'}</Typography>
        {row.type !== 'local' && row.nodes.map(node => <Typography key={`${node.host}:${node.port}`} variant="caption" color={node.connected && !error ? 'text.secondary' : 'warning.main'}>
          {node.label ? `${node.label} · ` : ''}{node.endpoint} · {error ? 'last observed' : node.connected ? 'reachable' : 'unreachable'}
        </Typography>)}
      </Stack>
      <Stack spacing={0.5} sx={{ minWidth: 0, alignItems: 'flex-start' }}>
        <Stack direction="row" useFlexGap spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip size="small" variant="outlined" label={row.status} color={!error && row.status === 'running' ? 'success' : row.status === 'stopped' ? 'default' : 'warning'} />
          <Typography variant="body2">Apps {row.apps.online}/{row.apps.total}{row.apps.unknown ? ` · ${row.apps.unknown} unknown` : ''}</Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary">{row.runningRelease === 'not-running' ? 'No applications running' : 'Current release not reported'}</Typography>
      </Stack>
      <Stack spacing={0.5} sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary">Last recorded deployment</Typography>
        {!row.history.known ? <Typography variant="body2" color="warning.main">{row.history.why}</Typography>
          : !row.history.last ? <Typography variant="body2" color="text.secondary">No deployment record</Typography>
            : <>
              {row.history.last.release ? <Typography component={RouterLink} to={`/releases/${encodeURIComponent(row.history.last.release)}`} variant="body2" sx={{ color: 'text.primary', textDecoration: 'none', fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{row.history.last.release}</Typography>
                : <Typography variant="body2">{row.history.last.releaseUnnamed ? 'Release name not recorded' : 'Working tree'}</Typography>}
              <Typography variant="caption" color="text.secondary">{when(row.history.last.at)} · {row.history.last.source ?? 'source not recorded'}</Typography>
            </>}
      </Stack>
    </Box>)}
    {rows.length > 0 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pt: 1 }}>Deployment history does not verify the build currently running on a node.</Typography>}
  </Box>;
}
