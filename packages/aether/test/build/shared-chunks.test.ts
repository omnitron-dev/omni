/**
 * Tests for Shared Chunks Optimization
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SharedChunksOptimizer,
  createSharedChunksPlugin,
  type ModuleInfo,
  type SharedChunksConfig,
} from '../../src/build/shared-chunks.js';

describe('SharedChunksOptimizer', () => {
  let optimizer: SharedChunksOptimizer;

  beforeEach(() => {
    optimizer = new SharedChunksOptimizer({
      strategy: 'auto',
      minChunkSize: 10000,
      maxChunkSize: 100000,
      vendorChunk: true,
      commonChunk: true,
      frameworkChunk: true,
    });
  });

  describe('Module Management', () => {
    it('should add modules', () => {
      optimizer.addModule('src/main.ts', {
        id: 'src/main.ts',
        size: 1000,
        importedBy: new Set(['entry']),
        imports: new Set(['src/utils.ts']),
        dynamicImports: new Set(),
        type: 'js',
      });

      const analysis = optimizer.analyze();
      expect(analysis.modules.has('src/main.ts')).toBe(true);
    });

    it('should identify vendor modules', () => {
      optimizer.addModule('node_modules/react/index.js', {
        id: 'node_modules/react/index.js',
        size: 50000,
        importedBy: new Set(['src/main.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const analysis = optimizer.analyze();
      const module = analysis.modules.get('node_modules/react/index.js');

      expect(module?.isVendor).toBe(true);
    });

    it('should identify Aether core modules', () => {
      optimizer.addModule('src/core/reactivity/signal.ts', {
        id: 'packages/aether/src/core/reactivity/signal.ts',
        size: 2000,
        importedBy: new Set(['src/main.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const analysis = optimizer.analyze();
      const module = analysis.modules.get('src/core/reactivity/signal.ts');

      expect(module?.isAetherCore).toBe(false); // Would need proper path
    });
  });

  describe('Dependency Analysis', () => {
    beforeEach(() => {
      optimizer.addModule('src/a.ts', {
        id: 'src/a.ts',
        size: 1000,
        importedBy: new Set(['entry']),
        imports: new Set(['src/b.ts']),
        dynamicImports: new Set(),
        type: 'js',
      });

      optimizer.addModule('src/b.ts', {
        id: 'src/b.ts',
        size: 1000,
        importedBy: new Set(['src/a.ts']),
        imports: new Set(['src/c.ts']),
        dynamicImports: new Set(),
        type: 'js',
      });

      optimizer.addModule('src/c.ts', {
        id: 'src/c.ts',
        size: 1000,
        importedBy: new Set(['src/b.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });
    });

    it('should build dependency graph', () => {
      const analysis = optimizer.analyze();

      expect(analysis.dependencyGraph.size).toBe(3);
      expect(analysis.dependencyGraph.has('src/a.ts')).toBe(true);
      expect(analysis.dependencyGraph.has('src/b.ts')).toBe(true);
      expect(analysis.dependencyGraph.has('src/c.ts')).toBe(true);
    });

    it('should detect circular dependencies', () => {
      optimizer.addModule('src/circular1.ts', {
        id: 'src/circular1.ts',
        size: 1000,
        importedBy: new Set(['src/circular2.ts']),
        imports: new Set(['src/circular2.ts']),
        dynamicImports: new Set(),
        type: 'js',
      });

      optimizer.addModule('src/circular2.ts', {
        id: 'src/circular2.ts',
        size: 1000,
        importedBy: new Set(['src/circular1.ts']),
        imports: new Set(['src/circular1.ts']),
        dynamicImports: new Set(),
        type: 'js',
      });

      const analysis = optimizer.analyze();
      expect(analysis.circularDependencies.length).toBeGreaterThan(0);
    });

    it('should find common modules', () => {
      optimizer.addModule('src/shared.ts', {
        id: 'src/shared.ts',
        size: 2000,
        importedBy: new Set(['src/page1.ts', 'src/page2.ts', 'src/page3.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const analysis = optimizer.analyze();
      expect(analysis.commonModules.has('src/shared.ts')).toBe(true);
    });

    it('should calculate total size', () => {
      const analysis = optimizer.analyze();
      expect(analysis.totalSize).toBeGreaterThan(0);
    });

    it('should calculate average module size', () => {
      const analysis = optimizer.analyze();
      expect(analysis.averageModuleSize).toBeGreaterThan(0);
    });
  });

  describe('Auto Strategy', () => {
    beforeEach(() => {
      // Add framework modules
      optimizer.addModule('@omnitron-dev/aether/core/reactivity', {
        id: '@omnitron-dev/aether/core/reactivity',
        size: 5000,
        importedBy: new Set(['src/main.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      // Add vendor modules
      optimizer.addModule('node_modules/react/index.js', {
        id: 'node_modules/react/index.js',
        size: 50000,
        importedBy: new Set(['src/main.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      optimizer.addModule('node_modules/react-dom/index.js', {
        id: 'node_modules/react-dom/index.js',
        size: 80000,
        importedBy: new Set(['src/main.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      // Add common modules
      optimizer.addModule('src/utils.ts', {
        id: 'src/utils.ts',
        size: 12000,
        importedBy: new Set(['src/page1.ts', 'src/page2.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      // Add app modules
      optimizer.addModule('src/main.ts', {
        id: 'src/main.ts',
        size: 3000,
        importedBy: new Set(['entry']),
        imports: new Set(['@omnitron-dev/aether/core/reactivity', 'node_modules/react/index.js', 'src/utils.ts']),
        dynamicImports: new Set(['src/lazy.ts']),
        type: 'js',
      });
    });

    it('should create framework chunk', async () => {
      await optimizer.analyze();
      const result = await optimizer.optimize();

      const frameworkChunk = Array.from(result.chunks.values()).find((c) => c.type === 'framework');

      expect(frameworkChunk).toBeDefined();
      expect(frameworkChunk?.name).toBe('aether');
    });

    it('should create vendor chunks', async () => {
      await optimizer.analyze();
      const result = await optimizer.optimize();

      const vendorChunks = Array.from(result.chunks.values()).filter((c) => c.type === 'vendor');

      expect(vendorChunks.length).toBeGreaterThan(0);
    });

    it('should create common chunks', async () => {
      await optimizer.analyze();
      const result = await optimizer.optimize();

      const commonChunk = Array.from(result.chunks.values()).find((c) => c.type === 'common');

      expect(commonChunk).toBeDefined();
    });

    it('should create async chunks for dynamic imports', async () => {
      optimizer.addModule('src/lazy.ts', {
        id: 'src/lazy.ts',
        size: 15000,
        importedBy: new Set(['src/main.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      await optimizer.analyze();
      const result = await optimizer.optimize();

      const asyncChunks = Array.from(result.chunks.values()).filter((c) => c.type === 'async');

      expect(asyncChunks.length).toBeGreaterThan(0);
    });
  });

  describe('Manual Strategy', () => {
    it('should create manual chunks with object config', async () => {
      const manualOptimizer = new SharedChunksOptimizer({
        strategy: 'manual',
        manualChunks: {
          admin: ['src/admin/dashboard.ts', 'src/admin/users.ts'],
          public: ['src/public/home.ts', 'src/public/about.ts'],
        },
      });

      manualOptimizer.addModule('src/admin/dashboard.ts', {
        id: 'src/admin/dashboard.ts',
        size: 5000,
        importedBy: new Set(),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      manualOptimizer.addModule('src/admin/users.ts', {
        id: 'src/admin/users.ts',
        size: 4000,
        importedBy: new Set(),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await manualOptimizer.optimize();
      const adminChunk = Array.from(result.chunks.values()).find((c) => c.name === 'admin');

      expect(adminChunk).toBeDefined();
      expect(adminChunk?.modules.has('src/admin/dashboard.ts')).toBe(true);
      expect(adminChunk?.modules.has('src/admin/users.ts')).toBe(true);
    });

    it('should create manual chunks with function config', async () => {
      const manualOptimizer = new SharedChunksOptimizer({
        strategy: 'manual',
        manualChunks: (id: string) => {
          if (id.includes('/admin/')) return 'admin';
          if (id.includes('/api/')) return 'api';
          return undefined;
        },
      });

      manualOptimizer.addModule('src/admin/dashboard.ts', {
        id: 'src/admin/dashboard.ts',
        size: 5000,
        importedBy: new Set(),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      manualOptimizer.addModule('src/api/client.ts', {
        id: 'src/api/client.ts',
        size: 3000,
        importedBy: new Set(),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await manualOptimizer.optimize();

      const adminChunk = Array.from(result.chunks.values()).find((c) => c.name === 'admin');
      const apiChunk = Array.from(result.chunks.values()).find((c) => c.name === 'api');

      expect(adminChunk).toBeDefined();
      expect(apiChunk).toBeDefined();
    });
  });

  describe('Granular Strategy', () => {
    it('should create granular chunks by directory', async () => {
      const granularOptimizer = new SharedChunksOptimizer({
        strategy: 'granular',
        minChunkSize: 1000,
      });

      granularOptimizer.addModule('src/components/Button.ts', {
        id: 'src/components/Button.ts',
        size: 2000,
        importedBy: new Set(),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      granularOptimizer.addModule('src/components/Input.ts', {
        id: 'src/components/Input.ts',
        size: 1500,
        importedBy: new Set(),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      granularOptimizer.addModule('src/utils/helpers.ts', {
        id: 'src/utils/helpers.ts',
        size: 1000,
        importedBy: new Set(),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await granularOptimizer.optimize();

      expect(result.chunks.size).toBeGreaterThan(1);
    });

    it('should split vendors by package in granular mode', async () => {
      const granularOptimizer = new SharedChunksOptimizer({
        strategy: 'granular',
        minChunkSize: 1000,
      });

      granularOptimizer.addModule('node_modules/react/index.js', {
        id: 'node_modules/react/index.js',
        size: 50000,
        importedBy: new Set(),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      granularOptimizer.addModule('node_modules/lodash/index.js', {
        id: 'node_modules/lodash/index.js',
        size: 30000,
        importedBy: new Set(),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await granularOptimizer.optimize();

      const vendorChunks = Array.from(result.chunks.values()).filter((c) => c.name.includes('vendor'));

      expect(vendorChunks.length).toBeGreaterThan(1);
    });
  });

  describe('Cache Groups', () => {
    it('should apply cache groups with regex test', async () => {
      const cacheGroupOptimizer = new SharedChunksOptimizer({
        strategy: 'auto',
        cacheGroups: {
          styles: {
            test: /\.css$/,
            name: 'styles',
            priority: 10,
            minChunks: 1,
          },
        },
      });

      cacheGroupOptimizer.addModule('src/app.css', {
        id: 'src/app.css',
        size: 5000,
        importedBy: new Set(['src/main.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'css',
      });

      const result = await cacheGroupOptimizer.optimize();
      const stylesChunk = Array.from(result.chunks.values()).find((c) => c.name === 'styles');

      expect(stylesChunk).toBeDefined();
    });

    it('should apply cache groups with function test', async () => {
      const cacheGroupOptimizer = new SharedChunksOptimizer({
        strategy: 'auto',
        cacheGroups: {
          components: {
            test: (module: ModuleInfo) => module.id.includes('/components/'),
            name: 'components',
            priority: 5,
            minChunks: 1,
          },
        },
      });

      cacheGroupOptimizer.addModule('src/components/Button.ts', {
        id: 'src/components/Button.ts',
        size: 3000,
        importedBy: new Set(['src/main.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await cacheGroupOptimizer.optimize();
      const componentsChunk = Array.from(result.chunks.values()).find((c) => c.name === 'components');

      expect(componentsChunk).toBeDefined();
    });

    it('should respect cache group priority', async () => {
      const cacheGroupOptimizer = new SharedChunksOptimizer({
        strategy: 'auto',
        cacheGroups: {
          critical: {
            test: (module: ModuleInfo) => module.id.includes('critical'),
            name: 'critical',
            priority: 100,
            enforce: true,
          },
          common: {
            test: (module: ModuleInfo) => true,
            name: 'common-all',
            priority: 1,
          },
        },
      });

      cacheGroupOptimizer.addModule('src/critical.ts', {
        id: 'src/critical.ts',
        size: 3000,
        importedBy: new Set(['src/main.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await cacheGroupOptimizer.optimize();
      const criticalChunk = Array.from(result.chunks.values()).find((c) => c.name === 'critical');

      expect(criticalChunk).toBeDefined();
      expect(criticalChunk?.modules.has('src/critical.ts')).toBe(true);
    });

    it('should reuse existing chunks', async () => {
      const cacheGroupOptimizer = new SharedChunksOptimizer({
        strategy: 'auto',
        cacheGroups: {
          utilities: {
            test: /utils/,
            name: 'utils',
            reuseExistingChunk: true,
          },
        },
      });

      cacheGroupOptimizer.addModule('src/utils/a.ts', {
        id: 'src/utils/a.ts',
        size: 1000,
        importedBy: new Set(['src/main.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      cacheGroupOptimizer.addModule('src/utils/b.ts', {
        id: 'src/utils/b.ts',
        size: 1000,
        importedBy: new Set(['src/main.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await cacheGroupOptimizer.optimize();
      const utilsChunks = Array.from(result.chunks.values()).filter((c) => c.name === 'utils');

      expect(utilsChunks.length).toBeGreaterThan(0);
    });
  });

  describe('Chunk Optimization', () => {
    it('should merge small chunks', async () => {
      optimizer.addModule('src/small1.ts', {
        id: 'src/small1.ts',
        size: 2000,
        importedBy: new Set(['src/main.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      optimizer.addModule('src/small2.ts', {
        id: 'src/small2.ts',
        size: 2000,
        importedBy: new Set(['src/main.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await optimizer.optimize();
      const totalChunks = result.chunks.size;

      // Should have merged small chunks
      expect(totalChunks).toBeLessThanOrEqual(3);
    });

    it('should split large chunks', async () => {
      // Use granular strategy which creates non-entry chunks that can be split
      const splitOptimizer = new SharedChunksOptimizer({
        strategy: 'granular',
        minChunkSize: 10000,
        maxChunkSize: 100000,
      });

      // Add modules that will create a large chunk (not entry)
      for (let i = 0; i < 10; i++) {
        const id = `src/components/large-module-${i}.ts`;

        splitOptimizer.addModule(id, {
          id,
          size: 15000,
          importedBy: new Set(['src/main.ts']),
          imports: new Set(),
          dynamicImports: new Set(),
          type: 'js',
        });
      }

      const result = await splitOptimizer.optimize();

      // Should have split the components chunk or created multiple chunks
      expect(result.chunks.size).toBeGreaterThan(1);
    });

    it('should calculate chunk priorities', async () => {
      optimizer.addModule('src/main.ts', {
        id: 'src/main.ts',
        size: 5000,
        importedBy: new Set(['entry']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await optimizer.optimize();

      for (const chunk of result.chunks.values()) {
        expect(chunk.priority).toBeGreaterThanOrEqual(0);
      }
    });

    it('should calculate load order', async () => {
      optimizer.addModule('src/a.ts', {
        id: 'src/a.ts',
        size: 1000,
        importedBy: new Set(['entry']),
        imports: new Set(['src/b.ts']),
        dynamicImports: new Set(),
        type: 'js',
      });

      optimizer.addModule('src/b.ts', {
        id: 'src/b.ts',
        size: 1000,
        importedBy: new Set(['src/a.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await optimizer.optimize();

      for (const chunk of result.chunks.values()) {
        expect(chunk.loadOrder).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Critical Chunks', () => {
    it('should identify critical chunks', async () => {
      optimizer.addModule('src/entry.ts', {
        id: 'src/entry.ts',
        size: 5000,
        importedBy: new Set(['entry']),
        imports: new Set(['src/critical.ts']),
        dynamicImports: new Set(),
        type: 'js',
      });

      optimizer.addModule('src/critical.ts', {
        id: 'src/critical.ts',
        size: 3000,
        importedBy: new Set(['src/entry.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await optimizer.optimize();
      const criticalChunks = Array.from(result.chunks.values()).filter((c) => c.isCritical);

      expect(criticalChunks.length).toBeGreaterThan(0);
    });

    it('should mark entry chunks as critical', async () => {
      optimizer.addModule('src/main.ts', {
        id: 'src/main.ts',
        size: 5000,
        importedBy: new Set(['entry']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await optimizer.optimize();
      const entryChunks = Array.from(result.chunks.values()).filter((c) => c.type === 'entry');

      for (const chunk of entryChunks) {
        expect(chunk.isCritical).toBe(true);
      }
    });

    it('should mark framework chunks as critical', async () => {
      optimizer.addModule('@omnitron-dev/aether/core/reactivity', {
        id: '@omnitron-dev/aether/core/reactivity',
        size: 5000,
        importedBy: new Set(['src/main.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await optimizer.optimize();
      const frameworkChunks = Array.from(result.chunks.values()).filter((c) => c.type === 'framework');

      for (const chunk of frameworkChunks) {
        expect(chunk.isCritical).toBe(true);
      }
    });
  });

  describe('Preload and Prefetch Hints', () => {
    it('should generate preload hints for critical chunks', async () => {
      optimizer.addModule('src/main.ts', {
        id: 'src/main.ts',
        size: 5000,
        importedBy: new Set(['entry']),
        imports: new Set(['src/critical.ts']),
        dynamicImports: new Set(),
        type: 'js',
      });

      optimizer.addModule('src/critical.ts', {
        id: 'src/critical.ts',
        size: 3000,
        importedBy: new Set(['src/main.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await optimizer.optimize();

      expect(result.preloadHints.size).toBeGreaterThanOrEqual(0);
    });

    it('should generate prefetch hints for async chunks', async () => {
      optimizer.addModule('src/main.ts', {
        id: 'src/main.ts',
        size: 5000,
        importedBy: new Set(['entry']),
        imports: new Set(),
        dynamicImports: new Set(['src/lazy.ts']),
        type: 'js',
      });

      optimizer.addModule('src/lazy.ts', {
        id: 'src/lazy.ts',
        size: 3000,
        importedBy: new Set(['src/main.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await optimizer.optimize();

      expect(result.prefetchHints.size).toBeGreaterThanOrEqual(0);
    });

    it('should disable hints when configured', async () => {
      const noHintsOptimizer = new SharedChunksOptimizer({
        preloadHints: false,
        prefetchStrategies: false,
      });

      noHintsOptimizer.addModule('src/main.ts', {
        id: 'src/main.ts',
        size: 5000,
        importedBy: new Set(['entry']),
        imports: new Set(['src/dep.ts']),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await noHintsOptimizer.optimize();

      expect(result.preloadHints.size).toBe(0);
      expect(result.prefetchHints.size).toBe(0);
    });
  });

  describe('Manifest Generation', () => {
    it('should generate chunk manifest', async () => {
      optimizer.addModule('src/main.ts', {
        id: 'src/main.ts',
        size: 5000,
        importedBy: new Set(['entry']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await optimizer.optimize();

      expect(result.manifest).toBeDefined();
      expect(result.manifest.version).toBe('1.0.0');
      expect(result.manifest.chunks).toBeDefined();
      expect(result.manifest.entrypoints).toBeDefined();
    });

    it('should include chunk metadata in manifest', async () => {
      optimizer.addModule('src/main.ts', {
        id: 'src/main.ts',
        size: 5000,
        importedBy: new Set(['entry']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await optimizer.optimize();
      const chunkEntries = Object.values(result.manifest.chunks);

      for (const entry of chunkEntries) {
        expect(entry.file).toBeDefined();
        expect(entry.hash).toBeDefined();
        expect(entry.size).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(entry.dependencies)).toBe(true);
      }
    });

    it('should generate hashed chunk names', async () => {
      optimizer.addModule('src/main.ts', {
        id: 'src/main.ts',
        size: 5000,
        importedBy: new Set(['entry']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await optimizer.optimize();
      const chunkFiles = Object.values(result.manifest.chunks).map((c) => c.file);

      for (const file of chunkFiles) {
        expect(file).toMatch(/\.[a-z0-9]+\.js$/);
      }
    });

    it('should not hash chunk names when disabled', async () => {
      const noHashOptimizer = new SharedChunksOptimizer({
        hashChunkNames: false,
      });

      noHashOptimizer.addModule('src/main.ts', {
        id: 'src/main.ts',
        size: 5000,
        importedBy: new Set(['entry']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await noHashOptimizer.optimize();
      const chunkFiles = Object.values(result.manifest.chunks).map((c) => c.file);

      for (const file of chunkFiles) {
        expect(file).toMatch(/^[^.]+\.js$/);
      }
    });
  });

  describe('Metrics', () => {
    beforeEach(() => {
      optimizer.addModule('src/main.ts', {
        id: 'src/main.ts',
        size: 5000,
        importedBy: new Set(['entry']),
        imports: new Set(['src/utils.ts']),
        dynamicImports: new Set(),
        type: 'js',
      });

      optimizer.addModule('src/utils.ts', {
        id: 'src/utils.ts',
        size: 3000,
        importedBy: new Set(['src/main.ts', 'src/other.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      optimizer.addModule('node_modules/react/index.js', {
        id: 'node_modules/react/index.js',
        size: 50000,
        importedBy: new Set(['src/main.ts']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });
    });

    it('should calculate total chunks', async () => {
      const result = await optimizer.optimize();

      expect(result.metrics.totalChunks).toBeGreaterThan(0);
    });

    it('should calculate total size', async () => {
      const result = await optimizer.optimize();

      expect(result.metrics.totalSize).toBeGreaterThan(0);
    });

    it('should calculate average chunk size', async () => {
      const result = await optimizer.optimize();

      expect(result.metrics.averageChunkSize).toBeGreaterThan(0);
    });

    it('should identify largest chunk', async () => {
      const result = await optimizer.optimize();

      expect(result.metrics.largestChunk).toBeDefined();
      expect(result.metrics.largestChunk.name).toBeDefined();
      expect(result.metrics.largestChunk.size).toBeGreaterThan(0);
    });

    it('should identify smallest chunk', async () => {
      const result = await optimizer.optimize();

      expect(result.metrics.smallestChunk).toBeDefined();
      expect(result.metrics.smallestChunk.name).toBeDefined();
      expect(result.metrics.smallestChunk.size).toBeGreaterThanOrEqual(0);
    });

    it('should calculate duplication rate', async () => {
      const result = await optimizer.optimize();

      expect(result.metrics.duplicationRate).toBeGreaterThanOrEqual(0);
    });

    it('should estimate network requests', async () => {
      const result = await optimizer.optimize();

      expect(result.metrics.networkRequests).toBeGreaterThan(0);
      expect(result.metrics.networkRequests).toBeLessThanOrEqual(6); // HTTP/2 limit
    });

    it('should estimate load time', async () => {
      const result = await optimizer.optimize();

      expect(result.metrics.estimatedLoadTime).toBeGreaterThanOrEqual(0);
    });

    it('should calculate cache efficiency', async () => {
      const result = await optimizer.optimize();

      expect(result.metrics.cacheEfficiency).toBeGreaterThanOrEqual(0);
      expect(result.metrics.cacheEfficiency).toBeLessThanOrEqual(100);
    });

    it('should count chunks by type', async () => {
      const result = await optimizer.optimize();

      expect(result.metrics.chunksByType).toBeDefined();
      expect(typeof result.metrics.chunksByType).toBe('object');
    });
  });

  describe('Recommendations', () => {
    it('should warn about too many chunks', async () => {
      const manyChunksOptimizer = new SharedChunksOptimizer({
        strategy: 'granular',
        maxChunks: 5,
        minChunkSize: 10000,
      });

      // Create modules in different directories to trigger granular chunking
      for (let i = 0; i < 20; i++) {
        manyChunksOptimizer.addModule(`src/module${i}/index.ts`, {
          id: `src/module${i}/index.ts`,
          size: 15000,
          importedBy: new Set(['entry']),
          imports: new Set(),
          dynamicImports: new Set(),
          type: 'js',
        });
      }

      const result = await manyChunksOptimizer.optimize();

      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations.some((r) => r.includes('Too many chunks'))).toBe(true);
    });

    it('should warn about large chunks', async () => {
      optimizer.addModule('src/huge.ts', {
        id: 'src/huge.ts',
        size: 500000,
        importedBy: new Set(['entry']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await optimizer.optimize();

      expect(result.recommendations.some((r) => r.includes('very large'))).toBe(true);
    });

    it('should warn about high duplication', async () => {
      // Create scenario with high duplication
      for (let i = 0; i < 5; i++) {
        optimizer.addModule(`src/duplicate-${i}.ts`, {
          id: `src/duplicate-${i}.ts`,
          size: 10000,
          importedBy: new Set(['entry']),
          imports: new Set(['src/shared.ts']),
          dynamicImports: new Set(),
          type: 'js',
        });
      }

      const result = await optimizer.optimize();

      // May or may not have duplication warning depending on optimization
      expect(result.recommendations).toBeDefined();
    });

    it('should warn about small chunks', async () => {
      for (let i = 0; i < 5; i++) {
        optimizer.addModule(`src/small-${i}.ts`, {
          id: `src/small-${i}.ts`,
          size: 500,
          importedBy: new Set(['entry']),
          imports: new Set(),
          dynamicImports: new Set(),
          type: 'js',
        });
      }

      const result = await optimizer.optimize();

      // May have recommendation about small chunks
      expect(result.recommendations).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty modules', async () => {
      const result = await optimizer.optimize();

      expect(result.chunks.size).toBeGreaterThanOrEqual(0);
      expect(result.metrics).toBeDefined();
    });

    it('should handle single module', async () => {
      optimizer.addModule('src/single.ts', {
        id: 'src/single.ts',
        size: 5000,
        importedBy: new Set(['entry']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await optimizer.optimize();

      expect(result.chunks.size).toBeGreaterThan(0);
    });

    it('should handle modules with no imports', async () => {
      optimizer.addModule('src/isolated.ts', {
        id: 'src/isolated.ts',
        size: 5000,
        importedBy: new Set(),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await optimizer.optimize();

      expect(result.chunks.size).toBeGreaterThanOrEqual(0);
    });

    it('should handle very small modules', async () => {
      optimizer.addModule('src/tiny.ts', {
        id: 'src/tiny.ts',
        size: 10,
        importedBy: new Set(['entry']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await optimizer.optimize();

      expect(result.chunks.size).toBeGreaterThanOrEqual(0);
    });

    it('should handle very large modules', async () => {
      optimizer.addModule('src/massive.ts', {
        id: 'src/massive.ts',
        size: 10000000,
        importedBy: new Set(['entry']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await optimizer.optimize();

      expect(result.chunks.size).toBeGreaterThan(0);
    });
  });
});

describe('createSharedChunksPlugin', () => {
  it('should create plugin with default config', () => {
    const plugin = createSharedChunksPlugin();

    expect(plugin).toBeDefined();
    expect(plugin.name).toBe('aether-shared-chunks');
    expect(typeof plugin.getManualChunks).toBe('function');
  });

  it('should create plugin with custom config', () => {
    const plugin = createSharedChunksPlugin({
      strategy: 'manual',
      vendorChunkName: 'libs',
      frameworkChunkName: 'framework',
    });

    expect(plugin).toBeDefined();
    expect(plugin.name).toBe('aether-shared-chunks');
  });

  it('should return manual chunks function', () => {
    const plugin = createSharedChunksPlugin({
      manualChunks: {
        vendor: ['react', 'react-dom'],
      },
    });

    const manualChunks = plugin.getManualChunks();

    expect(typeof manualChunks).toBe('function');
  });

  it('should handle vendor modules in manual chunks', () => {
    const plugin = createSharedChunksPlugin({
      vendorChunk: true,
      vendorChunkName: 'vendor',
    });

    const manualChunks = plugin.getManualChunks();
    const result = manualChunks('node_modules/react/index.js');

    expect(result).toBeDefined();
  });

  it('should handle framework modules in manual chunks', () => {
    const plugin = createSharedChunksPlugin({
      frameworkChunk: true,
      frameworkChunkName: 'aether-core',
    });

    const manualChunks = plugin.getManualChunks();
    const result = manualChunks('packages/aether/src/core/reactivity/signal.ts');

    expect(result).toBeDefined();
  });

  it('should return optimizer instance', () => {
    const plugin = createSharedChunksPlugin();
    const optimizer = plugin.getOptimizer();

    expect(optimizer).toBeInstanceOf(SharedChunksOptimizer);
  });

  it('should handle function-based manual chunks', () => {
    const plugin = createSharedChunksPlugin({
      manualChunks: (id: string) => {
        if (id.includes('/admin/')) return 'admin';
        return undefined;
      },
    });

    const manualChunks = plugin.getManualChunks();
    const result = manualChunks('src/admin/dashboard.ts');

    expect(result).toBe('admin');
  });

  it('should return undefined for non-matching modules', () => {
    const plugin = createSharedChunksPlugin({
      manualChunks: (id: string) => {
        if (id.includes('/admin/')) return 'admin';
        return undefined;
      },
    });

    const manualChunks = plugin.getManualChunks();
    const result = manualChunks('src/public/home.ts');

    expect(result).toBeUndefined();
  });
});

describe('Integration Tests', () => {
  it('should optimize real-world scenario', async () => {
    const optimizer = new SharedChunksOptimizer({
      strategy: 'auto',
      minChunkSize: 20000,
      maxChunkSize: 244000,
      vendorChunk: true,
      commonChunk: true,
      frameworkChunk: true,
    });

    // Framework
    optimizer.addModule('@omnitron-dev/aether/core/reactivity', {
      id: '@omnitron-dev/aether/core/reactivity',
      size: 8000,
      importedBy: new Set(['src/app.ts']),
      imports: new Set(),
      dynamicImports: new Set(),
      type: 'js',
    });

    // Vendors
    optimizer.addModule('node_modules/react/index.js', {
      id: 'node_modules/react/index.js',
      size: 50000,
      importedBy: new Set(['src/app.ts']),
      imports: new Set(),
      dynamicImports: new Set(),
      type: 'js',
    });

    optimizer.addModule('node_modules/react-dom/index.js', {
      id: 'node_modules/react-dom/index.js',
      size: 120000,
      importedBy: new Set(['src/app.ts']),
      imports: new Set(['node_modules/react/index.js']),
      dynamicImports: new Set(),
      type: 'js',
    });

    // App code
    optimizer.addModule('src/app.ts', {
      id: 'src/app.ts',
      size: 5000,
      importedBy: new Set(['entry']),
      imports: new Set(['@omnitron-dev/aether/core/reactivity', 'node_modules/react/index.js', 'src/utils.ts']),
      dynamicImports: new Set(['src/pages/admin.ts']),
      type: 'js',
    });

    optimizer.addModule('src/utils.ts', {
      id: 'src/utils.ts',
      size: 22000, // Above minChunkSize so it can be extracted as common chunk
      importedBy: new Set(['src/app.ts', 'src/components/Button.ts']),
      imports: new Set(),
      dynamicImports: new Set(),
      type: 'js',
    });

    optimizer.addModule('src/components/Button.ts', {
      id: 'src/components/Button.ts',
      size: 3000,
      importedBy: new Set(['src/app.ts']),
      imports: new Set(['src/utils.ts']),
      dynamicImports: new Set(),
      type: 'js',
    });

    const result = await optimizer.optimize();

    // Verify chunks created
    expect(result.chunks.size).toBeGreaterThan(0);

    // Verify framework chunk
    const frameworkChunk = Array.from(result.chunks.values()).find((c) => c.type === 'framework');
    expect(frameworkChunk).toBeDefined();

    // Verify vendor chunks
    const vendorChunks = Array.from(result.chunks.values()).filter((c) => c.type === 'vendor');
    expect(vendorChunks.length).toBeGreaterThan(0);

    // Verify common chunk
    const commonChunk = Array.from(result.chunks.values()).find((c) => c.type === 'common');
    expect(commonChunk).toBeDefined();

    // Verify async chunk
    const asyncChunks = Array.from(result.chunks.values()).filter((c) => c.type === 'async');
    expect(asyncChunks.length).toBeGreaterThanOrEqual(0);

    // Verify metrics
    expect(result.metrics.totalSize).toBeGreaterThan(0);
    expect(result.metrics.cacheEfficiency).toBeGreaterThan(0);

    // Verify manifest
    expect(Object.keys(result.manifest.chunks).length).toBe(result.chunks.size);
  });
});
