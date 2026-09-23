import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';

import { DeployIcon, PlusIcon, RefreshIcon } from 'src/assets/icons';
import { AdminDataTable, Alert, Breadcrumbs, type ColumnDef } from '@omnitron-dev/prism';
import { deploy, project } from 'src/netron/client';
import { DeployProgressList } from 'src/components/deploy-progress';
import { formatDate, formatDuration } from 'src/utils/formatters';
import { useAuthStore } from 'src/auth/store';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { settledPair } from 'src/utils/settled-pair';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// The daemon's shape, not a local guess. The page used to declare its own
// `Deployment` with a `duration` field the server has never sent — duration
// is derived from startedAt/completedAt, which the record does carry.
type Deployment = import('@omnitron-dev/omnitron/dto/services').DeploymentRecord;
type DeployProgressRecord = import('@omnitron-dev/omnitron/dto/services').DeployProgressRecord;

/** Elapsed ms for a finished deployment; null while it is still running. */
function deploymentDuration(dep: Deployment): number | null {
  if (!dep.completedAt) return null;
  return new Date(dep.completedAt).getTime() - new Date(dep.startedAt).getTime();
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, 'success' | 'error' | 'info' | 'warning'> = {
  success: 'success',
  failed: 'error',
  deploying: 'info',
  rolled_back: 'warning',
};

const STATUS_LABELS: Record<string, string> = {
  success: 'Success',
  failed: 'Failed',
  deploying: 'Deploying',
  rolled_back: 'Rolled Back',
};

const STRATEGIES: { value: string; label: string }[] = [
  { value: 'all-at-once', label: 'All at Once' },
  { value: 'rolling', label: 'Rolling' },
  { value: 'blue-green', label: 'Blue/Green' },
  { value: 'canary', label: 'Canary' },
];



// ---------------------------------------------------------------------------
// Deploy Dialog
// ---------------------------------------------------------------------------

interface DeployDialogProps {
  open: boolean;
  onClose: () => void;
  onDeploy: (app: string, version: string, strategy: string) => void;
  apps: string[];
}

function DeployDialog({ open, onClose, onDeploy, apps }: DeployDialogProps) {
  const [app, setApp] = useState('');
  const [version, setVersion] = useState('');
  const [strategy, setStrategy] = useState('all-at-once');

  const handleSubmit = () => {
    if (!app || !version) return;
    onDeploy(app, version, strategy);
    setApp('');
    setVersion('');
    setStrategy('all-at-once');
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>New Deployment</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          <TextField
            select
            label="Application"
            value={app}
            onChange={(e) => setApp(e.target.value)}
            size="small"
            fullWidth
          >
            {apps.length > 0
              ? apps.map((a) => (
                  <MenuItem key={a} value={a}>
                    {a}
                  </MenuItem>
                ))
              : (
                  <MenuItem disabled value="">
                    No applications available
                  </MenuItem>
                )}
          </TextField>
          <TextField
            label="Version"
            placeholder="e.g. 1.2.0"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            size="small"
            fullWidth
          />
          <TextField
            select
            label="Strategy"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            size="small"
            fullWidth
          >
            {STRATEGIES.map((s) => (
              <MenuItem key={s.value} value={s.value}>
                {s.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small">
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          size="small"
          disabled={!app || !version}
          startIcon={<DeployIcon />}
        >
          Deploy
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Deployments Page
// ---------------------------------------------------------------------------

export default function DeploymentsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, loading, error, refresh: fetchDeployments } = usePolledResource(
    async () => {
      const { first, second, partialFailure } = await settledPair<Deployment[], string[]>(
        [deploy.getHistory(), deploy.listDeployableApps()],
        [[], []]
      );
      return { deployments: first, availableApps: second, partialFailure };
    },
    { intervalMs: 15_000 }
  );

  // Faster than the history, and on its own poll: this is the only reading
  // that changes DURING a deployment, and fifteen seconds is a long time to
  // watch a bar that is not moving when the question is whether anything is
  // happening at all. Its own resource, so a daemon that cannot answer it
  // does not blank the table beside it.
  const { data: progress } = usePolledResource<DeployProgressRecord[]>(
    () => project.getDeployProgress(),
    { intervalMs: 3_000 }
  );

  // A failed button press is a different thing from a stale poll.
  const [actionError, setActionError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const deployments = data?.deployments ?? [];
  const availableApps = data?.availableApps ?? [];
  const partialFailure = data?.partialFailure ?? null;

  const handleDeploy = async (app: string, version: string, strategy: string) => {
    try {
      // `deployApp`, not `deploy` — and the server records who did it.
      const deployedBy = useAuthStore.getState().user?.username ?? 'unknown';
      await deploy.deployApp({ app, version, strategy, deployedBy });
      fetchDeployments();
    } catch (err: any) {
      setActionError(err?.message ?? 'Failed to start deployment');
    }
  };

  const pageRows = deployments.slice(page * pageSize, page * pageSize + pageSize);

  const columns: ColumnDef<Deployment>[] = [
    {
      key: 'app',
      header: 'App',
      render: (dep) => (
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {dep.app}
        </Typography>
      ),
    },
    {
      key: 'version',
      header: 'Version',
      render: (dep) => (
        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 13 }}>
          {dep.version}
        </Typography>
      ),
    },
    {
      key: 'previousVersion',
      header: 'Previous',
      render: (dep) => (
        <Typography
          variant="caption"
          sx={{ color: 'text.secondary', fontFamily: 'monospace', fontSize: 12 }}
        >
          {dep.previousVersion || '--'}
        </Typography>
      ),
    },
    {
      key: 'strategy',
      header: 'Strategy',
      render: (dep) => (
        <Chip
          label={dep.strategy}
          size="small"
          variant="outlined"
          sx={{ textTransform: 'capitalize', fontSize: 11 }}
        />
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (dep) => (
        <Chip
          label={STATUS_LABELS[dep.status] ?? dep.status}
          size="small"
          color={STATUS_COLORS[dep.status] ?? 'default'}
          variant="filled"
          sx={{ fontWeight: 600 }}
        />
      ),
    },
    {
      key: 'startedAt',
      header: 'Started',
      render: (dep) => (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {formatDate(dep.startedAt)}
        </Typography>
      ),
    },
    {
      key: 'duration',
      header: 'Duration',
      render: (dep) => {
        const ms = deploymentDuration(dep);
        return (
          <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
            {ms === null ? '--' : formatDuration(ms)}
          </Typography>
        );
      },
    },
    {
      key: 'deployedBy',
      header: 'Deployed By',
      render: (dep) => (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {dep.deployedBy ?? '--'}
        </Typography>
      ),
    },
  ];

  return (
    <Stack spacing={3}>
      {/* Header */}
      <Breadcrumbs
        links={[{ name: 'Deployments' }]}
        action={
          <Stack direction="row" spacing={1}>
            <IconButton size="small" onClick={fetchDeployments} title="Refresh">
              <RefreshIcon />
            </IconButton>
            <Button
              variant="contained"
              size="small"
              startIcon={<PlusIcon />}
              onClick={() => setDialogOpen(true)}
            >
              Deploy
            </Button>
          </Stack>
        }
      />
      {actionError && (
        <Alert closable severity="warning" variant="outlined" onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}
      {/*
        Above the history, because it is the only thing on this page that is
        about right now. The history answers "what happened"; this answers
        "is anything happening", which is the question an operator has while
        a deployment is in flight and the one this page could not answer.
      */}
      <DeployProgressList records={progress ?? []} />
      {/*
        What this history is, said where it is read. It records apps deployed
        one at a time — the Deploy button, `omnitron deploy` — and nothing
        else. A stack started from a release is recorded in the audit trail
        and shown on Releases and on the stack's page. On the master,
        2026-09-23, this table held 0 rows beside stacks deployed from
        releases all day, and the page said «No deployments yet».
      */}
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        Apps deployed one at a time. A stack deployed from a release is on{' '}
        <Link component={RouterLink} to="/releases">
          Releases
        </Link>{' '}
        and on its stack&apos;s page.
      </Typography>
      {/*
        prism's AdminDataTable, which owns the distinction this page used to
        make with a local `TableEmptyRow` plus an Alert above the table: no
        rows AND a failure says "could not load"; rows AND a failure says
        "some of this is missing". Both used to be one warning bar that also
        carried action failures, so "the deploy button did not work" and "the
        list you are reading is incomplete" looked the same.
      */}
      <AdminDataTable<Deployment>
        columns={columns}
        data={pageRows}
        total={deployments.length}
        loading={loading}
        loadError={error ?? partialFailure ?? null}
        emptyMessage="No app has been deployed one at a time"
        rowKey={(dep) => dep.id}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(0);
        }}
        dense
      />
      {/* Deploy Dialog */}
      <DeployDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onDeploy={handleDeploy}
        apps={availableApps}
      />
    </Stack>
  );
}
