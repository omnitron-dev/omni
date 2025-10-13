/**
 * File-Based Routing Scanner
 *
 * Scans the routes directory and generates route configurations automatically
 */

import type {
  RouteDefinition,
} from '../types.js';

/**
 * File naming conventions
 */
export interface FileConventions {
  /** Page component patterns (Next.js/Remix style) */
  pagePatterns: string[];
  /** Layout component patterns */
  layoutPatterns: string[];
  /** Error boundary patterns */
  errorPatterns: string[];
  /** Loading component patterns */
  loadingPatterns: string[];
  /** Middleware patterns */
  middlewarePatterns: string[];
  /** Loader patterns */
  loaderPatterns: string[];
  /** Action patterns */
  actionPatterns: string[];
  /** 404 patterns */
  notFoundPatterns: string[];
}

/**
 * Default file conventions (Next.js/Remix compatible)
 */
export const DEFAULT_CONVENTIONS: FileConventions = {
  pagePatterns: ['index.tsx', 'index.ts', 'page.tsx', 'page.ts', '+page.tsx', '+page.ts'],
  layoutPatterns: ['_layout.tsx', '_layout.ts', 'layout.tsx', 'layout.ts', '+layout.tsx', '+layout.ts'],
  errorPatterns: ['_error.tsx', '_error.ts', 'error.tsx', 'error.ts', '+error.tsx', '+error.ts'],
  loadingPatterns: ['_loading.tsx', '_loading.ts', 'loading.tsx', 'loading.ts', '+loading.tsx', '+loading.ts'],
  middlewarePatterns: ['_middleware.ts', '_middleware.tsx', 'middleware.ts', '+middleware.ts'],
  loaderPatterns: ['loader.ts', '+loader.ts', 'data.ts'],
  actionPatterns: ['action.ts', '+action.ts'],
  notFoundPatterns: ['_404.tsx', '_404.ts', '404.tsx', '404.ts', 'not-found.tsx'],
};

/**
 * Route file information
 */
export interface RouteFile {
  /** File path relative to routes directory */
  path: string;
  /** Type of file */
  type: 'page' | 'layout' | 'error' | 'loading' | 'middleware' | 'loader' | 'action' | 'notFound' | 'api';
  /** Generated route path */
  routePath: string;
  /** Directory path */
  dirPath: string;
  /** File name */
  fileName: string;
  /** Is API route? */
  isApi: boolean;
  /** Is route group? */
  isGroup: boolean;
  /** Group name if applicable */
  groupName?: string;
}

/**
 * Parse file path into route path
 *
 * Supports Next.js and Remix conventions:
 * - index.tsx -> /
 * - about.tsx -> /about
 * - [id].tsx -> /:id
 * - [...slug].tsx -> /*slug
 * - [[...slug]].tsx -> /*slug (optional catch-all)
 * - (group)/page.tsx -> /page (route groups)
 */
export function filePathToRoutePath(filePath: string): string {
  // Remove routes/ prefix and file extension
  let path = filePath
    .replace(/^routes\//, '')
    .replace(/^src\/routes\//, '')
    .replace(/\/(index|page|\+page)\.(tsx?|jsx?)$/, '')
    .replace(/\/_?(layout|error|loading|middleware|\+\w+)\.(tsx?|jsx?)$/, '');

  // Handle route groups - remove from path but track
  path = path.replace(/\/?\([^)]+\)\/?/g, '/');

  // Handle index at root
  if (!path || path === '/') {
    return '/';
  }

  // Convert Next.js dynamic routes to standard format
  // [id] -> :id
  path = path.replace(/\[([^\]]+)\]/g, (match, param) => {
    // Optional catch-all: [[...slug]] -> *slug?
    if (param.startsWith('...') && match.startsWith('[[')) {
      return `*${param.slice(3)}?`;
    }
    // Catch-all: [...slug] -> *slug
    if (param.startsWith('...')) {
      return `*${param.slice(3)}`;
    }
    // Optional param: [id?] -> :id?
    if (param.endsWith('?')) {
      return `:${param.slice(0, -1)}?`;
    }
    // Regular param: [id] -> :id
    return `:${param}`;
  });

  // Remove any remaining file extensions (.tsx, .ts, .jsx, .js)
  path = path.replace(/\.(tsx?|jsx?)$/, '');

  // Normalize slashes
  path = path.replace(/\/+/g, '/');

  // Ensure leading slash
  if (!path.startsWith('/')) {
    path = '/' + path;
  }

  // Remove trailing slash (except root)
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  return path;
}

