import { Link as RouterLink, useLocation } from 'react-router-dom';
import { Box, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { readReleaseDeploymentState, runningReleaseLabel, type ReleaseStackObservation, type StackDeploymentHistory } from '@omnitron-dev/omnitron/release-reading';
import { Can, useAccess } from 'src/auth/access';
import { RefreshIcon } from 'src/assets/icons';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { releaseApi } from 'src/netron/release-wire';
import { useProjectStore } from 'src/stores/project.store';
import { OperationStatus } from './operation-status';
import { when } from './release-bits';
import { InstalledFilesInspection } from './installed-files-inspection';

/** Remount on project changes so a late answer never labels another workspace. */
export function ReleaseDeploymentState({ project, stack }: { project: string; stack?: string }) {
  const location = useLocation();
  const canReadHistory = useCanReadDeploymentHistory();
  const { data, loading, error, refresh } = usePolledResource(() => readReleaseDeploymentState(project, {
    stacks: async () => {
      const value = await useProjectStore.getState().fetchStacks(project);
      if (!value) throw new Error('Stack inventory unavailable');
      return value;
    },
    deployments: async () => canReadHistory ? releaseApi.deployments() : { known: false, why: 'Deployment history is unavailable with your permissions.' },
  }), { intervalMs: 20_000, resourceKey: JSON.stringify([project, canReadHistory]) });
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
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const store = useProjectStore.getState();
            if (store.activeProject !== project) store.selectProject(project, location.pathname);
          }}
          sx={{ color: 'primary.main', textDecoration: 'none', fontWeight: 600 }}>{row.stack}</Typography>
        <Typography variant="caption" color="text.secondary">{row.type === 'local' ? 'Controller node' : row.type === 'cluster' ? 'Distributed stack' : 'Remote stack'}</Typography>
        {row.type !== 'local' && row.nodes.map(node => <Typography key={`${node.host}:${node.port}`} variant="caption" color={node.connected && !error ? 'text.secondary' : 'warning.main'}>
          {node.label ? `${node.label} · ` : ''}{node.endpoint} · {error ? 'last observed' : node.connected ? 'inventory observed' : 'inventory unavailable'}
        </Typography>)}
      </Stack>
      <Stack spacing={0.5} sx={{ minWidth: 0, alignItems: 'flex-start' }}>
        <Stack direction="row" useFlexGap spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip size="small" variant="outlined" label={row.status} color={!error && row.status === 'running' ? 'success' : row.status === 'stopped' ? 'default' : 'warning'} />
          <Typography variant="body2">Apps {row.apps.online}/{row.apps.total}{row.apps.unknown ? ` · ${row.apps.unknown} unknown` : ''}</Typography>
        </Stack>
        <LaunchEvidence project={project} stack={row.stack} row={row} />
      </Stack>
      <Stack spacing={0.5} sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary">Last recorded deployment</Typography>
        <RecordedDeployment history={row.history} />
      </Stack>
    </Box>)}
    {rows.length > 0 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pt: 1 }}>Verified launch receipts identify the admitted release, not continuous in-memory code integrity. Deployment history is a separate record.</Typography>}
  </Box>;
}

/** The release history reader consults both the audit journal and the deployment service. */
export function useCanReadDeploymentHistory() {
  const { can } = useAccess();
  return can('OmnitronAudit.available') && can('OmnitronRelease.deployments');
}

function ReleaseName({ id }: { id: string }) {
  const { can } = useAccess();
  const sx = { fontFamily: 'monospace', overflowWrap: 'anywhere' } as const;
  return can('OmnitronRelease.get') && can('OmnitronRelease.list')
    ? <Typography component={RouterLink} to={`/releases/${encodeURIComponent(id)}`} variant="body2" sx={{ ...sx, color: 'primary.main' }}>{id}</Typography>
    : <Typography component="span" variant="body2" sx={sx}>{id}</Typography>;
}

export function LaunchEvidence({ project, stack, row }: { project: string; stack: string;
  row: Pick<ReleaseStackObservation, 'runningRelease' | 'releaseEvidence'> }) {
  return <>
    <Typography variant="caption" color={row.runningRelease === 'confirmed' || row.runningRelease === 'not-running' ? 'text.secondary' : 'warning.main'}>{runningReleaseLabel(row)}</Typography>
    {row.releaseEvidence.releases.map(release => <Tooltip describeChild key={`${release.releaseId}:${release.manifestSha256}`} title={`Manifest SHA-256: ${release.manifestSha256}`}>
      <Box component="span"><ReleaseName id={release.releaseId} /></Box>
    </Tooltip>)}
    {row.releaseEvidence.total > 0 && <Box component="details" sx={{ minWidth: 0, width: 1 }}>
      <Typography component="summary" variant="caption" sx={{ cursor: 'pointer', color: 'text.secondary' }}>{row.releaseEvidence.verified}/{row.releaseEvidence.total} launch identities verified</Typography>
      <Stack spacing={0.75} sx={{ pt: 0.75 }}>
        {row.releaseEvidence.observations.map((observation, index) => <Box key={`${observation.node}:${observation.app}:${index}`}>
          <Typography variant="caption" component="div">{observation.node ? `${observation.node} / ` : ''}{observation.app} · {observation.state}{observation.releaseId ? ` · ${observation.releaseId}` : ''}</Typography>
          {observation.consumer && observation.consumer.releaseId !== observation.releaseId && <Typography variant="caption" color="text.secondary" component="div" sx={{ overflowWrap: 'anywhere' }}>Producer {observation.releaseId} · selected consumer {observation.consumer.releaseId}</Typography>}
          {observation.reason && <Typography variant="caption" color="warning.main" component="div">{observation.reason}</Typography>}
          {observation.observedAt && <Typography variant="caption" color="text.secondary" component="div">Launch verified {when(observation.observedAt)}</Typography>}
        </Box>)}
      </Stack>
    </Box>}
    <Can permission="OmnitronProject.inspectInstalledArtifacts"><InstalledFilesInspection key={`${project}:${stack}`} project={project} stack={stack} /></Can>
  </>;
}

export function RecordedDeployment({ history }: { history: StackDeploymentHistory }) {
  return <>
    {!history.known ? <Typography variant="body2" color="warning.main">{history.why}</Typography>
      : !history.last ? <Typography variant="body2" color="text.secondary">No deployment record</Typography>
        : <>
          {history.last.release ? <ReleaseName id={history.last.release} />
            : <Typography variant="body2">{history.last.releaseUnnamed ? 'Release name not recorded' : 'Working tree'}</Typography>}
          <Typography variant="caption" color="text.secondary">{when(history.last.at)} · {history.last.source ?? 'source not recorded'}</Typography>
        </>}
  </>;
}
