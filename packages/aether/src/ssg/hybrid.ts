/**
 * Hybrid Rendering Support
 *
 * Mix SSG, SSR, and CSR strategies per route
 */

import type { RenderStrategy, SSGRoute, GeneratedPage } from './types.js';

/**
 * Determine render strategy for a route
 *
 * @param route - Route to analyze
 * @returns Render strategy
 */
export function determineRenderStrategy(route: SSGRoute): RenderStrategy {
  // Explicit strategy takes precedence
  if (route.strategy) {
    return route.strategy;
  }

  // Has getStaticProps -> SSG
  if (route.getStaticProps) {
    return 'ssg';
  }

  // Has loader -> SSR
  if (route.loader) {
    return 'ssr';
  }

  // Default to CSR
  return 'csr';
}

/**
 * Check if route can be prerendered
 *
 * @param route - Route to check
 * @returns True if route can be prerendered
 */
export function canPrerender(route: SSGRoute): boolean {
  const strategy = determineRenderStrategy(route);
  return strategy === 'ssg' || strategy === 'isr';
}

/**
 * Check if route needs runtime rendering
 *
 * @param route - Route to check
 * @returns True if route needs runtime rendering
 */
export function needsRuntimeRendering(route: SSGRoute): boolean {
  const strategy = determineRenderStrategy(route);
  return strategy === 'ssr' || strategy === 'csr';
}

/**
 * Check if route has ISR configured
 *
 * @param route - Route to check
 * @returns True if route has ISR
 */
export function hasISR(route: SSGRoute): boolean {
  return route.strategy === 'isr' || (route.getStaticProps !== undefined && route.strategy === 'ssg');
}

/**
 * Split routes by strategy
 *
 * @param routes - Routes to split
 * @returns Routes grouped by strategy
 */
export function splitRoutesByStrategy(routes: SSGRoute[]): {
  ssg: SSGRoute[];
  isr: SSGRoute[];
  ssr: SSGRoute[];
  csr: SSGRoute[];
} {
  const result = {
    ssg: [] as SSGRoute[],
    isr: [] as SSGRoute[],
    ssr: [] as SSGRoute[],
    csr: [] as SSGRoute[],
  };

  for (const route of routes) {
    const strategy = determineRenderStrategy(route);
    result[strategy].push(route);
  }

  return result;
}

/**
 * Hybrid page info
 */
export interface HybridPageInfo {
  /**
   * Page path
   */
  path: string;

  /**
   * Render strategy
   */
  strategy: RenderStrategy;

  /**
   * Whether page is prerendered
   */
  prerendered: boolean;

  /**
   * Whether page has ISR
   */
  hasISR: boolean;

  /**
   * Revalidate time (if ISR)
   */
  revalidate?: number | false;

  /**
   * Generated page (if prerendered)
   */
  page?: GeneratedPage;
}

/**
 * Analyze hybrid rendering setup
 *
 * Provides info about how each route will be rendered
 *
 * @param routes - Routes to analyze
 * @param pages - Generated pages
 * @returns Array of page info
 */
export function analyzeHybridRendering(routes: SSGRoute[], pages: Map<string, GeneratedPage>): HybridPageInfo[] {
  const info: HybridPageInfo[] = [];

  for (const route of routes) {
    const strategy = determineRenderStrategy(route);
    const page = pages.get(route.path);

    info.push({
      path: route.path,
      strategy,
      prerendered: canPrerender(route) && !!page,
      hasISR: hasISR(route),
      revalidate: page?.revalidate,
      page,
    });
  }

  return info;
}

/**
 * Partial prerendering configuration
 */
export interface PartialPrerenderConfig {
  /**
   * Sections to prerender (static)
   */
  static: string[];

  /**
   * Sections to render at runtime (dynamic)
   */
  dynamic: string[];
}

/**
 * Extract partial prerendering sections
 *
 * Identifies which parts of a page can be static vs dynamic
 *
 * @param component - Component to analyze
 * @returns Partial prerender config
 */
export function extractPartialSections(component: any): PartialPrerenderConfig {
  // This is a simplified implementation
  // In a real implementation, this would analyze the component tree
  // and identify Suspense boundaries and dynamic sections

  return {
    static: [],
    dynamic: [],
  };
}

/**
 * Client hydration strategy
 */
export type HydrationStrategy = 'full' | 'partial' | 'progressive' | 'none';

/**
 * Determine hydration strategy
 *
 * @param route - Route to analyze
 * @returns Hydration strategy
 */
export function determineHydrationStrategy(route: SSGRoute): HydrationStrategy {
  const strategy = determineRenderStrategy(route);

  // SSG/ISR pages need full hydration
  if (strategy === 'ssg' || strategy === 'isr') {
    return 'full';
  }

  // SSR pages can use partial hydration
  if (strategy === 'ssr') {
    return 'partial';
  }

  // CSR pages don't need hydration (client-side only)
  return 'none';
}

/**
 * Generate hydration script
 *
 * Creates the script needed to hydrate the page on the client
 *
 * @param strategy - Hydration strategy
 * @param data - Hydration data
 * @returns Hydration script
 */
