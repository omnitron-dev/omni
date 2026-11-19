/**
 * MultiBackendProvider - Root provider for multi-backend React integration
 *
 * Manages connection lifecycle for multiple backends and provides context
 * for child components to access backend clients.
 *
 * @module multi-backend/provider
 */

import { useEffect, useLayoutEffect, useState, useMemo, useCallback, useRef } from 'react';
import type { BackendSchema, IBackendClient } from '@omnitron-dev/netron-browser';
import { MultiBackendContext, MultiBackendConnectionContext } from './context.js';
import { NetronContext, DefaultsContext, type DefaultsContextValue } from '../core/context.js';
import { MultiBackendQueryEngine, asNetronReactClient } from './query-engine.js';
import type {
  MultiBackendProviderProps,
  MultiBackendContextValue,
  MultiBackendConnectionState,
  BackendConnectionState,
} from './types.js';

const useCommitEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

// ============================================================================
// MultiBackendProvider Component
// ============================================================================

/**
 * MultiBackendProvider
 *
 * Root provider component that manages multiple backend connections
 * and provides context for child components.
 *
 * @example
 * ```tsx
 * import { createMultiBackendClient } from '@omnitron-dev/netron-browser';
 * import { MultiBackendProvider } from '@omnitron-dev/netron-react';
 *
 * const client = createMultiBackendClient({
 *   baseUrl: 'https://api.example.com',
 *   backends: {
 *     core: { path: '/core' },
 *     storage: { path: '/storage' },
 *   },
 * });
 *
 * function App() {
 *   return (
 *     <MultiBackendProvider
 *       client={client}
 *       autoConnect
 *       onConnect={(backend) => console.log(`${backend} connected`)}
 *       onError={(backend, error) => console.error(`${backend} error:`, error)}
 *     >
 *       <YourApp />
 *     </MultiBackendProvider>
 *   );
 * }
 * ```
 */
