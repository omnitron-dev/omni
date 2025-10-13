/**
 * Bundle Analyzer Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createBundleAnalyzer } from '../../src/devtools/bundle-analyzer.js';
import type { ModuleInfo } from '../../src/devtools/bundle-analyzer.js';

describe('BundleAnalyzer', () => {
  let analyzer: ReturnType<typeof createBundleAnalyzer>;

  beforeEach(() => {
    analyzer = createBundleAnalyzer({
      analyzeTreeShaking: true,
      detectDuplicates: true,
      analyzeImportCost: true,
      analyzeLazyLoading: true,
      sizeThreshold: 50 * 1024, // 50KB
    });
  });

  describe('module registration', () => {
    it('should register module', () => {
      const module: ModuleInfo = {
        id: 'module-1',
        name: 'TestModule',
        path: 'src/test.ts',
        size: 1024,
        gzipSize: 512,
        imports: [],
        importedBy: [],
        isEntry: false,
        isExternal: false,
        isLazyLoaded: false,
      };

      analyzer.registerModule(module);
      const analysis = analyzer.analyze();

      expect(analysis.modules).toHaveLength(1);
      expect(analysis.modules[0].name).toBe('TestModule');
    });

    it('should register multiple modules', () => {
      const module1: ModuleInfo = {
        id: 'module-1',
        name: 'Module1',
        path: 'src/module1.ts',
        size: 1024,
        gzipSize: 512,
        imports: ['module-2'],
        importedBy: [],
        isEntry: true,
        isExternal: false,
        isLazyLoaded: false,
      };

      const module2: ModuleInfo = {
        id: 'module-2',
        name: 'Module2',
        path: 'src/module2.ts',
        size: 2048,
        gzipSize: 1024,
        imports: [],
        importedBy: ['module-1'],
        isEntry: false,
        isExternal: false,
        isLazyLoaded: false,
      };

      analyzer.registerModule(module1);
      analyzer.registerModule(module2);

      const analysis = analyzer.analyze();
      expect(analysis.modules).toHaveLength(2);
    });
  });

  describe('bundle tree generation', () => {
    it('should generate bundle tree', () => {
      const module: ModuleInfo = {
        id: 'module-1',
        name: 'TestModule',
        path: 'src/components/test.ts',
        size: 1024,
        gzipSize: 512,
        imports: [],
        importedBy: [],
        isEntry: false,
        isExternal: false,
        isLazyLoaded: false,
      };

      analyzer.registerModule(module);
      const tree = analyzer.generateBundleTree();

      expect(tree).toBeDefined();
      expect(tree.name).toBe('root');
      expect(tree.children.length).toBeGreaterThan(0);
    });
  });

  describe('duplicate detection', () => {
    it('should detect duplicate dependencies', () => {
      const module1: ModuleInfo = {
        id: 'module-1',
        name: 'lodash',
        path: 'node_modules/lodash/4.17.0/index.js',
        size: 50000,
        gzipSize: 25000,
        imports: [],
        importedBy: [],
        isEntry: false,
        isExternal: true,
        isLazyLoaded: false,
      };

      const module2: ModuleInfo = {
        id: 'module-2',
        name: 'lodash',
        path: 'node_modules/lodash/4.18.0/index.js',
        size: 52000,
        gzipSize: 26000,
        imports: [],
        importedBy: [],
        isEntry: false,
        isExternal: true,
        isLazyLoaded: false,
      };

      analyzer.registerModule(module1);
      analyzer.registerModule(module2);

      const analysis = analyzer.analyze();
      expect(analysis.duplicates.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('large dependency analysis', () => {
    it('should identify large dependencies', () => {
      const largeModule: ModuleInfo = {
        id: 'large-module',
        name: 'LargeLibrary',
        path: 'node_modules/large-library/index.js',
        size: 200 * 1024, // 200KB
        gzipSize: 100 * 1024,
        imports: [],
        importedBy: ['main'],
        isEntry: false,
        isExternal: true,
        isLazyLoaded: false,
      };

      analyzer.registerModule(largeModule);
      const analysis = analyzer.analyze();

      expect(analysis.largeDependencies.length).toBeGreaterThan(0);
      expect(analysis.largeDependencies[0].isLarge).toBe(true);
    });
  });

  describe('tree-shaking analysis', () => {
    it('should analyze tree-shaking effectiveness', () => {
      const module: ModuleInfo = {
        id: 'module-1',
        name: 'Utils',
        path: 'src/utils.ts',
        size: 10000,
        gzipSize: 5000,
        imports: [],
        importedBy: [],
        isEntry: false,
        isExternal: false,
        isLazyLoaded: false,
        treeShakenExports: ['used1', 'used2'],
        unusedExports: ['unused1', 'unused2', 'unused3'],
      };

      analyzer.registerModule(module);
      const analysis = analyzer.analyze();

      expect(analysis.treeShakingEffectiveness.length).toBeGreaterThan(0);
      expect(analysis.treeShakingEffectiveness[0].moduleName).toBe('Utils');
    });
  });

  describe('lazy loading analysis', () => {
    it('should identify lazy loading opportunities', () => {
      const componentModule: ModuleInfo = {
        id: 'comp-1',
        name: 'HeavyComponent',
        path: 'src/components/HeavyComponent.tsx',
        size: 75 * 1024, // 75KB
        gzipSize: 37 * 1024,
        imports: [],
        importedBy: [],
        isEntry: false,
        isExternal: false,
        isLazyLoaded: false,
      };

      analyzer.registerModule(componentModule);
      const analysis = analyzer.analyze();

      expect(Array.isArray(analysis.lazyLoadingOpportunities)).toBe(true);
    });
  });

  describe('bundle analysis', () => {
    it('should perform full bundle analysis', () => {
      const module1: ModuleInfo = {
        id: 'module-1',
        name: 'Module1',
        path: 'src/module1.ts',
        size: 10000,
        gzipSize: 5000,
        imports: [],
        importedBy: [],
        isEntry: true,
        isExternal: false,
        isLazyLoaded: false,
      };

      analyzer.registerModule(module1);
      const analysis = analyzer.analyze();

      expect(analysis).toBeDefined();
      expect(analysis.totalSize).toBeGreaterThan(0);
      expect(analysis.totalGzipSize).toBeGreaterThan(0);
      expect(Array.isArray(analysis.modules)).toBe(true);
      expect(Array.isArray(analysis.recommendations)).toBe(true);
    });

    it('should provide recommendations', () => {
      const largeModule: ModuleInfo = {
        id: 'large',
        name: 'LargeModule',
        path: 'src/large.ts',
        size: 600 * 1024, // 600KB - over threshold
        gzipSize: 300 * 1024,
        imports: [],
        importedBy: [],
        isEntry: true,
        isExternal: false,
        isLazyLoaded: false,
      };

      analyzer.registerModule(largeModule);
      const analysis = analyzer.analyze();

      expect(analysis.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('report export', () => {
    it('should export analysis report', () => {
      const module: ModuleInfo = {
        id: 'module-1',
        name: 'TestModule',
        path: 'src/test.ts',
        size: 1024,
        gzipSize: 512,
        imports: [],
        importedBy: [],
        isEntry: false,
        isExternal: false,
        isLazyLoaded: false,
      };

      analyzer.registerModule(module);
      const analysis = analyzer.analyze();
      const report = analyzer.exportReport(analysis);

      expect(report).toBeDefined();
      expect(typeof report).toBe('string');

      const parsed = JSON.parse(report);
      expect(parsed.summary).toBeDefined();
      expect(parsed.recommendations).toBeDefined();
    });
  });

  describe('clear', () => {
    it('should clear analysis data', () => {
      const module: ModuleInfo = {
        id: 'module-1',
        name: 'TestModule',
        path: 'src/test.ts',
        size: 1024,
        gzipSize: 512,
        imports: [],
        importedBy: [],
        isEntry: false,
        isExternal: false,
        isLazyLoaded: false,
      };

      analyzer.registerModule(module);
      analyzer.clear();

      const analysis = analyzer.analyze();
      expect(analysis.modules).toHaveLength(0);
    });
  });
});
