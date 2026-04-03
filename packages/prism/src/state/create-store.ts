/**
 * Prism Store Factory
 *
 * Creates Zustand stores with sensible defaults:
 * - Immer middleware for immutable updates
 * - DevTools integration
 * - Optional persistence
 *
 * @module @omnitron/prism/state
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
 * Creates a persisted store (for settings, preferences).
 *
 * Includes a storage wrapper that catches errors from localStorage
 * (e.g., private browsing, quota exceeded) and falls back gracefully.
 */
export function createPersistedStore<T extends object>(
  initializer: StateCreator<T, [ImmerMiddleware], []>,
  name: string,
  persistOptions?: Partial<PersistOptions<T>>
) {
  return createPrismStore(initializer, {
    name,
    persist: {
      version: 1,
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
  });
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
