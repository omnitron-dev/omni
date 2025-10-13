/**
 * SSG Build Pipeline
 *
 * Core build system for static site generation
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { SSGRoute, SSGConfig, BuildContext, BuildStats } from './types.js';
import { executeStaticProps, createStaticPropsContext } from './static-props.js';
import {
  executeStaticPaths,
  patternToPath,
  isDynamicRoute,
  deduplicatePaths,
  batchStaticPaths,
} from './static-paths.js';
import { renderRoute, generateDocument, generate404Page } from './renderer.js';
import { canPrerender } from './hybrid.js';
import { generateSitemap, generateRobotsTxt } from './config.js';

/**
 * Build static site
 *
 * Main entry point for SSG build process
 *
 * @param routes - Routes to build
 * @param config - Build configuration
 * @returns Build statistics
 */
export async function buildStaticSite(routes: SSGRoute[], config: SSGConfig): Promise<BuildStats> {
  const startTime = Date.now();

  // Initialize build context
  const context: BuildContext = {
    routes,
    config,
    outDir: config.outDir || 'dist',
    base: config.base || '/',
    mode: 'production',
    pages: new Map(),
    stats: {
      totalPages: 0,
      staticPages: 0,
      dynamicPages: 0,
      isrPages: 0,
      duration: 0,
      totalSize: 0,
      averagePageSize: 0,
      errors: [],
    },
  };

  try {
    // Clean output directory
    await cleanOutputDir(context.outDir);

    // Run build plugins (buildStart)
    await runBuildPlugins('buildStart', context);

    // Generate pages
    await generatePages(context);

    // Generate sitemap
    if (config.sitemap) {
      await generateSitemapFile(context);
    }

    // Generate robots.txt
    if (config.robots) {
      await generateRobotsFile(context);
    }

    // Generate 404 page
    await generate404File(context);

    // Run build plugins (buildEnd)
    await runBuildPlugins('buildEnd', context);

    // Calculate statistics
    context.stats.duration = Date.now() - startTime;
    context.stats.totalPages = context.pages.size;

    // Calculate sizes
    let totalSize = 0;
    for (const page of context.pages.values()) {
      totalSize += page.html.length;
    }
    context.stats.totalSize = totalSize;
    context.stats.averagePageSize = context.pages.size > 0 ? totalSize / context.pages.size : 0;

    console.log(`\n✓ Build completed in ${context.stats.duration}ms`);
    console.log(`  Generated ${context.stats.totalPages} pages`);
    console.log(`  Static: ${context.stats.staticPages}, Dynamic: ${context.stats.dynamicPages}`);
    console.log(`  ISR: ${context.stats.isrPages}`);

    return context.stats;
  } catch (error) {
    console.error('Build failed:', error);
    throw error;
  }
}

/**
 * Generate all pages
 *
 * @param context - Build context
 */
