/**
 * Aether SVG Module
 *
 * Complete SVG system with primitives, components, animations, and icons
 */

// Export all primitives
export * from './primitives/index.js';

// Export components
export * from './components/index.js';

// Export icon registry
export {
  IconRegistry,
  getIconRegistry,
  resetIconRegistry,
  type IconDefinition,
  type IconSource,
  type IconSet,
  type IconTransformer,
} from './icons/IconRegistry.js';

// Export icon provider
export {
  IconProvider,
  useIcons,
  useIconDefaults,
  useIconFallback,
  useIconContext,
  type IconProviderProps,
  type IconContextValue,
} from './icons/IconProvider.js';

// Export icon set utilities
export {
  loadIconSet,
  createIconSet,
  mergeIconSets,
  filterIconSet,
  transformIconSet,
  getIconSetMetadata,
  validateIconSet,
  iconSets,
  type IconSetConfig,
  type IconSetLoader,
} from './icons/presets/index.js';

// Export optimization utilities
export {
  SVGCache,
  type SVGCacheConfig,
  type CacheStats,
  compressSVG,
  decompressSVG,
  optimizeSVGToData,
  optimizeSVG,
  type SVGOptimizerConfig,
  LazySVG,
  useLazyLoad,
  type LazyLoadConfig,
  type LazySVGProps,
  type UseLazyLoadReturn,
  generateSprite,
  extractFromSprite,
  loadSprite,
  clearSpriteCache,
  parseSpriteManifest,
  type SpriteGeneratorConfig,
  globalSVGCache,
  preloadSVGs,
  createSVGDataURL,
  batchOptimizeSVGs,
  getOptimizationStats,
} from './optimization/index.js';

// Export sprite types from optimization (client-side sprites)
export type {
  SpriteManifest as ClientSpriteManifest,
  GeneratedSprite as ClientGeneratedSprite,
} from './optimization/index.js';

// Export animation system
export * from './animations/index.js';

// Export accessibility features
export * from './accessibility/index.js';

// Export all SSR utilities (comprehensive SSR support)
export {
  // Environment detection
  isServer,
  isBrowser,
  canUseDOM,
  isCriticalPath,
  // HTML utilities
  escapeHtml,
  minifySVG,
  isValidSVG,
  extractAttributes,
  extractDataAttributes,
  extractCriticalCSS,
  // Style utilities
  serializeStyles,
  parseStyles,
  // Prop serialization
  serializeProps,
  // Hydration utilities
  wrapWithHydrationMarker,
  generateHydrationHints,
  // Preload utilities
  injectPreloadLinks,
  // ID generation
  generateSSRId,
  // SSR-safe browser APIs
  createSSRIntersectionObserver,
  createSSRRequestAnimationFrame,
  createSSRRequestIdleCallback,
  // Core rendering
  renderSVGToString,
  renderSVGBatch,
  createServerSVG,
  // Streaming rendering
  renderSVGToStream,
  renderSVGBatchStream,
  // Enhanced rendering
  renderSVGWithCriticalCSS,
  renderSVGWithSignals,
  renderSVGWithHydration,
  renderSVGIsland,
  // Style collection
  collectSVGStyles,
  // Types
  type SSRConfig,
  type StreamConfig,
  // Hydration functions
  hydrateSVG,
  hydrateAll,
  // Hydration utilities
  isHydrated,
  getHydrationData,
  dehydrate,
  // Hydration types
  type HydrationConfig,
  type HydrationStrategy,
  type HydrationError,
  type HydrationResult,
  // Sprite generation (SSR sprites)
  generateStaticSprite,
  generateSpriteFromRegistry,
  generateInlineSprite,
  splitSprite,
  // Sprite utilities
  generateSpritePreloadLinks,
  createSpriteReference,
  generateSpriteUsageExample,
  // Sprite types (SSR sprites)
  type SpriteConfig,
  type SpriteManifest as SSRSpriteManifest,
  type GeneratedSprite as SSRGeneratedSprite,
  // Default configs
  defaultSSRConfig,
  defaultHydrationConfig,
  defaultSpriteConfig,
} from './ssr/index.js';