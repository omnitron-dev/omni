'use client';

/**
 * useMutation Hook
 *
 * A hook for handling async mutations with loading, error, and success states.
 * Similar to TanStack Query's useMutation but framework-agnostic.
 *
 * @module @omnitron/prism/hooks/use-mutation
 */

import { useState, useCallback, useRef } from 'react';

/**
 * State for a mutation.
 */
export interface MutationState<TData, TError> {
  /** Mutation result data */
  data: TData | undefined;
  /** Error from mutation */
  error: TError | undefined;
  /** Whether mutation is currently executing */
  isLoading: boolean;
  /** Whether mutation has succeeded at least once */
  isSuccess: boolean;
  /** Whether mutation has failed */
  isError: boolean;
  /** Whether mutation is idle (never called or reset) */
  isIdle: boolean;
  /** Current status */
  status: 'idle' | 'loading' | 'success' | 'error';
}

/**
 * Options for useMutation hook.
 */
export interface UseMutationOptions<TData, TError, TVariables> {
  /** Called when mutation starts */
  onMutate?: (variables: TVariables) => void | Promise<void>;
  /** Called on successful mutation */
  onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>;
  /** Called on mutation error */
  onError?: (error: TError, variables: TVariables) => void | Promise<void>;
  /** Called after mutation settles (success or error) */
  onSettled?: (data: TData | undefined, error: TError | undefined, variables: TVariables) => void | Promise<void>;
  /** Retry count on failure */
  retry?: number | boolean;
  /** Delay between retries in ms */
  retryDelay?: number | ((attempt: number) => number);
}

/**
 * Return type for useMutation hook.
 */
export interface UseMutationReturn<TData, TError, TVariables> {
  /** Current mutation state */
  data: TData | undefined;
  error: TError | undefined;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  isIdle: boolean;
  status: MutationState<TData, TError>['status'];
  /** Execute the mutation */
  mutate: (
    variables: TVariables,
    options?: {
      onSuccess?: (data: TData) => void;
      onError?: (error: TError) => void;
      onSettled?: (data: TData | undefined, error: TError | undefined) => void;
    }
  ) => void;
  /** Execute the mutation and return a promise */
  mutateAsync: (variables: TVariables) => Promise<TData>;
  /** Reset mutation state */
  reset: () => void;
}

const defaultRetryDelay = (attempt: number) => Math.min(1000 * 2 ** attempt, 30000);

/**
 * Hook for handling async mutations with loading/error states.
 *
 * @param mutationFn - Async function to execute
 * @param options - Configuration options
 * @returns Mutation state and control methods
 *
 * @example
 * ```tsx
 * function CreateUserForm() {
 *   const createUser = useMutation(
 *     async (data: { name: string; email: string }) => {
 *       const response = await fetch('/api/users', {
 *         method: 'POST',
 *         body: JSON.stringify(data),
 *       });
 *       if (!response.ok) throw new Error('Failed to create user');
 *       return response.json();
 *     },
 *     {
 *       onSuccess: (user) => {
 *         console.log('User created:', user);
 *       },
 *       onError: (error) => {
 *         console.error('Failed:', error);
 *       },
 *     }
 *   );
 *
 *   const handleSubmit = (e: FormEvent) => {
 *     e.preventDefault();
 *     createUser.mutate({ name: 'John', email: 'john@example.com' });
 *   };
 *
 *   return (
 *     <form onSubmit={handleSubmit}>
 *       <button type="submit" disabled={createUser.isLoading}>
 *         {createUser.isLoading ? 'Creating...' : 'Create User'}
 *       </button>
 *       {createUser.isError && <div>Error: {String(createUser.error)}</div>}
 *       {createUser.isSuccess && <div>User created!</div>}
 *     </form>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With async/await
 * async function handleCreate() {
 *   try {
 *     const user = await createUser.mutateAsync({ name: 'Jane' });
 *     navigate(`/users/${user.id}`);
 *   } catch (error) {
 *     // Error already captured in state
 *   }
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With retry
 * const uploadFile = useMutation(
 *   async (file: File) => {
 *     const formData = new FormData();
 *     formData.append('file', file);
 *     const response = await fetch('/api/upload', {
 *       method: 'POST',
 *       body: formData,
 *     });
 *     if (!response.ok) throw new Error('Upload failed');
 *     return response.json();
 *   },
 *   {
 *     retry: 3,
 *     retryDelay: (attempt) => attempt * 1000,
 *   }
 * );
 * ```
 */