/**
 * Extract route group from path
 */
export function extractRouteGroup(filePath: string): { isGroup: boolean; groupName?: string; cleanPath: string } {
  const groupMatch = filePath.match(/\/\(([^)]+)\)\//);

  if (groupMatch) {
    return {
      isGroup: true,
      groupName: groupMatch[1],
      cleanPath: filePath.replace(/\/?\([^)]+\)\/?/g, '/'),
    };
  }

  return {
    isGroup: false,
    cleanPath: filePath,
  };
}

/**
 * Determine file type from path
 */
export function getFileType(
  fileName: string,
  conventions = DEFAULT_CONVENTIONS
): RouteFile['type'] | null {
  // Check each convention
  if (conventions.pagePatterns.some(pattern => fileName.endsWith(pattern))) {
    return 'page';
  }
  if (conventions.layoutPatterns.some(pattern => fileName.endsWith(pattern))) {
    return 'layout';
  }
  if (conventions.errorPatterns.some(pattern => fileName.endsWith(pattern))) {
    return 'error';
  }
  if (conventions.loadingPatterns.some(pattern => fileName.endsWith(pattern))) {
    return 'loading';
  }
  if (conventions.middlewarePatterns.some(pattern => fileName.endsWith(pattern))) {
    return 'middleware';
  }
  if (conventions.loaderPatterns.some(pattern => fileName.endsWith(pattern))) {
    return 'loader';
  }
  if (conventions.actionPatterns.some(pattern => fileName.endsWith(pattern))) {
    return 'action';
  }
  if (conventions.notFoundPatterns.some(pattern => fileName.endsWith(pattern))) {
    return 'notFound';
  }

  return null;
}

/**
 * Scan files and categorize them
 */
export function scanRouteFiles(files: string[], conventions = DEFAULT_CONVENTIONS): RouteFile[] {
  const routeFiles: RouteFile[] = [];

  for (const filePath of files) {
    const fileName = filePath.split('/').pop() || '';
    const dirPath = filePath.substring(0, filePath.lastIndexOf('/')) || '/';

    // Check if it's an API route
    const isApi = filePath.includes('/api/') || filePath.startsWith('routes/api/');

    // Skip non-route files
    if (fileName.startsWith('_') && !fileName.match(/^_(layout|error|loading|middleware|404)/)) {
      continue;
    }

    const fileType = getFileType(fileName, conventions);
    if (!fileType && !isApi) {
      continue;
    }

    // Extract route group information
    const { isGroup, groupName, cleanPath } = extractRouteGroup(filePath);

    // Generate route path
    const routePath = filePathToRoutePath(isApi ? filePath.replace('/api/', '/') : cleanPath);

    routeFiles.push({
      path: filePath,
      type: fileType || 'api',
      routePath: isApi ? `/api${routePath}` : routePath,
      dirPath,
      fileName,
      isApi,
      isGroup,
      groupName,
    });
  }

  return routeFiles;
}

/**
 * Group files by directory
 */
export function groupFilesByDirectory(files: RouteFile[]): Map<string, RouteFile[]> {
  const groups = new Map<string, RouteFile[]>();

  for (const file of files) {
    const existing = groups.get(file.dirPath) || [];
    existing.push(file);
    groups.set(file.dirPath, existing);
  }

  return groups;
}

/**
 * Sort routes by specificity (more specific routes first)
 */
