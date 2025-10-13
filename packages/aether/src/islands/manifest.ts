/**
 * Island Manifest Generation
 *
 * Build-time analysis and manifest generation for islands
 */

import type { IslandManifest, IslandManifestEntry, IslandComponent } from './types.js';
import { detectInteractivity, estimateComponentSize } from './detector.js';

/**
 * Island registry for build-time tracking
 */
const islandRegistry = new Map<string, IslandComponent>();

/**
 * Route to islands mapping
 */
const routeIslands = new Map<string, Set<string>>();

/**
 * Register an island component
 *
 * Called at build time to track all islands
 *
 * @param island - Island component
 * @param path - File path
 * @returns Island ID
 */
export function registerIsland(island: IslandComponent, path: string): string {
  const id = island.__islandId;

  if (!id) {
    throw new Error('[Aether Islands] Island component must have an __islandId');
  }

  islandRegistry.set(id, island);

  return id;
}

/**
 * Register island usage in a route
 *
 * @param routePath - Route path
 * @param islandId - Island ID
 */
export function registerRouteIsland(routePath: string, islandId: string): void {
  if (!routeIslands.has(routePath)) {
    routeIslands.set(routePath, new Set());
  }

  routeIslands.get(routePath)!.add(islandId);
}

/**
 * Generate island manifest
 *
 * Creates a manifest of all islands with their metadata
 *
 * @returns Island manifest
 */
export function generateManifest(): IslandManifest {
  const islands: Record<string, IslandManifestEntry> = {};

  // Process each registered island
  for (const [id, island] of islandRegistry.entries()) {
    const options = island.__islandOptions;
    const detection = detectInteractivity(island);
    const size = estimateComponentSize(island);

    const entry: IslandManifestEntry = {
      id,
      name: options.name || island.displayName || island.name,
      path: '', // Will be filled by build tool
      chunk: `islands/${id}.js`,
      strategy: options.hydrate || detection.recommendedStrategy || 'immediate',
      dependencies: [], // Will be analyzed by build tool
      size,
      used: false,
    };

    islands[id] = entry;
  }

  // Mark islands as used based on route mapping
  for (const [_routePath, islandIds] of routeIslands.entries()) {
    for (const islandId of islandIds) {
      if (islands[islandId]) {
        islands[islandId].used = true;
      }
    }
  }

  // Build routes mapping
  const routes: Record<string, string[]> = {};
  for (const [routePath, islandIds] of routeIslands.entries()) {
    routes[routePath] = Array.from(islandIds);
  }

  return {
    islands,
    routes,
    timestamp: Date.now(),
    version: '1.0.0',
  };
}

/**
 * Load island manifest
 *
 * Loads the manifest from a JSON file or object
 *
 * @param source - Manifest source (JSON string or object)
 * @returns Parsed manifest
 */
export function loadManifest(source: string | IslandManifest): IslandManifest {
  if (typeof source === 'string') {
    return JSON.parse(source) as IslandManifest;
  }
  return source;
}

/**
 * Get islands for a route
 *
 * @param manifest - Island manifest
 * @param routePath - Route path
 * @returns Island IDs used in the route
 */
export function getRouteIslands(manifest: IslandManifest, routePath: string): string[] {
  return manifest.routes[routePath] || [];
}

/**
 * Get island entry from manifest
 *
 * @param manifest - Island manifest
 * @param islandId - Island ID
 * @returns Island manifest entry
 */
export function getIslandEntry(manifest: IslandManifest, islandId: string): IslandManifestEntry | undefined {
  return manifest.islands[islandId];
}

/**
 * Get all islands using a specific strategy
 *
 * @param manifest - Island manifest
 * @param strategy - Hydration strategy
 * @returns Island IDs
 */
export function getIslandsByStrategy(manifest: IslandManifest, strategy: string): string[] {
  return Object.entries(manifest.islands)
    .filter(([, entry]) => entry.strategy === strategy)
    .map(([id]) => id);
}

/**
 * Calculate total bundle size for a route
 *
 * @param manifest - Island manifest
 * @param routePath - Route path
 * @returns Total size in bytes
 */
export function calculateRouteSize(manifest: IslandManifest, routePath: string): number {
  const islandIds = getRouteIslands(manifest, routePath);

  return islandIds.reduce((total, islandId) => {
    const entry = getIslandEntry(manifest, islandId);
    return total + (entry?.size || 0);
  }, 0);
}

/**
 * Optimize manifest by removing unused islands
 *
 * @param manifest - Island manifest
 * @returns Optimized manifest
 */
export function optimizeManifest(manifest: IslandManifest): IslandManifest {
  const optimized = { ...manifest };

  // Remove unused islands
  optimized.islands = Object.fromEntries(
    Object.entries(manifest.islands).filter(([, entry]) => entry.used),
  );

  return optimized;
}

/**
 * Generate preload hints for a route
 *
 * Creates <link rel="modulepreload"> hints for critical islands
 *
 * @param manifest - Island manifest
 * @param routePath - Route path
 * @returns HTML preload links
 */
