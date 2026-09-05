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
const infra = { getState: vi.fn() };
const fleet = { listNodes: vi.fn() };

vi.mock('src/netron/client', () => ({
  daemon: { list: (...a: unknown[]) => daemon.list(...a), status: (...a: unknown[]) => daemon.status(...a) },
  infra: { getState: (...a: unknown[]) => infra.getState(...a) },
  fleet: { listNodes: (...a: unknown[]) => fleet.listNodes(...a) },
  metrics: {},
  daemonClient: { use: () => {}, daemon: {} },
}));

/** Everything answers, with nothing in it — a genuinely empty platform. */
function allAnswerEmpty() {
  daemon.list.mockResolvedValue([]);
  daemon.status.mockResolvedValue({ apps: [], totalCpu: 0, totalMemory: 0 });
  infra.getState.mockResolvedValue({ services: {} });
  fleet.listNodes.mockResolvedValue([]);
}

/** Nothing answers — the daemon is down. */
function allFail() {
  const down = () => Promise.reject(new Error('ECONNREFUSED'));
  daemon.list.mockImplementation(down);
  daemon.status.mockImplementation(down);
  infra.getState.mockImplementation(down);
  fleet.listNodes.mockImplementation(down);
}

async function store() {
  vi.resetModules();
  const mod = await import('./topology-store.js');
  return mod.useTopologyStore;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('an empty topology', () => {
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
    infra.getState.mockImplementation(() => Promise.reject(new Error('no docker')));
    fleet.listNodes.mockResolvedValue([]);
    const useStore = await store();

    await useStore.getState().fetchAll();

    const { error, apps } = useStore.getState();
    expect(apps).toHaveLength(1);
    expect(error).toMatch(/incomplete/i);
    expect(error).toMatch(/infrastructure/i);
    // The rest is current, and says so — otherwise an operator distrusts
    // the whole diagram over one missing source.
    expect(error).toMatch(/rest of the diagram is current/i);
  });
});
