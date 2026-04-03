/**
 * useService - Hook for type-safe service access
 */

import { useMemo } from 'react';
import type { NetronError } from '@omnitron-dev/netron-browser';
import { useNetronClient } from '../core/context.js';
import type {
  ServiceOptions,
  TypedServiceProxy,
  QueryOptions,
  QueryResult,
  MutationOptions,
  MutationResult,
} from '../core/types.js';
import { useQuery } from './useQuery.js';
import { useMutation } from './useMutation.js';

/**
 * useService hook
 *
 * Provides type-safe access to a Netron service with integrated hooks.
 *
 * @example
 * ```tsx
 * interface UserService {
 *   getUser(id: string): Promise<User>;
 *   updateUser(id: string, data: UpdateUserInput): Promise<User>;
 * }
 *
 * function UserProfile({ userId }: { userId: string }) {
 *   const userService = useService<UserService>('users@1.0.0');
 *
 *   // As query
 *   const { data } = userService.getUser.useQuery([userId]);
 *
 *   // As mutation
 *   const mutation = userService.updateUser.useMutation();
 *
 *   return <div>{data?.name}</div>;
 * }
 * ```
 */
export function useService<TService>(serviceName: string, options?: ServiceOptions): TypedServiceProxy<TService> {
  const client = useNetronClient();

  const proxy = useMemo(
    () =>
      new Proxy({} as TypedServiceProxy<TService>, {
        get(_target, methodName: string | symbol) {
          if (typeof methodName === 'symbol') {
            return undefined;
          }

          // Create method hooks object
          return {
            // Direct call
            call: (...args: unknown[]) =>
              client.invoke(serviceName, methodName, args, {
                timeout: options?.timeout,
              }),

            // As query hook
            useQuery: <TData = unknown>(
              args: unknown[],
              queryOptions?: Omit<QueryOptions<TData>, 'queryFn' | 'queryKey'>
            ): QueryResult<TData> => {
              const queryKey = [serviceName, methodName, ...args];

              // We need to call useQuery at the top level of the component
              // This is a hook factory pattern
              return useQuery<TData>({
                queryKey,
                queryFn: () =>
                  client.invoke<TData>(serviceName, methodName, args, {
                    timeout: options?.timeout,
                  }),
                ...queryOptions,
              });
            },

            // As mutation hook
            useMutation: <TData = unknown, TVariables = unknown[]>(
              mutationOptions?: Omit<MutationOptions<TData, NetronError, TVariables>, 'mutationFn'>
            ): MutationResult<TData, NetronError, TVariables> =>
              useMutation<TData, NetronError, TVariables>({
                mutationFn: (variables: TVariables) => {
                  const args = Array.isArray(variables) ? variables : [variables];
                  return client.invoke<TData>(serviceName, methodName, args, {
                    timeout: options?.timeout,
                  });
                },
                mutationKey: [serviceName, methodName],
                ...mutationOptions,
              }),
          };
        },
      }),
    [client, serviceName, options?.timeout]
  );

  return proxy;
}

/**
 * Helper to create a typed service hook factory
 *
 * @example
 * ```tsx
 * const useUserService = createServiceHook<UserService>('users@1.0.0');
 *
 * function MyComponent() {
 *   const userService = useUserService();
 *   // ...
 * }
 * ```
 */
export function createServiceHook<TService>(
  serviceName: string,
  defaultOptions?: ServiceOptions
): (options?: ServiceOptions) => TypedServiceProxy<TService> {
  return (options?: ServiceOptions) => {
    const mergedOptions = { ...defaultOptions, ...options };
    return useService<TService>(serviceName, mergedOptions);
  };
}

export default useService;