export function useMutation<TData = unknown, TError = Error, TVariables = void>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options: UseMutationOptions<TData, TError, TVariables> = {}
): UseMutationReturn<TData, TError, TVariables> {
  const { onMutate, onSuccess, onError, onSettled, retry = 0, retryDelay = defaultRetryDelay } = options;

  const [state, setState] = useState<MutationState<TData, TError>>({
    data: undefined,
    error: undefined,
    isLoading: false,
    isSuccess: false,
    isError: false,
    isIdle: true,
    status: 'idle',
  });

  // Track mutation ID to handle race conditions
  const mutationIdRef = useRef(0);

  // Execute mutation with optional per-call callbacks
  const mutate = useCallback(
    (
      variables: TVariables,
      callOptions?: {
        onSuccess?: (data: TData) => void;
        onError?: (error: TError) => void;
        onSettled?: (data: TData | undefined, error: TError | undefined) => void;
      }
    ) => {
      const currentId = ++mutationIdRef.current;

      const executeWithRetry = async (attempt: number): Promise<void> => {
        // Check if this mutation was superseded
        if (mutationIdRef.current !== currentId) return;

        setState({
          data: undefined,
          error: undefined,
          isLoading: true,
          isSuccess: false,
          isError: false,
          isIdle: false,
          status: 'loading',
        });

        try {
          // Call onMutate
          await onMutate?.(variables);

          // Execute mutation
          const data = await mutationFn(variables);

          // Check if this mutation was superseded
          if (mutationIdRef.current !== currentId) return;

          setState({
            data,
            error: undefined,
            isLoading: false,
            isSuccess: true,
            isError: false,
            isIdle: false,
            status: 'success',
          });

          // Call success callbacks
          await onSuccess?.(data, variables);
          await callOptions?.onSuccess?.(data);
          await onSettled?.(data, undefined, variables);
          await callOptions?.onSettled?.(data, undefined);
        } catch (err) {
          // Check if this mutation was superseded
          if (mutationIdRef.current !== currentId) return;

          const error = err as TError;
          const maxRetries = typeof retry === 'boolean' ? (retry ? 3 : 0) : retry;

          // Retry if configured
          if (attempt < maxRetries) {
            const delay = typeof retryDelay === 'function' ? retryDelay(attempt) : retryDelay;
            await new Promise((resolve) => setTimeout(resolve, delay));
            await executeWithRetry(attempt + 1);
            return;
          }

          setState({
            data: undefined,
            error,
            isLoading: false,
            isSuccess: false,
            isError: true,
            isIdle: false,
            status: 'error',
          });

          // Call error callbacks
          await onError?.(error, variables);
          await callOptions?.onError?.(error);
          await onSettled?.(undefined, error, variables);
          await callOptions?.onSettled?.(undefined, error);
        }
      };

      executeWithRetry(0);
    },
    [mutationFn, onMutate, onSuccess, onError, onSettled, retry, retryDelay]
  );

  // Execute mutation and return promise
  const mutateAsync = useCallback(
    (variables: TVariables): Promise<TData> =>
      new Promise((resolve, reject) => {
        mutate(variables, {
          onSuccess: resolve,
          onError: reject,
        });
      }),
    [mutate]
  );

  // Reset mutation state
  const reset = useCallback(() => {
    mutationIdRef.current++;
    setState({
      data: undefined,
      error: undefined,
      isLoading: false,
      isSuccess: false,
      isError: false,
      isIdle: true,
      status: 'idle',
    });
  }, []);

  return {
    ...state,
    mutate,
    mutateAsync,
    reset,
  };
}
