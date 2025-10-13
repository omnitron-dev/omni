/**
 * Static Site Generation (SSG)
 *
 * Pre-render routes at build time for optimal performance:
 * - Generate static HTML files
 * - Support dynamic routes with getStaticPaths
 * - Incremental Static Regeneration (ISR)
 * - Parallel rendering with concurrency control
 * - Asset optimization
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  SSGOptions,
  StaticPathsResult,
  StaticPropsResult,
} from './types.js';
import { renderToString } from './ssr.js';
import { renderDocument } from './renderer.js';

/**
 * ISR cache entry
 */
interface ISRCacheEntry {
  html: string;
  data?: Record<string, any>;
  timestamp: number;
  revalidate?: number;
}

/**
 * ISR cache
 */
const isrCache = new Map<string, ISRCacheEntry>();

/**
 * Generate static site from routes
 *
 * Pre-renders all specified routes to static HTML files.
 * Supports parallel rendering and ISR.
 *
 * @param routeComponent - Component to render for routes
 * @param options - SSG options
 *
 * @example
 * ```typescript
 * await generateStaticSite(App, {
 *   routes: ['/', '/about', '/blog/post-1'],
 *   outDir: './dist',
 *   base: '/',
 *   parallel: 10,
 *   isr: true,
 *   revalidate: 60
 * });
 * ```
 */
export async function generateStaticSite(
  routeComponent: any,
  options: SSGOptions
): Promise<void> {
  const {
    routes: routesInput,
    outDir,
    base = '/',
    parallel = 10,
    isr = false,
    revalidate,
    fallback = false,
  } = options;

  // Resolve routes
  const routes = typeof routesInput === 'function' ? await routesInput() : routesInput;

  console.log(`📦 Generating static site (${routes.length} routes)...`);

  // Ensure output directory exists
  await ensureDir(outDir);

  // Generate routes in parallel batches
  const results: Array<{ route: string; success: boolean; error?: Error }> = [];

  for (let i = 0; i < routes.length; i += parallel) {
    const batch = routes.slice(i, i + parallel);

    const batchResults = await Promise.all(
      batch.map(async (route) => {
        try {
          await generateRoute(routeComponent, route, outDir, base, {
            isr,
            revalidate,
          });

          console.log(`  ✓ ${route}`);

          return { route, success: true };
        } catch (error) {
          console.error(`  ✗ ${route}:`, error);
          return { route, success: false, error: error as Error };
        }
      })
    );

    results.push(...batchResults);
  }

  // Summary
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`\n✓ Generated ${successful} pages`);
  if (failed > 0) {
    console.log(`✗ Failed ${failed} pages`);
  }

  // Generate 404 page if needed
  if (fallback === 'static') {
    await generate404Page(routeComponent, outDir, base);
  }
}

/**
 * Generate a single route
 */
async function generateRoute(
  component: any,
  route: string,
  outDir: string,
  _base: string,
  options: { isr?: boolean; revalidate?: number }
): Promise<void> {
  const { isr, revalidate } = options;

  // Render route
  const result = await renderToString(component, {
    url: route,
    collectStyles: true,
  });

  // Build HTML document
  const html = renderDocument(result.html, result.data, result.meta);

  // Determine file path
  const filePath = routeToFilePath(route, outDir);

  // Write HTML file
  await ensureDir(path.dirname(filePath));
  await fs.promises.writeFile(filePath, html, 'utf-8');

  // Cache for ISR
  if (isr) {
    isrCache.set(route, {
      html,
      data: result.data,
      timestamp: Date.now(),
      revalidate,
    });
  }
}

/**
 * Generate 404 page
 */
async function generate404Page(
  component: any,
  outDir: string,
  _base: string
): Promise<void> {
  try {
    const result = await renderToString(component, {
      url: '/404',
    });

    const html = renderDocument(result.html, result.data, {
      title: '404 - Page Not Found',
    });

    const filePath = path.join(outDir, '404.html');
    await fs.promises.writeFile(filePath, html, 'utf-8');

    console.log('  ✓ 404.html');
  } catch (error) {
    console.error('  ✗ Failed to generate 404 page:', error);
  }
}

/**
 * Get static paths for dynamic routes
 *
 * Returns paths that should be pre-rendered for a dynamic route.
 * Used with parameterized routes like /users/[id].
 *
 * @param getStaticPathsFn - Function that returns paths
 * @returns Static paths result
 *
 * @example
 * ```typescript
 * const paths = await getStaticPaths(async () => {
 *   const users = await fetchUsers();
 *   return {
 *     paths: users.map(u => `/users/${u.id}`),
 *     fallback: 'blocking'
 *   };
 * });
 * ```
 */
export async function getStaticPaths(
  getStaticPathsFn: () => Promise<StaticPathsResult>
): Promise<StaticPathsResult> {
  return await getStaticPathsFn();
}

/**
 * Get static props for a route
 *
 * Fetches data at build time for pre-rendering.
 *
 * @param getStaticPropsFn - Function that returns props
 * @param route - Route to fetch props for
 * @returns Static props result
 *
 * @example
 * ```typescript
 * const props = await getStaticProps(async ({ params }) => {
 *   const user = await fetchUser(params.id);
 *   return {
 *     props: { user },
 *     revalidate: 60 // ISR: revalidate every 60 seconds
 *   };
 * }, '/users/123');
 * ```
 */
