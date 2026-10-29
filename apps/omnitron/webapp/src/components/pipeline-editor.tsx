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
import type { Pipeline, PipelineStep } from '@omnitron-dev/omnitron/dto/services';
import { pipelines, nodes } from 'src/netron/client';
import { usePolledResource } from 'src/hooks/use-polled-resource';

const example = 'const result = await $target`uname -s`;\nconsole.log(result.stdout);\n';
export function PipelineEditor({
  definition,
  onClose,
  onSaved,
}: {
  definition?: Pipeline;
  onClose(): void;
  onSaved(): void;
}) {
  const [name, setName] = useState(definition?.name ?? '');
  const [description, setDescription] = useState(definition?.description ?? '');
  const [steps, setSteps] = useState<PipelineStep[]>(
    definition?.steps ?? [{ name: 'inspect', kind: 'xec', run: example }]
  );
  const [active, setActive] = useState('0');
  const [advanced, setAdvanced] = useState(false);
  const [json, setJson] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const targets = usePolledResource(() => nodes.listNodes(), { intervalMs: 30_000 });
  const index = Number(active);
  const step = steps[index]!;
  const edit = (patch: Partial<PipelineStep>) => {
    setSteps((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
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
      const input = { name, description, steps: advanced ? JSON.parse(json) : steps };
      if (definition) await pipelines.updatePipeline({ id: definition.id, definition: input });
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
          <Stack spacing={2}>
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
                onClick={() => {
                  if (!advanced) {
                    setJson(JSON.stringify(steps, null, 2));
                    setAdvanced(true);
                  } else
                    try {
                      const parsed = JSON.parse(json);
                      if (
                        !Array.isArray(parsed) ||
                        !parsed.length ||
                        parsed.some((s) => typeof s?.name !== 'string' || typeof s?.run !== 'string')
                      )
                        throw Error('A non-empty array of named steps is required');
                      setSteps(parsed);
                      setActive('0');
                      setAdvanced(false);
                      setError(null);
                    } catch (cause) {
                      setError(String(cause));
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
                  onChange={setActive}
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
                    setSteps((current) => current.filter((_, i) => i !== removed));
                    setActive(String(Math.max(0, Math.min(index - (removed < index ? 1 : 0), steps.length - 2))));
                    setDirty(true);
                  }}
                  action={
                    <Button
                      size="small"
                      disabled={steps.length >= 32}
                      onClick={() => {
                        setSteps((current) => [
                          ...current,
                          { name: `step-${current.length + 1}`, kind: 'xec', run: example },
                        ]);
                        setActive(String(steps.length));
                        setDirty(true);
                      }}
                    >
                      Add step
                    </Button>
                  }
                />
                <Box
                  sx={{
                    display: 'grid',
                    gap: 2,
                    gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 260px' },
                    minWidth: 0,
                  }}
                >
                  <TextField
                    label={step.kind === 'xec' ? 'Xec · TypeScript' : 'Shell command'}
                    multiline
                    minRows={13}
                    maxRows={26}
                    fullWidth
                    value={step.run}
                    onChange={(e) => edit({ run: e.target.value })}
                    helperText={
                      step.kind === 'xec'
                        ? '$ runs locally · $target uses the selected node · params contains run input'
                        : 'Parameters are JSON in OMNITRON_PARAMS; shell interpolation is disabled'
                    }
                    slotProps={{
                      input: { sx: { fontFamily: 'monospace', fontSize: 13, lineHeight: 1.7 } },
                      htmlInput: { spellCheck: false, autoCapitalize: 'off', autoCorrect: 'off' },
                    }}
                  />
                  <Stack spacing={2}>
                    <TextField
                      label="Step name"
                      size="small"
                      value={step.name}
                      onChange={(e) => edit({ name: e.target.value })}
                    />
                    <TextField
                      select
                      label="Executor"
                      size="small"
                      value={step.kind ?? 'shell'}
                      onChange={(e) => edit({ kind: e.target.value as 'xec' | 'shell' })}
                    >
                      <MenuItem value="xec">Xec · TypeScript</MenuItem>
                      <MenuItem value="shell">Shell</MenuItem>
                    </TextField>
                    <TextField
                      select
                      label="Target"
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
                      size="small"
                      value={step.cwd ?? ''}
                      placeholder="Daemon working directory"
                      onChange={(e) => edit({ cwd: e.target.value || undefined })}
                    />
                    <TextField
                      label="Timeout (seconds)"
                      type="number"
                      size="small"
                      value={(step.timeout ?? 300_000) / 1000}
                      onChange={(e) => edit({ timeout: Number(e.target.value) * 1000 })}
                    />
                    <TextField
                      label="Depends on"
                      size="small"
                      value={(step.dependsOn ?? []).join(', ')}
                      helperText="Step names, separated by commas"
                      onChange={(e) =>
                        edit({
                          dependsOn: e.target.value
                            .split(',')
                            .map((v) => v.trim())
                            .filter(Boolean),
                        })
                      }
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
          <Button variant="contained" onClick={save} disabled={saving || !name.trim()}>
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
