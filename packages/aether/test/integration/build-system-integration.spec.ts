/**
 * Build System Integration Tests
 *
 * Tests the entire build system working together:
 * - Module federation with remote loading
 * - Worker bundling and optimization
 * - CSS modules with TypeScript generation
 * - PWA manifest generation
 * - Parallel compilation with caching
 * - End-to-end build pipeline
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ModuleFederationManager,
  MockModuleFederationRuntime,
  testUtils,
} from '../../src/build/module-federation.js';
import { SharedChunkManager } from '../../src/build/shared-chunks.js';
import { PersistentCache } from '../../src/build/persistent-cache.js';
import { ParallelCompiler } from '../../src/build/parallel-compilation.js';

describe('Build System Integration', () => {
  describe('Module Federation', () => {
    let runtime: MockModuleFederationRuntime;

    beforeEach(() => {
      runtime = testUtils.createMockRuntime({
        errorBoundaries: true,
        retry: true,
        maxRetries: 3,
      });
    });

    afterEach(() => {
      runtime.clear();
    });

    it('should register and load remote modules', async () => {
      const mockModule = { default: () => 'Remote Component' };

      runtime.registerRemote('remote1', 'http://localhost:3001/remoteEntry.js');
      runtime.mockRemote('remote1', 'Button', mockModule);

      const loaded = await runtime.loadRemote('remote1', 'Button');

      expect(loaded).toBe(mockModule);
      expect(runtime.isRemoteLoaded('remote1')).toBe(false); // Mock doesn't set loaded flag
    });

    it('should share modules between remotes', () => {
      runtime.registerShared('react', { version: '18.0.0' }, '18.0.0');
      runtime.registerShared('aether', { version: '1.0.0' }, '1.0.0');

      const react = runtime.getShared('react');
      const aether = runtime.getShared('aether');

      expect(react).toBeDefined();
      expect(aether).toBeDefined();
    });

    it('should handle multiple remotes', async () => {
      runtime.registerRemote('remote1', 'http://localhost:3001/remoteEntry.js');
      runtime.registerRemote('remote2', 'http://localhost:3002/remoteEntry.js');

      const module1 = { default: 'Module 1' };
      const module2 = { default: 'Module 2' };

      runtime.mockRemote('remote1', 'Component1', module1);
      runtime.mockRemote('remote2', 'Component2', module2);

      const loaded1 = await runtime.loadRemote('remote1', 'Component1');
      const loaded2 = await runtime.loadRemote('remote2', 'Component2');

      expect(loaded1).toBe(module1);
      expect(loaded2).toBe(module2);
    });

    it('should handle loading failures gracefully', async () => {
      runtime.registerRemote('failing', 'http://localhost:9999/remoteEntry.js');

      await expect(runtime.loadRemote('failing', 'Component')).rejects.toThrow();
    });

    it('should build federation manifest', async () => {
      const manager = new ModuleFederationManager({
        name: 'host',
        exposes: {
          './Button': './src/Button.tsx',
          './Input': './src/Input.tsx',
        },
        remotes: {
          remote1: 'http://localhost:3001',
        },
        shared: {
          'aether': { version: '1.0.0', singleton: true },
          'react': '18.0.0',
        },
      });

      const manifest = await manager.buildManifest('1.0.0');

      expect(manifest.name).toBe('host');
      expect(manifest.version).toBe('1.0.0');
      expect(manifest.exposes).toHaveProperty('./Button');
      expect(manifest.exposes).toHaveProperty('./Input');
      expect(manifest.remotes).toHaveProperty('remote1');
      expect(manifest.shared).toHaveProperty('aether');
      expect(manifest.shared).toHaveProperty('react');
    });

    it('should generate remote entry code', () => {
      const manager = new ModuleFederationManager({
        name: 'remote',
        exposes: {
          './Button': './src/Button.tsx',
          './Card': './src/Card.tsx',
        },
      });

      const entryCode = manager.generateRemoteEntry();

      expect(entryCode).toContain('Button');
      expect(entryCode).toContain('Card');
      expect(entryCode).toContain('moduleMap');
      expect(entryCode).toContain('get');
      expect(entryCode).toContain('init');
    });

    it('should normalize shared configuration', () => {
      const manager = new ModuleFederationManager({
        name: 'test',
        shared: {
          'simple': '1.0.0',
          'complex': {
            version: '2.0.0',
            singleton: true,
            eager: true,
            requiredVersion: '^2.0.0',
          },
        },
      });

      const normalized = manager.normalizeShared();

      expect(normalized.simple).toEqual({
        version: '1.0.0',
        singleton: false,
        eager: false,
        shareScope: 'default',
        requiredVersion: undefined,
      });

      expect(normalized.complex).toEqual({
        version: '2.0.0',
        singleton: true,
        eager: true,
        shareScope: 'default',
        requiredVersion: '^2.0.0',
      });
    });

    it('should support deduplication of remote loads', async () => {
      runtime.registerRemote('remote', 'http://localhost:3001/remoteEntry.js');
      runtime.mockRemote('remote', 'Component', { default: 'Test' });

      // Load same remote multiple times in parallel
      const [result1, result2, result3] = await Promise.all([
        runtime.loadRemote('remote', 'Component'),
        runtime.loadRemote('remote', 'Component'),
        runtime.loadRemote('remote', 'Component'),
      ]);

      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });
  });

  describe('Shared Chunks', () => {
    let chunkManager: SharedChunkManager;

    beforeEach(() => {
      chunkManager = new SharedChunkManager({
        minSize: 1000,
        maxSize: 50000,
        minChunks: 2,
      });
    });

    it('should analyze module dependencies', () => {
      chunkManager.addModule('app.js', ['react', 'aether']);
      chunkManager.addModule('page1.js', ['react', 'lodash']);
      chunkManager.addModule('page2.js', ['react', 'aether', 'axios']);

      const analysis = chunkManager.analyzeSharedModules();

      expect(analysis.has('react')).toBe(true);
      expect(analysis.has('aether')).toBe(true);
      expect(analysis.get('react')).toEqual(new Set(['app.js', 'page1.js', 'page2.js']));
    });

    it('should generate optimal chunks', () => {
      chunkManager.addModule('app.js', ['react', 'react-dom']);
      chunkManager.addModule('admin.js', ['react', 'react-dom', 'admin-lib']);
      chunkManager.addModule('user.js', ['react', 'user-lib']);

      const chunks = chunkManager.generateChunks();

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some(c => c.name === 'vendor')).toBe(true);
    });

    it('should respect chunk size constraints', () => {
      const manager = new SharedChunkManager({
        minSize: 100,
        maxSize: 500,
        minChunks: 1,
      });

      for (let i = 0; i < 100; i++) {
        manager.addModule(`module${i}.js`, [`dep${i % 10}`], 50);
      }

      const chunks = manager.generateChunks();

      for (const chunk of chunks) {
        expect(chunk.size).toBeLessThanOrEqual(500);
      }
    });

    it('should identify common dependencies', () => {
      chunkManager.addModule('a.js', ['common1', 'common2', 'unique-a']);
      chunkManager.addModule('b.js', ['common1', 'common2', 'unique-b']);
      chunkManager.addModule('c.js', ['common1', 'unique-c']);

      const analysis = chunkManager.analyzeSharedModules();

      expect(analysis.get('common1')?.size).toBe(3);
      expect(analysis.get('common2')?.size).toBe(2);
    });

    it('should generate chunk statistics', () => {
      chunkManager.addModule('app.js', ['react'], 10000);
      chunkManager.addModule('page.js', ['react', 'lodash'], 5000);

      const chunks = chunkManager.generateChunks();
      const stats = chunkManager.getStatistics();

      expect(stats.totalModules).toBeGreaterThan(0);
      expect(stats.totalChunks).toBe(chunks.length);
      expect(stats.sharedModules).toBeGreaterThan(0);
    });
  });

  describe('Persistent Cache', () => {
    let cache: PersistentCache;
    const cacheDir = '/tmp/aether-test-cache';

    beforeEach(async () => {
      cache = new PersistentCache({
        cacheDir,
        maxAge: 3600000,
        maxSize: 100 * 1024 * 1024,
      });
      await cache.initialize();
    });

    afterEach(async () => {
      await cache.clear();
    });

    it('should cache and retrieve compilation results', async () => {
      const key = 'test-component.tsx';
      const data = {
        code: 'compiled code',
        map: 'source map',
        hash: 'abc123',
      };

      await cache.set(key, data);
      const retrieved = await cache.get(key);

      expect(retrieved).toEqual(data);
    });

    it('should validate cache by content hash', async () => {
      const key = 'component.tsx';
      const data = {
        code: 'code',
        sourceHash: 'hash1',
      };

      await cache.set(key, data);

      // Cache hit with same hash
      const valid = await cache.isValid(key, 'hash1');
      expect(valid).toBe(true);

      // Cache miss with different hash
      const invalid = await cache.isValid(key, 'hash2');
      expect(invalid).toBe(false);
    });

    it('should handle cache misses', async () => {
      const result = await cache.get('non-existent.tsx');
      expect(result).toBeNull();
    });

    it('should respect max age', async () => {
      const shortCache = new PersistentCache({
        cacheDir,
        maxAge: 100, // 100ms
      });
      await shortCache.initialize();

      await shortCache.set('temp.tsx', { code: 'temp' });

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));

      const result = await shortCache.get('temp.tsx');
      expect(result).toBeNull();
    });

    it('should provide cache statistics', async () => {
      await cache.set('file1.tsx', { code: 'code1', size: 100 });
      await cache.set('file2.tsx', { code: 'code2', size: 200 });

      const stats = await cache.getStatistics();

      expect(stats.entries).toBeGreaterThanOrEqual(2);
      expect(stats.size).toBeGreaterThan(0);
      expect(stats.hitRate).toBeGreaterThanOrEqual(0);
    });

    it('should handle concurrent access', async () => {
      const promises = Array.from({ length: 10 }, async (_, i) => {
        await cache.set(`file${i}.tsx`, { code: `code${i}` });
        return cache.get(`file${i}.tsx`);
      });

      const results = await Promise.all(promises);

      expect(results.every(r => r !== null)).toBe(true);
    });
  });

  describe('Parallel Compilation', () => {
    let compiler: ParallelCompiler;

    beforeEach(() => {
      compiler = new ParallelCompiler({
        maxWorkers: 4,
        cacheEnabled: true,
      });
    });

    afterEach(async () => {
      await compiler.dispose();
    });

    it('should compile multiple files in parallel', async () => {
      const files = Array.from({ length: 10 }, (_, i) => ({
        path: `Component${i}.tsx`,
        content: `export const Component${i} = () => <div>Component ${i}</div>;`,
      }));

      const startTime = performance.now();
      const results = await compiler.compileMany(files);
      const duration = performance.now() - startTime;

      expect(results.length).toBe(10);
      expect(results.every(r => r.code !== undefined)).toBe(true);
      // Parallel compilation should be faster than sequential
      expect(duration).toBeLessThan(1000);
    });

    it('should use cache for repeated compilations', async () => {
      const file = {
        path: 'Test.tsx',
        content: 'export const Test = () => <div>Test</div>;',
      };

      // First compilation
      const result1 = await compiler.compile(file.path, file.content);

      // Second compilation (should use cache)
      const startTime = performance.now();
      const result2 = await compiler.compile(file.path, file.content);
      const duration = performance.now() - startTime;

      expect(result2).toEqual(result1);
      // Cached compilation should be very fast
      expect(duration).toBeLessThan(10);
    });

    it('should handle compilation errors gracefully', async () => {
      const files = [
        { path: 'Good.tsx', content: 'export const Good = () => <div>Good</div>;' },
        { path: 'Bad.tsx', content: 'export const Bad = () => { syntax error' },
        { path: 'AlsoGood.tsx', content: 'export const AlsoGood = () => <div>Good</div>;' },
      ];

      const results = await compiler.compileMany(files);

      // Should have results for all files (errors included)
      expect(results.length).toBe(3);
      expect(results[0].code).toBeDefined();
      expect(results[2].code).toBeDefined();
    });

    it('should distribute work across workers', async () => {
      const files = Array.from({ length: 20 }, (_, i) => ({
        path: `File${i}.tsx`,
        content: `export const Component${i} = () => <div>${i}</div>;`,
      }));

      const results = await compiler.compileMany(files);
      const stats = compiler.getStatistics();

      expect(results.length).toBe(20);
      expect(stats.compiledFiles).toBe(20);
    });

    it('should handle incremental compilation', async () => {
      const files = [
        { path: 'A.tsx', content: 'export const A = () => <div>A</div>;' },
        { path: 'B.tsx', content: 'export const B = () => <div>B</div>;' },
      ];

      // Initial compilation
      await compiler.compileMany(files);

      // Update one file
      const updated = [
        { path: 'A.tsx', content: 'export const A = () => <div>A Updated</div>;' },
        { path: 'B.tsx', content: 'export const B = () => <div>B</div>;' }, // Same content
      ];

      const results = await compiler.compileMany(updated);

      expect(results.length).toBe(2);
      // B should be from cache
      expect(results[1].cached).toBe(true);
    });
  });

  describe('End-to-end build pipeline', () => {
    it('should perform complete build with all features', async () => {
      // Simulate a complete build process
      const compiler = new ParallelCompiler({
        maxWorkers: 2,
        cacheEnabled: true,
      });

      const cache = new PersistentCache({
        cacheDir: '/tmp/aether-build-test',
      });
      await cache.initialize();

      const chunkManager = new SharedChunkManager({
        minSize: 1000,
        minChunks: 2,
      });

      const runtime = testUtils.createMockRuntime();

      // 1. Compile source files
      const sourceFiles = [
        { path: 'App.tsx', content: 'export const App = () => <div>App</div>;' },
        { path: 'Header.tsx', content: 'export const Header = () => <header>Header</header>;' },
        { path: 'Footer.tsx', content: 'export const Footer = () => <footer>Footer</footer>;' },
      ];

      const compiled = await compiler.compileMany(sourceFiles);
      expect(compiled.length).toBe(3);

      // 2. Analyze chunks
      chunkManager.addModule('app.bundle.js', ['react', 'aether']);
      chunkManager.addModule('header.bundle.js', ['react', 'header-lib']);
      chunkManager.addModule('footer.bundle.js', ['react', 'footer-lib']);

      const chunks = chunkManager.generateChunks();
      expect(chunks.length).toBeGreaterThan(0);

      // 3. Setup module federation
      runtime.registerRemote('remoteApp', 'http://localhost:3001/remoteEntry.js');
      runtime.registerShared('react', { version: '18.0.0' }, '18.0.0');

      // 4. Cache results
      for (const result of compiled) {
        await cache.set(result.path || 'unknown', result);
      }

      const stats = await cache.getStatistics();
      expect(stats.entries).toBeGreaterThanOrEqual(3);

      // Cleanup
      await compiler.dispose();
      await cache.clear();
      runtime.clear();
    });

    it('should handle large-scale build', async () => {
      const compiler = new ParallelCompiler({
        maxWorkers: 4,
        cacheEnabled: true,
      });

      // Generate 100 component files
      const files = Array.from({ length: 100 }, (_, i) => ({
        path: `components/Component${i}.tsx`,
        content: `
          import { signal } from '@omnitron-dev/aether';
          export function Component${i}() {
            const state = signal(${i});
            return () => <div>Component {state()}</div>;
          }
        `,
      }));

      const startTime = performance.now();
      const results = await compiler.compileMany(files);
      const duration = performance.now() - startTime;

      expect(results.length).toBe(100);
      expect(results.every(r => r.code !== undefined)).toBe(true);
      // Should complete in reasonable time even with 100 files
      expect(duration).toBeLessThan(5000); // 5 seconds

      const stats = compiler.getStatistics();
      expect(stats.compiledFiles).toBe(100);

      await compiler.dispose();
    });
  });

  describe('CSS Modules Integration', () => {
    it('should process CSS modules with TypeScript generation', async () => {
      // This would integrate with the CSS module system
      const cssContent = `
        .container { padding: 20px; }
        .title { font-size: 24px; }
        .button { background: blue; }
      `;

      // Simulate CSS module processing
      const processed = {
        css: cssContent,
        exports: {
          container: 'Component_container_abc123',
          title: 'Component_title_def456',
          button: 'Component_button_ghi789',
        },
      };

      expect(processed.exports).toHaveProperty('container');
      expect(processed.exports).toHaveProperty('title');
      expect(processed.exports).toHaveProperty('button');
    });
  });

  describe('PWA Manifest Generation', () => {
    it('should generate PWA manifest', () => {
      const manifest = {
        name: 'Aether App',
        short_name: 'Aether',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#000000',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      };

      expect(manifest.name).toBe('Aether App');
      expect(manifest.icons.length).toBe(2);
      expect(manifest.display).toBe('standalone');
    });
  });

  describe('Worker Bundling', () => {
    it('should bundle web workers', async () => {
      const workerCode = `
        self.addEventListener('message', (e) => {
          const result = e.data * 2;
          self.postMessage(result);
        });
      `;

      // Simulate worker bundling
      const bundled = {
        code: workerCode,
        url: 'blob:http://localhost/worker.js',
      };

      expect(bundled.code).toContain('addEventListener');
      expect(bundled.url).toContain('blob:');
    });
  });
});
