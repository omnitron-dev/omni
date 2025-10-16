/**
 * Flow registry for tracking and managing flows at runtime
 * Enables lookups, dependency tracking, and optimization
 */

import type { Flow } from './types.js';
import type { FlowId, FlowMetadata, FlowStructure } from './reflection.js';
import { createFlowId } from './reflection.js';

/**
 * Registered Flow entry
 */
export interface RegisteredFlow {
  /**
   * Flow ID
   */
  id: FlowId;

  /**
   * The actual Flow function
   */
  flow: Flow;

  /**
   * Metadata (if available)
   */
  metadata?: Partial<FlowMetadata>;

  /**
   * Source code
   */
  source: string;

  /**
   * Dependencies
   */
  dependencies: Set<FlowId>;

  /**
   * Timestamp of registration
   */
  registered: number;

  /**
   * Usage count
   */
  usageCount: number;

  /**
   * Last used timestamp
   */
  lastUsed: number;
}

/**
 * Flow registry singleton
 */
export class FlowRegistry {
  private flows = new Map<FlowId, RegisteredFlow>();
  private sourceIndex = new Map<string, FlowId>();

  /**
   * Register a flow
   */
  register(flow: Flow, source?: string): FlowId {
    // Get or generate source code
    const actualSource = source || flow.toString();

    // Check if already registered by source
    if (this.sourceIndex.has(actualSource)) {
      return this.sourceIndex.get(actualSource)!;
    }

    // Generate ID
    const id = createFlowId(actualSource);

    // Check if ID already exists (collision)
    if (this.flows.has(id)) {
      return id;
    }

    // Create entry
    const entry: RegisteredFlow = {
      id,
      flow,
      source: actualSource,
      dependencies: new Set(),
      registered: Date.now(),
      usageCount: 0,
      lastUsed: Date.now(),
    };

    // Extract metadata if available
    if (flow.meta) {
      entry.metadata = {
        name: flow.meta.name,
        description: flow.meta.description,
        tags: flow.meta.tags || [],
        version: flow.meta.version || '1.0.0',
        effects: 0, // Will be populated by effects system
        complexity: {
          time: 'O(1)',
          space: 'O(1)',
          cyclomatic: 1,
          cognitive: 1,
          maxDepth: 1,
        },
        dependencies: [],
        performance: null,
        docs: {
          description: flow.meta.description,
          params: [],
          examples: [],
          tags: [],
        },
        source: {
          code: actualSource,
          location: { name: flow.meta.name || 'anonymous' },
        },
        types: {
          signature: {
            input: 'any',
            output: 'any',
            parameters: [],
            returnType: 'any',
            async: false,
          },
          generics: [],
        },
      };
    }

    this.flows.set(id, entry);
    this.sourceIndex.set(actualSource, id);

    return id;
  }

  /**
   * Get a registered flow
   */
  get(id: FlowId): RegisteredFlow | undefined {
    const entry = this.flows.get(id);
    if (entry) {
      entry.usageCount++;
      entry.lastUsed = Date.now();
    }
    return entry;
  }

  /**
   * Check if a flow is registered
   */
  has(id: FlowId): boolean {
    return this.flows.has(id);
  }

  /**
   * Get flow by source code
   */
  getBySource(source: string): RegisteredFlow | undefined {
    const id = this.sourceIndex.get(source);
    return id ? this.get(id) : undefined;
  }

  /**
   * Add a dependency relationship
   */
  addDependency(flowId: FlowId, dependencyId: FlowId): void {
    const flow = this.flows.get(flowId);
    if (flow) {
      flow.dependencies.add(dependencyId);
    }
  }

  /**
   * Get all dependencies of a flow (recursive)
   */
  getDependencies(id: FlowId, visited = new Set<FlowId>()): Set<FlowId> {
    if (visited.has(id)) return visited;

    visited.add(id);
    const flow = this.flows.get(id);
    if (!flow) return visited;

    for (const depId of flow.dependencies) {
      this.getDependencies(depId, visited);
    }

    return visited;
  }

  /**
   * Get all dependents of a flow (flows that depend on this one)
   */
  getDependents(id: FlowId): Set<FlowId> {
    const dependents = new Set<FlowId>();

    for (const [flowId, flow] of this.flows) {
      if (flow.dependencies.has(id)) {
        dependents.add(flowId);
      }
    }

    return dependents;
  }

  /**
   * Get all registered flows
   */
  getAll(): RegisteredFlow[] {
    return Array.from(this.flows.values());
  }

  /**
   * Search flows by metadata
   */
  search(criteria: {
    name?: string;
    tag?: string;
    effects?: number;
  }): RegisteredFlow[] {
    const results: RegisteredFlow[] = [];

    for (const flow of this.flows.values()) {
      let matches = true;

      if (criteria.name && flow.metadata?.name !== criteria.name) {
        matches = false;
      }

      if (criteria.tag && !flow.metadata?.tags?.includes(criteria.tag)) {
        matches = false;
      }

      if (criteria.effects !== undefined && flow.metadata?.effects !== criteria.effects) {
        matches = false;
      }

      if (matches) {
        results.push(flow);
      }
    }

    return results;
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    mostUsed: RegisteredFlow[];
    recentlyUsed: RegisteredFlow[];
    byTag: Map<string, number>;
  } {
    const all = this.getAll();

    // Most used (top 10)
    const mostUsed = [...all].sort((a, b) => b.usageCount - a.usageCount).slice(0, 10);

    // Recently used (top 10)
    const recentlyUsed = [...all].sort((a, b) => b.lastUsed - a.lastUsed).slice(0, 10);

    // By tag
    const byTag = new Map<string, number>();
    for (const flow of all) {
      const tags = flow.metadata?.tags || [];
      for (const tag of tags) {
        byTag.set(tag, (byTag.get(tag) || 0) + 1);
      }
    }

    return {
      total: all.length,
      mostUsed,
      recentlyUsed,
      byTag,
    };
  }

  /**
   * Clear registry (for testing)
   */
  clear(): void {
    this.flows.clear();
    this.sourceIndex.clear();
  }

  /**
   * Prune unused flows (memory management)
   */
  prune(olderThan: number = 3600000): number {
    const now = Date.now();
    let pruned = 0;

    for (const [id, flow] of this.flows) {
      if (flow.usageCount === 0 && now - flow.registered > olderThan) {
        this.flows.delete(id);
        this.sourceIndex.delete(flow.source);
        pruned++;
      }
    }

    return pruned;
  }
}

/**
 * Global flow registry instance
 */
export const globalFlowRegistry = new FlowRegistry();

/**
 * Register a flow with the global registry
 */
export function registerFlow(flow: Flow, source?: string): FlowId {
  return globalFlowRegistry.register(flow, source);
}

/**
 * Get a flow from the global registry
 */
export function getFlow(id: FlowId): RegisteredFlow | undefined {
  return globalFlowRegistry.get(id);
}

/**
 * Clear the global registry (for testing)
 */
export function clearFlowRegistry(): void {
  globalFlowRegistry.clear();
}
