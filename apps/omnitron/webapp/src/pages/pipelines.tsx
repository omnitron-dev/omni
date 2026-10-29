import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Tabs } from '@omnitron-dev/prism/components/tabs';
import { AdminDataTable, type ColumnDef } from '@omnitron-dev/prism/components/admin-filters';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { ConfirmDialog } from '@omnitron-dev/prism/components/confirm-dialog';
import type { Pipeline, PipelineRun, PipelineRunSummary } from '@omnitron-dev/omnitron/dto/services';
import { Can } from 'src/auth/access';
import { PlayIcon, RefreshIcon, PlusIcon, CloseIcon } from 'src/assets/icons';
import { Breadcrumbs } from 'src/components/page-breadcrumbs';
import { PipelineEditor } from 'src/components/pipeline-editor';
import { pipelines } from 'src/netron/client';
import { formatDate, formatDuration } from 'src/utils/formatters';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { settledPair } from 'src/utils/settled-pair';

const colors: Record<string, 'success' | 'error' | 'info' | 'warning' | 'default'> = {
  success: 'success',
  failed: 'error',
  running: 'info',
  pending: 'default',
  cancelling: 'warning',
  interrupted: 'warning',
  cancelled: 'default',
};
const active = (run: PipelineRun) => ['pending', 'running', 'cancelling'].includes(run.status);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const codeSx = {
  m: 0,
  p: 1.5,
  borderRadius: 1,
  bgcolor: 'action.hover',
  fontFamily: 'monospace',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  maxHeight: 320,
  overflow: 'auto',
  minWidth: 0,
} as const;

export function PipelineRunDetail({ run }: { run: PipelineRun }) {
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        <Chip size="small" label={run.status} color={colors[run.status] ?? 'default'} />
        <Typography variant="caption">
          {formatDate(run.startedAt)} · {run.triggeredBy}
        </Typography>
      </Stack>
      <Typography variant="caption" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
        {run.id}
      </Typography>
      {active(run) && <LinearProgress aria-label="Automation in progress" />}
      {run.status === 'interrupted' && (
        <Alert severity="warning" variant="outlined">
          The executor stopped before recording completion. Inspect effects before starting another run.
        </Alert>
      )}
      {run.steps.map((step) => (
        <Box key={step.name} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5, minWidth: 0 }}>
          <Stack direction="row" sx={{ flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography variant="subtitle2" sx={{ flex: 1, overflowWrap: 'anywhere' }}>
              {step.name}
            </Typography>
            <Chip size="small" label={step.status} color={colors[step.status] ?? 'default'} />
            <Typography variant="caption" color="text.secondary">
              {formatDuration(step.duration)}
              {step.attempts ? ` · attempt ${step.attempts}` : ''}
              {step.exitCode !== undefined && ` · exit ${step.exitCode}`}
            </Typography>
          </Stack>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mb: 1, overflowWrap: 'anywhere' }}
          >
            {step.kind ?? 'shell'} · {step.nodeId ?? 'local'}
          </Typography>
          {step.error && (
            <Alert severity="error" variant="outlined" sx={{ mb: 1, overflowWrap: 'anywhere' }}>
              {step.error}
            </Alert>
          )}
          {step.output && (
            <Box component="pre" aria-label={`${step.name} stdout`} tabIndex={0} sx={codeSx}>
              {step.output}
            </Box>
          )}
          {step.stderr && (
            <Box component="pre" aria-label={`${step.name} stderr`} tabIndex={0} sx={{ ...codeSx, mt: 1 }}>
              {step.stderr}
            </Box>
          )}
          {step.outputTruncated && (
            <Typography variant="caption" color="warning.main">
              Output retention limit reached; earlier content was omitted.
            </Typography>
          )}
          {step.sourceHash && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mt: 1, overflowWrap: 'anywhere', fontFamily: 'monospace' }}
            >
              SHA-256 {step.sourceHash}
            </Typography>
          )}
        </Box>
      ))}
    </Stack>
  );
}

