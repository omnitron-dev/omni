import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Resolvers for the pending `listStacks` calls, keyed by project. */
const pending = new Map<string, (stacks: unknown[]) => void>();
const lifecycle = vi.hoisted(() => vi.fn());

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

vi.mock('../../webapp/src/netron/client', () => ({
  invokeStackLifecycle: lifecycle,
  project: {
    listProjects: vi.fn(async () => []),
    listStacks: vi.fn(
      ({ project }: { project: string }) =>
        new Promise((resolve) => pending.set(project, resolve as (s: unknown[]) => void))
    ),
    addProject: vi.fn(), updateProject: vi.fn(), removeProject: vi.fn(), createStack: vi.fn(), deleteStack: vi.fn(),
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
  vi.clearAllMocks();
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

describe('stack and project actions belong to the reader that submitted them', () => {
  it.each(['startStack', 'stopStack', 'resumeInstalledStack'] as const)('discards a late %s reply while a new reader operates on the same stack', async method => {
    const store = await freshStore();
    const { project } = await import('../../webapp/src/netron/client.js');
    const previous = deferred<never>();
    const current = deferred<never>();
    lifecycle.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
    const first = method === 'stopStack' ? store.getState().stopStack('alpha', 'stage', 'first-review')
      : store.getState()[method]('alpha', 'stage');
    expect(store.getState().pendingOps['alpha/stage']).toBeDefined();
    store.getState().setInventoryReaders('next-reader', 'next-reader');
    expect(store.getState().pendingOps).toEqual({});
    const next = store.getState().stopStack('alpha', 'stage', 'second-review');
    previous.reject(new Error('previous reader private details'));
    const settled = await first;
    if (method === 'startStack') expect(settled).toEqual({ state: 'unconfirmed', message: 'Console access changed before the operation completed.' });
    expect(store.getState().pendingOps).toEqual({ 'alpha/stage': 'stopping' });
    expect(store.getState().stackNotices).toEqual({});
    expect(project.listStacks).not.toHaveBeenCalled();
    vi.mocked(project.listStacks).mockResolvedValueOnce([]);
    current.reject(new Error('current reader stop result'));
    await next;
    expect(store.getState().pendingOps).toEqual({});
    expect(store.getState().stackNotices).toEqual({ 'alpha/stage': 'current reader stop result' });
    expect(project.listStacks).toHaveBeenCalledOnce();
  });

  it.each(['poll before start', 'poll after start'])('revokes an already-reported start while awaiting its %s', async phase => {
    const store = await freshStore();
    const { project } = await import('../../webapp/src/netron/client.js');
    const earlier = phase === 'poll before start' ? store.getState().fetchStacks('alpha') : null;
    lifecycle.mockResolvedValueOnce({ status: 'running', apps: [], notUp: ['earlier account detail'] });
    const starting = store.getState().startStack('alpha', 'stage');
    await vi.waitFor(() => {
      expect(store.getState().stackNotices['alpha/stage']).toContain('earlier account detail');
      expect(pending.has('alpha')).toBe(true);
    });
    const deliverEarlier = pending.get('alpha')!;
    // The same account can regain a grant or sign in again. Old requests have still expired.
    store.getState().setInventoryReaders('reader', null);
    expect(store.getState().stackNotices).toEqual({});
    expect(store.getState().pendingOps).toEqual({});
    store.getState().setInventoryReaders('reader', 'reader');
    const current = deferred<never>();
    lifecycle.mockReturnValueOnce(current.promise);
    const next = store.getState().resumeInstalledStack('alpha', 'stage');
    deliverEarlier([stack('old')]);
    await earlier;
    expect((await starting).state).toBe('unconfirmed');
    expect(store.getState().stacksByProject).toEqual({});
    expect(store.getState().pendingOps['alpha/stage']).toBe('resuming');
    expect(store.getState().stackNotices).toEqual({});
    expect(project.listStacks).toHaveBeenCalledOnce();
    vi.mocked(project.listStacks).mockResolvedValueOnce([]);
    current.reject(new Error('new reader notice'));
    await next;
    expect(store.getState().stackNotices['alpha/stage']).toBe('new reader notice');
  });

  it('keeps late registrations, stack creations and deletions out of the next reader’s directory and errors', async () => {
    const store = await freshStore();
    const { project } = await import('../../webapp/src/netron/client.js');
    const registration = deferred<Awaited<ReturnType<typeof project.addProject>>>(), creation = deferred<never>();
    const deletion = deferred<Awaited<ReturnType<typeof project.deleteStack>>>();
    vi.mocked(project.addProject).mockReturnValueOnce(registration.promise);
    vi.mocked(project.createStack).mockReturnValueOnce(creation.promise);
    vi.mocked(project.deleteStack).mockReturnValueOnce(deletion.promise);
    const actions = [
      store.getState().addProject('alpha', '/previous/registration'),
      store.getState().createStack('alpha', { name: 'stage', type: 'local', apps: [] }),
      store.getState().deleteStack('alpha', 'old'),
    ];
    store.getState().setInventoryReaders('next-reader', 'next-reader');
    const settled = Promise.allSettled(actions);
    registration.resolve({ name: 'earlier', displayName: 'Earlier', path: '/private/earlier', registeredAt: '', totalStacks: 1, runningStacks: 0, enabledStacks: [] });
    deletion.resolve({ success: true });
    creation.reject(new Error('earlier account details'));
    for (const result of await settled) expect(result).toMatchObject({ status: 'rejected', reason: { message: 'Console access changed before the operation completed.' } });
    expect(project.listProjects).not.toHaveBeenCalled(); expect(project.listStacks).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({ error: null, loading: false, stackNotices: {}, projects: [], stacksByProject: {} });
  });

  it('restores only the signed-in account’s routes, including after a reload', async () => {
    localStorage.setItem('omnitron_workspace_routes', JSON.stringify({ shared: '/projects/shared/logs?stack=unclaimed' }));
    const store = await freshStore();
    expect(store.getState().workspaceRoutes).toEqual({});
    store.getState().saveCurrentRoute('/projects/shared/logs?stack=first', 'reader');
    store.getState().setInventoryReaders(null, null);
    store.getState().saveCurrentRoute('/projects/shared/logs?stack=signed-out', 'reader');
    expect(store.getState().workspaceRoutes).toEqual({});
    store.getState().setInventoryReaders(null, null, 'next-reader');
    expect(store.getState().workspaceRoutes).toEqual({});
    store.getState().saveCurrentRoute('/projects/shared/logs?stack=late', 'reader');
    expect(store.getState().workspaceRoutes).toEqual({});
    store.getState().saveCurrentRoute('/projects/shared/events?stack=second', 'next-reader');
    const reloaded = await freshStore();
    expect(reloaded.getState().workspaceRoutes).toEqual({ shared: '/projects/shared/logs?stack=first' });
    reloaded.getState().setInventoryReaders(null, null, 'next-reader');
    expect(reloaded.getState().workspaceRoutes).toEqual({ shared: '/projects/shared/events?stack=second' });
    expect(localStorage.getItem('omnitron_workspace_routes')).toBeNull();
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
    store.getState().saveCurrentRoute('/projects/beta/logs?stack=test', 'reader');
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
