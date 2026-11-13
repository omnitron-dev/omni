import type { IStackInfo, IStackInfraStatus } from '@omnitron-dev/omnitron/dto/services';
import { Box, Card, CardContent, Chip, Stack, Typography } from '@omnitron-dev/prism/ui';
import { statusColor } from 'src/utils/constants';

type Service = IStackInfraStatus['services'][string];
type Detail = [label: string, value: string];

function portsLabel(ports?: Record<string, number>, port?: number | null): string {
  const entries = Object.entries(ports ?? {});
  return entries.length
    ? entries.map(([name, value]) => `${name} → ${value}`).join(', ')
    : port == null ? '' : String(port);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function declarationDetails(stack: IStackInfo) {
  const fields = new Map<string, Detail[]>();
  const raw = stack.config?.infrastructure;
  function define(name: string, kind: string | undefined, ports: string, image?: string, databases?: unknown, buckets?: unknown) {
    const info: Detail[] = [];
    if (kind) info.push(['Type', kind]);
    if (ports) info.push(['Ports', ports]);
    if (image) info.push(['Image', image]);
    if (isRecord(databases)) {
      const items = Object.entries(databases).map(([database, options]) => {
        if (typeof options === 'number') return `${database} · DB ${options}`;
        return isRecord(options) && options['migrate'] ? `${database} (migrations)` : database;
      });
      if (items.length) info.push(['Databases', items.join(', ')]);
    }
    if (Array.isArray(buckets)) {
      const names = buckets.filter((value): value is string => typeof value === 'string');
      if (names.length) info.push(['Buckets', names.join(', ')]);
    }
    fields.set(name, info);
  }
  if (raw?.postgres) define('postgres', 'PostgreSQL', String(raw.postgres.port ?? 5432), raw.postgres.image, raw.postgres.databases);
  if (raw?.redis) define('redis', 'Redis', String(raw.redis.port ?? 6379), raw.redis.image, raw.redis.databases);
  if (raw?.minio) define('minio', 'MinIO / S3', portsLabel({ api: raw.minio.ports?.api ?? 9000, console: raw.minio.ports?.console ?? 9001 }), raw.minio.image, undefined, raw.minio.buckets);
  if (raw?.gateway) define('gateway', 'Gateway', portsLabel(undefined, raw.gateway.port), raw.gateway.image);
  if (raw?.tor) define('tor', 'Tor', '', raw.tor.image);
  for (const [name, container] of Object.entries(raw?.containers ?? {})) {
    define(name, 'Docker', portsLabel(container.ports), container.image);
  }
  for (const [name, service] of Object.entries(raw?.services ?? {})) {
    if ('preset' in service) {
      define(name, service.preset, portsLabel(service.ports), service.docker?.image ?? service.image,
        service.config?.['databases'], service.config?.['buckets']);
    } else {
      define(name, service.type, portsLabel(service.ports), service.docker?.image);
    }
  }
  for (const [name, override] of Object.entries(stack.config?.serviceOverrides ?? {})) {
    const details = fields.get(name) ?? [];
    if (override.disabled) details.push(['Override', 'Disabled']);
    else if (override.external) details.push(['External host', override.external.host]);
    else if (override.provisioning) details.push(['Provider', override.provisioning === 'bareMetal' ? 'Bare metal' : 'Docker']);
    const ports = portsLabel(override.external?.ports ?? override.ports);
    if (ports) details.push(['Override ports', ports]);
    if (override.docker?.image) details.push(['Override image', override.docker.image]);
    fields.set(name, details);
  }
  return fields;
}

const secondary = { color: 'text.secondary', overflowWrap: 'anywhere', display: 'block' } as const;

function Services({ services, label }: { services: IStackInfraStatus['services']; label: string }) {
  return <Box component="ul" aria-label={label} sx={{ listStyle: 'none', p: 0, m: 0 }}>
    {Object.entries(services).map(([key, svc]) => {
      const name = svc.service ?? key;
      const ports = portsLabel(svc.ports, svc.port);
      const status = svc.nativeStatus ?? svc.status;
      return <Box component="li" key={key} sx={{ display: 'grid', gap: { xs: 0.5, sm: 2 }, py: 1,
        gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) minmax(0, auto)' },
        '& + &': { borderTop: 1, borderColor: 'divider' } }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography component="span" variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{name}</Typography>
          {svc.app && <Typography component="span" variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>{svc.app}</Typography>}
          <Typography variant="caption" sx={secondary}>
            {[svc.containerName !== name && svc.containerName, svc.containerId && svc.containerId.slice(0, 12), svc.image, ports].filter(Boolean).join(' · ')}
          </Typography>
          {svc.error && <Typography variant="caption" color="error.main" sx={{ overflowWrap: 'anywhere' }}>{svc.error}</Typography>}
        </Box>
        <Stack direction="row" useFlexGap sx={{ alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
          <Chip size="small" variant="outlined" label={status} color={statusColor(status)} />
          {svc.health && svc.health !== 'none' && <Chip size="small" variant="outlined" label={svc.health} color={statusColor(svc.health)} />}
          {svc.provisioning && <Chip size="small" variant="outlined" label={`Setup ${svc.provisioning}`}
            color={svc.provisioning === 'failed' ? 'error' : svc.provisioning === 'pending' ? 'warning' : 'success'} />}
        </Stack>
      </Box>;
    })}
  </Box>;
}

/** Stack-owned observations only. Node inventories carry independent coverage, even for identically named replicas. */
export function StackInfrastructure({ stack }: { stack: IStackInfo }) {
  const declared = declarationDetails(stack);
  const placements = stack.type === 'local' ? undefined : stack.placements;
  const services = stack.infrastructure?.services ?? {};
  const observed = new Set<string>();
  const markObserved = (key: string, svc: Service) => {
    const name = svc.service ?? key;
    observed.add(name);
    if (svc.app) observed.add(`${svc.app}/${name}`);
  };
  if (placements?.length) {
    for (const node of placements) if (node.infrastructureObserved) {
      for (const [key, svc] of Object.entries(node.infrastructure?.services ?? {})) markObserved(key, svc);
    }
  } else {
    for (const [key, svc] of Object.entries(services)) markObserved(key, svc);
  }

  // Older controllers can supply node-qualified rows without the full placement inventory.
  const qualified = new Map<string, typeof services>();
  if (!placements?.length) {
    for (const [key, svc] of Object.entries(services)) {
      const node = svc.nodeKey ?? (stack.type === 'local' ? 'Local' : 'Stack');
      const rows = qualified.get(node) ?? {};
      rows[key] = svc;
      qualified.set(node, rows);
    }
  }
  return <Card component="section" aria-label="Stack infrastructure" variant="outlined">
    <CardContent>
      <Typography component="h2" variant="subtitle1">Infrastructure</Typography>
      {placements?.length ? placements.map(node => {
        const label = node.label ? `${node.label} · ${node.nodeKey}` : node.nodeKey;
        const infra = node.infrastructureObserved ? node.infrastructure : null;
        return <Box component="section" aria-label={label} key={node.nodeKey} sx={{ mt: 1.5 }}>
          <Typography component="h3" variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>{label}</Typography>
          {node.observedAt && infra && <Typography component="time" variant="caption" dateTime={node.observedAt} sx={secondary}>
            Observed {new Date(node.observedAt).toLocaleString()}
          </Typography>}
          {infra && Object.keys(infra.services).length ? <Services services={infra.services} label={`Services on ${label}`} />
            : <Typography variant="body2" sx={secondary}>{infra ? 'No services reported.' : 'Infrastructure inventory unavailable.'}</Typography>}
          {!infra && node.errors.length > 0 && <Typography variant="caption" sx={secondary}>{node.errors.join(' · ')}</Typography>}
        </Box>;
      }) : qualified.size ? [...qualified].map(([node, rows]) => <Box key={node} sx={{ mt: 1 }}>
        {stack.type !== 'local' && <Typography component="h3" variant="subtitle2">{node}</Typography>}
        <Services services={rows} label={`Services on ${node}`} />
      </Box>) : <Typography variant="body2" sx={secondary}>No infrastructure observations for this stack.</Typography>}
      {declared.size > 0 && <Box component="details" sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider',
        '& summary': { cursor: 'pointer', width: 'fit-content', typography: 'body2' } }}>
        <summary>Configured services ({declared.size})</summary>
        <Box component="dl" sx={{ m: 0, mt: 1, '& dt': { typography: 'body2', fontWeight: 600 }, '& dd': { m: 0, mb: 1 } }}>
          {[...declared].map(([name, fields]) => <Box key={name}>
            <dt>{name}</dt>
            <Box component="dd" sx={secondary}>
              {!observed.has(name) && <Typography variant="caption" sx={secondary}>Not observed</Typography>}
              {fields.map(([field, value]) => <Typography key={field} variant="caption" sx={secondary}>
                {field} · {value}
              </Typography>)}
            </Box>
          </Box>)}
        </Box>
      </Box>}
    </CardContent>
  </Card>;
}
