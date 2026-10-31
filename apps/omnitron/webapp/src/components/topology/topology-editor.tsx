import { useEffect, useRef, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { ConfirmDialog } from '@omnitron-dev/prism/components/confirm-dialog';
import { Tabs } from '@omnitron-dev/prism/components/tabs';
import type { TopologySpec, TopologyPlan, TopologyWorkspace } from '@omnitron-dev/omnitron/dto/services';
import { project } from 'src/netron/client';
import { useAccess } from 'src/auth/access';
import { CloseIcon } from 'src/assets/icons';

interface Props {
  projectName: string;
  stackName: string;
  onClose: () => void;
  onApplied: () => void;
}
const nodeKey = (node: { host: string; port: number }) => `${node.host}:${node.port}`;

/** Saved intent and reviewed changes. Graph dragging remains a view preference, never a deployment command. */
export function TopologyEditor({ projectName, stackName, onClose, onApplied }: Props) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const { can } = useAccess();
  const writable = can('OmnitronProject.saveTopologyDraft');
  const [workspace, setWorkspace] = useState<TopologyWorkspace | null>(null);
  const [spec, setSpec] = useState<TopologySpec | null>(null);
  const [saved, setSaved] = useState('');
  const [plan, setPlan] = useState<TopologyPlan | null>(null);
  const [tab, setTab] = useState('placement');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [discard, setDiscard] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const dirty = spec !== null && JSON.stringify(spec) !== saved;
  const scope = { project: projectName, stack: stackName };

  useEffect(() => {
    alive.current = true;
    let current = true;
    project
      .getTopologyWorkspace({ project: projectName, stack: stackName })
      .then((value) => {
        if (!current) return;
        const next = value.draft?.spec ?? value.desired;
        setWorkspace(value);
        setSpec(next);
        setSaved(JSON.stringify(next));
      })
      .catch((err) => {
        if (current) setError(err instanceof Error ? err.message : 'Could not load topology');
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
      alive.current = false;
    };
  }, [projectName, stackName]);

  const run = async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await work();
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : 'Topology operation failed');
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const change = (next: TopologySpec) => {
    setSpec(next);
    setPlan(null);
    setMessage(null);
  };
  const save = async () => {
    if (!workspace || !spec) throw new Error('Topology has not loaded');
    const draft = await project.saveTopologyDraft({
      ...scope,
      baseRevision: workspace.revision,
      expectedDraft: workspace.draft?.revision ?? null,
      spec,
    });
    if (alive.current) {
      setWorkspace({ ...workspace, draft });
      setSaved(JSON.stringify(draft.spec));
    }
    return draft;
  };
  const buildPlan = () =>
    run(async () => {
      if (!workspace || !spec) return;
      const draft =
        dirty || !workspace.draft || workspace.draft.baseRevision !== workspace.revision
          ? await save()
          : workspace.draft;
      const result = await project.planTopology({ ...scope, draftRevision: draft.revision });
      if (alive.current) {
        setPlan(result);
        setTab('review');
      }
    });
  const close = () => {
    if (!busy) {
      if (dirty) setDiscard(true);
      else onClose();
    }
  };
  const reload = (keepEdits: boolean) =>
    run(async () => {
      const next = await project.getTopologyWorkspace(scope);
      if (!alive.current) return;
      setWorkspace(next);
      setPlan(null);
      setRefresh(false);
      if (keepEdits && spec) {
        setSaved('');
        setMessage('Latest base loaded. Your edits are preserved locally; review and save them before planning.');
      } else {
        const value = next.draft?.spec ?? next.desired;
        setSpec(value);
        setSaved(JSON.stringify(value));
      }
    });
  const exportSpec = () => {
    if (!spec) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(spec, null, 2) + '\n'], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${projectName}-${stackName}.topology.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <>
      <Dialog
        open
        onClose={close}
        fullScreen={fullScreen}
        fullWidth
        maxWidth="md"
        aria-labelledby="topology-editor-title"
        slotProps={{ paper: { sx: { minWidth: 0, maxHeight: fullScreen ? '100dvh' : 'calc(100dvh - 48px)' } } }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            event.stopPropagation();
            if (writable && !busy && spec)
              void run(async () => {
                await save();
                setMessage('Draft saved');
              });
          }
        }}
      >
        <DialogTitle id="topology-editor-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography component="span" variant="subtitle1">
              {projectName} / {stackName}
            </Typography>
            <Typography variant="caption" sx={{ display: 'block' }} color="text.secondary">
              Desired topology ·{' '}
              {dirty ? 'Unsaved changes' : workspace?.draft ? `Draft ${workspace.draft.revision}` : 'Current target'}
            </Typography>
          </Box>
          <IconButton aria-label="Close topology editor" onClick={close} disabled={busy}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        {(loading || busy) && <LinearProgress aria-label={loading ? 'Loading topology' : 'Saving topology'} />}
        <DialogContent dividers sx={{ p: { xs: 1.5, sm: 2.5 }, minWidth: 0, overscrollBehavior: 'contain' }}>
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            {message && <Alert severity="success">{message}</Alert>}
            {workspace?.draft && workspace.draft.baseRevision !== workspace.revision && (
              <Alert
                severity="warning"
                action={
                  <Button size="small" onClick={() => void reload(true)} disabled={busy}>
                    Rebase edits
                  </Button>
                }
              >
                The saved draft is based on an older configuration. Rebase and review your edits before planning.
              </Alert>
            )}
            {workspace && spec && (
              <>
                <Tabs
                  value={tab}
                  onChange={setTab}
                  variant="scrollable"
                  scrollButtons="auto"
                  aria-label="Topology workspace"
                  tabs={[
                    { value: 'placement', label: 'Placement' },
                    { value: 'connections', label: 'Connections' },
                    { value: 'review', label: 'Review', disabled: !plan },
                  ]}
                />
                {tab === 'placement' && (
                  <Stack spacing={2}>
                    <Typography variant="body2" color="text.secondary">
                      Design the target placement. Accepting a plan saves this target; it does not change deployment or
                      restart configuration. Runtime migration is not enabled in this workspace.
                    </Typography>
                    <Autocomplete
                      multiple
                      options={workspace.applications.map((app) => app.name)}
                      value={spec.apps}
                      disabled={!writable || busy}
                      onChange={(_, apps) =>
                        change({
                          ...spec,
                          apps,
                          nodes: spec.nodes.map((node) => ({
                            ...node,
                            apps: node.apps.filter((app) => apps.includes(app)),
                          })),
                        })
                      }
                      renderInput={(params) => <TextField {...params} label="Stack applications" />}
                    />
                    {spec.type === 'local' && (
                      <Alert severity="info">
                        These applications run on this daemon. Use a remote or cluster stack for fleet placement.
                      </Alert>
                    )}
                    {spec.nodes.map((node, index) => (
                      <Stack
                        key={nodeKey(node)}
                        spacing={1.5}
                        sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, minWidth: 0 }}
                      >
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>
                              {node.label || node.host}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {nodeKey(node)} · {node.role}
                            </Typography>
                          </Box>
                          <Button
                            size="small"
                            color="inherit"
                            disabled={!writable || busy}
                            aria-label={`Remove ${nodeKey(node)} from desired topology`}
                            onClick={() => change({ ...spec, nodes: spec.nodes.filter((_, i) => i !== index) })}
                          >
                            Remove
                          </Button>
                        </Stack>
                        <Autocomplete
                          multiple
                          options={spec.apps}
                          value={node.apps}
                          disabled={!writable || busy}
                          onChange={(_, apps) =>
                            change({
                              ...spec,
                              nodes: spec.nodes.map((value, i) => (i === index ? { ...value, apps } : value)),
                            })
                          }
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              label={`Applications on ${node.label || node.host}`}
                              helperText={
                                node.apps.length
                                  ? undefined
                                  : 'No application processes assigned; stack infrastructure may still run here.'
                              }
                            />
                          )}
                        />
                      </Stack>
                    ))}
                    {spec.type !== 'local' && (
                      <Autocomplete
                        value={null}
                        options={workspace.availableNodes.filter(
                          (node) => !spec.nodes.some((current) => nodeKey(current) === nodeKey(node))
                        )}
                        disabled={!writable || busy || (spec.type === 'remote' && spec.nodes.length >= 1)}
                        getOptionLabel={(node) => `${node.name} · ${nodeKey(node)}`}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="Add fleet node"
                            helperText={
                              spec.type === 'remote'
                                ? 'Remote stacks use one node; cluster stacks support multiple nodes.'
                                : 'Applications must be explicitly assigned to a new node.'
                            }
                          />
                        )}
                        onChange={(_, node) => {
                          if (node)
                            change({
                              ...spec,
                              nodes: [
                                ...spec.nodes,
                                { host: node.host, port: node.port, role: 'app', label: node.name, apps: [] },
                              ],
                            });
                        }}
                      />
                    )}
                    <Typography variant="caption" color="text.secondary">
                      Process runtimes use application definitions. Docker, host services and their connection settings
                      come from the project infrastructure declarations.
                    </Typography>
                    {workspace.services.length > 0 && (
                      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
                        {workspace.services.map((service) => (
                          <Chip
                            size="small"
                            key={service.name}
                            label={`${service.name} · ${service.runtime}${service.stateful === true ? ' · persistent' : ' · state unverified'}`}
                          />
                        ))}
                      </Stack>
                    )}
                  </Stack>
                )}
                {tab === 'connections' && (
                  <Stack spacing={1.5}>
                    <Typography variant="body2" color="text.secondary">
                      Connections are derived from launch configuration and declared dependencies. They do not prove
                      live network traffic.
                    </Typography>
                    {workspace.dependencies.map((dependency, i) => (
                      <Box key={i} sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1, overflowWrap: 'anywhere' }}>
                        <Typography variant="body2">
                          {dependency.app} →{' '}
                          {dependency.targetApp ?? `${dependency.service} · ${dependency.host}:${dependency.port}`}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {dependency.evidence} · {dependency.via}
                        </Typography>
                      </Box>
                    ))}
                    {!workspace.dependencies.length && (
                      <Typography variant="body2" color="text.secondary">
                        No connections were resolved from the available declarations.
                      </Typography>
                    )}
                    {workspace.warnings.map((warning, i) => (
                      <Alert key={i} severity="warning">
                        {warning}
                      </Alert>
                    ))}
                  </Stack>
                )}
                {tab === 'review' && plan && (
                  <Stack spacing={1.5}>
                    <Typography variant="body2">
                      {plan.changes.length} placement changes ·{' '}
                      {plan.status === 'applied'
                        ? 'Target accepted · runtime unchanged'
                        : `Expires ${new Date(plan.expiresAt).toLocaleTimeString()}`}
                    </Typography>
                    {plan.changes.map((item, index) => (
                      <Stack
                        key={index}
                        direction="row"
                        spacing={1.5}
                        sx={{
                          alignItems: 'center',
                          p: 1.25,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                          minWidth: 0,
                        }}
                      >
                        <Chip size="small" color={item.action === 'remove' ? 'warning' : 'info'} label={item.action} />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                            {item.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                            {item.resource} · {item.node}
                          </Typography>
                          {item.fields?.map((field) => (
                            <Typography key={field.field} variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                              {field.field}: {field.before ?? '(unset)'} → {field.after ?? '(unset)'}
                            </Typography>
                          ))}
                        </Box>
                      </Stack>
                    ))}
                    {!plan.changes.length && (
                      <Typography variant="body2" color="text.secondary">
                        Placement is unchanged.
                      </Typography>
                    )}
                    {plan.issues.map((issue, i) => (
                      <Alert key={`${issue.code}:${i}`} severity={issue.severity}>
                        {issue.message}
                      </Alert>
                    ))}
                  </Stack>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: { xs: 1.5, sm: 2.5 }, py: 1.5, gap: 1, flexWrap: 'wrap' }}>
          <Button color="inherit" onClick={exportSpec} disabled={!spec || busy}>
            Export JSON
          </Button>
          <Button
            color="inherit"
            disabled={busy || loading}
            onClick={() => (dirty ? setRefresh(true) : void reload(false))}
          >
            Reload
          </Button>
          {error && spec && writable && (
            <Button disabled={busy} onClick={() => void reload(true)}>
              Rebase edits
            </Button>
          )}
          <Box sx={{ flex: '1 1 0' }} />
          <Button
            onClick={() =>
              void run(async () => {
                await save();
                setMessage('Draft saved');
              })
            }
            disabled={!writable || busy || !spec || (!dirty && !!workspace?.draft)}
          >
            Save draft
          </Button>
          {tab === 'review' && plan && plan.status === 'planned' ? (
            <Button
              variant="contained"
              disabled={
                !can('OmnitronProject.applyTopologyPlan') ||
                busy ||
                dirty ||
                plan.issues.some((issue) => issue.severity === 'error')
              }
              onClick={() =>
                void run(async () => {
                  const applied = await project.applyTopologyPlan({ ...scope, plan: plan.id });
                  if (!alive.current) return;
                  setPlan(applied);
                  setMessage('Target accepted. Deployment and restart configuration are unchanged.');
                  const next = await project.getTopologyWorkspace(scope);
                  if (alive.current) {
                    setWorkspace(next);
                    setSpec(next.desired);
                    setSaved(JSON.stringify(next.desired));
                  }
                  onApplied();
                })
              }
            >
              Accept target
            </Button>
          ) : (
            <Button
              variant="contained"
              disabled={!can('OmnitronProject.planTopology') || busy || !spec}
              onClick={() => void buildPlan()}
            >
              Review plan
            </Button>
          )}
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={discard}
        onClose={() => setDiscard(false)}
        onConfirm={onClose}
        title="Discard unsaved changes?"
        content="Your saved draft remains available."
        confirmLabel="Discard changes"
      />
      <ConfirmDialog
        open={refresh}
        onClose={() => setRefresh(false)}
        onConfirm={() => void reload(false)}
        title="Reload saved topology?"
        content="This replaces your unsaved edits with the latest saved draft or accepted target."
        confirmLabel="Reload saved topology"
      />
    </>
  );
}

