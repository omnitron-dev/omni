/**
 * A topology with edges nobody declared, drawn from sources that were not
 * the platform's.
 *
 * Measured on the master, 2026-09-23. The services came from
 * `infra.getState()` — the daemon's bookkeeping, `null` after any restart —
 * so the page said «Incomplete: could not read infrastructure» beside twelve
 * running containers. The apps came from `daemon.list()`, this machine's
 * processes: the remote stack test read «0/0 apps online» beside the status
 * bar's «Apps 6/6». The one server was the fleet registry's leader, where
 * test does not run. Every edge came from a table of daos's app names from
 * before they were namespaced — `pricing`, `payments` — so none was drawn.
 *
 * Now each stack's apps, nodes and services come from `listStacks` — a remote
 * stack's as its node reports them — a local container's health and owner
 * from the runtime, and the only edge is the declared one: a container
 * provisioned for an app (`omnitron.app`), to that app.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { ContainerState, IStackInfo, ProcessInfoDto } from '../../src/shared/dto/services.js';

const { client } = vi.hoisted(() => ({
  client: {
    listStacks: vi.fn(),
    list: vi.fn(),
    status: vi.fn(),
    listContainers: vi.fn(),
  },
}));

vi.mock('src/netron/client', () => ({
  project: { listStacks: client.listStacks },
  daemon: { list: client.list, status: client.status },
  infra: { listContainers: client.listContainers },
}));

const { stackBands, daemonBands, layoutBands, useTopologyStore } =
  await import('../../webapp/src/components/topology/topology-store.js');

const APPS = ['main', 'storage', 'paysys'];

const app = (stack: string, name: string, handleKey: string, port: number) => ({
  name,
  handleKey,
  status: 'online' as const,
  pid: 100 + port,
  instances: 1,
  uptime: 60_000,
  restarts: 0,
  cpu: 1,
  memory: 1_000,
  port,
});

const stack = (
  name: string,
  type: IStackInfo['type'],
  node: IStackInfo['nodes'][number],
  handle: (app: string) => string,
  services: Record<string, [containerName: string, port: number | null]>
): IStackInfo =>
  ({
    name,
    type,
    status: 'running',
    nodes: [node],
    apps: APPS.map((a, i) => app(name, a, handle(a), 3001 + i)),
    infrastructure: {
      ready: true,
      services: Object.fromEntries(
        Object.entries(services).map(([service, [containerName, port]]) => [
          service,
          { status: 'running', containerName, port },
        ])
      ),
    },
  }) as unknown as IStackInfo;

const node = (host: string, label: string, daemonRole: 'master' | 'slave') => ({
  host,
  port: 9700,
  role: 'app',
  label,
  daemonRole,
  connected: true,
  lastSeen: null,
  syncStatus: null,
});

/** As `listStacks` answered for daos: dev on this machine, test and staging on nodes. */
const STACKS: IStackInfo[] = [
  stack('dev', 'local', node('localhost', 'Local', 'master'), (a) => `daos/dev/${a}`, {
    postgres: ['daos-dev-postgres', 5432],
    bitcoin: ['daos-dev-bitcoin', 18443],
    gateway: ['daos-dev-gateway', 8080],
    tor: ['daos-dev-tor', null],
  }),
  stack('test', 'remote', node('37.27.130.185', 'test', 'slave'), (a) => `daos/deployed/${a}`, {
    postgres: ['daos-test-postgres', 5432],
    gateway: ['daos-test-gateway', 8080],
  }),
  stack('staging', 'remote', node('10.0.0.9', 'staging', 'slave'), (a) => `daos/deployed/${a}`, {
    postgres: ['daos-staging-postgres', 5432],
  }),
];

const container = (name: string, service: string, extra: Partial<ContainerState> = {}): ContainerState => ({
  name,
  image: `${service}:latest`,
  status: 'running',
  health: 'healthy',
  containerId: `${name}-id`,
  service,
  project: 'daos',
  stack: 'dev',
  ...extra,
});

/** As the runtime answered on the master: dev's, one provisioned for paysys, and the daemon's own. */
const CONTAINERS: ContainerState[] = [
  container('daos-dev-postgres', 'postgres'),
  container('daos-dev-bitcoin', 'bitcoin', { app: 'paysys' }),
  container('daos-dev-gateway', 'gateway'),
  container('daos-dev-tor', 'tor'),
  container('omnitron-pg', 'omnitron-pg', { project: undefined, stack: undefined }),
];

const PROCESSES = [
  { name: 'daos/dev/main', processes: [{ name: 'http', type: 'server', status: 'online', pid: 4001 }] },
  { name: 'omnitron-helper', processes: [] },
] as unknown as ProcessInfoDto[];

const scope = (stackName: string | null) => ({ project: 'daos', stack: stackName });

