/**
 * SSG Renderer with Islands Support
 *
 * Enhanced SSG renderer that supports islands architecture
 */

import { renderToStringWithIslands } from '../islands/renderer.js';
import { generatePreloadHints, generateIslandLoader } from '../islands/manifest.js';
import type { GeneratedPage, StaticPageMeta, SSGRoute } from './types.js';
import type { IslandManifest } from '../islands/types.js';
import { escapeHTML } from './renderer.js';

/**
 * Render a route to static HTML with islands
 *
 * @param route - Route to render
 * @param props - Props to pass to component
 * @param options - Rendering options
 * @returns Generated page with islands
 */
export async function renderRouteWithIslands(
  route: SSGRoute,
  props: any,
  options: {
    path: string;
    revalidate?: number | false;
    staleWhileRevalidate?: number;
    tags?: string[];
    meta?: StaticPageMeta;
    jsonLd?: Record<string, any>;
    manifest?: IslandManifest;
  }
): Promise<GeneratedPage & { islands: any[] }> {
  const { path, revalidate, staleWhileRevalidate, tags, meta, jsonLd, manifest } = options;

  try {
    // Render component with islands
    const result = renderToStringWithIslands(route.component, props, {
      routePath: path,
      manifest,
    });

    return {
      path,
      html: result.html,
      props,
      revalidate,
      staleWhileRevalidate,
      tags,
      meta,
      jsonLd,
      generatedAt: new Date(),
      islands: result.islands,
    };
  } catch (error) {
    throw new Error(
      `Error rendering route ${path} with islands: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Generate complete HTML document with islands
 *
 * @param page - Generated page
 * @param options - Document options
 * @returns Complete HTML document
 */
export function generateDocumentWithIslands(
  page: GeneratedPage & { islands: any[] },
  options: {
    base?: string;
    scripts?: string[];
    styles?: string[];
    manifest?: IslandManifest;
  } = {}
): string {
  const { base = '/', scripts = [], styles = [], manifest } = options;

  const title = page.meta?.title || 'Aether App';
  const description = page.meta?.description || '';

  // Build meta tags
  const metaTags = buildMetaTags(page.meta);

  // Build JSON-LD
  const jsonLdScript = page.jsonLd
    ? `<script type="application/ld+json">${JSON.stringify(page.jsonLd, null, 2)}</script>`
    : '';

  // Generate island preload hints
  const preloadHints = manifest ? generatePreloadHints(manifest, page.path) : '';

  // Generate island loader
  const islandLoader = manifest && page.islands.length > 0 ? generateIslandLoader(manifest, page.path) : '';

  // Build SSG data script
  const ssgDataScript = `
<script>
  window.__AETHER_SSG__ = ${JSON.stringify({
    path: page.path,
    props: page.props,
    generatedAt: page.generatedAt.toISOString(),
  })};
  window.__AETHER_ISLANDS__ = ${JSON.stringify(
    page.islands.map((island) => ({
      id: island.id,
      name: island.name,
      strategy: island.strategy,
      props: island.props,
    }))
  )};
</script>
  `.trim();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(title)}</title>
  ${description ? `<meta name="description" content="${escapeHTML(description)}">` : ''}
  ${base !== '/' ? `<base href="${escapeHTML(base)}">` : ''}
  ${metaTags}
  ${preloadHints}
  ${styles.map((style) => `<link rel="stylesheet" href="${escapeHTML(style)}">`).join('\n  ')}
  ${jsonLdScript}
</head>
<body>
  <div id="app">${page.html}</div>
  ${ssgDataScript}
  ${islandLoader ? `<script type="module">${islandLoader}</script>` : ''}
  ${scripts.map((script) => `<script type="module" src="${escapeHTML(script)}"></script>`).join('\n  ')}
</body>
</html>`;
}

/**
 * Build meta tags from meta object
 */
function buildMetaTags(meta?: StaticPageMeta): string {
  if (!meta) {
    return '';
  }

  const tags: string[] = [];

  // Canonical URL
  if (meta.canonical) {
    tags.push(`<link rel="canonical" href="${escapeHTML(meta.canonical)}">`);
  }

  // OpenGraph
  if (meta.ogTitle) {
    tags.push(`<meta property="og:title" content="${escapeHTML(meta.ogTitle)}">`);
  }
  if (meta.ogDescription) {
    tags.push(`<meta property="og:description" content="${escapeHTML(meta.ogDescription)}">`);
  }
  if (meta.ogImage) {
    tags.push(`<meta property="og:image" content="${escapeHTML(meta.ogImage)}">`);
  }
  if (meta.ogType) {
    tags.push(`<meta property="og:type" content="${escapeHTML(meta.ogType)}">`);
  }

  // Twitter Card
  if (meta.twitterCard) {
    tags.push(`<meta name="twitter:card" content="${escapeHTML(meta.twitterCard)}">`);
  }

  return tags.join('\n  ');
}

/**
 * Optimize islands for static generation
 *
 * Analyzes islands and provides optimization recommendations
 *
 * @param islands - Islands found in the page
 * @returns Optimization recommendations
 */
export function analyzeIslandsForSSG(islands: any[]): {
  totalSize: number;
  criticalIslands: any[];
  deferredIslands: any[];
  recommendations: string[];
} {
  const criticalIslands = islands.filter((island) => island.strategy === 'immediate');
  const deferredIslands = islands.filter((island) => island.strategy !== 'immediate');

  const totalSize = islands.reduce((sum, island) => sum + (island.size || 0), 0);

  const recommendations: string[] = [];

  // Recommend deferring large islands
  for (const island of criticalIslands) {
    if (island.size && island.size > 50000) {
      recommendations.push(
        `Island "${island.name}" is ${Math.round(island.size / 1024)}KB and uses immediate hydration. Consider deferring to 'idle' or 'visible'.`
      );
    }
  }

  // Warn about too many islands
  if (islands.length > 10) {
    recommendations.push(
      `Page has ${islands.length} islands. Consider combining related islands or making some components static.`
    );
  }

  // Warn about total size
  if (totalSize > 100000) {
    recommendations.push(
      `Total island size is ${Math.round(totalSize / 1024)}KB. Consider code splitting or lazy loading.`
    );
  }

  return {
    totalSize,
    criticalIslands,
    deferredIslands,
    recommendations,
  };
}

/**
 * Calculate performance metrics for SSG page with islands
 *
 * @param page - Generated page
 * @param manifest - Island manifest
 * @returns Performance metrics
 */
export function calculateSSGPerformanceMetrics(
  page: GeneratedPage & { islands: any[] },
  manifest?: IslandManifest
): {
  htmlSize: number;
  criticalJsSize: number;
  deferredJsSize: number;
  islandCount: number;
  estimatedTTI: number;
  estimatedFCP: number;
} {
  const htmlSize = Buffer.byteLength(page.html, 'utf8');

  let criticalJsSize = 5000; // Base runtime
  let deferredJsSize = 0;

  for (const island of page.islands) {
    const entry = manifest?.islands[island.id];
    const size = entry?.size || 5000; // Estimate if not in manifest

    if (island.strategy === 'immediate') {
      criticalJsSize += size;
    } else {
      deferredJsSize += size;
    }
  }

  // Estimate metrics (simplified)
  const estimatedFCP = 500 + htmlSize / 1000; // Very rough estimate
  const estimatedTTI = estimatedFCP + criticalJsSize / 100; // Very rough estimate

  return {
    htmlSize,
    criticalJsSize,
    deferredJsSize,
    islandCount: page.islands.length,
    estimatedTTI: Math.round(estimatedTTI),
    estimatedFCP: Math.round(estimatedFCP),
  };
}
