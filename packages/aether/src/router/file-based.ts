/**
 * File-Based Routing
 *
 * Utilities for generating routes from file system structure
 */

import type { RouteDefinition, FileRouteModule, FileRouteConventions } from './types.js';

/**
 * Default file-based routing conventions
 */
export const defaultConventions: Required<FileRouteConventions> = {
  pagePattern: /\+page\.(ts|tsx|js|jsx)$/,
  layoutPattern: /\+layout\.(ts|tsx|js|jsx)$/,
  loaderPattern: /\+loader\.(ts|js)$/,
  actionPattern: /\+action\.(ts|js)$/,
  errorPattern: /\+error\.(ts|tsx|js|jsx)$/,
  loadingPattern: /\+loading\.(ts|tsx|js|jsx)$/,
};

/**
 * Parse a file path into a route path
 *
 * Converts file system paths to route patterns:
 * - `/routes/users/[id]/+page.ts` -> `/users/:id`
 * - `/routes/blog/[...slug]/+page.ts` -> `/blog/*slug`
 * - `/routes/index/+page.ts` -> `/`
 *
 * @param filePath - File path relative to routes directory
 * @param conventions - Route conventions
 * @returns Route path
 */
export function filePathToRoutePath(filePath: string, _conventions = defaultConventions): string {
  // Remove routes prefix and file extension
  let path = filePath.replace(/^routes\//, '').replace(/\/?\+[a-z]+\.[^/]+$/, '');

  // Handle index routes
  if (path === 'index' || path.endsWith('/index')) {
    path = path.replace(/\/?index$/, '');
  }

  // Handle empty path (root)
  if (!path) {
    return '/';
  }

  // Convert [param] to :param
  path = path.replace(/\[([^\]]+)\]/g, (_, param) => {
    // Handle catch-all [...rest]
    if (param.startsWith('...')) {
      return `*${param.slice(3)}`;
    }
    // Handle optional [id?]
    if (param.endsWith('?')) {
      return `:${param.slice(0, -1)}?`;
    }
    // Regular param
    return `:${param}`;
  });

  // Ensure leading slash
  if (!path.startsWith('/')) {
    path = '/' + path;
  }

  return path;
}

/**
 * Parse route path to extract dynamic segments
 *
 * @param path - Route path with params
 * @returns Array of parameter names
 *
 * @example
 * ```typescript
 * extractParams('/users/:id/posts/:postId')
 * // Returns: ['id', 'postId']
 * ```
 */
export function extractParams(path: string): string[] {
  const params: string[] = [];
  const regex = /:([a-zA-Z_$][a-zA-Z0-9_$]*)\??|\*([a-zA-Z_$][a-zA-Z0-9_$]*)/g;

  let match;
  while ((match = regex.exec(path)) !== null) {
    const param = match[1] || match[2];
    if (param) {
      params.push(param);
    }
  }

  return params;
}

/**
 * Group route files by directory
 *
 * Groups all route-related files (page, layout, loader, etc.) by their directory path.
 *
 * @param files - Array of file paths
 * @param conventions - Route conventions
 * @returns Map of directory path to files
 */
export function groupRouteFiles(
  files: string[],
  conventions = defaultConventions
): Map<string, { path: string; type: string; filePath: string }[]> {
  const groups = new Map<string, { path: string; type: string; filePath: string }[]>();

  for (const filePath of files) {
    // Extract directory path
    const dirPath = filePath.replace(/\/[^/]+$/, '') || '/';

    // Determine file type
    let type: string | null = null;
    if (conventions.pagePattern instanceof RegExp && conventions.pagePattern.test(filePath)) {
      type = 'page';
    } else if (conventions.layoutPattern instanceof RegExp && conventions.layoutPattern.test(filePath)) {
      type = 'layout';
    } else if (conventions.loaderPattern instanceof RegExp && conventions.loaderPattern.test(filePath)) {
      type = 'loader';
    } else if (conventions.actionPattern instanceof RegExp && conventions.actionPattern.test(filePath)) {
      type = 'action';
    } else if (conventions.errorPattern instanceof RegExp && conventions.errorPattern.test(filePath)) {
      type = 'error';
    } else if (conventions.loadingPattern instanceof RegExp && conventions.loadingPattern.test(filePath)) {
      type = 'loading';
    }

    if (type) {
      const routePath = filePathToRoutePath(filePath, conventions);
      const group = groups.get(dirPath) || [];
      group.push({ path: routePath, type, filePath });
      groups.set(dirPath, group);
    }
  }

  return groups;
}

/**
 * Build route definition from file modules
 *
 * Takes route modules and combines them into a RouteDefinition.
 *
 * @param modules - Route modules by type
 * @param path - Route path
 * @returns Route definition
 *
 * @example
 * ```typescript
 * const route = buildRouteFromModules({
 *   page: await import('./routes/users/[id]/+page.ts'),
 *   loader: await import('./routes/users/[id]/+loader.ts')
 * }, '/users/:id');
 * ```
 */
