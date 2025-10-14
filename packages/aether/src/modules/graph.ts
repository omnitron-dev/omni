/**
 * Module Graph
 *
 * Dependency graph management for modules
 */

import type { ModuleDefinition, ModuleNode, SplitPoint } from '../di/types.js';

/**
 * Load strategy for modules
 */
export type LoadStrategy = 'preload' | 'prefetch' | 'lazy';

/**
 * Module dependency graph
 *
 * Manages module dependencies, detects circular dependencies,
 * and determines optimal load order
 */
export class ModuleGraph {
  private nodes = new Map<string, ModuleNode>();
  private edges = new Map<string, Set<string>>();
  private reverseEdges = new Map<string, Set<string>>();

  /**
   * Add a module node to the graph
   */
  addNode(id: string, data: ModuleDefinition): void {
    this.nodes.set(id, { id, data });
    if (!this.edges.has(id)) {
      this.edges.set(id, new Set());
    }
    if (!this.reverseEdges.has(id)) {
      this.reverseEdges.set(id, new Set());
    }
  }

  /**
   * Add an edge between two modules (from depends on to)
   */
  addEdge(from: string, to: string): void {
    this.edges.get(from)?.add(to);
    this.reverseEdges.get(to)?.add(from);
  }

  /**
   * Get a module node by ID
   */
  getNode(id: string): ModuleNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Get all nodes
   */
  getNodes(): ModuleNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get dependencies of a module
   */
  getDependencies(id: string): string[] {
    return Array.from(this.edges.get(id) || []);
  }

  /**
   * Get dependents of a module (modules that depend on this one)
   */
  getDependents(id: string): string[] {
    return Array.from(this.reverseEdges.get(id) || []);
  }

  /**
   * Find circular dependencies in the graph
   *
   * @returns Array of cycles, where each cycle is an array of module IDs
   */
  findCircularDependencies(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const stack = new Set<string>();

    const dfs = (node: string, path: string[]): void => {
      if (stack.has(node)) {
        // Found cycle
        const cycleStart = path.indexOf(node);
        if (cycleStart !== -1) {
          cycles.push([...path.slice(cycleStart), node]);
        }
        return;
      }

      if (visited.has(node)) return;

      visited.add(node);
      stack.add(node);

      const deps = this.edges.get(node) || new Set();
      for (const dep of deps) {
        dfs(dep, [...path, node]);
      }

      stack.delete(node);
    };

    for (const node of this.nodes.keys()) {
      if (!visited.has(node)) {
        dfs(node, []);
      }
    }

    return cycles;
  }

  /**
   * Get optimal load order for modules
   *
   * Uses topological sort to determine the order in which
   * modules should be loaded (dependencies first)
   *
   * @returns Array of module IDs in load order
   */
  getLoadOrder(): string[] {
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (node: string): void => {
      if (visited.has(node)) return;
      visited.add(node);

      const deps = this.edges.get(node) || new Set();
      for (const dep of deps) {
        visit(dep);
      }

      order.push(node);
    };

    for (const node of this.nodes.keys()) {
      visit(node);
    }

    return order;
  }

  /**
   * Find shared dependencies between modules
   *
   * @returns Map of module ID to list of modules that depend on it
   */
  getSharedDependencies(): Map<string, string[]> {
    const shared = new Map<string, string[]>();

    for (const [moduleId, dependents] of this.reverseEdges) {
      if (dependents.size > 1) {
        shared.set(moduleId, Array.from(dependents));
      }
    }

    return shared;
  }

  /**
   * Get split points for code splitting
   *
   * Identifies modules that should be split into separate bundles
   * based on lazy loading, optimization hints, and size estimates
   *
   * @returns Array of split point definitions
   */
  getSplitPoints(): SplitPoint[] {
    const points: SplitPoint[] = [];

    for (const [id, node] of this.nodes) {
      const definition = node.data;

      // Check if module should be a split point
      if (this.isSplitPoint(id, definition)) {
        points.push({
          module: id,
          strategy: this.getLoadStrategy(definition),
          size: this.estimateSize(id),
        });
      }
    }

    return points;
  }

