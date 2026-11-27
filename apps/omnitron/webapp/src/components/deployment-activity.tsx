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

function RunJournal({ id, summary, onPause }: { id: string; summary?: PipelineRunSummary; onPause: () => void }) {
  const { can } = useAccess();
  const allowed = can('OmnitronPipelines.getRunStatus');
  const run = usePolledResource(() => pipelines.getRunStatus({ runId: id }), {
    enabled: allowed, intervalMs: 2_000, resourceKey: id, paused: Boolean(summary?.completedAt),
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
  const name = evidence.logs.includes(chosen) ? chosen : evidence.logs.find(log => log === 'gates.log') ?? evidence.logs[0];
  const allowed = can('OmnitronProject.readRemoteReleasePreparationLog');
  const tail = usePolledResource(() => projectRpc.readRemoteReleasePreparationLog({
    project, stack, attemptId: preparation.attemptId, name: name!, lines: 300,
  }), { enabled: Boolean(allowed && name), paused: true, intervalMs: 5_000,
    resourceKey: JSON.stringify([project, stack, preparation.attemptId, name]) });
  return <Stack spacing={1.5}>
    <Typography variant="body2">{evidence.builtAt && `Built ${formatDate(evidence.builtAt)} · `}{evidence.gates.filter(g => g.status === 'passed').length} of {evidence.gates.length} checks passed</Typography>
    {evidence.gates.length > 0 && <Box component="details" sx={{ typography: 'body2', '& summary': { cursor: 'pointer' } }}>
      <summary>Build checks</summary>
      <Box component="ul" sx={{ pl: 2.5, my: 1 }}>{evidence.gates.map(g => <li key={g.name}>{g.name} · {g.status}{g.durationMs != null && ` · ${formatDuration(g.durationMs)}`}</li>)}</Box>
    </Box>}
    {allowed && name && <TextField select size="small" label="Build log" value={name} onChange={e => choose(e.target.value)}>
      {evidence.logs.map(file => <MenuItem key={file} value={file}>{file}</MenuItem>)}
    </TextField>}
    {tail.error && <Alert severity="warning" action={<Button onClick={() => void tail.refresh()}>Retry</Button>}>Could not read this log. {tail.error}</Alert>}
    {allowed && name && (tail.data?.name === name
      ? <LiveLogOutput key={name} label="Saved build output" text={tail.data.tail} live={false} />
      : tail.loading && <Typography role="status" variant="body2">Reading log…</Typography>)}
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
  transfer, preparation, operation, progress = [], observationError }: Activity) {
  const { can } = useAccess();
  const [inspected, inspect] = useState<string | null>(null);
  const recoveryId = operation?.recoveryRunId ?? rehearsal?.id;
  const failures = progress.filter(row => row.status === 'failed');
  const hasBuild = Boolean(build || producer || preparation?.producer);
  const file = transfer && fileTransferProgress(transfer);
  const nodeId = operation?.nodeId ?? preparation?.nodeId;
  const hasOperation = Boolean(operation || preparation || transfer || build || producer || rehearsal || progress.length);
  const failedPreparation = preparation?.state === 'refused' || preparation?.state === 'interrupted';
  const activeStage = operation || progress.length ? 'launch' : failedPreparation ? 'register' : recoveryId ? 'recovery'
    : preparation ? 'register' : transfer ? 'transfer' : 'build';
  const selected = inspected ?? activeStage;
  const pause = () => inspect(selected);
  const buildState = (build?.state === 'done' || producer?.status === 'success' || preparation?.producer) ? 'Built'
    : build?.state ?? producer?.status ?? 'No report';
  const problem = operation?.error ?? failures[0]?.message ?? (!operation && failedPreparation ? preparation?.reason : undefined)
    ?? (!operation && activeStage === 'build' ? build?.error : undefined);
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
    { id: 'launch', title: 'Launch', status: operation?.phase ?? (progress.length ? 'Reported' : 'No report'),
      detail: <Stack spacing={1}>
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
        {!operation && !progress.length && muted('No launch has been recorded for this release.')}
        {nodeId && can('OmnitronLogs.queryLogs') && <Link component={RouterLink} sx={{ alignSelf: 'start' }}
          to={workspaceHref({ project, stack }, '/logs?node=' + encodeURIComponent(nodeId))}>Application logs on this node</Link>}
      </Stack> },
  ];
  const current = steps.find(item => item.id === activeStage)!;
  return <Stack component="section" aria-label="Deployment activity" spacing={1.5}
    sx={{ minWidth: 0, overflowWrap: 'anywhere', p: { xs: 1.5, sm: 2.5 }, border: 1, borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.paper' }}>
    <Stack direction="row" useFlexGap sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      <Typography component="h2" variant="h6">{nodeLabel ?? nodeId ?? (project + ' / ' + stack)}</Typography>
      {hasOperation && <Chip size="small" role="status" color={problem ? 'error' : operation?.phase === 'confirmed' ? 'success' : 'default'}
        label={problem ? current.title + ' blocked' : current.title + ' · ' + labelStatus(current.status)} />}
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