export function buildRouteFromModules(
  modules: Partial<Record<'page' | 'layout' | 'loader' | 'action' | 'error' | 'loading', FileRouteModule>>,
  path: string
): RouteDefinition {
  const route: RouteDefinition = { path };

  // Extract from page module
  if (modules.page) {
    route.component = modules.page.default;
    route.loader = modules.page.loader || route.loader;
    route.action = modules.page.action || route.action;
    route.meta = modules.page.meta || route.meta;
  }

  // Extract from layout module
  if (modules.layout) {
    route.layout = modules.layout.default;
  }

  // Extract from loader module
  if (modules.loader) {
    route.loader = modules.loader.loader || modules.loader.default;
  }

  // Extract from action module
  if (modules.action) {
    route.action = modules.action.action || modules.action.default;
  }

  // Extract from error module
  if (modules.error) {
    route.errorBoundary = modules.error.default;
  }

  // Extract from loading module
  if (modules.loading) {
    route.loading = modules.loading.default;
  }

  return route;
}

/**
 * Create route tree from flat routes
 *
 * Converts flat array of routes into nested tree structure based on path hierarchy.
 *
 * @param routes - Flat array of route definitions
 * @returns Root-level routes with nested children
 *
 * @example
 * ```typescript
 * const flatRoutes = [
 *   { path: '/' },
 *   { path: '/users' },
 *   { path: '/users/:id' }
 * ];
 * const tree = createRouteTree(flatRoutes);
 * // Returns:
 * // [
 * //   { path: '/' },
 * //   {
 * //     path: '/users',
 * //     children: [{ path: '/users/:id' }]
 * //   }
 * // ]
 * ```
 */
export function createRouteTree(routes: RouteDefinition[]): RouteDefinition[] {
  // Sort routes by depth (shallow first)
  const sorted = [...routes].sort((a, b) => {
    const depthA = a.path.split('/').length;
    const depthB = b.path.split('/').length;
    return depthA - depthB;
  });

  const tree: RouteDefinition[] = [];
  const routeMap = new Map<string, RouteDefinition>();

  for (const route of sorted) {
    routeMap.set(route.path, route);

    // Find parent route
    const pathParts = route.path.split('/').filter(Boolean);
    let parentPath = '';

    for (let i = pathParts.length - 1; i >= 0; i--) {
      parentPath = '/' + pathParts.slice(0, i).join('/');
      if (parentPath === '/') parentPath = '/';

      const parent = routeMap.get(parentPath);
      if (parent) {
        // Add as child to parent
        if (!parent.children) {
          parent.children = [];
        }
        parent.children.push(route);
        break;
      }
    }

    // If no parent found, add to root
    if (pathParts.length === 1 || route.path === '/') {
      tree.push(route);
    }
  }

  return tree;
}

/**
 * Generate routes from file system glob results
 *
 * High-level function that takes glob results and generates a complete route tree.
 * This is the main entry point for file-based routing.
 *
 * @param importModules - Function that imports route modules by file path
 * @param files - Array of file paths from glob
 * @param conventions - Route conventions
 * @returns Route definitions tree
 *
 * @example
 * ```typescript
 * // Using with import.meta.glob (Vite)
 * const modules = import.meta.glob('./routes/**\/*.ts');
 * const routes = await generateRoutesFromFiles(
 *   (path) => modules[path](),
 *   Object.keys(modules)
 * );
 * ```
 */
export async function generateRoutesFromFiles(
  importModules: (path: string) => Promise<FileRouteModule>,
  files: string[],
  conventions = defaultConventions
): Promise<RouteDefinition[]> {
  const groups = groupRouteFiles(files, conventions);
  const flatRoutes: RouteDefinition[] = [];

  // Build routes from each group
  for (const [_dirPath, fileGroup] of groups) {
    const modules: Partial<Record<string, FileRouteModule>> = {};
    let routePath: string | undefined;

    // Load all modules for this route
    for (const { path, type, filePath } of fileGroup) {
      routePath = path || routePath;
      try {
        modules[type] = await importModules(filePath);
      } catch (error) {
        console.error(`Failed to load route module ${filePath}:`, error);
      }
    }

    // Build route definition
    if (routePath) {
      const route = buildRouteFromModules(modules as any, routePath);
      flatRoutes.push(route);
    }
  }

  // Convert to tree structure
  return createRouteTree(flatRoutes);
}

/**
 * Validate route definition
 *
 * Checks if a route definition is valid and returns errors if any.
 *
 * @param route - Route definition to validate
 * @returns Array of validation error messages (empty if valid)
 */
export function validateRoute(route: RouteDefinition): string[] {
  const errors: string[] = [];

  // Must have a path
  if (!route.path) {
    errors.push('Route must have a path');
  }

  // Path must start with / or be *
  if (route.path && !route.path.startsWith('/') && route.path !== '*') {
    errors.push(`Route path must start with / (got: ${route.path})`);
  }

  // Must have at least a component
  if (!route.component && !route.children?.length) {
    errors.push(`Route ${route.path} must have a component or children`);
  }

  // Validate children recursively
  if (route.children) {
    for (const child of route.children) {
      const childErrors = validateRoute(child);
      errors.push(...childErrors);
    }
  }

  return errors;
}

/**
 * Validate route tree
 *
 * Validates all routes in a tree and returns all errors.
 *
 * @param routes - Array of route definitions
 * @returns Array of validation error messages (empty if all valid)
 */
export function validateRoutes(routes: RouteDefinition[]): string[] {
  const errors: string[] = [];

  for (const route of routes) {
    errors.push(...validateRoute(route));
  }

  return errors;
}
