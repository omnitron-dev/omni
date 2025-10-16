/**
 * Server Types
 *
 * Unified type definitions for SSR/SSG/Hydration/Streaming/Edge and Dev Server
 */

import type { RouteDefinition } from '../router/types.js';
import type { ViteDevServer, Plugin as VitePlugin } from 'vite';

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

  /**
   * Netron client for data fetching
   */
  netron?: any;
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

  /**
   * Collected styles for critical CSS
   */
  styles?: string[];

  /**
   * Island markers for partial hydration
   */
  islands?: IslandMarker[];
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

/**
 * SSR Options
 */
export interface SSROptions {
  /**
   * Initial state to serialize for hydration
   */
  initialState?: Record<string, any>;

  /**
   * Netron client for server-side data fetching
   */
  netron?: any;

  /**
   * Enable islands architecture
   */
  islands?: boolean;

  /**
   * Enable streaming
   */
  streaming?: boolean;

  /**
   * Collect styles for critical CSS
   */
  collectStyles?: boolean;

  /**
   * Maximum time to wait for async operations (ms)
   */
  timeout?: number;

  /**
   * Enable progressive hydration
   */
  progressive?: boolean;
}

/**
 * SSG Options
 */
export interface SSGOptions {
  /**
   * Routes to pre-render
   */
  routes: string[] | (() => Promise<string[]>);

  /**
   * Output directory
   */
  outDir: string;

  /**
   * Base URL
   */
  base?: string;

  /**
   * Enable incremental static regeneration
   */
  isr?: boolean;

  /**
   * ISR revalidation time (seconds)
   */
  revalidate?: number;

  /**
   * Fallback for dynamic routes ('blocking' | 'static' | false)
   */
  fallback?: 'blocking' | 'static' | false;

  /**
   * Parallel rendering limit
   */
  parallel?: number;
}

/**
 * Static paths result
 */
export interface StaticPathsResult {
  /**
   * Paths to pre-render
   */
  paths: string[];

  /**
   * Fallback behavior
   */
  fallback?: 'blocking' | 'static' | false;
}

/**
 * Static props result
 */
export interface StaticPropsResult<T = any> {
  /**
   * Props for the page
   */
  props: T;

  /**
   * Revalidation time (seconds) for ISR
   */
  revalidate?: number;

  /**
   * Redirect to another page
   */
  redirect?: {
    destination: string;
    permanent?: boolean;
  };

  /**
   * Return 404
   */
  notFound?: boolean;
}

/**
 * Hydration Options
 */
export interface HydrationOptions {
  /**
   * Server state to restore
   */
  serverState?: Record<string, any>;

  /**
   * Enable progressive hydration
   */
  progressive?: boolean;

  /**
   * Hydration strategy
   */
  strategy?: HydrationStrategy;

  /**
   * Handle hydration mismatches
   */
  onMismatch?: (error: HydrationError) => void;

  /**
   * Enable island architecture
   */
  islands?: boolean;
}

/**
 * Hydration strategy
 */
export type HydrationStrategy = 'eager' | 'lazy' | 'idle' | 'visible';

/**
 * Hydration error
 */
export interface HydrationError {
  type: 'mismatch' | 'missing' | 'extra';
  path: string;
  server: string;
  client: string;
}

/**
 * Streaming Options
 */
export interface StreamingOptions {
  /**
   * Enable out-of-order streaming
   */
  outOfOrder?: boolean;

  /**
   * Maximum concurrent streams
   */
  maxConcurrency?: number;

  /**
   * Suspense timeout (ms)
   */
  suspenseTimeout?: number;

  /**
   * Enable progressive rendering
   */
  progressive?: boolean;

  /**
   * Placeholder for suspended content
   */
  placeholder?: string | ((boundary: string) => string);
}

/**
 * Streaming result
 */
export interface StreamingResult {
  /**
   * Readable stream of HTML
   */
  stream: ReadableStream<Uint8Array> | NodeJS.ReadableStream;

  /**
   * Metadata about the stream
   */
  metadata: {
    status: number;
    headers: Record<string, string>;
    meta?: MetaTags;
  };
}

