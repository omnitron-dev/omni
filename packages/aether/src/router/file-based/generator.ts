/**
 * Route Generator
 *
 * Generates route configurations from scanned files
 */

import type { RouteDefinition } from '../../router/types.js';
import {
  scanRouteFiles,
  groupFilesByDirectory,
  buildRouteTree,
  validateRoutes,
  DEFAULT_CONVENTIONS,
  type RouteFile,
  type FileConventions,
} from './scanner.js';

/**
 * Generator configuration
 */
export interface GeneratorConfig {
  /** Base path for routes */
  basePath?: string;
  /** File conventions */
  conventions?: FileConventions;
  /** Include API routes? */
  includeApi?: boolean;
  /** Generate type definitions? */
  generateTypes?: boolean;
  /** Output directory for generated files */
  outDir?: string;
}

/**
 * Generated route manifest
 */
export interface RouteManifest {
  /** All routes */
  routes: RouteDefinition[];
  /** API routes (separate) */
  apiRoutes: RouteDefinition[];
  /** Route groups */
  groups: Map<string, RouteDefinition[]>;
  /** Route file mapping */
  fileMap: Map<string, RouteFile>;
  /** Generated at timestamp */
  generatedAt: Date;
  /** Validation result */
  validation: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
}

/**
 * Generate routes from file list
 */
export async function generateRoutes(files: string[], config: GeneratorConfig = {}): Promise<RouteManifest> {
  const { conventions = DEFAULT_CONVENTIONS, includeApi = true } = config;

  // Scan and categorize files
  const routeFiles = scanRouteFiles(files, conventions);

  // Separate API routes
  const apiFiles = routeFiles.filter((f) => f.isApi);
  const pageFiles = routeFiles.filter((f) => !f.isApi);

  // Group by directory
  const pageGroups = groupFilesByDirectory(pageFiles);
  const apiGroups = groupFilesByDirectory(apiFiles);

  // Build route trees
  const routes = buildRouteTree(pageFiles, pageGroups);
  const apiRoutes = includeApi ? buildApiRoutes(apiFiles, apiGroups) : [];

  // Group routes by route group metadata
  const groups = new Map<string, RouteDefinition[]>();
  for (const route of routes) {
    if (route.meta?.group) {
      const groupName = route.meta.group as string;
      const existing = groups.get(groupName) || [];
      existing.push(route);
      groups.set(groupName, existing);
    }
  }

  // Create file map
  const fileMap = new Map<string, RouteFile>();
  for (const file of routeFiles) {
    fileMap.set(file.path, file);
  }

  // Validate routes
  const validation = validateRoutes([...routes, ...apiRoutes]);
  const warnings: string[] = [];

  // Add warnings for missing files
  for (const route of routes) {
    if (!route.component && !route.lazy) {
      warnings.push(`Route ${route.path} has no component defined`);
    }
  }

  return {
    routes,
    apiRoutes,
    groups,
    fileMap,
    generatedAt: new Date(),
    validation: {
      valid: validation.valid,
      errors: validation.errors,
      warnings,
    },
  };
}

/**
 * Build API routes from files
 */
function buildApiRoutes(apiFiles: RouteFile[], _groups: Map<string, RouteFile[]>): RouteDefinition[] {
  const routes: RouteDefinition[] = [];
  const routeMap = new Map<string, Partial<RouteDefinition>>();

  // Group API files by route path
  const pathGroups = new Map<string, RouteFile[]>();
  for (const file of apiFiles) {
    const existing = pathGroups.get(file.routePath) || [];
    existing.push(file);
    pathGroups.set(file.routePath, existing);
  }

  // Create API route definitions
  for (const [routePath, files] of pathGroups) {
    const route: Partial<RouteDefinition> = {
      path: routePath,
      meta: {
        type: 'api',
        methods: [] as string[],
      },
    };

    // API routes are handled differently - they export HTTP method handlers
    const _apiHandlers: Record<string, any> = {};

    for (const file of files) {
      // API route will be loaded dynamically and methods extracted
      route.lazy = async () => {
        const mod = await import(/* @vite-ignore */ file.path);

        // Extract HTTP method handlers
        const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
        const handlers: Record<string, any> = {};

        for (const method of methods) {
          if (mod[method]) {
            handlers[method] = mod[method];
            (route.meta!.methods as string[]).push(method);
          }
        }

        // Default export might be a handler object
        if (mod.default && typeof mod.default === 'object') {
          Object.assign(handlers, mod.default);
        }

        return {
          default: handlers,
          ...handlers,
        };
      };
    }

    if (route.path) {
      routeMap.set(route.path, route);
      routes.push(route as RouteDefinition);
    }
  }

  return routes;
}

/**
 * Generate route manifest JSON
 */
export function generateManifestJson(manifest: RouteManifest): string {
  const simplified = {
    routes: manifest.routes.map(simplifyRoute),
    apiRoutes: manifest.apiRoutes.map(simplifyRoute),
    groups: Object.fromEntries(
      Array.from(manifest.groups.entries()).map(([key, routes]) => [key, routes.map(simplifyRoute)])
    ),
    generatedAt: manifest.generatedAt.toISOString(),
    validation: manifest.validation,
    stats: {
      totalRoutes: manifest.routes.length,
      apiRoutes: manifest.apiRoutes.length,
      groups: manifest.groups.size,
      files: manifest.fileMap.size,
    },
  };

  return JSON.stringify(simplified, null, 2);
}

/**
 * Simplify route for JSON serialization (remove functions)
 */
