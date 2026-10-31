/**
 * Topology Store — what runs where, and what depends on what, for the
 * selected project and stack.
 *
 * Every part is read where the rest of the console reads it, and only the
 * relations the platform declares are drawn:
 *
 *   each stack's apps, nodes and services   `project.listStacks` — the stacks
 *                                           page's source; a remote stack's
 *                                           as its node reports them
 *   a local container's health, image, app  `infra.listContainers` — the runtime
 *   a local app's processes                 `daemon.list`
 *   service → app                           the container's `omnitron.app`
 *                                           label: provisioned for that app
 *
 * With no project selected, this daemon: its processes and every container
 * it manages.
 *
 * Measured on the master, 2026-09-23, before this: the services came from
 * `infra.getState()` — the daemon's in-memory bookkeeping, `null` after any
 * restart — so the page said «Incomplete: could not read infrastructure»
 * beside twelve running containers; the apps came from `daemon.list()`, this
 * machine's processes, so the remote stack test read «0/0 apps online» beside
 * the status bar's «Apps 6/6»; the one server drawn was the fleet registry's
 * leader, where test does not run; and every edge came from a table of
 * sample's app names from before they were namespaced (`pricing`, `payments`),
 * so not one was ever drawn — nor would one have been true.
 */

import { create } from 'zustand';
import type { Node, Edge, BuiltInEdge } from '@xyflow/react';
import { daemon, infra, project } from 'src/netron/client';
import { connectDependencies } from './dependency-graph';
import { arrangeTopologyNodes } from './topology-layout';
import type { ContainerState, DaemonStatusDto, IStackInfo, ProcessInfoDto } from '@omnitron-dev/omnitron/dto/services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TopologyNodeType = 'infra' | 'app' | 'gateway' | 'server';

export type ServiceHealth = 'healthy' | 'unhealthy' | 'starting' | 'none' | 'unknown';

/**
 * The state a service is drawn in: its health where the runtime measured one,
 * otherwise its status as reported — for a remote stack's, by its node.
 */
export const serviceState = (service: { health: ServiceHealth; status: string }): string =>
  service.status !== 'running' || service.health === 'none' || service.health === 'unknown'
    ? service.status
    : service.health;

export interface InfraNodeData {
  nodeType: 'infra';
  label: string;
  service: string;
  /** The stack that runs it; `null` for a container of this daemon's own. */
  stack: string | null;
  /** The app it was provisioned for (`omnitron.app`); absent when the stack runs it for all. */
  app?: string;
  port: number | null;
  /** From the runtime; `unknown` for a remote stack's, which this daemon cannot inspect. */
  health: ServiceHealth;
  status: string;
  containerId?: string;
  image?: string;
  startedAt?: string;
  [key: string]: unknown;
}

export interface AppNodeData {
  nodeType: 'app';
  label: string;
  /**
   * The name the platform's records keep it under: this daemon's handle
   * (`sample/dev/main`), or for a remote app the node's (`sample/deployed/main`)
   * — the one its logs are stored under.
   */
  name: string;
  stack: string | null;
  /** Run by a node: this daemon cannot inspect, restart or stop it. */
  remote: boolean;
  port: number | null;
  status: string;
  pid: number | null;
  cpu: number;
  memory: number;
  uptime: number;
  restarts: number;
  instances: number;
  processes?: Array<{
    name: string;
    type: string;
    status: string;
    pid: number | null;
    instances?: number;
    declaredInstances?: number;
  }>;
  [key: string]: unknown;
}

export interface GatewayNodeData {
  nodeType: 'gateway';
  label: string;
  stack: string | null;
  port: number | null;
  health: ServiceHealth;
  status: string;
  /** Whether the stack's tor service runs beside it. */
  hasTor: boolean;
  [key: string]: unknown;
}

export interface ServerNodeData {
  nodeType: 'server';
  label: string;
  hostname: string;
  address: string;
  /** The daemon's role there — `master`, `slave`. */
  role: string;
  status: string;
  /** The stacks it runs, and their apps. */
  stacks: string[];
  apps: string[];
  [key: string]: unknown;
}