export default function PipelinesPage() {
  const [editor, setEditor] = useState<Pipeline | 'new' | null>(null);
  const [section, setSection] = useState('definitions');
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [runDefinition, setRunDefinition] = useState<Pipeline | null>(null);
  const [params, setParams] = useState('{}');
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [remove, setRemove] = useState<Pipeline | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const { data, loading, error, refresh } = usePolledResource(
    async () => {
      const pair = await settledPair([pipelines.listPipelines(), pipelines.listRuns({ limit: 100 })], [[], []]);
      return { definitions: pair.first, runs: pair.second, partialFailure: pair.partialFailure };
    },
    { intervalMs: 3000 }
  );
  const definitions = data?.definitions ?? [];
  const runs = data?.runs ?? [];
  const detail = usePolledResource(() => pipelines.getRunStatus({ runId: selectedRun! }), {
    intervalMs: 3000,
    enabled: Boolean(selectedRun),
  });
  const refreshDetail = detail.refresh;
  useEffect(() => {
    if (selectedRun) void refreshDetail();
  }, [selectedRun, refreshDetail]);
  const run = detail.data?.id === selectedRun ? detail.data : null;
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
      render: (item) => (
        <Button size="small" onClick={() => setSelectedRun(item.id)}>
          {definitions.find((def) => def.id === item.pipelineId)?.name ?? item.pipelineId.slice(0, 8)}
        </Button>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (item) => <Chip size="small" label={item.status} color={colors[item.status] ?? 'default'} />,
    },
    { key: 'startedAt', header: 'Started', render: (item) => formatDate(item.startedAt) },
    {
      key: 'duration',
      header: 'Duration',
      render: (item) =>
        formatDuration(Date.parse(item.completedAt ?? new Date().toISOString()) - Date.parse(item.startedAt)),
    },
    { key: 'triggeredBy', header: 'Actor', render: (item) => item.triggeredBy },
  ];
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Breadcrumbs
        links={[{ name: 'Pipelines' }]}
        action={
          <Stack direction="row" spacing={1}>
            <IconButton size="small" title="Refresh pipelines" onClick={refresh}>
              <RefreshIcon />
            </IconButton>
            <Can permission="OmnitronPipelines.createPipeline">
              <Button size="small" variant="contained" startIcon={<PlusIcon />} onClick={() => setEditor('new')}>
                New automation
              </Button>
            </Can>
          </Stack>
        }
      />
      {(error || data?.partialFailure || actionError) && (
        <Alert severity="warning" variant="outlined">
          {actionError ?? error ?? data?.partialFailure} · Displayed run state may be stale.
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
          { value: 'definitions', label: `Automations · ${definitions.length}` },
          { value: 'runs', label: `Runs · ${runs.length}` },
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
          loading={loading}
          loadError={error ?? data?.partialFailure}
          emptyMessage="Create an automation to run Xec scripts and shell steps."
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
          loading={loading}
          loadError={error ?? data?.partialFailure}
          emptyMessage="No automation runs yet."
          minWidth={620}
          scrollLabel="Automation run history"
          dense
        />
      )}
      {editor && (
        <PipelineEditor
          {...(editor === 'new' ? {} : { definition: editor })}
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
            {runDefinition?.steps.map((step) => (
              <Box key={step.name} component="details">
                <Box component="summary" sx={{ cursor: 'pointer', fontSize: 13 }}>
                  {step.name} · {step.kind ?? 'shell'} · {step.nodeId ?? 'local'} · {(step.timeout ?? 300000) / 1000}s
                </Box>
                <Box component="pre" sx={{ ...codeSx, mt: 1 }}>
                  {step.run}
                </Box>
              </Box>
            ))}
            <TextField
              label="Parameters (JSON)"
              value={params}
              onChange={(e) => setParams(e.target.value)}
              multiline
              minRows={3}
              fullWidth
              helperText="Values are passed as data and are not stored in run history."
              slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 13 } } }}
            />
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
                const result = await pipelines.executePipeline({
                  id: runDefinition!.id,
                  expectedRevision: runDefinition!.revision,
                  params: JSON.parse(params),
                });
                setSelectedRun(result.id);
                setSection('runs');
                setPage(0);
                setRunDefinition(null);
              })
            }
          >
            {pending ? 'Starting…' : 'Run automation'}
          </Button>
        </DialogActions>
      </Dialog>
      <Drawer
        anchor="right"
        open={Boolean(selectedRun)}
        onClose={() => setSelectedRun(null)}
        slotProps={{
          paper: { sx: { width: { xs: '100%', sm: 640 }, maxWidth: '100vw', p: 2, boxSizing: 'border-box' } },
        }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="subtitle2">Run details</Typography>
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
          <>
            <PipelineRunDetail run={run} />
            <Can permission="OmnitronPipelines.cancelRun">
              {active(run) && (
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
          </>
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
