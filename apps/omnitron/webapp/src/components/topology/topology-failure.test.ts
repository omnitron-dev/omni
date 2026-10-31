/**
 * What the topology says when it could not read something.
 *
 * `Promise.allSettled` never rejects, so the store's outer `catch` cannot see
 * a source that merely failed — and each failure was converted into an empty
 * array or an empty map before reaching the diagram. With the daemon down,
 * all four sources failed and the page rendered an empty canvas with
 * `error: null`: a picture of a platform with nothing in it, which is a
 * different claim from "I could not find out".
 *
 * The distinction is the whole value of the page. An operator looking at an
 * empty topology concludes their platform is gone; the same operator told
 * "could not reach the daemon" goes and looks at the daemon.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const daemon = { list: vi.fn(), status: vi.fn() };
const infra = { listContainers: vi.fn() };
const project = { getTopology: vi.fn(), getTopologyInventory: vi.fn() };

vi.mock('src/netron/client', () => ({
  daemon: { list: (...a: unknown[]) => daemon.list(...a), status: (...a: unknown[]) => daemon.status(...a) },
  infra: { listContainers: (...a: unknown[]) => infra.listContainers(...a) },
  project: { getTopology: (...a: unknown[]) => project.getTopology(...a), getTopologyInventory: () => project.getTopologyInventory() },
  metrics: {},
  daemonClient: { use: () => {}, daemon: {} },
}));

/** Everything answers, with nothing in it — a genuinely empty platform. */
function allAnswerEmpty() {
  daemon.list.mockResolvedValue([]);
  daemon.status.mockResolvedValue({ apps: [], totalCpu: 0, totalMemory: 0 });
  infra.listContainers.mockResolvedValue([]);
  project.getTopology.mockResolvedValue({ version: 1, dependencies: [], warnings: [] });
  project.getTopologyInventory.mockResolvedValue({ deployments: [], errors: [] });
}

/** Nothing answers — the daemon is down. */
function allFail() {
  const down = () => Promise.reject(new Error('ECONNREFUSED'));
  daemon.list.mockImplementation(down);
  daemon.status.mockImplementation(down);
  infra.listContainers.mockImplementation(down);
  project.getTopology.mockImplementation(down);
  project.getTopologyInventory.mockImplementation(down);
}

async function store() {
  vi.resetModules();
  const mod = await import('./topology-store.js');
  return mod.useTopologyStore;
}

beforeEach(() => {
  vi.clearAllMocks();
  allAnswerEmpty();
});

describe('an empty topology', () => {
  it('coalesces overlapping refreshes without accumulating fleet reads', async () => {
    let finish!: (value: unknown) => void;
    project.getTopologyInventory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const useStore = await store();
    const first = useStore.getState().fetchAll();
    const second = useStore.getState().fetchAll();
    await vi.waitFor(() => expect(project.getTopologyInventory).toHaveBeenCalledTimes(1));
    finish({ deployments: [], errors: [] });
    await Promise.all([first, second]);
    await useStore.getState().fetchAll();
    expect(project.getTopologyInventory).toHaveBeenCalledTimes(2);
  });

  it('keeps applications and services distinct across projects sharing a physical node', async () => {
    project.getTopologyInventory.mockResolvedValue({ errors: [], deployments: ['alpha', 'beta'].map(name => ({ project: name, stack: {
      name: 'prod', type: 'remote', nodes: [], apps: [], config: { type: 'remote' },
      placements: [{ host: 'worker.example', port: 9700, nodeKey: 'worker.example:9700', appsObserved: true,
        infrastructureObserved: true, observedAt: new Date().toISOString(), errors: [],
        apps: [{ name: 'api', expected: true, process: { name: `${name}/deployed/api`, status: 'online', instances: 1 } }],
        infrastructure: { ready: true, services: { postgres: { service: 'postgres', containerName: `${name}-prod-postgres`, status: 'running', health: 'healthy', port: 5432 } } },
      }],
    } })) });
    project.getTopology.mockResolvedValue({ version: 1, dependencies: [], warnings: [{ project: 'alpha', stack: 'prod', app: 'api', reason: 'Unverified binding' }] });
    const useStore = await store();
    await useStore.getState().fetchAll();
    const state = useStore.getState();
    expect(state.nodes.filter(node => node.type === 'serverNode')).toHaveLength(1);
    expect(state.nodes.filter(node => node.type === 'appNode')).toHaveLength(2);
    expect(state.nodes.filter(node => node.type === 'infraNode')).toHaveLength(2);
    expect(new Set(state.nodes.map(node => node.id)).size).toBe(state.nodes.length);
    expect(state.edges.filter(edge => edge.data?.evidence === 'placement')).toHaveLength(4);
    expect(state.coverageWarnings).toHaveLength(1);
  });
  it('limits app coverage warnings to the apps displayed in the daemon view', async () => {
    daemon.list.mockResolvedValue([{ name: 'sample/dev/api', status: 'online' }]);
    project.getTopology.mockResolvedValue({
      version: 1,
      dependencies: [],
      warnings: [
        { project: 'sample', stack: 'dev', app: 'api', reason: 'Bootstrap metadata not loaded' },
        { project: 'sample', stack: 'prod', app: 'api', reason: 'Bootstrap metadata not loaded' },
        { project: 'archived', stack: 'dev', app: 'worker', reason: 'Bootstrap metadata not loaded' },
      ],
    });
    const useStore = await store();
    await useStore.getState().fetchAll();
    expect(useStore.getState().coverageWarnings).toHaveLength(1);
    expect(useStore.getState().error).toContain('1 dependency declarations');
  });
  it('reports no error when the platform really is empty', async () => {
    allAnswerEmpty();
    const useStore = await store();

    await useStore.getState().fetchAll();

    expect(useStore.getState().error).toBeNull();
  });

  it('says the daemon could not be reached when nothing answered', async () => {
    // The defect: this produced the same blank canvas as the case above,
    // with error: null.
    allFail();
    const useStore = await store();

    await useStore.getState().fetchAll();

    const { error, nodes } = useStore.getState();
    expect(error).toBeTruthy();
    expect(error).toMatch(/could not reach the daemon/i);
    // And it says why the canvas is blank, in those words.
    expect(error).toMatch(/not because nothing is running/i);
    expect(nodes).toEqual([]);
  });

  it('still draws what it could read, and names what it could not', async () => {
    // Partial data is worth drawing — that is what allSettled is for — but
    // not worth presenting as complete.
    daemon.list.mockResolvedValue([{ name: 'main', status: 'online' }]);
    daemon.status.mockResolvedValue({ apps: [], totalCpu: 0, totalMemory: 0 });
    infra.listContainers.mockImplementation(() => Promise.reject(new Error('no docker')));
    const useStore = await store();

    await useStore.getState().fetchAll();

    const { error, apps } = useStore.getState();
    expect(apps).toHaveLength(1);
    expect(error).toMatch(/incomplete/i);
    expect(error).toMatch(/container health/i);
    // A successful source can itself carry unknown/stale observations. Do not
    // promise that every other card is current just because the RPC answered.
    expect(error).not.toMatch(/rest of the diagram is current/i);
  });
});
