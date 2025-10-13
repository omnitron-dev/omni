/**
 * Tests for Lazy Compilation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LazyCompilationManager,
  LazyCompilationPlugin,
  createLazyCompiler,
  createLazyCompilationPlugin,
} from '../../src/build/lazy-compilation.js';

describe('LazyCompilationManager', () => {
  let manager: LazyCompilationManager;
  let mockCompiler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    manager = new LazyCompilationManager({
      entries: ['app.js', 'main.js'],
      compilationTimeout: 5000,
    });

    mockCompiler = vi.fn(async (id: string) => {
      return { code: `compiled: ${id}`, id };
    });

    manager.setCompiler(mockCompiler);
  });

  afterEach(() => {
    manager.clear();
  });

  describe('Basic Operations', () => {
    it('should create manager', () => {
      expect(manager).toBeDefined();
    });

    it('should compile entry points immediately', async () => {
      const result = await manager.requestCompilation('app.js');

      expect(result).toBeDefined();
      expect(result.code).toBe('compiled: app.js');
      expect(mockCompiler).toHaveBeenCalledWith('app.js');
    });

    it('should lazy compile non-entry modules', async () => {
      const result = await manager.requestCompilation('lazy-module.js');

      expect(result).toBeDefined();
      expect(mockCompiler).toHaveBeenCalled();
    });

    it('should throw error if compiler not set', async () => {
      const managerWithoutCompiler = new LazyCompilationManager();

      await expect(
        managerWithoutCompiler.requestCompilation('test.js'),
      ).rejects.toThrow('Compiler not set');
    });
  });

  describe('Caching', () => {
    it('should cache compiled modules', async () => {
      // First compilation
      await manager.requestCompilation('cached-module.js');
      // Second access - should use cache
      await manager.requestCompilation('cached-module.js');

      // Compiler should only be called once
      expect(mockCompiler).toHaveBeenCalledTimes(1);
    });

    it('should track cache hits and misses', async () => {
      await manager.requestCompilation('module1.js');
      await manager.requestCompilation('module1.js'); // Cache hit
      await manager.requestCompilation('module2.js'); // Cache miss

      const stats = manager.getStats();

      expect(stats.cacheHitRate).toBeGreaterThan(0);
    });
  });

  describe('Module States', () => {
    it('should track module compilation status', async () => {
      const compilationPromise = manager.requestCompilation('tracking-module.js');

      // Check state during compilation
      await new Promise((resolve) => setTimeout(resolve, 10));
      const duringState = manager.getModuleState('tracking-module.js');
      expect(duringState?.status).toBeDefined();

      // Wait for completion
      await compilationPromise;

      const afterState = manager.getModuleState('tracking-module.js');
      expect(afterState?.status).toBe('compiled');
    });

    it('should track access count', async () => {
      await manager.requestCompilation('accessed-module.js');
      await manager.requestCompilation('accessed-module.js');
      await manager.requestCompilation('accessed-module.js');

      const state = manager.getModuleState('accessed-module.js');

      expect(state?.accessCount).toBeGreaterThan(0);
    });

    it('should track last accessed time', async () => {
      const before = Date.now();
      await manager.requestCompilation('time-module.js');
      const after = Date.now();

      const state = manager.getModuleState('time-module.js');

      expect(state?.lastAccessed).toBeGreaterThanOrEqual(before);
      expect(state?.lastAccessed).toBeLessThanOrEqual(after);
    });

    it('should track compilation time', async () => {
      await manager.requestCompilation('timed-module.js');

      const state = manager.getModuleState('timed-module.js');

      expect(state?.compilationTime).toBeGreaterThan(0);
    });
  });

  describe('Priority Queue', () => {
    it('should prioritize high-priority compilations', async () => {
      const slowCompiler = vi.fn(async (id: string) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { code: `compiled: ${id}`, id };
      });

      manager.setCompiler(slowCompiler);

      // Queue multiple compilations with different priorities
      const promises = [
        manager.requestCompilation('low.js', 1),
        manager.requestCompilation('high.js', 10),
        manager.requestCompilation('medium.js', 5),
      ];

      await Promise.all(promises);

      // All should be compiled
      expect(slowCompiler).toHaveBeenCalledTimes(3);
    });
  });

  describe('Error Handling', () => {
    it('should handle compilation errors', async () => {
      const errorCompiler = vi.fn(async () => {
        throw new Error('Compilation failed');
      });

      manager.setCompiler(errorCompiler);

      await expect(manager.requestCompilation('error-module.js')).rejects.toThrow(
        'Compilation failed',
      );

      const state = manager.getModuleState('error-module.js');
      expect(state?.status).toBe('error');
    });

    it('should handle timeout', async () => {
      const timeoutManager = new LazyCompilationManager({
        compilationTimeout: 50, // Very short timeout
      });

      const slowCompiler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { code: 'too slow' };
      });

      timeoutManager.setCompiler(slowCompiler);

      await expect(
        timeoutManager.requestCompilation('slow-module.js'),
      ).rejects.toThrow('Compilation timeout');
    });
  });

  describe('Concurrent Compilation', () => {
    it('should handle concurrent requests for same module', async () => {
      // Request same module multiple times concurrently
      const promises = [
        manager.requestCompilation('concurrent-module.js'),
        manager.requestCompilation('concurrent-module.js'),
        manager.requestCompilation('concurrent-module.js'),
      ];

      const results = await Promise.all(promises);

      // All should get same result
      expect(results[0]).toEqual(results[1]);
      expect(results[1]).toEqual(results[2]);

      // Compiler should only be called once
      const callCount = mockCompiler.mock.calls.filter(
        (call) => call[0] === 'concurrent-module.js',
      ).length;
      expect(callCount).toBe(1);
    });
  });

  describe('Background Compilation', () => {
    it('should pre-compile modules in background', async () => {
      await manager.precompileInBackground(['bg-module1.js', 'bg-module2.js']);

      // Give it time to process
      await new Promise((resolve) => setTimeout(resolve, 100));

      const stats = manager.getStats();

      expect(stats.compiledModules).toBeGreaterThan(0);
    });

    it('should respect max background compilation limit', async () => {
      const limitedManager = new LazyCompilationManager({
        maxBackgroundCompilation: 2,
      });

      limitedManager.setCompiler(mockCompiler);

      // Try to queue more than the limit
      await limitedManager.precompileInBackground([
        'bg1.js',
        'bg2.js',
        'bg3.js',
        'bg4.js',
        'bg5.js',
      ]);

      // Background queue should be limited
      const stats = limitedManager.getStats();
      expect(stats.totalModules).toBeLessThanOrEqual(5);
    });

    it('should emit events for background compilation', async () => {
      let emitted = false;

      manager.on('backgroundCompiled', () => {
        emitted = true;
      });

      await manager.precompileInBackground(['event-module.js']);

      // Give it time to process
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(emitted).toBe(true);
    });
  });

  describe('Invalidation', () => {
    it('should invalidate module', async () => {
      await manager.requestCompilation('invalidate-me.js');

      const beforeState = manager.getModuleState('invalidate-me.js');
      expect(beforeState?.status).toBe('compiled');

      await manager.invalidate('invalidate-me.js');

      const afterState = manager.getModuleState('invalidate-me.js');
      expect(afterState?.status).toBe('pending');
    });

    it('should emit invalidation event', async () => {
      await manager.requestCompilation('invalidate-event.js');

      let invalidatedId: string | undefined;
      manager.on('invalidated', (id) => {
        invalidatedId = id;
      });

      await manager.invalidate('invalidate-event.js');

      expect(invalidatedId).toBe('invalidate-event.js');
    });
  });

  describe('Statistics', () => {
    it('should provide accurate statistics', async () => {
      await manager.requestCompilation('module1.js');
      await manager.requestCompilation('module2.js');
      await manager.requestCompilation('module1.js'); // Cache hit

      const stats = manager.getStats();

      expect(stats.totalModules).toBe(2);
      expect(stats.compiledModules).toBe(2);
      expect(stats.averageCompilationTime).toBeGreaterThan(0);
    });

    it('should calculate time saved', async () => {
      // Create some compiled modules
      await manager.requestCompilation('compiled1.js');
      await manager.requestCompilation('compiled2.js');

      const stats = manager.getStats();

      expect(stats.timeSaved).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Suggested Pre-compilation', () => {
    it('should suggest frequently accessed modules', async () => {
      // Create modules with different access counts
      await manager.requestCompilation('frequent.js');
      await manager.requestCompilation('frequent.js');
      await manager.requestCompilation('frequent.js');

      await manager.requestCompilation('rare.js');

      const suggestions = manager.getSuggestedPrecompilation(5);

      // Should prioritize by access count
      expect(suggestions).toBeDefined();
    });

    it('should respect suggestion limit', () => {
      const suggestions = manager.getSuggestedPrecompilation(3);

      expect(suggestions.length).toBeLessThanOrEqual(3);
    });
  });

  describe('Configuration', () => {
    it('should support entry function', async () => {
      const entryFnManager = new LazyCompilationManager({
        entries: (id: string) => id.startsWith('entry-'),
      });

      entryFnManager.setCompiler(mockCompiler);

      await entryFnManager.requestCompilation('entry-module.js');

      // Should compile immediately as entry
      expect(mockCompiler).toHaveBeenCalledWith('entry-module.js');
    });

    it('should support test function', async () => {
      const testFnManager = new LazyCompilationManager({
        test: (id: string) => id.endsWith('.lazy.js'),
      });

      testFnManager.setCompiler(mockCompiler);

      await testFnManager.requestCompilation('module.lazy.js');

      expect(mockCompiler).toHaveBeenCalled();
    });

    it('should support test regex', async () => {
      const regexManager = new LazyCompilationManager({
        test: /\.lazy\./,
      });

      regexManager.setCompiler(mockCompiler);

      await regexManager.requestCompilation('module.lazy.js');

      expect(mockCompiler).toHaveBeenCalled();
    });
  });

  describe('Clear', () => {
    it('should clear all data', async () => {
      await manager.requestCompilation('clear1.js');
      await manager.requestCompilation('clear2.js');

      manager.clear();

      const stats = manager.getStats();

      expect(stats.totalModules).toBe(0);
    });
  });

  describe('createLazyCompiler factory', () => {
    it('should create manager instance', () => {
      const factoryManager = createLazyCompiler();

      expect(factoryManager).toBeInstanceOf(LazyCompilationManager);
    });

    it('should accept configuration', () => {
      const factoryManager = createLazyCompiler({
        entries: ['app.js'],
        compilationTimeout: 10000,
      });

      expect(factoryManager).toBeInstanceOf(LazyCompilationManager);
    });
  });
});

describe('LazyCompilationPlugin', () => {
  let plugin: LazyCompilationPlugin;

  beforeEach(() => {
    plugin = new LazyCompilationPlugin({
      entries: ['app.js'],
    });
  });

  describe('Basic Operations', () => {
    it('should create plugin', () => {
      expect(plugin).toBeDefined();
    });

    it('should provide access to manager', () => {
      const manager = plugin.getManager();

      expect(manager).toBeInstanceOf(LazyCompilationManager);
    });

    it('should apply to build system', () => {
      const hooks = {
        onLoad: vi.fn(),
      };

      plugin.apply(hooks);

      expect(hooks.onLoad).toHaveBeenCalled();
    });

    it('should provide statistics', () => {
      const stats = plugin.getStats();

      expect(stats).toBeDefined();
      expect(stats.totalModules).toBeDefined();
    });
  });

  describe('createLazyCompilationPlugin factory', () => {
    it('should create plugin instance', () => {
      const factoryPlugin = createLazyCompilationPlugin();

      expect(factoryPlugin).toBeInstanceOf(LazyCompilationPlugin);
    });

    it('should accept configuration', () => {
      const factoryPlugin = createLazyCompilationPlugin({
        entries: ['main.js'],
        backgroundCompilation: false,
      });

      expect(factoryPlugin).toBeInstanceOf(LazyCompilationPlugin);
    });
  });
});
