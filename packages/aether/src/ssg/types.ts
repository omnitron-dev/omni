/**
 * SSG Type Definitions
 *
 * Types for Static Site Generation in Aether
 */

import type { RouteDefinition } from '../router/types.js';

/**
 * Static props context
 */
export interface StaticPropsContext {
  /**
   * Route parameters
   */
  params: Record<string, string | string[]>;

  /**
   * Current locale
   */
  locale?: string;

  /**
   * Whether in preview mode
   */
  preview?: boolean;

  /**
   * Preview data
   */
  previewData?: any;
}

/**
 * Static props result
 */
export interface StaticPropsResult<T = any> {
  /**
   * Props to pass to component
   */
  props: T;

  /**
   * Revalidation time in seconds
   * - false: never revalidate
   * - number: revalidate after N seconds
   */
  revalidate?: number | false;

  /**
   * Stale-while-revalidate time in seconds
   */
  staleWhileRevalidate?: number;

  /**
   * Cache tags for tag-based revalidation
   */
  tags?: string[];

  /**
   * Meta tags for SEO
   */
  meta?: StaticPageMeta;

  /**
   * JSON-LD structured data
   */
  jsonLd?: Record<string, any>;

  /**
   * Whether to return 404
   */
  notFound?: boolean;

  /**
   * Redirect to another page
   */
  redirect?: {
    destination: string;
    permanent: boolean;
  };
}

/**
 * Static paths context
 */
export interface StaticPathsContext {
  /**
   * Current locale
   */
  locale?: string;

  /**
   * All locales
   */
  locales?: string[];
}

/**
 * Static path entry
 */
export interface StaticPath {
  /**
   * Route parameters
   */
  params: Record<string, string | string[]>;

  /**
   * Locale for this path
   */
  locale?: string;
}

/**
 * Fallback behavior for dynamic routes
 */
export type FallbackBehavior = boolean | 'blocking';

/**
 * Static paths result
 */
export interface StaticPathsResult {
  /**
   * Paths to pre-render
   */
  paths: StaticPath[];

  /**
   * Fallback behavior
   * - false: 404 for missing paths
   * - true: show loading, generate in background
   * - 'blocking': wait for generation (SSR-like)
   */
  fallback: FallbackBehavior;
}

/**
 * Function to generate static props
 */
export type GetStaticProps<T = any> = (context: StaticPropsContext) => Promise<StaticPropsResult<T>>;

/**
 * Function to generate static paths
 */
export type GetStaticPaths = (context?: StaticPathsContext) => Promise<StaticPathsResult>;

/**
 * Meta tags for a page
 */
export interface StaticPageMeta {
  /**
   * Page title
   */
  title?: string;

  /**
   * Meta description
   */
  description?: string;

  /**
   * Canonical URL
   */
  canonical?: string;

  /**
   * OpenGraph title
   */
  ogTitle?: string;

  /**
   * OpenGraph description
   */
  ogDescription?: string;

  /**
   * OpenGraph image
   */
  ogImage?: string;

  /**
   * OpenGraph type
   */
  ogType?: string;

  /**
   * Twitter card type
   */
  twitterCard?: 'summary' | 'summary_large_image' | 'app' | 'player';

  /**
   * Additional meta tags
   */
  [key: string]: any;
}

/**
 * Generated static page
 */
export interface GeneratedPage {
  /**
   * Route path
   */
  path: string;

  /**
   * HTML content
   */
  html: string;

  /**
   * Props used for generation
   */
  props: any;

  /**
   * Revalidation time
   */
  revalidate?: number | false;

  /**
   * Stale-while-revalidate time
   */
  staleWhileRevalidate?: number;

  /**
   * Cache tags
   */
  tags?: string[];

  /**
   * Meta information
   */
  meta?: StaticPageMeta;

  /**
   * JSON-LD structured data
   */
  jsonLd?: Record<string, any>;

  /**
   * Generation timestamp
   */
  generatedAt: Date;
}

/**
 * SSG build configuration
 */
export interface SSGConfig {
  /**
   * Enable SSG
   */
  enabled?: boolean;

  /**
   * Output directory
   */
  outDir?: string;

  /**
   * Base URL
   */
  base?: string;

  /**
   * Trailing slashes
   */
  trailingSlash?: boolean;

  /**
   * 404 page route
   */
  notFoundRoute?: string;

  /**
   * Generate sitemap
   */
  sitemap?: SitemapConfig | boolean;

  /**
   * Generate robots.txt
   */
  robots?: RobotsConfig | boolean;

  /**
   * Environment variables to embed
   */
  env?: Record<string, string>;

  /**
   * Build plugins
   */
  plugins?: SSGPlugin[];

  /**
   * Asset optimization
   */
  assets?: AssetOptimizationConfig;

  /**
   * CSS configuration
   */
  css?: CSSConfig;

  /**
   * CDN configuration
   */
  cdn?: CDNConfig;

  /**
   * Headers configuration
   */
  headers?: HeadersConfig[];
}

/**
 * Sitemap configuration
 */
export interface SitemapConfig {
  /**
   * Hostname
   */
  hostname: string;

