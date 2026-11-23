/**
 * What happens to a user's settings when the app around them changes.
 *
 * These stores hold preferences — theme, density, layout, language — and
 * zustand's default on a version bump is to discard the stored state
 * entirely, logging "State loaded from storage couldn't be migrated since no
 * migrate function was provided" to a console nobody is reading. What the
 * user sees is every preference back at factory settings after an update
 * that had nothing to do with any of them.
 *
 * Discarding is the right default for a library that cannot know what
 * changed. It is the wrong one here: the cost of keeping a value that no
 * longer means anything is one wrong setting; the cost of dropping
 * everything is every setting.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createPersistedStore } from './create-store.js';

/** In-memory localStorage, since these tests run outside a browser. */
const backing = new Map<string, string>();

beforeEach(() => {
  backing.clear();
  storageKey = `test-settings-${++keySeq}`;
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => backing.set(k, v),
    removeItem: (k: string) => backing.delete(k),
  });
});

type Settings = Record<string, unknown> & { set: (patch: Record<string, unknown>) => void };

it('restores a typed preference projection and keeps transient fields and actions from the initializer', () => {
  type Profile = { mode: string; draft: string; choose: (mode: string) => void };
  const openStore = () => createPersistedStore<Profile, Pick<Profile, 'mode'>>(
    set => ({ mode: 'light', draft: '', choose: mode => set({ mode }) }),
    storageKey,
    { partialize: state => ({ mode: state.mode }) },
  );
  const first = openStore();
  first.setState({ draft: 'editing' });
  first.getState().choose('dark');
  expect(JSON.parse(backing.get(`prism-${storageKey}`)!).state).toEqual({ mode: 'dark' });
  const restored = openStore();
  expect(restored.getState()).toMatchObject({ mode: 'dark', draft: '' });
  restored.getState().choose('light');
  expect(restored.getState().mode).toBe('light');
});

/**
 * One storage key per test.
 *
 * Sharing a key across tests made this file flaky: persistence is async, so
 * a store created in an earlier test could still write after `beforeEach`
 * had cleared the map, and the next test read that write. It passed on the
 * second run — which is the least useful evidence a test can offer, and
 * exactly what "just rerun it" is built on.
 */
let keySeq = 0;
let storageKey = '';

/** A store over `defaults`, at `version`, on this test's own key. */
function store(defaults: Record<string, unknown>, version?: number) {
  return createPersistedStore<Settings>(
    (set) => ({ ...defaults, set: (patch: Record<string, unknown>) => set(patch as never) }) as never,
    storageKey,
    version === undefined ? undefined : { version }
  );
}

/** What `store()` writes under, for tests that seed storage directly. */
const seed = (state: Record<string, unknown>, version = 1) =>
  backing.set(`prism-${storageKey}`, JSON.stringify({ state, version }));

/**
 * Wait for a condition instead of for a duration.
 *
 * zustand's rehydrate is async, so an assertion needs the store to have
 * caught up. A fixed sleep is the obvious way and the wrong one: it encodes
 * "20ms is enough on this machine" as if it were a property of the code, and
 * that assumption is invisible until the suite runs alongside 290 other
 * files and the failure names a missing value rather than a missed deadline.
 * The colleague's logger test failed exactly that way today.
 */
