import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  IconButton, Stack, Typography } from '@mui/material';
import { Alert, FormAlert } from '@omnitron-dev/prism/components/alert';
import { PageContent } from '@omnitron-dev/prism/components/page-content';
import { Tabs } from '@omnitron-dev/prism/components/tabs';
import { DeleteIcon, DeployIcon, RefreshIcon } from 'src/assets/icons';
import { Can, useAccess } from 'src/auth/access';
import { DeployReleaseDialog } from 'src/components/deploy-release-dialog';
import { OperationStatus } from 'src/components/operation-status';
import { Breadcrumbs } from 'src/components/page-breadcrumbs';
import { StackDiagnosisDialog } from 'src/components/stack-diagnosis-dialog';
import { StackLifecycleActions } from 'src/components/stack-lifecycle-actions';
import { hasInstalledRecovery, StackResumeNotice } from 'src/components/stack-recovery';
import { StackReleaseCard } from 'src/components/stack-release-card';
import { StackStartNotice } from 'src/components/stack-start-notice';
import { StackStopDialog } from 'src/components/stack-stop-dialog';
import { StackStopNotice } from 'src/components/stack-stop-notice';
import { usePollingEffect } from 'src/hooks/use-polled-resource';
import { useProjectStore, useActiveProject, useActiveProjectStacks } from 'src/stores/project.store';
import { RuntimeSummary, StackRuntime } from './runtime';

type DialogName = 'delete' | 'stop' | 'diagnose' | 'deploy' | 'working-tree';

export default function StackDetailPage() {
  const { name } = useParams<{ name: string }>();
  const activeProject = useActiveProject();
  return <StackDetail key={JSON.stringify([activeProject, name])} name={name} project={activeProject} />;
}

