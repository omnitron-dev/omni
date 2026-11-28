import { useState, type ReactNode } from 'react';
import { Box, Button, Chip, LinearProgress, Link, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { Tabs } from '@omnitron-dev/prism/components/tabs';
import { Alert } from '@omnitron-dev/prism/components/alert';
import type {
  BuildRecord, DeployProgressRecord, IProjectRpcService, IStackInfo, NodeFileTransfer, PipelineRunSummary,
} from '@omnitron-dev/omnitron/dto/services';
import { useAccess } from 'src/auth/access';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { pipelines, project as projectRpc } from 'src/netron/client';
import { pipelineRunHref, workspaceHref } from 'src/routes/workspace';
import { formatDate, formatDuration } from 'src/utils/formatters';
import { DeployProgressList } from './deploy-progress';
import { LaunchAttempts, LaunchLogs } from './deployment-launch-journal';
import { fileTransferProgress } from './files/transfer-progress';
import { LiveLogOutput } from './live-log-output';
import { PipelineRunDetail } from './pipeline-run-detail';
import { ReleaseBuildPanel } from './release-build-panel';

type Preparation = Awaited<ReturnType<IProjectRpcService['listRemoteReleasePreparations']>>[number];
type Checkpoint = NonNullable<IStackInfo['deploymentOperation']>;
type Activity = {
  project: string; stack: string; nodeLabel?: string; releaseId?: string;
  build?: BuildRecord; producer?: PipelineRunSummary; rehearsal?: PipelineRunSummary;
  transfer?: NodeFileTransfer; preparation?: Preparation; operation?: Checkpoint;
  confirmation?: IStackInfo['launchConfirmation']; runtime?: IStackInfo; runtimeUnavailable?: boolean;
  progress?: readonly DeployProgressRecord[]; observationError?: string;
};

const launchPhase: Record<Checkpoint['phase'], string> = {
  stopping: 'Stopping previous release', stopped: 'Previous release stopped',
  selecting: 'Selecting release', selected: 'Release selected', starting: 'Starting applications', confirmed: 'Launch confirmed',
};

const statusLabel: Record<string, string> = {
  prepared: 'Ready', refused: 'Blocked', checking: 'Checking', completed: 'Complete',
  success: 'Passed', running: 'Running', pending: 'Pending', queued: 'Queued', failed: 'Failed',
  interrupted: 'Interrupted', cancelled: 'Cancelled', 'awaiting-review': 'Awaiting review',
  ...launchPhase,
};
const labelStatus = (status: string) => Object.hasOwn(statusLabel, status) ? statusLabel[status] : status;

function RunJournal({ id, summary, complete, onPause }: { id: string; summary?: PipelineRunSummary; complete?: boolean; onPause: () => void }) {
  const { can } = useAccess();
  const allowed = can('OmnitronPipelines.getRunStatus');
  const run = usePolledResource(() => pipelines.getRunStatus({ runId: id }), {
    enabled: allowed, intervalMs: 2_000, resourceKey: id, paused: complete || Boolean(summary?.completedAt),
  });
  if (!allowed) return <Typography variant="body2">Run {id}. Reading its journal requires access to the Pipeline run.</Typography>;
  return <Stack spacing={1}>
    <Link component={RouterLink} to={pipelineRunHref(id)} sx={{ alignSelf: 'start', overflowWrap: 'anywhere' }}>{id}</Link>
    {run.error && <Alert severity="warning">Could not update the run journal. {run.error}</Alert>}
    {run.data?.id === id ? <PipelineRunDetail run={run.data} onPause={onPause} /> :
      !run.error && <Typography variant="body2">{run.loading ? 'Reading the run journal…' : 'No run journal is available.'}</Typography>}
  </Stack>;
}

function ProducerArchive({ preparation, project, stack }: { preparation: Preparation; project: string; stack: string }) {
  const { can } = useAccess();
  const evidence = preparation.producer!;
  const [chosen, choose] = useState('');
  const [pages, setPages] = useState<Array<{ beforeByte: number; version: string }>>([]);
  const name = evidence.logs.includes(chosen) ? chosen : evidence.logs.find(log => log === 'gates.log') ?? evidence.logs[0];
  const allowed = can('OmnitronProject.readRemoteReleasePreparationLog');
  const tail = usePolledResource(() => projectRpc.readRemoteReleasePreparationLog({
    project, stack, attemptId: preparation.attemptId, name: name!, lines: 300, page: pages.at(-1) ?? {},
  }), { enabled: Boolean(allowed && name), paused: true, intervalMs: 5_000,
    resourceKey: JSON.stringify([project, stack, preparation.attemptId, name, pages.at(-1)]) });
  return <Stack spacing={1.5}>
    <Typography variant="body2">{evidence.builtAt && `Built ${formatDate(evidence.builtAt)} · `}{evidence.gates.filter(g => g.status === 'passed').length} of {evidence.gates.length} checks passed</Typography>
    {evidence.gates.length > 0 && <Box component="details" sx={{ typography: 'body2', '& summary': { cursor: 'pointer' } }}>
      <summary>Build checks</summary>
      <Box component="ul" sx={{ pl: 2.5, my: 1 }}>{evidence.gates.map(g => <li key={g.name}>{g.name} · {g.status}{g.durationMs != null && ` · ${formatDuration(g.durationMs)}`}</li>)}</Box>
    </Box>}
    {allowed && name && <TextField select size="small" label="Build log" value={name} onChange={e => { setPages([]); choose(e.target.value); }}>
      {evidence.logs.map(file => <MenuItem key={file} value={file}>{file}</MenuItem>)}
    </TextField>}
    {tail.error && <Alert severity="warning" action={<Button onClick={() => void tail.refresh()}>Retry</Button>}>Could not read this log. {tail.error}</Alert>}
    {allowed && name && (tail.data?.name === name
      ? <LiveLogOutput key={name} label="Saved build output" text={tail.data.tail} live={false} />
      : tail.loading && <Typography role="status" variant="body2">Reading log…</Typography>)}
    {allowed && <Stack direction="row" spacing={1}>
      {tail.data?.previousByte !== undefined && tail.data.version && <Button size="small" onClick={() =>
        setPages([...pages, { beforeByte: tail.data!.previousByte!, version: tail.data!.version! }])}>Earlier build output</Button>}
      {pages.length > 0 && <Button size="small" onClick={() => setPages(pages.slice(0, -1))}>Later build output</Button>}
    </Stack>}
  </Stack>;
}

const muted = (message: string) => <Typography color="text.secondary" variant="body2">{message}</Typography>;

/** The parent supplies evidence matched to one immutable release and registered recipient. */
export function DeploymentActivity(props: Activity) {
  const key = [props.project, props.stack, props.releaseId ?? props.build?.buildId ?? props.producer?.id,
    props.operation?.nodeId ?? props.preparation?.nodeId ?? props.nodeLabel];
  return <ActivityPanel key={JSON.stringify(key)} {...props} />;
}

function ActivityPanel({ project, stack, nodeLabel, releaseId, build, producer, rehearsal,
  transfer, preparation, operation, confirmation, runtime, runtimeUnavailable, progress = [], observationError }: Activity) {
  const { can } = useAccess();
  const [inspected, inspect] = useState<string | null>(null);
  const [runIndex, selectRun] = useState(0);
  const recoveryId = operation?.recoveryRunId ?? rehearsal?.id;
  const failures = progress.filter(row => row.status === 'failed');
  const hasBuild = Boolean(build || producer || preparation?.producer);
  const file = transfer && fileTransferProgress(transfer);
  const nodeId = confirmation?.nodeId ?? operation?.nodeId ?? preparation?.nodeId;
  const manifest = confirmation?.manifestSha256 ?? preparation?.manifestSha256 ?? operation?.manifestSha256;
  const hasOperation = Boolean(confirmation || operation || preparation || transfer || build || producer || rehearsal || progress.length);
  const failedPreparation = preparation?.state === 'refused' || preparation?.state === 'interrupted';
  const activeStage = confirmation || operation || progress.length ? 'launch' : failedPreparation ? 'register' : recoveryId ? 'recovery'
    : preparation ? 'register' : transfer ? 'transfer' : 'build';
  const selected = inspected ?? activeStage;
  const pause = () => inspect(selected);
  const buildState = (build?.state === 'done' || producer?.status === 'success' || preparation?.producer) ? 'Built'
    : build?.state ?? producer?.status ?? 'No report';
  const problem = confirmation ? undefined : operation?.error ?? failures[0]?.message ?? (!operation && failedPreparation ? preparation?.reason : undefined)
    ?? (!operation && activeStage === 'build' ? build?.error : undefined);
  const placement = runtime?.placements?.find(node => node.nodeKey === confirmation?.node);
  const live = !!confirmation && !runtimeUnavailable && placement?.appsObserved && !!runtime?.health?.observedAt &&
    runtime.selectedRelease?.id === confirmation.id && runtime.selectedRelease.manifestSha256 === confirmation.manifestSha256 &&
    placement.apps.length === confirmation.apps.length && confirmation.apps.every(app => placement.apps.some(item =>
      item.expected && item.name === app.name && item.process?.generation === app.generation));
  const health = confirmation?.apps.map(app => live
    ? runtime!.health!.apps.find(item => item.name === app.name && item.node === confirmation.node)?.status ?? 'unknown' : app.health);
  const healthCount = health?.filter(status => status === 'healthy').length ?? 0;
  const steps: { id: string; title: string; status: string; detail: ReactNode }[] = [
    { id: 'build', title: 'Build', status: buildState, detail: <Stack spacing={1.5}>
      {build && <ReleaseBuildPanel record={build} onPause={pause} />}
      {producer && <RunJournal id={producer.id} summary={producer} onPause={pause} />}
      {preparation?.producer && <ProducerArchive key={preparation.attemptId} preparation={preparation} project={project} stack={stack} />}
      {!hasBuild && muted('The controller has no build journal for this release.')}
    </Stack> },
    { id: 'transfer', title: 'Delivery', status: transfer?.state ?? (preparation?.fileTransferId ? 'Recorded' : 'No report'), detail: transfer && file ? <Stack spacing={1}>
      <Typography variant="body2">{file.detail}</Typography>
      <LinearProgress aria-label={file.label} variant={file.indeterminate ? 'indeterminate' : 'determinate'} value={file.value} />
      {transfer.state !== 'completed' && <Typography variant="body2">{file.label}</Typography>}
      <Typography variant="caption" color="text.secondary">Transfer {transfer.id} · {formatDate(transfer.updatedAt)}</Typography>
    </Stack> : muted(preparation?.fileTransferId ? 'Counters unavailable for transfer ' + preparation.fileTransferId : 'No file transfer has been linked to this release.') },
    { id: 'register', title: 'Registration', status: preparation?.state ?? 'No report',
      detail: preparation ? <Stack spacing={0.75}>
        <Typography variant="body2">Started {formatDate(preparation.startedAt)}{preparation.finishedAt && ' · Finished ' + formatDate(preparation.finishedAt)}</Typography>
        {preparation.reason && preparation.reason !== problem && <Typography variant="body2">{preparation.reason}</Typography>}
        <Typography variant="caption" color="text.secondary">Attempt {preparation.attemptId}</Typography>
      </Stack> : muted('No registration attempt is recorded for this release.') },
    { id: 'recovery', title: 'Recovery check', status: rehearsal?.status ?? (recoveryId ? 'Recorded' : 'No report'),
      detail: recoveryId ? <RunJournal id={recoveryId} summary={rehearsal?.id === recoveryId ? rehearsal : undefined} onPause={pause} />
        : muted('No recovery run is linked to this release.') },
    { id: 'launch', title: 'Launch', status: confirmation ? 'confirmed' : operation?.phase ?? (progress.length ? 'Reported' : 'No report'),
      detail: <Stack spacing={1}>
        {confirmation && <Typography variant="body2">Launch confirmed {formatDate(confirmation.confirmedAt)}</Typography>}
        {confirmation && <Box component="details" sx={{ typography: 'body2', '& summary': { cursor: 'pointer' } }}>
          <summary>Application health and generations</summary>
          <Box component="ul" sx={{ pl: 2.5 }}>{confirmation.apps.map((app, i) =>
            <li key={app.name}>{app.name} · {health?.[i]} · {app.generation}</li>)}</Box>
        </Box>}
        {nodeId && releaseId && manifest && <LaunchAttempts project={project} stack={stack} nodeId={nodeId} release={releaseId} manifest={manifest} />}
        {operation && <>
          <Typography variant="body2">{launchPhase[operation.phase]}</Typography>
          <Box component="details" sx={{ typography: 'caption', '& summary': { cursor: 'pointer' } }}>
            <summary>Deployment receipt</summary>
            <div>Review · {operation.review}</div><div>Return release · {operation.rollbackRelease}</div>
            {operation.manifestSha256 && <div>Selected manifest · {operation.manifestSha256}</div>}
            {operation.stopId && <div>Stop receipt · {operation.stopId}</div>}
          </Box>
        </>}
        {progress.length > 0 && <DeployProgressList records={progress} unavailable={Boolean(observationError)} />}
        {!confirmation && !operation && !progress.length && muted('No launch confirmation has been recorded for this release.')}
        {confirmation && <LaunchLogs project={project} stack={stack} confirmation={confirmation} />}
        {!!confirmation?.journalRuns?.length && can('OmnitronPipelines.getRunStatus') && <Stack spacing={1}>
          <TextField select size="small" label="Deployment run journal" value={runIndex} onChange={event => selectRun(Number(event.target.value))}>
            {confirmation.journalRuns.map((id, index) => <MenuItem value={index} key={id}>{id}</MenuItem>)}
          </TextField>
          <RunJournal id={confirmation.journalRuns[runIndex]!} complete onPause={pause} />
        </Stack>}
        {nodeId && can('OmnitronLogs.queryLogs') && <Link component={RouterLink} sx={{ alignSelf: 'start' }}
          to={workspaceHref({ project, stack }, '/logs?node=' + encodeURIComponent(nodeId))}>Application logs on this node</Link>}
      </Stack> },
  ];
  const current = steps.find(item => item.id === activeStage)!;
  return <Stack component="section" aria-label="Deployment activity" spacing={1.5}
    sx={{ minWidth: 0, overflowWrap: 'anywhere', p: { xs: 1.5, sm: 2.5 }, border: 1, borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.paper' }}>
    <Stack direction="row" useFlexGap sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      <Typography component="h2" variant="h6">{nodeLabel ?? nodeId ?? (project + ' / ' + stack)}</Typography>
      {hasOperation && <Chip size="small" role="status" color={problem ? 'error' : health?.length && live
        ? (healthCount === health.length ? 'success' : 'warning') : 'default'}
        label={health?.length ? healthCount + '/' + health.length + ' healthy' + (live ? '' : ' at confirmation')
          : problem ? current.title + ' blocked' : current.title + ' · ' + labelStatus(current.status)} />}
      {confirmation && <Typography variant="caption" color="text.secondary">{live ? 'Observed ' + formatDate(runtime!.health!.observedAt!)
        : 'Last confirmed ' + formatDate(confirmation.confirmedAt)}</Typography>}
    </Stack>
    {releaseId && <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>{releaseId}</Typography>}
    {observationError && <Alert severity="warning">Updates unavailable. {observationError}</Alert>}
    {problem && <Alert severity="error">{problem}</Alert>}
    {hasOperation ? <Tabs aria-label="Deployment stages" value={selected} onChange={inspect}
      variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile
      action={inspected !== null && <Button size="small" onClick={() => inspect(null)}>Follow current stage</Button>}
      tabs={steps.map(step => ({ value: step.id, label: step.title + ' · ' + labelStatus(step.status), content: step.detail }))} />
      : muted('No deployment activity is recorded for this stack.')}
  </Stack>;
}
