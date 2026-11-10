/**
 * Asking for a release.
 *
 * Project configuration supplies the SDK source; an explicit override belongs
 * only to this build. Source commits, the stack's static bundle and gate results
 * remain visible in the resulting release.
 *
 * The build takes about a quarter of an hour, and this dialog does not wait
 * for it: the daemon starts it, answers with its id, and the page behind
 * this one follows it to the end.
 */

import { useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import type { BuildRecord, IStackInfo } from '@omnitron-dev/omnitron/dto/services';
import { parseFrameworkSource } from '@omnitron-dev/omnitron/release-source';
import type { ReleasePreflightView } from 'src/netron/release-wire';
import { releases as releaseRpc } from 'src/netron/client';
import { useProjectStore } from 'src/stores/project.store';
import { ChevronRightIcon } from 'src/assets/icons';
import { useAccess } from 'src/auth/access';

/**
 * `NAME=value` per line, as the operator types it.
 *
 * Parsed here only far enough to build the object; the daemon is what
 * refuses a name it will not take, and it refuses rather than dropping —
 * a gate that needed a variable and silently did not get it fails fifteen
 * minutes later with something that looks like a different bug.
 */
export function parseEnv(text: string): { env: Record<string, string>; bad: string[] } {
  const env: Record<string, string> = {};
  const bad: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) {
      bad.push(line);
      continue;
    }
    const name = line.slice(0, eq).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      bad.push(line);
      continue;
    }
    env[name] = line.slice(eq + 1);
  }
  return { env, bad };
}

export interface BuildReleaseDialogProps {
  open: boolean;
  onClose: () => void;
  defaultProject: string | null;
  activeBuilds?: readonly BuildRecord[];
  onStarted: (record: BuildRecord) => void;
  /** The machine as the daemon reads it now — the load the gates would run under. */
  preflight?: ReleasePreflightView | null;
}

