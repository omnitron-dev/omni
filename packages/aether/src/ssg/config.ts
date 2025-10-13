/**
 * SSG Configuration System
 *
 * Configuration management for static site generation
 */

import type { SSGConfig, SitemapConfig, RobotsConfig } from './types.js';

/**
 * Default SSG configuration
 */
export const defaultSSGConfig: SSGConfig = {
  enabled: true,
  outDir: 'dist',
  base: '/',
  trailingSlash: false,
  sitemap: false,
  robots: false,
  env: {},
  plugins: [],
  assets: {
    images: {
      formats: ['webp', 'avif'],
      sizes: [640, 768, 1024, 1280, 1920],
      quality: 80,
    },
    fonts: {
      subset: true,
      preload: true,
    },
    js: {
      minify: true,
      sourcemap: false,
      splitting: true,
      target: 'es2020',
    },
  },
  css: {
    purge: true,
    inline: true,
    minify: true,
    extract: true,
  },
};

/**
 * Merge SSG configurations
 *
 * @param configs - Configurations to merge
 * @returns Merged configuration
 */
export function mergeSSGConfig(...configs: Partial<SSGConfig>[]): SSGConfig {
  let merged = { ...defaultSSGConfig };

  for (const config of configs) {
    merged = {
      ...merged,
      ...config,
      assets: config.assets ? { ...merged.assets, ...config.assets } : merged.assets,
      css: config.css ? { ...merged.css, ...config.css } : merged.css,
      cdn: config.cdn ? { ...merged.cdn, ...config.cdn } : merged.cdn,
      env: config.env ? { ...merged.env, ...config.env } : merged.env,
      plugins: config.plugins ? [...(merged.plugins || []), ...config.plugins] : merged.plugins,
      headers: config.headers ? [...(merged.headers || []), ...config.headers] : merged.headers,
    };
  }

  return merged;
}

/**
 * Validate SSG configuration
 *
 * @param config - Configuration to validate
 * @returns Validation errors
 */
export function validateSSGConfig(config: SSGConfig): string[] {
  const errors: string[] = [];

  if (!config.outDir) {
    errors.push('outDir is required');
  }

  if (!config.base) {
    errors.push('base is required');
  }

  if (config.base && !config.base.startsWith('/')) {
    errors.push('base must start with /');
  }

  if (config.sitemap && typeof config.sitemap === 'object') {
    if (!config.sitemap.hostname) {
      errors.push('sitemap.hostname is required when sitemap is configured');
    }
  }

  return errors;
}

/**
 * Generate sitemap XML
 *
 * @param paths - Paths to include
 * @param config - Sitemap configuration
 * @returns Sitemap XML
 */
export function generateSitemap(paths: string[], config: SitemapConfig): string {
  const { hostname, exclude = [], priority = {}, changefreq = {}, additionalUrls = [] } = config;

  // Filter excluded paths
  const filteredPaths = paths.filter((path) => !exclude.some((pattern) => {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      return regex.test(path);
    }));

  // Build URLs
  const urls = [
    ...filteredPaths.map((path) => {
      const url = `${hostname}${path}`;
      const pathPattern = Object.keys(priority).find((pattern) => {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return regex.test(path);
      });
      const freq = pathPattern ? changefreq[pathPattern] : undefined;
      const pri = pathPattern ? priority[pathPattern] : 0.5;

      return `  <url>
    <loc>${url}</loc>
    ${freq ? `<changefreq>${freq}</changefreq>` : ''}
    <priority>${pri}</priority>
  </url>`;
    }),
    ...additionalUrls.map((url) => `  <url>
    <loc>${url.url}</loc>
    ${url.changefreq ? `<changefreq>${url.changefreq}</changefreq>` : ''}
    ${url.priority ? `<priority>${url.priority}</priority>` : ''}
    ${url.lastmod ? `<lastmod>${url.lastmod}</lastmod>` : ''}
  </url>`),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;
}

/**
 * Generate robots.txt
 *
 * @param config - Robots configuration
 * @returns robots.txt content
 */
export function generateRobotsTxt(config: RobotsConfig): string {
  const { userAgent = '*', allow, disallow, sitemap, crawlDelay } = config;

  const lines: string[] = [`User-agent: ${userAgent}`];

  if (allow) {
    const allows = Array.isArray(allow) ? allow : [allow];
    allows.forEach((a) => lines.push(`Allow: ${a}`));
  }

  if (disallow) {
    const disallows = Array.isArray(disallow) ? disallow : [disallow];
    disallows.forEach((d) => lines.push(`Disallow: ${d}`));
  }

  if (crawlDelay) {
    lines.push(`Crawl-delay: ${crawlDelay}`);
  }

  if (sitemap) {
    lines.push(`Sitemap: ${sitemap}`);
  }

  return lines.join('\n');
}

/**
 * Resolve configuration from file
 *
 * @param configPath - Path to configuration file
 * @returns SSG configuration
 */
export async function resolveConfig(configPath?: string): Promise<SSGConfig> {
  if (!configPath) {
    return defaultSSGConfig;
  }

  try {
    const module = await import(configPath);
    const userConfig = module.default || module;
    return mergeSSGConfig(defaultSSGConfig, userConfig.ssg || userConfig);
  } catch (error) {
    console.warn(`Failed to load config from ${configPath}:`, error);
    return defaultSSGConfig;
  }
}

/**
 * Create SSG configuration
 *
 * @param config - Partial configuration
 * @returns Complete SSG configuration
 */
export function createSSGConfig(config: Partial<SSGConfig> = {}): SSGConfig {
  return mergeSSGConfig(defaultSSGConfig, config);
}
