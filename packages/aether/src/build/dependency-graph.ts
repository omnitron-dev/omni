/**
 * Dependency Graph Optimization
 * Build and optimize dependency graphs for better bundling and analysis
 */

import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Configuration for dependency graph
 */
export interface DependencyGraphConfig {
  /**
   * Root directory
   */
  root?: string;

  /**
   * External dependencies to track
   */
  externals?: string[];

  /**
   * Whether to track circular dependencies
   * @default true
   */
  trackCircular?: boolean;

  /**
   * Whether to calculate module depths
   * @default true
   */
  calculateDepths?: boolean;

  /**
   * Patterns to exclude
   */
  exclude?: (string | RegExp)[];
}

/**
 * Represents a module node in the dependency graph
 */
export interface ModuleNode {
  /** Module ID/path */
  id: string;
  /** Dependencies of this module */
  dependencies: Set<string>;
  /** Modules that depend on this module */
  dependents: Set<string>;
  /** Exported symbols */
  exports: Set<string>;
  /** Imported symbols and their sources */
  imports: Map<string, string>;
  /** Module depth in the graph */
  depth: number;
  /** Module size in bytes */
  size: number;
  /** Whether this is an entry point */
  isEntry: boolean;
  /** Whether this is an external module */
  isExternal: boolean;
  /** Metadata */
  metadata?: Record<string, any>;
}

/**
 * Circular dependency information
 */
export interface CircularDependency {
  /** Modules involved in the cycle */
  cycle: string[];
  /** Cycle length */
  length: number;
}

/**
 * Optimization suggestion
 */
export interface OptimizationSuggestion {
  /** Suggestion type */
  type: 'hoist' | 'split' | 'unused' | 'duplicate' | 'circular';
  /** Severity level */
  severity: 'info' | 'warning' | 'error';
  /** Description */
  message: string;
  /** Affected modules */
  modules: string[];
  /** Potential savings in bytes */
  savings?: number;
}

/**
 * Graph visualization data
 */
export interface GraphVisualization {
  /** Nodes in the graph */
  nodes: Array<{
    id: string;
    label: string;
    size: number;
    depth: number;
    isEntry: boolean;
    isExternal: boolean;
  }>;
  /** Edges between nodes */
  edges: Array<{
    from: string;
    to: string;
    type: 'static' | 'dynamic';
  }>;
}

/**
 * Dependency graph builder and optimizer
 */
export class DependencyGraph {
  private config: Required<DependencyGraphConfig>;
  private nodes: Map<string, ModuleNode> = new Map();
  private entryPoints: Set<string> = new Set();
  private circularDependencies: CircularDependency[] = [];

  constructor(config: DependencyGraphConfig = {}) {
    this.config = {
      root: config.root || process.cwd(),
      externals: config.externals || [],
      trackCircular: config.trackCircular !== false,
      calculateDepths: config.calculateDepths !== false,
      exclude: config.exclude || [],
    };
  }

  /**
   * Add a module to the graph
   */
  addModule(
    id: string,
    options: {
      dependencies?: string[];
      exports?: string[];
      imports?: Map<string, string>;
      size?: number;
      isEntry?: boolean;
      isExternal?: boolean;
      metadata?: Record<string, any>;
    } = {}
  ): void {
    const normalizedId = this.normalizeId(id);

    if (!this.nodes.has(normalizedId)) {
      this.nodes.set(normalizedId, {
        id: normalizedId,
        dependencies: new Set(),
        dependents: new Set(),
        exports: new Set(),
        imports: new Map(),
        depth: 0,
        size: 0,
        isEntry: false,
        isExternal: options.isExternal !== undefined ? options.isExternal : this.isExternal(normalizedId),
        metadata: {},
      });
    }

    const node = this.nodes.get(normalizedId)!;

    // Update isExternal if provided (allow overriding for existing nodes)
    if (options.isExternal !== undefined) {
      node.isExternal = options.isExternal;
    }

    // Update node properties
    if (options.dependencies) {
      for (const dep of options.dependencies) {
        const normalizedDep = this.normalizeId(dep);
        node.dependencies.add(normalizedDep);

        // Ensure dependency node exists
        if (!this.nodes.has(normalizedDep)) {
          this.addModule(normalizedDep);
        }

        // Add reverse reference
        const depNode = this.nodes.get(normalizedDep)!;
        depNode.dependents.add(normalizedId);
      }
    }

    if (options.exports) {
      for (const exp of options.exports) {
        node.exports.add(exp);
      }
    }

    if (options.imports) {
      for (const [symbol, source] of options.imports) {
        node.imports.set(symbol, source);
      }
    }

    if (options.size !== undefined) {
      node.size = options.size;
    }

    if (options.isEntry) {
      node.isEntry = true;
      this.entryPoints.add(normalizedId);
    }

    if (options.metadata) {
      node.metadata = { ...node.metadata, ...options.metadata };
    }
  }

