import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Resolvers for the pending `listStacks` calls, keyed by project. */
const pending = new Map<string, (stacks: unknown[]) => void>();

vi.mock('../../webapp/src/netron/client', () => ({
  project: {
    listProjects: vi.fn(async () => []),
    listStacks: vi.fn(
      ({ project }: { project: string }) =>
        new Promise((resolve) => pending.set(project, resolve as (s: unknown[]) => void))
    ),
    getStackStatus: vi.fn(async () => null),
  },
}));

/** A fresh store, with its module-scope persistence re-read. */
async function freshStore() {
  vi.resetModules();
  pending.clear();
  const mod = await import('../../webapp/src/stores/project.store.js');
  mod.useProjectStore.getState().setInventoryReaders('reader', 'reader');
  return mod.useProjectStore;
}

const stack = (name: string) => ({ name, status: 'stopped', apps: [] });

beforeEach(() => {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
    configurable: true,
    writable: true,
  });
});

describe('fetchStacks arriving late', () => {
  it('keeps the registered catalogue separate from cached stack observations', async () => {
    const store = await freshStore();
    const { project } = await import('../../webapp/src/netron/client.js');
    const first = { name: 'sample', displayName: 'Sample', path: '/sample', registeredAt: '',
      enabledStacks: [], runningStacks: 0, totalStacks: 2 };
    vi.mocked(project.listProjects).mockResolvedValueOnce([first]);
    await store.getState().fetchProjects();
    const observe = store.getState().fetchStacks('sample');
    pending.get('sample')!([stack('one')]);
    await observe;
    expect(store.getState().projects[0]?.totalStacks).toBe(2);
    vi.mocked(project.listProjects).mockResolvedValueOnce([{ ...first, totalStacks: 3 }]);
    await store.getState().fetchProjects();
    expect(store.getState().projects[0]?.totalStacks).toBe(3);
    expect(store.getState().stacksByProject.sample).toHaveLength(1);
  });

  it('shares concurrent catalogue reads and keeps the result requested after a change', async () => {
    const store = await freshStore();
    const { project } = await import('../../webapp/src/netron/client.js');
    const list = vi.mocked(project.listProjects);
    list.mockClear();
    let finish!: (value: Awaited<ReturnType<typeof project.listProjects>>) => void;
    list.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const old = store.getState().fetchProjects();
    const shared = store.getState().fetchProjects();
    expect(list).toHaveBeenCalledTimes(1);
    const added = { name: 'added', displayName: 'Added', path: '/added', registeredAt: '',
      enabledStacks: [], runningStacks: 0, totalStacks: 1 };
    list.mockResolvedValueOnce([added]);
    await store.getState().fetchProjects(true);
    finish([]);
    await Promise.all([old, shared]);
    expect(store.getState().projects).toEqual([added]);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('discards in-flight data and cached inventories when the reader changes', async () => {
    const store = await freshStore();
    const read = store.getState().fetchStacks('alpha');
    const deliverOld = pending.get('alpha')!;
    store.getState().setInventoryReaders('second-reader', 'second-reader');
    const next = store.getState().fetchStacks('alpha');
    const deliverNew = pending.get('alpha')!;
    deliverOld([stack('private')]);
    expect(await read).toBeNull();
    expect(store.getState().stacksByProject).toEqual({});
    deliverNew([stack('new')]);
    await next;
    expect(store.getState().stacksByProject['alpha']?.[0]?.name).toBe('new');
    store.getState().setInventoryReaders(null, null);
    expect(store.getState().stacksByProject).toEqual({});
    expect(await store.getState().fetchStacks('alpha')).toBeNull();
    expect(pending.get('alpha')).toBe(deliverNew);
  });
  it('does not restore a previous account’s project or saved route from a late directory listing', async () => {
    const store = await freshStore();
    const { project } = await import('../../webapp/src/netron/client.js');
    let finish!: (value: Awaited<ReturnType<typeof project.listProjects>>) => void;
    vi.mocked(project.listProjects).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const first = store.getState().fetchProjects();
    store.getState().setInventoryReaders(null, null);
    finish([{ name: 'private-project', displayName: 'Private', path: '/projects/private', registeredAt: '',
      enabledStacks: [], runningStacks: 0, totalStacks: 0 }]);
    await first;
    expect(store.getState().projects).toEqual([]);
    expect(store.getState().workspaceRoutes).toEqual({});
    expect(store.getState().loading).toBe(false);
  });
  it('records a late inventory under its owner and leaves the next workspace bookmark intact', async () => {
    const store = await freshStore();
    const read = store.getState().fetchStacks('alpha');
    store.getState().saveCurrentRoute('/projects/beta/logs?stack=test');
    pending.get('alpha')!([stack('only-in-alpha')]);
    await read;
    expect(store.getState().stacksByProject['alpha']).toHaveLength(1);
    expect(store.getState().workspaceRoutes).toEqual({ beta: '/projects/beta/logs?stack=test' });
    const { project } = await import('../../webapp/src/netron/client');
    vi.mocked(project.listStacks).mockRejectedValueOnce(new Error('Inventory unavailable'));
    expect(await store.getState().fetchStacks('alpha')).toBeNull();
    expect(store.getState().stackReadErrors['alpha']).toBe('Inventory unavailable');
    expect(store.getState().workspaceRoutes.beta).toBe('/projects/beta/logs?stack=test');
  });
});
