/**
 * Topology Store — Zustand state management for the infrastructure topology view.
 *
 * Fetches daemon status, app list, fleet nodes, and infrastructure state,
 * then transforms them into React Flow nodes and edges for visualization.
 */

import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';
import { daemon, infra, fleet } from 'src/netron/client';
import type { ProcessInfoDto, DaemonStatusDto } from '@omnitron-dev/omnitron/dto/services';

// ---------------------------------------------------------------------------
// Container state type (mirrors @omnitron-dev/omnitron infrastructure types)
// ---------------------------------------------------------------------------

interface ContainerState {
  name: string;
  image: string;
  status: string;
  containerId?: string;
  ports?: Record<string, number>;
  health?: 'healthy' | 'unhealthy' | 'starting' | 'none';
  startedAt?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TopologyNodeType = 'infra' | 'app' | 'gateway' | 'server';

export interface InfraNodeData {
  nodeType: 'infra';
  label: string;
  service: string;
  port: number;
  health: 'healthy' | 'unhealthy' | 'starting' | 'none' | 'unknown';
  status: string;
  containerId?: string;
  image?: string;
  startedAt?: string;
  [key: string]: unknown;
}

export interface AppNodeData {
  nodeType: 'app';
  label: string;
  name: string;
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
  }>;
  [key: string]: unknown;
}

export interface GatewayNodeData {
  nodeType: 'gateway';
  label: string;
  port: number;
  health: 'healthy' | 'unhealthy' | 'starting' | 'none' | 'unknown';
  status: string;
  hasTor: boolean;
  routes: Array<{ path: string; target: string }>;
  [key: string]: unknown;
}

export interface ServerNodeData {
  nodeType: 'server';
  label: string;
  hostname: string;
  address: string;
  role: string;
  status: string;
  cpu?: number;
  memory?: number;
  disk?: number;
  apps: string[];
  [key: string]: unknown;
}

export type TopologyNodeData = InfraNodeData | AppNodeData | GatewayNodeData | ServerNodeData;

// The daemon's shape. The local copy listed four roles where the server has
// seven ('candidate', 'gateway', 'worker' were missing) and three statuses
// where the server has four ('joining'), so any node in one of those states
// was typed as impossible while rendering perfectly well at runtime.
export type FleetNode = import('@omnitron-dev/omnitron/dto/services').FleetNode;

