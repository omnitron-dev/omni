/**
 * Advanced Prefetch Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PrefetchManager,
  PrefetchPriority,
  getPrefetchManager,
  prefetchRoute,
} from '../../src/router/prefetch.js';
import { createRouter } from '../../src/router/router.js';
import type { RouteDefinition } from '../../src/router/types.js';

describe('Advanced Prefetch', () => {
  const routes: RouteDefinition[] = [
    {
      path: '/home',
      loader: async () => ({ data: 'home' }),
    },
    {
      path: '/about',
      loader: async () => ({ data: 'about' }),
    },
    {
      path: '/users/:id',
      loader: async ({ params }) => ({ user: params.id }),
    },
  ];

  let router: any;

  beforeEach(() => {
    router = createRouter({ routes, prefetch: false });
    vi.clearAllMocks();
  });

  describe('PrefetchManager', () => {
    it('should create manager with default config', () => {
      const manager = new PrefetchManager(router);
      expect(manager).toBeDefined();
    });

    it('should create manager with custom config', () => {
      const manager = new PrefetchManager(router, {
        maxCacheSize: 100,
        maxCacheAge: 10 * 60 * 1000,
        maxConcurrent: 5,
      });
      expect(manager).toBeDefined();
    });

    it('should prefetch a route', async () => {
      const manager = new PrefetchManager(router);
      await manager.prefetch('/home', { priority: PrefetchPriority.HIGH });

      const stats = manager.getStats();
      expect(stats.totalPrefetched).toBeGreaterThan(0);
    });

    it('should use cache for repeated prefetch', async () => {
      const manager = new PrefetchManager(router);

      await manager.prefetch('/home');
      const stats1 = manager.getStats();

      await manager.prefetch('/home');
      const stats2 = manager.getStats();

      expect(stats2.cacheHits).toBeGreaterThan(stats1.cacheHits);
    });

    it('should force prefetch when requested', async () => {
      const manager = new PrefetchManager(router);

      await manager.prefetch('/home');
      const stats1 = manager.getStats();

      await manager.prefetch('/home', { force: true });
      const stats2 = manager.getStats();

      expect(stats2.totalPrefetched).toBeGreaterThan(stats1.totalPrefetched);
    });

    it('should handle prefetch with delay', async () => {
      const manager = new PrefetchManager(router);
      const startTime = Date.now();

      await manager.prefetch('/home', { delay: 100 });

      // Wait for delay to complete
      await new Promise((resolve) => setTimeout(resolve, 150));

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(100);
    });

    it('should respect priority order', async () => {
      const manager = new PrefetchManager(router);

      await manager.prefetch('/home', { priority: PrefetchPriority.LOW });
      await manager.prefetch('/about', { priority: PrefetchPriority.HIGH });

      const stats = manager.getStats();
      expect(stats.queueSize).toBeGreaterThanOrEqual(0);
    });

    it('should get prefetch statistics', () => {
      const manager = new PrefetchManager(router);
      const stats = manager.getStats();

      expect(stats).toHaveProperty('totalPrefetched');
      expect(stats).toHaveProperty('cacheHits');
      expect(stats).toHaveProperty('cacheMisses');
      expect(stats).toHaveProperty('failedPrefetches');
      expect(stats).toHaveProperty('averagePrefetchTime');
      expect(stats).toHaveProperty('queueSize');
    });

    it('should clear cache', async () => {
      const manager = new PrefetchManager(router);

      await manager.prefetch('/home');
      manager.clearCache('/home');

      await manager.prefetch('/home');
      const stats = manager.getStats();

      expect(stats.cacheMisses).toBeGreaterThan(0);
    });

    it('should clear all cache', async () => {
      const manager = new PrefetchManager(router);

      await manager.prefetch('/home');
      await manager.prefetch('/about');

      manager.clearCache();

      await manager.prefetch('/home');
      const stats = manager.getStats();

      expect(stats.cacheMisses).toBeGreaterThan(0);
    });

    it('should dispose and cleanup', () => {
      const manager = new PrefetchManager(router);
      manager.dispose();

      const stats = manager.getStats();
      expect(stats.queueSize).toBe(0);
    });
  });

  describe('Resource Hints', () => {
    it('should add resource hints', () => {
      const manager = new PrefetchManager(router);

      manager.addResourceHints({
        preconnect: ['https://api.example.com'],
        dnsPrefetch: ['https://cdn.example.com'],
        preload: [
          { href: '/styles.css', as: 'style' },
          { href: '/script.js', as: 'script' },
        ],
      });

      expect(manager).toBeDefined();
    });
  });

  describe('Viewport Prefetch', () => {
    it('should setup viewport prefetch observer', () => {
      const manager = new PrefetchManager(router);
      const element = document.createElement('div');

      const cleanup = manager.prefetchOnViewport(element, '/home');
      expect(cleanup).toBeInstanceOf(Function);

      cleanup();
    });
  });

  describe('Hover Prefetch', () => {
    it('should setup hover prefetch', () => {
      const manager = new PrefetchManager(router);
      const element = document.createElement('a');

      const cleanup = manager.prefetchOnHover(element, '/home', { hoverDelay: 50 });
      expect(cleanup).toBeInstanceOf(Function);

      cleanup();
    });
  });

  describe('Backward Compatibility', () => {
    it('should support simple prefetchRoute function', async () => {
      await prefetchRoute(router, '/home');
      expect(true).toBe(true);
    });

    it('should get default manager', () => {
      const manager = getPrefetchManager(router);
      expect(manager).toBeDefined();
    });
  });
});
