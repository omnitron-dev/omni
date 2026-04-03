/**
 * ProjectsPage — Project management in the Omnitron system workspace
 *
 * Card grid showing all registered projects with:
 * - Status indicator (running stacks / total)
 * - Path, registration date, enabled stacks
 * - Edit dialog to change project path
 * - Add / Remove project actions
 *
 * Available in the INFRASTRUCTURE sidebar (no active project required).
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActions from '@mui/material/CardActions';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Skeleton from '@mui/material/Skeleton';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Divider from '@mui/material/Divider';
import { alpha } from '@mui/material/styles';

import { Breadcrumbs, EmptyContent, Label, useSnackbar } from '@omnitron-dev/prism';
import { useProjectStore } from 'src/stores/project.store';
import { project as projectRpc } from 'src/netron/client';
import type { IProjectInfo } from '@omnitron-dev/omnitron/dto/services';
import { timeAgo } from 'src/utils/formatters';
import {
  PlusIcon,
  RefreshIcon,
  SettingsIcon,
  DeleteIcon,
  FolderIcon,
  ProjectIcon,
} from 'src/assets/icons';

// =============================================================================
// Project Card
// =============================================================================

function ProjectCard({
  project,
  onEdit,
  onRemove,
  onOpen,
}: {
  project: IProjectInfo;
  onEdit: (p: IProjectInfo) => void;
  onRemove: (name: string) => void;
  onOpen: (name: string) => void;
}) {
  const hasRunning = project.runningStacks > 0;

  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        '&:hover': {
          borderColor: (t) => alpha(t.palette.primary.main, 0.3),
          boxShadow: (t) => t.shadows[8],
        },
      }}
      variant="outlined"
      onClick={() => onOpen(project.name)}
    >
      <CardContent sx={{ flex: 1, pb: '12px !important' }}>
        {/* Header */}
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" mb={1.5}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
            <ProjectIcon sx={{ fontSize: 28, color: hasRunning ? 'primary.main' : 'text.secondary', flexShrink: 0 }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" fontWeight={700} noWrap>
                {project.displayName}
              </Typography>
              <Typography variant="caption" color="text.disabled" noWrap>
                {project.name}
              </Typography>
            </Box>
          </Stack>
          <Label color={hasRunning ? 'success' : 'default'} sx={{ flexShrink: 0 }}>
            {hasRunning ? `${project.runningStacks} live` : 'idle'}
          </Label>
        </Stack>

        <Divider sx={{ mb: 1.5 }} />

        {/* Path */}
        <DetailRow label="Path" value={project.path} mono />

        {/* Stats */}
        <Stack spacing={0.5} mt={1}>
          <DetailRow label="Stacks" value={`${project.runningStacks} / ${project.totalStacks}`} />
          {project.enabledStacks.length > 0 && (
            <DetailRow label="Enabled" value={project.enabledStacks.join(', ')} />
          )}
          <DetailRow label="Registered" value={timeAgo(project.registeredAt)} />
        </Stack>

        {/* Enabled stacks as chips */}
        {project.enabledStacks.length > 0 && (
          <Stack direction="row" spacing={0.5} mt={1.5} flexWrap="wrap" useFlexGap>
            {project.enabledStacks.map((s) => (
              <Chip key={s} label={s} size="small" variant="outlined" sx={{ height: 22, fontSize: 11 }} />
            ))}
          </Stack>
        )}
      </CardContent>

      <CardActions sx={{ px: 2, pb: 1.5, justifyContent: 'space-between' }} onClick={(e) => e.stopPropagation()}>
        <Tooltip title="Remove project">
          <IconButton
            size="small"
            color="error"
            onClick={() => onRemove(project.name)}
            disabled={hasRunning}
          >
            <DeleteIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Settings">
          <IconButton size="small" onClick={() => onEdit(project)}>
            <SettingsIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </CardActions>
    </Card>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
      <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography
        variant="caption"
        fontWeight={500}
        noWrap
        title={value}
        sx={{
          textAlign: 'right',
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
      <DialogContent sx={{ pt: '8px !important' }}>
        <Stack spacing={2.5} mt={1}>
          <TextField
            label="Project Name"
            value={project.displayName}
            disabled
            fullWidth
            helperText="Derived from omnitron.config.ts — change it there to rename."
          />
          <TextField
            label="Registry Name"
            value={project.name}
            disabled
            fullWidth
            size="small"
          />
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
          <TextField
            label="Registered"
            value={new Date(project.registeredAt).toLocaleString()}
            disabled
            fullWidth
            size="small"
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">Cancel</Button>
        <Button
          variant="contained"
          onClick={() => onSave(project.name, { path: path.trim() })}
          disabled={!canSubmit || loading}
        >
          Save
        </Button>
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
    if (open) { setName(''); setPath(''); }
  }, [open]);

  const canSubmit = name.trim().length > 0 && path.trim().length > 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Project</DialogTitle>
      <DialogContent sx={{ pt: '8px !important' }}>
        <Stack spacing={2.5} mt={1}>
          <TextField
            label="Project Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            autoFocus
            placeholder="my-project"
            helperText="Unique identifier for the project registry"
          />
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
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">Cancel</Button>
        <Button
          variant="contained"
          onClick={() => onAdd(name.trim(), path.trim())}
          disabled={!canSubmit || loading}
        >
          Add Project
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// =============================================================================
// Page
// =============================================================================

export default function ProjectsPage() {
  const projects = useProjectStore((s) => s.projects);
  const loading = useProjectStore((s) => s.loading);
  const error = useProjectStore((s) => s.error);
  const clearError = useProjectStore((s) => s.clearError);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const addProject = useProjectStore((s) => s.addProject);
  const updateProject = useProjectStore((s) => s.updateProject);
  const removeProject = useProjectStore((s) => s.removeProject);
  const selectProject = useProjectStore((s) => s.selectProject);

  const navigate = useNavigate();
  const { pathname } = useLocation();
  const snackbar = useSnackbar();

  const [editProject, setEditProject] = useState<IProjectInfo | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchProjects();
    const iv = setInterval(fetchProjects, 15_000);
    return () => clearInterval(iv);
  }, [fetchProjects]);

  const handleOpenProject = useCallback(
    (name: string) => {
      const targetRoute = selectProject(name, pathname);
      navigate(targetRoute);
    },
    [selectProject, navigate, pathname]
  );

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
    [addProject, snackbar]
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
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<RefreshIcon sx={{ fontSize: 18 }} />}
              onClick={() => fetchProjects()}
            >
              Refresh
            </Button>
            <Button
              variant="contained"
              size="small"
              startIcon={<PlusIcon sx={{ fontSize: 18 }} />}
              onClick={() => setAddOpen(true)}
            >
              Add Project
            </Button>
          </Stack>
        }
      />

      {error && (
        <Alert severity="error" onClose={clearError}>{error}</Alert>
      )}

      {loading && projects.length === 0 ? (
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
            description="Register your first project to get started. A project is a monorepo with omnitron.config.ts at the root."
          />
        </Box>
      ) : (
        <Grid container spacing={3}>
          {projects.map((p) => (
            <Grid key={p.name} size={{ xs: 12, sm: 6, md: 4 }}>
              <ProjectCard
                project={p}
                onEdit={setEditProject}
                onRemove={setConfirmRemove}
                onOpen={handleOpenProject}
              />
            </Grid>
          ))}
        </Grid>
      )}

      {/* Edit dialog */}
      <EditProjectDialog
        open={!!editProject}
        onClose={() => setEditProject(null)}
        project={editProject}
        onSave={handleSave}
        loading={submitting}
      />

      {/* Add dialog */}
      <AddProjectDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={handleAdd}
        loading={submitting}
      />

      {/* Remove confirmation */}
      <Dialog open={!!confirmRemove} onClose={() => setConfirmRemove(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Remove Project</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Remove <strong>{confirmProject?.displayName ?? confirmRemove}</strong> from the registry?
            This does not delete any files on disk.
          </Typography>
          {confirmProject && confirmProject.runningStacks > 0 && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              This project has {confirmProject.runningStacks} running stack(s). Stop them first.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRemove(null)} color="inherit">Cancel</Button>
          <Button
            onClick={handleRemove}
            color="error"
            variant="contained"
            disabled={submitting || (confirmProject?.runningStacks ?? 0) > 0}
          >
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