/**
 * Edge Options
 */
export interface EdgeOptions {
  /**
   * Target edge runtime
   */
  runtime: 'cloudflare' | 'vercel' | 'deno' | 'auto';

  /**
   * Enable edge caching
   */
  cache?: boolean;

  /**
   * Cache TTL (seconds)
   */
  cacheTtl?: number;

  /**
   * Regions to deploy to
   */
  regions?: string[];

  /**
   * Maximum bundle size (bytes)
   */
  maxBundleSize?: number;
}

/**
 * Island marker for partial hydration
 */
export interface IslandMarker {
  /**
   * Unique ID for the island
   */
  id: string;

  /**
   * Component name or path
   */
  component: string;

  /**
   * Props for the island
   */
  props: Record<string, any>;

  /**
   * Hydration strategy
   */
  strategy: HydrationStrategy;
}

/**
 * Render to string options
 */
export interface RenderToStringOptions extends SSROptions {
  /**
   * Component to render
   */
  component: any;

  /**
   * Component props
   */
  props?: Record<string, any>;

  /**
   * Current URL
   */
  url?: string | URL;
}

/**
 * Render to stream options
 */
export interface RenderToStreamOptions extends RenderToStringOptions, StreamingOptions {}

/**
 * Render to static markup options (no hydration)
 */
export interface RenderToStaticMarkupOptions {
  /**
   * Component to render
   */
  component: any;

  /**
   * Component props
   */
  props?: Record<string, any>;

  /**
   * Collect styles
   */
  collectStyles?: boolean;
}

/**
 * SSR context - internal rendering context
 */
export interface SSRContext {
  /**
   * Collected data during rendering
   */
  data: Map<string, any>;

  /**
   * Collected styles
   */
  styles: Set<string>;

  /**
   * Island markers
   */
  islands: IslandMarker[];

  /**
   * Current URL
   */
  url?: URL;

  /**
   * Netron client
   */
  netron?: any;

  /**
   * Async operations tracker
   */
  async: {
    pending: Set<Promise<any>>;
    completed: boolean;
  };
}

/**
 * Head context for meta tag management
 */
export interface HeadContext {
  /**
   * Title
   */
  title?: string;

  /**
   * Meta tags
   */
  meta: MetaTag[];

  /**
   * Link tags
   */
  links: LinkTag[];

  /**
   * Script tags
   */
  scripts: ScriptTag[];

  /**
   * Style tags
   */
  styles: StyleTag[];
}

/**
 * Meta tag
 */
export interface MetaTag {
  name?: string;
  property?: string;
  content: string;
  [key: string]: string | undefined;
}

/**
 * Link tag
 */
export interface LinkTag {
  rel: string;
  href: string;
  [key: string]: string | undefined;
}

/**
 * Script tag
 */
export interface ScriptTag {
  src?: string;
  content?: string;
  type?: string;
  async?: boolean;
  defer?: boolean;
  [key: string]: string | boolean | undefined;
}

/**
 * Style tag
 */
export interface StyleTag {
  content: string;
  [key: string]: string | undefined;
}

// ===== Dev Server Types =====

/**
 * Dev Server Configuration (extends ServerConfig)
 */
export interface DevServerConfig extends ServerConfig {
  // Dev mode flag
  dev: true;

  // Dev features
  hmr?: boolean | HMRConfig;
  errorOverlay?: boolean | ErrorOverlayConfig;
  cors?: boolean | CorsConfig;
  compression?: boolean | CompressionConfig;

  // Proxy
  proxy?: Record<string, string | ProxyConfig>;

  // Routes directory for file-based routing
  routesDir?: string;

  // Vite integration
  vite?: {
    configFile?: string;
    plugins?: VitePlugin[];
  };

  // Dev options
  clearScreen?: boolean;
  open?: boolean | string;
}

/**
 * Dev Server Instance (extends Server)
 */
export interface DevServer extends Server {
  vite?: ViteDevServer;
  watcher: FileWatcher;
  hmr: HMREngine;
  middleware: MiddlewareStack;

