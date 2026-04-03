/**
 * Multi-Backend React Hooks
 *
 * Type-safe hooks for accessing backends, services, and data fetching
 * in a multi-backend environment.
 *
 * @module multi-backend/hooks
 */

import { useMemo, useCallback, useEffect } from 'react';
import type { BackendSchema, IBackendClient, TypedServiceProxy, NetronError } from '@omnitron-dev/netron-browser';
import { useMultiBackendContext, useMultiBackendConnectionState } from './context.js';
import { useQuery } from '../hooks/useQuery.js';
import { useMutation } from '../hooks/useMutation.js';
import type {
  UseBackendOptions,
  UseBackendResult,
  UseBackendServiceOptions,
  BackendQueryOptions,
  BackendMutationOptions,
} from './types.js';
import type { QueryOptions, QueryResult, MutationOptions, MutationResult, ServiceMethodHooks } from '../core/types.js';

// ============================================================================
// useMultiBackend Hook
// ============================================================================

/**
 * Hook to access the multi-backend client and utilities
 *
 * @returns Multi-backend context value with client and helper methods
 * @throws Error if used outside MultiBackendProvider
 *
 * @example
 * ```tsx
 * function Dashboard() {
 *   const { client, backendNames, isConnected, connect } = useMultiBackend();
 *
 *   if (!isConnected()) {
 *     return <button onClick={() => connect()}>Connect All</button>;
 *   }
 *
 *   return <div>Connected to: {backendNames.join(', ')}</div>;
 * }
 * ```
 */
export function useMultiBackend<T extends BackendSchema = BackendSchema>() {
  return useMultiBackendContext<T>();
}

// ============================================================================
// useBackend Hook
// ============================================================================

/**
 * Hook to access a specific backend client with connection state
 *
 * @param name - Backend name
 * @param options - Hook options
 * @returns Backend client and connection utilities
 *
 * @example
 * ```tsx
 * function CoreService() {
 *   const { client, isConnected, connect, error } = useBackend('core');
 *
 *   if (error) {
 *     return <div>Error: {error.message}</div>;
 *   }
 *
 *   if (!isConnected) {
 *     return <button onClick={connect}>Connect to Core</button>;
 *   }
 *
 *   // Use client.service() or client.invoke()
 *   return <div>Core backend ready</div>;
 * }
 * ```
 */
export function useBackend<T extends BackendSchema, K extends keyof T>(
  name: K,
  options?: UseBackendOptions
): UseBackendResult<T[K]> {
  const { client: multiClient, connect: multiConnect, disconnect: multiDisconnect } = useMultiBackendContext<T>();
  const connectionState = useMultiBackendConnectionState();

  const backendState = connectionState.backends.get(name as string);

  // Get the backend client
  const client = useMemo(() => multiClient.backend(name), [multiClient, name]);

  // Auto-connect effect
  useEffect(() => {
    if (options?.autoConnect && !backendState?.isConnected && !backendState?.isConnecting) {
      multiConnect(name as string).catch(() => {
        // Error is tracked in connection state
      });
    }
  }, [options?.autoConnect, backendState?.isConnected, backendState?.isConnecting, multiConnect, name]);

  // Connection functions
  const connect = useCallback(() => multiConnect(name as string), [multiConnect, name]);

  const disconnect = useCallback(() => multiDisconnect(name as string), [multiDisconnect, name]);

  return {
    client: client as IBackendClient<T[K]>,
    isConnected: backendState?.isConnected ?? false,
    isConnecting: backendState?.isConnecting ?? false,
    error: backendState?.error ?? null,
    connect,
    disconnect,
  };
}

// ============================================================================
// useBackendService Hook
// ============================================================================

