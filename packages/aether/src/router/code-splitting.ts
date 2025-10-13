/**
 * Route Code Splitting
 *
 * Automatic route-based code splitting with dynamic imports,
 * chunk preloading, and bundle optimization
 */

import type { RouteComponent, RouteDefinition } from './types.js';

/**
 * Code splitting configuration
 */
export interface CodeSplittingConfig {
  /** Enable code splitting */
  enabled?: boolean;
  /** Preload strategy */
  preloadStrategy?: 'none' | 'hover' | 'visible' | 'all';
  /** Chunk naming pattern */
  chunkName?: (path: string) => string;
  /** Extract critical CSS */
  extractCriticalCSS?: boolean;
  /** Loading component for lazy routes */
  defaultLoading?: RouteComponent;
}

/**
 * Lazy route configuration
 */
export interface LazyRouteConfig {
  /** Route path */
  path: string;
  /** Import function */
  import: () => Promise<any>;
  /** Preload on condition */
  preload?: boolean | ((path: string) => boolean);
  /** Custom chunk name */
  chunkName?: string;
  /** Loading component */
  loading?: RouteComponent;
  /** Error boundary */
  errorBoundary?: RouteComponent;
}

/**
 * Chunk metadata
 */
export interface ChunkMetadata {
  /** Chunk identifier */
  id: string;
  /** Chunk size in bytes */
  size?: number;
  /** Routes using this chunk */
  routes: string[];
  /** Load status */
  status: 'pending' | 'loading' | 'loaded' | 'error';
  /** Load error if any */
  error?: Error;
  /** Loaded module */
  module?: any;
}

/**
 * Code Splitting Manager
 */
export class CodeSplittingManager {
  private config: Required<CodeSplittingConfig>;
  private chunks = new Map<string, ChunkMetadata>();
  private loadingChunks = new Map<string, Promise<any>>();
  private preloadedPaths = new Set<string>();

