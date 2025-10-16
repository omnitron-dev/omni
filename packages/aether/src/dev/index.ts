/**
 * Aether Development Server
 *
 * Re-exports from unified server module for backward compatibility.
 * All dev server functionality is now integrated into @omnitron-dev/aether/server
 *
 * Full-featured development server with:
 * - Hot Module Replacement (HMR)
 * - Fast Refresh for components
 * - Error overlay
 * - Dev middleware (CORS, compression, static files)
 * - File watching
 * - TypeScript support
 * - Islands architecture
 * - SSR/SSG
 */

// Re-export everything from unified server module
export type {
  // Dev Server Types
  DevServer,
  DevServerConfig,
  DevMetrics,
  // HMR Types
  HMRConfig,
  HMRUpdate,
  HMRPayload,
  IHMREngine,
  ModuleNode,
  ModuleGraph,
  // Fast Refresh Types
  ComponentState,
  FastRefreshConfig,
  // Error Types
  ErrorOverlayConfig,
  ErrorInfo,
  // Middleware Types
  Middleware,
  IMiddlewareStack,
  CorsConfig,
  CompressionConfig,
  ProxyConfig,
  FileWatcher,
} from '../server/index.js';

// Re-export all dev server functionality
export {
  // Dev Server
  createDevServer,
  // HMR
  HMREngine,
  HMRClient,
  initHMR,
  getHMRClient,
  // Fast Refresh
  FastRefresh,
  initFastRefresh,
  getFastRefresh,
  withFastRefresh,
  // Error Handling
  ErrorOverlay,
  initErrorOverlay,
  getErrorOverlay,
  showError,
  hideError,
  // Middleware
  MiddlewareStack,
  createDevMiddleware,
  createLoggerMiddleware,
  createCorsMiddleware,
  createCompressionMiddleware,
  createStaticMiddleware,
  createHMRMiddleware,
} from '../server/index.js';