  restart(): Promise<void>;
  invalidate(path: string): void;
  getMetrics(): DevMetrics;
  use(middleware: Middleware): void;
}

// HMR Types
export interface HMRConfig {
  preserveState?: boolean;
  reloadOnError?: boolean;
  timeout?: number;
  boundaries?: string[];
  onUpdate?: (update: HMRUpdate) => void | Promise<void>;
  onError?: (error: Error) => void;
}

export interface HMRUpdate {
  type: 'update' | 'full-reload' | 'prune' | 'error';
  path: string;
  timestamp: number;
  acceptedPath?: string;
  explicitImportRequired?: boolean;
}

export interface HMRPayload {
  type: 'connected' | 'update' | 'full-reload' | 'prune' | 'error' | 'custom';
  updates?: HMRUpdate[];
  error?: ErrorInfo;
  data?: any;
}

export interface HMREngine {
  handleUpdate(file: string): Promise<void>;
  sendUpdate(update: HMRUpdate): Promise<void>;
  sendCustom(event: string, data?: any): Promise<void>;
  addConnection(ws: WebSocket): void;
  removeConnection(ws: WebSocket): void;
  getConnections(): Set<WebSocket>;
}

export interface ModuleNode {
  id: string;
  file: string;
  type: 'component' | 'module' | 'asset';
  importers: Set<ModuleNode>;
  importedModules: Set<ModuleNode>;
  acceptedHmr: boolean;
  isSelfAccepting: boolean;
  lastHMRTimestamp: number;
}

export interface ModuleGraph {
  idToModuleMap: Map<string, ModuleNode>;
  fileToModulesMap: Map<string, Set<ModuleNode>>;
  getModuleById(id: string): ModuleNode | undefined;
  getModulesByFile(file: string): Set<ModuleNode>;
  invalidateModule(mod: ModuleNode): void;
  updateModuleInfo(mod: ModuleNode, imported: Set<string>): void;
}

// Fast Refresh Types
export interface ComponentState {
  signals: Map<string, any>;
  effects: Set<any>;
  memos: Map<string, any>;
}

export interface FastRefreshConfig {
  enabled?: boolean;
  preserveLocalState?: boolean;
  forceReset?: boolean;
}

// Error Types
export interface ErrorOverlayConfig {
  position?: 'top' | 'bottom' | 'center';
  theme?: 'light' | 'dark' | 'auto';
  showStack?: boolean;
  showSource?: boolean;
  openInEditor?: boolean;
  editorUrl?: string;
}

export interface ErrorInfo {
  type: 'syntax' | 'runtime' | 'ssr' | 'transform';
  message: string;
  stack?: string;
  file?: string;
  line?: number;
  column?: number;
  source?: string;
  suggestions?: string[];
  timestamp?: number;
}

// Middleware Types
export interface Middleware {
  name: string;
  handle: (req: Request, next: () => Promise<Response>) => Response | Promise<Response>;
}

export interface MiddlewareStack {
  use(middleware: Middleware): void;
  handle(req: Request): Promise<Response>;
}

export interface CorsConfig {
  origin?: string | string[] | boolean;
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

export interface CompressionConfig {
  threshold?: number;
  level?: number;
  filter?: (req: Request) => boolean;
}

export interface ProxyConfig {
  target: string;
  changeOrigin?: boolean;
  rewrite?: (path: string) => string;
  configure?: (proxy: any, options: ProxyConfig) => void;
  ws?: boolean;
}

// File Watcher Types
export interface FileWatcher {
  add(path: string | string[]): void;
  unwatch(path: string | string[]): void;
  close(): Promise<void>;
  on(event: 'add' | 'change' | 'unlink', handler: (path: string) => void): void;
}

// Dev Metrics
export interface DevMetrics {
  uptime: number;
  requests: number;
  avgResponseTime: number;
  updates: number;
  avgUpdateTime: number;
  fullReloads: number;
  transforms: number;
  cacheHits: number;
  cacheMisses: number;
  heapUsed: number;
  heapTotal: number;
  rss: number;
}
