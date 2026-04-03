/**
 * Multi-Backend Module Exports
 *
 * Exports all multi-backend React integration functionality including
 * provider, hooks, components, and types.
 *
 * @module multi-backend
 */

// ============================================================================
// Provider
// ============================================================================

export { MultiBackendProvider } from './provider.js';

// ============================================================================
// Context & Context Hooks
// ============================================================================

export {
  MultiBackendContext,
  MultiBackendConnectionContext,
  useMultiBackendContext,
  useMultiBackendContextSafe,
  useMultiBackendConnectionState,
  useMultiBackendConnectionStateSafe,
} from './context.js';

// ============================================================================
// Hooks
// ============================================================================

export {
  // Core multi-backend hook
  useMultiBackend,

  // Single backend access
  useBackend,
  useBackendConnectionState,

  // Service access
  useBackendService,

  // Data fetching
  useBackendQuery,
  useBackendMutation,

  // Connection status
  useAllBackendsConnected,
  useAnyBackendConnected,
} from './hooks.js';

// ============================================================================
// Components
// ============================================================================

export {
  // Connection-aware wrappers
  BackendConnectionAware,
  RequireBackendConnection,
  MultiBackendConnectionAware,

  // Convenience components
  RequireAllBackends,
  RequireAnyBackend,

  // Status display
  BackendStatus,
} from './components.js';

// ============================================================================
// Types
// ============================================================================

export type {
  // Provider types
  MultiBackendProviderProps,

  // Context types
  MultiBackendContextValue,
  BackendConnectionState,
  MultiBackendConnectionState,

  // Hook option types
  UseBackendOptions,
  UseBackendResult,
  UseBackendServiceOptions,
  BackendQueryOptions,
  BackendMutationOptions,

  // Component prop types
  BackendConnectionAwareProps,
  RequireBackendConnectionProps,
  MultiBackendConnectionAwareProps,

  // Utility types
  ExtractService,
  QualifiedServiceName,
  TypedServiceProxy,
  QueryResult,
  MutationResult,
} from './types.js';