  /**
   * Get a module node
   */
  getModule(id: string): ModuleNode | undefined {
    return this.nodes.get(this.normalizeId(id));
  }

  /**
   * Get all modules
   */
  getAllModules(): ModuleNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get entry points
   */
  getEntryPoints(): string[] {
    return Array.from(this.entryPoints);
  }

  /**
   * Get dependencies of a module
   */
  getDependencies(id: string): string[] {
    const node = this.getModule(id);
    return node ? Array.from(node.dependencies) : [];
  }

  /**
   * Get dependents of a module
   */
  getDependents(id: string): string[] {
    const node = this.getModule(id);
    return node ? Array.from(node.dependents) : [];
  }

  /**
   * Get transitive dependencies (all dependencies recursively)
   */
  getTransitiveDependencies(id: string): Set<string> {
    const visited = new Set<string>();
    const queue = [this.normalizeId(id)];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;

      visited.add(current);
      const node = this.getModule(current);
      if (node) {
        for (const dep of node.dependencies) {
          queue.push(dep);
        }
      }
    }

    visited.delete(this.normalizeId(id)); // Remove self
    return visited;
  }

  /**
   * Get transitive dependents (all modules that depend on this, recursively)
   */
  getTransitiveDependents(id: string): Set<string> {
    const visited = new Set<string>();
    const queue = [this.normalizeId(id)];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;

      visited.add(current);
      const node = this.getModule(current);
      if (node) {
        for (const dependent of node.dependents) {
          queue.push(dependent);
        }
      }
    }

    visited.delete(this.normalizeId(id)); // Remove self
    return visited;
  }

  /**
   * Calculate module depths
   */
  calculateDepths(): void {
    // Reset depths
    for (const node of this.nodes.values()) {
      node.depth = 0;
    }

    // Calculate depths from entry points
    for (const entryId of this.entryPoints) {
      this.calculateDepthFromEntry(entryId, 0, new Set());
    }
  }

  /**
   * Find circular dependencies
   */
  findCircularDependencies(): CircularDependency[] {
    if (!this.config.trackCircular) return [];

    this.circularDependencies = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    for (const node of this.nodes.values()) {
      if (!visited.has(node.id)) {
        this.detectCycles(node.id, visited, recursionStack, []);
      }
    }

    return this.circularDependencies;
  }

  /**
   * Get optimization suggestions
   */
  getOptimizationSuggestions(): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    // Find circular dependencies
    const circular = this.findCircularDependencies();
    for (const cycle of circular) {
      suggestions.push({
        type: 'circular',
        severity: 'warning',
        message: `Circular dependency detected: ${cycle.cycle.join(' -> ')}`,
        modules: cycle.cycle,
      });
    }

    // Find unused exports
    for (const node of this.nodes.values()) {
      if (node.exports.size > 0 && node.dependents.size === 0 && !node.isEntry) {
        suggestions.push({
          type: 'unused',
          severity: 'info',
          message: `Module ${node.id} has exports but no dependents`,
          modules: [node.id],
          savings: node.size,
        });
      }
    }

    // Find common dependencies (hoisting opportunities)
    const commonDeps = this.findCommonDependencies();
    for (const [dep, dependents] of commonDeps) {
      if (dependents.size > 3) {
        suggestions.push({
          type: 'hoist',
          severity: 'info',
          message: `Module ${dep} is used by ${dependents.size} modules - consider hoisting`,
          modules: [dep, ...dependents],
        });
      }
    }

    // Find large modules that could be split
    for (const node of this.nodes.values()) {
      if (node.size > 100000 && node.exports.size > 5) {
        // > 100KB with multiple exports
        suggestions.push({
          type: 'split',
          severity: 'info',
          message: `Large module ${node.id} (${(node.size / 1024).toFixed(2)}KB) with ${node.exports.size} exports - consider splitting`,
          modules: [node.id],
        });
      }
    }

    // Find duplicate dependencies
    const duplicates = this.findDuplicateDependencies();
    for (const [dep, versions] of duplicates) {
      suggestions.push({
        type: 'duplicate',
        severity: 'warning',
        message: `Multiple versions of ${dep} detected: ${versions.join(', ')}`,
        modules: versions,
      });
    }

    return suggestions;
  }

  /**
   * Generate visualization data
   */
  generateVisualization(format: 'dot' | 'json' | 'mermaid' = 'json'): string {
    if (format === 'dot') {
      return this.generateDot();
    } else if (format === 'mermaid') {
      return this.generateMermaid();
    } else {
      return this.generateJSON();
    }
  }

  /**
   * Get graph statistics
   */
  getStatistics(): {
    totalModules: number;
    entryPoints: number;
    externalModules: number;
    averageDepth: number;
    maxDepth: number;
    circularDependencies: number;
    totalSize: number;
    averageDependencies: number;
    isolatedModules: number;
  } {
    const depths = Array.from(this.nodes.values()).map((n) => n.depth);
    const depCounts = Array.from(this.nodes.values()).map((n) => n.dependencies.size);

    return {
      totalModules: this.nodes.size,
      entryPoints: this.entryPoints.size,
      externalModules: Array.from(this.nodes.values()).filter((n) => n.isExternal).length,
      averageDepth: depths.length > 0 ? depths.reduce((a, b) => a + b, 0) / depths.length : 0,
      maxDepth: depths.length > 0 ? Math.max(...depths) : 0,
      circularDependencies: this.findCircularDependencies().length,
      totalSize: Array.from(this.nodes.values()).reduce((sum, n) => sum + n.size, 0),
      averageDependencies: depCounts.length > 0 ? depCounts.reduce((a, b) => a + b, 0) / depCounts.length : 0,
      isolatedModules: Array.from(this.nodes.values()).filter(
        (n) => n.dependencies.size === 0 && n.dependents.size === 0
      ).length,
    };
  }

  /**
   * Export graph data
   */
  export(): Record<string, ModuleNode> {
    const exported: Record<string, ModuleNode> = {};

    for (const [id, node] of this.nodes) {
      exported[id] = {
        ...node,
        dependencies: new Set(node.dependencies),
        dependents: new Set(node.dependents),
        exports: new Set(node.exports),
        imports: new Map(node.imports),
      };
    }

    return exported;
  }

  /**
   * Clear the graph
   */
  clear(): void {
    this.nodes.clear();
    this.entryPoints.clear();
    this.circularDependencies = [];
  }

  /**
   * Normalize module ID
   */
  private normalizeId(id: string): string {
    if (path.isAbsolute(id)) {
      return path.relative(this.config.root, id);
    }
    return id;
  }

  /**
   * Check if module is external
   */
  private isExternal(id: string): boolean {
    return this.config.externals.some((ext) => id.startsWith(ext) || id === ext);
  }

  /**
   * Calculate depth from entry point
   */
  private calculateDepthFromEntry(id: string, depth: number, visited: Set<string>): void {
    if (visited.has(id)) return;
    visited.add(id);

    const node = this.getModule(id);
    if (!node) return;

    // Update depth if this path is deeper
    if (depth > node.depth) {
      node.depth = depth;
    }

    // Recurse into dependencies
    for (const dep of node.dependencies) {
      this.calculateDepthFromEntry(dep, depth + 1, visited);
    }
  }

  /**
   * Detect cycles in the graph
   */
  private detectCycles(id: string, visited: Set<string>, recursionStack: Set<string>, path: string[]): void {
    visited.add(id);
    recursionStack.add(id);
    path.push(id);

    const node = this.getModule(id);
    if (node) {
      for (const dep of node.dependencies) {
        if (!visited.has(dep)) {
          this.detectCycles(dep, visited, recursionStack, path);
        } else if (recursionStack.has(dep)) {
          // Found a cycle
          const cycleStart = path.indexOf(dep);
          const cycle = path.slice(cycleStart);
          cycle.push(dep); // Complete the cycle

          // Check if this cycle is already recorded
          const cycleStr = cycle.join('->');
          const isDuplicate = this.circularDependencies.some((c) => c.cycle.join('->') === cycleStr);

          if (!isDuplicate) {
            this.circularDependencies.push({
              cycle,
              length: cycle.length - 1,
            });
          }
        }
      }
    }

    path.pop();
    recursionStack.delete(id);
  }

  /**
   * Find common dependencies
   */
  private findCommonDependencies(): Map<string, Set<string>> {
    const commonDeps = new Map<string, Set<string>>();

    for (const node of this.nodes.values()) {
      for (const dep of node.dependencies) {
        if (!commonDeps.has(dep)) {
          commonDeps.set(dep, new Set());
        }
        commonDeps.get(dep)!.add(node.id);
      }
    }

    return commonDeps;
  }

  /**
   * Find duplicate dependencies
   */
  private findDuplicateDependencies(): Map<string, string[]> {
    const packageVersions = new Map<string, Set<string>>();

    for (const node of this.nodes.values()) {
      if (node.isExternal) {
        // Extract package name and version
        const match = node.id.match(/^(@?[^@]+)@(.+)$/);
        if (match) {
          const [, pkg, version] = match;
          if (pkg && version) {
            if (!packageVersions.has(pkg)) {
              packageVersions.set(pkg, new Set());
            }
            packageVersions.get(pkg)!.add(node.id);
          }
        }
      }
    }

    const duplicates = new Map<string, string[]>();
    for (const [pkg, versions] of packageVersions) {
      if (versions.size > 1) {
        duplicates.set(pkg, Array.from(versions));
      }
    }

    return duplicates;
  }

  /**
   * Generate DOT format
   */
  private generateDot(): string {
    let dot = 'digraph DependencyGraph {\n';
    dot += '  rankdir=LR;\n';
    dot += '  node [shape=box];\n\n';

    // Add nodes
    for (const node of this.nodes.values()) {
      const color = node.isEntry ? 'green' : node.isExternal ? 'gray' : 'blue';
      const shape = node.isEntry ? 'box,style=filled' : 'box';
      dot += `  "${node.id}" [color=${color},${shape}];\n`;
    }

    dot += '\n';

    // Add edges
    for (const node of this.nodes.values()) {
      for (const dep of node.dependencies) {
        dot += `  "${node.id}" -> "${dep}";\n`;
      }
    }

    dot += '}\n';
    return dot;
  }

  /**
   * Generate Mermaid format
   */
  private generateMermaid(): string {
    let mermaid = 'graph LR\n';

    // Add nodes and edges
    for (const node of this.nodes.values()) {
      const nodeId = node.id.replace(/[^a-zA-Z0-9]/g, '_');
      const label = node.id;

      if (node.isEntry) {
        mermaid += `  ${nodeId}[${label}]:::entry\n`;
      } else if (node.isExternal) {
        mermaid += `  ${nodeId}[${label}]:::external\n`;
      } else {
        mermaid += `  ${nodeId}[${label}]\n`;
      }

      for (const dep of node.dependencies) {
        const depId = dep.replace(/[^a-zA-Z0-9]/g, '_');
        mermaid += `  ${nodeId} --> ${depId}\n`;
      }
    }

    mermaid += '\n  classDef entry fill:#90EE90\n';
    mermaid += '  classDef external fill:#D3D3D3\n';

    return mermaid;
  }

  /**
   * Generate JSON format
   */
  private generateJSON(): string {
    const data: GraphVisualization = {
      nodes: [],
      edges: [],
    };

    // Add nodes
    for (const node of this.nodes.values()) {
      data.nodes.push({
        id: node.id,
        label: node.id,
        size: node.size,
        depth: node.depth,
        isEntry: node.isEntry,
        isExternal: node.isExternal,
      });

      // Add edges
      for (const dep of node.dependencies) {
        data.edges.push({
          from: node.id,
          to: dep,
          type: 'static', // Could be enhanced to detect dynamic imports
        });
      }
    }

    return JSON.stringify(data, null, 2);
  }
}

/**
 * Create a dependency graph instance
 */
export function createDependencyGraph(config: DependencyGraphConfig = {}): DependencyGraph {
  return new DependencyGraph(config);
}
