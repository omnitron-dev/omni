/**
 * Atomic State Management (Jotai-inspired)
 */

import { useState, useEffect, useCallback } from 'react';

/**
 * Atom - Basic unit of state
 */
export interface Atom<T> {
  /** Unique identifier */
  key: string;
  /** Initial value or getter */
  init: T | (() => T);
  /** Internal subscribers */
  _subscribers: Set<() => void>;
  /** Current value (internal) */
  _value?: T;
  /** Is initialized */
  _initialized: boolean;
}

/**
 * Writable atom with setter
 */
export interface WritableAtom<T> extends Atom<T> {
  write: (value: T | ((prev: T) => T)) => void;
}

/**
 * Read-only derived atom
 */
export interface DerivedAtom<T> extends Atom<T> {
  read: (get: <V>(atom: Atom<V>) => V) => T;
}

/**
 * Async atom
 */
export interface AsyncAtom<T> extends Atom<T> {
  read: (get: <V>(atom: Atom<V>) => V) => Promise<T>;
}

// Global atom store
const atomStore = new Map<string, Atom<any>>();
let atomCounter = 0;

/**
 * Create a basic atom
 */
export function atom<T>(initialValue: T): WritableAtom<T> {
  const key = `atom-${++atomCounter}`;

  const atomInstance: WritableAtom<T> = {
    key,
    init: initialValue,
    _subscribers: new Set(),
    _value: initialValue,
    _initialized: true,
    write: (value) => {
      const newValue = typeof value === 'function' ? (value as (prev: T) => T)(atomInstance._value as T) : value;

      atomInstance._value = newValue;
      atomInstance._subscribers.forEach((sub) => sub());
    },
  };

  atomStore.set(key, atomInstance);
  return atomInstance;
}

/**
 * Create a derived atom (read-only)
 */
export function derived<T>(read: (get: <V>(atom: Atom<V>) => V) => T): DerivedAtom<T> {
  const key = `derived-${++atomCounter}`;

  const derivedInstance: DerivedAtom<T> = {
    key,
    init: undefined as T,
    _subscribers: new Set(),
    _initialized: false,
    read,
  };

  atomStore.set(key, derivedInstance);
  return derivedInstance;
}

/**
 * Create an async atom
 */
export function asyncAtom<T>(read: (get: <V>(atom: Atom<V>) => V) => Promise<T>): AsyncAtom<T> {
  const key = `async-${++atomCounter}`;

  const asyncInstance: AsyncAtom<T> = {
    key,
    init: undefined as T,
    _subscribers: new Set(),
    _initialized: false,
    read,
  };

  atomStore.set(key, asyncInstance);
  return asyncInstance;
}

/**
 * Get atom value from store
 */
function getAtomValue<T>(atomInstance: Atom<T>): T {
  if ('read' in atomInstance) {
    // Derived or async atom
    const get = <V>(a: Atom<V>): V => getAtomValue(a);

    if (atomInstance._initialized && atomInstance._value !== undefined) {
      return atomInstance._value;
    }

    const result = (atomInstance as DerivedAtom<T>).read(get);

    // Handle sync derived atoms
    if (!(result instanceof Promise)) {
      atomInstance._value = result;
      atomInstance._initialized = true;
      return result;
    }

    throw result; // For Suspense
  }

  return atomInstance._value as T;
}

/**
 * useAtom hook - Read and write atom state
 */
export function useAtom<T>(atomInstance: WritableAtom<T>): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => getAtomValue(atomInstance));

  // Subscribe to changes
  useEffect(() => {
    const subscriber = () => {
      setValue(getAtomValue(atomInstance));
    };

    atomInstance._subscribers.add(subscriber);
    return () => {
      atomInstance._subscribers.delete(subscriber);
    };
  }, [atomInstance]);

  // Setter
  const setter = useCallback(
    (newValue: T | ((prev: T) => T)) => {
      atomInstance.write(newValue);
    },
    [atomInstance]
  );

  return [value, setter];
}

/**
 * useAtomValue hook - Read-only atom access
 */
export function useAtomValue<T>(atomInstance: Atom<T>): T {
  const [value, setValue] = useState<T>(() => {
    try {
      return getAtomValue(atomInstance);
    } catch (promise) {
      if (promise instanceof Promise) {
        throw promise; // Re-throw for Suspense
      }
      throw promise;
    }
  });

  // Subscribe to changes
  useEffect(() => {
    const subscriber = () => {
      try {
        setValue(getAtomValue(atomInstance));
      } catch {
        // Ignore async atoms here
      }
    };

    atomInstance._subscribers.add(subscriber);

    // Also subscribe to dependency atoms for derived atoms
    if ('read' in atomInstance) {
      // Track dependencies (simplified)
      subscriber();
    }

    return () => {
      atomInstance._subscribers.delete(subscriber);
    };
  }, [atomInstance]);

  return value;
}

/**
 * useSetAtom hook - Write-only atom access
 */
export function useSetAtom<T>(atomInstance: WritableAtom<T>): (value: T | ((prev: T) => T)) => void {
  return useCallback(
    (newValue: T | ((prev: T) => T)) => {
      atomInstance.write(newValue);
    },
    [atomInstance]
  );
}

/**
 * Select from an atom with custom equality
 */
export function selectAtom<T, R>(
  atomInstance: Atom<T>,
  selector: (value: T) => R,
  equalityFn: (a: R, b: R) => boolean = Object.is
): Atom<R> {
  const key = `select-${atomInstance.key}-${++atomCounter}`;

  let lastValue: R | undefined;

  const selectInstance: DerivedAtom<R> = {
    key,
    init: undefined as R,
    _subscribers: new Set(),
    _initialized: false,
    read: (get) => {
      const value = get(atomInstance);
      const selected = selector(value);

      if (lastValue !== undefined && equalityFn(lastValue, selected)) {
        return lastValue;
      }

      lastValue = selected;
      return selected;
    },
  };

  atomStore.set(key, selectInstance);
  return selectInstance;
}

/**
 * Reset atom to initial value
 */
export function resetAtom<T>(atomInstance: WritableAtom<T>): void {
  const initialValue = typeof atomInstance.init === 'function' ? (atomInstance.init as () => T)() : atomInstance.init;

  atomInstance.write(initialValue);
}

/**
 * Get current atom value (outside React)
 */
export function getAtom<T>(atomInstance: Atom<T>): T {
  return getAtomValue(atomInstance);
}

/**
 * Set atom value (outside React)
 */
export function setAtom<T>(atomInstance: WritableAtom<T>, value: T | ((prev: T) => T)): void {
  atomInstance.write(value);
}
