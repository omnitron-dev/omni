import type { IStackConfig, ProcessInfoDto } from '../config/types.js';
import type {
  IStackInfo,
  IStackPlacement,
  IStackInfraStatus,
  IStackAppStatus,
  StackStatus,
} from '../shared/dto/project.js';

export function stackNodeKey(host: string, port = 9700): string {
  return `${host.includes(':') ? `[${host}]` : host}:${port}`;
}

/** Names are qualified by project AND stack; a foreign `api` is never this app. */
export function nodePlacement(
  project: string,
  info: IStackInfo,
  node: NonNullable<IStackConfig['nodes']>[number],
  processes: ProcessInfoDto[] | null,
  infrastructure: IStackInfraStatus | null,
  observedAt: string
): IStackPlacement {
  const selected = new Set(node.apps ?? info.apps.map((app) => app.name));
  const apps = info.apps.flatMap((app) => {
    const qualified = `${project}/${info.name}/${app.name}`;
    const legacy = `${project}/deployed/${app.name}`;
    const process = processes?.find((p) => p.name === qualified) ?? processes?.find((p) => p.name === legacy) ?? null;
    return selected.has(app.name) || process ? [{ name: app.name, expected: selected.has(app.name), process }] : [];
  });
  const errors: string[] = [];
  if (!processes) errors.push('Application inventory unavailable; placement state is unknown');
  if (!infrastructure) errors.push('Infrastructure inventory unavailable; service state is unknown');
  if (apps.some((app) => !app.expected && app.process))
    errors.push('Applications are running outside their configured placement');
  return {
    nodeKey: stackNodeKey(node.host, node.port),
    host: node.host,
    port: node.port ?? 9700,
    label: node.label ?? null,
    observedAt: processes || infrastructure ? observedAt : null,
    appsObserved: processes !== null,
    infrastructureObserved: infrastructure !== null,
    apps,
    infrastructure,
    errors,
  };
}

/** Aggregate logical applications without erasing physical replicas or partial reads. */
export function observeStack(info: IStackInfo, placements: IStackPlacement[], now = Date.now()): IStackInfo {
  const apps: IStackAppStatus[] = info.apps.map((app) => {
    const replicas = placements.flatMap((node) =>
      node.apps.filter((a) => a.name === app.name).map((a) => ({ ...a, known: node.appsObserved }))
    );
    const expected = replicas.filter((a) => a.expected);
    const statuses = expected.map((a) => (a.known ? (a.process?.status ?? 'stopped') : 'unknown'));
    const reported = replicas.flatMap((a) => (a.process ? [a.process] : []));
    let status: IStackAppStatus['status'];
    if (statuses.length === 0) status = 'unknown';
    else if (statuses.every((value) => value === statuses[0])) status = statuses[0]!;
    else if (statuses.includes('online')) status = 'degraded';
    else if (statuses.includes('unknown')) status = 'unknown';
    else status = 'degraded';
    // Unexpected replicas are drift, even when every desired replica is online.
    if (replicas.some((a) => !a.expected && a.process)) status = 'degraded';
    return {
      ...app,
      status,
      handleKey: reported.length === 1 ? reported[0]!.name : app.handleKey,
      pid: reported.length === 1 ? reported[0]!.pid : null,
      instances: reported.reduce((sum, p) => sum + p.instances, 0),
      cpu: reported.reduce((sum, p) => sum + p.cpu, 0),
      memory: reported.reduce((sum, p) => sum + p.memory, 0),
      restarts: reported.reduce((sum, p) => sum + p.restarts, 0),
      uptime: Math.max(0, ...reported.filter((p) => p.status === 'online').map((p) => p.uptime)),
      port: reported.length === 1 ? (reported[0]!.port ?? null) : null,
    };
  });
  const services: IStackInfraStatus['services'] = {};
  const names = new Map<string, number>();
  for (const node of placements)
    for (const name of Object.keys(node.infrastructure?.services ?? {})) {
      names.set(name, (names.get(name) ?? 0) + 1);
    }
  for (const node of placements)
    for (const [name, service] of Object.entries(node.infrastructure?.services ?? {})) {
      services[names.get(name)! > 1 ? `${node.nodeKey}/${name}` : name] = {
        ...service,
        service: service.service ?? name,
        nodeKey: node.nodeKey,
      };
    }
  const online = apps.filter((app) => app.status === 'online').length;
  const unknown = apps.some((app) => app.status === 'unknown');
  const partial = placements.some((node) => !node.appsObserved);
  const status: StackStatus =
    placements.length > 0 && placements.every((node) => !node.appsObserved)
      ? 'unknown'
      : apps.length > 0 && online === apps.length && !partial
        ? 'running'
        : online > 0 || apps.some((app) => app.status === 'degraded')
          ? 'degraded'
          : unknown
            ? 'unknown'
            : apps.every((app) => app.status === 'stopped')
              ? 'stopped'
              : info.status === 'starting'
                ? 'starting'
                : 'degraded';
  const uptime = Math.max(0, ...apps.map((app) => app.uptime));
  return {
    ...info,
    apps,
    placements,
    status,
    uptime,
    startedAt: uptime > 0 ? new Date(now - uptime).toISOString() : null,
    infrastructure: {
      ready: placements.length > 0 && placements.every((node) => node.infrastructure?.ready === true),
      services,
    },
    nodes: info.nodes.map((node) => {
      const observed = placements.find((p) => p.nodeKey === stackNodeKey(node.host, node.port));
      return observed ? { ...node, connected: observed.appsObserved } : node;
    }),
  };
}
