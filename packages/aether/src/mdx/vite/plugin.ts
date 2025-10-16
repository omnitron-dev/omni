/**
 * Aether MDX Vite Plugin
 *
 * A complete Vite plugin for transforming .mdx and .md files
 * with full integration into Vite's HMR system
 */

import type { Plugin, ViteDevServer } from 'vite';
import { compileMDX } from '../compiler/index.js';
import type { CompileMDXOptions, MDXModule, CompileTimeOptimizations } from '../types.js';

/**
 * Vite plugin configuration for Aether MDX
 */
export interface AetherMDXPluginOptions extends Omit<CompileMDXOptions, 'mode'> {
  /**
   * File extensions to transform
   * @default ['.mdx', '.md']
   */
  extensions?: string[];

  /**
   * Include files matching pattern
   */
  include?: RegExp | ((id: string) => boolean);

  /**
   * Exclude files matching pattern
   */
  exclude?: RegExp | ((id: string) => boolean);

  /**
   * Enable HMR (Hot Module Replacement)
   * @default true
   */
  hmr?: boolean;

  /**
   * Optimization options
   */
  optimize?: {
    /**
     * Precompile MDX at build time
     * @default true
     */
    precompile?: boolean;

    /**
     * Minify generated code
     * @default true in production
     */
    minify?: boolean;

    /**
     * Extract CSS from MDX
     * @default false
     */
    extractCSS?: boolean;

    /**
     * Enable tree shaking
     * @default true
     */
    treeshake?: boolean;
  } & CompileTimeOptimizations;
}

/**
 * Default extensions
 */
const DEFAULT_EXTENSIONS = ['.mdx', '.md'];

/**
 * Cache for compiled MDX modules
 */
const compilationCache = new Map<string, { code: string; timestamp: number }>();

/**
 * Create Aether MDX Vite plugin
 */
export function aetherMDX(options: AetherMDXPluginOptions = {}): Plugin {
  const { extensions = DEFAULT_EXTENSIONS, include, exclude, hmr = true, optimize = {}, ...compilerOptions } = options;

  let server: ViteDevServer | undefined;
  let isDev = false;

  /**
   * Check if file should be processed
   */
  const shouldTransform = (id: string): boolean => {
    // Remove query params
    const cleanId = id.split('?')[0];
    if (!cleanId) return false;

    // Check extensions
    const hasValidExtension = extensions.some((ext) => cleanId.endsWith(ext));
    if (!hasValidExtension) return false;

    // Check exclude
    if (exclude) {
      if (typeof exclude === 'function') {
        if (exclude(cleanId)) return false;
      } else if (exclude.test(cleanId)) {
        return false;
      }
    }

    // Check include
    if (include) {
      if (typeof include === 'function') {
        return include(cleanId);
      }
      return include.test(cleanId);
    }

    return true;
  };

  /**
   * Get cache key for file
   */
  const _getCacheKey = (id: string, timestamp: number): string => `${id}:${timestamp}`;

  /**
   * Compile MDX file
   */
  const compileMDXFile = async (id: string, code: string, isDevelopment: boolean): Promise<string> => {
    try {
      // Check cache in development
      if (isDevelopment && compilationCache.has(id)) {
        const cached = compilationCache.get(id)!;
        const stats = await import('fs').then((fs) => fs.promises.stat(id));
        if (cached.timestamp >= stats.mtimeMs) {
          return cached.code;
        }
      }

      // Compile MDX
      const module: MDXModule = await compileMDX(code, {
        mode: isDevelopment ? 'development' : 'production',
        ...compilerOptions,
        optimize: {
          precompile: optimize.precompile ?? true,
          minify: optimize.minify ?? !isDevelopment,
          treeshake: optimize.treeshake ?? true,
          ...optimize,
        },
      });

      // Generate module code
      let output = module.code;

      // Add HMR support in development
      if (isDevelopment && hmr) {
        output += `\n\n// HMR\nif (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    if (newModule) {
      console.log('[aether-mdx] Hot reloading:', ${JSON.stringify(id)});
    }
  });
}`;
      }

      // Cache result
      if (isDevelopment) {
        const stats = await import('fs').then((fs) => fs.promises.stat(id));
        compilationCache.set(id, {
          code: output,
          timestamp: stats.mtimeMs,
        });
      }

      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to compile MDX file ${id}: ${message}`);
    }
  };

  /**
   * Invalidate module in HMR
   */
  const invalidateModule = (id: string): void => {
    if (!server) return;

    const module = server.moduleGraph.getModuleById(id);
    if (module) {
      server.moduleGraph.invalidateModule(module);

      // Clear cache
      compilationCache.delete(id);

      // Trigger HMR update
      if (hmr) {
        server.ws.send({
          type: 'update',
          updates: [
            {
              type: 'js-update',
              path: module.url,
              acceptedPath: module.url,
              timestamp: Date.now(),
            },
          ],
        });
      }
    }
  };

  return {
    name: 'aether-mdx',

    // Plugin configuration
    enforce: 'pre',

    // Config resolved hook
    configResolved(config) {
      isDev = config.mode === 'development' || config.command === 'serve';
    },

    // Store dev server instance
    configureServer(_server) {
      server = _server;

      // Watch for MDX file changes
      if (hmr) {
        server.watcher.on('change', (file) => {
          if (shouldTransform(file)) {
            invalidateModule(file);
          }
        });
      }
    },

    // Transform hook - main compilation
    async transform(code: string, id: string) {
      if (!shouldTransform(id)) {
        return null;
      }

      try {
        const compiled = await compileMDXFile(id, code, isDev);

        return {
          code: compiled,
          map: null, // TODO: Add source maps support
        };
      } catch (error) {
        this.error(error instanceof Error ? error : new Error(String(error)));
        return null;
      }
    },

    // Handle hot updates
    async handleHotUpdate({ file, server: devServer, modules }) {
      if (!shouldTransform(file)) {
        return modules;
      }

      // Clear cache
      compilationCache.delete(file);

      // Invalidate module in dev server
      void devServer; // Mark as used to satisfy linter

      // Return affected modules for update
      return modules;
    },

    // Build start hook
    buildStart() {
      // Clear cache at build start
      compilationCache.clear();
    },

    // Build end hook
    buildEnd() {
      // Clean up in production
      if (!isDev) {
        compilationCache.clear();
      }
    },
  };
}

/**
 * Create MDX plugin with default options
 */
export function mdx(options?: AetherMDXPluginOptions): Plugin {
  return aetherMDX(options);
}

// Default export
export default aetherMDX;

// Re-export types from ../types.js (AetherMDXPluginOptions is already exported above)
export type { CompileMDXOptions, SyntaxHighlightOptions, CompileTimeOptimizations } from '../types.js';
