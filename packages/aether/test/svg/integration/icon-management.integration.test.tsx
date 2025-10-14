/**
 * Icon Management Integration Tests
 *
 * Tests icon management workflows including:
 * - IconProvider with multiple icon sets
 * - IconRegistry with various source types
 * - Icon loading and caching strategies
 * - Sprite extraction and rendering
 * - Fallback handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  IconRegistry,
  getIconRegistry,
  resetIconRegistry,
  type IconDefinition,
  type IconSet,
} from '../../../src/svg/icons/IconRegistry.js';

describe('Icon Management Integration', () => {
  let registry: IconRegistry;

  beforeEach(() => {
    resetIconRegistry();
    registry = getIconRegistry();
  });

  afterEach(() => {
    resetIconRegistry();
  });

  describe('Multiple Icon Set Management', () => {
    it('should manage multiple icon sets simultaneously', async () => {
      const materialIcons: IconSet = {
        home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
        search: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
        settings: 'M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z',
      };

      const featherIcons: IconSet = {
        home: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
        search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
        user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2',
      };

      registry.registerSet('material', materialIcons, 'mat');
      registry.registerSet('feather', featherIcons, 'fea');

      // Verify all icons are registered
      expect(registry.has('mat:home')).toBe(true);
      expect(registry.has('mat:search')).toBe(true);
      expect(registry.has('mat:settings')).toBe(true);
      expect(registry.has('fea:home')).toBe(true);
      expect(registry.has('fea:user')).toBe(true);

      // Verify correct icons are retrieved
      const matHome = await registry.get('mat:home');
      const feaHome = await registry.get('fea:home');

      expect(matHome?.path).toBe(materialIcons.home);
      expect(feaHome?.path).toBe(featherIcons.home);
      expect(matHome?.path).not.toBe(feaHome?.path);
    });

    it('should handle icon name collisions across sets', async () => {
      const set1: IconSet = {
        duplicate: 'M10 10h10v10H10z',
      };

      const set2: IconSet = {
        duplicate: 'M20 20h10v10H20z',
      };

      registry.registerSet('set1', set1, 's1');
      registry.registerSet('set2', set2, 's2');

      const icon1 = await registry.get('s1:duplicate');
      const icon2 = await registry.get('s2:duplicate');

      expect(icon1?.path).toBe(set1.duplicate);
      expect(icon2?.path).toBe(set2.duplicate);
      expect(icon1?.path).not.toBe(icon2?.path);
    });

    it('should list all icons from multiple sets', () => {
      const set1: IconSet = {
        icon1: 'M1 1h10v10H1z',
        icon2: 'M2 2h10v10H2z',
      };

      const set2: IconSet = {
        icon3: 'M3 3h10v10H3z',
        icon4: 'M4 4h10v10H4z',
      };

      registry.registerSet('set1', set1);
      registry.registerSet('set2', set2);

      const allIcons = registry.list();

      expect(allIcons).toContain('icon1');
      expect(allIcons).toContain('icon2');
      expect(allIcons).toContain('icon3');
      expect(allIcons).toContain('icon4');
      expect(allIcons).toHaveLength(4);
    });
  });

  describe('Icon Source Types', () => {
    it('should handle inline icon sources', async () => {
      const inlineIcons: IconSet = {
        circle: { path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z', viewBox: '0 0 24 24' },
        square: { path: 'M3 3h18v18H3z', viewBox: '0 0 24 24' },
      };

      registry.register({
        name: 'inline-set',
        type: 'inline',
        source: inlineIcons,
      });

      expect(registry.has('circle')).toBe(true);
      expect(registry.has('square')).toBe(true);

      const circle = await registry.get('circle');
      expect(circle?.viewBox).toBe('0 0 24 24');
    });

    it('should handle URL icon sources', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => '<svg viewBox="0 0 24 24"><path d="M12 2L2 7v10l10 5 10-5V7z"/></svg>',
      } as Response);

      registry.register({
        name: 'url-icons',
        type: 'url',
        source: 'https://example.com/icons/test.svg',
      });

      const icon = await registry.get('test');

      expect(fetchSpy).toHaveBeenCalled();
      expect(icon).toBeDefined();
      expect(icon?.content).toContain('path d="M12 2L2 7v10l10 5 10-5V7z"');

      fetchSpy.mockRestore();
    });

    it('should handle sprite icon sources', async () => {
      const spriteSVG = `
        <svg xmlns="http://www.w3.org/2000/svg">
          <symbol id="sprite-icon-1" viewBox="0 0 24 24">
            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
          </symbol>
          <symbol id="sprite-icon-2" viewBox="0 0 24 24">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/>
          </symbol>
        </svg>
      `;

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => spriteSVG,
      } as Response);

      global.DOMParser = class {
        parseFromString() {
          return {
            querySelector: (selector: string) => {
              if (selector === '#sprite-icon-1') {
                return {
                  outerHTML: '<symbol id="sprite-icon-1" viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></symbol>',
                  getAttribute: () => '0 0 24 24',
                };
              }
              return null;
            },
          };
        }
      } as any;

      registry.register({
        name: 'sprite-icons',
        type: 'sprite',
        source: 'https://example.com/sprite.svg',
      });

      const icon = await registry.get('sprite-icon-1');

      expect(icon).toBeDefined();
      expect(icon?.viewBox).toBe('0 0 24 24');

      fetchSpy.mockRestore();
    });

    it('should handle component icon sources', () => {
      const componentIcons: IconSet = {
        custom: {
          content: '<g><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></g>',
          viewBox: '0 0 24 24',
        },
      };

      registry.register({
        name: 'component-icons',
        type: 'inline',
        source: componentIcons,
      });

      expect(registry.has('custom')).toBe(true);
    });
  });

  describe('Icon Loading Strategies', () => {
    it('should support eager loading of icons', async () => {
      const icons: IconSet = {
        icon1: 'M1 1h10v10H1z',
        icon2: 'M2 2h10v10H2z',
        icon3: 'M3 3h10v10H3z',
      };

      registry.registerSet('eager', icons);

      // All icons should be immediately available
      expect(registry.has('icon1')).toBe(true);
      expect(registry.has('icon2')).toBe(true);
      expect(registry.has('icon3')).toBe(true);

      const icon1 = await registry.get('icon1');
      expect(icon1).toBeDefined();
    });

    it('should support lazy loading of remote icons', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          text: async () => '<svg viewBox="0 0 24 24"><path d="M1 1h10v10H1z"/></svg>',
        } as Response);

      registry.register({
        name: 'lazy-icons',
        type: 'url',
        source: 'https://example.com/icons/lazy.svg',
        lazy: true,
      });

      // Icon should not be loaded until requested
      expect(fetchSpy).not.toHaveBeenCalled();

      // Request icon
      const icon = await registry.get('lazy');

      expect(fetchSpy).toHaveBeenCalled();
      expect(icon).toBeDefined();

      fetchSpy.mockRestore();
    });

    it('should preload specified icons', async () => {
      const icons: IconSet = {
        preload1: 'M1 1h10v10H1z',
        preload2: 'M2 2h10v10H2z',
        preload3: 'M3 3h10v10H3z',
      };

      registry.registerSet('preload', icons);

      await registry.preload(['preload1', 'preload2', 'preload3']);

      // All preloaded icons should be immediately available
      expect(registry.has('preload1')).toBe(true);
      expect(registry.has('preload2')).toBe(true);
      expect(registry.has('preload3')).toBe(true);
    });

    it('should handle preload failures gracefully', async () => {
      const icons: IconSet = {
        exists: 'M1 1h10v10H1z',
      };

      registry.registerSet('partial', icons);

      // Try to preload including non-existent icon
      await registry.preload(['exists', 'does-not-exist']);

      // Existing icon should still be available
      expect(registry.has('exists')).toBe(true);
    });
  });

  describe('Icon Caching Strategies', () => {
    it('should cache loaded icons by default', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => '<svg viewBox="0 0 24 24"><path d="M12 2L2 7v10l10 5 10-5V7z"/></svg>',
      } as Response);

      registry.register({
        name: 'cached-icons',
        type: 'url',
        source: 'https://example.com/icons/cached.svg',
      });

      // First load
      await registry.get('cached');
      const firstCallCount = fetchSpy.mock.calls.length;

      // Second load (should use cache)
      await registry.get('cached');
      const secondCallCount = fetchSpy.mock.calls.length;

      expect(secondCallCount).toBe(firstCallCount);

      fetchSpy.mockRestore();
    });

    it('should prevent duplicate concurrent requests', async () => {
      let requestCount = 0;
      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => {
        requestCount++;
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          ok: true,
          text: async () => '<svg viewBox="0 0 24 24"><path d="M12 2L2 7v10l10 5 10-5V7z"/></svg>',
        } as Response;
      });

      registry.register({
        name: 'concurrent-icons',
        type: 'url',
        source: 'https://example.com/icons/concurrent.svg',
      });

      // Make multiple concurrent requests
      await Promise.all([
        registry.get('concurrent'),
        registry.get('concurrent'),
        registry.get('concurrent'),
      ]);

      // Should only make one actual request
      expect(requestCount).toBe(1);

      fetchSpy.mockRestore();
    });

    it('should clear cache when requested', async () => {
      const icons: IconSet = {
        clear: 'M1 1h10v10H1z',
      };

      registry.registerSet('clearable', icons);

      expect(registry.has('clear')).toBe(true);

      registry.clear();

      expect(registry.has('clear')).toBe(false);
    });
  });

  describe('Sprite Extraction and Rendering', () => {
    it('should extract individual icons from sprite', async () => {
      const spriteSVG = `
        <svg xmlns="http://www.w3.org/2000/svg">
          <symbol id="home" viewBox="0 0 24 24">
            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
          </symbol>
          <symbol id="user" viewBox="0 0 24 24">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
          </symbol>
          <symbol id="settings" viewBox="0 0 24 24">
            <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94"/>
          </symbol>
        </svg>
      `;

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => spriteSVG,
      } as Response);

      global.DOMParser = class {
        parseFromString() {
          return {
            querySelector: (selector: string) => {
              const symbols: Record<string, any> = {
                '#home': {
                  outerHTML: '<symbol id="home" viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></symbol>',
                  getAttribute: () => '0 0 24 24',
                },
                '#user': {
                  outerHTML: '<symbol id="user" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></symbol>',
                  getAttribute: () => '0 0 24 24',
                },
                '#settings': {
                  outerHTML: '<symbol id="settings" viewBox="0 0 24 24"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94"/></symbol>',
                  getAttribute: () => '0 0 24 24',
                },
              };
              return symbols[selector] || null;
            },
          };
        }
      } as any;

      registry.register({
        name: 'sprite',
        type: 'sprite',
        source: 'https://example.com/sprite.svg',
      });

      const home = await registry.get('home');
      const user = await registry.get('user');
      const settings = await registry.get('settings');

      expect(home).toBeDefined();
      expect(user).toBeDefined();
      expect(settings).toBeDefined();
      expect(home?.viewBox).toBe('0 0 24 24');

      fetchSpy.mockRestore();
    });

    it('should optimize sprite loading', async () => {
      const spriteSVG = `<svg xmlns="http://www.w3.org/2000/svg">
        <symbol id="icon1" viewBox="0 0 24 24"><path d="M1"/></symbol>
        <symbol id="icon2" viewBox="0 0 24 24"><path d="M2"/></symbol>
        <symbol id="icon3" viewBox="0 0 24 24"><path d="M3"/></symbol>
      </svg>`;

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => spriteSVG,
      } as Response);

      global.DOMParser = class {
        parseFromString() {
          return {
            querySelector: () => ({
              outerHTML: '<symbol id="icon1" viewBox="0 0 24 24"><path d="M1"/></symbol>',
              getAttribute: () => '0 0 24 24',
            }),
          };
        }
      } as any;

      registry.register({
        name: 'optimized-sprite',
        type: 'sprite',
        source: 'https://example.com/sprite.svg',
      });

      const startTime = performance.now();
      await Promise.all([
        registry.get('icon1'),
        registry.get('icon2'),
        registry.get('icon3'),
      ]);
      const endTime = performance.now();

      // Should load sprite once and extract multiple icons quickly (< 100ms)
      expect(endTime - startTime).toBeLessThan(100);

      fetchSpy.mockRestore();
    });
  });

  describe('Fallback Handling', () => {
    it('should return null for missing icons', async () => {
      const icon = await registry.get('non-existent-icon');
      expect(icon).toBeNull();
    });

    it('should handle failed URL loading', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      registry.register({
        name: 'failed-icons',
        type: 'url',
        source: 'https://example.com/icons/failed.svg',
      });

      const icon = await registry.get('failed');

      expect(icon).toBeNull();

      fetchSpy.mockRestore();
    });

    it('should handle invalid sprite extraction', async () => {
      const spriteSVG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => spriteSVG,
      } as Response);

      global.DOMParser = class {
        parseFromString() {
          return {
            querySelector: () => null,
          };
        }
      } as any;

      registry.register({
        name: 'invalid-sprite',
        type: 'sprite',
        source: 'https://example.com/invalid-sprite.svg',
      });

      const icon = await registry.get('missing-symbol');

      expect(icon).toBeNull();

      fetchSpy.mockRestore();
    });

    it('should handle malformed SVG gracefully', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => '<not-valid-svg>',
      } as Response);

      registry.register({
        name: 'malformed-icons',
        type: 'url',
        source: 'https://example.com/icons/malformed.svg',
      });

      const icon = await registry.get('malformed');

      // Malformed SVG should be rejected and return null
      expect(icon).toBeNull();

      fetchSpy.mockRestore();
    });
  });

  describe('Icon Metadata and Extended Information', () => {
    it('should preserve icon metadata', async () => {
      const icons: IconSet = {
        annotated: {
          path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
          viewBox: '0 0 24 24',
          metadata: {
            author: 'Designer Name',
            license: 'MIT',
            tags: ['circle', 'round', 'basic'],
          },
        },
      };

      registry.registerSet('annotated', icons);

      const icon = await registry.get('annotated');

      expect(icon?.metadata?.author).toBe('Designer Name');
      expect(icon?.metadata?.license).toBe('MIT');
      expect(icon?.metadata?.tags).toContain('circle');
    });

    it('should support custom icon dimensions', async () => {
      const icons: IconSet = {
        custom: {
          path: 'M0 0h100v50H0z',
          viewBox: '0 0 100 50',
          width: 100,
          height: 50,
        },
      };

      registry.registerSet('custom-size', icons);

      const icon = await registry.get('custom');

      expect(icon?.width).toBe(100);
      expect(icon?.height).toBe(50);
      expect(icon?.viewBox).toBe('0 0 100 50');
    });

    it('should support icon aliases', async () => {
      const icons: IconSet = {
        primary: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
        alias: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
      };

      registry.registerSet('aliases', icons);

      const primary = await registry.get('primary');
      const alias = await registry.get('alias');

      expect(primary?.path).toBe(alias?.path);
    });
  });

  describe('Performance Optimization', () => {
    it('should handle large icon sets efficiently', () => {
      const largeSet: IconSet = {};

      for (let i = 0; i < 1000; i++) {
        largeSet[`icon-${i}`] = `M${i} ${i}L${i + 10} ${i + 10}`;
      }

      const startTime = performance.now();
      registry.registerSet('large', largeSet);
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(100);
      expect(registry.has('icon-0')).toBe(true);
      expect(registry.has('icon-999')).toBe(true);
    });

    it('should provide fast icon lookup', async () => {
      const icons: IconSet = {};

      for (let i = 0; i < 100; i++) {
        icons[`icon-${i}`] = `M${i} ${i}L${i + 10} ${i + 10}`;
      }

      registry.registerSet('lookup', icons);

      const lookups: Promise<IconDefinition | null>[] = [];
      const startTime = performance.now();

      for (let i = 0; i < 100; i++) {
        lookups.push(registry.get(`icon-${i}`));
      }

      await Promise.all(lookups);
      const endTime = performance.now();

      // 100 lookups should complete in < 10ms
      expect(endTime - startTime).toBeLessThan(10);
    });

    it('should optimize memory usage for duplicate paths', () => {
      const duplicatePath = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z';

      const icons: IconSet = {};
      for (let i = 0; i < 100; i++) {
        icons[`duplicate-${i}`] = duplicatePath;
      }

      registry.registerSet('duplicates', icons);

      const stats = registry.getStats();
      expect(stats.totalIcons).toBe(100);
    });
  });
});
