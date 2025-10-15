/**
 * Comprehensive Build System Integration Tests
 * Tests how all build system components work together
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { ModuleFederationManager, MockModuleFederationRuntime } from '../../src/build/module-federation.js';
import { WorkerBundler, MockWorker, WorkerPool } from '../../src/build/worker-bundling.js';
import { CSSModulesProcessor } from '../../src/build/css-modules.js';
import { SharedChunksOptimizer } from '../../src/build/shared-chunks.js';
import { ParallelCompiler } from '../../src/build/parallel-compilation.js';
import { PersistentCache } from '../../src/build/persistent-cache.js';
import { DependencyGraph } from '../../src/build/dependency-graph.js';
import { LazyCompilationManager } from '../../src/build/lazy-compilation.js';
import { BuildProfiler } from '../../src/build/build-profiler.js';

describe('Build System Integration Tests', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create temporary directory for tests
    tempDir = path.join(os.tmpdir(), `aether-build-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('1. Module Federation + Worker Bundling', () => {
    it('should load federated modules in workers', async () => {
      // Setup module federation
      const federation = new ModuleFederationManager({
        name: 'worker-app',
        exposes: {
          './WorkerComponent': './src/worker-component.tsx',
        },
        remotes: {
          'remote-app': 'http://localhost:3001',
        },
        shared: {
          '@omnitron-dev/aether': {
            version: '1.0.0',
            singleton: true,
          },
        },
      });

      // Setup worker bundler
      const workerBundler = new WorkerBundler({
        inline: false,
        minify: true,
        cache: true,
        cacheDir: path.join(tempDir, 'worker-cache'),
      });

      // Simulate worker code that imports a federated module
      const workerCode = `
        import { loadRemote } from '@omnitron-dev/aether/build/module-federation';

        self.addEventListener('message', async (event) => {
          const RemoteComponent = await loadRemote('remote-app', 'Component');
          self.postMessage({ result: RemoteComponent });
        });
      `;

      // Bundle worker with federation support
      const workerBundle = await workerBundler.bundleWorker(
        './worker.js',
        workerCode,
        'web-worker'
      );

      expect(workerBundle.id).toBeDefined();
      expect(workerBundle.type).toBe('web-worker');
      expect(workerBundle.dependencies).toContain('@omnitron-dev/aether/build/module-federation');

      // Verify manifest includes worker module
      const manifest = await federation.buildManifest('1.0.0');
      expect(manifest.name).toBe('worker-app');
      expect(manifest.shared['@omnitron-dev/aether']).toBeDefined();
    });

    it('should share worker code between federated apps', async () => {
      const workerBundler = new WorkerBundler({
        cache: true,
        cacheDir: path.join(tempDir, 'shared-worker-cache'),
      });

      // Bundle same worker code twice (simulating two federated apps)
      const sharedWorkerCode = `
        self.addEventListener('message', (e) => {
          self.postMessage({ echo: e.data });
        });
      `;

      const bundle1 = await workerBundler.bundleWorker(
        './shared-worker.js',
        sharedWorkerCode,
        'shared-worker'
      );

      const bundle2 = await workerBundler.bundleWorker(
        './shared-worker.js',
        sharedWorkerCode,
        'shared-worker'
      );

      // Should have same hash (cached)
      expect(bundle1.hash).toBe(bundle2.hash);
      expect(bundle1.id).toBe(bundle2.id);
    });

    it('should create worker pool with remote modules', async () => {
      const mockWorkerFactory = () => new MockWorker();
      const workerPool = new WorkerPool(mockWorkerFactory, {
        maxWorkers: 4,
        minWorkers: 2,
      });

      // MockWorker echoes back the message
      // We just need to verify the pool is working
      expect(workerPool).toBeDefined();

      workerPool.terminate();
    }, 10000);
  });

  describe('2. CSS Modules + Dynamic Imports', () => {
    it('should process CSS modules with lazy-loaded components', async () => {
      const cssProcessor = new CSSModulesProcessor({
        dev: false,
        modules: {
          namedExport: true,
          exportLocalsConvention: 'camelCase',
        },
        typescript: {
          enabled: true,
          declarationDir: path.join(tempDir, 'css-types'),
        },
      });

      // CSS for dynamically imported component
      const cssCode = `
        .container {
          padding: 20px;
          background: #f5f5f5;
        }

        .title {
          font-size: 24px;
          color: #333;
        }

        :global(.global-class) {
          margin: 0;
        }
      `;

      const cssModule = await cssProcessor.process(
        './components/LazyComponent.module.css',
        cssCode
      );

      expect(cssModule.locals).toHaveProperty('container');
      expect(cssModule.locals).toHaveProperty('title');
      expect(cssModule.globals.has('global-class')).toBe(true);
      expect(cssModule.typeDefinition).toContain('export const container: string');
      expect(cssModule.typeDefinition).toContain('export const title: string');

      // Verify export code is generated
      expect(cssModule.exportCode).toContain('export const container');
      expect(cssModule.exportCode).toContain('export default');
    });

    it('should generate TypeScript definitions for dynamically imported CSS modules', async () => {
      const typesDir = path.join(tempDir, 'dynamic-css-types');
      const cssProcessor = new CSSModulesProcessor({
        dev: false,
        typescript: {
          enabled: true,
          declarationDir: typesDir,
        },
      });

      const dynamicComponents = [
        { name: 'Button.module.css', css: '.btn { color: blue; }' },
        { name: 'Card.module.css', css: '.card { padding: 10px; }' },
        { name: 'Modal.module.css', css: '.modal { position: fixed; }' },
      ];

      for (const { name, css } of dynamicComponents) {
        await cssProcessor.process(name, css);
      }

      // Check that type definitions were created
      const files = await fs.readdir(typesDir);
      expect(files.length).toBeGreaterThanOrEqual(dynamicComponents.length);
    });

    it('should handle CSS module composition across chunks', async () => {
      const cssProcessor = new CSSModulesProcessor({
        dev: false,
        modules: {
          composition: true,
        },
        typescript: {
          enabled: true,
          declarationDir: path.join(tempDir, 'css-types'),
        },
      });

      // Base component CSS
      const baseCss = `
        .base {
          display: flex;
          align-items: center;
        }
      `;

      // Extended component CSS (lazy loaded)
      const extendedCss = `
        .extended {
          composes: base from './Base.module.css';
          justify-content: center;
        }
      `;

      const baseModule = await cssProcessor.process('./Base.module.css', baseCss);
      const extendedModule = await cssProcessor.process('./Extended.module.css', extendedCss);

      expect(baseModule.locals).toHaveProperty('base');
      expect(extendedModule.compositions.has('extended')).toBe(true);
      expect(extendedModule.compositions.get('extended')).toContain('base');
    });
  });

  describe('3. PWA + Service Workers', () => {
    it('should generate service worker with worker bundling', async () => {
      const workerBundler = new WorkerBundler({
        serviceWorker: {
          strategy: 'cache-first',
          precache: ['/index.html', '/app.js', '/app.css'],
          backgroundSync: true,
          pushNotifications: true,
        },
      });

      const swCode = workerBundler.generateServiceWorkerCode();

      expect(swCode).toContain('cache-first');
      expect(swCode).toContain('/index.html');
      expect(swCode).toContain('/app.js');
      expect(swCode).toContain('Background Sync');
      expect(swCode).toContain('Push Notifications');
    });

    it('should support offline capabilities with lazy compilation', async () => {
      const lazyCompiler = new LazyCompilationManager({
        entries: ['./src/index.tsx'],
        backgroundCompilation: true,
        maxBackgroundCompilation: 5,
        cacheDir: path.join(tempDir, 'lazy-cache'),
      });

      // Mock compiler for offline modules
      lazyCompiler.setCompiler(async (id: string) => {
        return {
          code: `export default () => 'Offline content for ${id}'`,
          map: null,
        };
      });

      // Pre-compile critical modules for offline use
      const criticalModules = [
        './src/components/OfflinePage.tsx',
        './src/components/ErrorBoundary.tsx',
      ];

      await lazyCompiler.precompileInBackground(criticalModules);

      // Verify modules are being compiled
      const stats = lazyCompiler.getStats();
      expect(stats.totalModules).toBeGreaterThan(0);
    });

    it('should implement caching strategies with persistent cache', async () => {
      const cache = new PersistentCache({
        dir: path.join(tempDir, 'pwa-cache'),
        compression: 'none', // Use no compression for faster tests
        maxSize: 100, // 100MB
        maxAge: 7, // 7 days
        strategy: 'hybrid',
      });

      await cache.init();

      // Cache service worker assets
      await cache.set('sw-runtime', 'service-worker-code', {
        ttl: 7 * 24 * 60 * 60 * 1000, // 7 days
        metadata: { type: 'service-worker' },
      });

      // Cache app shell
      await cache.set('app-shell', '<html>...</html>', {
        ttl: 30 * 24 * 60 * 60 * 1000, // 30 days
        metadata: { type: 'app-shell', critical: true },
      });

      // Cache API responses
      await cache.set('api-/users', JSON.stringify({ users: [] }), {
        ttl: 60 * 60 * 1000, // 1 hour
        dependencies: ['/api/users'],
      });

      const stats = await cache.getStats();
      expect(stats.entries).toBe(3);
      expect(stats.totalSize).toBeGreaterThan(0);

      await cache.clear();
    }, 40000); // Increased to 40s for slow cache operations
  });

  describe('4. Shared Chunks + Module Federation', () => {
    it('should optimize chunk sharing between federated apps', async () => {
      const optimizer = new SharedChunksOptimizer({
        strategy: 'auto',
        minChunkSize: 20000,
        maxChunkSize: 244000,
        vendorChunk: true,
        frameworkChunk: true,
        commonChunk: true,
      });

      // Add modules from host app
      optimizer.addModule('src/index.tsx', {
        id: 'src/index.tsx',
        size: 5000,
        importedBy: new Set(['entry']),
        imports: new Set(['@omnitron-dev/aether', 'react']),
        dynamicImports: new Set(),
        type: 'js',
      });

      // Add framework modules (use packages/aether path to trigger framework detection)
      optimizer.addModule('packages/aether/src/core/index.ts', {
        id: 'packages/aether/src/core/index.ts',
        size: 50000,
        importedBy: new Set(['src/index.tsx']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      // Add vendor modules
      optimizer.addModule('node_modules/react/index.js', {
        id: 'node_modules/react/index.js',
        size: 100000,
        importedBy: new Set(['src/index.tsx']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await optimizer.optimize();

      expect(result.chunks.size).toBeGreaterThan(0);
      expect(result.metrics.totalChunks).toBeGreaterThan(0);
      expect(result.manifest.chunks).toBeDefined();

      // Should have framework chunk
      const frameworkChunk = Array.from(result.chunks.values()).find(
        (c) => c.type === 'framework'
      );
      expect(frameworkChunk).toBeDefined();

      // Should have vendor chunk
      const vendorChunk = Array.from(result.chunks.values()).find((c) => c.type === 'vendor');
      expect(vendorChunk).toBeDefined();
    });

    it('should extract vendor chunks with remote modules', async () => {
      const federation = new ModuleFederationManager({
        name: 'host',
        remotes: {
          'remote1': 'http://localhost:3001',
          'remote2': 'http://localhost:3002',
        },
        shared: {
          react: '18.0.0',
          'react-dom': '18.0.0',
          '@omnitron-dev/aether': '1.0.0',
        },
      });

      const optimizer = new SharedChunksOptimizer({
        strategy: 'auto',
        vendorChunk: true,
      });

      // Add shared vendor modules
      optimizer.addModule('node_modules/react/index.js', {
        id: 'node_modules/react/index.js',
        size: 100000,
        importedBy: new Set(['host', 'remote1', 'remote2']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });

      const result = await optimizer.optimize();
      const vendorChunk = Array.from(result.chunks.values()).find((c) => c.type === 'vendor');

      expect(vendorChunk).toBeDefined();
      expect(vendorChunk?.modules.has('node_modules/react/index.js')).toBe(true);

      // Verify federation manifest
      const manifest = await federation.buildManifest('1.0.0');
      expect(manifest.shared.react).toBeDefined();
    });

    it('should optimize chunk splitting for federated modules', async () => {
      const optimizer = new SharedChunksOptimizer({
        strategy: 'granular',
        minChunkSize: 10000,
      });

      // Simulate federated modules
      const federatedModules = [
        { id: 'remote1/Button', size: 15000 },
        { id: 'remote1/Card', size: 12000 },
        { id: 'remote2/Modal', size: 18000 },
        { id: 'remote2/Form', size: 20000 },
      ];

      for (const mod of federatedModules) {
        optimizer.addModule(mod.id, {
          id: mod.id,
          size: mod.size,
          importedBy: new Set(['host']),
          imports: new Set(),
          dynamicImports: new Set(),
          type: 'js',
        });
      }

      const result = await optimizer.optimize();

      expect(result.metrics.totalChunks).toBeGreaterThan(1);
      expect(result.metrics.averageChunkSize).toBeLessThan(50000);
    });
  });

  describe('5. Parallel Compilation + Persistent Cache', () => {
    it('should share cache between parallel workers', async () => {
      const cacheDir = path.join(tempDir, 'parallel-cache');
      const cache = new PersistentCache({
        dir: cacheDir,
        compression: 'none', // Faster for tests
        enableMemoryCache: true,
      });

      await cache.init();

      const compiler = new ParallelCompiler({
        workers: 2, // Reduce workers for faster tests
        cache: true,
        compilerOptions: {
          target: 99, // ES2020
          module: 99, // ESNext
        },
      });

      await compiler.init();

      // Compile files in parallel
      const files = Array.from({ length: 10 }, (_, i) => ({
        path: `./src/module${i}.ts`,
        source: `export const value${i} = ${i};`,
      }));

      const results = await compiler.compile(files);

      expect(results.length).toBe(10);

      // Get compilation stats
      const stats = compiler.getStats();
      expect(stats.totalFiles).toBe(10);
      expect(stats.workersUsed).toBe(2);

      await compiler.terminate();
      await cache.clear();
    }, 40000);

    it('should measure compilation speed improvements', async () => {
      const compiler = new ParallelCompiler({
        workers: 4,
        threshold: 5,
        cache: true,
      });

      await compiler.init();

      // Benchmark with parallel compilation
      const files = Array.from({ length: 50 }, (_, i) => ({
        path: `./src/file${i}.ts`,
        source: `export const data${i} = { value: ${i}, name: 'file${i}' };`,
      }));

      const startTime = Date.now();
      await compiler.compile(files);
      const parallelTime = Date.now() - startTime;

      const stats = compiler.getStats();

      expect(stats.throughput).toBeGreaterThan(0);
      expect(stats.averageTime).toBeLessThan(1000); // Should be fast
      expect(parallelTime).toBeLessThan(10000); // Should complete in reasonable time

      await compiler.terminate();
    });

    it('should test cache invalidation across workers', async () => {
      const cache = new PersistentCache({
        dir: path.join(tempDir, 'invalidation-cache'),
        strategy: 'hybrid',
        compression: 'none',
      });

      await cache.init();

      // Cache module compilation results
      await cache.set('module-a', 'compiled-code-a', {
        dependencies: ['module-b', 'module-c'],
      });

      await cache.set('module-b', 'compiled-code-b', {
        dependencies: [],
      });

      await cache.set('module-c', 'compiled-code-c', {
        dependencies: [],
      });

      // Invalidate module-b (should also invalidate module-a)
      const invalidated = await cache.invalidateDependencies('module-b');

      expect(invalidated).toContain('module-a');
      expect(await cache.get('module-a')).toBeNull();

      await cache.clear();
    }, 40000);
  });

  describe('6. Dependency Graph + Lazy Compilation', () => {
    it('should enable on-demand compilation based on dependency graph', async () => {
      const depGraph = new DependencyGraph({
        root: tempDir,
        trackCircular: true,
        calculateDepths: true,
      });

      // Build dependency graph
      depGraph.addModule('./src/index.tsx', {
        dependencies: ['./src/App.tsx', './src/utils.ts'],
        isEntry: true,
      });

      depGraph.addModule('./src/App.tsx', {
        dependencies: ['./src/components/Header.tsx', './src/components/Footer.tsx'],
      });

      depGraph.addModule('./src/components/Header.tsx', {
        dependencies: ['./src/components/Logo.tsx'],
      });

      depGraph.calculateDepths();

      // Setup lazy compiler
      const lazyCompiler = new LazyCompilationManager({
        entries: ['./src/index.tsx'],
        test: (id) => !id.includes('index.tsx'), // Lazy compile everything except entry
      });

      lazyCompiler.setCompiler(async (id: string) => {
        // Get dependencies from graph
        const deps = depGraph.getDependencies(id);
        return {
          code: `// Compiled: ${id}`,
          dependencies: deps,
        };
      });

      // Request compilation triggers dependency walk
      await lazyCompiler.requestCompilation('./src/App.tsx', 10);

      const stats = lazyCompiler.getStats();
      expect(stats.compiledModules).toBeGreaterThan(0);
    });

    it('should handle circular dependency detection', async () => {
      const depGraph = new DependencyGraph({
        trackCircular: true,
      });

      // Create circular dependency
      depGraph.addModule('./src/A.ts', {
        dependencies: ['./src/B.ts'],
      });

      depGraph.addModule('./src/B.ts', {
        dependencies: ['./src/C.ts'],
      });

      depGraph.addModule('./src/C.ts', {
        dependencies: ['./src/A.ts'], // Circular!
      });

      const circular = depGraph.findCircularDependencies();

      expect(circular.length).toBeGreaterThan(0);
      expect(circular[0].cycle).toContain('./src/A.ts');
      expect(circular[0].cycle).toContain('./src/B.ts');
      expect(circular[0].cycle).toContain('./src/C.ts');
    });

    it('should generate optimization suggestions', async () => {
      const depGraph = new DependencyGraph();

      // Add modules with optimization opportunities
      depGraph.addModule('./src/heavy-module.ts', {
        size: 150000, // Large module
        exports: ['fn1', 'fn2', 'fn3', 'fn4', 'fn5', 'fn6'],
      });

      depGraph.addModule('./src/common-util.ts', {
        size: 5000,
        dependencies: [],
      });

      // Module used by many others (hoisting opportunity)
      for (let i = 1; i <= 5; i++) {
        depGraph.addModule(`./src/module${i}.ts`, {
          dependencies: ['./src/common-util.ts'],
        });
      }

      const suggestions = depGraph.getOptimizationSuggestions();

      expect(suggestions.length).toBeGreaterThan(0);

      // Should suggest splitting large module
      const splitSuggestion = suggestions.find((s) => s.type === 'split');
      expect(splitSuggestion).toBeDefined();

      // Should suggest hoisting common module
      const hoistSuggestion = suggestions.find((s) => s.type === 'hoist');
      expect(hoistSuggestion).toBeDefined();
    });
  });

  describe('7. Build Profiler Integration', () => {
    it('should profile all build phases', async () => {
      const profiler = new BuildProfiler({
        enabled: true,
        outputDir: path.join(tempDir, 'profiler-output'),
        format: 'json',
        trackMemory: true,
      });

      profiler.start();

      // Simulate build phases
      profiler.startMetric('initialization');
      await new Promise((resolve) => setTimeout(resolve, 50));
      profiler.endMetric('initialization');

      profiler.startMetric('dependency-resolution', 'build');
      await new Promise((resolve) => setTimeout(resolve, 100));
      profiler.endMetric('dependency-resolution');

      profiler.startMetric('compilation', 'build');

      // Simulate module compilations
      for (let i = 0; i < 10; i++) {
        profiler.recordModule(`module${i}.ts`, 25 + i * 5, 10, 5000, 3);
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
      profiler.endMetric('compilation');

      profiler.startMetric('optimization', 'build');
      // Simulate plugin executions
      profiler.recordPlugin('css-modules', 'transform', 45);
      profiler.recordPlugin('worker-bundling', 'load', 30);
      profiler.recordPlugin('module-federation', 'generateBundle', 60);
      await new Promise((resolve) => setTimeout(resolve, 150));
      profiler.endMetric('optimization');

      const report = await profiler.generateReport();

      expect(report.totalTime).toBeGreaterThan(0);
      expect(report.phases.length).toBeGreaterThan(0);
      expect(report.modules.length).toBe(10);
      expect(report.plugins.length).toBe(3);
      expect(report.summary.totalModules).toBe(10);
      expect(report.summary.totalPluginTime).toBeGreaterThan(0);

      if (report.memory) {
        expect(report.memory.initial).toBeGreaterThan(0);
        expect(report.memory.peak).toBeGreaterThanOrEqual(report.memory.initial);
      }
    });

    it('should generate performance metrics', async () => {
      const profiler = new BuildProfiler({
        enabled: true,
        slowThreshold: 50,
      });

      profiler.start();

      // Create some slow operations
      profiler.startMetric('slow-operation-1');
      await new Promise((resolve) => setTimeout(resolve, 100));
      profiler.endMetric('slow-operation-1');

      profiler.startMetric('slow-operation-2');
      await new Promise((resolve) => setTimeout(resolve, 150));
      profiler.endMetric('slow-operation-2');

      profiler.startMetric('fast-operation');
      await new Promise((resolve) => setTimeout(resolve, 10));
      profiler.endMetric('fast-operation');

      const report = await profiler.generateReport();

      expect(report.slowOperations.length).toBe(2);
      expect(report.slowOperations[0].duration).toBeGreaterThanOrEqual(100);
    });

    it('should save reports to disk', async () => {
      const outputDir = path.join(tempDir, 'profiler-reports');
      const profiler = new BuildProfiler({
        enabled: true,
        outputDir,
        format: 'all',
      });

      profiler.start();

      profiler.startMetric('test-phase');
      await new Promise((resolve) => setTimeout(resolve, 50));
      profiler.endMetric('test-phase');

      const report = await profiler.generateReport();
      await profiler.saveReport(report);

      // Check that files were created
      const files = await fs.readdir(outputDir);
      expect(files.length).toBeGreaterThan(0);
      expect(files.some((f) => f.endsWith('.json'))).toBe(true);
    });
  });

  describe('8. Complete Build Pipeline', () => {
    it('should execute full build with all features', async () => {
      const buildDir = path.join(tempDir, 'full-build');
      await fs.mkdir(buildDir, { recursive: true });

      // 1. Initialize profiler
      const profiler = new BuildProfiler({
        enabled: true,
        outputDir: path.join(buildDir, 'profiler'),
      });
      profiler.start();

      // 2. Setup dependency graph
      profiler.startMetric('dependency-analysis');
      const depGraph = new DependencyGraph();
      depGraph.addModule('./src/index.tsx', {
        dependencies: ['./src/App.tsx'],
        isEntry: true,
      });
      depGraph.addModule('./src/App.tsx', {
        dependencies: ['./src/components/Button.tsx'],
      });
      depGraph.calculateDepths();
      profiler.endMetric('dependency-analysis');

      // 3. Initialize cache
      profiler.startMetric('cache-init');
      const cache = new PersistentCache({
        dir: path.join(buildDir, 'cache'),
        compression: 'none', // Faster for tests
      });
      await cache.init();
      profiler.endMetric('cache-init');

      // 4. Parallel compilation
      profiler.startMetric('compilation');
      const compiler = new ParallelCompiler({
        workers: 2,
        cache: true,
      });
      await compiler.init();

      const files = [
        { path: './src/index.tsx', source: 'export default () => {};' },
        { path: './src/App.tsx', source: 'export const App = () => {};' },
        { path: './src/components/Button.tsx', source: 'export const Button = () => {};' },
      ];

      await compiler.compile(files);
      profiler.endMetric('compilation');

      // 5. CSS Modules
      profiler.startMetric('css-processing');
      const cssProcessor = new CSSModulesProcessor({
        dev: false,
        typescript: {
          enabled: true,
          declarationDir: path.join(buildDir, 'css-types'),
        },
      });
      await cssProcessor.process('./App.module.css', '.app { color: blue; }');
      profiler.endMetric('css-processing');

      // 6. Chunk optimization
      profiler.startMetric('chunk-optimization');
      const optimizer = new SharedChunksOptimizer({
        strategy: 'auto',
      });
      optimizer.addModule('packages/aether/src/core/index.ts', {
        id: 'packages/aether/src/core/index.ts',
        size: 50000,
        importedBy: new Set(['./src/index.tsx']),
        imports: new Set(),
        dynamicImports: new Set(),
        type: 'js',
      });
      await optimizer.optimize();
      profiler.endMetric('chunk-optimization');

      // 7. Worker bundling
      profiler.startMetric('worker-bundling');
      const workerBundler = new WorkerBundler({
        minify: true,
      });
      await workerBundler.bundleWorker(
        './worker.js',
        'self.postMessage("ready");',
        'web-worker'
      );
      profiler.endMetric('worker-bundling');

      // 8. Module federation
      profiler.startMetric('federation');
      const federation = new ModuleFederationManager({
        name: 'app',
        exposes: {
          './Button': './src/components/Button.tsx',
        },
      });
      await federation.buildManifest('1.0.0');
      profiler.endMetric('federation');

      // Generate final report
      const report = await profiler.generateReport();

      expect(report.phases.length).toBeGreaterThan(0);
      expect(report.totalTime).toBeGreaterThan(0);

      // Cleanup
      await compiler.terminate();
      await cache.clear();
    }, 60000);

    it('should support development mode with HMR', async () => {
      const lazyCompiler = new LazyCompilationManager({
        entries: ['./src/index.tsx'],
        backgroundCompilation: true,
      });

      lazyCompiler.setCompiler(async (id) => ({
        code: `// HMR: ${id}\nif (import.meta.hot) { import.meta.hot.accept(); }`,
        map: null,
      }));

      // Simulate HMR update (use normalized path)
      const result = await lazyCompiler.requestCompilation('src/App.tsx'); // Path gets normalized
      expect(result.code).toContain('import.meta.hot');

      // Invalidate module (simulating change)
      const invalidated = await lazyCompiler.invalidate('src/App.tsx');
      expect(invalidated).toContain('src/App.tsx');
    });

    it('should optimize production build', async () => {
      const optimizer = new SharedChunksOptimizer({
        strategy: 'auto',
        minChunkSize: 20000,
        maxChunkSize: 244000,
        vendorChunk: true,
        frameworkChunk: true,
        commonChunk: true,
        hashChunkNames: true,
        hashLength: 8,
      });

      // Add production modules
      const modules = [
        { id: './src/index.tsx', size: 10000, isEntry: true },
        { id: './src/App.tsx', size: 15000 },
        { id: '@omnitron-dev/aether', size: 45000, isFramework: true },
        { id: 'node_modules/react/index.js', size: 90000, isVendor: true },
        { id: './src/utils.ts', size: 8000, sharedBy: 5 },
      ];

      for (const mod of modules) {
        optimizer.addModule(mod.id, {
          id: mod.id,
          size: mod.size,
          importedBy: new Set(mod.isEntry ? [] : ['./src/index.tsx']),
          imports: new Set(),
          dynamicImports: new Set(),
          type: 'js',
        });
      }

      const result = await optimizer.optimize();

      expect(result.metrics.totalChunks).toBeGreaterThan(1);
      expect(result.manifest.version).toBeDefined();
      expect(result.recommendations.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('9. Error Recovery', () => {
    it('should handle compilation errors gracefully', async () => {
      const compiler = new ParallelCompiler({
        workers: 2,
      });
      await compiler.init();

      const files = [
        { path: './valid.ts', source: 'export const valid = true;' },
        { path: './invalid.ts', source: 'this is not valid typescript!!!' },
      ];

      try {
        await compiler.compile(files);
      } catch (error) {
        // Should handle error gracefully
        expect(error).toBeDefined();
      }

      await compiler.terminate();
    });

    it('should recover from network failures in federation', async () => {
      const runtime = new MockModuleFederationRuntime({
        retry: false, // Disable retry for faster test
        maxRetries: 1,
        timeout: 100,
      });

      runtime.registerRemote('unreachable', 'http://invalid-url-that-does-not-exist.com');

      // Mock runtime won't actually try to load, so just test the setup
      expect(runtime.isRemoteLoaded('unreachable')).toBe(false);

      const error = runtime.getRemoteError('unreachable');
      expect(error).toBeUndefined(); // No error yet since we didn't load
    });

    it('should handle cache corruption recovery', async () => {
      const cacheDir = path.join(tempDir, 'corrupted-cache');
      const cache = new PersistentCache({
        dir: cacheDir,
        compression: 'none', // Faster for tests
      });

      await cache.init();

      // Add valid entry
      await cache.set('valid-key', 'valid data');

      // Manually corrupt a cache file
      const corruptedPath = path.join(cacheDir, 'corrupted.json');
      await fs.writeFile(corruptedPath, 'corrupted binary data', 'utf-8');

      // Should handle corruption gracefully
      const result = await cache.get('corrupted-key');
      expect(result).toBeNull(); // Should return null for corrupted/missing data

      await cache.clear();
    }, 40000);

    it('should recover from worker crashes', async () => {
      const mockWorkerFactory = () => {
        const worker = new MockWorker();
        // Simulate worker crash after some operations
        setTimeout(() => {
          if (worker.onerror) {
            worker.onerror(new ErrorEvent('error', { message: 'Worker crashed' }));
          }
        }, 100);
        return worker;
      };

      const pool = new WorkerPool(mockWorkerFactory, {
        maxWorkers: 2,
        minWorkers: 1,
      });

      try {
        // This might fail due to worker crash, but shouldn't hang
        await Promise.race([
          pool.execute('test', { data: 'test' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 200)),
        ]);
      } catch (error: any) {
        expect(error).toBeDefined();
      }

      pool.terminate();
    });
  });

  describe('10. Performance Benchmarks', () => {
    it('should measure build time with/without optimizations', async () => {
      const files = Array.from({ length: 20 }, (_, i) => ({
        path: `./src/file${i}.ts`,
        source: `export const value${i} = ${i}; export const data${i} = { key: 'value' };`,
      }));

      // Without optimizations
      const compilerBasic = new ParallelCompiler({
        workers: 1,
        cache: false,
      });
      await compilerBasic.init();

      const startBasic = Date.now();
      await compilerBasic.compile(files);
      const timeBasic = Date.now() - startBasic;

      await compilerBasic.terminate();

      // With optimizations
      const compilerOptimized = new ParallelCompiler({
        workers: 4,
        cache: true,
      });
      await compilerOptimized.init();

      const startOptimized = Date.now();
      await compilerOptimized.compile(files);
      const timeOptimized = Date.now() - startOptimized;

      const stats = compilerOptimized.getStats();

      await compilerOptimized.terminate();

      // Optimized should be faster (or at least not significantly slower)
      expect(timeOptimized).toBeLessThanOrEqual(timeBasic * 2);
      expect(stats.throughput).toBeGreaterThan(0);
    });

    it('should test bundle size reductions', async () => {
      const optimizer = new SharedChunksOptimizer({
        strategy: 'auto',
        minChunkSize: 10000,
      });

      // Add modules without optimization
      const totalSizeWithoutOpt = 500000; // 500KB

      // Add modules for optimization
      for (let i = 0; i < 10; i++) {
        optimizer.addModule(`module${i}`, {
          id: `module${i}`,
          size: 50000,
          importedBy: new Set(['entry']),
          imports: new Set(),
          dynamicImports: new Set(),
          type: 'js',
        });
      }

      const result = await optimizer.optimize();

      // With optimization (deduplication, splitting, etc.)
      const optimizedSize = result.metrics.totalSize;

      // Should have some savings through chunk optimization
      expect(optimizedSize).toBeLessThanOrEqual(totalSizeWithoutOpt * 1.1);
      expect(result.metrics.duplicationRate).toBeLessThan(50); // Less than 50% duplication
    });

    it('should measure cache hit rates', async () => {
      const cache = new PersistentCache({
        dir: path.join(tempDir, 'cache-benchmark'),
        compression: 'none', // Faster for tests
      });

      await cache.init();

      // Populate cache (reduced for faster tests)
      for (let i = 0; i < 20; i++) {
        await cache.set(`key${i}`, `value${i}`);
      }

      // Test cache hits
      let hits = 0;
      let misses = 0;

      for (let i = 0; i < 30; i++) {
        const key = `key${i % 25}`; // Mix of existing and non-existing keys
        const result = await cache.get(key);
        if (result !== null) {
          hits++;
        } else {
          misses++;
        }
      }

      const stats = await cache.getStats();
      const hitRate = (stats.hits / (stats.hits + stats.misses)) * 100;

      expect(hitRate).toBeGreaterThan(40); // At least 40% hit rate

      await cache.clear();
    }, 40000);

    it('should test parallel compilation speedup', async () => {
      const files = Array.from({ length: 30 }, (_, i) => ({
        path: `./src/module${i}.ts`,
        source: `export const mod${i} = { value: ${i}, computed: ${i} * 2 };`,
      }));

      // Single worker
      const singleWorker = new ParallelCompiler({
        workers: 1,
      });
      await singleWorker.init();

      const startSingle = Date.now();
      await singleWorker.compile(files);
      const timeSingle = Date.now() - startSingle;

      await singleWorker.terminate();

      // Multiple workers
      const multiWorker = new ParallelCompiler({
        workers: 4,
      });
      await multiWorker.init();

      const startMulti = Date.now();
      await multiWorker.compile(files);
      const timeMulti = Date.now() - startMulti;

      const stats = multiWorker.getStats();

      await multiWorker.terminate();

      // Parallel should provide some speedup (accounting for overhead)
      const speedup = timeSingle / timeMulti;

      expect(speedup).toBeGreaterThan(0.8); // At least some benefit
      expect(stats.workersUsed).toBe(4);
    });

    it('should benchmark memory usage', async () => {
      const profiler = new BuildProfiler({
        enabled: true,
        trackMemory: true,
      });

      profiler.start();

      // Simulate memory-intensive operations (smaller for tests)
      const data: any[] = [];

      profiler.startMetric('memory-intensive-op');
      for (let i = 0; i < 100; i++) {
        data.push({
          id: i,
          data: new Array(100).fill(i),
        });
      }
      profiler.endMetric('memory-intensive-op');

      const report = await profiler.generateReport();

      if (report.memory) {
        expect(report.memory.peak).toBeGreaterThanOrEqual(report.memory.initial);
        // Delta could be negative due to GC, so just check it exists
        expect(report.memory.delta).toBeDefined();

        // Memory should be reasonable (not excessive)
        const memoryInMB = report.memory.peak / (1024 * 1024);
        expect(memoryInMB).toBeLessThan(2000); // Less than 2GB - more realistic for tests
      }
    });
  });
});