  /**
   * Check if a module is a split point
   */
  private isSplitPoint(id: string, definition: ModuleDefinition): boolean {
    // Explicit split chunk
    if (definition.optimization?.splitChunk) {
      return true;
    }

    // Lazy boundary
    if (definition.optimization?.lazyBoundary) {
      return true;
    }

    // Has routes (likely a feature module)
    if (definition.routes && definition.routes.length > 0) {
      return true;
    }

    // Large number of providers (likely a substantial module)
    if (definition.providers && definition.providers.length > 10) {
      return true;
    }

    return false;
  }

  /**
   * Get load strategy for a module
   */
  private getLoadStrategy(definition: ModuleDefinition): LoadStrategy {
    // Check optimization hints
    if (definition.optimization?.priority === 'high') {
      return 'preload';
    }

    if (definition.optimization?.preloadModules?.includes(definition.id)) {
      return 'preload';
    }

    if (definition.optimization?.prefetchModules?.includes(definition.id)) {
      return 'prefetch';
    }

    // Default to lazy for split points
    return 'lazy';
  }

  /**
   * Estimate module size
   *
   * This is a rough estimate based on module contents.
   * In production, actual bundle sizes would be used.
   */
  private estimateSize(id: string): number {
    const node = this.nodes.get(id);
    if (!node) return 0;

    const definition = node.data;
    let size = 10000; // Base size

    // Add estimated size for providers
    if (definition.providers) {
      size += definition.providers.length * 1000;
    }

    // Add estimated size for stores
    if (definition.stores) {
      size += definition.stores.length * 2000;
    }

    // Add estimated size for routes
    if (definition.routes) {
      size += definition.routes.length * 5000;
    }

    // Add estimated size for islands
    if (definition.islands) {
      size += definition.islands.length * 3000;
    }

    // Check if budget is specified
    if (definition.optimization?.budget?.maxSize) {
      size = Math.min(size, definition.optimization.budget.maxSize);
    }

    return size;
  }

  /**
   * Get transitive dependencies of a module
   *
   * @param id - Module ID
   * @returns Set of all transitive dependencies
   */
  getTransitiveDependencies(id: string): Set<string> {
    const deps = new Set<string>();
    const visited = new Set<string>();

    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const nodeDeps = this.edges.get(nodeId) || new Set();
      for (const dep of nodeDeps) {
        deps.add(dep);
        visit(dep);
      }
    };

    visit(id);
    return deps;
  }

  /**
   * Check if module A depends on module B (directly or transitively)
   */
  dependsOn(a: string, b: string): boolean {
    const deps = this.getTransitiveDependencies(a);
    return deps.has(b);
  }

  /**
   * Get module depth in dependency tree
   *
   * Depth is the longest path from any root module to this module
   */
  getDepth(id: string): number {
    const visited = new Map<string, number>();
    const visiting = new Set<string>();

    const calculateDepth = (nodeId: string): number => {
      if (visited.has(nodeId)) {
        return visited.get(nodeId)!;
      }

      // Detect circular dependency
      if (visiting.has(nodeId)) {
        // Return 0 to break the cycle
        return 0;
      }

      visiting.add(nodeId);

      const deps = this.edges.get(nodeId) || new Set();
      if (deps.size === 0) {
        visited.set(nodeId, 0);
        visiting.delete(nodeId);
        return 0;
      }

      let maxDepth = 0;
      for (const dep of deps) {
        const depDepth = calculateDepth(dep);
        maxDepth = Math.max(maxDepth, depDepth + 1);
      }

      visited.set(nodeId, maxDepth);
      visiting.delete(nodeId);
      return maxDepth;
    };

    return calculateDepth(id);
  }

  /**
   * Clear the graph
   */
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.reverseEdges.clear();
  }

  /**
   * Get graph statistics
   */
  getStats(): {
    nodeCount: number;
    edgeCount: number;
    maxDepth: number;
    avgDependencies: number;
    circularDependencies: number;
  } {
    const edgeCount = Array.from(this.edges.values()).reduce((sum, set) => sum + set.size, 0);

    const depths = Array.from(this.nodes.keys()).map((id) => this.getDepth(id));
    const maxDepth = Math.max(0, ...depths);

    const avgDependencies =
      this.nodes.size > 0
        ? Array.from(this.edges.values()).reduce((sum, set) => sum + set.size, 0) / this.nodes.size
        : 0;

    const cycles = this.findCircularDependencies();

    return {
      nodeCount: this.nodes.size,
      edgeCount,
      maxDepth,
      avgDependencies,
      circularDependencies: cycles.length,
    };
  }
}
