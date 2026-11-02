/**
 * Switching projects while a stack listing is still in flight.
 *
 * `fetchStacks` is fired and not awaited — from `fetchProjects`, from
 * `selectProject`, from the end of every start/stop. So its response can land
 * after the operator has moved somewhere else, and what it does on arrival
 * has to account for that.
 */

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
    expect(store.getState().stacksByProject.alpha?.[0]?.name).toBe('new');
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
    const first = store.getState().fetchProjects('/stacks');
    store.getState().setInventoryReaders(null, null);
    finish([{ name: 'private-project', displayName: 'Private', path: '/projects/private', registeredAt: '',
      enabledStacks: [], runningStacks: 0, totalStacks: 0 }]);
    await first;
    expect(store.getState().projects).toEqual([]);
    expect(store.getState().activeProject).toBeNull();
    expect(store.getState().loading).toBe(false);
  });
  it('does not auto-select a stack for a project the operator has left', async () => {
    // The defect: A's single stack became the ACTIVE stack under project B,
    // and `persistWorkspace('A', stackOfA)` wrote the mismatched pair, so it
    // survived a reload. Switching quickly between two projects is ordinary
    // use, not an edge case.
    const store = await freshStore();

    store.getState().selectProject('alpha');
    store.getState().selectProject('beta');

    pending.get('alpha')!([stack('only-in-alpha')]);
    await Promise.resolve();
    await Promise.resolve();

    expect(store.getState().activeProject).toBe('beta');
    expect(store.getState().activeStack).toBeNull();
    expect(localStorage.getItem('omnitron_active_project')).toBe('beta');
    expect(localStorage.getItem('omnitron_active_stack')).toBeNull();
  });

  it('still records the listing itself, whichever project it was for', async () => {
    // Only filter validation is conditional. The stacks map is keyed by
    // project, so a late listing is still correct data about ITS project and
    // is worth keeping.
    const store = await freshStore();

    store.getState().selectProject('alpha');
    store.getState().selectProject('beta');

    pending.get('alpha')!([stack('only-in-alpha')]);
    await Promise.resolve();
    await Promise.resolve();

    expect(store.getState().stacksByProject['alpha']).toHaveLength(1);
  });

  it('preserves All stacks even when the project currently has only one stack', async () => {
    const store = await freshStore();

    store.getState().selectProject('alpha');
    pending.get('alpha')!([stack('only-in-alpha')]);
    await Promise.resolve();
    await Promise.resolve();

    expect(store.getState().activeStack).toBeNull();
    expect(localStorage.getItem('omnitron_active_stack')).toBeNull();
  });

  it('leaves the choice alone when a project has several stacks', async () => {
    const store = await freshStore();

    store.getState().selectProject('alpha');
    pending.get('alpha')!([stack('one'), stack('two')]);
    await Promise.resolve();
    await Promise.resolve();

    expect(store.getState().activeStack).toBeNull();
  });
});


describe('explicit stack filters', () => {
  it('clears a removed selection after a successful inventory and persists All stacks', async () => {
    const store = await freshStore();
    store.getState().selectProject('alpha');
    pending.get('alpha')!([stack('one'), stack('two')]);
    await Promise.resolve(); await Promise.resolve();
    store.getState().selectStack('one');
    expect(localStorage.getItem('omnitron_active_stack')).toBe('one');
    const refresh = store.getState().fetchStacks('alpha');
    pending.get('alpha')!([stack('two')]);
    await refresh;
    expect(store.getState().activeStack).toBeNull();
    expect(localStorage.getItem('omnitron_active_stack')).toBeNull();
  });

  it('does not narrow a scope to an unknown stack or another workspace', async () => {
    const store = await freshStore();
    store.getState().selectStack('one');
    expect(store.getState().activeStack).toBeNull();
    store.getState().selectProject('alpha');
    pending.get('alpha')!([stack('one')]);
    await Promise.resolve(); await Promise.resolve();
    store.getState().selectStack('missing');
    expect(store.getState().activeStack).toBeNull();
    store.getState().selectStack('one');
    expect(store.getState().activeStack).toBe('one');
    store.getState().selectProject('beta');
    store.getState().selectStack('one');
    expect(store.getState().activeStack).toBeNull();
  });

  it('retains a valid selection when another workspace inventory arrives', async () => {
    const store = await freshStore();
    store.getState().selectProject('alpha');
    store.getState().selectProject('beta');
    pending.get('beta')!([stack('chosen')]);
    await Promise.resolve(); await Promise.resolve();
    store.getState().selectStack('chosen');
    pending.get('alpha')!([stack('other')]);
    await Promise.resolve(); await Promise.resolve();
    expect(store.getState().activeStack).toBe('chosen');
    expect(localStorage.getItem('omnitron_active_project')).toBe('beta');
    expect(localStorage.getItem('omnitron_active_stack')).toBe('chosen');
  });

  it('keeps the last chosen scope when inventory cannot be refreshed', async () => {
    const store = await freshStore();
    store.getState().selectProject('alpha');
    pending.get('alpha')!([stack('chosen')]);
    await Promise.resolve(); await Promise.resolve();
    store.getState().selectStack('chosen');
    const { project } = await import('../../webapp/src/netron/client');
    vi.mocked(project.listStacks).mockRejectedValueOnce(new Error('Inventory unavailable'));
    expect(await store.getState().fetchStacks('alpha')).toBeNull();
    expect(store.getState().activeStack).toBe('chosen');
    expect(store.getState().stackReadErrors.alpha).toBe('Inventory unavailable');
  });
});
