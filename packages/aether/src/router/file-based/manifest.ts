/**
 * Route Manifest
 *
 * Build-time route manifest generation for type safety and optimization
 */

import type { RouteDefinition } from '../../router/types.js';

/**
 * Route entry in manifest
 */
export interface ManifestRouteEntry {
  /** Route path pattern */
  path: string;
  /** File path */
  file: string;
  /** Route type */
  type: 'page' | 'api';
  /** Has loader? */
  hasLoader: boolean;
  /** Has action? */
  hasAction: boolean;
  /** Has layout? */
  hasLayout: boolean;
  /** Has error boundary? */
  hasError: boolean;
  /** Has loading component? */
  hasLoading: boolean;
  /** Has middleware/guards? */
  hasGuards: boolean;
  /** Parameters in path */
  params: string[];
  /** HTTP methods (for API routes) */
  methods?: string[];
  /** Route group */
  group?: string;
  /** Child routes */
  children?: ManifestRouteEntry[];
  /** Route metadata */
  meta?: Record<string, any>;
}

/**
 * Compiled route manifest
 */
export interface CompiledManifest {
  /** Manifest version */
  version: string;
  /** Generated timestamp */
  generatedAt: string;
  /** All routes */
  routes: ManifestRouteEntry[];
  /** API routes */
  apiRoutes: ManifestRouteEntry[];
  /** Route groups */
  groups: Record<string, string[]>;
  /** Route ID to file mapping */
  fileMap: Record<string, string>;
  /** Statistics */
  stats: {
    totalRoutes: number;
    pageRoutes: number;
    apiRoutes: number;
    groups: number;
    filesScanned: number;
  };
}

/**
 * Build manifest from route definitions
 */
export function buildManifest(
  routes: RouteDefinition[],
  apiRoutes: RouteDefinition[],
  fileMap: Map<string, string>
): CompiledManifest {
  const manifestRoutes: ManifestRouteEntry[] = [];
  const manifestApiRoutes: ManifestRouteEntry[] = [];
  const groups: Record<string, string[]> = {};

  // Process page routes
  for (const route of routes) {
    const entry = buildManifestEntry(route, fileMap);
    manifestRoutes.push(entry);

    // Track groups
    if (route.meta?.group) {
      const groupName = route.meta.group as string;
      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(route.path);
    }
  }

  // Process API routes
  for (const route of apiRoutes) {
    const entry = buildManifestEntry(route, fileMap);
    entry.type = 'api';
    manifestApiRoutes.push(entry);
  }

  return {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    routes: manifestRoutes,
    apiRoutes: manifestApiRoutes,
    groups,
    fileMap: Object.fromEntries(fileMap.entries()),
    stats: {
      totalRoutes: manifestRoutes.length + manifestApiRoutes.length,
      pageRoutes: manifestRoutes.length,
      apiRoutes: manifestApiRoutes.length,
      groups: Object.keys(groups).length,
      filesScanned: fileMap.size,
    },
  };
}

/**
 * Build manifest entry from route
 */
function buildManifestEntry(route: RouteDefinition, fileMap: Map<string, string>): ManifestRouteEntry {
  return {
    path: route.path,
    file: findFileForRoute(route.path, fileMap),
    type: 'page',
    hasLoader: !!route.loader,
    hasAction: !!route.action,
    hasLayout: !!route.layout,
    hasError: !!route.errorBoundary,
    hasLoading: !!route.loading,
    hasGuards: !!route.guards && route.guards.length > 0,
    params: extractParams(route.path),
    methods: route.meta?.methods as string[] | undefined,
    group: route.meta?.group as string | undefined,
    children: route.children?.map((child) => buildManifestEntry(child, fileMap)),
    meta: route.meta,
  };
}

/**
 * Find file path for route
 */
function findFileForRoute(routePath: string, fileMap: Map<string, string>): string {
  // Try to find exact match
  for (const [file, route] of fileMap.entries()) {
    if (route === routePath) {
      return file;
    }
  }
  return 'unknown';
}

/**
 * Extract parameters from route path
 */