export function generatePreloadHints(manifest: IslandManifest, routePath: string): string {
  const islandIds = getRouteIslands(manifest, routePath);

  // Only preload immediate hydration islands
  const criticalIslands = islandIds
    .map((id) => getIslandEntry(manifest, id))
    .filter((entry): entry is IslandManifestEntry => entry?.strategy === 'immediate');

  return criticalIslands
    .map((entry) => `<link rel="modulepreload" href="/${entry.chunk}">`)
    .join('\n');
}

/**
 * Generate island loader script
 *
 * Creates the client-side script that loads and hydrates islands
 *
 * @param manifest - Island manifest
 * @param routePath - Route path
 * @returns JavaScript code
 */
export function generateIslandLoader(manifest: IslandManifest, routePath: string): string {
  const islandIds = getRouteIslands(manifest, routePath);
  const islands = islandIds.map((id) => getIslandEntry(manifest, id)).filter(Boolean);

  const manifestJson = JSON.stringify(manifest);
  const islandsJson = JSON.stringify(islands);

  return `
(function() {
  const manifest = ${manifestJson};
  const islands = ${islandsJson};

  // Import hydration runtime
  import('/islands/runtime.js').then(({ hydrateIslands }) => {
    hydrateIslands(islands, manifest);
  }).catch(err => {
    console.error('[Aether Islands] Failed to load hydration runtime:', err);
  });
})();
  `.trim();
}

/**
 * Dependency graph for islands
 */
export class IslandDependencyGraph {
  private graph = new Map<string, Set<string>>();

  /**
   * Add dependency
   *
   * @param islandId - Island ID
   * @param dependency - Dependency ID
   */
  addDependency(islandId: string, dependency: string): void {
    if (!this.graph.has(islandId)) {
      this.graph.set(islandId, new Set());
    }
    this.graph.get(islandId)!.add(dependency);
  }

  /**
   * Get dependencies for an island
   *
   * @param islandId - Island ID
   * @returns Dependency IDs
   */
  getDependencies(islandId: string): string[] {
    return Array.from(this.graph.get(islandId) || []);
  }

  /**
   * Get all dependencies (recursive)
   *
   * @param islandId - Island ID
   * @returns All dependency IDs
   */
  getAllDependencies(islandId: string): string[] {
    const visited = new Set<string>();
    const result: string[] = [];

    const traverse = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);

      const deps = this.getDependencies(id);
      for (const dep of deps) {
        traverse(dep);
        result.push(dep);
      }
    };

    traverse(islandId);

    return result;
  }

  /**
   * Detect circular dependencies
   *
   * @returns Circular dependency chains
   */
  detectCircular(): string[][] {
    const circular: string[][] = [];
    const visited = new Set<string>();
    const stack: string[] = [];

    const traverse = (id: string) => {
      if (stack.includes(id)) {
        // Found circular dependency
        const cycleStart = stack.indexOf(id);
        circular.push([...stack.slice(cycleStart), id]);
        return;
      }

      if (visited.has(id)) return;

      visited.add(id);
      stack.push(id);

      const deps = this.getDependencies(id);
      for (const dep of deps) {
        traverse(dep);
      }

      stack.pop();
    };

    for (const id of this.graph.keys()) {
      traverse(id);
    }

    return circular;
  }

  /**
   * Topological sort
   *
   * Returns islands in dependency order
   *
   * @returns Sorted island IDs
   */
  topologicalSort(): string[] {
    const visited = new Set<string>();
    const result: string[] = [];

    const traverse = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);

      const deps = this.getDependencies(id);
      for (const dep of deps) {
        traverse(dep);
      }

      result.push(id);
    };

    for (const id of this.graph.keys()) {
      traverse(id);
    }

    return result;
  }
}

/**
 * Build island dependency graph
 *
 * @param manifest - Island manifest
 * @returns Dependency graph
 */
export function buildDependencyGraph(manifest: IslandManifest): IslandDependencyGraph {
  const graph = new IslandDependencyGraph();

  for (const [id, entry] of Object.entries(manifest.islands)) {
    for (const dep of entry.dependencies) {
      graph.addDependency(id, dep);
    }
  }

  return graph;
}

/**
 * Validate manifest
 *
 * Checks for errors and warnings in the manifest
 *
 * @param manifest - Island manifest
 * @returns Validation errors and warnings
 */
export function validateManifest(manifest: IslandManifest): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for missing islands in routes
  for (const [route, islandIds] of Object.entries(manifest.routes)) {
    for (const islandId of islandIds) {
      if (!manifest.islands[islandId]) {
        errors.push(`Route ${route} references non-existent island: ${islandId}`);
      }
    }
  }

  // Check for circular dependencies
  const graph = buildDependencyGraph(manifest);
  const circular = graph.detectCircular();
  if (circular.length > 0) {
    errors.push(`Circular dependencies detected: ${circular.map((c) => c.join(' -> ')).join(', ')}`);
  }

  // Check for large islands
  for (const [id, entry] of Object.entries(manifest.islands)) {
    if (entry.size && entry.size > 100000) {
      warnings.push(`Island ${id} is large (${Math.round(entry.size / 1024)}KB). Consider code splitting.`);
    }
  }

  // Check for unused islands
  const unusedIslands = Object.entries(manifest.islands)
    .filter(([, entry]) => !entry.used)
    .map(([id]) => id);

  if (unusedIslands.length > 0) {
    warnings.push(`Unused islands: ${unusedIslands.join(', ')}`);
  }

  return { errors, warnings };
}
