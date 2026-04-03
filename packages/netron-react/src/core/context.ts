/**
 * React contexts for netron-react
 */

import { createContext, useContext } from 'react';
import type { NetronReactClient } from './client.js';
import type { RetryConfig } from './types.js';
import type { ConnectionState } from '@omnitron-dev/netron-browser';

// ============================================================================
// Netron Client Context
// ============================================================================

/**
 * Context for NetronReactClient
 */
export const NetronContext = createContext<NetronReactClient | null>(null);

NetronContext.displayName = 'NetronContext';

/**
 * Hook to access NetronReactClient
 * @throws Error if used outside NetronProvider
 */
export function useNetronClient(): NetronReactClient {
  const client = useContext(NetronContext);
  if (!client) {
    throw new Error(
      'useNetronClient must be used within a NetronProvider. ' +
        'Make sure to wrap your app with <NetronProvider client={client}>.'
    );
  }
  return client;
}

/**
 * Hook to safely access NetronReactClient (returns null if not available)
 */
export function useNetronClientSafe(): NetronReactClient | null {
  return useContext(NetronContext);
}

// ============================================================================
// Connection State Context
// ============================================================================

/**
 * Connection state context value
 */
export interface ConnectionContextValue {
  /** Current connection state */
  state: ConnectionState;
  /** Is connected */
  isConnected: boolean;
  /** Is connecting */
  isConnecting: boolean;
  /** Is reconnecting */
  isReconnecting: boolean;
  /** Is disconnected */
  isDisconnected: boolean;
  /** Connection error */
  error: Error | null;
  /** Reconnect function */
  reconnect: () => Promise<void>;
}

/**
 * Context for connection state
 */
export const ConnectionContext = createContext<ConnectionContextValue | null>(null);

ConnectionContext.displayName = 'ConnectionContext';

/**
 * Hook to access connection state
 * @throws Error if used outside NetronProvider
 */
export function useNetronConnection(): ConnectionContextValue {
  const context = useContext(ConnectionContext);
  if (!context) {
    throw new Error('useNetronConnection must be used within a NetronProvider.');
  }
  return context;
}

// ============================================================================
// Query Client Context (for internal use)
// ============================================================================

/**
 * Query client context for internal hook communication
 */
export interface QueryClientContextValue {
  /** Get query state */
  getQueryState: <T>(queryKey: readonly unknown[]) => T | undefined;
  /** Subscribe to query changes */
  subscribeToQuery: (queryKey: readonly unknown[], callback: () => void) => () => void;
  /** Notify query observers */
  notifyQueryObservers: (queryKey: readonly unknown[]) => void;
}

export const QueryClientContext = createContext<QueryClientContextValue | null>(null);

QueryClientContext.displayName = 'QueryClientContext';

// ============================================================================
// Defaults Context
// ============================================================================

/**
 * Default options context value
 */
export interface DefaultsContextValue {
  /** Default stale time */
  staleTime: number;
  /** Default cache time */
  cacheTime: number;
  /** Default retry config */
  retry: number | boolean | RetryConfig;
  /** Refetch on window focus */
  refetchOnWindowFocus: boolean;
  /** Refetch on reconnect */
  refetchOnReconnect: boolean;
}

export const DefaultsContext = createContext<DefaultsContextValue>({
  staleTime: 0,
  cacheTime: 5 * 60 * 1000,
  retry: 3,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
});

DefaultsContext.displayName = 'DefaultsContext';

/**
 * Hook to access default options
 */
export function useDefaults(): DefaultsContextValue {
  return useContext(DefaultsContext);
}

// ============================================================================
// Hydration Context (for SSR)
// ============================================================================

/**
 * Hydration context for SSR support
 */
export interface HydrationContextValue {
  /** Is hydrating from SSR */
  isHydrating: boolean;
  /** Mark hydration complete */
  markHydrated: () => void;
}

export const HydrationContext = createContext<HydrationContextValue>({
  isHydrating: false,
  markHydrated: () => {},
});

HydrationContext.displayName = 'HydrationContext';

/**
 * Hook to check hydration state
 */
export function useHydration(): HydrationContextValue {
  return useContext(HydrationContext);
}
