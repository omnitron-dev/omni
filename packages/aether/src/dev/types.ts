/**
 * Dev Server Types
 *
 * Type definitions for Aether development server
 */

import type { Server, ServerConfig } from '../server/types.js';
import type { ViteDevServer, Plugin as VitePlugin } from 'vite';

// ===== Dev Server =====

export interface DevServerConfig extends ServerConfig {
  // Dev mode flag
  dev: true;

  // Server settings
  port?: number;
  host?: string;
  base?: string;

  // Routing
  routesDir?: string;

  // Features
  hmr?: boolean | HMRConfig;
  errorOverlay?: boolean | ErrorOverlayConfig;
  cors?: boolean | CorsConfig;
  compression?: boolean | CompressionConfig;

  // Proxy
  proxy?: Record<string, string | ProxyConfig>;

  // Performance
  lazyCompilation?: boolean;
  caching?: boolean;
  clearScreen?: boolean;

  // Islands
  islands?: boolean;
  islandsStrategy?: 'idle' | 'lazy' | 'visible' | 'eager';

  // Vite integration
  vite?: {
    configFile?: string;
    plugins?: VitePlugin[];
  };

  // Public directory
  publicDir?: string;

  // Open browser
  open?: boolean | string;
}

export interface DevServer extends Server {
  // Dev server instance
  vite?: ViteDevServer;
  watcher: FileWatcher;
  hmr: HMREngine;
  middleware: MiddlewareStack;

  // Dev-specific methods
  restart(): Promise<void>;
  invalidate(path: string): void;
  getMetrics(): DevMetrics;
  use(middleware: Middleware): void;
}

// ===== HMR =====

export interface HMRConfig {
  // Update strategies
  preserveState?: boolean;
  reloadOnError?: boolean;
  timeout?: number;

  // Boundaries
  boundaries?: string[];

  // Custom handlers
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

// ===== Module Graph =====

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

// ===== Fast Refresh =====

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

// ===== Error Handling =====

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

// ===== Middleware =====

export interface Middleware {
  name: string;
  handle: (
    req: Request,
    next: () => Promise<Response>
  ) => Response | Promise<Response>;
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

// ===== File Watcher =====

export interface FileWatcher {
  add(path: string | string[]): void;
  unwatch(path: string | string[]): void;
  close(): Promise<void>;
  on(event: 'add' | 'change' | 'unlink', handler: (path: string) => void): void;
}

export interface RouteWatcherConfig {
  routesDir: string;
  ignored?: string[];
  debounce?: number;
}

// ===== Dev Metrics =====

export interface DevMetrics {
  // Server metrics
  uptime: number;
  requests: number;
  avgResponseTime: number;

  // HMR metrics
  updates: number;
  avgUpdateTime: number;
  fullReloads: number;

  // Build metrics
  transforms: number;
  cacheHits: number;
  cacheMisses: number;

  // Memory metrics
  heapUsed: number;
  heapTotal: number;
  rss: number;
}

// ===== Vite Plugin =====

export interface AetherDevPluginOptions {
  // Routes
  routesDir?: string;

  // HMR
  hmr?: HMRConfig;

  // Fast Refresh
  fastRefresh?: FastRefreshConfig;

  // Islands
  islands?: boolean;

  // Error handling
  errorOverlay?: boolean | ErrorOverlayConfig;

  // SSR
  ssr?: boolean;
}