export type TopologyNodeData = InfraNodeData | AppNodeData | GatewayNodeData | ServerNodeData;

/** What the diagram shows: a project and one of its stacks, a whole project, or this daemon. */
export interface TopologyScope {
  project: string | null;
  stack: string | null;
}

// ---------------------------------------------------------------------------
// Detail Panel
// ---------------------------------------------------------------------------

export interface DetailPanelState {
  open: boolean;
  nodeId: string | null;
  nodeType: TopologyNodeType | null;
  data: TopologyNodeData | null;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface TopologyState {
  // Data
  nodes: Node<TopologyNodeData>[];
  edges: Edge[];
  apps: AppNodeData[];
  daemonStatus: DaemonStatusDto | null;
  coverageWarnings: import('@omnitron-dev/omnitron/dto/services').ProjectTopology['warnings'];

  // UI state
  loading: boolean;
  error: string | null;
  scope: TopologyScope;
  detailPanel: DetailPanelState;

  // Actions
  fetchAll: () => Promise<void>;
  setScope: (scope: TopologyScope) => void;
  openDetail: (nodeId: string, nodeType: TopologyNodeType, data: TopologyNodeData) => void;
  closeDetail: () => void;

  // App actions — a local app's; a remote one belongs to its node.
  restartApp: (name: string) => Promise<void>;
  stopApp: (name: string) => Promise<void>;
  startApp: (name: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Reading the sources
// ---------------------------------------------------------------------------

/** One stack's part of the diagram, or this daemon's own when `stack` is null. */
export interface TopologyBand {
  stack: string | null;
  /** Physical deployment group; one logical stack may span several hosts. */
  placementKey?: string;
  servers: ServerNodeData[];
  services: InfraNodeData[];
  gateway: GatewayNodeData | null;
  apps: AppNodeData[];
}

const lastSegment = (name: string) => name.slice(name.lastIndexOf('/') + 1);

const firstPublishedPort = (container: ContainerState | undefined): number | null =>
  container?.ports ? (Object.values(container.ports)[0] ?? null) : null;

const processesOf = (process: ProcessInfoDto | undefined): Pick<AppNodeData, 'processes'> =>
  process?.processes
    ? {
        processes: process.processes.map(({ name, type, status, pid, instances, declaredInstances }) => ({
          name,
          type,
          status,
          pid,
          ...(instances !== undefined ? { instances } : {}),
          ...(declaredInstances !== undefined ? { declaredInstances } : {}),
        })),
      }
    : {};

function appFromProcess(process: ProcessInfoDto, stack: string | null): AppNodeData {
  return {
    nodeType: 'app',
    label: process.name,
    name: process.name,
    stack,
    remote: false,
    port: process.port,
    status: process.status,
    pid: process.pid,
    cpu: process.cpu,
    memory: process.memory,
    uptime: process.uptime,
    restarts: process.restarts,
    instances: process.instances,
    ...processesOf(process),
  };
}

/**
 * A service as the diagram draws it: the stack's own report of it, and —
 * for a container this daemon can see — the runtime's health, image and
 * the app it was provisioned for.
 */
function serviceNode(
  service: string,
  stack: string | null,
  reported: { status: string; port: number | null } | null,
  container: ContainerState | undefined
): InfraNodeData {
  return {
    nodeType: 'infra',
    label: service,
    service,
    stack,
    ...(container?.app && { app: container.app }),
    port: reported?.port ?? firstPublishedPort(container),
    health: container ? (container.health ?? 'none') : 'unknown',
    status: container?.status ?? reported?.status ?? 'unknown',
    ...(container?.containerId && { containerId: container.containerId }),
    ...(container?.image && { image: container.image }),
    ...(container?.startedAt && { startedAt: container.startedAt }),
  };
}

/** A band's services, with the gateway (and tor beside it) drawn as the gateway node. */
function withGateway(stack: string | null, services: InfraNodeData[]): Pick<TopologyBand, 'services' | 'gateway'> {
  const gateway = services.find((s) => s.service === 'gateway');
  if (!gateway) return { services, gateway: null };
  const tor = services.find((s) => s.service === 'tor');
  return {
    services: services.filter((s) => s !== gateway),
    gateway: {
      nodeType: 'gateway',
      label: 'Gateway',
      stack,
      port: gateway.port,
      health: gateway.health,
      status: gateway.status,
      hasTor: tor?.status === 'running',
      nodeKey: gateway.nodeKey,
      host: gateway.host,
      project: gateway.project,
    },
  };
}

/** The selected project's stacks, as bands. */
export function stackBands(
  stacks: IStackInfo[],
  scope: TopologyScope,
  processes: ProcessInfoDto[],
  containers: ContainerState[]
): TopologyBand[] {
  const processByHandle = new Map(processes.map((p) => [p.name, p]));
  return stacks
    .filter((s) => !scope.stack || s.name === scope.stack)
    .flatMap((s): TopologyBand[] => {
      const remote = s.type !== 'local';
      if (remote && s.placements)
        return s.placements.map((placement) => {
          const apps: AppNodeData[] = placement.apps.map(({ name, expected, process }) => ({
            nodeType: 'app',
            label: `${s.name}/${name}`,
            name: process?.name ?? `${scope.project}/${s.name}/${name}`,
            logicalApp: name,
            project: scope.project,
            stack: s.name,
            nodeKey: placement.nodeKey,
            host: placement.host,
            expected,
            present: Boolean(process),
            observed: placement.appsObserved,
            remote: true,
            status: placement.appsObserved ? (process?.status ?? 'stopped') : 'unknown',
            port: process?.port ?? null,
            pid: process?.pid ?? null,
            cpu: process?.cpu ?? 0,
            memory: process?.memory ?? 0,
            uptime: process?.uptime ?? 0,
            restarts: process?.restarts ?? 0,
            instances: process?.instances ?? 0,
            ...processesOf(process ?? undefined),
          }));
          const services: InfraNodeData[] = Object.entries(placement.infrastructure?.services ?? {}).map(
            ([name, service]) => ({
              nodeType: 'infra',
              label: service.service ?? name,
              service: service.service ?? name,
              identity: name,
              project: scope.project,
              stack: s.name,
              nodeKey: placement.nodeKey,
              host: placement.host,
              port: service.port,
              status: service.status,
              health: service.health ?? 'unknown',
              containerId: service.containerId,
              image: service.image,
              app: service.app,
            })
          );
          const declared = s.nodes.find((node) => node.host === placement.host && node.port === placement.port);
          const server: ServerNodeData = {
            nodeType: 'server',
            label: placement.label ?? placement.host,
            hostname: placement.host,
            address: placement.nodeKey,
            nodeKey: placement.nodeKey,
            role: declared?.daemonRole ?? 'slave',
            status: placement.appsObserved ? 'online' : 'unknown',
            stacks: [s.name],
            apps: apps.map((app) => app.name),
            observationErrors: placement.errors,
            observedAt: placement.observedAt,
          };
          return {
            stack: s.name,
            placementKey: `${s.name}@${placement.nodeKey}`,
            servers: [server],
            apps,
            ...withGateway(s.name, services),
          };
        });
      const apps = s.apps.map((a): AppNodeData => ({
        nodeType: 'app',
        label: `${s.name}/${a.name}`,
        name: a.handleKey,
        stack: s.name,
        remote,
        project: scope.project,
        logicalApp: a.name,
        nodeKey: remote ? (s.nodes.length === 1 ? `${s.nodes[0]!.host}:${s.nodes[0]!.port}` : undefined) : 'local',
        port: a.port,
        status: a.status,
        pid: a.pid,
        cpu: a.cpu,
        memory: a.memory,
        uptime: a.uptime,
        restarts: a.restarts,
        instances: a.instances,
        ...processesOf(remote ? undefined : processByHandle.get(a.handleKey)),
      }));
      // The containers this daemon can see are its own machine's: a remote
      // stack's run on its node, and are drawn as the node reports them.
      const byName = new Map(
        remote
          ? []
          : containers.filter((c) => c.project === scope.project && c.stack === s.name).map((c) => [c.name, c] as const)
      );
      const services = Object.entries(s.infrastructure?.services ?? {}).map(([service, reported]) => ({
        ...serviceNode(service, s.name, reported, byName.get(reported.containerName)),
        project: scope.project,
        nodeKey: remote ? (s.nodes.length === 1 ? `${s.nodes[0]!.host}:${s.nodes[0]!.port}` : undefined) : 'local',
        host: remote ? (s.nodes.length === 1 ? s.nodes[0]!.host : undefined) : 'localhost',
      }));
      const servers = s.nodes.map((n): ServerNodeData => ({
        nodeType: 'server',
        label: n.label ?? n.host,
        hostname: n.label ?? n.host,
        address: `${n.host}:${n.port}`,
        role: n.daemonRole,
        status: n.connected ? 'online' : 'offline',
        stacks: [s.name],
        apps: s.apps.map((a) => `${s.name}/${a.name}`),
      }));
      return [{ stack: s.name, servers, apps, ...withGateway(s.name, services) }];
    });
}

/**
 * This daemon, with no project selected: its processes and every container
 * it manages, a band per deployment they name — `project/stack` from a
 * process's handle and a container's labels — and one for its own.
 */
export function daemonBands(processes: ProcessInfoDto[], containers: ContainerState[]): TopologyBand[] {
  const bands = new Map<string, { processes: ProcessInfoDto[]; containers: ContainerState[] }>();
  const band = (key: string) => {
    if (!bands.has(key)) bands.set(key, { processes: [], containers: [] });
    return bands.get(key)!;
  };
  for (const p of processes) {
    const parts = p.name.split('/');
    band(parts.length >= 3 ? `${parts[0]}/${parts[1]}` : '').processes.push(p);
  }
  for (const c of containers) band(c.project && c.stack ? `${c.project}/${c.stack}` : '').containers.push(c);

  return [...bands].map(([key, members]) => {
    const stack = key ? lastSegment(key) : null;
    const services = members.containers.map((c) => serviceNode(c.service ?? c.name, stack, null, c));
    return {
      stack: key || null,
      servers: [],
      apps: members.processes.map((p) => appFromProcess(p, stack)),
      ...withGateway(stack, services),
    };
  });
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Stable identities and declared relationships, with a compact initial layout.
 * The workspace rearranges these deployment groups for the available width.
 */
export function layoutBands(bands: TopologyBand[]): { nodes: Node<TopologyNodeData>[]; edges: Edge[] } {
  const nodes: Node<TopologyNodeData>[] = [];
  const edges: Edge[] = [];
  const serversPlaced = new Map<string, Node<TopologyNodeData>>();

  for (const band of bands) {
    const key = band.placementKey ?? band.stack ?? 'daemon';
    for (const server of band.servers) {
      // A machine that runs two stacks is one machine.
      const placed = serversPlaced.get(server.address);
      if (placed) {
        const data = placed.data as ServerNodeData;
        placed.data = { ...data, stacks: [...data.stacks, ...server.stacks], apps: [...data.apps, ...server.apps] };
        continue;
      }
      const node: Node<TopologyNodeData> = {
        id: `server-${server.address}`,
        type: 'serverNode',
        position: { x: 0, y: 0 },
        data: server,
      };
      serversPlaced.set(server.address, node);
      nodes.push(node);
    }

    for (const service of band.services) {
      nodes.push({
        id: `infra-${key}-${service.identity ?? service.service}`,
        type: 'infraNode',
        position: { x: 0, y: 0 },
        data: service,
      });
    }

    for (const app of band.apps) {
      // Keyed by band too: every remote stack's node names its apps alike,
      // `sample/deployed/main`.
      const id = `app-${key}-${app.name}`;
      nodes.push({ id, type: 'appNode', position: { x: 0, y: 0 }, data: app });

      for (const service of band.services) {
        if (!service.app || service.app !== lastSegment(app.name)) continue;
        const edge: BuiltInEdge = {
          id: `edge-${key}-${service.identity ?? service.service}-${app.name}`,
          source: `infra-${key}-${service.identity ?? service.service}`,
          target: id,
          type: 'smoothstep',
          pathOptions: { offset: 8, borderRadius: 4 },
          animated: false,
          label: 'Provisioned for',
          data: { evidence: 'ownership', via: ['omnitron.app'] },
          style: {
            stroke: service.health === 'healthy' || service.health === 'none' ? '#22c55e' : '#ef4444',
            strokeDasharray: '6 3',
            strokeWidth: 1.5,
          },
        };
        edges.push(edge);
      }
    }

    if (band.gateway) {
      nodes.push({
        id: `gateway-${key}`,
        type: 'gatewayNode',
        position: { x: 0, y: 0 },
        data: band.gateway,
      });
    }
    if (band.placementKey && band.servers.length === 1) {
      const server = serversPlaced.get(band.servers[0]!.address)!;
      for (const resource of nodes.filter(
        (node) => node.id !== server.id && node.data.nodeKey === server.data.nodeKey
      )) {
        const id = `placement:${server.id}:${resource.id}`;
        if (!edges.some((edge) => edge.id === id))
          edges.push({
            id,
            source: server.id,
            target: resource.id,
            type: 'smoothstep',
            label: resource.data.present === false ? 'expected on' : 'hosts',
            data: {
              evidence: resource.data.present === false ? 'declaration' : 'placement',
              via: [resource.data.present === false ? 'stack configuration' : 'node inventory'],
            },
            style: { strokeWidth: 1, opacity: 0.45 },
          });
      }
    }
  }

  for (const node of nodes) {
    if (node.data.nodeType !== 'server') {
      const band = bands.find(
        (band) =>
          band.apps.includes(node.data as AppNodeData) ||
          band.services.includes(node.data as InfraNodeData) ||
          band.gateway === node.data
      );
      node.data.deploymentKey = band?.placementKey ?? band?.stack ?? null;
    }
  }
  return { nodes: arrangeTopologyNodes(nodes, 3), edges };
}

// ---------------------------------------------------------------------------
// Store creation
// ---------------------------------------------------------------------------

export const useTopologyStore = create<TopologyState>((set, get) => ({
  nodes: [],
  edges: [],
  apps: [],
  daemonStatus: null,
  coverageWarnings: [],
  loading: true,
  error: null,
  scope: { project: null, stack: null },
  detailPanel: { open: false, nodeId: null, nodeType: null, data: null },

  fetchAll: async () => {
    const { scope } = get();
    // Each question settles on its own, a throw included: one source that
    // cannot answer thins the diagram, it does not blank it.
    const ask = <T>(question: () => Promise<T>) => Promise.resolve().then(question);
    const [stacksAnswer, processesAnswer, containersAnswer, statusAnswer, dependenciesAnswer] =
      await Promise.allSettled([
        scope.project ? ask(() => project.listStacks({ project: scope.project! })) : Promise.resolve(null),
        ask(() => daemon.list()),
        ask(() => infra.listContainers()),
        ask(() => daemon.status()),
        ask(() =>
          project.getTopology({
            ...(scope.project ? { project: scope.project } : {}),
            ...(scope.stack ? { stack: scope.stack } : {}),
          })
        ),
      ]);
    // An answer for a scope the page has since left is not drawn.
    if (get().scope !== scope) return;

    const processes = processesAnswer.status === 'fulfilled' ? processesAnswer.value : [];
    const containers = containersAnswer.status === 'fulfilled' ? containersAnswer.value : [];
    const stacks = stacksAnswer.status === 'fulfilled' ? stacksAnswer.value : null;

    const bands = scope.project
      ? stackBands(stacks ?? [], scope, processes, containers)
      : daemonBands(processes, containers);
    const { nodes, edges } = layoutBands(bands);
    if (dependenciesAnswer.status === 'fulfilled')
      connectDependencies(nodes, edges, dependenciesAnswer.value.dependencies, scope);
    // The system view shows this daemon's apps. An inactive registration or a
    // remote deployment must not make those apps look partially unreadable.
    const visibleApps = new Set(bands.flatMap((band) => band.apps.map((app) => app.name)));
    const coverageWarnings =
      dependenciesAnswer.status === 'fulfilled'
        ? dependenciesAnswer.value.warnings.filter(
            (warning) =>
              scope.project || !warning.app || visibleApps.has(`${warning.project}/${warning.stack}/${warning.app}`)
          )
        : [];

    // Which sources could not answer — named, because a blank or thinned
    // diagram is otherwise a picture of a platform with less in it, which is
    // a different claim from "I could not find out".
    const unavailable: string[] = [];
    if (stacksAnswer.status === 'rejected') unavailable.push(`${scope.project}'s stacks`);
    if (processesAnswer.status === 'rejected') unavailable.push("this daemon's processes");
    if (containersAnswer.status === 'rejected') unavailable.push('container health');
    if (statusAnswer.status === 'rejected') unavailable.push('daemon status');
    if (dependenciesAnswer.status === 'rejected')
      unavailable.push('configured dependencies (a compatible backend is required)');
    const failedSources = unavailable.length;
    if (coverageWarnings.length)
      unavailable.push(`${coverageWarnings.length} dependency declarations (see coverage details)`);
    const unreadPlacements = (stacks ?? [])
      .filter((s) => !scope.stack || s.name === scope.stack)
      .flatMap((s) =>
        (s.placements ?? []).flatMap((p) => p.errors.map((reason) => `${s.name}@${p.nodeKey}: ${reason}`))
      );
    const asked = scope.project ? 5 : 4;

    set({
      coverageWarnings,
      apps: bands.flatMap((band) => band.apps),
      daemonStatus: statusAnswer.status === 'fulfilled' ? statusAnswer.value : null,
      nodes,
      edges,
      detailPanel: (() => {
        const current = get().detailPanel;
        const selected = nodes.find((node) => node.id === current.nodeId);
        return current.open && selected
          ? { ...current, data: selected.data }
          : { open: false, nodeId: null, nodeType: null, data: null };
      })(),
      loading: false,
      error:
        unavailable.length === 0 && unreadPlacements.length === 0
          ? null
          : failedSources >= asked
            ? 'Could not reach the daemon — this diagram is empty because nothing could be read, not because nothing is running.'
            : stacksAnswer.status === 'rejected'
              ? `Could not read ${scope.project}'s stacks — this diagram is empty because they could not be read, not because nothing is running.`
              : [unavailable.length ? `Incomplete: could not read ${unavailable.join(', ')}.` : '', ...unreadPlacements]
                  .filter(Boolean)
                  .join(' '),
    });
  },

  setScope: (scope) => {
    const current = get().scope;
    if (current.project === scope.project && current.stack === scope.stack) return;
    set({
      scope,
      loading: true,
      nodes: [],
      edges: [],
      coverageWarnings: [],
      apps: [],
      error: null,
      detailPanel: { open: false, nodeId: null, nodeType: null, data: null },
    });
    void get().fetchAll();
  },

  openDetail: (nodeId, nodeType, data) => set({ detailPanel: { open: true, nodeId, nodeType, data } }),

  closeDetail: () => set({ detailPanel: { open: false, nodeId: null, nodeType: null, data: null } }),

  restartApp: async (name) => {
    try {
      await daemon.restartApp({ name });
      await get().fetchAll();
    } catch (err: any) {
      set({ error: `Failed to restart ${name}: ${err?.message}` });
    }
  },

  stopApp: async (name) => {
    try {
      // `stopApp` does NOT throw on failure — it answers
      // `{ success: false, error }` on purpose, so a Netron client can render
      // the reason. The `catch` below is therefore on the wrong path: it
      // exists, reads as error handling, and never runs, so a stop that
      // failed looked exactly like one that worked.
      const result = await daemon.stopApp({ name });
      if (!result.success) {
        set({ error: `Failed to stop ${name}: ${result.error ?? 'the daemon reported failure'}` });
        return;
      }
      await get().fetchAll();
    } catch (err: any) {
      set({ error: `Failed to stop ${name}: ${err?.message}` });
    }
  },

  startApp: async (name) => {
    try {
      await daemon.startApp({ name });
      await get().fetchAll();
    } catch (err: any) {
      set({ error: `Failed to start ${name}: ${err?.message}` });
    }
  },
}));
