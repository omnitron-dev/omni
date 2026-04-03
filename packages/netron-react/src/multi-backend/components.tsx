/**
 * Multi-Backend Connection-Aware Components
 *
 * React components for conditionally rendering content based on
 * backend connection states.
 *
 * @module multi-backend/components
 */

import React, { useCallback } from 'react';
import { useMultiBackendConnectionState, useMultiBackendContext } from './context.js';
import type {
  BackendConnectionAwareProps,
  RequireBackendConnectionProps,
  MultiBackendConnectionAwareProps,
} from './types.js';

// ============================================================================
// BackendConnectionAware Component
// ============================================================================

/**
 * BackendConnectionAware
 *
 * Renders different content based on a specific backend's connection state.
 *
 * @example
 * ```tsx
 * <BackendConnectionAware
 *   backend="core"
 *   connecting={<Spinner />}
 *   disconnected={<DisconnectedMessage />}
 *   error={(err, retry) => (
 *     <div>
 *       Error: {err.message}
 *       <button onClick={retry}>Retry</button>
 *     </div>
 *   )}
 * >
 *   <CoreFeatures />
 * </BackendConnectionAware>
 * ```
 */
export function BackendConnectionAware({
  backend,
  children,
  connecting,
  disconnected,
  error,
}: BackendConnectionAwareProps): React.JSX.Element {
  const connectionState = useMultiBackendConnectionState();
  const { connect } = useMultiBackendContext();

  const backendState = connectionState.backends.get(backend);

  const retry = useCallback(() => {
    connect(backend).catch(() => {});
  }, [connect, backend]);

  // Error state
  if (backendState?.error && error) {
    return <>{error(backendState.error, retry)}</>;
  }

  // Connecting state
  if (backendState?.isConnecting && connecting) {
    return <>{connecting}</>;
  }

  // Disconnected state
  if (!backendState?.isConnected && disconnected) {
    return <>{disconnected}</>;
  }

  // Connected - render children
  return <>{children}</>;
}

// ============================================================================
// RequireBackendConnection Component
// ============================================================================

/**
 * RequireBackendConnection
 *
 * Only renders children when a specific backend is connected.
 * Useful for gating features that require a specific backend.
 *
 * @example
 * ```tsx
 * <RequireBackendConnection
 *   backend="storage"
 *   fallback={<div>Storage backend not available</div>}
 * >
 *   <FileManager />
 * </RequireBackendConnection>
 * ```
 */
export function RequireBackendConnection({ backend, children, fallback }: RequireBackendConnectionProps): React.JSX.Element {
  const connectionState = useMultiBackendConnectionState();
  const backendState = connectionState.backends.get(backend);

  if (!backendState?.isConnected) {
    return <>{fallback ?? null}</>;
  }

  return <>{children}</>;
}

// ============================================================================
// MultiBackendConnectionAware Component
// ============================================================================

/**
 * MultiBackendConnectionAware
 *
 * Renders content based on multiple backend connection states.
 * Can require all backends or just any backend to be connected.
 *
 * @example
 * ```tsx
 * // Require all backends
 * <MultiBackendConnectionAware
 *   requireAll
 *   connecting={<FullScreenLoader />}
 *   disconnected={<ConnectionRequired />}
 * >
 *   <FullApplication />
 * </MultiBackendConnectionAware>
 *
 * // Require any backend (graceful degradation)
 * <MultiBackendConnectionAware
 *   requireAll={false}
 *   backends={['core', 'cache']}
 *   disconnected={<OfflineMode />}
 * >
 *   <MainFeatures />
 * </MultiBackendConnectionAware>
 * ```
 */
