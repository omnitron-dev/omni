import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { flowHref, useWorkspace } from 'src/routes/workspace';
import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import { PipelineRunDetail, activeRun as active, runColors as colors, pipelineCodeSx as codeSx } from 'src/components/pipeline-run-detail';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Tabs } from '@omnitron-dev/prism/components/tabs';
import { AdminDataTable, type ColumnDef } from '@omnitron-dev/prism/components/admin-filters';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { ConfirmDialog } from '@omnitron-dev/prism/components/confirm-dialog';
import type { Pipeline, PipelineRun, PipelineRunSummary, PipelineWorkspace } from '@omnitron-dev/omnitron/dto/services';
import { Can, useAccess } from 'src/auth/access';
import { PlayIcon, RefreshIcon, PlusIcon, CloseIcon } from 'src/assets/icons';
import { Breadcrumbs } from 'src/components/page-breadcrumbs';
import { PipelineEditor } from 'src/components/pipeline-editor';
import { pipelines, nodes } from 'src/netron/client';
import { formatDate, formatDuration } from 'src/utils/formatters';
import { usePolledResource } from 'src/hooks/use-polled-resource';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export default function PipelinesPage() {
  const { project, stack } = useWorkspace();
  const { can, snapshot } = useAccess();
  const reads = { definitions: can('OmnitronPipelines.listPipelines'), runs: can('OmnitronPipelines.listRuns'), detail: can('OmnitronPipelines.getRunStatus') };
  const [workspaceSection, setWorkspaceSection] = useState('definitions');
  const workspace = project ? { project, ...(stack && { stack }) } : null;
  if (workspace && !can('OmnitronPipelines.listWorkspace')) return <Stack spacing={2}>
    <Breadcrumbs links={[{ name: 'Pipelines' }]} />
    <Alert severity="warning">Workspace pipeline history is unavailable on this controller for this account.</Alert>
  </Stack>;
  return <PipelineInventory key={JSON.stringify([workspace, snapshot?.userId, reads])}
    workspace={workspace} reads={reads} workspaceSection={workspaceSection} setWorkspaceSection={setWorkspaceSection} />;
}

