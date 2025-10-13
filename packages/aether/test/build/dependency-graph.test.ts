/**
 * Tests for Dependency Graph
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DependencyGraph,
  createDependencyGraph,
} from '../../src/build/dependency-graph.js';

describe('DependencyGraph', () => {
  let graph: DependencyGraph;

  beforeEach(() => {
    graph = new DependencyGraph();
  });

  describe('Basic Operations', () => {
    it('should create empty graph', () => {
      expect(graph).toBeDefined();
      expect(graph.getAllModules()).toHaveLength(0);
    });

    it('should add module', () => {
      graph.addModule('app.js', {
        isEntry: true,
      });

      const module = graph.getModule('app.js');
      expect(module).toBeDefined();
      expect(module?.id).toBe('app.js');
      expect(module?.isEntry).toBe(true);
    });

    it('should add module with dependencies', () => {
      graph.addModule('app.js', {
        dependencies: ['lib.js', 'utils.js'],
      });

      const module = graph.getModule('app.js');
      expect(module?.dependencies.size).toBe(2);
      expect(module?.dependencies.has('lib.js')).toBe(true);
      expect(module?.dependencies.has('utils.js')).toBe(true);
    });

    it('should track exports', () => {
      graph.addModule('lib.js', {
        exports: ['foo', 'bar', 'baz'],
      });

      const module = graph.getModule('lib.js');
      expect(module?.exports.size).toBe(3);
      expect(module?.exports.has('foo')).toBe(true);
    });

    it('should track imports', () => {
      const imports = new Map([
        ['useState', 'react'],
        ['useEffect', 'react'],
      ]);

      graph.addModule('component.jsx', {
        imports,
      });

      const module = graph.getModule('component.jsx');
      expect(module?.imports.size).toBe(2);
      expect(module?.imports.get('useState')).toBe('react');
    });
  });

  describe('Dependencies and Dependents', () => {
    beforeEach(() => {
      // Build a simple graph:
      // app.js -> [lib.js, utils.js]
      // lib.js -> [core.js]
      // utils.js -> [core.js]
      graph.addModule('app.js', {
        dependencies: ['lib.js', 'utils.js'],
        isEntry: true,
      });
      graph.addModule('lib.js', {
        dependencies: ['core.js'],
      });
      graph.addModule('utils.js', {
        dependencies: ['core.js'],
      });
      graph.addModule('core.js');
    });

    it('should get direct dependencies', () => {
      const deps = graph.getDependencies('app.js');
      expect(deps).toHaveLength(2);
      expect(deps).toContain('lib.js');
      expect(deps).toContain('utils.js');
    });

    it('should get direct dependents', () => {
      const dependents = graph.getDependents('core.js');
      expect(dependents).toHaveLength(2);
      expect(dependents).toContain('lib.js');
      expect(dependents).toContain('utils.js');
    });

    it('should get transitive dependencies', () => {
      const transitive = graph.getTransitiveDependencies('app.js');
      expect(transitive.size).toBe(3); // lib.js, utils.js, core.js
      expect(transitive.has('lib.js')).toBe(true);
      expect(transitive.has('utils.js')).toBe(true);
      expect(transitive.has('core.js')).toBe(true);
    });

    it('should get transitive dependents', () => {
      const transitive = graph.getTransitiveDependents('core.js');
      expect(transitive.size).toBe(3); // lib.js, utils.js, app.js
      expect(transitive.has('lib.js')).toBe(true);
      expect(transitive.has('utils.js')).toBe(true);
      expect(transitive.has('app.js')).toBe(true);
    });
  });

  describe('Entry Points', () => {
    it('should track entry points', () => {
      graph.addModule('app.js', { isEntry: true });
      graph.addModule('admin.js', { isEntry: true });
      graph.addModule('lib.js');

      const entries = graph.getEntryPoints();
      expect(entries).toHaveLength(2);
      expect(entries).toContain('app.js');
      expect(entries).toContain('admin.js');
    });
  });

  describe('Module Depths', () => {
    beforeEach(() => {
      // Build a graph with known depths:
      // app.js (0) -> lib.js (1) -> core.js (2)
      graph.addModule('app.js', {
        dependencies: ['lib.js'],
        isEntry: true,
      });
      graph.addModule('lib.js', {
        dependencies: ['core.js'],
      });
      graph.addModule('core.js');
    });

    it('should calculate module depths', () => {
      graph.calculateDepths();

      const app = graph.getModule('app.js');
      const lib = graph.getModule('lib.js');
      const core = graph.getModule('core.js');

      expect(app?.depth).toBe(0);
      expect(lib?.depth).toBe(1);
      expect(core?.depth).toBe(2);
    });

    it('should handle multiple entry points', () => {
      graph.addModule('admin.js', {
        dependencies: ['lib.js'],
        isEntry: true,
      });

      graph.calculateDepths();

      const app = graph.getModule('app.js');
      const admin = graph.getModule('admin.js');

      expect(app?.depth).toBe(0);
      expect(admin?.depth).toBe(0);
    });
  });

  describe('Circular Dependencies', () => {
    it('should detect simple circular dependency', () => {
      // a -> b -> c -> a
      graph.addModule('a.js', { dependencies: ['b.js'] });
      graph.addModule('b.js', { dependencies: ['c.js'] });
      graph.addModule('c.js', { dependencies: ['a.js'] });

      const circular = graph.findCircularDependencies();

      expect(circular.length).toBeGreaterThan(0);
      expect(circular[0].length).toBe(3);
    });

    it('should detect self-referencing module', () => {
      // a -> a
      graph.addModule('a.js', { dependencies: ['a.js'] });

      const circular = graph.findCircularDependencies();

      expect(circular.length).toBeGreaterThan(0);
    });

    it('should not detect circular dependencies in acyclic graph', () => {
      // a -> b -> c
      graph.addModule('a.js', { dependencies: ['b.js'] });
      graph.addModule('b.js', { dependencies: ['c.js'] });
      graph.addModule('c.js');

      const circular = graph.findCircularDependencies();

      expect(circular).toHaveLength(0);
    });
  });

  describe('Optimization Suggestions', () => {
    it('should suggest hoisting common dependencies', () => {
      // Multiple modules depend on 'common.js'
      graph.addModule('a.js', { dependencies: ['common.js'] });
      graph.addModule('b.js', { dependencies: ['common.js'] });
      graph.addModule('c.js', { dependencies: ['common.js'] });
      graph.addModule('d.js', { dependencies: ['common.js'] });
      graph.addModule('common.js');

      const suggestions = graph.getOptimizationSuggestions();

      const hoistSuggestion = suggestions.find((s) => s.type === 'hoist');
      expect(hoistSuggestion).toBeDefined();
      expect(hoistSuggestion?.modules).toContain('common.js');
    });

    it('should identify unused exports', () => {
      graph.addModule('unused.js', {
        exports: ['foo', 'bar'],
      });

      const suggestions = graph.getOptimizationSuggestions();

      const unusedSuggestion = suggestions.find((s) => s.type === 'unused');
      expect(unusedSuggestion).toBeDefined();
      expect(unusedSuggestion?.modules).toContain('unused.js');
    });

    it('should suggest splitting large modules', () => {
      graph.addModule('large.js', {
        size: 200000, // 200KB
        exports: ['a', 'b', 'c', 'd', 'e', 'f'],
      });

      const suggestions = graph.getOptimizationSuggestions();

      const splitSuggestion = suggestions.find((s) => s.type === 'split');
      expect(splitSuggestion).toBeDefined();
    });

    it('should detect circular dependencies', () => {
      graph.addModule('a.js', { dependencies: ['b.js'] });
      graph.addModule('b.js', { dependencies: ['a.js'] });

      const suggestions = graph.getOptimizationSuggestions();

      const circularSuggestion = suggestions.find((s) => s.type === 'circular');
      expect(circularSuggestion).toBeDefined();
    });

    it('should detect duplicate dependencies', () => {
      graph.addModule('react@17.0.0', { isExternal: true });
      graph.addModule('react@18.0.0', { isExternal: true });

      const suggestions = graph.getOptimizationSuggestions();

      const duplicateSuggestion = suggestions.find((s) => s.type === 'duplicate');
      expect(duplicateSuggestion).toBeDefined();
    });
  });

  describe('Statistics', () => {
    beforeEach(() => {
      // Build a sample graph
      graph.addModule('app.js', {
        dependencies: ['lib1.js', 'lib2.js'],
        size: 1000,
        isEntry: true,
      });
      graph.addModule('lib1.js', {
        dependencies: ['core.js'],
        size: 500,
      });
      graph.addModule('lib2.js', {
        dependencies: ['core.js'],
        size: 300,
      });
      graph.addModule('core.js', {
        size: 200,
        isExternal: true,
      });

      graph.calculateDepths();
    });

    it('should calculate total modules', () => {
      const stats = graph.getStatistics();
      expect(stats.totalModules).toBe(4);
    });

    it('should calculate entry points', () => {
      const stats = graph.getStatistics();
      expect(stats.entryPoints).toBe(1);
    });

    it('should calculate external modules', () => {
      const stats = graph.getStatistics();
      expect(stats.externalModules).toBe(1);
    });

    it('should calculate average depth', () => {
      const stats = graph.getStatistics();
      expect(stats.averageDepth).toBeGreaterThan(0);
    });

    it('should calculate max depth', () => {
      const stats = graph.getStatistics();
      expect(stats.maxDepth).toBeGreaterThanOrEqual(0);
    });

    it('should calculate total size', () => {
      const stats = graph.getStatistics();
      expect(stats.totalSize).toBe(2000);
    });

    it('should calculate average dependencies', () => {
      const stats = graph.getStatistics();
      expect(stats.averageDependencies).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Visualization', () => {
    beforeEach(() => {
      graph.addModule('app.js', {
        dependencies: ['lib.js'],
        isEntry: true,
      });
      graph.addModule('lib.js', {
        dependencies: ['core.js'],
      });
      graph.addModule('core.js', {
        isExternal: true,
      });
    });

    it('should generate JSON visualization', () => {
      const json = graph.generateVisualization('json');
      const data = JSON.parse(json);

      expect(data.nodes).toBeDefined();
      expect(data.edges).toBeDefined();
      expect(data.nodes.length).toBe(3);
    });

    it('should generate DOT format', () => {
      const dot = graph.generateVisualization('dot');

      expect(dot).toContain('digraph DependencyGraph');
      expect(dot).toContain('app.js');
      expect(dot).toContain('lib.js');
      expect(dot).toContain('core.js');
    });

    it('should generate Mermaid format', () => {
      const mermaid = graph.generateVisualization('mermaid');

      expect(mermaid).toContain('graph LR');
      expect(mermaid).toContain('-->');
    });
  });

  describe('Export and Import', () => {
    it('should export graph data', () => {
      graph.addModule('app.js', {
        dependencies: ['lib.js'],
      });
      graph.addModule('lib.js');

      const exported = graph.export();

      expect(Object.keys(exported)).toHaveLength(2);
      expect(exported['app.js']).toBeDefined();
      expect(exported['lib.js']).toBeDefined();
    });

    it('should preserve all module properties on export', () => {
      graph.addModule('app.js', {
        dependencies: ['lib.js'],
        exports: ['main'],
        size: 1000,
        isEntry: true,
        metadata: { version: '1.0' },
      });

      const exported = graph.export();
      const app = exported['app.js'];

      expect(app).toBeDefined();
      expect(app.dependencies.size).toBe(1);
      expect(app.exports.size).toBe(1);
      expect(app.size).toBe(1000);
      expect(app.isEntry).toBe(true);
      expect(app.metadata?.version).toBe('1.0');
    });
  });

  describe('Clear', () => {
    it('should clear all data', () => {
      graph.addModule('app.js');
      graph.addModule('lib.js');

      graph.clear();

      expect(graph.getAllModules()).toHaveLength(0);
      expect(graph.getEntryPoints()).toHaveLength(0);
    });
  });

  describe('External Dependencies', () => {
    it('should mark external dependencies', () => {
      const graphWithExternals = new DependencyGraph({
        externals: ['react', 'lodash'],
      });

      graphWithExternals.addModule('react');
      graphWithExternals.addModule('lodash');
      graphWithExternals.addModule('app.js');

      const react = graphWithExternals.getModule('react');
      const lodash = graphWithExternals.getModule('lodash');
      const app = graphWithExternals.getModule('app.js');

      expect(react?.isExternal).toBe(true);
      expect(lodash?.isExternal).toBe(true);
      expect(app?.isExternal).toBe(false);
    });
  });

  describe('createDependencyGraph factory', () => {
    it('should create graph instance', () => {
      const factoryGraph = createDependencyGraph();

      expect(factoryGraph).toBeInstanceOf(DependencyGraph);
    });

    it('should accept configuration', () => {
      const factoryGraph = createDependencyGraph({
        externals: ['react'],
        trackCircular: true,
      });

      expect(factoryGraph).toBeInstanceOf(DependencyGraph);
    });
  });

  describe('Complex Graph Scenarios', () => {
    it('should handle diamond dependency', () => {
      // Diamond: app -> [lib1, lib2] -> core
      graph.addModule('app.js', {
        dependencies: ['lib1.js', 'lib2.js'],
        isEntry: true,
      });
      graph.addModule('lib1.js', {
        dependencies: ['core.js'],
      });
      graph.addModule('lib2.js', {
        dependencies: ['core.js'],
      });
      graph.addModule('core.js');

      const transitive = graph.getTransitiveDependencies('app.js');

      expect(transitive.size).toBe(3);
      expect(transitive.has('core.js')).toBe(true);
    });

    it('should handle deep dependency chain', () => {
      // Chain: a -> b -> c -> d -> e
      const modules = ['a.js', 'b.js', 'c.js', 'd.js', 'e.js'];

      for (let i = 0; i < modules.length - 1; i++) {
        graph.addModule(modules[i], {
          dependencies: [modules[i + 1]],
          isEntry: i === 0,
        });
      }
      graph.addModule('e.js');

      graph.calculateDepths();

      const e = graph.getModule('e.js');
      expect(e?.depth).toBe(4);
    });

    it('should handle multiple entry points with shared dependencies', () => {
      graph.addModule('app1.js', {
        dependencies: ['shared.js'],
        isEntry: true,
      });
      graph.addModule('app2.js', {
        dependencies: ['shared.js'],
        isEntry: true,
      });
      graph.addModule('shared.js');

      const dependents = graph.getDependents('shared.js');

      expect(dependents).toHaveLength(2);
      expect(dependents).toContain('app1.js');
      expect(dependents).toContain('app2.js');
    });
  });

  describe('Metadata', () => {
    it('should store and retrieve module metadata', () => {
      graph.addModule('app.js', {
        metadata: {
          compiler: 'esbuild',
          version: '1.0.0',
          optimized: true,
        },
      });

      const module = graph.getModule('app.js');

      expect(module?.metadata?.compiler).toBe('esbuild');
      expect(module?.metadata?.version).toBe('1.0.0');
      expect(module?.metadata?.optimized).toBe(true);
    });
  });
});
