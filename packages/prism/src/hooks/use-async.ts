'use client';

/**
 * useAsync Hook
 *
 * Manages async operations with loading, error, and data states.
 *
 * @module @omnitron-dev/prism/hooks
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';

/**
 * Async state.
 */
export interface AsyncState<T> {
  /** Data result */
  data: T | null;
  /** Loading state */
  loading: boolean;
  /** Error state */
  error: Error | null;
}

/**
 * Return type for useAsync hook.
 */
export interface UseAsyncReturn<T, Args extends unknown[]> extends AsyncState<T> {
  /** Execute the async function */
  execute: (...args: Args) => Promise<T>;
  /** Reset state */
  reset: () => void;
  /** Set data manually */
  setData: (data: T | null) => void;
  /** Set error manually */
  setError: (error: Error | null) => void;
}

/**
 * Options for useAsync hook.
 */
export interface UseAsyncOptions<T> {
  /** Initial data */
  initialData?: T | null;
  /** Auto-execute on mount */
  immediate?: boolean;
  /** On success callback */
  onSuccess?: (data: T) => void;
  /** On error callback */
  onError?: (error: Error) => void;
}

/**
 * useAsync - Hook for managing async operations.
 *
 * @example
 * ```tsx
 * // Basic usage
 * const { data, loading, error, execute } = useAsync(fetchUser);
 *
 * // Auto-execute on mount
 * const { data, loading } = useAsync(fetchUsers, { immediate: true });
 *
 * // With callbacks
 * const { execute } = useAsync(createUser, {
 *   onSuccess: (user) => toast.success(`Created ${user.name}`),
 *   onError: (err) => toast.error(err.message),
 * });
 *
 * // In a component
 * const handleSubmit = async () => {
 *   const result = await execute(formData);
 *   if (result) navigate('/success');
 * };
 * ```
 */
export function useAsync<T, Args extends unknown[] = []>(
  asyncFn: (...args: Args) => Promise<T>,
  options: UseAsyncOptions<T> = {}
): UseAsyncReturn<T, Args> {
  const { initialData = null, immediate = false, onSuccess, onError } = options;

  const [state, setState] = useState<AsyncState<T>>({
    data: initialData,
    loading: immediate,
    error: null,
  });

  // Track mounted state to prevent state updates after unmount
  const isMounted = useRef(true);

  // Track if we're currently executing
  const executingRef = useRef(false);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const execute = useCallback(
    async (...args: Args): Promise<T> => {
      // Prevent concurrent executions
      if (executingRef.current) {
        return Promise.reject(new Error('Operation already in progress'));
      }

      executingRef.current = true;

      if (isMounted.current) {
        setState((prev) => ({ ...prev, loading: true, error: null }));
      }

      try {
        const result = await asyncFn(...args);

        if (isMounted.current) {
          setState({ data: result, loading: false, error: null });
          onSuccess?.(result);
        }

        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));

        if (isMounted.current) {
          setState((prev) => ({ ...prev, loading: false, error }));
          onError?.(error);
        }

        throw error;
      } finally {
        executingRef.current = false;
      }
    },
    [asyncFn, onSuccess, onError]
  );

  const reset = useCallback(() => {
    setState({ data: initialData, loading: false, error: null });
  }, [initialData]);

  const setData = useCallback((data: T | null) => {
    setState((prev) => ({ ...prev, data }));
  }, []);

  const setError = useCallback((error: Error | null) => {
    setState((prev) => ({ ...prev, error }));
  }, []);

  // Auto-execute on mount if immediate is true
  useEffect(() => {
    if (immediate) {
      execute(...([] as unknown as Args)).catch(() => {
        // Error is already handled in execute
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Memoize return object to prevent unnecessary re-renders
  return useMemo(
    () => ({
      ...state,
      execute,
      reset,
      setData,
      setError,
    }),
    [state, execute, reset, setData, setError]
  );
}

/**
 * Return type for useAsyncFn hook (simpler version).
 */
export interface UseAsyncFnReturn<T, Args extends unknown[]> {
  /** Execute the async function */
  execute: (...args: Args) => Promise<T | undefined>;
  /** Loading state */
  loading: boolean;
  /** Error state */
  error: Error | null;
}

/**
 * useAsyncFn - Simpler hook for async functions without data tracking.
 *
 * @example
 * ```tsx
 * const { execute, loading, error } = useAsyncFn(deleteUser);
 *
 * const handleDelete = async (id: string) => {
 *   await execute(id);
 *   refetch(); // Trigger parent refresh
 * };
 * ```
 */
export function useAsyncFn<T, Args extends unknown[] = []>(
  asyncFn: (...args: Args) => Promise<T>
): UseAsyncFnReturn<T, Args> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const execute = useCallback(
    async (...args: Args): Promise<T | undefined> => {
      setLoading(true);
      setError(null);

      try {
        const result = await asyncFn(...args);
        if (isMounted.current) {
          setLoading(false);
        }
        return result;
      } catch (err) {
        const caughtError = err instanceof Error ? err : new Error(String(err));
        if (isMounted.current) {
          setLoading(false);
          setError(caughtError);
        }
        return undefined;
      }
    },
    [asyncFn]
  );

  return { execute, loading, error };
}
