import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  Switch,
  FormControlLabel,
  TextField,
  Typography,
} from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { Tabs } from '@omnitron-dev/prism/components/tabs';
import { readSystemSnapshot, type SystemSnapshot } from '@omnitron-dev/omnitron/dto/services';
import { useAccess } from 'src/auth/access';
import { RefreshIcon } from 'src/assets/icons';
import { Breadcrumbs } from 'src/components/page-breadcrumbs';
import { OperationStatus } from 'src/components/operation-status';
import { usePolledResource, usePollingEffect } from 'src/hooks/use-polled-resource';
import { nodes, systemInfo } from 'src/netron/client';
import { formatUptime } from 'src/utils/formatters';
import { formatBytes, formatCpu } from 'src/utils/metric-series';

const grid = {
  display: 'grid',
  gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'repeat(2,minmax(0,1fr))' },
  gap: { xs: 2, md: 3 },
};
const mono = { fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' } as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" sx={{ minWidth: 0 }}>
      <Typography component="h2" variant="subtitle2" sx={{ pb: 1, borderBottom: 1, borderColor: 'divider', mb: 1 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <Box
      component="dl"
      sx={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,3fr)', columnGap: 2, rowGap: 0.75, m: 0 }}
    >
      {rows.map(([label, value]) => (
        <Box key={label} component="div" sx={{ display: 'contents' }}>
          <Typography component="dt" variant="body2" color="text.secondary">
            {label}
          </Typography>
          <Typography component="dd" variant="body2" sx={{ ...mono, m: 0, textAlign: 'end' }}>
            {value ?? '—'}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function Reading({
  label,
  value,
  detail,
  percent,
}: {
  label: string;
  value: string;
  detail: string;
  percent?: number | undefined;
}) {
  return (
    <Box sx={{ minWidth: 0, py: 1.25, borderTop: '1px solid', borderColor: 'divider' }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography component="div" variant="h5" sx={{ ...mono, my: 0.4 }}>
        {value}
      </Typography>
      {percent != null && Number.isFinite(percent) && (
        <LinearProgress
          aria-label={label}
          variant="determinate"
          value={Math.min(100, Math.max(0, percent))}
          sx={{ height: 3, mb: 0.75 }}
        />
      )}
      <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
        {detail}
      </Typography>
    </Box>
  );
}

function computeRates({ network, unanswered }: SystemSnapshot) {
  if (unanswered.network || network.rateAvailable === false || network.rxSec < 0 || network.txSec < 0) return null;
  return { rx: `${formatBytes(network.rxSec)}/s`, tx: `${formatBytes(network.txSec)}/s` };
}

function Resources({ data }: { data: SystemSnapshot }) {
  const { cpu, memory, disks, unanswered } = data;
  const fullest = unanswered.disks
    ? undefined
    : disks.reduce<SystemSnapshot['disks'][number] | undefined>(
        (max, disk) => (!max || disk.usedPercent > max.usedPercent ? disk : max),
        undefined
      );
  const rates = computeRates(data);
  return (
    <Box
      aria-label="Host measurements"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'repeat(2,minmax(0,1fr))', md: 'repeat(4,minmax(0,1fr))' },
        columnGap: { xs: 1.5, md: 3 },
      }}
    >
      <Reading
        label="CPU load"
        value={unanswered.cpu ? '—' : formatCpu(cpu.currentLoad)}
        detail={unanswered.cpu ? 'Reading unavailable' : `${cpu.cores} logical cores`}
        percent={unanswered.cpu ? undefined : cpu.currentLoad}
      />
      <Reading
        label="Committed memory"
        value={unanswered.memory ? '—' : formatBytes(memory.committed)}
        detail={unanswered.memory ? 'Reading unavailable' : `${formatBytes(memory.available)} available`}
        percent={unanswered.memory ? undefined : memory.usedPercent}
      />
      <Reading
        label="Fullest mount"
        value={fullest ? formatCpu(fullest.usedPercent) : '—'}
        detail={
          fullest
            ? `${fullest.mount} · ${formatBytes(fullest.available)} available`
            : unanswered.disks
              ? 'Reading unavailable'
              : 'No reported mounts'
        }
        percent={fullest?.usedPercent}
      />
      <Reading
        label="Network receive"
        value={rates?.rx ?? '—'}
        detail={rates ? `Transmit ${rates.tx}` : 'Transfer rate unavailable'}
      />
    </Box>
  );
}

function RuntimeDetails({ data }: { data: SystemSnapshot }) {
  const { os, cpu, memory, daemon, docker, unanswered } = data;
  return (
    <Box sx={grid}>
      <Section title="Host">
        {unanswered.os ? (
          <Typography variant="body2">Host details unavailable</Typography>
        ) : (
          <Facts
            rows={[
              ['Hostname', os.hostname],
              ['Operating system', [os.distro || os.platform, os.release].filter(Boolean).join(' ')],
              ['Kernel', os.kernel],
              ['Architecture', os.arch],
              ['Host uptime', formatUptime(os.uptime * 1000)],
            ]}
          />
        )}
      </Section>
      <Section title="Daemon">
        <Facts
          rows={[
            ['Role / PID', `${daemon.role} / ${daemon.pid}`],
            ['Daemon uptime', formatUptime(daemon.uptimeMs)],
            ['Omnitron', daemon.version ?? 'Version not reported'],
            [
              'Build commit',
              daemon.build ? daemon.build.commit + (daemon.build.dirty ? ' (dirty)' : '') : 'Build not reported',
            ],
            ['Node.js / V8', `${daemon.nodeVersion} / ${daemon.v8Version}`],
            ['Resident memory', formatBytes(daemon.memoryUsage.rss)],
            [
              'Heap used / allocated',
              `${formatBytes(daemon.memoryUsage.heapUsed)} / ${formatBytes(daemon.memoryUsage.heapTotal)}`,
            ],
            ['External memory', formatBytes(daemon.memoryUsage.external)],
          ]}
        />
      </Section>
      <Section title="Compute">
        {!unanswered.cpu && (
          <>
            <Facts
              rows={[
                ['Processor', [cpu.manufacturer, cpu.brand].filter(Boolean).join(' ')],
                ['Physical / logical cores', `${cpu.physicalCores} / ${cpu.cores}`],
                ['Clock', cpu.speed > 0 ? `${cpu.speed} GHz` : '—'],
                ['Temperature', cpu.temperature != null && cpu.temperature > 0 ? `${cpu.temperature} °C` : '—'],
              ]}
            />
            {cpu.loadPerCore.length > 0 && (
              <Box component="details" sx={{ my: 1.25 }}>
                <Typography component="summary" variant="body2" sx={{ cursor: 'pointer' }}>
                  Per-core load · {cpu.loadPerCore.length}
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(6rem,1fr))', gap: 1, mt: 1 }}>
                  {cpu.loadPerCore.map((load, index) => (
                    <Typography key={index} variant="caption" sx={mono}>
                      CPU {index} · {formatCpu(load)}
                    </Typography>
                  ))}
                </Box>
              </Box>
            )}
          </>
        )}
        {!unanswered.memory && (
          <Facts
            rows={[
              ['RAM capacity', formatBytes(memory.total)],
              ['Free / available', `${formatBytes(memory.free)} / ${formatBytes(memory.available)}`],
              ['Swap used / total', `${formatBytes(memory.swapUsed)} / ${formatBytes(memory.swapTotal)}`],
            ]}
          />
        )}
        {unanswered.cpu && unanswered.memory && <Typography variant="body2">Compute details unavailable</Typography>}
      </Section>
      <Section title="Docker">
        {docker && !unanswered.docker ? (
          <Facts
            rows={[
              ['Running', docker.running],
              ['Paused', docker.paused],
              ['Stopped', docker.stopped],
            ]}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">
            {unanswered.docker ? 'Container inventory unavailable' : 'No container runtime reported'}
          </Typography>
        )}
      </Section>
    </Box>
  );
}

function StorageDetails({ data }: { data: SystemSnapshot }) {
  if (data.unanswered.disks) return <Typography variant="body2">Mount inventory unavailable.</Typography>;
  if (!data.disks.length) return <Typography variant="body2">No mounted filesystems reported.</Typography>;
  const disks = [...data.disks].sort((a, b) => b.usedPercent - a.usedPercent || a.mount.localeCompare(b.mount));
  return (
    <Box sx={grid}>
      {disks.map((disk) => (
        <Section key={JSON.stringify([disk.mount, disk.fs])} title={disk.mount}>
          <Facts
            rows={[
              ['Filesystem', `${disk.fs} · ${disk.type}`],
              ['Available', formatBytes(disk.available)],
              ['Used / capacity', `${formatBytes(disk.used)} / ${formatBytes(disk.size)}`],
              ['Utilization', formatCpu(disk.usedPercent)],
            ]}
          />
          <LinearProgress
            aria-label={`Usage of ${disk.mount}`}
            variant="determinate"
            value={Math.min(100, Math.max(0, disk.usedPercent))}
            sx={{ mt: 1, height: 3 }}
          />
        </Section>
      ))}
    </Box>
  );
}

function NetworkDetails({ data }: { data: SystemSnapshot }) {
  if (data.unanswered.network) return <Typography variant="body2">Interface inventory unavailable.</Typography>;
  if (!data.network.interfaces.length)
    return <Typography variant="body2">No external network interfaces reported.</Typography>;
  return (
    <Box sx={grid}>
      {data.network.interfaces.map((iface) => (
        <Section key={iface.iface} title={iface.iface}>
          <Facts
            rows={[
              ['Link', iface.operstate],
              ['IPv4', iface.ip4 || '—'],
              ['IPv6', iface.ip6 || '—'],
              ['MAC', iface.mac || '—'],
              ['Link speed', iface.speed != null && iface.speed > 0 ? `${iface.speed} Mbit/s` : '—'],
            ]}
          />
        </Section>
      ))}
    </Box>
  );
}

function SnapshotTime({ data, live }: { data: SystemSnapshot; live: boolean }) {
  const [now, setNow] = useState(Date.now);
  usePollingEffect(() => setNow(Date.now()), { intervalMs: 5_000 });
  const { ageMs, timing } = readSystemSnapshot(data, Math.max(now, Date.now()));
  const time = new Date(data.timestamp);
  return (
    <Typography component="div" variant="caption" color={timing === 'current' ? 'text.secondary' : 'warning.main'}>
      {timing === 'clock-skew'
        ? 'Host clock ahead'
        : timing === 'unknown'
          ? 'Collection time unavailable'
          : `Collected ${Math.max(0, Math.round(ageMs / 1000))} s ago in ${data.collectedMs} ms`}
      {Number.isFinite(time.getTime()) && (
        <>
          {' '}
          ·{' '}
          <time dateTime={time.toISOString()} title={time.toISOString()}>
            {time.toLocaleTimeString()}
          </time>
        </>
      )}
      {timing === 'stale' && ' · Stale sample'}
      {!live && ' · Updates paused'}
    </Typography>
  );
}

export default function SystemInfoPage() {
  const [params, setParams] = useSearchParams();
  const target = params.get('node') || '';
  const view = params.get('view') || 'overview';
  const { can } = useAccess();
  const remoteAllowed = can('OmnitronNodes.getNodeSystemSnapshot');
  const listAllowed = remoteAllowed && can('OmnitronNodes.listNodes');
  const inventory = usePolledResource(() => nodes.listNodes(), {
    intervalMs: 30_000,
    enabled: listAllowed,
    resourceKey: Number(listAllowed),
  });
  const options = (inventory.data ?? []).filter((node) => !node.isLocal);
  function select(key: string, value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }
  return (
    <SystemHost
      key={JSON.stringify([target, target ? remoteAllowed : true])}
      target={target}
      allowed={!target || remoteAllowed}
      view={['storage', 'network'].includes(view) ? view : 'overview'}
      onView={(value) => select('view', value === 'overview' ? '' : value)}
      selector={
        (listAllowed || target) && (
          <TextField
            select
            label="Host"
            size="small"
            value={target}
            onChange={(e) => select('node', e.target.value)}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            sx={{ minWidth: '10rem', maxWidth: '100%' }}
          >
            <MenuItem value="">Connected daemon</MenuItem>
            {target && !options.some((node) => node.id === target) && <MenuItem value={target}>{target}</MenuItem>}
            {options.map((node) => (
              <MenuItem key={node.id} value={node.id}>
                {node.name}
              </MenuItem>
            ))}
          </TextField>
        )
      }
      inventoryError={listAllowed ? inventory.error : null}
    />
  );
}

function SystemHost({
  target,
  allowed,
  view,
  onView,
  selector,
  inventoryError,
}: {
  target: string;
  allowed: boolean;
  view: string;
  onView(value: string): void;
  selector: ReactNode;
  inventoryError: string | null;
}) {
  const [live, setLive] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { data, error, loading, refresh } = usePolledResource(
    () => (target ? nodes.getNodeSystemSnapshot({ nodeId: target }) : systemInfo.getSnapshot({ fresh: true })),
    { intervalMs: 5_000, enabled: allowed, paused: !live, resourceKey: target }
  );
  const update = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };
  const missing = data ? readSystemSnapshot(data).missing : [];
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Breadcrumbs
        links={[{ name: 'System' }]}
        action={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            {selector}
            <FormControlLabel
              control={
                <Switch size="small" checked={live} disabled={!allowed} onChange={(e) => setLive(e.target.checked)} />
              }
              label="Live"
              sx={{ m: 0 }}
            />
            <IconButton
              size="small"
              aria-label="Refresh system snapshot"
              data-console-command="refresh"
              disabled={refreshing || !allowed}
              onClick={() => void update()}
            >
              <RefreshIcon />
            </IconButton>
          </Stack>
        }
      />
      {inventoryError && <Alert severity="warning">Node inventory unavailable · {inventoryError}</Alert>}
      {!allowed ? (
        <Alert severity="warning">
          Remote system readings are unavailable for this session. Select the connected daemon to inspect its host.
        </Alert>
      ) : (
        <>
          <OperationStatus
            active={loading || refreshing}
            label={loading ? 'Reading host measurements' : 'Requesting a system snapshot'}
          />
          {error && (
            <Alert severity={data ? 'warning' : 'error'}>
              {data ? 'Showing the last snapshot' : 'Host measurements unavailable'} · {error}
            </Alert>
          )}
          {data && (
            <>
              <Stack spacing={0.25}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography variant="subtitle1" sx={mono}>
                    {(!data.unanswered.os && data.os.hostname) || target || 'Connected daemon'}
                  </Typography>
                  <Chip size="small" variant="outlined" label={target ? 'Mesh node' : 'Connected daemon'} />
                </Stack>
                <SnapshotTime data={data} live={live} />
              </Stack>
              {missing.length > 0 && (
                <Alert severity="warning" variant="outlined">
                  <Typography variant="subtitle2">
                    Partial snapshot · {missing.length} {missing.length === 1 ? 'section' : 'sections'} unavailable
                  </Typography>
                  {missing.map(([name, reason]) => (
                    <Typography component="div" variant="body2" key={name}>
                      <strong>{name}</strong> · <span>Did not answer — {reason}</span>
                    </Typography>
                  ))}
                </Alert>
              )}
              <Resources data={data} />
              <Divider />
              <Tabs
                aria-label="System details"
                value={view}
                onChange={onView}
                variant="scrollable"
                scrollButtons="auto"
                tabs={[
                  { value: 'overview', label: 'Overview', content: <RuntimeDetails data={data} /> },
                  { value: 'storage', label: 'Storage', content: <StorageDetails data={data} /> },
                  { value: 'network', label: 'Network', content: <NetworkDetails data={data} /> },
                ]}
              />
            </>
          )}
          {!live && !data && !error && <Button onClick={() => void update()}>Read snapshot</Button>}
        </>
      )}
    </Stack>
  );
}