async function generatePages(context: BuildContext): Promise<void> {
  for (const route of context.routes) {
    try {
      // Skip routes that can't be prerendered
      if (!canPrerender(route)) {
        continue;
      }

      // Check if dynamic route
      if (isDynamicRoute(route.path)) {
        await generateDynamicRoute(route, context);
      } else {
        await generateStaticRoute(route, context);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      context.stats.errors.push({
        path: route.path,
        error: errorMessage,
      });
      console.error(`Error generating ${route.path}:`, error);
    }
  }
}

/**
 * Generate static route
 *
 * @param route - Route to generate
 * @param context - Build context
 */
async function generateStaticRoute(route: SSGRoute, context: BuildContext): Promise<void> {
  console.log(`Generating ${route.path}...`);

  // Execute getStaticProps if defined
  let props: any = {};
  let revalidate: number | false | undefined;
  let staleWhileRevalidate: number | undefined;
  let tags: string[] | undefined;
  let meta: any;
  let jsonLd: any;

  if (route.getStaticProps) {
    const propsContext = createStaticPropsContext({});
    const result = await executeStaticProps(route.getStaticProps, propsContext);

    if (result.notFound) {
      return; // Skip this page
    }

    if (result.redirect) {
      // TODO: Handle redirects
      return;
    }

    props = result.props;
    revalidate = result.revalidate;
    staleWhileRevalidate = result.staleWhileRevalidate;
    tags = result.tags;
    meta = result.meta;
    jsonLd = result.jsonLd;
  }

  // Render page
  const page = await renderRoute(route, props, {
    path: route.path,
    revalidate,
    staleWhileRevalidate,
    tags,
    meta,
    jsonLd,
  });

  // Store page
  context.pages.set(route.path, page);

  // Write to disk
  const html = generateDocument(page, {
    base: context.base,
    scripts: ['/app.js'],
    styles: ['/app.css'],
    hydrate: true,
  });

  await writePageToDisk(route.path, html, context);

  // Update stats
  context.stats.staticPages++;
  if (revalidate !== false && revalidate !== undefined) {
    context.stats.isrPages++;
  }
}

/**
 * Generate dynamic route
 *
 * @param route - Route to generate
 * @param context - Build context
 */
async function generateDynamicRoute(route: SSGRoute, context: BuildContext): Promise<void> {
  if (!route.getStaticPaths) {
    console.warn(`Dynamic route ${route.path} has no getStaticPaths, skipping`);
    return;
  }

  console.log(`Generating dynamic route ${route.path}...`);

  // Get paths to generate
  const pathsResult = await executeStaticPaths(route.getStaticPaths);
  const paths = deduplicatePaths(pathsResult.paths);

  console.log(`  Found ${paths.length} paths to generate`);

  // Batch paths for parallel processing
  const batches = batchStaticPaths(paths, 10);

  for (const batch of batches) {
    await Promise.all(
      batch.map(async (staticPath) => {
        try {
          const pagePath = patternToPath(route.path, staticPath.params);

          // Execute getStaticProps
          let props: any = {};
          let revalidate: number | false | undefined;
          let staleWhileRevalidate: number | undefined;
          let tags: string[] | undefined;
          let meta: any;
          let jsonLd: any;

          if (route.getStaticProps) {
            const propsContext = createStaticPropsContext(staticPath.params, {
              locale: staticPath.locale,
            });
            const result = await executeStaticProps(route.getStaticProps, propsContext);

            if (result.notFound) {
              return; // Skip this page
            }

            if (result.redirect) {
              // TODO: Handle redirects
              return;
            }

            props = result.props;
            revalidate = result.revalidate;
            staleWhileRevalidate = result.staleWhileRevalidate;
            tags = result.tags;
            meta = result.meta;
            jsonLd = result.jsonLd;
          }

          // Create route with resolved path
          const resolvedRoute = { ...route, path: pagePath };

          // Render page
          const page = await renderRoute(resolvedRoute, props, {
            path: pagePath,
            revalidate,
            staleWhileRevalidate,
            tags,
            meta,
            jsonLd,
          });

          // Store page
          context.pages.set(pagePath, page);

          // Write to disk
          const html = generateDocument(page, {
            base: context.base,
            scripts: ['/app.js'],
            styles: ['/app.css'],
            hydrate: true,
          });

          await writePageToDisk(pagePath, html, context);

          // Update stats
          context.stats.dynamicPages++;
          if (revalidate !== false && revalidate !== undefined) {
            context.stats.isrPages++;
          }
        } catch (error) {
          console.error(`Error generating path ${JSON.stringify(staticPath.params)}:`, error);
          throw error;
        }
      }),
    );
  }
}

/**
 * Write page to disk
 *
 * @param pagePath - Page path
 * @param html - HTML content
 * @param context - Build context
 */
async function writePageToDisk(pagePath: string, html: string, context: BuildContext): Promise<void> {
  const { outDir, config } = context;

  // Normalize path
  let filePath = pagePath === '/' ? '/index.html' : `${pagePath}/index.html`;

  // Handle trailing slash
  if (!config.trailingSlash && pagePath !== '/') {
    filePath = `${pagePath}.html`;
  }

  // Resolve full path
  const fullPath = path.join(outDir, filePath);

  // Ensure directory exists
  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  // Write file
  await fs.writeFile(fullPath, html, 'utf-8');
}

/**
 * Generate sitemap file
 *
 * @param context - Build context
 */
async function generateSitemapFile(context: BuildContext): Promise<void> {
  const { config, pages, outDir } = context;

  if (typeof config.sitemap !== 'object') {
    return;
  }

  const paths = Array.from(pages.keys());
  const xml = generateSitemap(paths, config.sitemap);

  const sitemapPath = path.join(outDir, 'sitemap.xml');
  await fs.writeFile(sitemapPath, xml, 'utf-8');

  console.log('✓ Generated sitemap.xml');
}

/**
 * Generate robots.txt file
 *
 * @param context - Build context
 */
async function generateRobotsFile(context: BuildContext): Promise<void> {
  const { config, outDir } = context;

  if (typeof config.robots !== 'object') {
    return;
  }

  const txt = generateRobotsTxt(config.robots);

  const robotsPath = path.join(outDir, 'robots.txt');
  await fs.writeFile(robotsPath, txt, 'utf-8');

  console.log('✓ Generated robots.txt');
}

/**
 * Generate 404 page
 *
 * @param context - Build context
 */
async function generate404File(context: BuildContext): Promise<void> {
  const { config, outDir } = context;

  const html = generate404Page({
    base: config.base,
    message: 'Page Not Found',
  });

  const notFoundPath = path.join(outDir, '404.html');
  await fs.writeFile(notFoundPath, html, 'utf-8');

  console.log('✓ Generated 404.html');
}

/**
 * Clean output directory
 *
 * @param outDir - Output directory
 */
async function cleanOutputDir(outDir: string): Promise<void> {
  try {
    await fs.rm(outDir, { recursive: true, force: true });
    await fs.mkdir(outDir, { recursive: true });
  } catch (error) {
    console.error('Error cleaning output directory:', error);
  }
}

/**
 * Run build plugins
 *
 * @param hook - Hook name
 * @param context - Build context
 */
async function runBuildPlugins(hook: 'buildStart' | 'buildEnd', context: BuildContext): Promise<void> {
  const { config } = context;

  if (!config.plugins) {
    return;
  }

  for (const plugin of config.plugins) {
    try {
      if (hook === 'buildStart' && plugin.buildStart) {
        await plugin.buildStart();
      } else if (hook === 'buildEnd' && plugin.buildEnd) {
        await plugin.buildEnd();
      }
    } catch (error) {
      console.error(`Error running plugin ${plugin.name} (${hook}):`, error);
    }
  }
}

/**
 * Export build for deployment
 *
 * Prepares the build for deployment to various platforms
 *
 * @param context - Build context
 * @param platform - Deployment platform
 */
export async function exportBuild(
  context: BuildContext,
  platform: 'vercel' | 'netlify' | 'cloudflare' | 'static',
): Promise<void> {
  console.log(`\nExporting for ${platform}...`);

  switch (platform) {
    case 'vercel':
      await exportVercel(context);
      break;
    case 'netlify':
      await exportNetlify(context);
      break;
    case 'cloudflare':
      await exportCloudflare(context);
      break;
    case 'static':
      // Already exported
      break;
    default:
      console.warn(`Unknown platform: ${platform}, defaulting to static export`);
      break;
  }

  console.log('✓ Export complete');
}

/**
 * Export for Vercel
 */
async function exportVercel(context: BuildContext): Promise<void> {
  // Create vercel.json if needed
  const vercelConfig = {
    version: 2,
    builds: [
      {
        src: 'package.json',
        use: '@vercel/static-build',
      },
    ],
  };

  const configPath = path.join(context.outDir, '../vercel.json');
  await fs.writeFile(configPath, JSON.stringify(vercelConfig, null, 2));
}

/**
 * Export for Netlify
 */
async function exportNetlify(context: BuildContext): Promise<void> {
  // Create _redirects file
  const redirects = '/*    /index.html   200';
  const redirectsPath = path.join(context.outDir, '_redirects');
  await fs.writeFile(redirectsPath, redirects);
}

/**
 * Export for Cloudflare
 */
async function exportCloudflare(context: BuildContext): Promise<void> {
  // Create _headers file for Cloudflare Pages
  const headers = `/*
  Cache-Control: public, max-age=31536000, immutable`;

  const headersPath = path.join(context.outDir, '_headers');
  await fs.writeFile(headersPath, headers);
}
