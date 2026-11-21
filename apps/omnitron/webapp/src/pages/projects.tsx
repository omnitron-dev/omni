import { useId, useState, useEffect, useCallback } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import CardActions from '@mui/material/CardActions';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Tooltip from '@mui/material/Tooltip';
import Stack from '@mui/material/Stack';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Divider from '@mui/material/Divider';

import { Alert } from '@omnitron-dev/prism/components/alert';
import { Can, useAccess } from 'src/auth/access';
import { Breadcrumbs } from 'src/components/page-breadcrumbs';
import { EmptyContent } from '@omnitron-dev/prism/components/empty-content';
import { Label } from '@omnitron-dev/prism/components/label';
import { Skeleton } from '@omnitron-dev/prism/components/skeleton';
import { useSnackbar } from '@omnitron-dev/prism/components/snackbar';
import { project as projectRpc } from 'src/netron/client';
import { ImportStacksDialog } from 'src/components/import-stacks-dialog';
import { CreateProjectDialog } from 'src/components/create-project-dialog';
import { useProjectStore, workspaceBookmark } from 'src/stores/project.store';
import type { IProjectInfo } from '@omnitron-dev/omnitron/dto/services';
import { timeAgo } from 'src/utils/formatters';
import { usePollingEffect } from 'src/hooks/use-polled-resource';
import { PlusIcon, RefreshIcon, SettingsIcon, DeleteIcon, ProjectIcon } from 'src/assets/icons';

// =============================================================================
// Project Card
// =============================================================================