export function MultiBackendProvider<T extends BackendSchema = BackendSchema>({
  client,
  children,
  autoConnect = true,
  connectTimeout = 30000,
  onConnect,
  onDisconnect,
  onError,
  defaultOptions,
  cacheOptions,
}: MultiBackendProviderProps<T>): React.JSX.Element {
  const [cacheConfig] = useState(() => ({
    maxEntries: cacheOptions?.maxEntries,
    defaultCacheTime: cacheOptions?.defaultCacheTime,
  }));
  const { engine, pendingConnections } = useMemo(
    () => ({
      engine: new MultiBackendQueryEngine<T>(client, cacheConfig),
      pendingConnections: new Map<string, Promise<void>>(),
    }),
    [client, cacheConfig]
  );
  const activeEngine = useRef<MultiBackendQueryEngine<T> | null>(engine);
  useCommitEffect(() => {
    activeEngine.current = engine;
    return () => {
      activeEngine.current = null;
      // StrictMode reconnects effects in this commit. Keep its live cache through the replay.
      queueMicrotask(() => {
        if (activeEngine.current !== engine) engine.destroy();
      });
    };
  }, [engine]);

  // Defaults context value — mirrors `<NetronProvider defaultOptions>`
  // so a multi-backend app gets the same staleTime/cacheTime knobs
  // without a nested provider.
  const defaultsValue = useMemo<DefaultsContextValue>(
    () => ({
      staleTime: defaultOptions?.queries?.staleTime ?? 0,
      cacheTime: defaultOptions?.queries?.cacheTime ?? 5 * 60 * 1000,
      retry: defaultOptions?.queries?.retry ?? 3,
      refetchOnWindowFocus: defaultOptions?.queries?.refetchOnWindowFocus ?? true,
      refetchOnReconnect: defaultOptions?.queries?.refetchOnReconnect ?? true,
    }),
    [defaultOptions],
  );

  // Get backend names from client
  const backendNames = useMemo(() => {
    // Access internal method if available, otherwise track via connect attempts
    if ('getBackendNames' in client && typeof client.getBackendNames === 'function') {
      return (client as unknown as { getBackendNames: () => string[] }).getBackendNames();
    }
    // Fallback: empty array, will be populated on first access
    return [];
  }, [client]);

  // Initialize connection states
  const initialStates = useMemo(() => {
    const states = new Map<string, BackendConnectionState>();
    for (const name of backendNames) {
      states.set(name, {
        name,
        isConnected: client.isConnected(name),
        isConnecting: false,
        error: null,
      });
    }
    return states;
  }, [backendNames, client]);
  const [observedClient, setObservedClient] = useState(client);
  const [connectionStates, setConnectionStates] = useState(initialStates);

  // Global error state
  const [globalError, setGlobalError] = useState<Error | null>(null);
  if (observedClient !== client) {
    setObservedClient(client);
    setConnectionStates(initialStates);
    setGlobalError(null);
  }

  // Update connection state for a specific backend
  const updateBackendState = useCallback((backend: string, update: Partial<BackendConnectionState>) => {
    if (activeEngine.current !== engine) return;

    setConnectionStates((prev: Map<string, BackendConnectionState>) => {
      const newStates = new Map(prev);
      const current = newStates.get(backend) || {
        name: backend,
        isConnected: false,
        isConnecting: false,
        error: null,
      };
      newStates.set(backend, { ...current, ...update });
      return newStates;
    });
  }, [engine]);

  // Connect to a specific backend with timeout
  const connectBackend = useCallback(
    (backend: string): Promise<void> => {
      const pending = pendingConnections.get(backend);
      if (pending) return pending;
      updateBackendState(backend, { isConnecting: true, error: null });
      let timer: ReturnType<typeof setTimeout>;
      const request = new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Connection timeout for backend '${backend}' after ${connectTimeout}ms`));
        }, connectTimeout);
        client.connect(backend).then(resolve, reject);
      })
        .then(() => {
          if (activeEngine.current === engine) {
            updateBackendState(backend, { isConnected: true, isConnecting: false });
            onConnect?.(backend);
          }
        })
        .catch((error: unknown) => {
          if (activeEngine.current === engine) {
            const err = error as Error;
            updateBackendState(backend, { isConnected: false, isConnecting: false, error: err });
            onError?.(backend, err);
          }
          throw error;
        })
        .finally(() => {
          clearTimeout(timer);
          pendingConnections.delete(backend);
        });
      pendingConnections.set(backend, request);
      return request;
    },
    [client, engine, pendingConnections, connectTimeout, updateBackendState, onConnect, onError]
  );

  // Disconnect from a specific backend
  const disconnectBackend = useCallback(
    async (backend: string): Promise<void> => {
      try {
        await client.disconnect(backend);

        if (activeEngine.current === engine) {
          updateBackendState(backend, { isConnected: false, isConnecting: false });
          onDisconnect?.(backend);
        }
      } catch (error) {
        if (activeEngine.current === engine) {
          const err = error as Error;
          updateBackendState(backend, { error: err });
          onError?.(backend, err);
        }
        throw error;
      }
    },
    [client, engine, updateBackendState, onDisconnect, onError]
  );

  // Connect/disconnect wrapper that handles single or all backends
  const connect = useCallback(
    async (backend?: string): Promise<void> => {
      if (backend) {
        await connectBackend(backend);
      } else {
        // Connect all backends in parallel
        const connectPromises = backendNames.map((name: string) =>
          connectBackend(name).catch((error: Error) => {
            // Don't throw, just log - we want to try all backends
            if (activeEngine.current === engine) console.error(`Failed to connect to backend '${name}':`, error);
          })
        );
        await Promise.all(connectPromises);
      }
    },
    [backendNames, connectBackend, engine]
  );

  const disconnect = useCallback(
    async (backend?: string): Promise<void> => {
      if (backend) {
        await disconnectBackend(backend);
      } else {
        // Disconnect all backends in parallel
        const disconnectPromises = backendNames.map((name: string) =>
          disconnectBackend(name).catch((error: Error) => {
            if (activeEngine.current === engine) console.error(`Failed to disconnect from backend '${name}':`, error);
          })
        );
        await Promise.all(disconnectPromises);
      }
    },
    [backendNames, disconnectBackend, engine]
  );

  // Check connection status
  const isConnected = useCallback(
    (backend?: string): boolean => {
      if (backend) {
        return connectionStates.get(backend)?.isConnected ?? client.isConnected(backend);
      }
      return client.isConnected();
    },
    [client, connectionStates]
  );

  // Get backend client
  const getBackend = useCallback(<K extends keyof T>(name: K): IBackendClient<T[K]> => client.backend(name), [client]);

  // Auto-connect on mount
  useEffect(() => {
    if (!autoConnect) return;

    // Check if already connected
    const needsConnect = backendNames.some((name) => !client.isConnected(name));

    if (needsConnect) {
      connect().catch((error) => {
        if (activeEngine.current === engine) {
          setGlobalError(error as Error);
        }
      });
    }
  }, [autoConnect, backendNames, client, connect, engine]);

  // Compute aggregated connection state
  const connectionState = useMemo<MultiBackendConnectionState>(() => {
    const allConnected =
      backendNames.length > 0 && backendNames.every((name: string) => connectionStates.get(name)?.isConnected ?? false);
    const anyConnected = backendNames.some((name: string) => connectionStates.get(name)?.isConnected ?? false);
    const anyConnecting = backendNames.some((name: string) => connectionStates.get(name)?.isConnecting ?? false);

    return {
      backends: connectionStates,
      allConnected,
      anyConnected,
      anyConnecting,
      globalError,
    };
  }, [backendNames, connectionStates, globalError]);

  // Context value
  const contextValue = useMemo<MultiBackendContextValue<T>>(
    () => ({
      client,
      getBackend,
      backendNames,
      isConnected,
      connect,
      disconnect,
    }),
    [client, getBackend, backendNames, isConnected, connect, disconnect]
  );

  return (
    <MultiBackendContext.Provider value={contextValue as MultiBackendContextValue}>
      <MultiBackendConnectionContext.Provider value={connectionState}>
        {/*
          Bridge the engine into the same `NetronContext` /
          `DefaultsContext` that `<NetronProvider>` populates so
          downstream data hooks (`useQuery`, `useMutation`,
          `useInfiniteQuery`, `useBackendQuery`, …) read from a
          single, shared cache through the standard
          `useNetronClient()` call. The engine is a focused
          adapter — see `query-engine.ts` for why we don't ship a
          full `NetronReactClient` here.
        */}
        <NetronContext.Provider value={asNetronReactClient(engine)}>
          <DefaultsContext.Provider value={defaultsValue}>{children}</DefaultsContext.Provider>
        </NetronContext.Provider>
      </MultiBackendConnectionContext.Provider>
    </MultiBackendContext.Provider>
  );
}