export function MultiBackendConnectionAware({
  requireAll = true,
  backends,
  children,
  connecting,
  disconnected,
  error,
}: MultiBackendConnectionAwareProps): React.JSX.Element {
  const connectionState = useMultiBackendConnectionState();
  const { connect, backendNames } = useMultiBackendContext();

  // Determine which backends to check
  const backendsToCheck = backends || backendNames;

  // Collect errors
  const errors = new Map<string, Error>();
  let isAnyConnecting = false;
  let connectedCount = 0;

  for (const backendName of backendsToCheck) {
    const state = connectionState.backends.get(backendName);
    if (state?.error) {
      errors.set(backendName, state.error);
    }
    if (state?.isConnecting) {
      isAnyConnecting = true;
    }
    if (state?.isConnected) {
      connectedCount++;
    }
  }

  // Retry function
  const retry = useCallback(() => {
    // Reconnect failed backends
    for (const backendName of errors.keys()) {
      connect(backendName).catch(() => {});
    }
  }, [connect, errors]);

  // Check if we have errors to display
  if (errors.size > 0 && error) {
    // Only show error if it affects our connection requirement
    const hasRequiredErrors = requireAll || connectedCount === 0;
    if (hasRequiredErrors) {
      return <>{error(errors, retry)}</>;
    }
  }

  // Check connecting state
  if (isAnyConnecting && connecting) {
    // For requireAll, show connecting if any is connecting
    // For !requireAll, only show if none are connected yet
    if (requireAll || connectedCount === 0) {
      return <>{connecting}</>;
    }
  }

  // Check connection requirements
  const isConnected = requireAll ? connectedCount === backendsToCheck.length : connectedCount > 0;

  if (!isConnected && disconnected) {
    return <>{disconnected}</>;
  }

  // Requirements met - render children
  return <>{children}</>;
}

// ============================================================================
// RequireAllBackends Component
// ============================================================================

/**
 * RequireAllBackends
 *
 * Convenience component that only renders when all backends are connected.
 *
 * @example
 * ```tsx
 * <RequireAllBackends fallback={<LoadingScreen />}>
 *   <Dashboard />
 * </RequireAllBackends>
 * ```
 */
export function RequireAllBackends({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}): React.JSX.Element {
  const connectionState = useMultiBackendConnectionState();

  if (!connectionState.allConnected) {
    return <>{fallback ?? null}</>;
  }

  return <>{children}</>;
}

// ============================================================================
// RequireAnyBackend Component
// ============================================================================

/**
 * RequireAnyBackend
 *
 * Convenience component that renders when at least one backend is connected.
 * Useful for graceful degradation scenarios.
 *
 * @example
 * ```tsx
 * <RequireAnyBackend fallback={<OfflineMessage />}>
 *   <DegradedFeatures />
 * </RequireAnyBackend>
 * ```
 */
export function RequireAnyBackend({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}): React.JSX.Element {
  const connectionState = useMultiBackendConnectionState();

  if (!connectionState.anyConnected) {
    return <>{fallback ?? null}</>;
  }

  return <>{children}</>;
}

// ============================================================================
// BackendStatus Component
// ============================================================================

/**
 * BackendStatus
 *
 * Displays the connection status of a specific backend.
 * Useful for debugging or status indicators.
 *
 * @example
 * ```tsx
 * <div className="status-bar">
 *   <BackendStatus backend="core" />
 *   <BackendStatus backend="storage" />
 * </div>
 * ```
 */
export function BackendStatus({
  backend,
  showError = false,
  className,
}: {
  backend: string;
  showError?: boolean;
  className?: string;
}): React.JSX.Element {
  const connectionState = useMultiBackendConnectionState();
  const backendState = connectionState.backends.get(backend);

  let status: 'connected' | 'connecting' | 'disconnected' | 'error' = 'disconnected';

  if (backendState?.error) {
    status = 'error';
  } else if (backendState?.isConnecting) {
    status = 'connecting';
  } else if (backendState?.isConnected) {
    status = 'connected';
  }

  return (
    <span className={className} data-backend={backend} data-status={status}>
      {backend}: {status}
      {showError && backendState?.error && ` (${backendState.error.message})`}
    </span>
  );
}
