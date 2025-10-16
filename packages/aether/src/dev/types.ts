/**
 * Dev Server Types
 *
 * Re-exports from unified server types for backward compatibility.
 * All type definitions are now in @omnitron-dev/aether/server/types
 */

// Re-export all dev-related types from unified server types
export type {
  // Dev Server
  DevServer,
  DevServerConfig,
  DevMetrics,
  // HMR
  HMRConfig,
  HMRUpdate,
  HMRPayload,
  HMREngine,
  ModuleNode,
  ModuleGraph,
  // Fast Refresh
  ComponentState,
  FastRefreshConfig,
  // Error Handling
  ErrorOverlayConfig,
  ErrorInfo,
  // Middleware
  Middleware,
  MiddlewareStack,
  CorsConfig,
  CompressionConfig,
  ProxyConfig,
  // File Watcher
  FileWatcher,
} from '../server/types.js';
