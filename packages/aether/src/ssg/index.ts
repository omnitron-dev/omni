/**
 * Static Site Generation Module
 *
 * Complete SSG system for Aether
 */

// Types
export type {
  StaticPropsContext,
  StaticPropsResult,
  StaticPathsContext,
  StaticPath,
  FallbackBehavior,
  StaticPathsResult,
  GetStaticProps,
  GetStaticPaths,
  StaticPageMeta,
  GeneratedPage,
  SSGConfig,
  SitemapConfig,
  RobotsConfig,
  AssetOptimizationConfig,
  CSSConfig,
  CDNConfig,
  HeadersConfig,
  SSGPlugin,
  RevalidationCacheEntry,
  RevalidationOptions,
  BuildStats,
  RenderStrategy,
  SSGRoute,
  BuildContext,
} from './types.js';

// Static Props
export {
  executeStaticProps,
  createStaticPropsContext,
  mergeStaticProps,
  combineStaticProps,
  cacheStaticProps,
  validateStaticPropsResult,
  createStaticPropsResult,
  notFound,
  redirect,
} from './static-props.js';

// Static Paths
export {
  executeStaticPaths,
  createStaticPathsContext,
  normalizePathParams,
  createStaticPath,
  validateStaticPathsResult,
  patternToPath,
  extractParamNames,
  isDynamicRoute,
  generateParamCombinations,
  batchStaticPaths,
  filterPathsByLocale,
  deduplicatePaths,
  createStaticPathsResult,
} from './static-paths.js';

// Renderer
export {
  renderRoute,
  renderComponent,
  renderJSX,
  renderHTMLElement,
  buildAttributes,
  getAttributeName,
  buildStyleString,
  isSelfClosing,
  escapeHTML,
  generateDocument,
  buildMetaTags,
  generate404Page,
  optimizeHTML,
} from './renderer.js';

// Revalidation
export {
  RevalidationCache,
  getRevalidationCache,
  needsRevalidation,
  isStale,
  isExpired,
  revalidatePath,
  revalidateTag,
  revalidateInBackground,
  createRevalidationHandler,
  cleanupExpiredEntries,
  scheduleCleanup,
  getCacheStats,
  preloadCache,
  exportCache,
  importCache,
} from './revalidation.js';

// Hybrid Rendering
export {
  determineRenderStrategy,
  canPrerender,
  needsRuntimeRendering,
  hasISR,
  splitRoutesByStrategy,
  analyzeHybridRendering,
  extractPartialSections,
  determineHydrationStrategy,
  generateHydrationScript,
  buildHybridManifest,
  optimizeRouteForStrategy,
  validateHybridConfig,
  generateBuildReport,
} from './hybrid.js';
export type { HybridPageInfo, PartialPrerenderConfig, HydrationStrategy } from './hybrid.js';

// Configuration
export {
  defaultSSGConfig,
  mergeSSGConfig,
  validateSSGConfig,
  generateSitemap,
  generateRobotsTxt,
  resolveConfig,
  createSSGConfig,
} from './config.js';

// Build Pipeline
export { buildStaticSite, exportBuild } from './build.js';