function simplifyRoute(route: RouteDefinition): any {
  return {
    path: route.path,
    hasComponent: !!route.component || !!route.lazy,
    hasLayout: !!route.layout,
    hasError: !!route.errorBoundary,
    hasLoading: !!route.loading,
    hasLoader: !!route.loader,
    hasAction: !!route.action,
    hasGuards: !!route.guards && route.guards.length > 0,
    children: route.children?.map(simplifyRoute),
    meta: route.meta,
  };
}

/**
 * Generate TypeScript route types
 */
export function generateRouteTypes(manifest: RouteManifest): string {
  const lines: string[] = [];

  lines.push('/**');
  lines.push(' * Generated Route Types');
  lines.push(' * DO NOT EDIT - Generated by Aether file-based routing');
  lines.push(' */');
  lines.push('');

  // Generate route paths type
  lines.push('export type RoutePaths =');
  const allRoutes = [...manifest.routes, ...manifest.apiRoutes];
  const paths = allRoutes.map((r) => `  | '${r.path}'`);
  lines.push(paths.join('\n') || "  | '/'");
  lines.push(';');
  lines.push('');

  // Generate params types for dynamic routes
  lines.push('export interface RouteParams {');
  for (const route of allRoutes) {
    const params = extractParamsFromPath(route.path);
    if (params.length > 0) {
      lines.push(`  '${route.path}': {`);
      for (const param of params) {
        const type = param.includes('...') ? 'string[]' : 'string';
        const optional = param.includes('?') ? '?' : '';
        const cleanParam = param.replace(/[?*]/g, '');
        lines.push(`    ${cleanParam}${optional}: ${type};`);
      }
      lines.push('  };');
    }
  }
  lines.push('}');
  lines.push('');

  // Generate route groups type
  if (manifest.groups.size > 0) {
    lines.push('export type RouteGroups =');
    const groupNames = Array.from(manifest.groups.keys()).map((g) => `  | '${g}'`);
    lines.push(groupNames.join('\n'));
    lines.push(';');
    lines.push('');
  }

  // Generate API routes type
  if (manifest.apiRoutes.length > 0) {
    lines.push('export type ApiRoutePaths =');
    const apiPaths = manifest.apiRoutes.map((r) => `  | '${r.path}'`);
    lines.push(apiPaths.join('\n'));
    lines.push(';');
    lines.push('');

    // Generate API methods type
    lines.push('export interface ApiMethods {');
    for (const route of manifest.apiRoutes) {
      if (route.meta?.methods && Array.isArray(route.meta.methods)) {
        const methods = route.meta.methods as string[];
        lines.push(`  '${route.path}': ${methods.map((m) => `'${m}'`).join(' | ')};`);
      }
    }
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Extract parameter names from route path
 */
function extractParamsFromPath(path: string): string[] {
  const params: string[] = [];
  const regex = /:([a-zA-Z_$][a-zA-Z0-9_$]*)\??|\*([a-zA-Z_$][a-zA-Z0-9_$]*)\??/g;

  let match;
  while ((match = regex.exec(path)) !== null) {
    const param = match[1] || `...${match[2]}`;
    const optional = match[0].endsWith('?') ? '?' : '';
    params.push(param + optional);
  }

  return params;
}

/**
 * Generate route manifest for development
 */
export function generateDevManifest(manifest: RouteManifest): string {
  const lines: string[] = [];

  lines.push('# Route Manifest');
  lines.push('');
  lines.push(`Generated: ${manifest.generatedAt.toISOString()}`);
  lines.push('');

  // Stats
  lines.push('## Statistics');
  lines.push('');
  lines.push(`- Total Routes: ${manifest.routes.length}`);
  lines.push(`- API Routes: ${manifest.apiRoutes.length}`);
  lines.push(`- Route Groups: ${manifest.groups.size}`);
  lines.push(`- Files: ${manifest.fileMap.size}`);
  lines.push('');

  // Validation
  lines.push('## Validation');
  lines.push('');
  if (manifest.validation.valid) {
    lines.push('✅ All routes valid');
  } else {
    lines.push('❌ Validation errors:');
    for (const error of manifest.validation.errors) {
      lines.push(`  - ${error}`);
    }
  }

  if (manifest.validation.warnings.length > 0) {
    lines.push('');
    lines.push('⚠️  Warnings:');
    for (const warning of manifest.validation.warnings) {
      lines.push(`  - ${warning}`);
    }
  }
  lines.push('');

  // Routes
  lines.push('## Page Routes');
  lines.push('');
  for (const route of manifest.routes) {
    lines.push(formatRouteTree(route, 0));
  }
  lines.push('');

  // API Routes
  if (manifest.apiRoutes.length > 0) {
    lines.push('## API Routes');
    lines.push('');
    for (const route of manifest.apiRoutes) {
      const methods = (route.meta?.methods as string[]) || [];
      lines.push(`- ${route.path} [${methods.join(', ')}]`);
    }
    lines.push('');
  }

  // Groups
  if (manifest.groups.size > 0) {
    lines.push('## Route Groups');
    lines.push('');
    for (const [groupName, routes] of manifest.groups) {
      lines.push(`### (${groupName})`);
      lines.push('');
      for (const route of routes) {
        lines.push(`- ${route.path}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Format route tree for display
 */
function formatRouteTree(route: RouteDefinition, depth: number): string {
  const indent = '  '.repeat(depth);
  const features: string[] = [];

  if (route.loader) features.push('loader');
  if (route.action) features.push('action');
  if (route.layout) features.push('layout');
  if (route.errorBoundary) features.push('error');
  if (route.loading) features.push('loading');
  if (route.guards) features.push('guards');

  const suffix = features.length > 0 ? ` [${features.join(', ')}]` : '';
  let result = `${indent}- ${route.path}${suffix}\n`;

  if (route.children) {
    for (const child of route.children) {
      result += formatRouteTree(child, depth + 1);
    }
  }

  return result;
}
