import { Link as RouterLink } from 'react-router-dom';
import { Box, Card, CardContent, Chip, Link, Stack, Typography } from '@mui/material';
import { Table, type TableColumn } from '@omnitron-dev/prism/components/table';
import { syncFinding, syncSeverity, syncWords } from '@omnitron-dev/omnitron/sync-reading';
import type { IStackAppStatus, IStackInfo, IStackNodeStatus } from '@omnitron-dev/omnitron/dto/services';
import { useAccess } from 'src/auth/access';
import { ApplicationHealthStatus, StackHealthStatus } from 'src/components/stack-health-status';
import { StackInfrastructure } from 'src/components/stack-infrastructure';
import { appHref, useWorkspace } from 'src/routes/workspace';
import { tally } from 'src/utils/app-address';
import { statusColor } from 'src/utils/constants';
import { formatUptime } from 'src/utils/formatters';

const stackTypes = { local: 'Local', remote: 'Remote (SSH)', cluster: 'Cluster' };
const sectionGrid = { display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1.2fr) minmax(0, 1fr)' }, alignItems: 'start' };

function incompleteAppInventory(stack: IStackInfo) {
  if (stack.type === 'local') return false;
  return stack.placements?.length ? stack.placements.some(node => !node.appsObserved) : stack.nodes.some(node => !node.connected);
}

/** A partial remote read retains the verdicts of the nodes that actually answered. */
function infrastructureSummary(stack: IStackInfo) {
  const nodes = stack.type === 'local' ? undefined : stack.placements;
  const inventories = nodes?.length
    ? nodes.flatMap(node => node.infrastructureObserved && node.infrastructure ? [{ node: node.nodeKey, inventory: node.infrastructure }] : [])
    : stack.infrastructure ? [{ node: '', inventory: stack.infrastructure }] : [];
  const rows = inventories.flatMap(({ node, inventory }) => Object.entries(inventory.services).map(([key, service]) => ({
    key: JSON.stringify([node, key]), name: [node || service.nodeKey, service.app, service.service || key].filter(Boolean).join(' / '), service,
  })));
  const findings = rows.flatMap(({ key, name, service }) => {
    const reason = service.error || (service.provisioning === 'failed' && 'Setup failed') ||
      (service.health === 'unhealthy' && 'Unhealthy') || (service.status === 'error' && 'Service error');
    return reason ? [{ key, message: `${name} · ${reason}` }] : [];
  });
  const coverage = nodes?.length && inventories.length < nodes.length ? `${inventories.length}/${nodes.length} node inventories` : '';
  const notReady = inventories.some(({ inventory }) => !inventory.ready && Object.keys(inventory.services).length > 0);
  const ready = rows.length > 0 && inventories.every(({ inventory }) => inventory.ready);
  const state = notReady ? 'Not ready' : coverage ? 'Inventory incomplete' : ready ? 'Ready' : rows.length ? 'Not ready' : 'No services observed';
  const count = rows.length ? `${rows.length} observed ${rows.length === 1 ? 'service' : 'services'}` : '';
  return { state, detail: [count, coverage].filter(Boolean).join(' · '), findings };
}

