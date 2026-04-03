'use client';

/**
 * useSetState Hook
 *
 * State hook that works like React.Component's setState,
 * allowing partial state updates.
 *
 * @module @omnitron-dev/prism/core/hooks/use-set-state
 */

import { useCallback, useState } from 'react';

/**
 * State updater function type.
 * Accepts partial state or a function that returns partial state.
 */
export type SetState<T extends Record<string, unknown>> = (patch: Partial<T> | ((prevState: T) => Partial<T>)) => void;

/**
 * Return type for useSetState.
 */
export interface UseSetStateReturn<T extends Record<string, unknown>> {
  /** Current state */
  state: T;
  /** Update state with partial values */
  setState: SetState<T>;
  /** Reset state to initial value */
  resetState: () => void;
}

/**
 * useSetState - State hook with partial update support.
 * Works like React class component's setState method.
 *
 * @example
 * ```tsx
 * interface FormState {
 *   name: string;
 *   email: string;
 *   phone: string;
 * }
 *
 * function Form() {
 *   const { state, setState, resetState } = useSetState<FormState>({
 *     name: '',
 *     email: '',
 *     phone: '',
 *   });
 *
 *   return (
 *     <>
 *       <TextField
 *         value={state.name}
 *         onChange={(e) => setState({ name: e.target.value })}
 *       />
 *       <TextField
 *         value={state.email}
 *         onChange={(e) => setState({ email: e.target.value })}
 *       />
 *       <Button onClick={resetState}>Reset</Button>
 *     </>
 *   );
 * }
 * ```
 *
 * @param initialState - Initial state object
 * @returns State, setState, and resetState
 */
export function useSetState<T extends Record<string, unknown>>(initialState: T | (() => T)): UseSetStateReturn<T> {
  const [state, setInternalState] = useState<T>(initialState);

  const setState = useCallback<SetState<T>>((patch) => {
    setInternalState((prevState) => {
      const newPartial = typeof patch === 'function' ? patch(prevState) : patch;
      return { ...prevState, ...newPartial };
    });
  }, []);

  const resetState = useCallback(() => {
    setInternalState(typeof initialState === 'function' ? initialState() : initialState);
  }, [initialState]);

  return {
    state,
    setState,
    resetState,
  };
}
