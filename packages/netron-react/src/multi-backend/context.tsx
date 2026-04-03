/**
 * Multi-Backend React Context
 *
 * Provides context for multi-backend client access throughout the React component tree.
 *
 * @module multi-backend/context
 */

import { createContext, useContext } from 'react';
import type { BackendSchema } from '@omnitron-dev/netron-browser';
import type { MultiBackendContextValue, MultiBackendConnectionState } from './types.js';

// ============================================================================
// Multi-Backend Context
// ============================================================================

/**
 * Context for multi-backend client access
 */
export const MultiBackendContext = createContext<MultiBackendContextValue | null>(null);

MultiBackendContext.displayName = 'MultiBackendContext';

/**
 * Hook to access multi-backend client
 * @throws Error if used outside MultiBackendProvider
 */
export function useMultiBackendContext<T extends BackendSchema = BackendSchema>(): MultiBackendContextValue<T> {
  const context = useContext(MultiBackendContext);
  if (!context) {
    throw new Error(
      'useMultiBackendContext must be used within a MultiBackendProvider. ' +
        'Make sure to wrap your app with <MultiBackendProvider client={client}>.'
    );
  }
  return context as MultiBackendContextValue<T>;
}

/**
 * Hook to safely access multi-backend client (returns null if not available)
 */
export function useMultiBackendContextSafe<
  T extends BackendSchema = BackendSchema,
>(): MultiBackendContextValue<T> | null {
  return useContext(MultiBackendContext) as MultiBackendContextValue<T> | null;
}

// ============================================================================
// Connection State Context
// ============================================================================

/**
 * Context for multi-backend connection state
 */
export const MultiBackendConnectionContext = createContext<MultiBackendConnectionState | null>(null);

MultiBackendConnectionContext.displayName = 'MultiBackendConnectionContext';

/**
 * Hook to access multi-backend connection state
 * @throws Error if used outside MultiBackendProvider
 */
export function useMultiBackendConnectionState(): MultiBackendConnectionState {
  const context = useContext(MultiBackendConnectionContext);
  if (!context) {
    throw new Error('useMultiBackendConnectionState must be used within a MultiBackendProvider.');
  }
  return context;
}

/**
 * Hook to safely access connection state (returns null if not available)
 */
export function useMultiBackendConnectionStateSafe(): MultiBackendConnectionState | null {
  return useContext(MultiBackendConnectionContext);
}
