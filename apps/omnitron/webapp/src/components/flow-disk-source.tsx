import { Alert, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { readSystemSnapshot, type FlowNode, type FlowNodeDescriptor } from '@omnitron-dev/omnitron/dto/services';
import { useAccess } from 'src/auth/access';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { nodes } from 'src/netron/client';
import { formatBytes } from 'src/utils/metric-series';

export const controllerDisk = 'host.disk@1';
export const meshDisk = 'mesh.disk@1';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function EnrolledMount({ node, update }: { node: FlowNode; update(node: FlowNode): void }) {
  const { can } = useAccess();
  const nodeId = String(node.config['nodeId'] ?? '');
  const mount = String(node.config['mount'] ?? '');
  const canList = can('OmnitronNodes.listNodes');
  const canDiscover = can('OmnitronNodes.getNodeSystemSnapshot');
  const directory = usePolledResource(() => nodes.listNodes(), {
    enabled: canList,
    paused: true,
    intervalMs: 0,
    resourceKey: Number(canList),
  });
  const exact = usePolledResource(() => nodes.getNode({ id: nodeId }), {
    enabled: !canList && can('OmnitronNodes.getNode') && uuid.test(nodeId),
    paused: true,
    intervalMs: 0,
    resourceKey: nodeId,
  });
  const options = (directory.data ?? []).filter((item) => !item.isLocal && uuid.test(item.id));
  const target = canList ? options.find((item) => item.id === nodeId) : exact.data;
  const registered = target?.id === nodeId && !target.isLocal ? target : null;
  const snapshot = usePolledResource(
    async () => {
      const reading = await nodes.getNodeSystemSnapshot({ nodeId });
      return { reading, timing: readSystemSnapshot(reading).timing };
    },
    {
      enabled: !!registered && canDiscover,
      paused: true,
      intervalMs: 0,
      resourceKey: nodeId,
    }
  );
  const reading = snapshot.data?.reading;
  const inventoryError = canList ? directory.error : exact.error;
  const mountError =
    snapshot.error ??
    (reading && Object.hasOwn(reading.unanswered ?? {}, 'disks')
      ? reading.unanswered.disks || 'The remote disk collector has no reading.'
      : null) ??
    (snapshot.data && snapshot.data.timing !== 'current'
      ? 'The remote disk snapshot is ' + snapshot.data.timing + '.'
      : null);
  const availableByMount = new Map<string, number | null>();
  for (const disk of mountError ? [] : (reading?.disks ?? [])) {
    availableByMount.set(disk.mount, availableByMount.has(disk.mount) ? null : disk.available);
  }
  const mounts = [...availableByMount].sort(([a], [b]) => a.localeCompare(b));
  const setNode = (id: string) => update({ ...node, config: { ...node.config, nodeId: id, mount: '' } });
  const setMount = (value: string) => update({ ...node, config: { ...node.config, mount: value } });
  const nodeMissing =
    !!nodeId &&
    ((canList && !!directory.data) || (!canList && can('OmnitronNodes.getNode') && !exact.loading)) &&
    !registered &&
    !inventoryError;
  return (
    <Stack spacing={1}>
      {canList ? (
        <TextField
          select
          size="small"
          fullWidth
          label="Enrolled node"
          value={nodeId}
          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
          onChange={(e) => setNode(e.target.value)}
          helperText={registered ? registered.id : undefined}
        >
          <option value="">{directory.loading ? 'Reading enrolled nodes…' : 'Choose a remote node'}</option>
          {nodeId && !options.some((item) => item.id === nodeId) && (
            <option value={nodeId} disabled>
              {nodeId}
            </option>
          )}
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.host} · {item.id}
            </option>
          ))}
        </TextField>
      ) : (
        <TextField
          size="small"
          label="Enrolled node UUID"
          value={nodeId}
          error={!!nodeId && !uuid.test(nodeId)}
          helperText="Use the registration ID of the remote node."
          onChange={(e) => setNode(e.target.value)}
        />
      )}
      {inventoryError && (
        <Alert
          severity="warning"
          action={<Button onClick={() => void (canList ? directory : exact).refresh()}>Retry</Button>}
        >
          Node inventory unavailable · {inventoryError}
        </Alert>
      )}
      {canList && !!directory.data && !options.length && !inventoryError && (
        <Typography variant="body2" color="text.secondary">
          No registered remote nodes.
        </Typography>
      )}
      {canList && !inventoryError && (
        <Button size="small" sx={{ alignSelf: 'start' }} onClick={() => void directory.refresh()}>
          Refresh nodes
        </Button>
      )}
      {nodeMissing && <Alert severity="warning">This node is unavailable in the controller's remote inventory.</Alert>}
      {registered && canDiscover ? (
        <>
          <TextField
            select
            size="small"
            fullWidth
            label="Mounted filesystem"
            value={mount}
            slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
            onChange={(e) => setMount(e.target.value)}
          >
            <option value="">{snapshot.loading ? 'Reading mounted filesystems…' : 'Choose an exact mount'}</option>
            {mount && !availableByMount.has(mount) && (
              <option disabled value={mount}>
                {mount} · configured
              </option>
            )}
            {mounts.map(([name, available]) => (
              <option key={name} value={name} disabled={available === null}>
                {name} · {available === null ? 'ambiguous mount' : formatBytes(available) + ' available'}
              </option>
            ))}
          </TextField>
          {mountError ? (
            <Alert severity="warning">
              Mount inventory unavailable for {registered.name} · {mountError}
            </Alert>
          ) : (
            reading &&
            (!mounts.length || (mount && availableByMount.get(mount) == null)) && (
              <Alert severity="warning">
                {mount
                  ? 'The configured mount does not identify one filesystem on this node.'
                  : 'This node reported no mounted filesystems.'}
              </Alert>
            )
          )}
          <Button size="small" sx={{ alignSelf: 'start' }} onClick={() => void snapshot.refresh()}>
            {mountError ? 'Retry mounts' : 'Refresh mounts'}
          </Button>
        </>
      ) : (
        <TextField
          size="small"
          fullWidth
          label="Exact remote mount"
          value={mount}
          slotProps={{ input: { readOnly: !!canList && !registered } }}
          helperText={
            registered || !canList
              ? 'Enter the mount reported by this node.'
              : 'Select its registered remote node first.'
          }
          onChange={(e) => setMount(e.target.value)}
        />
      )}
      <Typography variant="caption" color="text.secondary">
        The enrolled node reports disk space. This controller records the events and delivers the configured outputs.
      </Typography>
    </Stack>
  );
}

