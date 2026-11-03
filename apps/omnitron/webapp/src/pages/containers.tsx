import { Can, useAccess } from 'src/auth/access';
import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import { alpha } from '@mui/material/styles';

import {
  ContainersIcon,
  RefreshIcon,
  PlayIcon,
  StopIcon,
  CloseIcon,
  LogsIcon,
} from 'src/assets/icons';
import { AdminDataTable, type ColumnDef } from '@omnitron-dev/prism/components/admin-filters';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { Breadcrumbs } from 'src/components/page-breadcrumbs';
import { ConfirmDialog } from '@omnitron-dev/prism/components/confirm-dialog';
import { Skeleton } from '@omnitron-dev/prism/components/skeleton';
import { infra } from 'src/netron/client';
import { Link as RouterLink } from 'react-router-dom';
import Link from '@mui/material/Link';
import { useStackContext } from 'src/hooks/use-stack-context';
import { useActiveProjectStacks, useProjectStore } from 'src/stores/project.store';
import { usePolledResource } from 'src/hooks/use-polled-resource';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// The daemon's own shape. The page used to declare a lookalike with `id`,
// `createdAt` and `ports: string[]`; the service actually returns
// `containerId`, `startedAt` and `ports` as a name→port map, so half these
// fields were always undefined at runtime.
type Container = import('@omnitron-dev/omnitron/dto/services').ContainerState;

/**
 * "80/tcp→9800, 443/tcp→9443" — or '--' when the container publishes nothing.
 *
 * The service left `ports` unset until now, so this column read '--' on a
 * host where every container published something. '--' is a legitimate answer
 * for a container that publishes nothing, which is why it went unquestioned.
 */
function formatPorts(ports: Container['ports']): string {
  const entries = Object.entries(ports ?? {});
  if (entries.length === 0) return '--';
  return entries
    .sort(([, a], [, b]) => a - b)
    .map(([containerPort, hostPort]) => `${containerPort}→${hostPort}`)
    .join(', ');
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, 'success' | 'error' | 'default' | 'warning' | 'info'> = {
  running: 'success',
  exited: 'error',
  created: 'default',
  restarting: 'warning',
  paused: 'info',
};

const HEALTH_COLORS: Record<string, 'success' | 'error' | 'default' | 'warning'> = {
  healthy: 'success',
  unhealthy: 'error',
  none: 'default',
  starting: 'warning',
};

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: 'success' | 'warning' | 'error' | 'info' | 'primary';
  loading?: boolean;
}

function StatCard({ title, value, icon, color, loading }: StatCardProps) {
  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 1.5, sm: 2 }, '&:last-child': { pb: { xs: 1.5, sm: 2 } } }}>
        <Stack
          direction="row"
          spacing={2}
          sx={{
            alignItems: "center",
            justifyContent: "space-between"
          }}>
          <Stack spacing={0.5}>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              {title}
            </Typography>
            {loading ? (
              <Skeleton width={60} height={40} />
            ) : (
              <Typography variant="h4" sx={{ fontSize: { xs: 24, sm: 28 } }}>{value}</Typography>
            )}
          </Stack>
          <Box
            sx={{
              p: 1.5,
              borderRadius: 2,
              bgcolor: (t) => alpha(t.palette[color].main, 0.12),
              color: `${color}.main`,
              display: { xs: 'none', sm: 'flex' },
            }}
          >
            {icon}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Log Modal
// ---------------------------------------------------------------------------

interface LogModalProps {
  open: boolean;
  containerName: string;
  logs: string[];
  onClose: () => void;
}