function StackDetail({ name, project }: { name: string | undefined; project: string | null }) {
  const navigate = useNavigate();
  const { can } = useAccess();
  const stacks = useActiveProjectStacks();
  const known = useProjectStore(state => Boolean(project && state.stacksByProject[project]));
  const readError = useProjectStore(state => project ? state.stackReadErrors[project] : null);
  const fetchStacks = useProjectStore(state => state.fetchStacks);
  const startStack = useProjectStore(state => state.startStack);
  const stopStack = useProjectStore(state => state.stopStack);
  const deleteStack = useProjectStore(state => state.deleteStack);
  const resumeInstalled = useProjectStore(state => state.resumeInstalledStack);
  const key = `${project}/${name}`;
  const notice = useProjectStore(state => state.stackNotices[key]);
  const clearNotice = useProjectStore(state => state.clearStackNotice);
  const pending = useProjectStore(state => state.pendingOps[key] ?? null);
  const [dialog, setDialog] = useState<DialogName | null>(null);

  usePollingEffect(() => { if (project) void fetchStacks(project); }, {
    intervalMs: pending ? 3_000 : 10_000, enabled: Boolean(project), resourceKey: project,
  });

  const stack = stacks.find(item => item.name === name);
  const refresh = () => { if (project) void fetchStacks(project); };
  const tools = <Breadcrumbs links={[{ name: 'Stacks', href: '/stacks' }, { name: name ?? 'Stack' }]}
    action={<Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      {stack && <Can permission="OmnitronProject.diagnoseStack"><Button size="small" variant="outlined"
        onClick={() => setDialog('diagnose')}>Check start prerequisites</Button></Can>}
      {project && <IconButton data-console-command="refresh" size="small" aria-label="Refresh stack" title="Refresh stack" onClick={refresh}><RefreshIcon /></IconButton>}
    </Stack>} />;

  if (!project || !stack) return <PageContent>{tools}
    {!project ? <Alert severity="info">Select a project to view this stack.</Alert>
      : readError ? <Alert severity="error">Stack inventory unavailable · {readError} <Button onClick={refresh}>Retry</Button></Alert>
      : !known ? <OperationStatus active label="Reading stack inventory" />
      : <Alert severity="warning">Stack “{name}” was not found in {project}. <Button onClick={() => navigate('/stacks')}>Back to stacks</Button></Alert>}
  </PageContent>;

  const close = () => setDialog(null);
  const isStopped = stack.status === 'stopped';
  const busy = Boolean(pending) || stack.status === 'starting' || stack.status === 'stopping';
  const canChange = can('OmnitronProject.startStack') || can('OmnitronProject.reviewStackStop') ||
    can('OmnitronProject.resumeInstalledStack') || can('OmnitronProject.deleteStack');
  const requiresRelease = stack.config?.release?.mode === 'required';
  const owner = stack.config?.managedOrigin;
  const primaryDeploy = isStopped && requiresRelease && !stack.selectedRelease && !hasInstalledRecovery(stack);
  const canSelectSource = !owner && !busy && can('OmnitronProject.startStack');
  const canUseTree = canSelectSource && Boolean(stack.selectedRelease) && isStopped && !requiresRelease;
  const canDelete = can('OmnitronProject.deleteStack') && isStopped && !busy;
  const activeStop = stack.stopOperation && !stack.stopOperation.supersededAt && stack.stopOperation.phase !== 'stopped';
  const activeResume = stack.resumeOperation && stack.resumeOperation.outcome !== 'running' &&
    !stack.stopOperation?.supersededAt && stack.stopOperation?.id === stack.resumeOperation.stopOperationId;
  const historyStop = stack.stopOperation && !activeStop;
  const historyResume = stack.resumeOperation && !activeResume;

  const configuration = <Card component="section" aria-label="Stack configuration" variant="outlined">
    <CardContent>
      <Typography component="h2" variant="subtitle1">Start configuration</Typography>
      <Box component="dl" sx={{ my: 1.5, display: 'grid', gridTemplateColumns: 'minmax(7em, auto) minmax(0, 1fr)',
        gap: 1.25, typography: 'body2', '& dt': { color: 'text.secondary' }, '& dd': { m: 0, overflowWrap: 'anywhere' } }}>
        {owner && <><dt>Managed by</dt><dd>{owner.project}/{owner.stack}</dd></>}
        <dt>Release policy</dt><dd>{requiresRelease ? 'Required' : 'Optional'}</dd>
        {stack.selectedRelease && <><dt>Selected release</dt><dd>{stack.selectedRelease.id}</dd></>}
        <dt>Infrastructure at start</dt><dd>{stack.infrastructureMode === 'preserve' ? 'Preserve existing infrastructure'
          : stack.infrastructureMode === 'reconcile' ? 'Reconcile infrastructure' : 'Not reported'}</dd>
        {stack.portRange && <><dt>Port range</dt><dd>{stack.portRange.start}–{stack.portRange.end}</dd></>}
      </Box>
      <Stack role="group" aria-label="Stack actions" direction="row" useFlexGap sx={{ gap: 1, pt: 1.5,
        flexWrap: 'wrap', borderTop: 1, borderColor: 'divider', '&:empty': { display: 'none' } }}>
        <StackLifecycleActions detailed stack={stack} pending={pending}
          onStart={() => void startStack(project, stack.name)} onDeploy={() => setDialog('deploy')}
          onResume={() => void resumeInstalled(project, stack.name)} onReviewStop={() => setDialog('stop')} />
        {canSelectSource && !primaryDeploy && <Button size="small" startIcon={<DeployIcon />} onClick={() => setDialog('deploy')}>Deploy release…</Button>}
        {canUseTree && <Button size="small" onClick={() => setDialog('working-tree')}>Use working tree…</Button>}
        {canDelete && <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => setDialog('delete')}>Delete stack…</Button>}
      </Stack>
    </CardContent>
  </Card>;

  return <PageContent gap={2} sx={{ minWidth: 0 }}>
    {tools}
    {readError && <Alert severity="warning">Showing the last stack inventory · {readError}</Alert>}
    {notice && notice !== readError && <FormAlert onClose={() => clearNotice(key)}>{notice}</FormAlert>}
    <StackStartNotice stack={stack} />
    {activeStop && <StackStopNotice operation={stack.stopOperation} />}
    {activeResume && <StackResumeNotice stack={stack} />}
    {pending && !activeStop && <OperationStatus active label={pending === 'starting' ? 'Starting stack' :
      pending === 'resuming' ? 'Resuming installed applications' : 'Stopping stack'} />}
    <RuntimeSummary stack={stack} />
    <Tabs defaultValue="runtime" variant="scrollable" scrollButtons="auto" aria-label="Stack details" tabs={[
      { value: 'runtime', label: 'Runtime', content: <StackRuntime stack={stack} /> },
      { value: 'history', label: 'Releases & history', content: <Stack spacing={2}>
        <StackReleaseCard project={project} stack={stack} />
        {(historyStop || historyResume) && <Card component="section" aria-label="Operation receipts" variant="outlined">
          <CardContent><Typography component="h2" variant="subtitle1" sx={{ mb: 1 }}>Operation receipts</Typography>
            {historyStop && <StackStopNotice operation={stack.stopOperation} />}
            {historyResume && <StackResumeNotice stack={stack} />}
          </CardContent>
        </Card>}
      </Stack> },
      { value: 'configuration', label: canChange ? 'Configuration & actions' : 'Configuration', content: configuration },
    ]} />

    {dialog === 'diagnose' && can('OmnitronProject.diagnoseStack') &&
      <StackDiagnosisDialog project={project} stack={stack.name} onClose={close} />}
    {dialog === 'stop' && can('OmnitronProject.reviewStackStop') && <StackStopDialog project={project} stack={stack.name}
      onClose={close} onConfirm={(digest, keepInfrastructure) => {
        close();
        void stopStack(project, stack.name, digest, keepInfrastructure);
      }} />}
    {dialog === 'deploy' && can('OmnitronProject.startStack') &&
      <DeployReleaseDialog open project={project} stack={stack.name} release={null} onClose={close} />}
    <Dialog open={dialog === 'working-tree' && can('OmnitronProject.startStack')} onClose={close} aria-labelledby="working-tree-title">
      <DialogTitle id="working-tree-title">Start from the working tree?</DialogTitle>
      <DialogContent><DialogContentText>
        {project}/{stack.name} will start from its registered project directory. Future restarts will use that directory until you select a release.
      </DialogContentText></DialogContent>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button variant="contained" disabled={!canUseTree} onClick={() => {
          close();
          void startStack(project, stack.name, { workingTree: true });
        }}>Start from working tree</Button>
      </DialogActions>
    </Dialog>
    <Dialog open={dialog === 'delete' && can('OmnitronProject.deleteStack')} onClose={close} aria-labelledby="delete-stack-title">
      <DialogTitle id="delete-stack-title">Delete stack {stack.name}?</DialogTitle>
      <DialogContent><DialogContentText>
        This permanently removes the stack and its infrastructure configuration from {project}.
      </DialogContentText></DialogContent>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button variant="contained" color="error" disabled={!canDelete} onClick={async () => {
          try {
            await deleteStack(project, stack.name);
            navigate('/stacks');
          } catch { /* The store supplies the scoped failure notice. */ }
          close();
        }}>Delete stack</Button>
      </DialogActions>
    </Dialog>
  </PageContent>;
}