export async function getStaticProps<T = any>(
  getStaticPropsFn: (context: { params: Record<string, string> }) => Promise<StaticPropsResult<T>>,
  route: string
): Promise<StaticPropsResult<T>> {
  const params = extractParamsFromRoute(route);
  return await getStaticPropsFn({ params });
}

/**
 * Revalidate a cached page (ISR)
 *
 * Checks if a page needs revalidation and regenerates if needed.
 *
 * @param route - Route to revalidate
 * @param component - Component to render
 * @param outDir - Output directory
 * @returns True if page was regenerated
 *
 * @example
 * ```typescript
 * const regenerated = await revalidate('/blog/post-1', BlogPost, './dist');
 * if (regenerated) {
 *   console.log('Page regenerated');
 * }
 * ```
 */
export async function revalidate(
  route: string,
  component: any,
  outDir: string
): Promise<boolean> {
  const cached = isrCache.get(route);

  if (!cached) {
    // Not cached, generate new
    await generateRoute(component, route, outDir, '/', { isr: true });
    return true;
  }

  // Check if revalidation is needed
  if (cached.revalidate) {
    const age = Date.now() - cached.timestamp;
    const maxAge = cached.revalidate * 1000;

    if (age > maxAge) {
      // Regenerate in background
      generateRoute(component, route, outDir, '/', {
        isr: true,
        revalidate: cached.revalidate,
      }).catch((error) => {
        console.error(`ISR revalidation failed for ${route}:`, error);
      });

      return true;
    }
  }

  return false;
}

/**
 * Convert route to file path
 */
function routeToFilePath(route: string, outDir: string): string {
  // Normalize route
  let normalized = route.replace(/^\/+/, '').replace(/\/+$/, '');

  // Index routes
  if (!normalized || normalized === 'index') {
    return path.join(outDir, 'index.html');
  }

  // Check if route ends with extension
  if (path.extname(normalized)) {
    return path.join(outDir, normalized);
  }

  // Add index.html for directory-style routes
  return path.join(outDir, normalized, 'index.html');
}

/**
 * Extract params from route
 */
function extractParamsFromRoute(route: string): Record<string, string> {
  const params: Record<string, string> = {};

  // Simple param extraction (would need more sophisticated parsing for real use)
  const segments = route.split('/').filter(Boolean);

  segments.forEach((segment) => {
    if (segment.startsWith('[') && segment.endsWith(']')) {
      const key = segment.slice(1, -1);
      // Would extract actual value from route
      params[key] = segment;
    }
  });

  return params;
}

/**
 * Ensure directory exists
 */
async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.promises.access(dir);
  } catch {
    await fs.promises.mkdir(dir, { recursive: true });
  }
}

/**
 * Generate static site with routes from file system
 *
 * Convenience function that discovers routes from file system.
 *
 * @param component - Root component
 * @param options - SSG options with routes as directory
 *
 * @example
 * ```typescript
 * await generateStaticSiteFromFiles(App, {
 *   routes: './src/pages',
 *   outDir: './dist',
 *   base: '/'
 * });
 * ```
 */
export async function generateStaticSiteFromFiles(
  component: any,
  options: Omit<SSGOptions, 'routes'> & { routes: string }
): Promise<void> {
  const { routes: pagesDir, ...restOptions } = options;

  // Discover routes from pages directory
  const routes = await discoverRoutes(pagesDir);

  // Generate site
  await generateStaticSite(component, {
    ...restOptions,
    routes,
  });
}

/**
 * Discover routes from pages directory
 */
async function discoverRoutes(pagesDir: string): Promise<string[]> {
  const routes: string[] = [];

  async function walk(dir: string, prefix = ''): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath, path.join(prefix, entry.name));
      } else if (entry.isFile()) {
        // Convert file path to route
        const ext = path.extname(entry.name);
        if (['.tsx', '.ts', '.jsx', '.js'].includes(ext)) {
          const basename = path.basename(entry.name, ext);

          let route = path.join(prefix, basename);

          // Handle index files
          if (basename === 'index') {
            route = prefix || '/';
          }

          // Handle dynamic routes [param]
          route = route.replace(/\[([^\]]+)\]/g, ':$1');

          // Normalize
          route = '/' + route.replace(/\\/g, '/');

          routes.push(route);
        }
      }
    }
  }

  try {
    await walk(pagesDir);
  } catch (error) {
    console.error('Failed to discover routes:', error);
  }

  return routes;
}

/**
 * Clear ISR cache
 *
 * Clears all cached pages for ISR.
 */
export function clearISRCache(): void {
  isrCache.clear();
}

/**
 * Get ISR cache stats
 *
 * Returns statistics about the ISR cache.
 */
export function getISRCacheStats(): {
  size: number;
  routes: string[];
} {
  return {
    size: isrCache.size,
    routes: Array.from(isrCache.keys()),
  };
}
