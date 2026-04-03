/**
 * NetronProvider - Root provider component for netron-react
 */

import React, { useEffect, useState, useMemo, useCallback, useRef, type ReactNode } from 'react';

import type { ConnectionState } from '@omnitron-dev/netron-browser';
import type { NetronReactClient } from './client.js';
import type { DehydratedState, DefaultOptions } from './types.js';
import {
  NetronContext,
  ConnectionContext,
  DefaultsContext,
  HydrationContext,
  type ConnectionContextValue,
  type DefaultsContextValue,
  type HydrationContextValue,
} from './context.js';

// ============================================================================
// Provider Props
// ============================================================================

export interface NetronProviderProps {
  /** NetronReactClient instance */
  client: NetronReactClient;
  /** Children components */
  children: ReactNode;
  /** Override default options */
  defaultOptions?: DefaultOptions;
  /** Dehydrated state for SSR hydration */
  dehydratedState?: DehydratedState;
  /** Auto-connect on mount */
  autoConnect?: boolean;
  /** Connect timeout in ms */
  connectTimeout?: number;
  /** Callback when connected */
  onConnect?: () => void;
  /** Callback when disconnected */
  onDisconnect?: () => void;
  /** Callback on error */
  onError?: (error: Error) => void;
}

// ============================================================================
// NetronProvider Component
// ============================================================================

/**
 * NetronProvider
 *
 * Root provider component that provides the NetronReactClient
 * to all child components via React context.
 */