/**
 * Hook to get a typed service proxy from a specific backend
 *
 * @param backendName - Backend name
 * @param serviceName - Service name
 * @param options - Service options
 * @returns Typed service proxy with method hooks
 *
 * @example
 * ```tsx
 * interface UserService {
 *   getUser(id: string): Promise<User>;
 *   updateUser(id: string, data: UpdateInput): Promise<User>;
 * }
 *
 * function UserProfile({ userId }: { userId: string }) {
 *   const userService = useBackendService<UserService>('core', 'users');
 *
 *   // As query
 *   const { data, isLoading } = userService.getUser.useQuery([userId]);
 *
 *   // As mutation
 *   const updateMutation = userService.updateUser.useMutation();
 *
 *   return <div>{data?.name}</div>;
 * }
 * ```
 */
export function useBackendService<TService>(
  backendName: string,
  serviceName: string,
  options?: UseBackendServiceOptions
): TypedServiceProxy<TService> & {
  [K in keyof TService]: TService[K] extends (...args: infer A) => Promise<infer R>
    ? ServiceMethodHooks<A extends unknown[] ? A : never[], R>
    : never;
} {
  const { client: multiClient, connect } = useMultiBackendContext();
  const connectionState = useMultiBackendConnectionState();

  // Auto-connect if requested
  useEffect(() => {
    const backendState = connectionState.backends.get(backendName);
    if (options?.autoConnect && !backendState?.isConnected && !backendState?.isConnecting) {
      connect(backendName).catch(() => {});
    }
  }, [options?.autoConnect, backendName, connectionState.backends, connect]);

  // Get backend client
  const backendClient = useMemo(() => multiClient.backend(backendName as never), [multiClient, backendName]);

  // Create service proxy with hooks
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
              backendClient.invoke(serviceName, methodName, args, {
                timeout: options?.timeout,
              }),

            // As query hook - returns a function that creates the query
            useQuery: <TData = unknown>(
              args: unknown[],
              queryOptions?: Omit<QueryOptions<TData>, 'queryFn' | 'queryKey'>
            ): QueryResult<TData> => {
              const queryKey = [backendName, serviceName, methodName, ...args];

              return useQuery<TData>({
                queryKey,
                queryFn: () =>
                  backendClient.invoke<TData>(serviceName, methodName, args, {
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
                  return backendClient.invoke<TData>(serviceName, methodName, args, {
                    timeout: options?.timeout,
                  });
                },
                mutationKey: [backendName, serviceName, methodName],
                ...mutationOptions,
              }),
          };
        },
      }),
    [backendClient, backendName, serviceName, options?.timeout]
  );

  return proxy as TypedServiceProxy<TService> & {
    [K in keyof TService]: TService[K] extends (...args: infer A) => Promise<infer R>
      ? ServiceMethodHooks<A extends unknown[] ? A : never[], R>
      : never;
  };
}

// ============================================================================
// useBackendQuery Hook
// ============================================================================

/**
 * Hook for querying data from a specific backend
 *
 * @param backendName - Backend name
 * @param options - Query options including service and method
 * @returns Query result
 *
 * @example
 * ```tsx
 * function UserList() {
 *   const { data, isLoading, error, refetch } = useBackendQuery('core', {
 *     queryKey: ['users', 'list'],
 *     service: 'users',
 *     method: 'list',
 *     args: [{ limit: 10 }],
 *     staleTime: 5 * 60 * 1000,
 *   });
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *
 *   return (
 *     <ul>
 *       {data?.map(user => <li key={user.id}>{user.name}</li>)}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useBackendQuery<TData = unknown, TError = NetronError>(
  backendName: string,
  options: BackendQueryOptions<TData, TError>
): QueryResult<TData, TError> {
  const { client: multiClient } = useMultiBackendContext();

  const { service, method, args = [], timeout, ...queryOptions } = options;

  // Get backend client
  const backendClient = useMemo(() => multiClient.backend(backendName as never), [multiClient, backendName]);

  // Enhance query key with backend context
  const queryKey = useMemo(
    () => [backendName, service, method, ...options.queryKey],
    [backendName, service, method, options.queryKey]
  );

  return useQuery<TData, TError>({
    ...queryOptions,
    queryKey,
    queryFn: () =>
      backendClient.invoke<TData>(service, method, args, {
        timeout,
      }),
  });
}

// ============================================================================
// useBackendMutation Hook
// ============================================================================

/**
 * Hook for mutations on a specific backend
 *
 * @param backendName - Backend name
 * @param options - Mutation options including service and method
 * @returns Mutation result
 *
 * @example
 * ```tsx
 * function CreateUserForm() {
 *   const mutation = useBackendMutation<User, NetronError, CreateUserInput>('core', {
 *     service: 'users',
 *     method: 'create',
 *     onSuccess: (user) => {
 *       console.log('Created user:', user);
 *     },
 *     invalidateQueries: [['core', 'users', 'list']],
 *   });
 *
 *   const handleSubmit = (data: CreateUserInput) => {
 *     mutation.mutate(data);
 *   };
 *
 *   return (
 *     <form onSubmit={handleSubmit}>
 *       {mutation.isLoading && <div>Creating...</div>}
 *       {mutation.isError && <div>Error: {mutation.error?.message}</div>}
 *     </form>
 *   );
 * }
 * ```
 */