export default function BuildReleaseDialog({ open, onClose, defaultProject, onStarted, preflight, activeBuilds = [] }: BuildReleaseDialogProps) {
  const { snapshot } = useAccess();
  const projects = useProjectStore((s) => s.projects);
  const stacksByProject = useProjectStore((s) => s.stacksByProject);
  const fetchStacks = useProjectStore((s) => s.fetchStacks);

  const [project, setProject] = useState(defaultProject ?? '');
  const inFlight = (name: string) => activeBuilds.find(job => job.request.project === name && (job.state === 'running' || job.state === 'queued'));
  const existing = inFlight(project);
  const [pickedStack, setPickedStack] = useState<string | null>(null);
  const [projectCommit, setProjectCommit] = useState('');
  const [omniCommit, setOmniCommit] = useState('');
  const [frameworkRepository, setFrameworkRepository] = useState('');
  const [frameworkRef, setFrameworkRef] = useState('');
  const [envText, setEnvText] = useState('');
  const [skipGates, setSkipGates] = useState(false);
  const [keepSource, setKeepSource] = useState(false);
  const [publish, setPublish] = useState(false);
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Memoised because an effect below depends on it: `?? []` makes a new
  // array on every render, and an effect keyed on that runs on every render.
  const stacks: IStackInfo[] = useMemo(() => stacksByProject[project] ?? [], [stacksByProject, project]);

  useEffect(() => {
    if (open) {
      setProject(defaultProject ?? '');
      setFailure(null);
      setFrameworkRepository('');
      setFrameworkRef('');
      setEnvText('');
      setPickedStack(null);
      setPublish(false);
      setSkipGates(false);
      setKeepSource(false);
      setProjectCommit('');
      setOmniCommit('');
    }
  }, [open, defaultProject]);

  useEffect(() => {
    if (open && project && !stacksByProject[project]) void fetchStacks(project);
  }, [open, project, stacksByProject, fetchStacks]);

  // The stack a release is nearly always for: the one that takes releases
  // only. Chosen rather than left empty because a release without the static
  // bundle is refused by exactly that stack, at the end, after the build.
  const forStack = pickedStack ?? stacks.find(s => s.config?.release?.mode === 'required')?.name ?? '';

  const { env, bad } = useMemo(() => parseEnv(envText), [envText]);
  const supportsSourceOverride = preflight?.frameworkSource === 1;
  const canOverrideBuild = snapshot?.role === 'admin';
  const canOverrideSource = supportsSourceOverride && canOverrideBuild;
  const hasEnvOverride = Object.keys(env).length > 0;
  const framework = useMemo(() => {
    if (!frameworkRepository.trim() && !frameworkRef.trim()) return { source: undefined, error: null };
    try {
      return { source: parseFrameworkSource({ repository: frameworkRepository.trim(), ...(frameworkRef.trim() ? { ref: frameworkRef.trim() } : {}) }), error: null };
    } catch (error) {
      return { source: undefined, error: (error as Error).message };
    }
  }, [frameworkRepository, frameworkRef]);

  const handleBuild = async () => {
    if (publish && (preflight?.publish !== 1 || skipGates)) return;
    if (framework.error) {
      setFailure(framework.error);
      return;
    }
    if (framework.source && !canOverrideSource) {
      setFailure(supportsSourceOverride
        ? 'An administrator must select an SDK source override. Build with project defaults or sign in with administrator access.'
        : 'This controller does not support SDK source overrides. Update it before using an override.');
      return;
    }
    if (hasEnvOverride && !canOverrideBuild) {
      setFailure('Environment overrides require administrator access. Reopen the dialog to build with project defaults.');
      return;
    }
    setStarting(true);
    setFailure(null);
    try {
      const record = await releaseRpc.build({
        project,
        ...(projectCommit.trim() ? { projectCommit: projectCommit.trim() } : {}),
        ...(omniCommit.trim() ? { omniCommit: omniCommit.trim() } : {}),
        ...(framework.source ? { frameworkSource: framework.source } : {}),
        ...(forStack ? { forStack } : {}),
        ...(skipGates ? { skipGates: true } : {}),
        ...(keepSource ? { keepSource: true } : {}),
        ...(publish && { publish: true }),
        ...(Object.keys(env).length ? { env } : {}),
      });
      onStarted(record);
      onClose();
    } catch (err) {
      setFailure((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <Dialog open={open} onClose={starting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Build a release</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            The controller builds the selected project commit with its locked framework packages or linked
            Omnitron revision. Gate results and artifact checksums are saved with the release.
          </Typography>

          {/*
            Before the press, not after the fifteen minutes. Measured on this
            master: three builds of ONE commit gave 21/21, 16/21 and 16/21,
            each with a different five red, at load 38-56 on 16 cores. Nothing
            is refused here — the operator may know the load is about to drop —
            but nobody should find this out from the gate strip.
          */}
          {preflight?.load && preflight.cpus !== null && preflight.load[0] > preflight.cpus && (
            <Alert severity="warning">
              This machine is carrying more than its cores right now — load{' '}
              <strong>{preflight.load.map((n) => n.toFixed(1)).join(' / ')}</strong> on {preflight.cpus} cores. The gates
              time out on a machine like this: tests that pass alone fail on connection deadlines, and a different set each
              run. A release built now records the machine as much as the code.
            </Alert>
          )}

          <TextField
            select
            label="Project"
            value={project}
            helperText={existing ? `Build ${existing.buildId} · ${existing.phase}` : undefined}
            onChange={(e) => {
              setProject(e.target.value);
              setPickedStack(null);
              setEnvText('');
              setProjectCommit('');
              setOmniCommit('');
              setFrameworkRepository('');
              setFrameworkRef('');
            }}
            size="small"
            fullWidth
            disabled={starting}
          >
            {projects.length === 0 && (
              <MenuItem disabled value="">
                No projects registered
              </MenuItem>
            )}
            {projects.map((p) => (
              <MenuItem key={p.name} value={p.name} disabled={Boolean(inFlight(p.name))}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="Static bundle for"
            value={forStack}
            onChange={(e) => setPickedStack(e.target.value)}
            size="small"
            fullWidth
            disabled={starting}
            helperText="A frontend bakes its environment in, so the bundle belongs to one stack. A stack whose gateway serves one refuses a release built without it."
          >
            <MenuItem value="">
              <em>none — backends only</em>
            </MenuItem>
            {stacks.map((s) => (
              <MenuItem key={s.name} value={s.name}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="body2">{s.name}</Typography>
                  {s.config?.release?.mode === 'required' && (
                    <Chip label="releases only" size="small" color="info" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                  )}
                </Stack>
              </MenuItem>
            ))}
          </TextField>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              label="Project commit"
              placeholder="HEAD"
              value={projectCommit}
              onChange={(e) => setProjectCommit(e.target.value)}
              size="small"
              fullWidth
              disabled={starting}
            />
            <TextField
              label="Framework commit"
              placeholder="From project lockfile or linked checkout"
              value={omniCommit}
              onChange={(e) => setOmniCommit(e.target.value)}
              size="small"
              fullWidth
              disabled={starting}
            />
          </Stack>

          <Accordion disableGutters variant="outlined" disabled={starting}>
            <AccordionSummary expandIcon={<ChevronRightIcon sx={{ transform: 'rotate(90deg)' }} />} aria-controls="release-source-options" id="release-source-toggle">
              <Typography variant="body2">SDK source{framework.source ? ' · overridden for this build' : supportsSourceOverride ? ' · project defaults' : ' · controller defaults'}</Typography>
            </AccordionSummary>
            <AccordionDetails id="release-source-options">
              <Stack spacing={1.5}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {!supportsSourceOverride
                    ? 'This controller has not reported support for SDK source configuration. Update it to use committed omnitron.framework settings or a build override. Ordinary builds use its existing source selection.'
                    : canOverrideSource
                      ? 'Project settings and package metadata choose the source. An override runs code from another SDK repository and requires administrator access.'
                      : 'Builds use project settings and package metadata. Selecting another SDK source requires administrator access.'}
                </Typography>
                <TextField label="SDK repository" value={frameworkRepository} onChange={(event) => setFrameworkRepository(event.target.value)}
                  placeholder="https://git.example.org/platform/omni.git" size="small" fullWidth disabled={starting || !canOverrideSource}
                  helperText="HTTPS, SSH or a local path on the build controller. Keep credentials in its Git configuration." />
                <TextField label="Required source ref (optional)" value={frameworkRef} onChange={(event) => setFrameworkRef(event.target.value)}
                  placeholder="refs/heads/stable or refs/tags/v1.0.0" size="small" fullWidth disabled={starting || !canOverrideSource}
                  helperText="The exact framework commit must belong to this branch or match this tag." />
                {framework.error && <Alert severity="error">{framework.error}</Alert>}
              </Stack>
            </AccordionDetails>
          </Accordion>

          <TextField
            label="Environment for the gates"
            placeholder={'TEST_DATABASE__PORT=5432'}
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            size="small"
            fullWidth
            multiline
            minRows={2}
            disabled={starting || !canOverrideBuild}
            helperText={
              !canOverrideBuild
                ? 'Environment overrides require administrator access. Ordinary builds use the project and controller environment.'
                : bad.length > 0
                ? `Not a NAME=value line: ${bad.slice(0, 2).join(' · ')}`
                : 'One NAME=value per line. The daemon has the system environment, not your shell’s.'
            }
            error={bad.length > 0}
          />

          <Box>
            {preflight?.publish === 1 && <FormControlLabel
              control={<Switch checked={publish} onChange={e => setPublish(e.target.checked)} size="small" disabled={starting || skipGates} />}
              label={<Typography variant="body2">Publish verified build to shared store</Typography>}
            />}
            <FormControlLabel
              control={<Switch checked={skipGates} onChange={(e) => setSkipGates(e.target.checked)} size="small" disabled={starting || publish} />}
              label={<Typography variant="body2">Skip the gates</Typography>}
            />
            {skipGates && (
              <Alert severity="warning" sx={{ mt: 0.5 }}>
                Every gate is recorded as <strong>not-run</strong>, and a stack that requires any will refuse the release.
                For a look at what would be built, never for a deployment.
              </Alert>
            )}
            <FormControlLabel
              control={<Switch checked={keepSource} onChange={(e) => setKeepSource(e.target.checked)} size="small" disabled={starting} />}
              label={<Typography variant="body2">Keep the clones (about 2 GB)</Typography>}
            />
          </Box>

          {failure && (
            <Alert severity="error">
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {failure}
              </Typography>
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small" disabled={starting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          size="small"
          disabled={!project || Boolean(existing) || starting || bad.length > 0 || framework.error !== null || (!!framework.source && !canOverrideSource) || (hasEnvOverride && !canOverrideBuild) || (publish && preflight?.publish !== 1)}
          startIcon={starting ? <CircularProgress size={14} color="inherit" /> : undefined}
          onClick={handleBuild}
        >
          {starting ? 'Starting…' : 'Build'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