function extractParams(path: string): string[] {
  const params: string[] = [];
  const regex = /:([a-zA-Z_$][a-zA-Z0-9_$]*)\??|\*([a-zA-Z_$][a-zA-Z0-9_$]*)\??/g;

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
 * Serialize manifest to JSON
 */
export function serializeManifest(manifest: CompiledManifest): string {
  return JSON.stringify(manifest, null, 2);
}

/**
 * Parse manifest from JSON
 */
export function parseManifest(json: string): CompiledManifest {
  return JSON.parse(json);
}

/**
 * Validate manifest
 */
export function validateManifest(manifest: CompiledManifest): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check version
  if (!manifest.version) {
    errors.push('Manifest missing version');
  }

  // Check generated timestamp
  if (!manifest.generatedAt) {
    errors.push('Manifest missing generated timestamp');
  }

  // Validate routes
  if (!manifest.routes || !Array.isArray(manifest.routes)) {
    errors.push('Manifest missing routes array');
  } else {
    for (const route of manifest.routes) {
      const routeErrors = validateManifestEntry(route);
      errors.push(...routeErrors);

      // Warnings for missing features
      if (!route.hasError) {
        warnings.push(`Route ${route.path} has no error boundary`);
      }
    }
  }

  // Validate API routes
  if (!manifest.apiRoutes || !Array.isArray(manifest.apiRoutes)) {
    errors.push('Manifest missing apiRoutes array');
  } else {
    for (const route of manifest.apiRoutes) {
      if (!route.methods || route.methods.length === 0) {
        warnings.push(`API route ${route.path} has no HTTP methods defined`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate manifest entry
 */
function validateManifestEntry(entry: ManifestRouteEntry): string[] {
  const errors: string[] = [];

  if (!entry.path) {
    errors.push('Route entry missing path');
  }

  if (!entry.file) {
    errors.push(`Route ${entry.path} missing file reference`);
  }

  // Validate children recursively
  if (entry.children) {
    for (const child of entry.children) {
      errors.push(...validateManifestEntry(child));
    }
  }

  return errors;
}

/**
 * Generate manifest statistics
 */
export function generateManifestStats(manifest: CompiledManifest): {
  summary: string;
  details: Record<string, any>;
} {
  const totalRoutes = manifest.stats.totalRoutes;
  const avgParamsPerRoute = manifest.routes.reduce((sum, r) => sum + r.params.length, 0) / manifest.routes.length || 0;

  const routesWithLoaders = manifest.routes.filter((r) => r.hasLoader).length;
  const routesWithActions = manifest.routes.filter((r) => r.hasAction).length;
  const routesWithLayouts = manifest.routes.filter((r) => r.hasLayout).length;
  const routesWithErrors = manifest.routes.filter((r) => r.hasError).length;

  const summary = `
Aether Route Manifest Statistics
================================

Total Routes:     ${totalRoutes}
  - Page Routes:  ${manifest.stats.pageRoutes}
  - API Routes:   ${manifest.stats.apiRoutes}

Route Groups:     ${manifest.stats.groups}
Files Scanned:    ${manifest.stats.filesScanned}

Features:
  - Loaders:      ${routesWithLoaders} (${Math.round((routesWithLoaders / manifest.routes.length) * 100)}%)
  - Actions:      ${routesWithActions} (${Math.round((routesWithActions / manifest.routes.length) * 100)}%)
  - Layouts:      ${routesWithLayouts} (${Math.round((routesWithLayouts / manifest.routes.length) * 100)}%)
  - Errors:       ${routesWithErrors} (${Math.round((routesWithErrors / manifest.routes.length) * 100)}%)

Avg Params/Route: ${avgParamsPerRoute.toFixed(2)}

Generated: ${new Date(manifest.generatedAt).toLocaleString()}
`.trim();

  const details = {
    total: totalRoutes,
    page: manifest.stats.pageRoutes,
    api: manifest.stats.apiRoutes,
    groups: manifest.stats.groups,
    files: manifest.stats.filesScanned,
    features: {
      loaders: routesWithLoaders,
      actions: routesWithActions,
      layouts: routesWithLayouts,
      errors: routesWithErrors,
    },
    avgParams: avgParamsPerRoute,
    generatedAt: manifest.generatedAt,
  };

  return { summary, details };
}

/**
 * Generate route manifest markdown
 */
export function generateManifestMarkdown(manifest: CompiledManifest): string {
  const lines: string[] = [];

  lines.push('# Route Manifest');
  lines.push('');
  lines.push(`> Generated: ${new Date(manifest.generatedAt).toLocaleString()}`);
  lines.push('');

  // Statistics
  lines.push('## Statistics');
  lines.push('');
  const { summary } = generateManifestStats(manifest);
  lines.push('```');
  lines.push(summary);
  lines.push('```');
  lines.push('');

  // Page Routes
  lines.push('## Page Routes');
  lines.push('');
  for (const route of manifest.routes) {
    lines.push(formatRouteEntry(route, 0));
  }
  lines.push('');

  // API Routes
  if (manifest.apiRoutes.length > 0) {
    lines.push('## API Routes');
    lines.push('');
    lines.push('| Path | Methods | Features |');
    lines.push('|------|---------|----------|');
    for (const route of manifest.apiRoutes) {
      const methods = route.methods?.join(', ') || 'N/A';
      const features = [];
      if (route.hasGuards) features.push('guards');
      if (route.hasLoader) features.push('loader');
      lines.push(`| ${route.path} | ${methods} | ${features.join(', ') || '-'} |`);
    }
    lines.push('');
  }

  // Groups
  if (Object.keys(manifest.groups).length > 0) {
    lines.push('## Route Groups');
    lines.push('');
    for (const [group, paths] of Object.entries(manifest.groups)) {
      lines.push(`### (${group})`);
      lines.push('');
      for (const path of paths) {
        lines.push(`- ${path}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Format route entry for markdown
 */
function formatRouteEntry(entry: ManifestRouteEntry, depth: number): string {
  const indent = '  '.repeat(depth);
  const features: string[] = [];

  if (entry.hasLoader) features.push('loader');
  if (entry.hasAction) features.push('action');
  if (entry.hasLayout) features.push('layout');
  if (entry.hasError) features.push('error');
  if (entry.hasLoading) features.push('loading');
  if (entry.hasGuards) features.push('guards');

  const params = entry.params.length > 0 ? ` [params: ${entry.params.join(', ')}]` : '';
  const suffix = features.length > 0 ? ` [${features.join(', ')}]` : '';

  let result = `${indent}- **${entry.path}**${params}${suffix}\n`;

  if (entry.children) {
    for (const child of entry.children) {
      result += formatRouteEntry(child, depth + 1);
    }
  }

  return result;
}