  /**
   * Exclude patterns
   */
  exclude?: string[];

  /**
   * Priority map
   */
  priority?: Record<string, number>;

  /**
   * Change frequency map
   */
  changefreq?: Record<string, 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'>;

  /**
   * Additional URLs
   */
  additionalUrls?: Array<{
    url: string;
    changefreq?: string;
    priority?: number;
    lastmod?: string;
  }>;
}

/**
 * Robots.txt configuration
 */
export interface RobotsConfig {
  /**
   * User agent
   */
  userAgent?: string;

  /**
   * Allow patterns
   */
  allow?: string | string[];

  /**
   * Disallow patterns
   */
  disallow?: string | string[];

  /**
   * Sitemap URL
   */
  sitemap?: string;

  /**
   * Crawl delay
   */
  crawlDelay?: number;
}

/**
 * Asset optimization configuration
 */
export interface AssetOptimizationConfig {
  /**
   * Image optimization
   */
  images?: {
    formats?: ('webp' | 'avif' | 'jpg' | 'png')[];
    sizes?: number[];
    quality?: number;
  };

  /**
   * Font optimization
   */
  fonts?: {
    subset?: boolean;
    preload?: boolean;
  };

  /**
   * JavaScript optimization
   */
  js?: {
    minify?: boolean;
    sourcemap?: boolean;
    splitting?: boolean;
    target?: string;
  };
}

/**
 * CSS configuration
 */
export interface CSSConfig {
  /**
   * Purge unused CSS
   */
  purge?: boolean;

  /**
   * Inline critical CSS
   */
  inline?: boolean;

  /**
   * Minify CSS
   */
  minify?: boolean;

  /**
   * Extract CSS to separate files
   */
  extract?: boolean;
}

/**
 * CDN configuration
 */
export interface CDNConfig {
  /**
   * CDN domain
   */
  domain?: string;

  /**
   * Cache headers
   */
  headers?: Record<string, string>;

  /**
   * CDN regions
   */
  regions?: string[];
}

/**
 * Headers configuration
 */
export interface HeadersConfig {
  /**
   * Source pattern
   */
  source: string;

  /**
   * Headers to set
   */
  headers: Array<{
    key: string;
    value: string;
  }>;
}

/**
 * SSG build plugin
 */
export interface SSGPlugin {
  /**
   * Plugin name
   */
  name: string;

  /**
   * Called before build starts
   */
  buildStart?(): void | Promise<void>;

  /**
   * Called after build ends
   */
  buildEnd?(): void | Promise<void>;

  /**
   * Transform page HTML
   */
  generatePage?(page: GeneratedPage): string | Promise<string>;

  /**
   * Called for each generated page
   */
  onPageGenerated?(path: string, html: string): void | Promise<void>;
}

/**
 * ISR revalidation cache entry
 */
export interface RevalidationCacheEntry {
  /**
   * Path
   */
  path: string;

  /**
   * Props
   */
  props: any;

  /**
   * HTML
   */
  html: string;

  /**
   * Generated at
   */
  generatedAt: Date;

  /**
   * Revalidate time
   */
  revalidate?: number | false;

  /**
   * Stale-while-revalidate time
   */
  staleWhileRevalidate?: number;

  /**
   * Tags
   */
  tags?: string[];
}

/**
 * ISR revalidation options
 */
export interface RevalidationOptions {
  /**
   * Path to revalidate
   */
  path?: string;

  /**
   * Tag to revalidate
   */
  tag?: string;

  /**
   * Secret for authentication
   */
  secret?: string;
}

/**
 * Build statistics
 */
export interface BuildStats {
  /**
   * Total pages generated
   */
  totalPages: number;

  /**
   * Static pages
   */
  staticPages: number;

  /**
   * Dynamic pages
   */
  dynamicPages: number;

  /**
   * Pages with ISR
   */
  isrPages: number;

  /**
   * Build duration
   */
  duration: number;

  /**
   * Total size
   */
  totalSize: number;

  /**
   * Average page size
   */
  averagePageSize: number;

  /**
   * Errors
   */
  errors: Array<{
    path: string;
    error: string;
  }>;
}

/**
 * Rendering strategy
 */
export type RenderStrategy = 'ssg' | 'ssr' | 'csr' | 'isr';

/**
 * Route with SSG configuration
 */
export interface SSGRoute extends RouteDefinition {
  /**
   * Get static props function
   */
  getStaticProps?: GetStaticProps;

  /**
   * Get static paths function
   */
  getStaticPaths?: GetStaticPaths;

  /**
   * Rendering strategy
   */
  strategy?: RenderStrategy;
}

/**
 * Build context
 */
export interface BuildContext {
  /**
   * Routes to build
   */
  routes: SSGRoute[];

  /**
   * Configuration
   */
  config: SSGConfig;

  /**
   * Output directory
   */
  outDir: string;

  /**
   * Base URL
   */
  base: string;

  /**
   * Build mode
   */
  mode: 'development' | 'production';

  /**
   * Generated pages
   */
  pages: Map<string, GeneratedPage>;

  /**
   * Build statistics
   */
  stats: BuildStats;
}
