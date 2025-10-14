/**
 * SSR (Server-Side Rendering) Module
 *
 * Complete SSR support for Aether SVG system including:
 * - Server-side rendering to string/stream
 * - Client-side hydration with multiple strategies
 * - Sprite generation for SSR
 * - SSR utilities and helpers
 */

// Export SSR utilities
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
} from './utils.js';

// Export server rendering
export {
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
} from './render.js';

// Export hydration
export {
  // Hydration functions
  hydrateSVG,
  hydrateAll,

  // Hydration utilities
  isHydrated,
  getHydrationData,
  dehydrate,

  // Types
  type HydrationConfig,
  type HydrationStrategy,
  type HydrationError,
  type HydrationResult,
} from './hydrate.js';

// Export sprite generation
export {
  // Sprite generation
  generateStaticSprite,
  generateSpriteFromRegistry,
  generateInlineSprite,
  splitSprite,

  // Sprite utilities
  generateSpritePreloadLinks,
  createSpriteReference,
  generateSpriteUsageExample,

  // Types
  type SpriteConfig,
  type SpriteManifest,
  type GeneratedSprite,
} from './sprite.js';

/**
 * Default SSR configuration for production use
 */
export const defaultSSRConfig = {
  renderToString: true,
  inlineStyles: false,
  inlineData: false,
  minify: true,
  preloadSprites: true,
  addHydrationMarkers: true,
  pretty: false,
} as const;

/**
 * Default hydration configuration for optimal performance
 */
export const defaultHydrationConfig = {
  strategy: 'idle' as const,
  preserveAttributes: true,
  preserveEvents: true,
  preserveAnimations: true,
  validateStructure: true,
  idleTimeout: 2000,
};

/**
 * Default sprite configuration for optimal file size
 */
export const defaultSpriteConfig = {
  removeColors: false,
  removeStyles: false,
  cleanupIds: true,
  removeDuplicates: true,
  compress: true,
  symbolIdPrefix: 'icon-',
  defaultViewBox: '0 0 24 24',
  defaultPreserveAspectRatio: 'xMidYMid meet',
} as const;
