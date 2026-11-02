import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Collapse from '@mui/material/Collapse';

import { RefreshIcon } from 'src/assets/icons';
import { AdminDataTable, type ColumnDef } from '@omnitron-dev/prism/components/admin-filters';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { Tabs } from '@omnitron-dev/prism/components/tabs';
import { Breadcrumbs } from 'src/components/page-breadcrumbs';
import { deploy, project } from 'src/netron/client';
import { releaseApi } from 'src/netron/release-wire';
import { DeployProgressList } from 'src/components/deploy-progress';
import { formatDate, formatDuration } from 'src/utils/formatters';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { useStackContext } from 'src/hooks/use-stack-context';
import { useAccess } from 'src/auth/access';
import { useProjectStore } from 'src/stores/project.store';
import { readDeploymentProgress } from '@omnitron-dev/omnitron/release-reading';
import type { DeploymentRecord, ReleaseDeploymentDto } from '@omnitron-dev/omnitron/dto/services';

const HISTORY_LIMIT = 200;

/** Observation and recorded operations are separate from artifact selection and runtime identity. */
export default function DeploymentsPage() {
  const { activeProject, activeStack } = useStackContext();
  return <DeploymentWorkspace key={JSON.stringify([activeProject, activeStack])} />;
}

function DeploymentWorkspace() {
  const { activeProject, activeStack, matchesNamespace, extractStack } = useStackContext();
  const info = useProjectStore(s => s.projects.find(p => p.name === activeProject));
  const { can } = useAccess();
  const canHistory = can('OmnitronRelease.deployments');
  const canLegacy = can('OmnitronDeploy.getHistory');
  const canProgress = can('OmnitronProject.getDeployProgress');
  const [preferredSection, setSection] = useState('stacks');
  const section = canHistory && (preferredSection === 'stacks' || !canLegacy) ? 'stacks' : canLegacy ? 'legacy' : null;
  const [showUnscoped, setShowUnscoped] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const history = usePolledResource(async () => {
    if (!can('OmnitronAudit.available')) throw new Error('Checking recorded stack starts requires access to audit availability.');
    const answer = await releaseApi.deployments();
    if (!answer.known) throw new Error(answer.why);
    return answer;
  }, { intervalMs: 15_000, enabled: section === 'stacks' });
  const legacy = usePolledResource(() => deploy.getHistory({ limit: HISTORY_LIMIT }), { intervalMs: 15_000, enabled: section === 'legacy' });
  const progress = usePolledResource(() => project.getDeployProgress(activeProject ? {
    project: activeProject, ...(activeStack && { stack: activeStack }),
  } : undefined), { intervalMs: 3_000, enabled: canProgress, resourceKey: JSON.stringify([activeProject, activeStack, canProgress]) });

  const starts = (history.data?.known ? history.data.deployments : [])
    .filter(row => matchesNamespace(`${row.project}/${row.stack}/_`))
    .sort((a, b) => b.at.localeCompare(a.at));
  const appRows = (legacy.data ?? []).filter(row => matchesNamespace(row.app));
  const records = canProgress ? progress.data ?? [] : [];
  const { transfers, unscoped } = activeProject
    ? readDeploymentProgress(records, info ?? { name: activeProject }, activeStack)
    : { transfers: records, unscoped: [] };
  const visibleCount = section === 'stacks' ? starts.length : appRows.length;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visibleCount / pageSize) - 1));
  const historyError = history.error;
  const refresh = async () => {
    setRefreshing(true);
    try { await Promise.all([section === 'stacks' && history.refresh(), section === 'legacy' && legacy.refresh(), canProgress && progress.refresh()]); }
    finally { setRefreshing(false); }
  };
  const changePageSize = (size: number) => { setPageSize(size); setPage(0); };

  const stackColumns: ColumnDef<ReleaseDeploymentDto>[] = [
    { key: 'stack', header: 'Stack', render: row => {
      const name = extractStack(`${row.project}/${row.stack}/_`) ?? row.stack;
      return activeProject && can('OmnitronProject.getStack')
        ? <Stack><Link component={RouterLink} to={`/stacks/${encodeURIComponent(name)}`}>{name}</Link>
          {(row.project !== activeProject || row.stack !== name) && <Typography variant="caption" color="text.secondary">{row.project}/{row.stack}</Typography>}</Stack>
        : <Typography variant="body2">{row.project}/{row.stack}</Typography>;
    } },
    { key: 'release', header: 'Recorded source', render: row => row.release
      ? can('OmnitronRelease.get') ? <Link component={RouterLink} to={`/releases/${encodeURIComponent(row.release)}`} sx={{ overflowWrap: 'anywhere' }}>{row.release}</Link> : row.release
      : <Typography variant="body2">{row.releaseUnnamed ? 'Release identity missing from record' : 'Working tree / source not recorded'}</Typography> },
    { key: 'at', header: 'Recorded at', render: row => formatDate(row.at) },
    { key: 'source', header: 'Trigger', render: row => row.source ?? 'Not recorded' },
    { key: 'actorId', header: 'Actor', render: row => <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>{row.actorId ?? 'Not recorded'}</Typography> },
  ];
  const appColumns: ColumnDef<DeploymentRecord>[] = [
    { key: 'app', header: 'Application', render: row => <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{row.app}</Typography> },
    { key: 'version', header: 'Requested label', render: row => <Typography variant="caption" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{row.version}</Typography> },
    { key: 'strategy', header: 'Requested strategy', render: row => row.strategy },
    { key: 'status', header: 'Recorded outcome', render: row => <Chip size="small" variant="outlined" label={row.status} /> },
    { key: 'startedAt', header: 'Started', render: row => formatDate(row.startedAt) },
    { key: 'duration', header: 'Duration', render: row => {
      const duration = row.completedAt ? Date.parse(row.completedAt) - Date.parse(row.startedAt) : NaN;
      return Number.isFinite(duration) && duration >= 0 ? formatDuration(duration) : 'Not recorded';
    } },
    { key: 'deployedBy', header: 'Recorded actor', render: row => row.deployedBy ?? 'Not recorded' },
  ];

  return <Stack spacing={2} sx={{ minWidth: 0 }}>
    <Breadcrumbs links={[{ name: 'Deployments' }]} action={<Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
      <IconButton data-console-command="refresh" aria-label="Refresh deployments" size="small" onClick={refresh} disabled={refreshing} aria-busy={refreshing}><RefreshIcon /></IconButton>
      {can('OmnitronProject.listStacks') && <Button component={RouterLink} to="/stacks" size="small">Stacks</Button>}
      {can('OmnitronRelease.list') && <Button component={RouterLink} to="/releases" size="small" variant="outlined">{can('OmnitronProject.startStack') ? 'Deploy a release' : 'Releases'}</Button>}
    </Stack>} />
    {canProgress && progress.error && <Alert severity="warning" variant="outlined">Transfer observations unavailable: {progress.error}. Retained observations may be stale.</Alert>}
    {canProgress && progress.loading && <Typography role="status" variant="caption">Reading transfer observations…</Typography>}
    {canProgress && !progress.loading && !progress.error && transfers.length === 0 && <Typography role="status" variant="caption" color="text.secondary">No attributed transfer observations for this workspace.</Typography>}
    <DeployProgressList records={transfers} unavailable={Boolean(progress.error)} />
    {unscoped.length > 0 && <>
      <Button size="small" onClick={() => setShowUnscoped(value => !value)} aria-expanded={showUnscoped} aria-controls="unscoped-transfers" sx={{ alignSelf: 'flex-start' }}>
        {showUnscoped ? 'Hide' : 'Show'} unscoped observations · {unscoped.length}
      </Button>
      <Collapse id="unscoped-transfers" in={showUnscoped} unmountOnExit>
        <Typography variant="caption" color="text.secondary">These controller reports have no recorded project or stack.</Typography>
        <DeployProgressList records={unscoped} unavailable={Boolean(progress.error)} />
      </Collapse>
    </>}
    {canHistory && canLegacy && <Tabs value={section ?? 'stacks'} onChange={value => { setSection(value); setPage(0); }} aria-label="Deployment records" tabs={[
      { value: 'stacks', label: history.data && !history.error ? `Stack starts · ${starts.length}` : 'Stack starts' },
      { value: 'legacy', label: legacy.data && !legacy.error ? `App history · ${appRows.length}` : 'App history' },
    ]} />}
    {section === 'stacks' ? <>
      <Typography variant="caption" color="text.secondary">Latest recorded start per stack namespace. {can('OmnitronAudit.list') && <>Full event history is in <Link component={RouterLink} to="/audit">Audit</Link>.</>}</Typography>
      <AdminDataTable<ReleaseDeploymentDto> minWidth={600} scrollLabel="Recorded stack starts" columns={stackColumns}
        data={starts.slice(currentPage * pageSize, (currentPage + 1) * pageSize)} total={starts.length} loading={history.loading}
        loadError={historyError} emptyMessage="No stack start recorded for this workspace" rowKey={row => `${row.project}/${row.stack}`}
        page={currentPage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={changePageSize} dense />
    </> : section === 'legacy' && <>
      <Typography variant="caption" color="text.secondary">Retained records from the retired per-app path. Its version labels and success statuses do not prove an artifact was installed. The latest {HISTORY_LIMIT} controller records are filtered to this workspace.</Typography>
      <AdminDataTable<DeploymentRecord> minWidth={680} scrollLabel="Legacy application operation records" columns={appColumns}
        data={appRows.slice(currentPage * pageSize, (currentPage + 1) * pageSize)} total={appRows.length} loading={legacy.loading}
        loadError={legacy.error} emptyMessage="No legacy app operation in this history window" rowKey={row => row.id}
        page={currentPage} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={changePageSize} dense />
    </>}
  </Stack>;
}
