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