export function sortRoutesBySpecificity(routes: RouteDefinition[]): RouteDefinition[] {
  return routes.sort((a, b) => {
    const scoreA = getRouteSpecificity(a.path);
    const scoreB = getRouteSpecificity(b.path);
    return scoreB - scoreA; // Higher score = more specific
  });
}

/**
 * Calculate route specificity score
 *
 * Static segments > dynamic segments > catch-all
 */
function getRouteSpecificity(path: string): number {
  const segments = path.split('/').filter(Boolean);
  let score = 0;

  for (const segment of segments) {
    if (segment.startsWith('*')) {
      // Catch-all: lowest priority
      score += 1;
    } else if (segment.startsWith(':')) {
      // Dynamic: medium priority
      score += 10;
    } else {
      // Static: highest priority
      score += 100;
    }
  }

  return score;
}

/**
 * Build route tree from flat files
 */
export function buildRouteTree(files: RouteFile[], routeGroups: Map<string, RouteFile[]>): RouteDefinition[] {
  const routes: RouteDefinition[] = [];
  const routeMap = new Map<string, RouteDefinition>();

  // Group files by route path
  const pathGroups = new Map<string, RouteFile[]>();
  for (const file of files) {
    if (file.isApi) continue; // Handle API routes separately

    const existing = pathGroups.get(file.routePath) || [];
    existing.push(file);
    pathGroups.set(file.routePath, existing);
  }

  // Create route definitions
  for (const [routePath, groupFiles] of pathGroups) {
    const route: Partial<RouteDefinition> = {
      path: routePath,
      meta: {},
    };

    // Process each file type
    for (const file of groupFiles) {
      switch (file.type) {
        case 'page':
          // Page component will be loaded dynamically
          route.lazy = () => import(/* @vite-ignore */ file.path).then(m => ({ default: m.default }));
          break;
        case 'layout':
          // Layout will be applied to this route and children
          route.layout = () => import(/* @vite-ignore */ file.path).then(m => m.default);
          break;
        case 'error':
          route.errorBoundary = () => import(/* @vite-ignore */ file.path).then(m => m.default);
          break;
        case 'loading':
          route.loading = () => import(/* @vite-ignore */ file.path).then(m => m.default);
          break;
        case 'middleware':
          // Middleware becomes a guard
          route.guards = [
            async (ctx) => {
              const mod = await import(/* @vite-ignore */ file.path);
              const middleware = mod.default || mod.middleware;
              if (middleware) {
                return middleware(ctx);
              }
              return true;
            },
          ];
          break;
        case 'loader':
          route.loader = async (ctx) => {
            const mod = await import(/* @vite-ignore */ file.path);
            const loader = mod.default || mod.loader;
            return loader ? loader(ctx) : null;
          };
          break;
        case 'action':
          route.action = async (ctx) => {
            const mod = await import(/* @vite-ignore */ file.path);
            const action = mod.default || mod.action;
            return action ? action(ctx) : null;
          };
          break;
        default:
          // Handle unknown file types (api, notFound)
          break;
      }

      // Add route group info to meta
      if (file.isGroup && file.groupName) {
        route.meta!.group = file.groupName;
      }
    }

    if (route.path) {
      routeMap.set(route.path, route as RouteDefinition);
      routes.push(route as RouteDefinition);
    }
  }

  // Build hierarchy
  return sortRoutesBySpecificity(routes);
}

/**
 * Validate route configuration
 */
export function validateRoutes(routes: RouteDefinition[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const route of routes) {
    // Must have path
    if (!route.path) {
      errors.push('Route missing path');
      continue;
    }

    // Must have component or lazy loader
    if (!route.component && !route.lazy && (!route.children || route.children.length === 0)) {
      errors.push(`Route ${route.path} has no component or children`);
    }

    // Validate children recursively
    if (route.children) {
      const childResult = validateRoutes(route.children);
      errors.push(...childResult.errors);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
