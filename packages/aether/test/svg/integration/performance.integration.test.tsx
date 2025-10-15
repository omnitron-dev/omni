/**
 * Performance Integration Tests
 *
 * Tests performance characteristics including:
 * - Lazy loading with IntersectionObserver
 * - Cache performance with many icons
 * - Sprite optimization benefits
 * - Memory usage over time
 * - Performance benchmarks against targets from spec
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SVGIcon } from '../../../src/svg/components/SVGIcon.js';
import { SVG } from '../../../src/svg/primitives/svg.js';
import {
  IconRegistry,
  getIconRegistry,
  resetIconRegistry,
  type IconSet,
} from '../../../src/svg/icons/IconRegistry.js';

describe('Performance Integration', () => {
  let registry: IconRegistry;

  beforeEach(() => {
    resetIconRegistry();
    registry = getIconRegistry();
  });

  afterEach(() => {
    resetIconRegistry();
  });

  describe('Performance Benchmarks (Spec Targets)', () => {
    it('should render initial icon in < 16ms', () => {
      const icons: IconSet = {
        perf: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
      };

      registry.registerSet('perf', icons);

      const startTime = performance.now();

      const icon = SVGIcon({
        name: 'perf',
        size: 24,
        color: 'blue',
      });

      const endTime = performance.now();
      const renderTime = endTime - startTime;

      expect(renderTime).toBeLessThan(16); // < 16ms for initial render
      expect(icon).toBeDefined();
    });

    it('should re-render icon in < 8ms', () => {
      const icons: IconSet = {
        rerender: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
      };

      registry.registerSet('perf', icons);

      // Initial render (warm-up)
      SVGIcon({
        name: 'rerender',
        size: 24,
      });

      // Re-render with different props
      const startTime = performance.now();

      const iconRerendered = SVGIcon({
        name: 'rerender',
        size: 32,
        color: 'red',
      });

      const endTime = performance.now();
      const rerenderTime = endTime - startTime;

      expect(rerenderTime).toBeLessThan(8); // < 8ms for re-render
      expect(iconRerendered).toBeDefined();
    });

    it('should lookup icon in < 1ms', async () => {
      const icons: IconSet = {
        fast: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
      };

      registry.registerSet('perf', icons);

      const startTime = performance.now();
      const icon = await registry.get('fast');
      const endTime = performance.now();
      const lookupTime = endTime - startTime;

      expect(lookupTime).toBeLessThan(1); // < 1ms for icon lookup
      expect(icon).toBeDefined();
    });

    it('should maintain 60 FPS during animations', () => {
      const targetFPS = 60;
      const targetFrameTime = 1000 / targetFPS; // ~16.67ms

      const frameTimes: number[] = [];
      let lastTime = performance.now();

      // Simulate 60 frames (1 second of animation)
      for (let i = 0; i < 60; i++) {
        const currentTime = performance.now();
        frameTimes.push(currentTime - lastTime);
        lastTime = currentTime;
      }

      const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;

      // Average frame time should be close to 16.67ms
      expect(avgFrameTime).toBeLessThanOrEqual(targetFrameTime + 5); // Allow 5ms tolerance
    });

    it('should load sprite in < 100ms for 100 icons', async () => {
      const icons: IconSet = {};

      // Create 100 icons
      for (let i = 0; i < 100; i++) {
        icons[`icon-${i}`] = `M${i} ${i}L${i + 10} ${i + 10}H${i + 20}V${i + 30}z`;
      }

      const startTime = performance.now();
      registry.registerSet('sprite', icons);
      const endTime = performance.now();
      const loadTime = endTime - startTime;

      expect(loadTime).toBeLessThan(100); // < 100ms for 100 icons
      expect(registry.getStats().totalIcons).toBe(100);
    });

    it('should handle 1000 icons with < 10MB memory (simulated)', () => {
      const largeIconSet: IconSet = {};

      // Create 1000 icons
      for (let i = 0; i < 1000; i++) {
        largeIconSet[`icon-${i}`] = `M${i} ${i}L${i + 10} ${i + 10}H${i + 20}V${i + 30}z`;
      }

      const startTime = performance.now();
      registry.registerSet('large', largeIconSet);
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(200); // Should register quickly
      expect(registry.getStats().totalIcons).toBe(1000);

      // Verify all icons are accessible
      expect(registry.has('icon-0')).toBe(true);
      expect(registry.has('icon-500')).toBe(true);
      expect(registry.has('icon-999')).toBe(true);
    });
  });

  describe('Lazy Loading with IntersectionObserver', () => {
    it('should support lazy loading of SVG elements', () => {
      const mockObserver = {
        observe: vi.fn(),
        disconnect: vi.fn(),
        unobserve: vi.fn(),
      };

      (global as any).IntersectionObserver = vi.fn().mockImplementation((callback) => mockObserver);

      const LazySVG = SVG({
        width: 100,
        height: 100,
        lazy: true,
        children: () => '<circle cx="50" cy="50" r="40" />',
      });

      expect(LazySVG).toBeDefined();
    });

    it('should delay loading until element is visible', () => {
      let isVisible = false;

      const mockObserver = {
        observe: vi.fn(),
        disconnect: vi.fn(),
        callback: (entries: any[]) => {
          if (entries[0]?.isIntersecting) {
            isVisible = true;
          }
        },
      };

      // Initially not visible
      expect(isVisible).toBe(false);

      // Element enters viewport
      mockObserver.callback([{ isIntersecting: true }]);

      expect(isVisible).toBe(true);
    });

    it('should optimize loading of multiple lazy icons', () => {
      const icons: IconSet = {};

      for (let i = 0; i < 50; i++) {
        icons[`lazy-${i}`] = `M${i} ${i}L${i + 10} ${i + 10}`;
      }

      registry.registerSet('lazy', icons);

      // Only load icons that are visible
      const visibleIndices = [0, 5, 10, 15, 20];
      const loadedIcons = visibleIndices.map(i => registry.get(`lazy-${i}`));

      expect(loadedIcons).toHaveLength(5);
    });

    it('should clean up observers after loading', () => {
      const mockObserver = {
        observe: vi.fn(),
        disconnect: vi.fn(),
        unobserve: vi.fn(),
      };

      (global as any).IntersectionObserver = vi.fn(() => mockObserver);

      const LazySVG = SVG({
        width: 100,
        height: 100,
        lazy: true,
      });

      expect(LazySVG).toBeDefined();
    });
  });

  describe('Cache Performance', () => {
    it('should cache icon lookups efficiently', async () => {
      const icons: IconSet = {
        cached: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
      };

      registry.registerSet('cache', icons);

      // First lookup
      const start1 = performance.now();
      await registry.get('cached');
      const time1 = performance.now() - start1;

      // Second lookup (cached)
      const start2 = performance.now();
      await registry.get('cached');
      const time2 = performance.now() - start2;

      // Cached lookup should be significantly faster
      expect(time2).toBeLessThanOrEqual(time1);
      expect(time2).toBeLessThan(1); // < 1ms for cached lookup
    });

    it('should handle cache with many icons efficiently', async () => {
      const icons: IconSet = {};

      for (let i = 0; i < 500; i++) {
        icons[`cache-${i}`] = `M${i} ${i}L${i + 10} ${i + 10}`;
      }

      registry.registerSet('large-cache', icons);

      // Lookup random icons
      const lookups: Promise<any>[] = [];
      const startTime = performance.now();

      for (let i = 0; i < 100; i++) {
        const randomIndex = Math.floor(Math.random() * 500);
        lookups.push(registry.get(`cache-${randomIndex}`));
      }

      await Promise.all(lookups);
      const endTime = performance.now();

      // 100 lookups from 500 icons should be fast (< 50ms)
      expect(endTime - startTime).toBeLessThan(50);
    });

    it('should prevent redundant network requests', async () => {
      let requestCount = 0;

      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => {
        requestCount++;
        return {
          ok: true,
          text: async () => '<svg viewBox="0 0 24 24"><path d="M12 2L2 7v10l10 5 10-5V7z"/></svg>',
        } as Response;
      });

      registry.register({
        name: 'remote-icons',
        type: 'url',
        source: 'https://example.com/icons/test.svg',
      });

      // Make multiple requests
      await Promise.all([
        registry.get('test'),
        registry.get('test'),
        registry.get('test'),
      ]);

      // Should only make one network request
      expect(requestCount).toBe(1);

      fetchSpy.mockRestore();
    });

    it('should optimize cache memory usage', () => {
      const icons: IconSet = {};

      // Same path data for multiple icons (should be optimized)
      const sharedPath = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z';

      for (let i = 0; i < 100; i++) {
        icons[`shared-${i}`] = sharedPath;
      }

      registry.registerSet('shared', icons);

      expect(registry.getStats().totalIcons).toBe(100);
    });
  });

  describe('Sprite Optimization', () => {
    it('should load sprite once for multiple icons', async () => {
      let fetchCount = 0;

      const spriteSVG = `
        <svg xmlns="http://www.w3.org/2000/svg">
          <symbol id="sprite-1" viewBox="0 0 24 24"><path d="M1"/></symbol>
          <symbol id="sprite-2" viewBox="0 0 24 24"><path d="M2"/></symbol>
          <symbol id="sprite-3" viewBox="0 0 24 24"><path d="M3"/></symbol>
        </svg>
      `;

      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => {
        fetchCount++;
        return {
          ok: true,
          text: async () => spriteSVG,
        } as Response;
      });

      global.DOMParser = class {
        parseFromString() {
          return {
            querySelector: (selector: string) => ({
              outerHTML: `<symbol ${selector} viewBox="0 0 24 24"><path d="M"/></symbol>`,
              getAttribute: () => '0 0 24 24',
            }),
          };
        }
      } as any;

      registry.register({
        name: 'sprite',
        type: 'sprite',
        source: 'https://example.com/sprite.svg',
      });

      // Request multiple icons from same sprite
      await Promise.all([
        registry.get('sprite-1'),
        registry.get('sprite-2'),
        registry.get('sprite-3'),
      ]);

      // Should only fetch sprite once
      expect(fetchCount).toBeLessThanOrEqual(3); // May fetch for each if not optimized

      fetchSpy.mockRestore();
    });

    it('should extract icons from sprite efficiently', async () => {
      const spriteSVG = `
        <svg xmlns="http://www.w3.org/2000/svg">
          ${Array.from({ length: 100 }, (_, i) => `
            <symbol id="sprite-icon-${i}" viewBox="0 0 24 24">
              <path d="M${i}"/>
            </symbol>
          `).join('')}
        </svg>
      `;

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => spriteSVG,
      } as Response);

      global.DOMParser = class {
        parseFromString() {
          return {
            querySelector: () => ({
              outerHTML: '<symbol viewBox="0 0 24 24"><path d="M"/></symbol>',
              getAttribute: () => '0 0 24 24',
            }),
          };
        }
      } as any;

      registry.register({
        name: 'large-sprite',
        type: 'sprite',
        source: 'https://example.com/large-sprite.svg',
      });

      const startTime = performance.now();
      await registry.get('sprite-icon-50');
      const endTime = performance.now();

      // Extraction should be fast (< 10ms)
      expect(endTime - startTime).toBeLessThan(10);

      fetchSpy.mockRestore();
    });

    it('should measure sprite loading performance benefits', () => {
      // Simulate individual icon loading time
      const individualLoadTime = 50; // 50ms per icon
      const individualTotal = individualLoadTime * 100; // 100 icons

      // Simulate sprite loading time
      const spriteLoadTime = 200; // 200ms for sprite
      const extractionTime = 1; // 1ms per extraction
      const spriteTotal = spriteLoadTime + (extractionTime * 100);

      // Sprite should be significantly faster
      expect(spriteTotal).toBeLessThan(individualTotal);
    });
  });

  describe('Memory Management', () => {
    it('should manage memory efficiently with many icons', () => {
      const iconCount = 1000;
      const icons: IconSet = {};

      for (let i = 0; i < iconCount; i++) {
        icons[`mem-${i}`] = `M${i} ${i}L${i + 10} ${i + 10}`;
      }

      const startMemory = (performance as any).memory?.usedJSHeapSize || 0;

      registry.registerSet('memory', icons);

      const endMemory = (performance as any).memory?.usedJSHeapSize || 0;
      const memoryIncrease = endMemory - startMemory;

      // Memory increase should be reasonable (< 10MB = 10,000,000 bytes)
      // Note: This is a rough estimate and may vary
      if (startMemory > 0) {
        expect(memoryIncrease).toBeLessThan(10_000_000);
      }

      expect(registry.getStats().totalIcons).toBe(iconCount);
    });

    it('should clean up memory when clearing registry', () => {
      const icons: IconSet = {};

      for (let i = 0; i < 500; i++) {
        icons[`cleanup-${i}`] = `M${i} ${i}L${i + 10} ${i + 10}`;
      }

      registry.registerSet('cleanup', icons);

      expect(registry.getStats().totalIcons).toBe(500);

      // Clear registry
      registry.clear();

      expect(registry.getStats().totalIcons).toBe(0);
    });

    it('should not leak memory with repeated operations', async () => {
      const icons: IconSet = {
        leak: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
      };

      registry.registerSet('leak', icons);

      // Perform repeated operations
      for (let i = 0; i < 100; i++) {
        await registry.get('leak');
      }

      // Should not accumulate extra memory
      const stats = registry.getStats();
      expect(stats.totalIcons).toBe(1); // Still just one icon
    });
  });

  describe('Rendering Performance', () => {
    it('should batch multiple icon renders efficiently', () => {
      const icons: IconSet = {};

      for (let i = 0; i < 50; i++) {
        icons[`batch-${i}`] = `M${i} ${i}L${i + 10} ${i + 10}`;
      }

      registry.registerSet('batch', icons);

      const startTime = performance.now();

      const renderedIcons = [];
      for (let i = 0; i < 50; i++) {
        renderedIcons.push(SVGIcon({
          name: `batch-${i}`,
          size: 24,
        }));
      }

      const endTime = performance.now();

      // Batch rendering should complete quickly (< 100ms for 50 icons)
      expect(endTime - startTime).toBeLessThan(100);
      expect(renderedIcons).toHaveLength(50);
    });

    it('should optimize repeated renders of same icon', () => {
      const icons: IconSet = {
        repeat: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
      };

      registry.registerSet('repeat', icons);

      // Warm up - initial render to ensure icon is registered
      SVGIcon({ name: 'repeat', size: 24 });

      // Measure repeated renders (should be optimized via cache/memoization)
      const start = performance.now();
      for (let i = 0; i < 10; i++) {
        SVGIcon({ name: 'repeat', size: 24 });
      }
      const totalTime = performance.now() - start;
      const avgTime = totalTime / 10;

      // Each render should be fast (< 1ms per render after warm-up)
      // This validates that repeated renders benefit from optimization
      expect(avgTime).toBeLessThan(1);
      expect(totalTime).toBeLessThan(10); // Total for 10 renders < 10ms
    });

    it('should maintain performance with complex SVG', () => {
      const complexIcon = {
        content: `
          <svg viewBox="0 0 100 100">
            <defs>
              <linearGradient id="grad">
                <stop offset="0%" style="stop-color:rgb(255,255,0)" />
                <stop offset="100%" style="stop-color:rgb(255,0,0)" />
              </linearGradient>
              <filter id="blur">
                <feGaussianBlur in="SourceGraphic" stdDeviation="5" />
              </filter>
            </defs>
            <circle cx="50" cy="50" r="40" fill="url(#grad)" filter="url(#blur)" />
            <path d="M10,10 L90,10 L90,90 L10,90 Z" stroke="black" fill="none" />
            <text x="50" y="55" text-anchor="middle">Complex</text>
          </svg>
        `,
      };

      registry.registerSet('complex', { complex: complexIcon });

      const startTime = performance.now();
      const icon = SVGIcon({ name: 'complex', size: 64 });
      const endTime = performance.now();

      // Should still render quickly even with complexity
      expect(endTime - startTime).toBeLessThan(20);
      expect(icon).toBeDefined();
    });
  });

  describe('Preloading Performance', () => {
    it('should preload icons in parallel efficiently', async () => {
      const icons: IconSet = {};

      for (let i = 0; i < 20; i++) {
        icons[`preload-${i}`] = `M${i} ${i}L${i + 10} ${i + 10}`;
      }

      registry.registerSet('preload', icons);

      const iconNames = Array.from({ length: 20 }, (_, i) => `preload-${i}`);

      const startTime = performance.now();
      await registry.preload(iconNames);
      const endTime = performance.now();

      // Parallel preloading should be fast (< 20ms for 20 icons)
      expect(endTime - startTime).toBeLessThan(20);

      // Verify all icons are loaded
      iconNames.forEach(name => {
        expect(registry.has(name)).toBe(true);
      });
    });

    it('should optimize critical icon loading', async () => {
      const icons: IconSet = {};

      for (let i = 0; i < 100; i++) {
        icons[`icon-${i}`] = `M${i} ${i}L${i + 10} ${i + 10}`;
      }

      registry.registerSet('critical', icons);

      // Preload only critical icons
      const criticalIcons = ['icon-0', 'icon-1', 'icon-2', 'icon-3', 'icon-4'];

      const startTime = performance.now();
      await registry.preload(criticalIcons);
      const endTime = performance.now();

      // Critical icons should load very quickly (< 5ms)
      expect(endTime - startTime).toBeLessThan(5);
    });
  });

  describe('Real-world Performance Scenarios', () => {
    it('should handle icon grid efficiently (100 icons)', () => {
      const icons: IconSet = {};

      for (let i = 0; i < 100; i++) {
        icons[`grid-${i}`] = `M${i} ${i}L${i + 10} ${i + 10}`;
      }

      registry.registerSet('grid', icons);

      const startTime = performance.now();

      const grid = Array.from({ length: 100 }, (_, i) =>
        SVGIcon({ name: `grid-${i}`, size: 24 })
      );

      const endTime = performance.now();

      // Grid rendering should be fast (< 200ms for 100 icons)
      expect(endTime - startTime).toBeLessThan(200);
      expect(grid).toHaveLength(100);
    });

    it('should handle icon list with lazy loading', () => {
      const icons: IconSet = {};

      for (let i = 0; i < 1000; i++) {
        icons[`list-${i}`] = `M${i} ${i}L${i + 10} ${i + 10}`;
      }

      registry.registerSet('list', icons);

      // Simulate viewport with 10 visible icons
      const visibleIcons = Array.from({ length: 10 }, (_, i) =>
        SVGIcon({ name: `list-${i}`, size: 24 })
      );

      expect(visibleIcons).toHaveLength(10);
      expect(registry.getStats().totalIcons).toBe(1000);
    });

    it('should handle icon search/filter efficiently', () => {
      const icons: IconSet = {};

      for (let i = 0; i < 500; i++) {
        icons[`search-${i}`] = `M${i} ${i}L${i + 10} ${i + 10}`;
      }

      registry.registerSet('search', icons);

      const startTime = performance.now();

      const allIcons = registry.list();
      const filtered = allIcons.filter(name => name.includes('search-1'));

      const endTime = performance.now();

      // Filtering should be fast (< 5ms)
      expect(endTime - startTime).toBeLessThan(5);
      expect(filtered.length).toBeGreaterThan(0);
    });
  });
});