/** Stack selection is available in the workspace itself, including the global map. */
export function TopologyWorkspaceLauncher({
  initialProject,
  initialStack,
  onClose,
  onApplied,
}: {
  initialProject: string | null;
  initialStack: string | null;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [selectedProject, setSelectedProject] = useState(initialProject ?? '');
  const [selectedStack, setSelectedStack] = useState(initialStack ?? '');
  const [projects, setProjects] = useState<string[]>([]);
  const [stacks, setStacks] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(Boolean(initialProject && initialStack));
  useEffect(() => {
    let current = true;
    project
      .listProjects()
      .then((values) => {
        if (current) setProjects(values.filter((value) => value.totalStacks > 0).map((value) => value.name));
      })
      .catch((err) => {
        if (current) setError(String(err.message));
      });
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    if (!selectedProject) return undefined;
    let current = true;
    setStacks([]);
    project
      .listStacks({ project: selectedProject })
      .then((values) => {
        if (current) setStacks(values.map((value) => value.name));
      })
      .catch((err) => {
        if (current) setError(String(err.message));
      });
    return () => {
      current = false;
    };
  }, [selectedProject]);
  if (editing)
    return (
      <TopologyEditor projectName={selectedProject} stackName={selectedStack} onClose={onClose} onApplied={onApplied} />
    );
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="choose-topology-title">
      <DialogTitle id="choose-topology-title">Topology workspace</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            select
            label="Project"
            value={selectedProject}
            onChange={(event) => {
              setSelectedProject(event.target.value);
              setSelectedStack('');
              setError(null);
            }}
          >
            {[...new Set([...projects, ...(selectedProject ? [selectedProject] : [])])].map((name) => (
              <MenuItem key={name} value={name}>
                {name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Stack"
            value={stacks.includes(selectedStack) ? selectedStack : ''}
            disabled={!selectedProject || !stacks.length}
            onChange={(event) => setSelectedStack(event.target.value)}
          >
            {stacks.map((name) => (
              <MenuItem key={name} value={name}>
                {name}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!selectedProject || !stacks.includes(selectedStack)}
          onClick={() => setEditing(true)}
        >
          Open workspace
        </Button>
      </DialogActions>
    </Dialog>
  );
}