function ProjectCard({
  project,
  onEdit,
  onRemove,
  href,
  onImport,
}: {
  project: IProjectInfo;
  onEdit: (p: IProjectInfo) => void;
  onRemove: (name: string) => void;
  href: string;
  onImport: (p: IProjectInfo) => void;
}) {
  const titleId = useId();
  const { can } = useAccess();
  const hasRunning = project.runningStacks > 0;
  const title = project.displayName.trim() || project.name;
  const showIdentifier = title.toLowerCase() !== project.name.toLowerCase();
  const imported = project.configurations?.reduce((count, source) =>
    count + Object.keys(source.stacks).length, 0) ?? 0;
  const canRemove = can('OmnitronProject.removeProject');
  const canImport = can('OmnitronProject.importConfiguration');
  const canEdit = can('OmnitronProject.updateProject');

  return (
    <Card component="article" aria-labelledby={titleId} variant="outlined"
      sx={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      <CardActionArea component={RouterLink} to={href} aria-labelledby={titleId}
        sx={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', textAlign: 'start' }}>
        <CardContent sx={{ width: '100%', minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
            <ProjectIcon sx={{ fontSize: 24, color: hasRunning ? 'primary.main' : 'text.secondary', flexShrink: 0 }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography id={titleId} component="h2" variant="subtitle1" title={title} noWrap>{title}</Typography>
              {showIdentifier && <Typography component="p" variant="caption" color="text.secondary" noWrap title={project.name}>
                {project.name}
              </Typography>}
            </Box>
          </Stack>
          <Label color={hasRunning ? 'success' : 'default'}>
            {project.runningStacks} of {project.totalStacks} registered {project.totalStacks === 1 ? 'stack' : 'stacks'} active
          </Label>
          {imported > 0 && imported <= project.totalStacks && (
            <Typography component="p" variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
              {project.totalStacks - imported} in primary configuration · {imported} imported
            </Typography>
          )}
          <Divider sx={{ my: 1.5 }} />
          <Stack spacing={0.5}>
            <DetailRow label="Path" value={project.path} mono />
            {project.enabledStacks?.length > 0 && <DetailRow label="Enabled stacks" value={project.enabledStacks.join(', ')} />}
            {project.registeredAt && <DetailRow label="Registered" value={timeAgo(project.registeredAt)} />}
          </Stack>
        </CardContent>
      </CardActionArea>
      {(canRemove || canImport || canEdit) && (
        <CardActions sx={{ px: 2, pb: 1.5, gap: 1, flexWrap: 'wrap' }}>
          {canRemove && <Tooltip title={hasRunning ? 'Stop the running stacks before removing this project' : 'Remove project'}>
            <span><IconButton size="small" color="error" aria-label={`Remove project ${project.name}`}
              onClick={() => onRemove(project.name)} disabled={hasRunning}><DeleteIcon sx={{ fontSize: 18 }} /></IconButton></span>
          </Tooltip>}
          <Box sx={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            {canImport && <Button size="small" onClick={() => onImport(project)}>Import stacks</Button>}
            {canEdit && <Tooltip title="Project settings">
              <IconButton size="small" aria-label={`Settings for ${project.name}`} onClick={() => onEdit(project)}>
                <SettingsIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>}
          </Box>
        </CardActions>
      )}
    </Card>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <Typography
        variant="caption"
        sx={{
          color: 'text.secondary',
          flexShrink: 0,
        }}
      >
        {label}
      </Typography>
      <Typography
        variant="caption"
        noWrap
        title={value}
        sx={{
          fontWeight: 500,
          textAlign: 'end',
          minWidth: 0,
          ...(mono && { fontFamily: 'monospace', fontSize: 11 }),
        }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

// =============================================================================
// Edit Project Dialog
// =============================================================================

function EditProjectDialog({
  open,
  onClose,
  project,
  onSave,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  project: IProjectInfo | null;
  onSave: (name: string, data: { path: string }) => void;
  loading: boolean;
}) {
  const [path, setPath] = useState('');

  useEffect(() => {
    if (open && project) {
      setPath(project.path);
    }
  }, [open, project]);

  if (!project) return null;

  const changed = path.trim() !== project.path;
  const canSubmit = path.trim().length > 0 && changed;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Project Settings — {project.displayName}</DialogTitle>
      <DialogContent>
        <Stack
          spacing={2.5}
          sx={{
            mt: 1,
          }}
        >
          <TextField
            label="Project Name"
            value={project.displayName}
            disabled
            fullWidth
            helperText="Derived from omnitron.config.ts — change it there to rename."
          />
          <TextField label="Registry Name" value={project.name} disabled fullWidth size="small" />
          <TextField
            label="Project Path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            fullWidth
            placeholder="/absolute/path/to/project"
            helperText="Absolute path to the monorepo root containing omnitron.config.ts"
            slotProps={{
              input: {
                sx: { fontFamily: 'monospace', fontSize: 14 },
              },
            }}
          />
          {(project.configurations?.length ?? 0) > 1 && (
            <Stack spacing={1}>
              <Typography variant="subtitle2">Stack configurations</Typography>
              {project.configurations?.map(source => (
                <Box key={source.runtimeProject} sx={{ minWidth: 0 }}>
                  <Typography variant="body2">{source.name} · {Object.values(source.stacks).join(', ') || 'Default stacks'}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>{source.path}</Typography>
                </Box>
              ))}
            </Stack>
          )}
          <TextField
            label="Registered"
            value={new Date(project.registeredAt).toLocaleString()}
            disabled
            fullWidth
            size="small"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Can permission="OmnitronProject.updateProject">
          <Button
            variant="contained"
            onClick={() => onSave(project.name, { path: path.trim() })}
            disabled={!canSubmit || loading}
          >
            Save
          </Button>
        </Can>
      </DialogActions>
    </Dialog>
  );
}

// =============================================================================
// Add Project Dialog
// =============================================================================

function AddProjectDialog({
  open,
  onClose,
  onAdd,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (name: string, path: string) => void;
  loading: boolean;
}) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setPath('');
    }
  }, [open]);

  const canSubmit = name.trim().length > 0 && path.trim().length > 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add existing project</DialogTitle>
      <DialogContent>
        <Stack
          spacing={2.5}
          sx={{
            mt: 1,
          }}
        >
          <TextField
            label="Project Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            autoFocus
            placeholder="my-project"
            helperText="Unique identifier for the project registry"
          />
          <Typography variant="body2">
            For an existing Xec or Kysera project, run <code>omnitron init --existing --check</code> in its
            directory to preview the configuration, then <code>omnitron init --existing</code> to create it.
          </Typography>
          <TextField
            label="Project Path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            fullWidth
            placeholder="/absolute/path/to/project"
            helperText="Absolute path to the project directory containing its Omnitron configuration"
            slotProps={{
              input: {
                sx: { fontFamily: 'monospace', fontSize: 14 },
              },
            }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Can permission="OmnitronProject.addProject">
          <Button variant="contained" onClick={() => onAdd(name.trim(), path.trim())} disabled={!canSubmit || loading}>
            Add existing project
          </Button>
        </Can>
      </DialogActions>
    </Dialog>
  );
}

// =============================================================================
// Page
// =============================================================================

export default function ProjectsPage() {
  const projects = useProjectStore((s) => s.projects);
  const hasProjectSnapshot = useProjectStore((s) => s.hasProjectSnapshot);
  const loading = useProjectStore((s) => s.loading);
  const error = useProjectStore((s) => s.error);
  const clearError = useProjectStore((s) => s.clearError);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const addProject = useProjectStore((s) => s.addProject);
  const updateProject = useProjectStore((s) => s.updateProject);
  const removeProject = useProjectStore((s) => s.removeProject);
  const routes = useProjectStore((s) => s.workspaceRoutes);
  const snackbar = useSnackbar();
  const { can } = useAccess();
  const [searchParams, setSearchParams] = useSearchParams();

  const [editProject, setEditProject] = useState<IProjectInfo | null>(null);
  const [importProject, setImportProject] = useState<IProjectInfo | null>(null);
  const addOpen = searchParams.get('add') === '1' && can('OmnitronProject.addProject');
  const createOpen = searchParams.get('create') === '1' && can('OmnitronProject.reviewProjectCreation') && can('OmnitronProject.createProject');
  const setProjectForm = useCallback(
    (action: 'add' | 'create', open: boolean) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.delete('add');
          next.delete('create');
          if (open) next.set(action, '1');
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );
  const setAddOpen = useCallback((open: boolean) => setProjectForm('add', open), [setProjectForm]);
  const setCreateOpen = (open: boolean) => setProjectForm('create', open);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // State lives in the project store; this takes the schedule only — and with
  // it the pause on a hidden tab.
  usePollingEffect(() => void fetchProjects(), { intervalMs: 15_000 });


  const handleAdd = useCallback(
    async (name: string, path: string) => {
      setSubmitting(true);
      try {
        await addProject(name, path);
        setAddOpen(false);
        snackbar.success(`Project "${name}" added`);
      } catch (err: any) {
        snackbar.error(err?.message ?? 'Failed to add project');
      } finally {
        setSubmitting(false);
      }
    },
    [addProject, snackbar, setAddOpen]
  );

  const handleSave = useCallback(
    async (name: string, data: { path: string }) => {
      setSubmitting(true);
      try {
        await updateProject(name, data);
        setEditProject(null);
        snackbar.success(`Project "${name}" updated`);
      } catch (err: any) {
        snackbar.error(err?.message ?? 'Failed to update project');
      } finally {
        setSubmitting(false);
      }
    },
    [updateProject, snackbar]
  );

  const handleRemove = useCallback(async () => {
    if (!confirmRemove) return;
    setSubmitting(true);
    try {
      await removeProject(confirmRemove);
      snackbar.success(`Project "${confirmRemove}" removed`);
    } catch (err: any) {
      snackbar.error(err?.message ?? 'Failed to remove project');
    } finally {
      setConfirmRemove(null);
      setSubmitting(false);
    }
  }, [confirmRemove, removeProject, snackbar]);

  const confirmProject = projects.find((p) => p.name === confirmRemove);

  return (
    <Stack spacing={3}>
      <Breadcrumbs
        links={[{ name: 'Projects' }]}
        action={
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Button
              data-console-command="refresh"
              variant="outlined"
              size="small"
              startIcon={<RefreshIcon sx={{ fontSize: 18 }} />}
              onClick={() => fetchProjects()}
              disabled={loading}
            >
              Refresh
            </Button>
            <Can permission="OmnitronProject.addProject">
              <Button
                variant="outlined"
                size="small"
                onClick={() => setAddOpen(true)}
              >
                Add existing project
              </Button>
            </Can>
            {can('OmnitronProject.reviewProjectCreation') && can('OmnitronProject.createProject') &&
              <Button variant="contained" size="small" startIcon={<PlusIcon sx={{ fontSize: 18 }} />}
                onClick={() => setCreateOpen(true)}>Create project</Button>}
          </Stack>
        }
      />

      {projects.length > 0 && can('OmnitronNodes.listNodes') && can('OmnitronNodes.getNodeDaemonStatus') && (
        <Typography variant="body2" color="text.secondary">
          <Link component={RouterLink} to="/nodes">View applications by node</Link>
        </Typography>
      )}
      {error && (
        <Alert closable={projects.length > 0} severity="error" onClose={clearError}>
          {error}
        </Alert>
      )}

      {projects.length === 0 && error ? null : projects.length === 0 && !hasProjectSnapshot ? (
        <Grid container spacing={3}>
          {[1, 2, 3].map((i) => (
            <Grid key={i} size={{ xs: 12, sm: 6, md: 4 }}>
              <Skeleton variant="rounded" height={260} />
            </Grid>
          ))}
        </Grid>
      ) : projects.length === 0 ? (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
          <EmptyContent
            title="No projects"
            description="Create a runnable starter or register an existing project directory."
          />
        </Box>
      ) : (
        <Grid container spacing={3}>
          {projects.map((p) => (
            <Grid key={p.name} size={{ xs: 12, sm: 6, md: 4 }}>
              <ProjectCard project={p} onEdit={setEditProject} onRemove={setConfirmRemove} href={workspaceBookmark(routes, p.name)} onImport={setImportProject} />
            </Grid>
          ))}
        </Grid>
      )}

      {importProject && <ImportStacksDialog project={importProject} onClose={() => setImportProject(null)}
        onImport={async input => { await projectRpc.importConfiguration(input); await fetchProjects(true); }} />}
      {/* Edit dialog */}
      <EditProjectDialog
        open={!!editProject}
        onClose={() => setEditProject(null)}
        project={editProject}
        onSave={handleSave}
        loading={submitting}
      />

      {/* Add dialog */}
      {createOpen && <CreateProjectDialog query={searchParams} onClose={() => setCreateOpen(false)} onCreated={name => {
        setCreateOpen(false);
        void fetchProjects(true);
        snackbar.success(`Project "${name}" created`);
      }} />}
      <AddProjectDialog open={addOpen} onClose={() => setAddOpen(false)} onAdd={handleAdd} loading={submitting} />

      {/* Remove confirmation */}
      <Dialog open={!!confirmRemove} onClose={() => setConfirmRemove(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Remove Project</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Remove <strong>{confirmProject?.displayName ?? confirmRemove}</strong> from the registry? This does not
            delete any files on disk.
          </Typography>
          {confirmProject && confirmProject.runningStacks > 0 && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              This project has {confirmProject.runningStacks} running stack(s). Stop them first.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRemove(null)} color="inherit">
            Cancel
          </Button>
          <Can permission="OmnitronProject.removeProject">
            <Button
              onClick={handleRemove}
              color="error"
              variant="contained"
              disabled={submitting || (confirmProject?.runningStacks ?? 0) > 0}
            >
              Remove
            </Button>
          </Can>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