  constructor(config: CodeSplittingConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      preloadStrategy: config.preloadStrategy ?? 'visible',
      chunkName: config.chunkName ?? ((path) => this.defaultChunkName(path)),
      extractCriticalCSS: config.extractCriticalCSS ?? false,
      defaultLoading: config.defaultLoading ?? null,
    };
  }

  /**
   * Create a lazy route
   */
  lazy(importFn: () => Promise<any>, config: Partial<LazyRouteConfig> = {}): RouteDefinition {
    const { path = '', loading, errorBoundary, chunkName } = config;

    // Generate chunk ID
    const chunkId = chunkName || this.config.chunkName(path);

    // Register chunk metadata
    if (!this.chunks.has(chunkId)) {
      this.chunks.set(chunkId, {
        id: chunkId,
        routes: [path],
        status: 'pending',
      });
    }

    return {
      path,
      loading: loading || this.config.defaultLoading,
      errorBoundary,
      lazy: async () => this.loadChunk(chunkId, importFn),
    };
  }

  /**
   * Load a chunk
   */
  async loadChunk(chunkId: string, importFn: () => Promise<any>): Promise<any> {
    const chunk = this.chunks.get(chunkId);
    if (!chunk) {
      throw new Error(`Chunk ${chunkId} not registered`);
    }

    // Return cached module if already loaded
    if (chunk.status === 'loaded' && chunk.module) {
      return chunk.module;
    }

    // Return existing loading promise if in progress
    if (this.loadingChunks.has(chunkId)) {
      return this.loadingChunks.get(chunkId)!;
    }

    // Start loading
    chunk.status = 'loading';
    const loadPromise = this.executeLoad(chunkId, importFn);
    this.loadingChunks.set(chunkId, loadPromise);

    try {
      const module = await loadPromise;
      chunk.status = 'loaded';
      chunk.module = module;
      return module;
    } catch (error) {
      chunk.status = 'error';
      chunk.error = error as Error;
      throw error;
    } finally {
      this.loadingChunks.delete(chunkId);
    }
  }

  /**
   * Execute chunk loading
   */
  private async executeLoad(chunkId: string, importFn: () => Promise<any>): Promise<any> {
    const startTime = performance.now();

    try {
      // Dynamic import
      const module = await importFn();

      // Track loading time
      const loadTime = performance.now() - startTime;
      console.debug(`Chunk ${chunkId} loaded in ${loadTime.toFixed(2)}ms`);

      // Extract critical CSS if configured
      if (this.config.extractCriticalCSS && module.styles) {
        this.injectStyles(chunkId, module.styles);
      }

      return module;
    } catch (error) {
      console.error(`Failed to load chunk ${chunkId}:`, error);
      throw error;
    }
  }

  /**
   * Preload a chunk
   */
  async preloadChunk(chunkId: string, importFn: () => Promise<any>): Promise<void> {
    const chunk = this.chunks.get(chunkId);
    if (!chunk) {
      return;
    }

    // Skip if already loaded or loading
    if (chunk.status === 'loaded' || chunk.status === 'loading') {
      return;
    }

    // Preload in background
    try {
      await this.loadChunk(chunkId, importFn);
    } catch (error) {
      // Ignore preload errors
      console.warn(`Preload failed for chunk ${chunkId}:`, error);
    }
  }

  /**
   * Preload chunks for a route path
   */
  async preloadRoute(path: string, routes: RouteDefinition[]): Promise<void> {
    if (this.preloadedPaths.has(path)) {
      return;
    }

    this.preloadedPaths.add(path);

    // Find matching routes with lazy loading
    const matchingRoutes = this.findLazyRoutes(path, routes);

    // Preload all matching chunks
    await Promise.all(
      matchingRoutes.map(async (route) => {
        if (route.lazy) {
          const chunkId = this.config.chunkName(route.path);
          await this.preloadChunk(chunkId, route.lazy);
        }
      })
    );
  }

  /**
   * Preload visible chunks
   */
  setupVisiblePreload(element: Element, path: string, routes: RouteDefinition[]): () => void {
    if (typeof IntersectionObserver === 'undefined') {
      return () => {};
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.preloadRoute(path, routes);
            observer.disconnect();
          }
        }
      },
      {
        rootMargin: '50px',
      }
    );

    observer.observe(element);

    return () => observer.disconnect();
  }

  /**
   * Preload on hover
   */
  setupHoverPreload(element: Element, path: string, routes: RouteDefinition[]): () => void {
    let timeoutId: NodeJS.Timeout | null = null;

    const handleMouseEnter = () => {
      timeoutId = setTimeout(() => {
        this.preloadRoute(path, routes);
      }, 100);
    };

    const handleMouseLeave = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    element.addEventListener('mouseenter', handleMouseEnter);
    element.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      element.removeEventListener('mouseenter', handleMouseEnter);
      element.removeEventListener('mouseleave', handleMouseLeave);
    };
  }

  /**
   * Get chunk metadata
   */
  getChunk(chunkId: string): ChunkMetadata | undefined {
    return this.chunks.get(chunkId);
  }

  /**
   * Get all chunks
   */
  getAllChunks(): ChunkMetadata[] {
    return Array.from(this.chunks.values());
  }

  /**
   * Get bundle statistics
   */
  getBundleStats(): BundleStats {
    const chunks = this.getAllChunks();
    return {
      totalChunks: chunks.length,
      loadedChunks: chunks.filter((c) => c.status === 'loaded').length,
      failedChunks: chunks.filter((c) => c.status === 'error').length,
      pendingChunks: chunks.filter((c) => c.status === 'pending').length,
      totalSize: chunks.reduce((sum, c) => sum + (c.size || 0), 0),
    };
  }

  /**
   * Clear chunk cache
   */
  clearCache(chunkId?: string): void {
    if (chunkId) {
      const chunk = this.chunks.get(chunkId);
      if (chunk) {
        chunk.status = 'pending';
        chunk.module = undefined;
        chunk.error = undefined;
      }
      this.preloadedPaths.delete(chunkId);
    } else {
      this.chunks.forEach((chunk) => {
        chunk.status = 'pending';
        chunk.module = undefined;
        chunk.error = undefined;
      });
      this.preloadedPaths.clear();
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CodeSplittingConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * Find lazy routes matching a path
   */
  private findLazyRoutes(path: string, routes: RouteDefinition[]): RouteDefinition[] {
    const result: RouteDefinition[] = [];

    for (const route of routes) {
      if (route.lazy && this.matchesPath(route.path, path)) {
        result.push(route);
      }

      if (route.children) {
        result.push(...this.findLazyRoutes(path, route.children));
      }
    }

    return result;
  }

  /**
   * Check if route path matches target path
   */
  private matchesPath(routePath: string, targetPath: string): boolean {
    // Simple prefix matching (can be enhanced with pattern matching)
    return targetPath.startsWith(routePath) || routePath === targetPath;
  }

  /**
   * Default chunk naming
   */
  private defaultChunkName(path: string): string {
    // Convert path to valid chunk name
    return path
      .replace(/^\//, '')
      .replace(/\//g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .toLowerCase() || 'index';
  }

  /**
   * Inject styles into document
   */
  private injectStyles(chunkId: string, styles: string): void {
    if (typeof document === 'undefined') {
      return;
    }

    const styleId = `aether-chunk-${chunkId}`;
    if (document.getElementById(styleId)) {
      return; // Already injected
    }

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = styles;
    document.head.appendChild(style);
  }
}

/**
 * Bundle statistics
 */
export interface BundleStats {
  /** Total number of chunks */
  totalChunks: number;
  /** Number of loaded chunks */
  loadedChunks: number;
  /** Number of failed chunks */
  failedChunks: number;
  /** Number of pending chunks */
  pendingChunks: number;
  /** Total bundle size in bytes */
  totalSize: number;
}

/**
 * Default code splitting manager
 */
let defaultManager: CodeSplittingManager | null = null;

/**
 * Get or create default code splitting manager
 */
export function getCodeSplittingManager(config?: CodeSplittingConfig): CodeSplittingManager {
  if (!defaultManager) {
    defaultManager = new CodeSplittingManager(config);
  }
  return defaultManager;
}

/**
 * Set default code splitting manager
 */
export function setCodeSplittingManager(manager: CodeSplittingManager): void {
  defaultManager = manager;
}

/**
 * Helper to create a lazy route
 */
export function lazyRoute(importFn: () => Promise<any>, config?: Partial<LazyRouteConfig>): RouteDefinition {
  const manager = getCodeSplittingManager();
  return manager.lazy(importFn, config);
}

/**
 * Helper to preload a route
 */
export async function preloadRoute(path: string, routes: RouteDefinition[]): Promise<void> {
  const manager = getCodeSplittingManager();
  await manager.preloadRoute(path, routes);
}

/**
 * Webpack magic comments helper for chunk naming
 */
export function webpackChunkName(name: string): string {
  return `/* webpackChunkName: "${name}" */`;
}

/**
 * Vite dynamic import helper
 */
export function viteGlob(pattern: string, options: Record<string, any> = {}): Record<string, () => Promise<any>> {
  if (typeof import.meta === 'undefined' || !(import.meta as any).glob) {
    console.warn('Vite glob imports not available');
    return {};
  }

  return (import.meta as any).glob(pattern, options);
}
