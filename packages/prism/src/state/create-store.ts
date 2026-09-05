/**
 * Prism Store Factory
 *
 * Creates Zustand stores with sensible defaults:
 * - Immer middleware for immutable updates
 * - DevTools integration
 * - Optional persistence
 *
 * @module @omnitron-dev/prism/state
 */

import { create, type StateCreator, type StoreApi, type UseBoundStore } from 'zustand';
import { devtools, persist, type PersistOptions, type DevtoolsOptions } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

/**
 * Options for creating a Prism store.
 */
export interface CreateStoreOptions<T> {
  /** Store name for DevTools and persistence */
  name: string;
  /** Enable persistence to localStorage */
  persist?: boolean | Partial<PersistOptions<T>>;
  /** Enable Redux DevTools (default: true in development) */
  devtools?: boolean;
}

/**
 * Middleware type helpers for proper typing.
 */
type ImmerMiddleware = ['zustand/immer', never];
type DevtoolsMiddleware = ['zustand/devtools', never];
type PersistMiddleware<T> = ['zustand/persist', T];

/**
 * Creates a Zustand store with Prism defaults.
 *
 * @example
 * ```typescript
 * interface CounterState {
 *   count: number;
 *   increment: () => void;
 *   decrement: () => void;
 * }
 *
 * export const useCounterStore = createPrismStore<CounterState>(
 *   (set) => ({
 *     count: 0,
 *     increment: () => set((state) => { state.count += 1; }),
 *     decrement: () => set((state) => { state.count -= 1; }),
 *   }),
 *   { name: 'counter', persist: true }
 * );
 * ```
 */
/**
 * A store that persists — the return type of `createPersistedStore`.
 *
 * Narrower than `createPrismStore`'s union: the `persist` API is guaranteed,
 * because this factory always installs the middleware.
 */
export type PersistedStore<T extends object> = UseBoundStore<StoreApi<T>> & {
  persist: {
    hasHydrated: () => boolean;
    rehydrate: () => Promise<void> | void;
    clearStorage: () => void;
    setOptions: (options: Partial<PersistOptions<T>>) => void;
    onHydrate: (fn: (state: T) => void) => () => void;
    onFinishHydration: (fn: (state: T) => void) => () => void;
    getOptions: () => Partial<PersistOptions<T>>;
  };
};

export function createPrismStore<T extends object>(
  initializer: StateCreator<T, [ImmerMiddleware], []>,
  options: CreateStoreOptions<T>
) {
  const { name, persist: persistOption, devtools: devtoolsOption = true } = options;
  const enableDevtools = devtoolsOption && typeof window !== 'undefined';

  // Prepare persist config
  const persistConfig: PersistOptions<T> | null = persistOption
    ? {
        name: `prism-${name}`,
        ...(typeof persistOption === 'object' ? persistOption : {}),
      }
    : null;

  // Prepare devtools config
  const devtoolsConfig: DevtoolsOptions = { name: `Prism:${name}` };

  // Create store based on which middleware are enabled
  // Using explicit middleware chains for proper type inference
  if (persistConfig && enableDevtools) {
    return create<T>()(devtools(persist(immer(initializer), persistConfig), devtoolsConfig));
  }

  if (persistConfig) {
    return create<T>()(persist(immer(initializer), persistConfig));
  }

  if (enableDevtools) {
    return create<T>()(devtools(immer(initializer), devtoolsConfig));
  }

  // No middleware except immer
  return create<T>()(immer(initializer));
}

/**
 * Creates a simple store without persistence (for UI-only state).
 */
export function createUIStore<T extends object>(initializer: StateCreator<T, [ImmerMiddleware], []>, name: string) {
  return createPrismStore(initializer, { name, persist: false });
}

/**
 * Merge a persisted state written under an older version into the current one.
 *
 * zustand's default when a version differs and no `migrate` is supplied is to
 * discard the stored state entirely and fall back to defaults — it logs
 * "State loaded from storage couldn't be migrated since no migrate function
 * was provided" to the console and moves on. In a browser that message is
 * seen by nobody, and what the user sees is their theme, layout, density and
 * language silently back at factory settings after an update that had nothing
 * to do with any of them.
 *
 * Discarding is the safe default for a library that cannot know what changed.
 * It is the wrong default here, because these stores hold preferences: the
 * cost of keeping a value that no longer means anything is one wrong setting,
 * and the cost of dropping everything is every setting.
 *
 * So: keep each stored key whose name still exists in the current defaults
 * AND whose type still matches. A field that was removed is dropped, a field
 * that changed shape is replaced by the new default, everything else
 * survives. A store needing more than that passes its own `migrate` — this
 * only fills in where none was given.
 */
