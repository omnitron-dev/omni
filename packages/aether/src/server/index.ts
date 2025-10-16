/**
 * Server Module
 *
 * SSR/SSG/Islands/Streaming/Edge/Hydration for Aether
 */

// ===== Types =====
export type {
  // Server
  Server,
  ServerConfig,
  RenderContext,
  RenderResult,
  RenderMode,
  MetaTags,
  // SSR
  SSROptions,
  SSRContext,
  RenderToStringOptions,
  RenderToStaticMarkupOptions,
  // SSG
  SSGOptions,
  StaticPathsResult,
  StaticPropsResult,
  // Hydration
  HydrationOptions,
  HydrationStrategy,
  HydrationError,
  // Streaming
  StreamingOptions,
  StreamingResult,
  RenderToStreamOptions,
  // Edge
  EdgeOptions,
  // Meta/Head
  HeadContext,
  MetaTag,
  LinkTag,
  ScriptTag,
  StyleTag,
  // Islands
  IslandMarker,
} from './types.js';

// ===== Server =====
export { createServer } from './server.js';

// ===== Renderer (Original) =====
export { renderDocument } from './renderer.js';

// ===== SSR =====
export {
  // Main SSR functions
  renderToString,
  renderToStaticMarkup,
  // Data collection
  collectData,
  extractStyles,
  // Context management
  getSSRContext,
  setSSRContext,
} from './ssr.js';

// ===== Hydration =====
export {
  // Main hydration
  hydrate,
  hydrateRoot,
  // State preservation
  preserveServerState,
  // Component registration
  registerComponent,
  // Debugging
  getHydrationMismatches,
  clearHydrationState,
} from './hydration.js';

// ===== SSG =====
export {
  // Static site generation
  generateStaticSite,
  generateStaticSiteFromFiles,
  // Static paths/props
  getStaticPaths,
  getStaticProps,
  // ISR
  revalidate,
  clearISRCache,
  getISRCacheStats,
} from './ssg.js';

// ===== Streaming =====
export {
  // Streaming SSR
  renderToPipeableStream,
  renderToReadableStream,
  createStreamingRenderer,
  // Suspense
  createSuspenseBoundaryId,
  resetBoundaryCounter,
} from './streaming.js';

// ===== Edge =====
export {
  // Edge rendering
  renderToEdge,
  createEdgeHandler,
  optimizeForEdge,
  // Runtime-specific handlers
  createCloudflareHandler,
  createVercelEdgeHandler,
  createDenoHandler,
  // Runtime info
  getEdgeRuntimeInfo,
} from './edge.js';

// ===== Meta/Head =====
export {
  // Head rendering
  renderHead,
  collectMeta,
  injectMeta,
  // Client updates
  updateMeta,
  // Context management
  getHeadContext,
  setHeadContext,
  createHeadContext,
  // Helpers
  createOpenGraphTags,
  createTwitterCardTags,
  createJSONLD,
} from './meta.js';

// ===== Dev Server Types =====
export type {
  // Dev Server
  DevServer,
  DevServerConfig,
  DevMetrics,
  // HMR
  HMRConfig,
  HMRUpdate,
  HMRPayload,
  HMREngine as IHMREngine,
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
  MiddlewareStack as IMiddlewareStack,
  CorsConfig,
  CompressionConfig,
  ProxyConfig,
  // File Watcher
  FileWatcher,
} from './types.js';

// ===== Dev Server =====
export { createDevServer } from '../dev/server.js';

// ===== HMR =====
export {
  // HMR Engine
  HMREngine,
  // HMR Client
  HMRClient,
  initHMR,
  getHMRClient,
  // Fast Refresh
  FastRefresh,
  initFastRefresh,
  getFastRefresh,
  withFastRefresh,
} from './hmr/index.js';

// ===== Error Handling =====
export {
  // Error Overlay
  ErrorOverlay,
  initErrorOverlay,
  getErrorOverlay,
  showError,
  hideError,
} from './error/index.js';

// ===== Dev Middleware =====
export {
  // Middleware Stack
  MiddlewareStack,
  createDevMiddleware,
  // Individual Middleware
  createLoggerMiddleware,
  createCorsMiddleware,
  createCompressionMiddleware,
  createStaticMiddleware,
  createHMRMiddleware,
} from './middleware/index.js';
