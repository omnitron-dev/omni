/**
 * SVG Optimization Module
 *
 * Provides performance optimization utilities for SVG rendering and loading:
 * - Caching: In-memory and persistent storage caching with LRU eviction
 * - Compression: SVG optimization and binary compression
 * - Lazy Loading: IntersectionObserver-based lazy loading with placeholders
 * - Sprite Generation: Combine multiple SVGs into optimized sprite sheets
 *
 * @module svg/optimization
 */

// Cache system
export {
  SVGCache,
  type SVGCacheConfig,
  type CacheStats,
} from './cache.js';

// Import for local use
import { SVGCache } from './cache.js';
import { optimizeSVG, type SVGOptimizerConfig } from './compress.js';

// Compression and optimization
export {
  compressSVG,
  decompressSVG,
} from './compress.js';

// Re-export for backward compatibility
export { compressSVG as optimizeSVGToData } from './compress.js';

// Re-export optimizeSVG
export { optimizeSVG, type SVGOptimizerConfig } from './compress.js';

// Lazy loading
export {
  LazySVG,
  useLazyLoad,
  type LazyLoadConfig,
  type LazySVGProps,
  type UseLazyLoadReturn,
} from './lazy.js'; // .tsx compiles to .js

// Sprite generation
export {
  generateSprite,
  extractFromSprite,
  loadSprite,
  clearSpriteCache,
  parseSpriteManifest,
  type SpriteGeneratorConfig,
  type SpriteManifest,
  type GeneratedSprite,
} from './sprite.js';

/**
 * Global SVG cache instance
 *
 * Provides a singleton cache for SVG elements that can be used across the application.
 *
 * @example
 * ```typescript
 * import { globalSVGCache } from '@omnitron-dev/aether/svg/optimization';
 *
 * // Store SVG
 * globalSVGCache.set('icon-home', svgElement);
 *
 * // Retrieve SVG
 * const svg = globalSVGCache.get('icon-home');
 * ```
 */
export const globalSVGCache = new SVGCache({
  strategy: 'hybrid',
  maxSize: 5 * 1024 * 1024, // 5MB
  maxAge: 3600000, // 1 hour
  storage: 'sessionStorage',
  storageKey: 'aether-svg-global-cache',
});

/**
 * Preload SVGs from URLs
 *
 * Fetches and caches multiple SVG files in parallel for faster subsequent access.
 *
 * @param urls - Array of SVG URLs to preload
 * @param cache - Optional cache instance (defaults to global cache)
 * @returns Promise that resolves when all SVGs are loaded
 *
 * @example
 * ```typescript
 * import { preloadSVGs } from '@omnitron-dev/aether/svg/optimization';
 *
 * // Preload critical icons
 * await preloadSVGs([
 *   '/icons/home.svg',
 *   '/icons/menu.svg',
 *   '/icons/user.svg',
 * ]);
 * ```
 */
export async function preloadSVGs(urls: string[], cache?: SVGCache): Promise<void> {
  const targetCache = cache ?? globalSVGCache;

  const loadPromises = urls.map(async (url) => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`Failed to preload SVG from ${url}: ${response.statusText}`);
        return;
      }

      const svgText = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, 'image/svg+xml');
      const svgElement = doc.documentElement as unknown as SVGElement;

      if (svgElement.tagName === 'svg') {
        targetCache.set(url, svgElement);
      }
    } catch (error) {
      console.warn(`Failed to preload SVG from ${url}:`, error);
    }
  });

  await Promise.all(loadPromises);
}

/**
 * Create optimized SVG data URL
 *
 * Optimizes and converts SVG to a data URL for inline use.
 *
 * @param svg - SVG string to convert
 * @param optimize - Whether to optimize the SVG (default: true)
 * @returns Data URL string
 *
 * @example
 * ```typescript
 * import { createSVGDataURL } from '@omnitron-dev/aether/svg/optimization';
 *
 * const dataUrl = createSVGDataURL('<svg>...</svg>');
 * // data:image/svg+xml;base64,...
 * ```
 */
export function createSVGDataURL(svg: string, optimize: boolean = true): string {
  let processed = svg;

  if (optimize) {
    processed = optimizeSVG(svg, {
      removeComments: true,
      removeMetadata: true,
      cleanupIds: true,
      convertColors: true,
      floatPrecision: 2,
    });
  }

  // Encode for data URL
  const base64 = btoa(unescape(encodeURIComponent(processed)));
  return `data:image/svg+xml;base64,${base64}`;
}

/**
 * Batch optimize SVGs
 *
 * Optimizes multiple SVG strings in parallel.
 *
 * @param svgs - Array of SVG strings to optimize
 * @param config - Optimization configuration
 * @returns Promise resolving to array of optimized SVGs
 *
 * @example
 * ```typescript
 * import { batchOptimizeSVGs } from '@omnitron-dev/aether/svg/optimization';
 *
 * const optimized = await batchOptimizeSVGs([svg1, svg2, svg3], {
 *   floatPrecision: 2,
 *   removeComments: true,
 * });
 * ```
 */
export async function batchOptimizeSVGs(
  svgs: string[],
  config?: SVGOptimizerConfig
): Promise<string[]> {
  // Process in chunks to avoid blocking
  const CHUNK_SIZE = 10;
  const results: string[] = [];

  for (let i = 0; i < svgs.length; i += CHUNK_SIZE) {
    const chunk = svgs.slice(i, i + CHUNK_SIZE);
    const optimized = await Promise.all(
      chunk.map(async (svg) => {
        // Use setTimeout to yield to the event loop
        await new Promise((resolve) => setTimeout(resolve, 0));
        return optimizeSVG(svg, config);
      })
    );
    results.push(...optimized);
  }

  return results;
}

/**
 * Get optimization statistics
 *
 * Calculates size reduction and compression ratio for optimized SVG.
 *
 * @param original - Original SVG string
 * @param optimized - Optimized SVG string
 * @returns Statistics object
 *
 * @example
 * ```typescript
 * import { getOptimizationStats } from '@omnitron-dev/aether/svg/optimization';
 *
 * const stats = getOptimizationStats(originalSVG, optimizedSVG);
 * console.log(`Reduced by ${stats.reductionPercent}%`);
 * ```
 */
export function getOptimizationStats(
  original: string,
  optimized: string
): {
  originalSize: number;
  optimizedSize: number;
  reduction: number;
  reductionPercent: number;
  compressionRatio: number;
} {
  const originalSize = new Blob([original]).size;
  const optimizedSize = new Blob([optimized]).size;
  const reduction = originalSize - optimizedSize;
  const reductionPercent = (reduction / originalSize) * 100;
  const compressionRatio = originalSize / optimizedSize;

  return {
    originalSize,
    optimizedSize,
    reduction,
    reductionPercent,
    compressionRatio,
  };
}