export function RuntimeSummary({ stack }: { stack: IStackInfo }) {
  const { appsOnline, appsTotal } = tally(stack.apps);
  const infra = infrastructureSummary(stack);
  const unknownApps = stack.apps.filter(app => app.status === 'unknown').length;
  return <Card component="section" aria-label="Runtime summary" variant="outlined">
    <CardContent component="dl" sx={{ m: 0, display: 'grid', columnGap: 3, rowGap: 2,
      gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'minmax(0, 0.65fr) repeat(2, minmax(0, 1fr))' },
      gridTemplateAreas: { xs: '"status infra" "apps apps"', md: '"status apps infra"' },
      '& dt': { typography: 'subtitle2', color: 'text.secondary', mb: 0.5 }, '& dd': { m: 0 } }}>
      <Box sx={{ gridArea: 'status' }}>
        <dt>Stack status</dt>
        <Box component="dd">
          <Chip size="small" color={statusColor(stack.status)} label={stack.status.charAt(0).toUpperCase() + stack.status.slice(1)} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            {stackTypes[stack.type]}{stack.uptime > 0 && ` · Up ${formatUptime(stack.uptime)}`}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ gridArea: 'infra' }}>
        <dt>Infrastructure</dt>
        <Box component="dd">
          <Typography variant="subtitle1" color={infra.state === 'Not ready' ? 'warning.main' : 'text.primary'}>{infra.state}</Typography>
          {infra.detail && <Typography variant="body2" color="text.secondary">{infra.detail}</Typography>}
          {infra.findings.map(finding => <Typography key={finding.key} variant="caption" component="div" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>{finding.message}</Typography>)}
        </Box>
      </Box>
      <Box sx={{ gridArea: 'apps' }}>
        <dt>Applications</dt>
        <Box component="dd">
          <Typography variant="subtitle1">{appsTotal ? `${appsOnline}/${appsTotal} online` : incompleteAppInventory(stack) ? 'Inventory incomplete' : 'No applications reported'}</Typography>
          {unknownApps > 0 && <Typography variant="body2" color="text.secondary">
            {unknownApps} {unknownApps === 1 ? 'process state unknown' : 'process states unknown'}
          </Typography>}
          <StackHealthStatus stack={stack} />
        </Box>
      </Box>
    </CardContent>
  </Card>;
}

function Applications({ stack }: { stack: IStackInfo }) {
  const { can } = useAccess();
  const { project } = useWorkspace();
  const canOpenApp = project && stack.type === 'local' && can('OmnitronDaemon.getApp');
  const columns: TableColumn<IStackAppStatus>[] = [
    { id: 'name', label: 'Application', render: app => <Box sx={{ overflowWrap: 'anywhere' }}>
      {canOpenApp
        ? <Link component={RouterLink} to={appHref(project!, stack.name, app.name)} underline="hover" sx={{ fontWeight: 600 }}>{app.name}</Link>
        : <Typography variant="body2" sx={{ fontWeight: 600 }}>{app.name}</Typography>}
      <Typography component="div" variant="caption" color="text.secondary">
        {[`${app.instances} ${app.instances === 1 ? 'instance' : 'instances'}`,
          app.pid != null && `PID ${app.pid}`, app.uptime > 0 && `Up ${formatUptime(app.uptime)}`,
          app.restarts > 0 && `${app.restarts} ${app.restarts === 1 ? 'restart' : 'restarts'}`].filter(Boolean).join(' · ')}
      </Typography>
    </Box> },
    { id: 'status', label: 'Process', render: app => <Chip size="small" variant="outlined" label={app.status} color={statusColor(app.status)} /> },
    { id: 'health', label: 'Health', render: app => <ApplicationHealthStatus status={app.health} /> },
  ];
  return <Card component="section" aria-label="Applications" variant="outlined">
    <CardContent>
      <Typography component="h2" variant="subtitle1" sx={{ mb: 1 }}>Applications</Typography>
      <Table columns={columns} data={stack.apps} rowKey="handleKey" dense scrollLabel="Stack applications"
        containerSx={{ border: 'none', borderRadius: 0 }} sx={{ '& .MuiTableCell-root': { px: { xs: 0.75, sm: 1.5 } } }}
        emptyContent={incompleteAppInventory(stack) ? 'Application inventory incomplete.' : 'No applications reported.'} />
    </CardContent>
  </Card>;
}