export function NetronProvider({
  client,
  children,
  defaultOptions,
  dehydratedState,
  autoConnect = true,
  connectTimeout = 30000,
  onConnect,
  onDisconnect,
  onError,
}: NetronProviderProps): React.JSX.Element {
  // Connection state
  const [connectionState, setConnectionState] = useState<ConnectionState>(client.getConnectionState());
  const [connectionError, setConnectionError] = useState<Error | null>(null);

  // Hydration state
  const [isHydrating, setIsHydrating] = useState(!!dehydratedState);
  const hasHydrated = useRef(false);

  // Track mount state to prevent state updates after unmount
  const isMounted = useRef(true);

  // Hydrate from SSR state
  useEffect(() => {
    if (dehydratedState && !hasHydrated.current) {
      client.hydrate(dehydratedState);
      hasHydrated.current = true;
      setIsHydrating(false);
    }
  }, [client, dehydratedState]);

  // Setup client event listeners
  useEffect(() => {
    const unsubscribers: Array<() => void> = [];

    unsubscribers.push(
      client.on('connectionStateChange', ({ to }: { to: ConnectionState }) => {
        if (isMounted.current) {
          setConnectionState(to);
          setConnectionError(null);
        }
      })
    );

    unsubscribers.push(
      client.on('connect', () => {
        if (isMounted.current) {
          onConnect?.();
        }
      })
    );

    unsubscribers.push(
      client.on('disconnect', () => {
        if (isMounted.current) {
          onDisconnect?.();
        }
      })
    );

    unsubscribers.push(
      client.on('error', (error: Error) => {
        if (isMounted.current) {
          setConnectionError(error);
          onError?.(error);
        }
      })
    );

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [client, onConnect, onDisconnect, onError]);

  // Auto-connect on mount
  useEffect(() => {
    if (!autoConnect) return undefined;

    let timeoutId: ReturnType<typeof setTimeout>;

    const connect = async () => {
      try {
        // Set timeout for connection
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`Connection timeout after ${connectTimeout}ms`));
          }, connectTimeout);
        });

        await Promise.race([client.connect(), timeoutPromise]);
      } catch (error) {
        if (isMounted.current) {
          setConnectionError(error as Error);
          onError?.(error as Error);
        }
      } finally {
        clearTimeout(timeoutId);
      }
    };

    if (client.getConnectionState() === 'disconnected') {
      connect();
    }

    return () => {
      clearTimeout(timeoutId);
    };
  }, [client, autoConnect, connectTimeout, onError]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      isMounted.current = false;
    },
    []
  );

  // Window focus refetch handling
  useEffect(() => {
    const defaults = client.getDefaultOptions();
    if (!defaults.refetchOnWindowFocus) return undefined;

    const handleFocus = () => {
      if (client.isConnected()) {
        client.invalidateQueries({ stale: true });
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [client]);

  // Online/offline handling
  useEffect(() => {
    const defaults = client.getDefaultOptions();
    if (!defaults.refetchOnReconnect) return undefined;

    const handleOnline = () => {
      if (client.getConnectionState() === 'disconnected') {
        client.connect().catch(console.error);
      }
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [client]);

  // Reconnect function
  const reconnect = useCallback(async () => {
    setConnectionError(null);
    await client.disconnect();
    await client.connect();
  }, [client]);

  // Connection context value
  const connectionValue = useMemo<ConnectionContextValue>(
    () => ({
      state: connectionState,
      isConnected: connectionState === 'connected',
      isConnecting: connectionState === 'connecting',
      isReconnecting: connectionState === 'reconnecting',
      isDisconnected: connectionState === 'disconnected',
      error: connectionError,
      reconnect,
    }),
    [connectionState, connectionError, reconnect]
  );

  // Defaults context value
  const defaultsValue = useMemo<DefaultsContextValue>(() => {
    const clientDefaults = client.getDefaultOptions();
    return {
      staleTime: defaultOptions?.queries?.staleTime ?? clientDefaults.staleTime ?? 0,
      cacheTime: defaultOptions?.queries?.cacheTime ?? clientDefaults.cacheTime ?? 5 * 60 * 1000,
      retry: defaultOptions?.queries?.retry ?? clientDefaults.retry ?? 3,
      refetchOnWindowFocus:
        defaultOptions?.queries?.refetchOnWindowFocus ?? clientDefaults.refetchOnWindowFocus ?? true,
      refetchOnReconnect: defaultOptions?.queries?.refetchOnReconnect ?? clientDefaults.refetchOnReconnect ?? true,
    };
  }, [client, defaultOptions]);

  // Hydration context value
  const hydrationValue = useMemo<HydrationContextValue>(
    () => ({
      isHydrating,
      markHydrated: () => setIsHydrating(false),
    }),
    [isHydrating]
  );

  return (
    <NetronContext.Provider value={client}>
      <ConnectionContext.Provider value={connectionValue}>
        <DefaultsContext.Provider value={defaultsValue}>
          <HydrationContext.Provider value={hydrationValue}>{children}</HydrationContext.Provider>
        </DefaultsContext.Provider>
      </ConnectionContext.Provider>
    </NetronContext.Provider>
  );
}

// ============================================================================
// Additional Provider Components
// ============================================================================

/**
 * Props for connection-aware children
 */
export interface ConnectionAwareProps {
  children: ReactNode;
  /** Render while connecting */
  connecting?: ReactNode;
  /** Render when disconnected */
  disconnected?: ReactNode;
  /** Render on error */
  error?: (error: Error, retry: () => void) => ReactNode;
}

/**
 * ConnectionAware
 *
 * Wrapper component that renders different content based on connection state.
 */
export function ConnectionAware({ children, connecting, disconnected, error }: ConnectionAwareProps): React.JSX.Element {
  const connection = React.useContext(ConnectionContext);

  if (!connection) {
    return <>{children}</>;
  }

  if (connection.error && error) {
    return <>{error(connection.error, connection.reconnect)}</>;
  }

  if (connection.isConnecting && connecting) {
    return <>{connecting}</>;
  }

  if (connection.isDisconnected && disconnected) {
    return <>{disconnected}</>;
  }

  return <>{children}</>;
}

/**
 * RequireConnection
 *
 * Component that only renders children when connected.
 */
export function RequireConnection({ children, fallback }: { children: ReactNode; fallback?: ReactNode }): React.JSX.Element {
  const connection = React.useContext(ConnectionContext);

  if (!connection?.isConnected) {
    return <>{fallback ?? null}</>;
  }

  return <>{children}</>;
}