function mergeCompatibleFields<T extends object>(persisted: unknown, current: T): T {
  if (!persisted || typeof persisted !== 'object') return current;

  const stored = persisted as Record<string, unknown>;
  const merged = { ...current } as Record<string, unknown>;

  for (const [key, value] of Object.entries(stored)) {
    if (!(key in merged)) continue;                       // field is gone
    const currentValue = merged[key];
    if (typeof currentValue === 'function') continue;     // actions are not state
    if (currentValue === undefined || currentValue === null) {
      merged[key] = value;
      continue;
    }
    if (value === null || value === undefined) continue;  // keep the default
    // Same primitive type, or both plain objects / both arrays.
    const sameShape =
      typeof value === typeof currentValue &&
      Array.isArray(value) === Array.isArray(currentValue);
    if (sameShape) merged[key] = value;
  }

  return merged as T;
}

/**
 * Creates a persisted store (for settings, preferences).
 *
 * Includes a storage wrapper that catches errors from localStorage
 * (e.g., private browsing, quota exceeded) and falls back gracefully, and a
 * default `migrate` that preserves settings across a version bump — see
 * `mergeCompatibleFields`.
 */
export function createPersistedStore<T extends object>(
  initializer: StateCreator<T, [ImmerMiddleware], []>,
  name: string,
  persistOptions?: Partial<PersistOptions<T>>
): PersistedStore<T> {
  // `createPrismStore` decides its middleware chain at runtime (devtools are
  // enabled only in a browser), so its return type is a union in which one
  // branch carries no `persist` API. This function always persists — the
  // whole of its contract — and callers need `persist.hasHydrated()` and
  // `persist.rehydrate()`. Stating the narrower type here is what makes
  // those reachable; without it a caller has to cast, which is how a store
  // that does not persist would look identical to one that does.
  return createPrismStore(initializer, {
    name,
    persist: {
      version: 1,
      // Two hooks, and both are needed. `migrate` runs only on a version
      // mismatch and decides whether the stored state survives at all —
      // returning it unchanged is what stops zustand discarding it. `merge`
      // runs every load and decides how it combines with the current
      // defaults; zustand's own is a shallow spread, which would let a
      // stored field of the wrong shape overwrite a good default.
      migrate: (persisted: unknown) => persisted as T,
      merge: (persisted: unknown, current: T) => mergeCompatibleFields(persisted, current),
      storage: {
        getItem: (key) => {
          try {
            const value = localStorage.getItem(key);
            return value ? JSON.parse(value) : null;
          } catch {
            return null;
          }
        },
        setItem: (key, value) => {
          try {
            localStorage.setItem(key, JSON.stringify(value));
          } catch {
            // Silently fail (private browsing, quota exceeded)
          }
        },
        removeItem: (key) => {
          try {
            localStorage.removeItem(key);
          } catch {
            // Silently fail
          }
        },
      },
      ...persistOptions,
    },
  }) as PersistedStore<T>;
}

/**
 * Selector type for store state.
 */
export type StoreSelector<T, U> = (state: T) => U;

/**
 * Helper to create typed selectors for a store.
 *
 * @example
 * ```typescript
 * const selectors = createSelectors(useUserStore);
 * const userName = selectors.use.name();
 * ```
 */
export function createSelectors<T extends object>(store: UseBoundStore<StoreApi<T>>) {
  const storeIn = store as UseBoundStore<StoreApi<T>> & {
    use: { [K in keyof T]: () => T[K] };
  };

  // Use Proxy so selectors work for dynamically added state keys,
  // not just keys present at creation time
  storeIn.use = new Proxy({} as { [K in keyof T]: () => T[K] }, {
    get: (_target, prop: string | symbol) => {
      if (typeof prop !== 'string') return undefined;
      return () => store((state: T) => state[prop as keyof T]);
    },
  });

  return storeIn;
}