function replicationWords(nodes: IStackNodeStatus[]) {
  if (nodes.length === 0) return 'No nodes configured';
  const findings = nodes.map(node => node.syncStatus && syncFinding(node.syncStatus));
  const behind = findings.filter(finding => finding?.state === 'behind').length;
  const catchingUp = findings.filter(finding => finding?.state === 'catching-up').length;
  const unknown = findings.filter(finding => finding?.state === 'unknown').length;
  const silent = findings.filter(finding => !finding).length;
  const parts = [behind > 0 && `${behind} of ${nodes.length} behind`, catchingUp > 0 && `${catchingUp} catching up`,
    unknown > 0 && `${unknown} queue age unavailable`, silent > 0 && `${silent} not reporting`];
  return parts.filter(Boolean).join(', ') || 'replication in sync';
}

function Nodes({ stack }: { stack: IStackInfo }) {
  const remote = stack.type !== 'local';
  const columns: TableColumn<IStackNodeStatus>[] = [
    { id: 'host', label: 'Node', render: node => <Box>
      <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{node.host}:{node.port}</Typography>
      <Typography variant="caption" color="text.secondary">{[node.label, node.role, node.daemonRole].filter(Boolean).join(' · ')}</Typography>
    </Box> },
    { id: 'connected', label: 'Application inventory', render: node => node.connected ? 'Inventory observed' : 'Inventory unavailable' },
    ...(remote ? [{ id: 'syncStatus', label: 'Replication', render: (node: IStackNodeStatus) => {
      if (!node.syncStatus) return 'Not reported';
      const finding = syncFinding(node.syncStatus);
      return <Box sx={{ overflowWrap: 'anywhere' }}>
        <Typography variant="body2" color={syncSeverity(finding) === 'warning' ? 'warning.main' : 'text.primary'}>{syncWords(finding)}</Typography>
        {node.syncStatus.lastSyncAt != null && <Typography variant="caption" color="text.secondary">Last sync {new Date(node.syncStatus.lastSyncAt).toLocaleString()}</Typography>}
        {node.syncStatus.lastError && <Typography variant="body2" color="error.main">{node.syncStatus.lastError}</Typography>}
      </Box>;
    } }] : []),
    { id: 'lastSeen', label: 'Last seen', render: node => node.lastSeen != null ? new Date(node.lastSeen).toLocaleString() : 'Not reported' },
  ];
  return <Card component="section" aria-label="Nodes" variant="outlined">
    <CardContent>
      <Typography component="h2" variant="subtitle1">Nodes</Typography>
      {remote && stack.nodes.length > 0 && <Typography variant="body2" color="text.secondary" sx={{ my: 0.5 }}>
        {stack.nodes.filter(node => node.connected).length}/{stack.nodes.length} node inventories observed · {replicationWords(stack.nodes)}
      </Typography>}
      <Table columns={columns} data={stack.nodes} dense rowKey={node => JSON.stringify([node.host, node.port])}
        scrollLabel="Stack nodes" sx={{ minWidth: remote ? 620 : 380 }} containerSx={{ border: 'none', borderRadius: 0 }} emptyContent="No nodes configured" />
      {(stack.startedAt || remote) && <Box component="dl" sx={{ m: 0, mt: 1.5, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1,
        typography: 'body2', '& dt': { color: 'text.secondary' }, '& dd': { m: 0 } }}>
        <dt>Started</dt><dd>{stack.startedAt
          ? new Date(stack.startedAt).toLocaleString() + (remote ? ', as its nodes report' : '')
          : 'unknown — no node reported an app of it running'}</dd>
        {remote && stack.attachedAt && <><dt>Attached</dt><dd>{new Date(stack.attachedAt).toLocaleString()} — by this master</dd></>}
      </Box>}
    </CardContent>
  </Card>;
}

export function StackRuntime({ stack }: { stack: IStackInfo }) {
  return <Stack spacing={2}>
    <Box sx={sectionGrid}><Applications stack={stack} /><StackInfrastructure stack={stack} /></Box>
    {(stack.nodes.length > 0 || stack.type !== 'local' || stack.startedAt) && <Nodes stack={stack} />}
  </Stack>;
}
