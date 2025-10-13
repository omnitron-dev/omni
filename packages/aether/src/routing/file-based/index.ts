/**
 * File-Based Routing
 *
 * Complete file-based routing system with automatic route generation,
 * special files, API routes, and build-time manifest generation.
 *
 * @module @omnitron-dev/aether/routing/file-based
 */

// Scanner
export {
  scanRouteFiles,
  filePathToRoutePath,
  extractRouteGroup,
  getFileType,
  groupFilesByDirectory,
  sortRoutesBySpecificity,
  buildRouteTree,
  validateRoutes,
  DEFAULT_CONVENTIONS,
  type FileConventions,
  type RouteFile,
} from './scanner.js';

// Generator
export {
  generateRoutes,
  generateManifestJson,
  generateRouteTypes,
  generateDevManifest,
  type GeneratorConfig,
  type RouteManifest,
} from './generator.js';

// API Routes
export {
  createApiHandler,
  executeApiRoute,
  json,
  error,
  redirect,
  cors,
  composeMiddleware,
  loggingMiddleware,
  authMiddleware,
  rateLimitMiddleware,
  type HttpMethod,
  type ApiHandler,
  type ApiHandlers,
  type ApiContext,
  type ApiRouteModule,
  type ApiMiddleware,
} from './api-routes.js';

// Special Files
export {
  createErrorBoundary,
  createLoadingComponent,
  createNotFoundComponent,
  executeMiddleware,
  findNearestSpecialFile,
  calculateRouteSimilarity,
  findSimilarRoutes,
  type SpecialFileType,
  type ErrorBoundaryProps,
  type LoadingProps,
  type NotFoundProps,
  type MiddlewareContext,
  type MiddlewareResult,
} from './special-files.js';

// Manifest
export {
  buildManifest,
  serializeManifest,
  parseManifest,
  validateManifest,
  generateManifestStats,
  generateManifestMarkdown,
  type ManifestRouteEntry,
  type CompiledManifest,
} from './manifest.js';

/**
 * Quick start: Generate routes from directory
 *
 * @example
 * ```typescript
 * import { scanAndGenerateRoutes } from '@omnitron-dev/aether/routing/file-based';
 *
 * // Scan routes directory and generate configuration
 * const { routes, manifest } = await scanAndGenerateRoutes(
 *   import.meta.glob('./routes/**.tsx'),
 *   {
 *     basePath: '/app',
 *     includeApi: true,
 *     generateTypes: true,
 *   }
 * );
 *
 * // Use routes with router
 * const router = createRouter({ routes });
 * ```
 */
export async function scanAndGenerateRoutes(
  globResults: Record<string, () => Promise<any>>,
  config?: {
    basePath?: string;
    includeApi?: boolean;
    generateTypes?: boolean;
  }
) {
  const { generateRoutes, generateRouteTypes } = await import('./generator.js');

  // Extract file paths from glob results
  const files = Object.keys(globResults);

  // Generate routes
  const manifest = await generateRoutes(files, {
    basePath: config?.basePath,
    includeApi: config?.includeApi ?? true,
  });

  // Generate types if requested
  let types: string | undefined;
  if (config?.generateTypes) {
    types = generateRouteTypes(manifest);
  }

  return {
    routes: manifest.routes,
    apiRoutes: manifest.apiRoutes,
    manifest,
    types,
    validation: manifest.validation,
  };
}

/**
 * Integrate with router
 *
 * @example
 * ```typescript
 * import { createRouter } from '@omnitron-dev/aether/router';
 * import { scanAndGenerateRoutes } from '@omnitron-dev/aether/routing/file-based';
 *
 * // Generate routes from files
 * const { routes } = await scanAndGenerateRoutes(
 *   import.meta.glob('./routes/**.tsx')
 * );
 *
 * // Create router with generated routes
 * const router = createRouter({
 *   mode: 'history',
 *   routes,
 * });
 * ```
 */
export async function createFileBasedRouter(
  globResults: Record<string, () => Promise<any>>,
  config?: {
    mode?: 'history' | 'hash' | 'memory';
    base?: string;
    includeApi?: boolean;
  }
) {
  const { createRouter } = await import('../router.js');

  // Generate routes
  const { routes } = await scanAndGenerateRoutes(globResults, {
    includeApi: config?.includeApi,
  });

  // Create router
  return createRouter({
    mode: config?.mode ?? 'history',
    base: config?.base ?? '/',
    routes,
  });
}
