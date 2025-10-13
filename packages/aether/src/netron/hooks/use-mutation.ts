/**
 * @fileoverview useMutation reactive hook for data mutations
 * @module @omnitron-dev/aether/netron
 */

import { inject } from '../../di/index.js';
import { signal } from '../../core/index.js';
import { NetronClient } from '../client.js';
import { getBackendName, getServiceName } from '../decorators/index.js';
import type {
  Type,
  MutationOptions,
  MutationResult,
} from '../types.js';

/**
 * useMutation - Perform mutations with optimistic updates
 *
 * @param serviceClass - Service class or service name
 * @param method - Method name
 * @param options - Mutation options
 * @returns Mutation result with mutate function and state signals
 *
 * @example
 * ```typescript
 * const { mutate, loading, error } = useMutation(
 *   UserService,
 *   'updateUser',
 *   {
 *     optimistic: (variables) => ({ ...variables, updated: true }),
 *     invalidate: ['users'],
 *     onSuccess: (data) => console.log('Updated:', data),
 *   }
 * );
 *
 * await mutate({ id: '123', name: 'Alice' });
 * ```
 */
export function useMutation<
  TService,
  TMethod extends keyof TService,
  TData = TService[TMethod] extends (...args: any[]) => Promise<infer R> ? R : never,
  TVariables = TService[TMethod] extends (...args: infer P) => any ? P[0] : never
>(
  serviceClass: Type<TService> | string,
  method: TMethod,
  options?: MutationOptions<TData, TVariables>
): MutationResult<TData, TVariables> {
  // Get NetronClient from DI
  const netron = inject(NetronClient);

  // Extract backend and service names
  const backendName = typeof serviceClass === 'string' ? 'main' : getBackendName(serviceClass);
  const serviceName = typeof serviceClass === 'string' ? serviceClass : getServiceName(serviceClass);

  // Create state signals
  const loading = signal(false);
  const error = signal<Error | undefined>(undefined);
  const data = signal<TData | undefined>(undefined);

  /**
   * Execute mutation with error handling
   */
  const executeMutation = async (variables: TVariables): Promise<TData> => {
    loading.set(true);
    error.set(undefined);

    try {
      // Build mutation options with optimistic update
      const mutationOptions: MutationOptions = {
        ...options,
        optimistic: options?.optimistic ? () => options.optimistic!(variables) : undefined,
      };

      // Execute mutation
      const result = await netron.mutate<TData>(
        serviceName,
        method as string,
        [variables] as any[],
        mutationOptions,
        backendName
      );

      // Update data signal
      data.set(result);

      // Call onSuccess callback
      if (options?.onSuccess) {
        await options.onSuccess(result);
      }

      return result;
    } catch (err) {
      const e = err as Error;
      error.set(e);

      // Call onError callback
      if (options?.onError) {
        await options.onError(e);
      }

      throw e;
    } finally {
      loading.set(false);

      // Call onSettled callback
      if (options?.onSettled) {
        await options.onSettled();
      }
    }
  };

  /**
   * Mutate function that returns promise
   */
  const mutate = async (variables: TVariables): Promise<TData> => executeMutation(variables);

  /**
   * Async mutate function that doesn't return promise
   */
  const mutateAsync = (variables: TVariables): void => {
    executeMutation(variables).catch(() => {
      // Error is handled in state
    });
  };

  /**
   * Reset mutation state
   */
  const reset = (): void => {
    loading.set(false);
    error.set(undefined);
    data.set(undefined);
  };

  return {
    mutate,
    mutateAsync,
    loading,
    error,
    data,
    reset,
  };
}

/**
 * useOptimisticMutation - Mutation with automatic optimistic updates
 *
 * @param serviceClass - Service class or service name
 * @param method - Method name
 * @param getCurrentData - Function to get current data
 * @param applyOptimisticUpdate - Function to apply optimistic update
 * @param options - Additional mutation options
 * @returns Optimistic mutation result
 *
 * @example
 * ```typescript
 * const users = signal<User[]>([]);
 *
 * const { mutate } = useOptimisticMutation(
 *   UserService,
 *   'updateUser',
 *   () => users(),
 *   (current, variables) => current.map(u =>
 *     u.id === variables.id ? { ...u, ...variables } : u
 *   ),
 *   {
 *     onSuccess: (data) => users.set(data),
 *   }
 * );
 * ```
 */
export function useOptimisticMutation<
  TService,
  TMethod extends keyof TService,
  TData = TService[TMethod] extends (...args: any[]) => Promise<infer R> ? R : never,
  TVariables = TService[TMethod] extends (...args: infer P) => any ? P[0] : never,
  TCurrentData = any
>(
  serviceClass: Type<TService> | string,
  method: TMethod,
  getCurrentData: () => TCurrentData,
  applyOptimisticUpdate: (current: TCurrentData, variables: TVariables) => TCurrentData,
  options?: Omit<MutationOptions<TData, TVariables>, 'optimistic'>
): MutationResult<TData, TVariables> & { rollback: () => void } {
  // Track snapshot for rollback
  let snapshot: TCurrentData | undefined;

  // Create mutation with optimistic update
  const mutation = useMutation(serviceClass, method, {
    ...options,
    optimistic: (variables: TVariables) => {
      // Save snapshot
      snapshot = getCurrentData();

      // Apply optimistic update
      return applyOptimisticUpdate(snapshot, variables) as any as TData;
    },
    onError: async (error: Error) => {
      // Rollback on error
      if (snapshot !== undefined && options?.onSuccess) {
        // Restore snapshot through onSuccess callback
        // (assumes onSuccess updates the state)
        await options.onSuccess(snapshot as any);
      }

      // Call original onError
      if (options?.onError) {
        await options.onError(error);
      }
    },
  });

  // Manual rollback function
  const rollback = () => {
    if (snapshot !== undefined && options?.onSuccess) {
      options.onSuccess(snapshot as any);
    }
  };

  return {
    ...mutation,
    rollback,
  };
}

/**
 * useMutations - Execute multiple mutations
 *
 * @param mutations - Mutation configurations
 * @returns Array of mutation results
 *
 * @example
 * ```typescript
 * const [updateUser, deletePost] = useMutations([
 *   { service: UserService, method: 'updateUser' },
 *   { service: PostService, method: 'deletePost' },
 * ]);
 * ```
 */
export function useMutations<
  T extends ReadonlyArray<{
    service: Type<any> | string;
    method: string;
    options?: MutationOptions;
  }>
>(mutations: T): { [K in keyof T]: MutationResult } {
  return mutations.map(mutation =>
    useMutation(
      mutation.service,
      mutation.method,
      mutation.options
    )
  ) as any;
}