export function FlowDiskSource({
  node,
  catalog,
  update,
}: {
  node: FlowNode;
  catalog: FlowNodeDescriptor[];
  update(node: FlowNode): void;
}) {
  const remote = node.type === meshDisk;
  const diskTypes = catalog.filter((item) => item.type === controllerDisk || item.type === meshDisk);
  return (
    <Stack spacing={1.25}>
      {diskTypes.length > 1 && (
        <TextField
          select
          size="small"
          fullWidth
          label="Disk location"
          value={node.type}
          onChange={(e) => {
            const type = e.target.value;
            const timing = diskTypes
              .find((item) => item.type === type)
              ?.fields.find((field) => field.key === 'intervalMs');
            const intervalMs = Math.max(timing?.min ?? 0, Number(node.config['intervalMs']) || 60000);
            update({
              ...node,
              type,
              config: type === meshDisk ? { nodeId: '', mount: '', intervalMs } : { path: '', intervalMs },
            });
          }}
        >
          {diskTypes.map((item) => (
            <MenuItem key={item.type} value={item.type}>
              {item.type === meshDisk ? 'Enrolled node' : 'Controller'}
            </MenuItem>
          ))}
        </TextField>
      )}
      {remote && <EnrolledMount node={node} update={update} />}
    </Stack>
  );
}
