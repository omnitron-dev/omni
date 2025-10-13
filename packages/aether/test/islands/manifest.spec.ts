/**
 * Island Manifest Tests
 */

import { describe, it, expect } from 'vitest';
import {
  generateManifest,
  loadManifest,
  getRouteIslands,
  getIslandEntry,
  getIslandsByStrategy,
  calculateRouteSize,
  optimizeManifest,
  validateManifest,
  IslandDependencyGraph,
} from '../../src/islands/manifest.js';
import type { IslandManifest } from '../../src/islands/types.js';

describe('Island Manifest', () => {
  describe('generateManifest', () => {
    it('should generate empty manifest', () => {
      const manifest = generateManifest();

      expect(manifest).toBeDefined();
      expect(manifest.islands).toBeDefined();
      expect(manifest.routes).toBeDefined();
      expect(manifest.timestamp).toBeGreaterThan(0);
      expect(manifest.version).toBe('1.0.0');
    });
  });

  describe('loadManifest', () => {
    it('should load manifest from object', () => {
      const input: IslandManifest = {
        islands: {},
        routes: {},
        timestamp: Date.now(),
        version: '1.0.0',
      };

      const manifest = loadManifest(input);

      expect(manifest).toEqual(input);
    });

    it('should parse manifest from JSON string', () => {
      const input: IslandManifest = {
        islands: {
          'island-1': {
            id: 'island-1',
            name: 'TestIsland',
            path: '/islands/test.js',
            chunk: 'islands/test.js',
            strategy: 'immediate',
            dependencies: [],
            used: true,
          },
        },
        routes: {},
        timestamp: Date.now(),
        version: '1.0.0',
      };

      const json = JSON.stringify(input);
      const manifest = loadManifest(json);

      expect(manifest).toEqual(input);
    });
  });

  describe('getRouteIslands', () => {
    it('should return islands for route', () => {
      const manifest: IslandManifest = {
        islands: {},
        routes: {
          '/home': ['island-1', 'island-2'],
          '/about': ['island-3'],
        },
        timestamp: Date.now(),
        version: '1.0.0',
      };

      const islands = getRouteIslands(manifest, '/home');

      expect(islands).toEqual(['island-1', 'island-2']);
    });

    it('should return empty array for non-existent route', () => {
      const manifest: IslandManifest = {
        islands: {},
        routes: {},
        timestamp: Date.now(),
        version: '1.0.0',
      };

      const islands = getRouteIslands(manifest, '/404');

      expect(islands).toEqual([]);
    });
  });

  describe('getIslandEntry', () => {
    it('should return island entry', () => {
      const entry = {
        id: 'island-1',
        name: 'TestIsland',
        path: '/islands/test.js',
        chunk: 'islands/test.js',
        strategy: 'immediate' as const,
        dependencies: [],
        used: true,
      };

      const manifest: IslandManifest = {
        islands: {
          'island-1': entry,
        },
        routes: {},
        timestamp: Date.now(),
        version: '1.0.0',
      };

      const result = getIslandEntry(manifest, 'island-1');

      expect(result).toEqual(entry);
    });

    it('should return undefined for non-existent island', () => {
      const manifest: IslandManifest = {
        islands: {},
        routes: {},
        timestamp: Date.now(),
        version: '1.0.0',
      };

      const result = getIslandEntry(manifest, 'island-404');

      expect(result).toBeUndefined();
    });
  });

  describe('getIslandsByStrategy', () => {
    it('should filter islands by strategy', () => {
      const manifest: IslandManifest = {
        islands: {
          'island-1': {
            id: 'island-1',
            name: 'Island1',
            path: '',
            chunk: '',
            strategy: 'immediate',
            dependencies: [],
            used: true,
          },
          'island-2': {
            id: 'island-2',
            name: 'Island2',
            path: '',
            chunk: '',
            strategy: 'visible',
            dependencies: [],
            used: true,
          },
          'island-3': {
            id: 'island-3',
            name: 'Island3',
            path: '',
            chunk: '',
            strategy: 'immediate',
            dependencies: [],
            used: true,
          },
        },
        routes: {},
        timestamp: Date.now(),
        version: '1.0.0',
      };

      const immediateIslands = getIslandsByStrategy(manifest, 'immediate');

      expect(immediateIslands).toEqual(['island-1', 'island-3']);
    });
  });

  describe('calculateRouteSize', () => {
    it('should calculate total size for route', () => {
      const manifest: IslandManifest = {
        islands: {
          'island-1': {
            id: 'island-1',
            name: 'Island1',
            path: '',
            chunk: '',
            strategy: 'immediate',
            dependencies: [],
            size: 5000,
            used: true,
          },
          'island-2': {
            id: 'island-2',
            name: 'Island2',
            path: '',
            chunk: '',
            strategy: 'visible',
            dependencies: [],
            size: 8000,
            used: true,
          },
        },
        routes: {
          '/home': ['island-1', 'island-2'],
        },
        timestamp: Date.now(),
        version: '1.0.0',
      };

      const size = calculateRouteSize(manifest, '/home');

      expect(size).toBe(13000);
    });
  });

  describe('optimizeManifest', () => {
    it('should remove unused islands', () => {
      const manifest: IslandManifest = {
        islands: {
          'island-1': {
            id: 'island-1',
            name: 'Island1',
            path: '',
            chunk: '',
            strategy: 'immediate',
            dependencies: [],
            used: true,
          },
          'island-2': {
            id: 'island-2',
            name: 'Island2',
            path: '',
            chunk: '',
            strategy: 'visible',
            dependencies: [],
            used: false,
          },
        },
        routes: {},
        timestamp: Date.now(),
        version: '1.0.0',
      };

      const optimized = optimizeManifest(manifest);

      expect(Object.keys(optimized.islands)).toEqual(['island-1']);
    });
  });

  describe('IslandDependencyGraph', () => {
    it('should track dependencies', () => {
      const graph = new IslandDependencyGraph();
      graph.addDependency('island-1', 'dep-1');
      graph.addDependency('island-1', 'dep-2');

      const deps = graph.getDependencies('island-1');

      expect(deps).toEqual(['dep-1', 'dep-2']);
    });

    it('should get all dependencies recursively', () => {
      const graph = new IslandDependencyGraph();
      graph.addDependency('island-1', 'dep-1');
      graph.addDependency('dep-1', 'dep-2');
      graph.addDependency('dep-2', 'dep-3');

      const allDeps = graph.getAllDependencies('island-1');

      expect(allDeps).toContain('dep-1');
      expect(allDeps).toContain('dep-2');
      expect(allDeps).toContain('dep-3');
    });

    it('should detect circular dependencies', () => {
      const graph = new IslandDependencyGraph();
      graph.addDependency('island-1', 'island-2');
      graph.addDependency('island-2', 'island-3');
      graph.addDependency('island-3', 'island-1');

      const circular = graph.detectCircular();

      expect(circular.length).toBeGreaterThan(0);
    });

    it('should perform topological sort', () => {
      const graph = new IslandDependencyGraph();
      graph.addDependency('island-1', 'dep-1');
      graph.addDependency('island-2', 'dep-1');
      graph.addDependency('island-2', 'island-1');

      const sorted = graph.topologicalSort();

      // dep-1 should come before island-1
      // island-1 should come before island-2
      const dep1Index = sorted.indexOf('dep-1');
      const island1Index = sorted.indexOf('island-1');
      const island2Index = sorted.indexOf('island-2');

      expect(dep1Index).toBeLessThan(island1Index);
      expect(island1Index).toBeLessThan(island2Index);
    });
  });

  describe('validateManifest', () => {
    it('should detect missing islands', () => {
      const manifest: IslandManifest = {
        islands: {
          'island-1': {
            id: 'island-1',
            name: 'Island1',
            path: '',
            chunk: '',
            strategy: 'immediate',
            dependencies: [],
            used: true,
          },
        },
        routes: {
          '/home': ['island-1', 'island-404'],
        },
        timestamp: Date.now(),
        version: '1.0.0',
      };

      const { errors, warnings } = validateManifest(manifest);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('island-404');
    });

    it('should detect circular dependencies', () => {
      const manifest: IslandManifest = {
        islands: {
          'island-1': {
            id: 'island-1',
            name: 'Island1',
            path: '',
            chunk: '',
            strategy: 'immediate',
            dependencies: ['island-2'],
            used: true,
          },
          'island-2': {
            id: 'island-2',
            name: 'Island2',
            path: '',
            chunk: '',
            strategy: 'immediate',
            dependencies: ['island-1'],
            used: true,
          },
        },
        routes: {},
        timestamp: Date.now(),
        version: '1.0.0',
      };

      const { errors } = validateManifest(manifest);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('Circular');
    });

    it('should warn about large islands', () => {
      const manifest: IslandManifest = {
        islands: {
          'island-1': {
            id: 'island-1',
            name: 'Island1',
            path: '',
            chunk: '',
            strategy: 'immediate',
            dependencies: [],
            size: 150000, // 150KB
            used: true,
          },
        },
        routes: {},
        timestamp: Date.now(),
        version: '1.0.0',
      };

      const { warnings } = validateManifest(manifest);

      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('large');
    });
  });
});