function PipelineInventory({ workspace, reads, workspaceSection, setWorkspaceSection }: {
  workspace: PipelineWorkspace | null;
  reads: { definitions: boolean; runs: boolean; detail: boolean };
  workspaceSection: string;
  setWorkspaceSection: (value: string) => void;
}) {
  const { can } = useAccess();
  const [search, setSearch] = useSearchParams();
  const [localRun, changeRun] = useState<string | null>(null);
  const selectedRun = workspace ? localRun : reads.detail ? search.get('run') : null;
  const requestedView = search.get('view');
  const defaultView = !reads.definitions && reads.runs ? 'runs' : 'definitions';
  const globalView = requestedView === 'definitions' || requestedView === 'runs' ? requestedView : defaultView;
  const section = workspace ? workspaceSection : selectedRun ? 'runs' : globalView;
  const setSection = (next: string) => {
    if (workspace) setWorkspaceSection(next);
    else setSearch(current => {
      const params = new URLSearchParams(current);
      params.set('view', next);
      if (next !== 'runs') params.delete('run');
      return params;
    });
  };
  const setSelectedRun = (id: string | null) => {
    if (workspace) changeRun(id);
    else setSearch(current => {
      const params = new URLSearchParams(current);
      params.set('view', 'runs');
      if (id) params.set('run', id);
      else params.delete('run');
      return params;
    });
  };
  const [editor, setEditor] = useState<Pipeline | 'new' | null>(null);
  const [runDefinition, setRunDefinition] = useState<Pipeline | null>(null);
  const [params, setParams] = useState('{}');
  const [requestId, setRequestId] = useState('');
  const [preparedRun, setPreparedRun] = useState<PipelineRun | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [remove, setRemove] = useState<Pipeline | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const { definitions: readDefinitions, runs: readRuns, detail: readDetail } = reads;
  const readNodes = can('OmnitronNodes.listNodes');
  const targets = usePolledResource(() => nodes.listNodes(), {
    intervalMs: 30_000,
    enabled: readNodes && Boolean(runDefinition || selectedRun), resourceKey: Number(readNodes),
  });
  const targetLabel = (id?: string) =>
    !id || id === 'local' ? 'Local daemon host' : (targets.data?.find((node) => node.id === id)?.name ?? id);
  const scoped = usePolledResource(() => pipelines.listWorkspace({ ...workspace!, limit: 100 }), { intervalMs: 3000, enabled: !!workspace });
  const automations = usePolledResource(() => pipelines.listPipelines(), { intervalMs: 3000, enabled: !workspace && readDefinitions });
  const history = usePolledResource(() => pipelines.listRuns({ limit: 100 }), { intervalMs: 3000, enabled: !workspace && readRuns });
  const automationData = workspace ? scoped.data?.definitions : automations.data;
  const historyData = workspace ? scoped.data?.runs : history.data;
  const definitions = automationData ?? [];
  const runs = historyData ?? [];
  const automationError = workspace ? scoped.error : readDefinitions ? automations.error : 'Your account cannot read automation definitions.';
  const historyError = workspace ? scoped.error : readRuns ? history.error : 'Your account cannot read automation run history.';
  const refresh = () => workspace ? scoped.refresh() : Promise.all([readDefinitions && automations.refresh(), readRuns && history.refresh()]);
  const detail = usePolledResource(() => pipelines.getRunStatus({ runId: selectedRun! }), {
    intervalMs: 3000,
    enabled: readDetail && Boolean(selectedRun),
    resourceKey: selectedRun,
  });
  const run = detail.data?.id === selectedRun ? detail.data : null;
  const runLabel = (item: PipelineRunSummary) =>
    item.pipelineName ?? definitions.find(def => def.id === item.pipelineId)?.name ?? item.pipelineId.slice(0, 8);
  const selected = runs.find(item => item.id === selectedRun);
  const act = async (operation: () => Promise<unknown>) => {
    setPending(true);
    setActionError(null);
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setActionError(message(cause));
    } finally {
      setPending(false);
    }
  };
  const definitionColumns: ColumnDef<Pipeline>[] = [
    {
      key: 'name',
      header: 'Automation',
      render: (item) => (
        <Button size="small" onClick={() => setEditor(item)} sx={{ textAlign: 'left' }}>
          {item.name}
        </Button>
      ),
    },
    { key: 'description', header: 'Description', render: (item) => item.description || '—' },
    { key: 'steps', header: 'Steps', render: (item) => item.steps.length },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (item) => (
        <Stack direction="row" sx={{ justifyContent: 'flex-end', gap: 1 }}>
          <Can permission="OmnitronPipelines.executePipeline">
            <Button
              size="small"
              startIcon={<PlayIcon />}
              disabled={pending}
              onClick={() => {
                setRunDefinition(item);
                setParams('{}');
                setRequestId(crypto.randomUUID());
                setPreparedRun(null);
                setActionError(null);
              }}
            >
              Run
            </Button>
          </Can>
          <Can permission="OmnitronPipelines.deletePipeline">
            <IconButton size="small" title={`Delete ${item.name}`} disabled={pending} onClick={() => setRemove(item)}>
              <CloseIcon />
            </IconButton>
          </Can>
        </Stack>
      ),
    },
  ];
  const runColumns: ColumnDef<PipelineRunSummary>[] = [
    {
      key: 'name',
      header: 'Automation',
      render: (item) => readDetail ? (
        <Button size="small" onClick={() => { setParams('{}'); setActionError(null); setSelectedRun(item.id); }}>
          {runLabel(item)}
        </Button>
      ) : runLabel(item),
    },
    {
      key: 'status',
      header: 'Status',
      render: (item) => <Chip size="small" label={item.status} color={colors[item.status] ?? 'default'} />,
    },
    { key: 'startedAt', header: 'Recorded', render: (item) => formatDate(item.startedAt) },
    {
      key: 'duration',
      header: 'Duration',
      render: (item) =>
        item.status === 'awaiting-review' ? '—' : formatDuration(Date.parse(item.completedAt ?? new Date().toISOString()) - Date.parse(item.startedAt)),
    },
    { key: 'triggeredBy', header: 'Actor', render: (item) => item.triggeredBy },
  ];
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Breadcrumbs
        links={[{ name: 'Pipelines' }]}
        action={
          <Stack direction="row" spacing={1}>
            <IconButton data-console-command="refresh" size="small" title="Refresh pipelines" onClick={refresh}>
              <RefreshIcon />
            </IconButton>
            {(can('OmnitronFlows.list') || can('OmnitronFlows.catalog')) && (
              <Button component={RouterLink} to={flowHref({ project: workspace?.project ?? null, stack: workspace?.stack })} size="small">
                Flows
              </Button>
            )}
            <Can permission="OmnitronPipelines.createPipeline">
              <Button size="small" variant="contained" startIcon={<PlusIcon />} onClick={() => setEditor('new')}>
                New automation
              </Button>
            </Can>
          </Stack>
        }
      />
      {actionError && (
        <Alert severity="warning" variant="outlined">
          {actionError}
        </Alert>
      )}
      <Tabs
        value={section}
        onChange={(value) => {
          setSection(value);
          setPage(0);
        }}
        aria-label="Pipeline views"
        tabs={[
          { value: 'definitions', label: `Automations · ${automationError ? '—' : automationData?.length ?? '—'}` },
          { value: 'runs', label: `Runs · ${historyError ? '—' : historyData?.length ?? '—'}` },
        ]}
      />
      {section === 'definitions' ? (
        <AdminDataTable<Pipeline>
          data={definitions.slice(page * pageSize, (page + 1) * pageSize)}
          columns={definitionColumns}
          rowKey={(item) => item.id}
          total={definitions.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          loading={workspace ? scoped.loading : readDefinitions && automations.loading}
          loadError={automationError}
          loadErrorLabels={{ partial: 'Showing the last available automation definitions' }}
          emptyMessage={workspace ? 'No automations target this workspace.' : 'No automations defined.'}
          minWidth={560}
          scrollLabel="Automation definitions"
          dense
        />
      ) : (
        <AdminDataTable<PipelineRunSummary>
          data={runs.slice(page * pageSize, (page + 1) * pageSize)}
          columns={runColumns}
          rowKey={(item) => item.id}
          total={runs.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          loading={workspace ? scoped.loading : readRuns && history.loading}
          loadError={historyError}
          loadErrorLabels={{ partial: 'Showing the last available run history' }}
          emptyMessage={workspace ? 'No recorded runs target this workspace.' : 'No automation runs yet.'}
          minWidth={620}
          scrollLabel="Automation run history"
          dense
        />
      )}
      {editor && (
        <PipelineEditor
          {...(editor === 'new' ? {} : { definition: editor })}
          workspace={workspace}
          onClose={() => setEditor(null)}
          onSaved={() => {
            void refresh();
          }}
        />
      )}
      <Dialog
        open={Boolean(runDefinition)}
        onClose={() => {
          if (!pending) setRunDefinition(null);
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Run {runDefinition?.name}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {actionError && (
              <Alert severity="error" variant="outlined">
                {actionError}
              </Alert>
            )}
            {targets.error && (
              <Alert severity="warning" variant="outlined">
                Node names unavailable; verify target IDs below.
              </Alert>
            )}
            {runDefinition?.steps.map((step) => (
              <Box key={step.name} component="details">
                <Box component="summary" sx={{ cursor: 'pointer', fontSize: 13 }}>
                  {step.name} · {step.kind ?? 'shell'} · {step.target ? `${step.target.project}/${step.target.stack}` : targetLabel(step.nodeId)}
                  {step.kind !== 'deploy' && ` · ${(step.timeout ?? 300000) / 1000}s`}
                </Box>
                <Box component="pre" sx={{ ...codeSx, mt: 1 }}>
                  {step.target ? JSON.stringify({ target: step.target, ...(step.kind === 'release' && { args: step.args ?? [] }) }, null, 2) : step.run}
                </Box>
                <Box component="pre" aria-label={`${step.name} execution settings`} sx={{ ...codeSx, mt: 1 }}>
                  {JSON.stringify(
                    {
                      ...(step.kind !== 'deploy' && {
                        targetId: step.nodeId ?? 'local',
                        cwd: step.cwd ?? 'Daemon working directory',
                        retries: step.retries ?? 0,
                        env: step.env ?? {},
                      }),
                      dependsOn: step.dependsOn ?? [],
                      condition: step.condition ?? null,
                    },
                    null,
                    2
                  )}
                </Box>
              </Box>
            ))}
            <TextField
              label="Parameters (JSON)"
              value={params}
              disabled={pending || (Boolean(preparedRun) && preparedRun?.review?.parameterNames.length === 0)}
              onChange={(e) => setParams(e.target.value)}
              multiline
              minRows={3}
              fullWidth
              helperText="Values are passed as data and are not stored in run history."
              slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 13 } } }}
            />
            {preparedRun?.review && (
              <Alert severity="info" variant="outlined" sx={{ overflowWrap: 'anywhere' }}>
                Request {preparedRun.id} is saved. Review {preparedRun.review.digest}.
                {preparedRun.review.projects.length > 0 && ` Projects: ${preparedRun.review.projects.join(', ')}.`}
                {' '}After a lost response, inspect this request in run history. Retrying uses the same identity.
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={pending} onClick={() => setRunDefinition(null)}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            variant="contained"
            onClick={() =>
              act(async () => {
                if (!preparedRun) {
                  const admitted = await pipelines.prepareRun({
                    runId: requestId, id: runDefinition!.id,
                    expectedRevision: runDefinition!.revision, params: JSON.parse(params),
                  });
                  setPreparedRun(admitted);
                  return;
                }
                if (readDetail) setSelectedRun(preparedRun.id);
                if (workspace || !readDetail) setSection('runs');
                setPage(0);
                const result = await pipelines.startRun({
                  runId: preparedRun.id, expectedDigest: preparedRun.review!.digest, params: JSON.parse(params),
                });
                if (readDetail) setSelectedRun(result.id);
                setRunDefinition(null);
              })
            }
          >
            {pending ? 'Saving…' : preparedRun ? 'Run automation' : 'Prepare request'}
          </Button>
        </DialogActions>
      </Dialog>
      <Drawer
        anchor="right"
        open={Boolean(selectedRun)}
        onClose={() => setSelectedRun(null)}
        slotProps={{
          paper: { role: 'dialog', 'aria-labelledby': 'pipeline-run-title',
            sx: { width: { xs: '100%', sm: 640 }, maxWidth: '100vw', p: 2, boxSizing: 'border-box' } },
        }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            <Typography id="pipeline-run-title" component="h2" variant="subtitle1">{selected ? runLabel(selected) : run?.pipelineId ?? 'Run details'}</Typography>
            {workspace && <Typography variant="caption" color="text.secondary">{[workspace.project, workspace.stack].filter(Boolean).join(' / ')}</Typography>}
          </Box>
          <IconButton title="Close run details" onClick={() => setSelectedRun(null)}>
            <CloseIcon />
          </IconButton>
        </Stack>
        {detail.error && (
          <Alert severity="warning" variant="outlined">
            Updates unavailable. The displayed state may be stale.
          </Alert>
        )}
        {actionError && (
          <Alert severity="error" variant="outlined" sx={{ mb: 2 }}>
            {actionError}
          </Alert>
        )}
        {run ? (
          <PipelineRunDetail run={run} targetLabel={targetLabel}>
            {run.recovery && <Stack spacing={1}>
              {run.steps.some(step => step.deployment && run.recovery!.blocked.includes(step.name)) && <Can permission="OmnitronPipelines.reconcileRun">
                <Button variant="outlined" disabled={pending} onClick={() => act(async () => {
                  await pipelines.reconcileRun({ runId: run.id }); await detail.refresh();
                })}>Inspect remote receipts</Button>
              </Can>}
              <Can permission="OmnitronPipelines.resumeRun">
                {Boolean(run.review?.parameterNames.length) && <TextField label="Original parameters (JSON)" multiline value={params}
                  helperText={run.review!.parameterNames.join(', ')} disabled={pending} onChange={event => setParams(event.target.value)} />}
                <Button variant="contained" disabled={pending || run.recovery.blocked.length > 0 || Boolean(detail.error)} onClick={() => act(async () => {
                  await pipelines.resumeRun({ runId: run.id, expectedDigest: run.recovery!.digest, params: JSON.parse(params) });
                  await detail.refresh();
                })}>Continue remaining steps</Button>
              </Can>
            </Stack>}
            {run.status === 'awaiting-review' && (
              <Can permission="OmnitronPipelines.startRun">
                <Button sx={{ mt: 2 }} variant="contained" disabled={pending} onClick={() => act(async () => {
                  const definition = await pipelines.getPipeline({ id: run.pipelineId, ...(workspace && { workspace }) });
                  if (!definition || definition.revision !== run.review?.definitionRevision)
                    throw new Error('Definition changed after review. Cancel this request and prepare the current definition.');
                  setPreparedRun(run); setRequestId(run.id); setParams('{}');
                  setRunDefinition(definition); setSelectedRun(null);
                })}>Review request</Button>
              </Can>
            )}
            <Can permission="OmnitronPipelines.cancelRun">
              {(active(run) || run.status === 'awaiting-review') && (
                <Button
                  sx={{ mt: 2 }}
                  color="warning"
                  variant="outlined"
                  disabled={pending || run.status === 'cancelling'}
                  onClick={() =>
                    act(async () => {
                      await pipelines.cancelRun({ runId: run.id });
                      await detail.refresh();
                    })
                  }
                >
                  Cancel run
                </Button>
              )}
            </Can>
          </PipelineRunDetail>
        ) : (
          <Alert severity="info" variant="outlined">
            {detail.loading ? 'Loading run state…' : 'Run state is unavailable.'}
          </Alert>
        )}
      </Drawer>
      <ConfirmDialog
        open={Boolean(remove)}
        onClose={() => {
          if (!pending) setRemove(null);
        }}
        onConfirm={() =>
          act(async () => {
            await pipelines.deletePipeline({ id: remove!.id });
            setRemove(null);
          })
        }
        title="Delete automation?"
        content={`${remove?.name ?? ''} and its run history will be removed. Active runs must be stopped first.`}
        confirmLabel="Delete"
        confirmColor="error"
      />
    </Stack>
  );
}
