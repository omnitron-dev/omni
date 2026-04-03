/**
 * Store-based State Management (Zustand-inspired)
 */

import { useState, useEffect, useRef, useMemo } from 'react';

/**
 * Store state setter
 */
export type SetState<T> = {
  (partial: T | Partial<T> | ((state: T) => T | Partial<T>), replace?: boolean): void;
};

/**
 * Store state getter
 */
export type GetState<T> = () => T;

/**
 * Store API
 */
export interface StoreApi<T> {
  getState: GetState<T>;
  setState: SetState<T>;
  subscribe: (listener: (state: T, prevState: T) => void) => () => void;
  destroy: () => void;
}

/**
 * State creator function
 */
export type StateCreator<T> = (set: SetState<T>, get: GetState<T>, api: StoreApi<T>) => T;

/**
 * Create a store
 */
export function createStore<T>(createState: StateCreator<T>): StoreApi<T> & { (): T } {
  let state: T;
  const listeners = new Set<(state: T, prevState: T) => void>();

  const setState: SetState<T> = (partial, replace) => {
    const nextState = typeof partial === 'function' ? (partial as (state: T) => T | Partial<T>)(state) : partial;

    if (!Object.is(nextState, state)) {
      const prevState = state;

      state = replace
        ? (nextState as T)
        : typeof nextState === 'object' && nextState !== null
          ? { ...state, ...nextState }
          : (nextState as T);

      listeners.forEach((listener) => listener(state, prevState));
    }
  };

  const getState: GetState<T> = () => state;

  const subscribe = (listener: (state: T, prevState: T) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const destroy = () => {
    listeners.clear();
  };

  const api: StoreApi<T> = { getState, setState, subscribe, destroy };

  // Initialize state
  state = createState(setState, getState, api);

  // Create hook
  const useStoreHook = () => {
    const [, forceUpdate] = useState({});

    useEffect(() => {
      const unsubscribe = subscribe(() => forceUpdate({}));
      return () => {
        unsubscribe();
      };
    }, []);

    return state;
  };

  // Combine API with hook
  return Object.assign(useStoreHook, api);
}

/**
 * useStore hook with selector
 */
export function useStore<T, R>(
  store: StoreApi<T>,
  selector: (state: T) => R = (state) => state as unknown as R,
  equalityFn: (a: R, b: R) => boolean = Object.is
): R {
  const [, forceUpdate] = useState({});
  const selectorRef = useRef(selector);
  const equalityFnRef = useRef(equalityFn);
  const stateRef = useRef<R>(undefined as R);

  // Update refs
  selectorRef.current = selector;
  equalityFnRef.current = equalityFn;

  // Get current selected state
  const currentState = useMemo(() => selectorRef.current(store.getState()), [store]);

  // Initialize ref
  if (stateRef.current === undefined) {
    stateRef.current = currentState;
  }

  // Subscribe to changes
  useEffect(() => {
    const unsubscribe = store.subscribe((state) => {
      const nextState = selectorRef.current(state);

      if (!equalityFnRef.current(stateRef.current!, nextState)) {
        stateRef.current = nextState;
        forceUpdate({});
      }
    });

    return unsubscribe;
  }, [store]);

  return stateRef.current!;
}

/**
 * Middleware type
 */
export type Middleware<T> = (config: StateCreator<T>) => StateCreator<T>;

/**
 * Persist middleware - saves state to storage
 */
export function persist<T extends object>(
  config: StateCreator<T>,
  options: {
    name: string;
    storage?: Storage;
    partialize?: (state: T) => Partial<T>;
    merge?: (persisted: Partial<T>, current: T) => T;
  }
): StateCreator<T> {
  const { name, storage = localStorage, partialize, merge } = options;

  return (set, get, api) => {
    // Load persisted state
    const loadState = (): Partial<T> | null => {
      try {
        const item = storage.getItem(name);
        return item ? JSON.parse(item) : null;
      } catch {
        return null;
      }
    };

    // Save state
    const saveState = (state: T) => {
      try {
        const toSave = partialize ? partialize(state) : state;
        storage.setItem(name, JSON.stringify(toSave));
      } catch {
        // Ignore storage errors
      }
    };

    // Initialize
    const initialState = config(
      (partial, replace) => {
        set(partial, replace);
        saveState(get());
      },
      get,
      api
    );

    // Merge with persisted
    const persisted = loadState();
    if (persisted) {
      const mergedState = merge ? merge(persisted, initialState) : { ...initialState, ...persisted };

      // Return merged state
      return mergedState;
    }

    return initialState;
  };
}

/**
 * DevTools middleware
 */
export function devtools<T extends object>(
  config: StateCreator<T>,
  options?: { name?: string; enabled?: boolean }
): StateCreator<T> {
  const { name = 'NetronReact Store', enabled = process.env.NODE_ENV === 'development' } = options ?? {};

  if (!enabled || typeof window === 'undefined') {
    return config;
  }

  return (set, get, api) => {
    const devTools = (window as any).__REDUX_DEVTOOLS_EXTENSION__?.connect?.({ name });

    if (!devTools) {
      return config(set, get, api);
    }

    const wrappedSet: SetState<T> = (partial, replace) => {
      set(partial, replace);
      const nextState = get();

      devTools.send({ type: 'setState', payload: partial }, nextState);
    };

    devTools.init(get());

    devTools.subscribe((message: any) => {
      if (message.type === 'DISPATCH' && message.payload?.type === 'JUMP_TO_ACTION') {
        set(JSON.parse(message.state), true);
      }
    });

    return config(wrappedSet, get, api);
  };
}

/**
 * Immer middleware - enables mutable updates
 */
export function immer<T extends object>(config: StateCreator<T>): StateCreator<T> {
  return (set, get, api) => {
    const wrappedSet: SetState<T> = (partial, replace) => {
      if (typeof partial === 'function') {
        // Apply function to current state
        const nextState = (partial as (state: T) => T | Partial<T>)(get());
        set(nextState as Partial<T>, replace);
      } else {
        set(partial, replace);
      }
    };

    return config(wrappedSet, get, api);
  };
}

/**
 * Combine multiple slices into one store
 */
export function combineSlices<T extends object>(...slices: Array<StateCreator<Partial<T>>>): StateCreator<T> {
  return (set, get, api) => {
    const state = {} as T;

    for (const slice of slices) {
      const sliceState = slice(
        (partial) => set(partial as Partial<T>),
        () => get() as Partial<T>,
        api as unknown as StoreApi<Partial<T>>
      );
      Object.assign(state, sliceState);
    }

    return state;
  };
}