export function generateHydrationScript(strategy: HydrationStrategy, data?: any): string {
  if (strategy === 'none') {
    return '';
  }

  const dataScript = data ? `window.__AETHER_HYDRATION__=${JSON.stringify(data)};` : '';

  return `<script>
${dataScript}
window.__AETHER_HYDRATION_STRATEGY__='${strategy}';
</script>`;
}

/**
 * Build manifest for hybrid rendering
 *
 * Creates a manifest that describes the rendering strategy for each route
 *
 * @param routes - Routes to include in manifest
 * @param pages - Generated pages
 * @returns Manifest object
 */
export function buildHybridManifest(
  routes: SSGRoute[],
  pages: Map<string, GeneratedPage>,
): {
  routes: Record<
    string,
    {
      strategy: RenderStrategy;
      prerendered: boolean;
      hasISR: boolean;
      revalidate?: number | false;
      hydration: HydrationStrategy;
    }
  >;
  stats: {
    total: number;
    ssg: number;
    isr: number;
    ssr: number;
    csr: number;
  };
} {
  const routeInfo: Record<string, any> = {};
  const stats = {
    total: routes.length,
    ssg: 0,
    isr: 0,
    ssr: 0,
    csr: 0,
  };

  for (const route of routes) {
    const strategy = determineRenderStrategy(route);
    const page = pages.get(route.path);
    const hydration = determineHydrationStrategy(route);

    routeInfo[route.path] = {
      strategy,
      prerendered: canPrerender(route) && !!page,
      hasISR: hasISR(route),
      revalidate: page?.revalidate,
      hydration,
    };

    stats[strategy]++;
  }

  return { routes: routeInfo, stats };
}

/**
 * Optimize route for rendering strategy
 *
 * Applies optimizations based on the rendering strategy
 *
 * @param route - Route to optimize
 * @param strategy - Rendering strategy
 * @returns Optimized route
 */
export function optimizeRouteForStrategy(route: SSGRoute, strategy: RenderStrategy): SSGRoute {
  const optimized = { ...route };

  switch (strategy) {
    case 'ssg':
    case 'isr':
      // For static routes, we can remove runtime dependencies
      // Keep getStaticProps but remove loader
      if (optimized.loader) {
        console.warn(`Route ${route.path} has both getStaticProps and loader. Using getStaticProps (SSG).`);
      }
      delete optimized.loader;
      break;

    case 'ssr':
      // For SSR routes, remove static generation
      delete optimized.getStaticProps;
      delete optimized.getStaticPaths;
      break;

    case 'csr':
      // For CSR routes, remove all server-side generation
      delete optimized.getStaticProps;
      delete optimized.getStaticPaths;
      delete optimized.loader;
      break;
  }

  return optimized;
}

/**
 * Validate hybrid rendering configuration
 *
 * Checks for common issues with hybrid rendering setup
 *
 * @param routes - Routes to validate
 * @returns Validation warnings
 */
export function validateHybridConfig(routes: SSGRoute[]): string[] {
  const warnings: string[] = [];

  for (const route of routes) {
    const strategy = determineRenderStrategy(route);

    // Check for conflicting configurations
    if (route.getStaticProps && route.loader) {
      warnings.push(`Route ${route.path} has both getStaticProps and loader. Using ${strategy} strategy.`);
    }

    // Check for missing components
    if (!route.component) {
      warnings.push(`Route ${route.path} is missing a component.`);
    }

    // Check for ISR without revalidate
    if (strategy === 'isr' && !route.getStaticProps) {
      warnings.push(`Route ${route.path} is marked as ISR but has no getStaticProps.`);
    }

    // Check for dynamic routes without getStaticPaths
    if (strategy === 'ssg' && /\[[\w.]+\]/.test(route.path) && !route.getStaticPaths) {
      warnings.push(`Dynamic route ${route.path} is marked as SSG but has no getStaticPaths.`);
    }
  }

  return warnings;
}

/**
 * Generate build report
 *
 * Creates a detailed report of the hybrid rendering build
 *
 * @param routes - Routes included in build
 * @param pages - Generated pages
 * @returns Build report
 */
export function generateBuildReport(
  routes: SSGRoute[],
  pages: Map<string, GeneratedPage>,
): {
  summary: string;
  details: HybridPageInfo[];
  manifest: ReturnType<typeof buildHybridManifest>;
  warnings: string[];
} {
  const details = analyzeHybridRendering(routes, pages);
  const manifest = buildHybridManifest(routes, pages);
  const warnings = validateHybridConfig(routes);

  const summary = `
Hybrid Rendering Build Report
==============================
Total Routes: ${manifest.stats.total}
- SSG: ${manifest.stats.ssg} routes
- ISR: ${manifest.stats.isr} routes
- SSR: ${manifest.stats.ssr} routes
- CSR: ${manifest.stats.csr} routes

Prerendered Pages: ${details.filter((d) => d.prerendered).length}
Pages with ISR: ${details.filter((d) => d.hasISR).length}

${warnings.length > 0 ? `\nWarnings: ${warnings.length}\n${warnings.map((w) => `- ${w}`).join('\n')}` : ''}
  `.trim();

  return {
    summary,
    details,
    manifest,
    warnings,
  };
}