export function useBackendMutation<TData = unknown, TError = NetronError, TVariables = unknown, TContext = unknown>(
  backendName: string,
  options: BackendMutationOptions<TData, TError, TVariables, TContext>
): MutationResult<TData, TError, TVariables, TContext> {
  const { client: multiClient } = useMultiBackendContext();

  const { service, method, timeout, ...mutationOptions } = options;

  // Get backend client
  const backendClient = useMemo(() => multiClient.backend(backendName as never), [multiClient, backendName]);

  return useMutation<TData, TError, TVariables, TContext>({
    ...mutationOptions,
    mutationKey: [backendName, service, method],
    mutationFn: (variables: TVariables) => {
      const args = Array.isArray(variables) ? variables : [variables];
      return backendClient.invoke<TData>(service, method, args, {
        timeout,
      });
    },
  });
}

// ============================================================================
// useBackendConnectionState Hook
// ============================================================================

/**
 * Hook to get connection state for a specific backend
 *
 * @param backendName - Backend name
 * @returns Backend connection state
 *
 * @example
 * ```tsx
 * function BackendStatus({ name }: { name: string }) {
 *   const { isConnected, isConnecting, error } = useBackendConnectionState(name);
 *
 *   if (error) return <span className="error">Error</span>;
 *   if (isConnecting) return <span className="connecting">Connecting...</span>;
 *   if (isConnected) return <span className="connected">Connected</span>;
 *   return <span className="disconnected">Disconnected</span>;
 * }
 * ```
 */
export function useBackendConnectionState(backendName: string) {
  const connectionState = useMultiBackendConnectionState();
  const backendState = connectionState.backends.get(backendName);

  return {
    isConnected: backendState?.isConnected ?? false,
    isConnecting: backendState?.isConnecting ?? false,
    error: backendState?.error ?? null,
  };
}

// ============================================================================
// useAllBackendsConnected Hook
// ============================================================================

/**
 * Hook to check if all backends are connected
 *
 * @returns true if all backends are connected
 *
 * @example
 * ```tsx
 * function App() {
 *   const allConnected = useAllBackendsConnected();
 *
 *   if (!allConnected) {
 *     return <LoadingScreen />;
 *   }
 *
 *   return <MainContent />;
 * }
 * ```
 */
export function useAllBackendsConnected(): boolean {
  const connectionState = useMultiBackendConnectionState();
  return connectionState.allConnected;
}

// ============================================================================
// useAnyBackendConnected Hook
// ============================================================================

/**
 * Hook to check if any backend is connected
 *
 * @returns true if at least one backend is connected
 */
export function useAnyBackendConnected(): boolean {
  const connectionState = useMultiBackendConnectionState();
  return connectionState.anyConnected;
}