async function until(predicate: () => boolean, budgetMs = 2000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met within budget');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** The store has finished rehydrating when it reports so. */
const rehydrated = (s: { persist?: { hasHydrated?: () => boolean } }) =>
  until(() => s.persist?.hasHydrated?.() ?? true);

describe('application defaults and saved preferences', () => {
  it.each(['light', 'dark', 'system'])('keeps an explicit %s choice across fresh stores and provider remounts', async mode => {
    const first = store({ mode: 'light', preset: 'default-light', direction: 'ltr' });
    await first.initializeDefaults({ mode: 'dark', preset: 'minimal' });
    expect(first.getState()['mode']).toBe('dark');
    first.getState().set({ mode, preset: 'luxury', direction: 'rtl' });
    await first.initializeDefaults({ mode: 'dark', preset: 'minimal', direction: 'ltr' });
    const next = store({ mode: 'light', preset: 'default-light', direction: 'ltr' });
    await next.initializeDefaults({ mode: 'dark', preset: 'minimal', direction: 'ltr' });
    expect(next.getState()).toMatchObject({ mode, preset: 'luxury', direction: 'rtl' });
  });

  it('uses defaults for missing fields, preserving a partial saved record', async () => {
    seed({ mode: 'system' });
    const preferences = store({ mode: 'light', preset: 'default-light', fontSize: 16 });
    await preferences.initializeDefaults({ mode: 'dark', preset: 'minimal', fontSize: 14 });
    expect(preferences.getState()).toMatchObject({ mode: 'system', preset: 'minimal', fontSize: 14 });
  });

  it('does not reset an in-memory selection when storage is unavailable', async () => {
    vi.stubGlobal('localStorage', { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } });
    const preferences = store({ mode: 'light' });
    await preferences.initializeDefaults({ mode: 'dark' });
    preferences.getState().set({ mode: 'system' });
    await preferences.initializeDefaults({ mode: 'dark' });
    expect(preferences.getState()['mode']).toBe('system');
  });

  it('preserves edits made while custom asynchronous storage is being read', async () => {
    const preferences = store({ mode: 'light', preset: 'default-light' });
    let resolve!: (value: null) => void;
    preferences.persist.setOptions({ storage: {
      getItem: () => new Promise<null>(done => { resolve = done; }), setItem() {}, removeItem() {},
    } });
    const initialized = preferences.initializeDefaults({ mode: 'dark', preset: 'minimal' });
    preferences.getState().set({ mode: 'system' });
    resolve(null);
    await initialized;
    expect(preferences.getState()).toMatchObject({ mode: 'system', preset: 'minimal' });
  });
});

describe('persisted settings across a version bump', () => {
  it('keeps what the user chose', async () => {
    const before = store({ mode: 'light', density: 'standard' });
    before.getState().set({ mode: 'dark', density: 'compact' });
    await rehydrated(before);

    const after = store({ mode: 'light', density: 'standard' }, 2);
    await rehydrated(after);

    expect(after.getState()['mode']).toBe('dark');
    expect(after.getState()['density']).toBe('compact');
  });

  it('adopts a newly added field at its default', async () => {
    const before = store({ mode: 'light' });
    before.getState().set({ mode: 'dark' });
    await rehydrated(before);

    const after = store({ mode: 'light', fontSize: 14 }, 2);
    await rehydrated(after);

    expect(after.getState()['mode']).toBe('dark');
    expect(after.getState()['fontSize']).toBe(14);
  });

  it('drops a field that no longer exists', async () => {
    seed({ mode: 'dark', obsolete: 'x' });

    const after = store({ mode: 'light' }, 2);
    await rehydrated(after);

    expect(after.getState()['mode']).toBe('dark');
    expect(after.getState()['obsolete']).toBeUndefined();
  });

  it('rejects a stored value whose shape changed', async () => {
    // The case that makes a blanket merge unsafe: keeping `density: 42`
    // where the app now expects a string puts a value into the store that
    // no consumer can read, which is worse than the default.
    seed({ mode: 'dark', density: 42 });

    const after = store({ mode: 'light', density: 'standard' }, 2);
    await rehydrated(after);

    expect(after.getState()['density']).toBe('standard');
    expect(after.getState()['mode']).toBe('dark');
  });

  it('distinguishes an array from an object of the same size', async () => {
    seed({ pinned: { 0: 'a' } });

    const after = store({ pinned: ['default'] }, 2);
    await rehydrated(after);

    expect(after.getState()['pinned']).toEqual(['default']);
  });

  it('never replaces an action with stored data', async () => {
    // Actions live in the same object as the state. A stored key colliding
    // with one would replace a function with a string, and the failure would
    // surface as "set is not a function" far from here.
    seed({ mode: 'dark', set: 'not a function' });

    const after = store({ mode: 'light' }, 2);
    await rehydrated(after);

    expect(typeof after.getState().set).toBe('function');
  });
});

describe('persisted settings under a hostile storage', () => {
  it('falls back to defaults on unparseable data', async () => {
    backing.set(`prism-${storageKey}`, '{{{ not json');

    const s = store({ mode: 'light' });
    await rehydrated(s);

    expect(s.getState()['mode']).toBe('light');
  });

  it('still works when localStorage throws', async () => {
    // Private browsing and a full quota both throw on write; Safari throws
    // on read too. A settings store must not take the app down with it.
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => { throw new Error('SecurityError'); },
    });

    const s = store({ mode: 'light' });
    expect(() => s.getState().set({ mode: 'dark' })).not.toThrow();
    expect(s.getState()['mode']).toBe('dark');
  });
});
