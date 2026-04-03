/**
 * useMutation - Hook for data mutations
 */

import { useState, useCallback, useRef, useMemo } from 'react';
import type { NetronError } from '@omnitron-dev/netron-browser';
import { useNetronClient } from '../core/context.js';
import type { MutationOptions, MutationResult, MutationStatus, RetryConfig } from '../core/types.js';
import { calculateRetryDelay } from '../cache/utils.js';

/**
 * Default retry configuration for mutations
 */
const DEFAULT_RETRY: RetryConfig = {
  attempts: 0, // No retry by default for mutations
  initialDelay: 1000,
  maxDelay: 30000,
  backoff: 'exponential',
};

/**
 * useMutation hook
 *
 * Handles data mutations with optimistic updates and error handling.
 *
 * @example
 * ```tsx
 * const mutation = useMutation({
 *   mutationFn: (user: UpdateUserInput) => userService.updateUser(user),
 *   onSuccess: () => {
 *     toast.success('User updated');
 *   },
 *   invalidateQueries: [['users']],
 * });
 *
 * // Use it
 * mutation.mutate({ id: '1', name: 'New Name' });
 * ```
 */
export function useMutation<TData = unknown, TError = NetronError, TVariables = void, TContext = unknown>(
  options: MutationOptions<TData, TError, TVariables, TContext>
): MutationResult<TData, TError, TVariables, TContext> {
  const client = useNetronClient();

  const {
    mutationFn,
    mutationKey,
    onMutate,
    onSuccess,
    onError,
    onSettled,
    retry = false,
    retryDelay,
    invalidateQueries,
  } = options;

  // State
  const [data, setData] = useState<TData | undefined>(undefined);
  const [error, setError] = useState<TError | null>(null);
  const [variables, setVariables] = useState<TVariables | undefined>(undefined);
  const [context, setContext] = useState<TContext | undefined>(undefined);
  const [status, setStatus] = useState<MutationStatus>('idle');

  // Refs
  const mutationId = useRef<string | null>(null);
  const isMounted = useRef(true);

  // Execute mutation
  const executeMutation = useCallback(
    async (vars: TVariables): Promise<TData> => {
      const mutationCache = client.getMutationCache();

      // Create mutation entry
      mutationId.current = mutationCache.create({ mutationKey, variables: vars });

      setVariables(vars);
      setStatus('loading');
      setError(null);

      let mutationContext: TContext | undefined;

      try {
        // Call onMutate for optimistic updates
        if (onMutate) {
          mutationContext = await onMutate(vars);
          setContext(mutationContext);
        }

        // Start mutation in cache
        mutationCache.start(mutationId.current, vars);

        // Execute with retry
        const retryConfig =
          typeof retry === 'number'
            ? { ...DEFAULT_RETRY, attempts: retry }
            : typeof retry === 'boolean'
              ? retry
                ? { ...DEFAULT_RETRY, attempts: 3 }
                : { attempts: 0 }
              : { ...DEFAULT_RETRY, ...retry };

        let result: TData;
        let lastError: TError | null = null;

        for (let attempt = 0; attempt <= retryConfig.attempts; attempt++) {
          try {
            result = await mutationFn(vars);

            // Update state
            if (isMounted.current) {
              setData(result);
              setStatus('success');
            }

            // Update cache
            mutationCache.success(mutationId.current, result, mutationContext);

            // Invalidate queries
            if (invalidateQueries?.length) {
              for (const queryKey of invalidateQueries) {
                await client.invalidateQueries({ queryKey });
              }
            }

            // Callbacks
            await onSuccess?.(result, vars, mutationContext as TContext);
            await onSettled?.(result, null, vars, mutationContext);

            return result;
          } catch (err) {
            lastError = err as TError;

            // Check if should retry
            const shouldRetry =
              attempt < retryConfig.attempts && (retryConfig.retryCondition?.(err as Error, attempt) ?? true);

            if (!shouldRetry) break;

            // Calculate delay
            const delay =
              typeof retryDelay === 'function'
                ? retryDelay(attempt, lastError)
                : typeof retryDelay === 'number'
                  ? retryDelay
                  : calculateRetryDelay(attempt, retryConfig);

            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }

        // All retries failed
        throw lastError;
      } catch (err) {
        const typedError = err as TError;

        // Update state
        if (isMounted.current) {
          setError(typedError);
          setStatus('error');
        }

        // Update cache
        if (mutationId.current) {
          mutationCache.failure(mutationId.current, typedError);
        }

        // Callbacks
        await onError?.(typedError, vars, mutationContext);
        await onSettled?.(undefined, typedError, vars, mutationContext);

        throw typedError;
      }
    },
    [mutationFn, mutationKey, onMutate, onSuccess, onError, onSettled, retry, retryDelay, invalidateQueries, client]
  );

  // Mutate (fire and forget)
  const mutate = useCallback(
    (vars: TVariables) => {
      executeMutation(vars).catch(() => {
        // Error already handled
      });
    },
    [executeMutation]
  );

  // Mutate async (returns promise)
  const mutateAsync = useCallback((vars: TVariables): Promise<TData> => executeMutation(vars), [executeMutation]);

  // Reset mutation state
  const reset = useCallback(() => {
    if (mutationId.current) {
      client.getMutationCache().reset(mutationId.current);
    }

    setData(undefined);
    setError(null);
    setVariables(undefined);
    setContext(undefined);
    setStatus('idle');
    mutationId.current = null;
  }, [client]);

  // Cleanup
  // Note: We don't add cleanup effect here as mutations may need to complete after unmount

  // Return result
  return useMemo(
    () => ({
      data,
      error,
      variables,
      context,
      status,
      isIdle: status === 'idle',
      isLoading: status === 'loading',
      isSuccess: status === 'success',
      isError: status === 'error',
      mutate,
      mutateAsync,
      reset,
    }),
    [data, error, variables, context, status, mutate, mutateAsync, reset]
  );
}

export default useMutation;
