/**
 * MultiBackendProvider - Root provider for multi-backend React integration
 *
 * Manages connection lifecycle for multiple backends and provides context
 * for child components to access backend clients.
 *
 * @module multi-backend/provider
 */

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import type { BackendSchema, IBackendClient } from '@omnitron-dev/netron-browser';
import { MultiBackendContext, MultiBackendConnectionContext } from './context.js';
import type {
  MultiBackendProviderProps,
  MultiBackendContextValue,
  MultiBackendConnectionState,
  BackendConnectionState,
} from './types.js';

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
}: MultiBackendProviderProps<T>): React.JSX.Element {
  // Track mount state
  const isMounted = useRef(true);

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
  const [connectionStates, setConnectionStates] = useState<Map<string, BackendConnectionState>>(() => {
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
  });

  // Global error state
  const [globalError, setGlobalError] = useState<Error | null>(null);

  // Update connection state for a specific backend
  const updateBackendState = useCallback((backend: string, update: Partial<BackendConnectionState>) => {
    if (!isMounted.current) return;

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
  }, []);

  // Connect to a specific backend with timeout
  const connectBackend = useCallback(
    async (backend: string): Promise<void> => {
      updateBackendState(backend, { isConnecting: true, error: null });

      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Connection timeout for backend '${backend}' after ${connectTimeout}ms`));
          }, connectTimeout);
        });

        await Promise.race([client.connect(backend), timeoutPromise]);

        if (isMounted.current) {
          updateBackendState(backend, { isConnected: true, isConnecting: false });
          onConnect?.(backend);
        }
      } catch (error) {
        if (isMounted.current) {
          const err = error as Error;
          updateBackendState(backend, { isConnected: false, isConnecting: false, error: err });
          onError?.(backend, err);
        }
        throw error;
      }
    },
    [client, connectTimeout, updateBackendState, onConnect, onError]
  );

  // Disconnect from a specific backend
  const disconnectBackend = useCallback(
    async (backend: string): Promise<void> => {
      try {
        await client.disconnect(backend);

        if (isMounted.current) {
          updateBackendState(backend, { isConnected: false, isConnecting: false });
          onDisconnect?.(backend);
        }
      } catch (error) {
        if (isMounted.current) {
          const err = error as Error;
          updateBackendState(backend, { error: err });
          onError?.(backend, err);
        }
        throw error;
      }
    },
    [client, updateBackendState, onDisconnect, onError]
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
            console.error(`Failed to connect to backend '${name}':`, error);
          })
        );
        await Promise.all(connectPromises);
      }
    },
    [backendNames, connectBackend]
  );

  const disconnect = useCallback(
    async (backend?: string): Promise<void> => {
      if (backend) {
        await disconnectBackend(backend);
      } else {
        // Disconnect all backends in parallel
        const disconnectPromises = backendNames.map((name: string) =>
          disconnectBackend(name).catch((error: Error) => {
            console.error(`Failed to disconnect from backend '${name}':`, error);
          })
        );
        await Promise.all(disconnectPromises);
      }
    },
    [backendNames, disconnectBackend]
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
        if (isMounted.current) {
          setGlobalError(error as Error);
        }
      });
    }
  }, [autoConnect, backendNames, client, connect]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      isMounted.current = false;
    },
    []
  );

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
        {children}
      </MultiBackendConnectionContext.Provider>
    </MultiBackendContext.Provider>
  );
}