function LogModal({ open, containerName, logs, onClose }: LogModalProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontFamily: 'monospace' }}>
        Logs: {containerName}
      </DialogTitle>
      <DialogContent dividers sx={{ minHeight: 0, maxHeight: 'min(60dvh, 560px)' }}>
        <Box
          component="pre"
          sx={{
            m: 0,
            color: 'text.primary',
            fontFamily: 'monospace',
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          {logs.length === 0 ? 'No logs available.' : logs.join('\n')}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Containers Page
// ---------------------------------------------------------------------------

export default function ContainersPage() {
  const { activeProject, activeStack } = useStackContext();
  const { can } = useAccess();
  const canReadStacks = can('OmnitronProject.listStacks');
  const fetchStacks = useProjectStore((state) => state.fetchStacks);
  const inventory = useProjectStore((state) => activeProject ? state.stacksByProject[activeProject] : undefined);
  const inventoryError = useProjectStore((state) => activeProject ? state.stackReadErrors[activeProject] : null);
  // The status bar owns ongoing refresh. Direct entry only fills an unknown
  // scope, through the same store action that deduplicates concurrent readers.
  useEffect(() => {
    if (activeProject && canReadStacks && inventory === undefined) void fetchStacks(activeProject);
  }, [activeProject, canReadStacks, inventory, fetchStacks]);
  // This page lists THIS machine's Docker. A remote stack's containers run on
  // its node: with «sample / test» selected the table held only omnitron's own
  // two, as though the stack had none, and with all stacks selected test's
  // five were simply not there. Its stack page shows them, as its node
  // reports them.
  const remoteStacks = useActiveProjectStacks().filter(
    (s) => canReadStacks && s.type !== 'local' && (!activeStack || s.name === activeStack),
  );
  // One shared polling loop (see `use-polled-resource`): no overlapping
  // requests when the daemon is slow, no polling from a hidden tab, and a
  // failed poll no longer blanks the table — it used to set `[]`, so the view
  // an operator was reading disappeared exactly when something went wrong.
  const {
    data: allContainers,
    loading,
    error,
    refresh: fetchContainers,
  } = usePolledResource<Container[]>(
    async () => {
      const result = await infra.listContainers();
      return Array.isArray(result) ? result : [];
    },
    {
      intervalMs: 10_000,
      describeError: (err) =>
        `Could not ask the container runtime: ${err instanceof Error ? err.message : String(err)}`,
    }
  );

  const [actionError, setActionError] = useState<string | null>(null);
  type Operation = 'Starting' | 'Stopping' | 'Removing' | 'Loading logs';
  const pendingRef = useRef(new Set<string>());
  const [pending, setPending] = useState<Record<string, Operation>>({});
  const refresh = async () => {
    await Promise.all([fetchContainers(), activeProject && canReadStacks ? fetchStacks(activeProject) : null]);
  };
  const operate = async (name: string, operation: Operation, run: () => Promise<void>) => {
    if (pendingRef.current.has(name)) return;
    pendingRef.current.add(name);
    setPending((current) => ({ ...current, [name]: operation }));
    setActionError(null);
    try { await run(); }
    catch (err) { setActionError(`${operation} ${name} failed: ${err instanceof Error ? err.message : String(err)}`); }
    finally {
      pendingRef.current.delete(name);
      setPending((current) => { const next = { ...current }; delete next[name]; return next; });
    }
  };
  // Removing a container used to happen on one click. These are the project's
  // Postgres, Redis and MinIO: the container goes, and with it anything not on
  // a named volume.
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => setPage(0), [activeProject, activeStack]);

  // The selection's containers, by the labels a container carries about
  // itself (`omnitron.project`, `omnitron.stack`). The name only happens to
  // start with the same words: `sample-` also began every container of a
  // project called `sample-x`. The daemon's own carry no project, and are
  // listed in every scope.
  const containers = (allContainers ?? []).filter((c: Container) => {
    if (!activeProject || !c.project) return true;
    return c.project === activeProject && (!activeStack || c.stack === activeStack);
  });

  // Log modal state
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logModalContainer, setLogModalContainer] = useState('');
  const [logModalLines, setLogModalLines] = useState<string[]>([]);

  // A count is of containers the runtime listed. Before its first answer, or
  // when it could not be asked, there is nothing to count — «—», not 0.
  const counted = allContainers !== null;
  const count = (n: number) => (counted ? n : '—');
  const totalCount = containers.length;
  const runningCount = containers.filter((c) => c.status === 'running').length;
  const stoppedCount = containers.filter((c) => c.status === 'exited').length;
  const unhealthyCount = containers.filter((c) => c.health === 'unhealthy').length;

  const handleStart = (name: string) => operate(name, 'Starting', async () => {
    await infra.startContainer({ name });
    await fetchContainers();
  });

  const handleStop = (name: string) => operate(name, 'Stopping', async () => {
    await infra.stopContainer({ name });
    await fetchContainers();
  });

  const handleRemove = async () => {
    if (!confirmRemove) return;
    const name = confirmRemove;
    await operate(name, 'Removing', async () => {
      await infra.removeContainer({ name });
      setConfirmRemove(null);
      await fetchContainers();
    });
  };

  const handleViewLogs = (container: Container) => operate(container.name, 'Loading logs', async () => {
    const { logs } = await infra.getContainerLogs({ name: container.name, tail: 200 });
    setLogModalContainer(container.name);
    setLogModalLines(logs ? logs.split('\n') : []);
    setLogModalOpen(true);
  });

  const pageRows = containers.slice(page * pageSize, page * pageSize + pageSize);

  const columns: ColumnDef<Container>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (container) => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{container.name}</Typography>
          {pending[container.name] && <Typography variant="caption" role="status" sx={{ color: 'text.secondary' }}>
            {pending[container.name]}…
          </Typography>}
        </Box>
      ),
    },
    {
      key: 'scope',
      header: 'Scope',
      render: (container) => (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {container.project ? `${container.project}${container.stack ? ` / ${container.stack}` : ''}`
            : container.lifecycleRestriction ? 'Control plane' : 'Unassigned'}
        </Typography>
      ),
    },
    {
      key: 'image',
      header: 'Image',
      render: (container) => (
        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 13 }}>
          {container.image}
        </Typography>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (container) => (
        <Chip
          label={container.status}
          size="small"
          color={STATUS_COLORS[container.status] ?? 'default'}
          variant="filled"
          sx={{ textTransform: 'capitalize', fontWeight: 600 }}
        />
      ),
    },
    {
      key: 'health',
      header: 'Health',
      render: (container) => (
        <Chip
          label={!container.health || container.health === 'none' ? 'Not reported' : container.health}
          size="small"
          color={HEALTH_COLORS[container.health ?? 'none'] ?? 'default'}
          variant="outlined"
          sx={{ textTransform: 'capitalize' }}
        />
      ),
    },
    {
      key: 'ports',
      header: 'Ports',
      render: (container) => (
        <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
          {formatPorts(container.ports)}
        </Typography>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (container) => (
        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
          {container.lifecycleRestriction ? (
            <Tooltip title={container.lifecycleRestriction}>
              <Chip tabIndex={0} size="small" variant="outlined" label="Read only" aria-label={`Read only. ${container.lifecycleRestriction}`} />
            </Tooltip>
          ) : <Can permission="OmnitronInfra.removeContainer"><Tooltip title="Remove">
            <IconButton size="small" color="error" disabled={Boolean(pending[container.name])} loading={pending[container.name] === 'Removing'} aria-label={`Remove container ${container.name}`} onClick={() => setConfirmRemove(container.name)} sx={{ marginInlineEnd: 1 }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip></Can>}
          <Tooltip title="Logs">
            <IconButton size="small" disabled={Boolean(pending[container.name])} loading={pending[container.name] === 'Loading logs'} aria-label={`Logs for ${container.name}`} onClick={() => handleViewLogs(container)}>
              <LogsIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {!container.lifecycleRestriction && container.status !== 'running' && (
            <Can permission="OmnitronInfra.startContainer"><Tooltip title="Start">
              <IconButton size="small" color="success" disabled={Boolean(pending[container.name])} loading={pending[container.name] === 'Starting'} aria-label={`Start container ${container.name}`} onClick={() => handleStart(container.name)}>
                <PlayIcon fontSize="small" />
              </IconButton>
            </Tooltip></Can>
          )}
          {!container.lifecycleRestriction && container.status === 'running' && (
            <Can permission="OmnitronInfra.stopContainer"><Tooltip title="Stop">
              <IconButton size="small" color="warning" disabled={Boolean(pending[container.name])} loading={pending[container.name] === 'Stopping'} aria-label={`Stop container ${container.name}`} onClick={() => handleStop(container.name)}>
                <StopIcon fontSize="small" />
              </IconButton>
            </Tooltip></Can>
          )}
        </Stack>
      ),
    },
  ];

  return (
    <Stack spacing={3}>
      <Can permission="OmnitronInfra.removeContainer"><ConfirmDialog
        open={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        onConfirm={handleRemove}
        title="Remove container?"
        content={
          <>
            <b>{confirmRemove}</b> will be removed. Data outside a named volume is lost, and the
            daemon recreates the container on the next <code>omnitron up</code>.
          </>
        }
        confirmLabel="Remove"
        confirmColor="error"
      /></Can>
      {/* Header */}
      <Breadcrumbs
        links={[{ name: 'Containers' }]}
        action={
          <IconButton data-console-command="refresh" size="small" onClick={refresh} title="Refresh" aria-label="Refresh local containers and stack locations">
            <RefreshIcon />
          </IconButton>
        }
      />
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Chip size="small" variant="outlined" label="Local node" />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          This controller&apos;s Docker engine. Counts include the visible project, control-plane and unassigned containers, not remote nodes.
        </Typography>
      </Stack>
      {activeProject && (!canReadStacks || inventory === undefined || inventoryError) && (
        <Alert severity={inventoryError ? 'warning' : 'info'} variant="outlined">
          {!canReadStacks ? 'Stack locations are unavailable with your current permissions.'
            : inventoryError ? `Stack locations unavailable: ${inventoryError}` : 'Loading stack locations… Remote infrastructure is not included in this local inventory.'}
          {canReadStacks && inventoryError && <Button size="small" onClick={() => void fetchStacks(activeProject)}>Retry stack locations</Button>}
        </Alert>
      )}
      {(error || actionError) && (
        <Alert closable severity="warning" variant="outlined" onClose={() => setActionError(null)}>
          {actionError ?? error}
        </Alert>
      )}
      {remoteStacks.length > 0 && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Remote infrastructure:{' '}
          {remoteStacks.map((s, i) => (
            <span key={s.name}>
              {i > 0 && ', '}
              <Link component={RouterLink} to={`/stacks/${encodeURIComponent(s.name)}`}>
                {s.name}
              </Link>
            </span>
          ))}
        </Typography>
      )}
      {/* Summary Cards */}
      <Grid container spacing={{ xs: 1.5, sm: 3 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard
            title="Local total"
            value={count(totalCount)}
            icon={<ContainersIcon />}
            color="primary"
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard
            title="Running"
            value={count(runningCount)}
            icon={<ContainersIcon />}
            color="success"
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard
            title="Stopped"
            value={count(stoppedCount)}
            icon={<ContainersIcon />}
            color={stoppedCount > 0 ? 'error' : 'info'}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard
            title="Unhealthy"
            value={count(unhealthyCount)}
            icon={<ContainersIcon />}
            color={unhealthyCount > 0 ? 'error' : 'success'}
            loading={loading}
          />
        </Grid>
      </Grid>
      {/* Containers Table — prism owns the chrome, this page owns the columns. */}
      <AdminDataTable<Container>
        minWidth={640}
        scrollLabel="Local containers"
        columns={columns}
        data={pageRows}
        total={containers.length}
        loading={loading}
        loadError={error ?? null}
        emptyMessage="No local containers in this scope. Remote infrastructure is shown on its stack page."
        rowKey={(container) => container.name}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(0);
        }}
        dense
      />
      {/* Log Modal */}
      <LogModal
        open={logModalOpen}
        containerName={logModalContainer}
        logs={logModalLines}
        onClose={() => setLogModalOpen(false)}
      />
    </Stack>
  );
}
