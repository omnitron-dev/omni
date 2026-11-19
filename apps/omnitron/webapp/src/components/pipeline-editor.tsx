import { OperationStatus } from 'src/components/operation-status';
import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Tabs } from '@omnitron-dev/prism/components/tabs';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { ConfirmDialog } from '@omnitron-dev/prism/components/confirm-dialog';
import type { Pipeline, PipelineStep, PipelineWorkspace } from '@omnitron-dev/omnitron/dto/services';
import { pipelines, nodes } from 'src/netron/client';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { PipelineDependencies } from './pipeline-dependencies';
import { canConnectSteps, parsePipelineSteps, pipelineLevels, removeStep, renameStep, validStepName } from './pipeline-graph';

const example = 'const result = await $target`uname -s`;\nconsole.log(result.stdout);\n';
export function PipelineEditor({
  definition,
  workspace,
  onClose,
  onSaved,
}: {
  definition?: Pipeline;
  workspace?: PipelineWorkspace | null;
  onClose(): void;
  onSaved(): void;
}) {
  const [name, setName] = useState(definition?.name ?? '');
  const [description, setDescription] = useState(definition?.description ?? '');
  const [steps, setSteps] = useState<PipelineStep[]>(
    definition?.steps ?? [{ name: 'inspect', kind: 'xec', run: example }]
  );
  const [active, setActive] = useState('0');
  const [invalidName, setInvalidName] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [json, setJson] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const targets = usePolledResource(() => nodes.listNodes(), { intervalMs: 30_000 });
  const index = Number(active);
  const step = steps[index]!;
  const select = (value: string) => {
    setInvalidName(null);
    setActive(value);
  };
  const rename = (value: string) => {
    setDirty(true);
    if (!validStepName(value) || steps.some((other, i) => i !== index && other.name === value)) {
      setInvalidName(value);
      return;
    }
    setInvalidName(null);
    setSteps(current => renameStep(current, step.name, value));
  };
  const link = (from: string, to: string, connect: boolean) => {
    setSteps(current => {
      if (connect && !canConnectSteps(current, from, to)) return current;
      return current.map(item => item.name !== to ? item : {
        ...item, dependsOn: connect ? [...(item.dependsOn ?? []), from] : item.dependsOn?.filter(prerequisite => prerequisite !== from),
      });
    });
    setDirty(true);
  };
  const edit = (patch: Partial<Omit<PipelineStep, 'run' | 'kind' | 'target' | 'args'>>) => {
    setSteps((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    setDirty(true);
  };
  const editSource = (patch: { run: string } | { kind: 'shell' | 'xec' }) => {
    setSteps(current => current.map((item, i) => i === index && item.kind !== 'release' && item.kind !== 'deploy' ? { ...item, ...patch } : item));
    setDirty(true);
  };
  const close = () => {
    if (!saving) {
      if (dirty) setDiscard(true);
      else onClose();
    }
  };
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const savedSteps = advanced ? parsePipelineSteps(json) : steps;
      if (!advanced) pipelineLevels(savedSteps);
      const input = { name, description, steps: savedSteps, triggers: definition?.triggers ?? [] };
      if (definition) {
        if (!definition.conditionalUpdates) throw new Error('Update the daemon to support conditional pipeline edits');
        await pipelines.updatePipeline({ id: definition.id, definition: input, expectedRevision: definition.revision });
      }
      else await pipelines.createPipeline(input);
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the pipeline');
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Dialog
        open
        onClose={close}
        maxWidth="lg"
        fullWidth
        slotProps={{ paper: { sx: { maxHeight: 'calc(100dvh - 32px)', m: 2, width: 'calc(100% - 32px)' } } }}
      >
        <DialogTitle>{definition ? 'Edit automation' : 'New automation'}</DialogTitle>
        <DialogContent dividers sx={{ minWidth: 0 }}>
          <OperationStatus active={saving} label="Saving automation definition" />
          <Stack spacing={2}>
            {!definition && workspace && <Typography variant="body2" color="text.secondary">
              Include a release or deployment step targeting <strong>{[workspace.project, workspace.stack].filter(Boolean).join('/')}</strong> to list this automation here.
              Shell-only and Xec-only automations appear in the Omnitron workspace.
            </Typography>}
            {error && (
              <Alert severity="error" variant="outlined">
                {error}
              </Alert>
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                autoFocus
                label="Name"
                size="small"
                value={name}
                fullWidth
                onChange={(e) => {
                  setName(e.target.value);
                  setDirty(true);
                }}
              />
              <TextField
                label="Description"
                size="small"
                value={description}
                fullWidth
                onChange={(e) => {
                  setDescription(e.target.value);
                  setDirty(true);
                }}
              />
            </Stack>
            <Stack
              direction="row"
              sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
            >
              <Typography variant="caption" color="text.secondary">
                Save a definition, then review its target before running.
              </Typography>
              <Button
                size="small"
                disabled={invalidName !== null}
                onClick={() => {
                  if (!advanced) {
                    setJson(JSON.stringify(steps, null, 2));
                    setAdvanced(true);
                  } else
                    try {
                      const parsed = parsePipelineSteps(json);
                      setSteps(parsed);
                      const previous = parsed.findIndex(item => item.name === step.name);
                      select(String(Math.max(0, previous)));
                      setAdvanced(false);
                      setError(null);
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : String(cause));
                    }
                }}
              >
                {advanced ? 'Step editor' : 'Advanced JSON'}
              </Button>
            </Stack>
            {advanced ? (
              <TextField
                label="Steps JSON"
                multiline
                minRows={14}
                maxRows={28}
                fullWidth
                value={json}
                onChange={(e) => {
                  setJson(e.target.value);
                  setDirty(true);
                }}
                slotProps={{
                  input: { sx: { fontFamily: 'monospace', fontSize: 13 } },
                  htmlInput: { spellCheck: false },
                }}
              />
            ) : (
              <>
                <Tabs
                  value={active}
                  onChange={select}
                  variant="scrollable"
                  scrollButtons="auto"
                  aria-label="Automation steps"
                  tabs={steps.map((item, i) => ({
                    value: String(i),
                    label: item.name || `Step ${i + 1}`,
                    closable: steps.length > 1,
                  }))}
                  onClose={(value) => {
                    const removed = Number(value);
                    setSteps(current => removeStep(current, steps[removed]!.name));
                    select(String(Math.max(0, Math.min(index - (removed < index ? 1 : 0), steps.length - 2))));
                    setDirty(true);
                  }}
                  action={
                    <Button
                      size="small"
                      disabled={steps.length >= 32}
                      onClick={() => {
                        const used = new Set(steps.map(item => item.name));
                        let number = steps.length + 1;
                        while (used.has(`step-${number}`)) number++;
                        setSteps((current) => [
                          ...current,
                          { name: `step-${number}`, kind: 'xec', run: example },
                        ]);
                        select(String(steps.length));
                        setDirty(true);
                      }}
                    >
                      Add step
                    </Button>
                  }
                />
                <PipelineDependencies steps={steps} selected={index} onSelect={i => select(String(i))} onLink={link} />
                <Box
                  sx={{
                    display: 'grid',
                    gap: 2,
                    gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 260px' },
                    minWidth: 0,
                  }}
                >
                  <TextField
                    label={(step.kind === 'release' || step.kind === 'deploy') ? 'Pinned release target' : step.kind === 'xec' ? 'Xec · TypeScript' : 'Shell command'}
                    multiline
                    minRows={13}
                    maxRows={26}
                    fullWidth
                    value={(step.kind === 'release' || step.kind === 'deploy') ? JSON.stringify({ target: step.target, args: step.args ?? [] }, null, 2) : step.run}
                    onChange={(e) => editSource({ run: e.target.value })}
                    helperText={
                      (step.kind === 'release' || step.kind === 'deploy')
                        ? 'Use Advanced JSON to edit the artifact identity, entry and arguments. The daemon resolves and verifies its installation before every attempt.'
                        : step.kind === 'xec'
                        ? '$ runs locally · $target uses the selected node · params contains run input'
                        : 'Parameters are JSON in OMNITRON_PARAMS; shell interpolation is disabled'
                    }
                    slotProps={{
                      input: { readOnly: step.kind === 'release' || step.kind === 'deploy', sx: { fontFamily: 'monospace', fontSize: 13, lineHeight: 1.7 } },
                      htmlInput: { spellCheck: false, autoCapitalize: 'off', autoCorrect: 'off' },
                    }}
                  />
                  <Stack spacing={2}>
                    <TextField
                      label="Step name"
                      size="small"
                      value={invalidName ?? step.name}
                      error={invalidName !== null}
                      helperText={invalidName !== null ? 'Choose a unique name using 1–80 letters, numbers, dots, underscores or hyphens.' : undefined}
                      onChange={(e) => rename(e.target.value)}
                    />
                    <TextField
                      select
                      label="Executor"
                      disabled={step.kind === 'release' || step.kind === 'deploy'}
                      size="small"
                      value={step.kind ?? 'shell'}
                      onChange={(e) => editSource({ kind: e.target.value as 'xec' | 'shell' })}
                    >
                      <MenuItem value="xec">Xec · TypeScript</MenuItem>
                      <MenuItem value="shell">Shell</MenuItem>
                      {step.kind === 'release' && <MenuItem value="release">Verified release</MenuItem>}
                      {step.kind === 'deploy' && <MenuItem value="deploy">Reviewed deployment</MenuItem>}
                    </TextField>
                    <TextField
                      select
                      label="Target"
                      disabled={step.kind === 'release' || step.kind === 'deploy'}
                      size="small"
                      value={step.nodeId ?? 'local'}
                      onChange={(e) => edit({ nodeId: e.target.value })}
                    >
                      <MenuItem value="local">Local daemon host</MenuItem>
                      {(targets.data ?? [])
                        .filter((n) => !n.isLocal)
                        .map((n) => (
                          <MenuItem key={n.id} value={n.id}>
                            {n.name}
                          </MenuItem>
                        ))}
                      {step.nodeId && step.nodeId !== 'local' && !targets.data?.some((n) => n.id === step.nodeId) && (
                        <MenuItem value={step.nodeId}>Unavailable · {step.nodeId}</MenuItem>
                      )}
                    </TextField>
                    {targets.error && (
                      <Alert severity="warning" variant="outlined">
                        Node list unavailable: {targets.error}
                      </Alert>
                    )}
                    <TextField
                      label="Working directory"
                      disabled={step.kind === 'deploy'}
                      size="small"
                      value={step.cwd ?? ''}
                      placeholder="Daemon working directory"
                      onChange={(e) => edit({ cwd: e.target.value || undefined })}
                    />
                    <TextField
                      label="Timeout (seconds)"
                      disabled={step.kind === 'deploy'}
                      type="number"
                      size="small"
                      value={(step.timeout ?? 300_000) / 1000}
                      onChange={(e) => edit({ timeout: Number(e.target.value) * 1000 })}
                    />
                  </Stack>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  Scripts run with the daemon host's OS permissions. Remote targets require a trusted SSH host key. Use
                  only reviewed code.
                </Typography>
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" loading={saving} onClick={save} disabled={saving || !name.trim() || invalidName !== null}>
            {saving ? 'Saving…' : 'Save definition'}
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={discard}
        onClose={() => setDiscard(false)}
        onConfirm={onClose}
        title="Discard edits?"
        content="Your unsaved automation changes will be lost."
        confirmLabel="Discard"
        confirmColor="error"
      />
    </>
  );
}