describe('a topology with edges nobody declared', () => {
  it("draws every stack's apps, a remote stack's as its node reports them", () => {
    const bands = stackBands(STACKS, scope(null), PROCESSES, CONTAINERS);
    const apps = bands.flatMap((b) => b.apps);

    expect(apps).toHaveLength(9);
    expect(apps.filter((a) => a.remote).map((a) => a.label)).toEqual([
      'test/main',
      'test/storage',
      'test/paysys',
      'staging/main',
      'staging/storage',
      'staging/paysys',
    ]);
    // Logs are kept under the node's name for a remote app.
    expect(apps.find((a) => a.label === 'test/main')!.name).toBe('daos/deployed/main');
    // A local app's processes are this daemon's.
    expect(apps.find((a) => a.label === 'dev/main')!.processes).toEqual([
      { name: 'http', type: 'server', status: 'online', pid: 4001 },
    ]);
  });

  it("draws each stack's services from its own report, and a local one's health from the runtime", () => {
    const [dev, test] = stackBands(STACKS, scope(null), PROCESSES, CONTAINERS);

    expect(dev!.services.map((s) => [s.service, s.health, s.app ?? null])).toEqual([
      ['postgres', 'healthy', null],
      ['bitcoin', 'healthy', 'paysys'],
    ]);
    // A remote stack's containers run on its node: reported, not inspected.
    expect(test!.services.map((s) => [s.service, s.status, s.health])).toEqual([['postgres', 'running', 'unknown']]);
    expect(dev!.gateway).toMatchObject({ port: 8080, hasTor: true, health: 'healthy' });
    expect(dev!.gateway).not.toHaveProperty('routes');
  });

  it('draws the one declared edge, and no other', () => {
    const { edges, nodes } = layoutBands(stackBands(STACKS, scope(null), PROCESSES, CONTAINERS));

    expect(edges.map((e) => [e.source, e.target])).toEqual([['infra-dev-bitcoin', 'app-dev-daos/dev/paysys']]);
    // Every remote stack's node names its apps alike; the diagram does not.
    const ids = nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("draws the machines the stacks run on, with the daemon's role and their apps", () => {
    const { nodes } = layoutBands(stackBands(STACKS, scope(null), PROCESSES, CONTAINERS));
    const servers = nodes.filter((n) => n.type === 'serverNode').map((n) => n.data);

    expect(servers.map((s) => [s.address, s.role, s.stacks])).toEqual([
      ['localhost:9700', 'master', ['dev']],
      ['37.27.130.185:9700', 'slave', ['test']],
      ['10.0.0.9:9700', 'slave', ['staging']],
    ]);
    expect(servers[1]!.apps).toEqual(['test/main', 'test/storage', 'test/paysys']);
  });

  it('draws one stack when one is selected, and nothing of the others', () => {
    const bands = stackBands(STACKS, scope('test'), PROCESSES, CONTAINERS);

    expect(bands.map((b) => b.stack)).toEqual(['test']);
    expect(bands[0]!.apps.every((a) => a.remote)).toBe(true);
    expect(bands[0]!.services.map((s) => s.service)).toEqual(['postgres']);
  });

  it('with no project, draws this daemon by the deployments its processes and containers name', () => {
    const bands = daemonBands(PROCESSES, CONTAINERS);

    expect(bands.map((b) => [b.stack, b.apps.map((a) => a.name), b.services.map((s) => s.service)])).toEqual([
      ['daos/dev', ['daos/dev/main'], ['postgres', 'bitcoin']],
      [null, ['omnitron-helper'], ['omnitron-pg']],
    ]);
    expect(bands[0]!.gateway).toMatchObject({ hasTor: true });
  });
});

describe('a topology that could not read one of its sources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.listStacks.mockResolvedValue(STACKS);
    client.list.mockResolvedValue(PROCESSES);
    client.status.mockResolvedValue({ version: '0.2.0' });
    client.listContainers.mockResolvedValue(CONTAINERS);
  });

  const fetchFor = async (stackName: string | null) => {
    useTopologyStore.setState({ scope: scope(stackName) });
    await useTopologyStore.getState().fetchAll();
    return useTopologyStore.getState();
  };

  it("counts a remote stack's apps as the status bar does", async () => {
    const state = await fetchFor('test');

    expect(state.apps.filter((a) => a.status === 'online')).toHaveLength(3);
    expect(state.error).toBeNull();
  });

  it("says the project's stacks could not be read, rather than draw an empty platform", async () => {
    client.listStacks.mockRejectedValue(new Error('timeout'));

    const state = await fetchFor(null);

    expect(state.nodes).toEqual([]);
    expect(state.error).toMatch(/could not read daos's stacks/i);
    expect(state.error).toMatch(/not because nothing is running/i);
  });

  it('draws the services as reported when the runtime cannot say how they are', async () => {
    client.listContainers.mockImplementation(() => {
      throw new Error('docker: not reachable');
    });

    const state = await fetchFor('dev');
    const services = state.nodes.filter((n) => n.type === 'infraNode').map((n) => n.data);

    expect(services.map((s) => [s.service, s.health])).toEqual([
      ['postgres', 'unknown'],
      ['bitcoin', 'unknown'],
    ]);
    expect(state.error).toMatch(/incomplete: could not read container health/i);
  });
});
