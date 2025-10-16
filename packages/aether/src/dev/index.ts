/**
 * Aether Development Server
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

// ===== Types =====
export type {
  DevServer,
  DevServerConfig,
  DevMetrics,
  HMRConfig,
  HMRUpdate,
  HMRPayload,
  HMREngine as IHMREngine,
  FastRefreshConfig,
  ComponentState,
  ErrorOverlayConfig,
  ErrorInfo,
  Middleware,
  MiddlewareStack as IMiddlewareStack,
  CorsConfig,
  CompressionConfig,
  ProxyConfig,
  FileWatcher,
  ModuleNode,
  ModuleGraph,
} from './types.js';

// ===== Dev Server =====
export { createDevServer } from './server.js';

// ===== HMR =====
export {
  HMREngine,
  HMRClient,
  initHMR,
  getHMRClient,
  FastRefresh,
  initFastRefresh,
  getFastRefresh,
  withFastRefresh,
} from './hmr/index.js';

// ===== Error Handling =====
export {
  ErrorOverlay,
  initErrorOverlay,
  getErrorOverlay,
  showError,
  hideError,
} from './error/index.js';

// ===== Middleware =====
export {
  MiddlewareStack,
  createDevMiddleware,
  createLoggerMiddleware,
  createCorsMiddleware,
  createCompressionMiddleware,
  createStaticMiddleware,
  createHMRMiddleware,
} from './middleware/index.js';
