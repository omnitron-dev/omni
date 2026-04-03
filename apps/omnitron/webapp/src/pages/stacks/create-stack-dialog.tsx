/**
 * CreateStackDialog — Multi-step wizard for creating a new stack.
 *
 * Steps:
 *   1. Type     — Local / Remote / Cluster
 *   2. Nodes    — Select target node(s) (skipped for local)
 *   3. Apps     — Select which applications to include
 *   4. Name     — Name the stack + review summary
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Stack from '@mui/material/Stack';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Chip from '@mui/material/Chip';
import { alpha } from '@mui/material/styles';
import { Stepper, useStepper, type StepItem } from '@omnitron-dev/prism';
import { daemon, nodes as nodesRpc, project as projectRpc } from 'src/netron/client';
import { useProjectStore } from 'src/stores/project.store';

// =============================================================================
// Types
// =============================================================================

type StackType = 'local' | 'remote' | 'cluster';

interface NodeInfo {
  id: string;
  name: string;
  host: string;
  status: 'online' | 'offline' | string;
}

interface CreateStackDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

// =============================================================================
// Constants
// =============================================================================

const STACK_TYPES: { value: StackType; title: string; description: string }[] = [
  {
    value: 'local',
    title: 'Local',
    description: 'Run everything on this machine. Docker containers for infrastructure.',
  },
  {
    value: 'remote',
    title: 'Remote',
    description: 'Deploy to a single remote server via SSH.',
  },
  {
    value: 'cluster',
    title: 'Cluster',
    description: 'Distribute across multiple nodes.',
  },
];

const STEPS: StepItem[] = [
  { label: 'Type' },
  { label: 'Nodes' },
  { label: 'Applications' },
  { label: 'Name' },
];

// =============================================================================
// Component
// =============================================================================

export default function CreateStackDialog({ open, onClose, onCreated }: CreateStackDialogProps) {
  const createStack = useProjectStore((s) => s.createStack);
  const activeProject = useProjectStore((s) => s.activeProject);

  // --- wizard state ---
  const [type, setType] = useState<StackType | null>(null);
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [selectedApps, setSelectedApps] = useState<string[]>([]);
  const [stackName, setStackName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- remote data ---
  const [remoteNodes, setRemoteNodes] = useState<NodeInfo[]>([]);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [apps, setApps] = useState<{ name: string }[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);

  // --- effective steps (skip "Nodes" for local) ---
  const effectiveSteps = useMemo<StepItem[]>(() => {
    if (type === 'local') {
      return STEPS.filter((s) => s.label !== 'Nodes');
    }
    return STEPS;
  }, [type]);

  const stepper = useStepper({ totalSteps: effectiveSteps.length });

  // --- Fetch nodes when entering Nodes step ---
  useEffect(() => {
    if (!open) return;
    const nodesStepIndex = effectiveSteps.findIndex((s) => s.label === 'Nodes');
    if (stepper.activeStep === nodesStepIndex && nodesStepIndex !== -1) {
      setNodesLoading(true);
      nodesRpc
        .listNodes()
        .then((result: any) => {
          const list = Array.isArray(result) ? result : result?.nodes ?? [];
          setRemoteNodes(list);
        })
        .catch(() => setRemoteNodes([]))
        .finally(() => setNodesLoading(false));
    }
  }, [open, stepper.activeStep, effectiveSteps]);

  // --- Fetch apps when entering Applications step ---
  useEffect(() => {
    if (!open) return;
    const appsStepIndex = effectiveSteps.findIndex((s) => s.label === 'Applications');
    if (stepper.activeStep === appsStepIndex) {
      setAppsLoading(true);
      // Fetch configured apps from project (not runtime — apps may not be running)
      const activeProject = useProjectStore.getState().activeProject;
      if (activeProject) {
        projectRpc.scanRequirements({ project: activeProject })
          .then((reqs: any) => {
            const appNames = Object.keys(reqs?.apps ?? {});
            const list = appNames.map((name: string) => ({ name }));
            setApps(list);
            if (selectedApps.length === 0) {
              setSelectedApps(appNames);
            }
          })
          .catch(() => {
            // Fallback: try runtime list
            daemon.list()
              .then((result: any) => {
                const list = Array.isArray(result) ? result : [];
                setApps(list);
                if (selectedApps.length === 0) {
                  setSelectedApps(list.map((a: any) => a.name));
                }
              })
              .catch(() => setApps([]));
          })
          .finally(() => setAppsLoading(false));
      } else {
        setAppsLoading(false);
      }
    }
  }, [open, stepper.activeStep, effectiveSteps]);

  // --- Auto-suggest name when entering Name step ---
  useEffect(() => {
    if (!open) return;
    const nameStepIndex = effectiveSteps.findIndex((s) => s.label === 'Name');
    if (stepper.activeStep === nameStepIndex && !stackName) {
      const prefix = type === 'cluster' ? 'prod' : type === 'remote' ? 'staging' : 'dev';
      setStackName(`${prefix}-1`);
    }
  }, [open, stepper.activeStep, effectiveSteps, type, stackName]);

  // --- Reset state on close ---
  const resetForm = useCallback(() => {
    setType(null);
    setSelectedNodes([]);
    setSelectedApps([]);
    setStackName('');
    setError(null);
    setSubmitting(false);
    setRemoteNodes([]);
    setApps([]);
    stepper.reset();
  }, [stepper]);

  const handleClose = useCallback(() => {
    if (!submitting) {
      resetForm();
      onClose();
    }
  }, [submitting, resetForm, onClose]);

  // --- Navigation logic ---
  const currentStepLabel = effectiveSteps[stepper.activeStep]?.label;

  const canProceed = useMemo(() => {
    switch (currentStepLabel) {
      case 'Type':
        return type !== null;
      case 'Nodes':
        if (type === 'remote') return selectedNodes.length === 1;
        if (type === 'cluster') return selectedNodes.length >= 2;
        return true;
      case 'Applications':
        return selectedApps.length > 0;
      case 'Name':
        return /^[a-z][a-z0-9-]*$/.test(stackName);
      default:
        return false;
    }
  }, [currentStepLabel, type, selectedNodes, selectedApps, stackName]);

  const handleNext = useCallback(() => {
    if (stepper.isLastStep) {
      handleSubmit();
    } else {
      stepper.nextStep();
    }
  }, [stepper]);

  const handleSubmit = useCallback(async () => {
    if (!activeProject || !type) return;

    setSubmitting(true);
    setError(null);

    try {
      await createStack(activeProject, {
        name: stackName.trim(),
        type,
        apps: selectedApps.length === apps.length ? 'all' : selectedApps,
        nodeIds: type !== 'local' ? selectedNodes : undefined,
      });
      resetForm();
      onCreated();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create stack.');
    } finally {
      setSubmitting(false);
    }
  }, [activeProject, type, stackName, selectedApps, apps.length, selectedNodes, createStack, resetForm, onCreated]);

  // --- Node toggle ---
  const toggleNode = useCallback(
    (nodeId: string) => {
      if (type === 'remote') {
        setSelectedNodes((prev) => (prev.includes(nodeId) ? [] : [nodeId]));
      } else {
        setSelectedNodes((prev) =>
          prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]
        );
      }
    },
    [type]
  );

  // --- App toggle ---
  const toggleApp = useCallback((appName: string) => {
    setSelectedApps((prev) =>
      prev.includes(appName) ? prev.filter((n) => n !== appName) : [...prev, appName]
    );
  }, []);

  const toggleAllApps = useCallback(() => {
    if (selectedApps.length === apps.length) {
      setSelectedApps([]);
    } else {
      setSelectedApps(apps.map((a) => a.name));
    }
  }, [selectedApps.length, apps]);

  // --- Render ---
  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Create Stack</DialogTitle>

      <DialogContent>
        <Box sx={{ mb: 3, mt: 1 }}>
          <Stepper steps={effectiveSteps} activeStep={stepper.activeStep} alternativeLabel />
        </Box>

        {error && (
          <Alert severity="error" variant="outlined" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Step: Type */}
        {currentStepLabel === 'Type' && (
          <Stack spacing={1.5}>
            {STACK_TYPES.map((st) => (
              <Card
                key={st.value}
                variant="outlined"
                onClick={() => setType(st.value)}
                sx={{
                  cursor: 'pointer',
                  transition: 'border-color 0.2s, background-color 0.2s',
                  borderColor: type === st.value
                    ? (t) => t.palette.primary.main
                    : undefined,
                  bgcolor: type === st.value
                    ? (t) => alpha(t.palette.primary.main, 0.06)
                    : undefined,
                  '&:hover': {
                    borderColor: (t) => alpha(t.palette.primary.main, 0.4),
                  },
                }}
              >
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {st.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {st.description}
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}

        {/* Step: Nodes */}
        {currentStepLabel === 'Nodes' && (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {type === 'remote'
                ? 'Select a target node for deployment.'
                : 'Select at least 2 nodes for the cluster.'}
            </Typography>

            {nodesLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={28} />
              </Box>
            ) : remoteNodes.length === 0 ? (
              <Alert severity="info" variant="outlined">
                No remote nodes configured. Add nodes in the Nodes section first.
              </Alert>
            ) : (
              remoteNodes.map((node) => {
                const isSelected = selectedNodes.includes(node.id);
                const isOnline = node.status === 'online';
                return (
                  <Card
                    key={node.id}
                    variant="outlined"
                    onClick={() => toggleNode(node.id)}
                    sx={{
                      cursor: 'pointer',
                      transition: 'border-color 0.2s, background-color 0.2s',
                      borderColor: isSelected
                        ? (t) => t.palette.primary.main
                        : undefined,
                      bgcolor: isSelected
                        ? (t) => alpha(t.palette.primary.main, 0.06)
                        : undefined,
                      '&:hover': {
                        borderColor: (t) => alpha(t.palette.primary.main, 0.4),
                      },
                    }}
                  >
                    <CardContent
                      sx={{
                        py: 1.5,
                        '&:last-child': { pb: 1.5 },
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {node.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                          {node.host}
                        </Typography>
                      </Box>
                      <Chip
                        label={isOnline ? 'Online' : 'Offline'}
                        color={isOnline ? 'success' : 'default'}
                        size="small"
                        sx={{ height: 20, fontSize: '0.65rem' }}
                      />
                    </CardContent>
                  </Card>
                );
              })
            )}
          </Stack>
        )}

        {/* Step: Applications */}
        {currentStepLabel === 'Applications' && (
          <Stack spacing={1}>
            {appsLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={28} />
              </Box>
            ) : apps.length === 0 ? (
              <Alert severity="info" variant="outlined">
                No applications found in the project.
              </Alert>
            ) : (
              <>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={selectedApps.length === apps.length}
                      indeterminate={selectedApps.length > 0 && selectedApps.length < apps.length}
                      onChange={toggleAllApps}
                      size="small"
                    />
                  }
                  label={
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      Select All
                    </Typography>
                  }
                  sx={{ mb: 0.5 }}
                />
                {apps.map((app) => (
                  <FormControlLabel
                    key={app.name}
                    control={
                      <Checkbox
                        checked={selectedApps.includes(app.name)}
                        onChange={() => toggleApp(app.name)}
                        size="small"
                      />
                    }
                    label={
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {app.name}
                      </Typography>
                    }
                    sx={{ ml: 1 }}
                  />
                ))}
              </>
            )}
          </Stack>
        )}

        {/* Step: Name & Review */}
        {currentStepLabel === 'Name' && (
          <Stack spacing={2.5}>
            <TextField
              label="Stack Name"
              value={stackName}
              onChange={(e) => setStackName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="e.g., dev-1, staging, prod"
              fullWidth
              size="small"
              helperText="Lowercase letters, numbers, and hyphens only."
              slotProps={{
                input: { sx: { fontFamily: 'monospace' } },
              }}
            />

            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                Review
              </Typography>
              <Stack spacing={0.5}>
                <ReviewRow label="Type" value={type ?? ''} />
                {type !== 'local' && (
                  <ReviewRow
                    label="Nodes"
                    value={
                      selectedNodes.length > 0
                        ? remoteNodes
                            .filter((n) => selectedNodes.includes(n.id))
                            .map((n) => n.name)
                            .join(', ')
                        : 'None'
                    }
                  />
                )}
                <ReviewRow
                  label="Applications"
                  value={
                    selectedApps.length === apps.length
                      ? `All (${apps.length})`
                      : `${selectedApps.length} of ${apps.length}`
                  }
                />
              </Stack>
            </Box>
          </Stack>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={handleClose} disabled={submitting}>
          Cancel
        </Button>
        <Box sx={{ flex: 1 }} />
        {!stepper.isFirstStep && (
          <Button onClick={stepper.prevStep} disabled={submitting}>
            Back
          </Button>
        )}
        <Button
          variant="contained"
          onClick={handleNext}
          disabled={!canProceed || submitting}
          startIcon={submitting ? <CircularProgress size={16} /> : undefined}
        >
          {stepper.isLastStep ? 'Create' : 'Next'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'capitalize' }}>
        {value}
      </Typography>
    </Box>
  );
}
