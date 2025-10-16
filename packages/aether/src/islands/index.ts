/**
 * Islands Architecture
 *
 * Exports for the Islands Architecture implementation
 */

// Types
export type {
  HydrationStrategy,
  IslandOptions,
  IslandComponent,
  InteractivityDetection,
  InteractivitySignal,
  IslandManifestEntry,
  IslandManifest,
  ServerComponent,
  ClientComponent,
  HydrationState,
  IslandInstance,
  IslandBoundary,
  HydrateOnOptions,
  ServerContext,
  IslandDetectionConfig,
  IslandRenderResult,
} from './types.js';

// Directives and helpers
export {
  island,
  hydrateOn,
  ClientOnly,
  ServerOnly,
  lazyIsland,
  islandBoundary,
  PreloadHint,
  staticHint,
  isStaticComponent,
  priorityHint,
  defer,
  conditionalIsland,
  mediaIsland,
  viewportIsland,
  interactionIsland,
  idleIsland,
} from './directives.js';

// Detection
export {
  detectInteractivity,
  analyzeComponentTree,
  getIslandComponents,
  estimateComponentSize,
  isIslandComponent,
  isServerComponent,
  isClientComponent,
  getComponentMetadata,
} from './detector.js';

// Server components
export {
  serverOnly,
  clientOnly,
  isSSR,
  isBrowser,
  useServerContext,
  useRequestURL,
  useHeaders,
  useCookies,
  useSession,
  asyncServerComponent,
  serverFetch,
  server,
  serializeData,
  deserializeData,
  createServerContextFromRequest,
  isAsyncComponent,
  renderServerComponent,
  setServerContext,
  getServerContext,
  clearServerContext,
} from './server-components.js';

// Manifest
export {
  registerIsland,
  registerRouteIsland,
  generateManifest,
  loadManifest,
  getRouteIslands,
  getIslandEntry,
  getIslandsByStrategy,
  calculateRouteSize,
  optimizeManifest,
  generatePreloadHints,
  generateIslandLoader,
  IslandDependencyGraph,
  buildDependencyGraph,
  validateManifest,
} from './manifest.js';

// Rendering
export {
  renderToStringWithIslands,
  renderDocumentWithIslands,
  extractIslandsFromHTML,
  resetIslandIdCounter,
} from './renderer.js';

// Client hydration
export {
  registerClientIsland,
  loadIslandManifest,
  hydrateIslands,
  getIsland,
  getAllIslands,
  hydrateIsland,
  cleanupIsland,
  cleanupAllIslands,
  isIslandHydrated,
  waitForIslandHydration,
  autoInitIslands,
  getIslandStats,
  type IslandStats,
} from './client.js';

// Hydration strategies
export {
  createHydrationStrategy,
  preloadIsland,
  setupPreloadOnIntent,
  setupPreloadOnViewport,
  ImmediateHydration,
  VisibleHydration,
  InteractionHydration,
  IdleHydration,
  MediaHydration,
  CustomHydration,
  type HydrationStrategyImpl,
} from './hydration.js';

// Module integration
export {
  ModuleIslandManager,
  IslandLifecycleManager,
  createModuleIslandManager,
  getModuleIslandManager,
  setModuleIslandManager,
  resetModuleIslandManager,
  useIslandHydration,
} from './module-integration.js';
export type { ModuleIslandDefinition, IslandHydrationContext } from './module-integration.js';
