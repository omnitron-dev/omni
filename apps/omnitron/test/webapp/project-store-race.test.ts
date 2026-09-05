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
    // Only the auto-select is conditional. The stacks map is keyed by
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

  it('auto-selects when the listing belongs to the current project', async () => {
    const store = await freshStore();

    store.getState().selectProject('alpha');
    pending.get('alpha')!([stack('only-in-alpha')]);
    await Promise.resolve();
    await Promise.resolve();

    expect(store.getState().activeStack).toBe('only-in-alpha');
    expect(localStorage.getItem('omnitron_active_stack')).toBe('only-in-alpha');
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
