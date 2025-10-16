/**
 * @fileoverview Comprehensive tests for Module Graph
 *
 * Tests module dependency graph management including:
 * - Node and edge management
 * - Circular dependency detection
 * - Load order calculation
 * - Split points identification
 * - Shared dependencies detection
 * - Transitive dependencies
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ModuleGraph } from '../../src/modules/graph.js';
import type { ModuleDefinition } from '../../src/di/types.js';

describe('ModuleGraph', () => {
  let graph: ModuleGraph;

  beforeEach(() => {
    graph = new ModuleGraph();
  });

  describe('node management', () => {
    it('should add a node to the graph', () => {
      const definition: ModuleDefinition = {
        id: 'test-module',
        providers: [],
      };

      graph.addNode('test-module', definition);

      const node = graph.getNode('test-module');
      expect(node).toBeDefined();
      expect(node?.id).toBe('test-module');
      expect(node?.data).toBe(definition);
    });

    it('should return undefined for non-existent node', () => {
      const node = graph.getNode('non-existent');
      expect(node).toBeUndefined();
    });

    it('should get all nodes', () => {
      const def1: ModuleDefinition = { id: 'module1', providers: [] };
      const def2: ModuleDefinition = { id: 'module2', providers: [] };
      const def3: ModuleDefinition = { id: 'module3', providers: [] };

      graph.addNode('module1', def1);
      graph.addNode('module2', def2);
      graph.addNode('module3', def3);

      const nodes = graph.getNodes();
      expect(nodes).toHaveLength(3);
      expect(nodes.map((n) => n.id)).toContain('module1');
      expect(nodes.map((n) => n.id)).toContain('module2');
      expect(nodes.map((n) => n.id)).toContain('module3');
    });

    it('should handle empty graph', () => {
      const nodes = graph.getNodes();
      expect(nodes).toHaveLength(0);
    });
  });

  describe('edge management', () => {
    beforeEach(() => {
      const def1: ModuleDefinition = { id: 'module1', providers: [] };
      const def2: ModuleDefinition = { id: 'module2', providers: [] };
      const def3: ModuleDefinition = { id: 'module3', providers: [] };

      graph.addNode('module1', def1);
      graph.addNode('module2', def2);
      graph.addNode('module3', def3);
    });

    it('should add an edge between nodes', () => {
      graph.addEdge('module1', 'module2');

      const deps = graph.getDependencies('module1');
      expect(deps).toContain('module2');
    });

    it('should track dependencies correctly', () => {
      graph.addEdge('module1', 'module2');
      graph.addEdge('module1', 'module3');

      const deps = graph.getDependencies('module1');
      expect(deps).toHaveLength(2);
      expect(deps).toContain('module2');
      expect(deps).toContain('module3');
    });

    it('should track dependents (reverse edges)', () => {
      graph.addEdge('module1', 'module2');
      graph.addEdge('module3', 'module2');

      const dependents = graph.getDependents('module2');
      expect(dependents).toHaveLength(2);
      expect(dependents).toContain('module1');
      expect(dependents).toContain('module3');
    });

    it('should return empty array for node with no dependencies', () => {
      const deps = graph.getDependencies('module1');
      expect(deps).toHaveLength(0);
    });

    it('should return empty array for node with no dependents', () => {
      const dependents = graph.getDependents('module1');
      expect(dependents).toHaveLength(0);
    });
  });

  describe('circular dependency detection', () => {
    beforeEach(() => {
      const def1: ModuleDefinition = { id: 'module1', providers: [] };
      const def2: ModuleDefinition = { id: 'module2', providers: [] };
      const def3: ModuleDefinition = { id: 'module3', providers: [] };
      const def4: ModuleDefinition = { id: 'module4', providers: [] };

      graph.addNode('module1', def1);
      graph.addNode('module2', def2);
      graph.addNode('module3', def3);
      graph.addNode('module4', def4);
    });

    it('should detect simple circular dependency', () => {
      graph.addEdge('module1', 'module2');
      graph.addEdge('module2', 'module1');

      const cycles = graph.findCircularDependencies();
      expect(cycles.length).toBeGreaterThan(0);

      const hasCycle = cycles.some(
        (cycle) =>
          (cycle.includes('module1') && cycle.includes('module2')) ||
          (cycle.includes('module2') && cycle.includes('module1'))
      );
      expect(hasCycle).toBe(true);
    });

    it('should detect three-node circular dependency', () => {
      graph.addEdge('module1', 'module2');
      graph.addEdge('module2', 'module3');
      graph.addEdge('module3', 'module1');

      const cycles = graph.findCircularDependencies();
      expect(cycles.length).toBeGreaterThan(0);

      const hasCycle = cycles.some(
        (cycle) => cycle.includes('module1') && cycle.includes('module2') && cycle.includes('module3')
      );
      expect(hasCycle).toBe(true);
    });

    it('should detect complex circular dependency', () => {
      graph.addEdge('module1', 'module2');
      graph.addEdge('module2', 'module3');
      graph.addEdge('module3', 'module4');
      graph.addEdge('module4', 'module2');

      const cycles = graph.findCircularDependencies();
      expect(cycles.length).toBeGreaterThan(0);
    });

    it('should return empty array when no circular dependencies', () => {
      graph.addEdge('module1', 'module2');
      graph.addEdge('module2', 'module3');
      graph.addEdge('module3', 'module4');

      const cycles = graph.findCircularDependencies();
      expect(cycles).toHaveLength(0);
    });

    it('should handle self-referencing node', () => {
      graph.addEdge('module1', 'module1');

      const cycles = graph.findCircularDependencies();
      expect(cycles.length).toBeGreaterThan(0);
    });
  });

  describe('load order calculation', () => {
    beforeEach(() => {
      const def1: ModuleDefinition = { id: 'module1', providers: [] };
      const def2: ModuleDefinition = { id: 'module2', providers: [] };
      const def3: ModuleDefinition = { id: 'module3', providers: [] };
      const def4: ModuleDefinition = { id: 'module4', providers: [] };

      graph.addNode('module1', def1);
      graph.addNode('module2', def2);
      graph.addNode('module3', def3);
      graph.addNode('module4', def4);
    });

    it('should calculate load order for linear dependency chain', () => {
      graph.addEdge('module1', 'module2');
      graph.addEdge('module2', 'module3');
      graph.addEdge('module3', 'module4');

      const order = graph.getLoadOrder();

      const idx1 = order.indexOf('module1');
      const idx2 = order.indexOf('module2');
      const idx3 = order.indexOf('module3');
      const idx4 = order.indexOf('module4');

      // Dependencies should be loaded before dependents
      expect(idx4).toBeLessThan(idx3);
      expect(idx3).toBeLessThan(idx2);
      expect(idx2).toBeLessThan(idx1);
    });

    it('should calculate load order for diamond dependency', () => {
      graph.addEdge('module1', 'module2');
      graph.addEdge('module1', 'module3');
      graph.addEdge('module2', 'module4');
      graph.addEdge('module3', 'module4');

      const order = graph.getLoadOrder();

      const idx1 = order.indexOf('module1');
      const idx2 = order.indexOf('module2');
      const idx3 = order.indexOf('module3');
      const idx4 = order.indexOf('module4');

      // module4 should be loaded first (no dependencies)
      expect(idx4).toBeLessThan(idx2);
      expect(idx4).toBeLessThan(idx3);
      // module2 and module3 should be loaded before module1
      expect(idx2).toBeLessThan(idx1);
      expect(idx3).toBeLessThan(idx1);
    });

    it('should handle independent modules', () => {
      const order = graph.getLoadOrder();
      expect(order).toHaveLength(4);
      expect(order).toContain('module1');
      expect(order).toContain('module2');
      expect(order).toContain('module3');
      expect(order).toContain('module4');
    });

    it('should handle empty graph', () => {
      const emptyGraph = new ModuleGraph();
      const order = emptyGraph.getLoadOrder();
      expect(order).toHaveLength(0);
    });
  });

  describe('shared dependencies detection', () => {
    beforeEach(() => {
      const def1: ModuleDefinition = { id: 'module1', providers: [] };
      const def2: ModuleDefinition = { id: 'module2', providers: [] };
      const def3: ModuleDefinition = { id: 'module3', providers: [] };
      const def4: ModuleDefinition = { id: 'module4', providers: [] };
      const def5: ModuleDefinition = { id: 'module5', providers: [] };

      graph.addNode('module1', def1);
      graph.addNode('module2', def2);
      graph.addNode('module3', def3);
      graph.addNode('module4', def4);
      graph.addNode('module5', def5);
    });

    it('should detect shared dependencies', () => {
      graph.addEdge('module1', 'module3');
      graph.addEdge('module2', 'module3');

      const shared = graph.getSharedDependencies();
      expect(shared.has('module3')).toBe(true);

      const dependents = shared.get('module3');
      expect(dependents).toHaveLength(2);
      expect(dependents).toContain('module1');
      expect(dependents).toContain('module2');
    });

    it('should detect multiple shared dependencies', () => {
      graph.addEdge('module1', 'module4');
      graph.addEdge('module2', 'module4');
      graph.addEdge('module3', 'module4');

      graph.addEdge('module1', 'module5');
      graph.addEdge('module2', 'module5');

      const shared = graph.getSharedDependencies();
      expect(shared.has('module4')).toBe(true);
      expect(shared.has('module5')).toBe(true);

      expect(shared.get('module4')).toHaveLength(3);
      expect(shared.get('module5')).toHaveLength(2);
    });

    it('should not include non-shared dependencies', () => {
      graph.addEdge('module1', 'module2');
      graph.addEdge('module1', 'module3');

      const shared = graph.getSharedDependencies();
      expect(shared.has('module2')).toBe(false);
      expect(shared.has('module3')).toBe(false);
    });

    it('should return empty map when no shared dependencies', () => {
      graph.addEdge('module1', 'module2');
      graph.addEdge('module3', 'module4');

      const shared = graph.getSharedDependencies();
      expect(shared.size).toBe(0);
    });
  });

  describe('transitive dependencies', () => {
    beforeEach(() => {
      const def1: ModuleDefinition = { id: 'module1', providers: [] };
      const def2: ModuleDefinition = { id: 'module2', providers: [] };
      const def3: ModuleDefinition = { id: 'module3', providers: [] };
      const def4: ModuleDefinition = { id: 'module4', providers: [] };

      graph.addNode('module1', def1);
      graph.addNode('module2', def2);
      graph.addNode('module3', def3);
      graph.addNode('module4', def4);
    });

    it('should get direct transitive dependencies', () => {
      graph.addEdge('module1', 'module2');

      const deps = graph.getTransitiveDependencies('module1');
      expect(deps.has('module2')).toBe(true);
      expect(deps.size).toBe(1);
    });

    it('should get nested transitive dependencies', () => {
      graph.addEdge('module1', 'module2');
      graph.addEdge('module2', 'module3');
      graph.addEdge('module3', 'module4');

      const deps = graph.getTransitiveDependencies('module1');
      expect(deps.has('module2')).toBe(true);
      expect(deps.has('module3')).toBe(true);
      expect(deps.has('module4')).toBe(true);
      expect(deps.size).toBe(3);
    });

    it('should handle diamond dependencies', () => {
      graph.addEdge('module1', 'module2');
      graph.addEdge('module1', 'module3');
      graph.addEdge('module2', 'module4');
      graph.addEdge('module3', 'module4');

      const deps = graph.getTransitiveDependencies('module1');
      expect(deps.has('module2')).toBe(true);
      expect(deps.has('module3')).toBe(true);
      expect(deps.has('module4')).toBe(true);
      expect(deps.size).toBe(3);
    });

    it('should return empty set for node with no dependencies', () => {
      const deps = graph.getTransitiveDependencies('module1');
      expect(deps.size).toBe(0);
    });

    it('should check if module depends on another', () => {
      graph.addEdge('module1', 'module2');
      graph.addEdge('module2', 'module3');

      expect(graph.dependsOn('module1', 'module2')).toBe(true);
      expect(graph.dependsOn('module1', 'module3')).toBe(true);
      expect(graph.dependsOn('module2', 'module3')).toBe(true);
      expect(graph.dependsOn('module3', 'module1')).toBe(false);
    });
  });

  describe('split points identification', () => {
    it('should identify module with explicit split chunk', () => {
      const definition: ModuleDefinition = {
        id: 'feature-module',
        providers: [],
        optimization: {
          splitChunk: true,
        },
      };

      graph.addNode('feature-module', definition);

      const points = graph.getSplitPoints();
      expect(points).toHaveLength(1);
      expect(points[0].module).toBe('feature-module');
    });

    it('should identify module with lazy boundary', () => {
      const definition: ModuleDefinition = {
        id: 'lazy-module',
        providers: [],
        optimization: {
          lazyBoundary: true,
        },
      };

      graph.addNode('lazy-module', definition);

      const points = graph.getSplitPoints();
      expect(points).toHaveLength(1);
      expect(points[0].module).toBe('lazy-module');
    });

    it('should identify module with routes as split point', () => {
      const definition: ModuleDefinition = {
        id: 'router-module',
        providers: [],
        routes: [
          { path: '/', component: {} },
          { path: '/about', component: {} },
        ],
      };

      graph.addNode('router-module', definition);

      const points = graph.getSplitPoints();
      expect(points).toHaveLength(1);
      expect(points[0].module).toBe('router-module');
    });

    it('should identify large module as split point', () => {
      const providers = Array.from({ length: 15 }, (_, i) => ({
        provide: `Provider${i}`,
        useValue: {},
      }));

      const definition: ModuleDefinition = {
        id: 'large-module',
        providers,
      };

      graph.addNode('large-module', definition);

      const points = graph.getSplitPoints();
      expect(points).toHaveLength(1);
      expect(points[0].module).toBe('large-module');
    });

    it('should determine correct load strategy for high priority module', () => {
      const definition: ModuleDefinition = {
        id: 'critical-module',
        providers: [],
        optimization: {
          splitChunk: true,
          priority: 'high',
        },
      };

      graph.addNode('critical-module', definition);

      const points = graph.getSplitPoints();
      expect(points[0].strategy).toBe('preload');
    });

    it('should determine lazy strategy by default', () => {
      const definition: ModuleDefinition = {
        id: 'default-module',
        providers: [],
        optimization: {
          splitChunk: true,
        },
      };

      graph.addNode('default-module', definition);

      const points = graph.getSplitPoints();
      expect(points[0].strategy).toBe('lazy');
    });

    it('should estimate module size based on contents', () => {
      const definition: ModuleDefinition = {
        id: 'sized-module',
        providers: Array.from({ length: 5 }, (_, i) => ({
          provide: `Provider${i}`,
          useValue: {},
        })),
        stores: [{}, {}, {}],
        routes: [{ path: '/', component: {} }],
        islands: [{ id: 'island1', component: async () => ({}) }],
        optimization: {
          splitChunk: true,
        },
      };

      graph.addNode('sized-module', definition);

      const points = graph.getSplitPoints();
      expect(points[0].size).toBeGreaterThan(0);
    });

    it('should respect budget constraints', () => {
      const definition: ModuleDefinition = {
        id: 'budget-module',
        providers: Array.from({ length: 100 }, (_, i) => ({
          provide: `Provider${i}`,
          useValue: {},
        })),
        optimization: {
          splitChunk: true,
          budget: {
            maxSize: 50000,
          },
        },
      };

      graph.addNode('budget-module', definition);

      const points = graph.getSplitPoints();
      expect(points[0].size).toBeLessThanOrEqual(50000);
    });
  });

  describe('module depth calculation', () => {
    beforeEach(() => {
      const def1: ModuleDefinition = { id: 'module1', providers: [] };
      const def2: ModuleDefinition = { id: 'module2', providers: [] };
      const def3: ModuleDefinition = { id: 'module3', providers: [] };
      const def4: ModuleDefinition = { id: 'module4', providers: [] };

      graph.addNode('module1', def1);
      graph.addNode('module2', def2);
      graph.addNode('module3', def3);
      graph.addNode('module4', def4);
    });

    it('should calculate depth for root module', () => {
      const depth = graph.getDepth('module1');
      expect(depth).toBe(0);
    });

    it('should calculate depth for linear dependency chain', () => {
      graph.addEdge('module1', 'module2');
      graph.addEdge('module2', 'module3');
      graph.addEdge('module3', 'module4');

      expect(graph.getDepth('module1')).toBe(3);
      expect(graph.getDepth('module2')).toBe(2);
      expect(graph.getDepth('module3')).toBe(1);
      expect(graph.getDepth('module4')).toBe(0);
    });

    it('should calculate depth for diamond dependency', () => {
      graph.addEdge('module1', 'module2');
      graph.addEdge('module1', 'module3');
      graph.addEdge('module2', 'module4');
      graph.addEdge('module3', 'module4');

      expect(graph.getDepth('module1')).toBe(2);
      expect(graph.getDepth('module2')).toBe(1);
      expect(graph.getDepth('module3')).toBe(1);
      expect(graph.getDepth('module4')).toBe(0);
    });
  });

  describe('graph statistics', () => {
    it('should return stats for empty graph', () => {
      const stats = graph.getStats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
      expect(stats.maxDepth).toBe(0);
      expect(stats.avgDependencies).toBe(0);
      expect(stats.circularDependencies).toBe(0);
    });

    it('should calculate correct stats for simple graph', () => {
      const def1: ModuleDefinition = { id: 'module1', providers: [] };
      const def2: ModuleDefinition = { id: 'module2', providers: [] };
      const def3: ModuleDefinition = { id: 'module3', providers: [] };

      graph.addNode('module1', def1);
      graph.addNode('module2', def2);
      graph.addNode('module3', def3);

      graph.addEdge('module1', 'module2');
      graph.addEdge('module2', 'module3');

      const stats = graph.getStats();
      expect(stats.nodeCount).toBe(3);
      expect(stats.edgeCount).toBe(2);
      expect(stats.maxDepth).toBe(2);
      expect(stats.circularDependencies).toBe(0);
    });

    it('should detect circular dependencies in stats', () => {
      const def1: ModuleDefinition = { id: 'module1', providers: [] };
      const def2: ModuleDefinition = { id: 'module2', providers: [] };

      graph.addNode('module1', def1);
      graph.addNode('module2', def2);

      graph.addEdge('module1', 'module2');
      graph.addEdge('module2', 'module1');

      const stats = graph.getStats();
      expect(stats.circularDependencies).toBeGreaterThan(0);
    });
  });

  describe('graph clearing', () => {
    it('should clear all nodes and edges', () => {
      const def1: ModuleDefinition = { id: 'module1', providers: [] };
      const def2: ModuleDefinition = { id: 'module2', providers: [] };

      graph.addNode('module1', def1);
      graph.addNode('module2', def2);
      graph.addEdge('module1', 'module2');

      graph.clear();

      expect(graph.getNodes()).toHaveLength(0);
      expect(graph.getDependencies('module1')).toHaveLength(0);
      expect(graph.getNode('module1')).toBeUndefined();
    });

    it('should allow re-adding nodes after clear', () => {
      const def1: ModuleDefinition = { id: 'module1', providers: [] };

      graph.addNode('module1', def1);
      graph.clear();
      graph.addNode('module1', def1);

      expect(graph.getNode('module1')).toBeDefined();
    });
  });
});
