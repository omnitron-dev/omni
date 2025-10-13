/**
 * Code Splitting Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CodeSplittingManager, getCodeSplittingManager, lazyRoute } from '../../src/router/code-splitting.js';
import type { RouteDefinition } from '../../src/router/types.js';

describe('Code Splitting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('CodeSplittingManager', () => {
    it('should create manager with default config', () => {
      const manager = new CodeSplittingManager();
      expect(manager).toBeDefined();
    });

    it('should create manager with custom config', () => {
      const manager = new CodeSplittingManager({
        enabled: true,
        preloadStrategy: 'hover',
        extractCriticalCSS: true,
      });
      expect(manager).toBeDefined();
    });

    it('should create lazy route', () => {
      const manager = new CodeSplittingManager();
      const importFn = async () => ({ default: () => 'Component' });

      const route = manager.lazy(importFn, { path: '/lazy' });

      expect(route).toHaveProperty('path');
      expect(route).toHaveProperty('lazy');
    });

    it('should load chunk', async () => {
      const manager = new CodeSplittingManager();
      const importFn = async () => ({ default: () => 'Component' });

      const route = manager.lazy(importFn, { path: '/lazy', chunkName: 'test-chunk' });

      if (route.lazy) {
        const module = await route.lazy();
        expect(module).toBeDefined();
        expect(module.default()).toBe('Component');
      }
    });

    it('should cache loaded chunks', async () => {
      const manager = new CodeSplittingManager();
      let loadCount = 0;

      const importFn = async () => {
        loadCount++;
        return { default: () => 'Component' };
      };

      const route = manager.lazy(importFn, { path: '/lazy', chunkName: 'cached-chunk' });

      if (route.lazy) {
        await route.lazy();
        await route.lazy();
        await route.lazy();
      }

      expect(loadCount).toBe(1); // Should only load once
    });

    it('should handle chunk loading errors', async () => {
      const manager = new CodeSplittingManager();
      const importFn = async () => {
        throw new Error('Failed to load');
      };

      const route = manager.lazy(importFn, { path: '/lazy', chunkName: 'error-chunk' });

      if (route.lazy) {
        await expect(route.lazy()).rejects.toThrow('Failed to load');
      }
    });

    it('should get chunk metadata', async () => {
      const manager = new CodeSplittingManager();
      const importFn = async () => ({ default: () => 'Component' });

      manager.lazy(importFn, { path: '/lazy', chunkName: 'meta-chunk' });

      const chunk = manager.getChunk('meta-chunk');
      expect(chunk).toBeDefined();
      expect(chunk?.id).toBe('meta-chunk');
      expect(chunk?.status).toBe('pending');
    });

    it('should get all chunks', async () => {
      const manager = new CodeSplittingManager();
      const importFn = async () => ({ default: () => 'Component' });

      manager.lazy(importFn, { path: '/lazy1', chunkName: 'chunk1' });
      manager.lazy(importFn, { path: '/lazy2', chunkName: 'chunk2' });

      const chunks = manager.getAllChunks();
      expect(chunks).toHaveLength(2);
    });

    it('should get bundle statistics', () => {
      const manager = new CodeSplittingManager();
      const importFn = async () => ({ default: () => 'Component' });

      manager.lazy(importFn, { path: '/lazy1', chunkName: 'stats-chunk1' });
      manager.lazy(importFn, { path: '/lazy2', chunkName: 'stats-chunk2' });

      const stats = manager.getBundleStats();
      expect(stats).toHaveProperty('totalChunks');
      expect(stats).toHaveProperty('loadedChunks');
      expect(stats).toHaveProperty('failedChunks');
      expect(stats).toHaveProperty('pendingChunks');
      expect(stats.totalChunks).toBe(2);
    });

    it('should clear chunk cache', async () => {
      const manager = new CodeSplittingManager();
      const importFn = async () => ({ default: () => 'Component' });

      const route = manager.lazy(importFn, { path: '/lazy', chunkName: 'clear-chunk' });

      if (route.lazy) {
        await route.lazy();
        manager.clearCache('clear-chunk');

        const chunk = manager.getChunk('clear-chunk');
        expect(chunk?.status).toBe('pending');
      }
    });

    it('should clear all caches', async () => {
      const manager = new CodeSplittingManager();
      const importFn = async () => ({ default: () => 'Component' });

      const route1 = manager.lazy(importFn, { path: '/lazy1', chunkName: 'clear-all-1' });
      const route2 = manager.lazy(importFn, { path: '/lazy2', chunkName: 'clear-all-2' });

      if (route1.lazy && route2.lazy) {
        await route1.lazy();
        await route2.lazy();

        manager.clearCache();

        const chunk1 = manager.getChunk('clear-all-1');
        const chunk2 = manager.getChunk('clear-all-2');

        expect(chunk1?.status).toBe('pending');
        expect(chunk2?.status).toBe('pending');
      }
    });

    it('should update configuration', () => {
      const manager = new CodeSplittingManager({ enabled: true });
      manager.updateConfig({ preloadStrategy: 'visible' });
      expect(manager).toBeDefined();
    });
  });

  describe('Preloading', () => {
    it('should preload chunk', async () => {
      const manager = new CodeSplittingManager();
      const importFn = async () => ({ default: () => 'Component' });

      manager.lazy(importFn, { path: '/lazy', chunkName: 'preload-chunk' });

      await manager.preloadChunk('preload-chunk', importFn);

      const chunk = manager.getChunk('preload-chunk');
      expect(chunk?.status).toBe('loaded');
    });

    it('should handle preload errors gracefully', async () => {
      const manager = new CodeSplittingManager();
      const importFn = async () => {
        throw new Error('Preload failed');
      };

      manager.lazy(importFn, { path: '/lazy', chunkName: 'preload-error' });

      // Should not throw
      await manager.preloadChunk('preload-error', importFn);

      const chunk = manager.getChunk('preload-error');
      expect(chunk?.status).toBe('error');
    });

    it('should setup hover preload', () => {
      const manager = new CodeSplittingManager();
      const element = document.createElement('a');
      const routes: RouteDefinition[] = [{ path: '/test' }];

      const cleanup = manager.setupHoverPreload(element, '/test', routes);
      expect(cleanup).toBeInstanceOf(Function);

      cleanup();
    });

    it('should setup visible preload', () => {
      const manager = new CodeSplittingManager();
      const element = document.createElement('div');
      const routes: RouteDefinition[] = [{ path: '/test' }];

      const cleanup = manager.setupVisiblePreload(element, '/test', routes);
      expect(cleanup).toBeInstanceOf(Function);

      cleanup();
    });
  });

  describe('Helpers', () => {
    it('should create lazy route with helper', () => {
      const importFn = async () => ({ default: () => 'Component' });
      const route = lazyRoute(importFn, { path: '/helper' });

      expect(route).toHaveProperty('path');
      expect(route).toHaveProperty('lazy');
    });

    it('should get default manager', () => {
      const manager = getCodeSplittingManager();
      expect(manager).toBeDefined();
    });
  });
});
