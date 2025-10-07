/**
 * Server Types
 *
 * Type definitions for SSR/SSG server
 */

import type { RouteDefinition } from '../router/types.js';

/**
 * Server rendering mode
 */
export type RenderMode = 'ssr' | 'ssg' | 'islands' | 'spa';

/**
 * Server configuration
 */
export interface ServerConfig {
  /**
   * Rendering mode
   */
  mode: RenderMode;

  /**
   * Routes configuration
   */
  routes: RouteDefinition[];

  /**
   * Port to listen on (default: 3000)
   */
  port?: number;

  /**
   * Host to bind to (default: '0.0.0.0')
   */
  host?: string;

  /**
   * Base URL for the application
   */
  base?: string;

  /**
   * Static assets directory
   */
  publicDir?: string;

  /**
   * Output directory for SSG
   */
  outDir?: string;

  /**
   * Development mode
   */
  dev?: boolean;
}

/**
 * Render context for SSR
 */
export interface RenderContext {
  /**
   * Current URL
   */
  url: URL;

  /**
   * Request headers
   */
  headers: Headers;

  /**
   * Request method
   */
  method: string;

  /**
   * Route params
   */
  params?: Record<string, string | string[]>;

  /**
   * Loader data
   */
  loaderData?: any;

  /**
   * User context (for authentication, etc.)
   */
  user?: any;
}

/**
 * Render result
 */
export interface RenderResult {
  /**
   * Rendered HTML
   */
  html: string;

  /**
   * Serialized data for hydration
   */
  data?: Record<string, any>;

  /**
   * HTTP status code
   */
  status?: number;

  /**
   * HTTP headers
   */
  headers?: Record<string, string>;

  /**
   * Meta tags for SEO
   */
  meta?: MetaTags;
}

/**
 * Meta tags for SEO
 */
export interface MetaTags {
  title?: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  canonical?: string;
  [key: string]: string | undefined;
}

/**
 * Server instance
 */
export interface Server {
  /**
   * Start the server
   */
  listen(): Promise<void>;

  /**
   * Stop the server
   */
  close(): Promise<void>;

  /**
   * Render a route
   */
  render(context: RenderContext): Promise<RenderResult>;
}