/** Read a numeric field out of a node's metadata bag, if present. */
function numericMetadata(metadata: FleetNode['metadata'], key: string): number | undefined {
  const value = metadata?.[key];
  return typeof value === 'number' ? value : undefined;
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
  apps: ProcessInfoDto[];
  daemonStatus: DaemonStatusDto | null;
  infraServices: Record<string, ContainerState>;
  fleetNodes: FleetNode[];

  // UI state
  loading: boolean;
  error: string | null;
  /** Stack namespace prefix for filtering (e.g., "omni/dev/") */
  filterPrefix: string;
  detailPanel: DetailPanelState;

  // Actions
  fetchAll: () => Promise<void>;
  setFilterPrefix: (prefix: string) => void;
  openDetail: (nodeId: string, nodeType: TopologyNodeType, data: TopologyNodeData) => void;
  closeDetail: () => void;
  setNodes: (nodes: Node<TopologyNodeData>[]) => void;
  setEdges: (edges: Edge[]) => void;

  // App actions
  restartApp: (name: string) => Promise<void>;
  stopApp: (name: string) => Promise<void>;
  startApp: (name: string) => Promise<void>;
  scaleApp: (name: string, instances: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Infra service metadata
// ---------------------------------------------------------------------------

const INFRA_PORTS: Record<string, number> = {
  postgres: 5432,
  redis: 6379,
  minio: 9000,
  gateway: 8080,
  tor: 9050,
};

const INFRA_DEPS: Record<string, string[]> = {
  main: ['postgres', 'redis'],
  storage: ['postgres', 'redis', 'minio'],
  messaging: ['postgres', 'redis'],
  priceverse: ['postgres', 'redis'],
  paysys: ['postgres', 'redis'],
};

const GATEWAY_APPS = ['main', 'storage', 'gateway'];

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function buildFlowGraph(
  apps: ProcessInfoDto[],
  infraServices: Record<string, ContainerState>,
  fleetNodes: FleetNode[],
): { nodes: Node<TopologyNodeData>[]; edges: Edge[] } {
  const nodes: Node<TopologyNodeData>[] = [];
  const edges: Edge[] = [];

  const colX = { infra: 0, app: 360, gateway: 720 };
  const nodeW = 280;
  const nodeGap = 24;

  // --- Infrastructure nodes (left column) ---
  const infraKeys = Object.keys(infraServices).filter(
    (k) => k !== 'gateway' && k !== 'tor',
  );
  let infraY = 0;

  for (const key of infraKeys) {
    const svc = infraServices[key]!;
    const port: number = svc.ports ? (Object.values(svc.ports)[0] as number | undefined) ?? INFRA_PORTS[key] ?? 0 : INFRA_PORTS[key] ?? 0;
    const nodeHeight = 120;

    nodes.push({
      id: `infra-${key}`,
      type: 'infraNode',
      position: { x: colX.infra, y: infraY },
      data: {
        nodeType: 'infra',
        label: key,
        service: key,
        port,
        health: (svc.health as InfraNodeData['health']) ?? 'unknown',
        status: svc.status,
        containerId: svc.containerId,
        image: svc.image,
        startedAt: svc.startedAt,
      },
    });

    infraY += nodeHeight + nodeGap;
  }

  // --- App nodes (center column) ---
  let appY = 0;
  for (const app of apps) {
    const nodeHeight = app.processes && app.processes.length > 0
      ? 140 + app.processes.length * 28
      : 140;

    nodes.push({
      id: `app-${app.name}`,
      type: 'appNode',
      position: { x: colX.app, y: appY },
      data: {
        nodeType: 'app',
        label: app.name,
        name: app.name,
        port: app.port,
        status: app.status,
        pid: app.pid,
        cpu: app.cpu,
        memory: app.memory,
        uptime: app.uptime,
        restarts: app.restarts,
        instances: app.instances,
        processes: app.processes?.map((p) => ({
          name: p.name,
          type: p.type,
          status: p.status,
          pid: p.pid,
        })),
      },
    });

    // Infrastructure → App dependency edges
    const deps = INFRA_DEPS[app.name];
    if (deps) {
      for (const dep of deps) {
        if (infraServices[dep]) {
          edges.push({
            id: `edge-${dep}-${app.name}`,
            source: `infra-${dep}`,
            target: `app-${app.name}`,
            type: 'smoothstep',
            animated: infraServices[dep]!.status === 'running',
            style: {
              stroke: infraServices[dep]!.health === 'healthy' ? '#22c55e' : '#ef4444',
              strokeDasharray: '6 3',
              strokeWidth: 1.5,
            },
          });
        }
      }
    }

    appY += nodeHeight + nodeGap;
  }

  // --- Gateway node (right column) ---
  const gatewaySvc = infraServices['gateway'];
  if (gatewaySvc) {
    const torSvc = infraServices['tor'];
    const routes = apps
      .filter((a) => a.port)
      .map((a) => ({ path: `/${a.name}`, target: `localhost:${a.port}` }));

    nodes.push({
      id: 'gateway-main',
      type: 'gatewayNode',
      position: { x: colX.gateway, y: 0 },
      data: {
        nodeType: 'gateway',
        label: 'Gateway',
        port: gatewaySvc.ports?.['80'] ?? 8080,
        health: (gatewaySvc.health as GatewayNodeData['health']) ?? 'unknown',
        status: gatewaySvc.status,
        hasTor: !!torSvc && torSvc.status === 'running',
        routes,
      },
    });

    // App → Gateway edges
    for (const app of apps) {
      if (app.port && GATEWAY_APPS.includes(app.name)) {
        edges.push({
          id: `edge-${app.name}-gateway`,
          source: `app-${app.name}`,
          target: 'gateway-main',
          type: 'smoothstep',
          style: {
            stroke: '#3b82f6',
            strokeWidth: 1.5,
          },
        });
      }
    }
  }

  // --- Inter-service RPC edges ---
  for (const app of apps) {
    if (app.name === 'messaging') {
      const mainApp = apps.find((a) => a.name === 'main');
      if (mainApp) {
        edges.push({
          id: 'edge-messaging-main',
          source: 'app-messaging',
          target: 'app-main',
          type: 'smoothstep',
          style: {
            stroke: '#a855f7',
            strokeDasharray: '3 3',
            strokeWidth: 1,
          },
          label: 'RPC',
          labelStyle: { fontSize: 10, fill: '#a855f7' },
          labelBgStyle: { fill: '#0a0a0f', fillOpacity: 0.8 },
        });
      }
    }
  }

  // --- Server nodes (for prod fleet) ---
  let serverY = Math.max(infraY, appY) + 60;
  for (const server of fleetNodes) {
    nodes.push({
      id: `server-${server.id}`,
      type: 'serverNode',
      position: { x: colX.infra, y: serverY },
      data: {
        nodeType: 'server',
        label: server.hostname,
        hostname: server.hostname,
        address: server.address,
        role: server.role,
        status: server.status,
        // FleetNode carries no cpu/memory of its own — the store used to read
        // `server.cpu` / `server.memory`, which were always undefined. The
        // node's metadata bag is where a health reporter would put them.
        cpu: numericMetadata(server.metadata, 'cpu'),
        memory: numericMetadata(server.metadata, 'memory'),
        apps: [],
      },
    });
    serverY += 180 + nodeGap;
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Store creation
// ---------------------------------------------------------------------------

export const useTopologyStore = create<TopologyState>((set, get) => ({
  nodes: [],
  edges: [],
  apps: [],
  daemonStatus: null,
  infraServices: {},
  fleetNodes: [],
  loading: true,
  error: null,
  filterPrefix: '',
  detailPanel: { open: false, nodeId: null, nodeType: null, data: null },

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  fetchAll: async () => {
    try {
      const [appList, status, infraState, fleetResult] = await Promise.allSettled([
        daemon.list(),
        daemon.status(),
        // These two already swallow their own failures, so `allSettled`
        // reports them as fulfilled-with-empty. Counted below via the value
        // rather than the settle status, because "no containers" and "could
        // not ask about containers" draw the same empty diagram.
        infra.getState().catch(() => null),
        fleet.listNodes().catch(() => null),
      ]);

      const allApps = appList.status === 'fulfilled' ? appList.value : [];
      const prefix = get().filterPrefix;
      const apps = prefix
        ? allApps.filter((a: any) => a.name.startsWith(prefix) || !a.name.includes('/'))
        : allApps;
      const daemonStatus = status.status === 'fulfilled' ? status.value : null;
      const infraValue = infraState.status === 'fulfilled' ? infraState.value : null;
      const infraMap = infraValue && typeof infraValue === 'object' && 'services' in infraValue
        ? ((infraValue as { services: Record<string, ContainerState> }).services ?? {})
        : {};
      const fleetNodes = fleetResult.status === 'fulfilled' && Array.isArray(fleetResult.value)
        ? fleetResult.value
        : [];

      // Which sources could not answer.
      //
      // `Promise.allSettled` never rejects, so the catch below is unreachable
      // for a source that simply failed — and every failure was being turned
      // into an empty array or an empty map on its way to the diagram. With
      // the daemon down, all four failed and the topology rendered an empty
      // canvas with `error: null`: a picture of a platform with nothing in
      // it, which is a different claim from "I could not find out".
      const unavailable: string[] = [];
      if (appList.status === 'rejected') unavailable.push('applications');
      if (status.status === 'rejected') unavailable.push('daemon status');
      if (infraState.status !== 'fulfilled' || infraState.value === null) unavailable.push('infrastructure');
      if (fleetResult.status !== 'fulfilled' || fleetResult.value === null) unavailable.push('fleet nodes');

      const { nodes, edges } = buildFlowGraph(apps, infraMap, fleetNodes);

      set({
        apps,
        daemonStatus,
        infraServices: infraMap,
        fleetNodes,
        nodes,
        edges,
        loading: false,
        // Partial data is still worth drawing — that is what `allSettled` is
        // for — but not worth presenting as complete.
        error:
          unavailable.length === 0
            ? null
            : unavailable.length === 4
              ? 'Could not reach the daemon — this diagram is empty because nothing could be read, not because nothing is running.'
              : `Incomplete: could not read ${unavailable.join(', ')}. The rest of the diagram is current.`,
      });
    } catch (err: any) {
      set({
        error: err?.message ?? 'Failed to fetch topology data',
        loading: false,
      });
    }
  },

  setFilterPrefix: (prefix) => set({ filterPrefix: prefix }),

  openDetail: (nodeId, nodeType, data) =>
    set({ detailPanel: { open: true, nodeId, nodeType, data } }),

  closeDetail: () =>
    set({ detailPanel: { open: false, nodeId: null, nodeType: null, data: null } }),

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

  scaleApp: async (name, instances) => {
    try {
      await daemon.scale({ name, instances });
      await get().fetchAll();
    } catch (err: any) {
      set({ error: `Failed to scale ${name}: ${err?.message}` });
    }
  },
}));
