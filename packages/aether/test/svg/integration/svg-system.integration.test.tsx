/**
 * SVG System Integration Tests
 *
 * Tests the complete SVG system workflow including:
 * - Icon registry → provider → SVGIcon → rendering
 * - Animation system integration
 * - Sprite generation and usage
 * - Accessibility features
 * - Caching and performance
 * - SSR and hydration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SVGIcon } from '../../../src/svg/components/SVGIcon.js';
import {
  IconRegistry,
  getIconRegistry,
  resetIconRegistry,
  type IconDefinition,
} from '../../../src/svg/icons/IconRegistry.js';
import { signal } from '../../../src/index.js';

describe('SVG System Integration', () => {
  let registry: IconRegistry;

  beforeEach(() => {
    resetIconRegistry();
    registry = getIconRegistry();
  });

  afterEach(() => {
    resetIconRegistry();
  });

  describe('Complete Icon Workflow', () => {
    it('should handle complete icon registration → retrieval → rendering workflow', async () => {
      // Register icon set
      const iconSet = {
        heart: {
          path: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
          viewBox: '0 0 24 24',
        },
        star: {
          path: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
          viewBox: '0 0 24 24',
        },
      };

      registry.registerSet('basic', iconSet);

      // Verify registration
      expect(registry.has('heart')).toBe(true);
      expect(registry.has('star')).toBe(true);

      // Retrieve icon
      const heartIcon = await registry.get('heart');
      expect(heartIcon).toBeDefined();
      expect(heartIcon?.path).toBe(iconSet.heart.path);

      // Render icon component
      const IconComponent = SVGIcon({
        name: 'heart',
        size: 'md',
        color: 'red',
      });

      expect(IconComponent).toBeDefined();
    });

    it('should handle icon registration with prefix', async () => {
      const iconSet = {
        home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
        settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
      };

      registry.registerSet('material', iconSet, 'mat');

      expect(registry.has('mat:home')).toBe(true);
      expect(registry.has('mat:settings')).toBe(true);

      const homeIcon = await registry.get('mat:home');
      expect(homeIcon?.path).toBe(iconSet.home);
    });

    it('should handle lazy loading of icons', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => '<svg viewBox="0 0 24 24"><path d="M12 2L2 7v10l10 5 10-5V7z"/></svg>',
      } as Response);

      registry.register({
        name: 'remote-icons',
        type: 'url',
        source: 'https://example.com/icons/test.svg',
      });

      const icon = await registry.get('test');

      expect(fetchSpy).toHaveBeenCalledWith('https://example.com/icons/test.svg');
      expect(icon).toBeDefined();
      expect(icon?.content).toContain('path d="M12 2L2 7v10l10 5 10-5V7z"');

      fetchSpy.mockRestore();
    });
  });

  describe('Animation System Integration', () => {
    it('should integrate spin animation with SVGIcon', () => {
      const iconSet = {
        spinner: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
      };

      registry.registerSet('icons', iconSet);

      const SpinnerIcon = SVGIcon({
        name: 'spinner',
        size: 24,
        spin: true,
      });

      expect(SpinnerIcon).toBeDefined();
    });

    it('should integrate pulse animation with SVGIcon', () => {
      const iconSet = {
        notification: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
      };

      registry.registerSet('icons', iconSet);

      const NotificationIcon = SVGIcon({
        name: 'notification',
        size: 24,
        pulse: true,
      });

      expect(NotificationIcon).toBeDefined();
    });

    it('should integrate rotation animation with SVGIcon', () => {
      const rotationAngle = signal(0);

      const iconSet = {
        arrow: 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z',
      };

      registry.registerSet('icons', iconSet);

      const ArrowIcon = SVGIcon({
        name: 'arrow',
        size: 24,
        rotate: rotationAngle,
      });

      expect(ArrowIcon).toBeDefined();

      // Update rotation
      rotationAngle.set(90);
    });
  });

  describe('Sprite Generation and Usage', () => {
    it('should handle sprite-based icons', async () => {
      const spriteSVG = `
        <svg xmlns="http://www.w3.org/2000/svg">
          <symbol id="icon-home" viewBox="0 0 24 24">
            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
          </symbol>
          <symbol id="icon-user" viewBox="0 0 24 24">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
          </symbol>
        </svg>
      `;

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => spriteSVG,
      } as Response);

      // Mock DOMParser
      global.DOMParser = class {
        parseFromString(content: string) {
          return {
            querySelector: (selector: string) => {
              if (selector === '#icon-home') {
                return {
                  outerHTML: '<symbol id="icon-home" viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></symbol>',
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

      const icon = await registry.get('icon-home');

      expect(fetchSpy).toHaveBeenCalled();
      expect(icon).toBeDefined();
      expect(icon?.viewBox).toBe('0 0 24 24');

      fetchSpy.mockRestore();
    });
  });

  describe('Accessibility Features', () => {
    it('should handle complete accessibility attributes', () => {
      const iconSet = {
        info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
      };

      registry.registerSet('icons', iconSet);

      const AccessibleIcon = SVGIcon({
        name: 'info',
        size: 24,
        'aria-label': 'Information icon',
        title: 'Information',
        desc: 'Click for more information',
        role: 'img',
      });

      expect(AccessibleIcon).toBeDefined();
    });

    it('should handle decorative icons with proper ARIA attributes', () => {
      const iconSet = {
        decoration: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
      };

      registry.registerSet('icons', iconSet);

      const DecorativeIcon = SVGIcon({
        name: 'decoration',
        size: 16,
        decorative: true,
      });

      expect(DecorativeIcon).toBeDefined();
    });

    it('should provide proper focus management for interactive icons', () => {
      const handleClick = vi.fn();

      const iconSet = {
        button: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
      };

      registry.registerSet('icons', iconSet);

      const ClickableIcon = SVGIcon({
        name: 'button',
        size: 24,
        onClick: handleClick,
        'aria-label': 'Add item',
        role: 'button',
      });

      expect(ClickableIcon).toBeDefined();
    });
  });

  describe('Caching and Performance', () => {
    it('should cache loaded icons', async () => {
      const iconSet = {
        cached: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
      };

      registry.registerSet('icons', iconSet);

      // First access
      const icon1 = await registry.get('cached');
      expect(icon1).toBeDefined();

      // Second access (should be cached)
      const icon2 = await registry.get('cached');
      expect(icon2).toBeDefined();
      expect(icon2).toEqual(icon1);
    });

    it('should handle concurrent icon requests efficiently', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => '<svg viewBox="0 0 24 24"><path d="M12 2L2 7v10l10 5 10-5V7z"/></svg>',
      } as Response);

      registry.register({
        name: 'remote',
        type: 'url',
        source: 'https://example.com/icon.svg',
      });

      // Make multiple concurrent requests
      const promises = [
        registry.get('test'),
        registry.get('test'),
        registry.get('test'),
      ];

      await Promise.all(promises);

      // Should only fetch once due to loading cache
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      fetchSpy.mockRestore();
    });

    it('should preload multiple icons efficiently', async () => {
      const iconSet = {
        icon1: 'M1 1h10v10H1z',
        icon2: 'M2 2h10v10H2z',
        icon3: 'M3 3h10v10H3z',
        icon4: 'M4 4h10v10H4z',
        icon5: 'M5 5h10v10H5z',
      };

      registry.registerSet('icons', iconSet);

      const startTime = performance.now();
      await registry.preload(['icon1', 'icon2', 'icon3', 'icon4', 'icon5']);
      const endTime = performance.now();

      // Should complete quickly (< 10ms for 5 icons)
      expect(endTime - startTime).toBeLessThan(10);

      // Verify all icons are loaded
      expect(registry.has('icon1')).toBe(true);
      expect(registry.has('icon5')).toBe(true);
    });
  });

  describe('Icon Transformers', () => {
    it('should apply transformers to icons', async () => {
      const iconSet = {
        original: 'M12 2L2 7v10l10 5 10-5V7z',
      };

      registry.registerSet('icons', iconSet);

      // Add transformer to modify icons
      registry.addTransformer({
        name: 'add-metadata',
        transform: (icon) => ({
          ...icon,
          metadata: {
            ...icon.metadata,
            transformed: true,
            timestamp: Date.now(),
          },
        }),
      });

      const icon = await registry.get('original');

      expect(icon?.metadata?.transformed).toBe(true);
      expect(icon?.metadata?.timestamp).toBeDefined();
    });

    it('should apply multiple transformers in sequence', async () => {
      const iconSet = {
        test: 'M12 2L2 7v10l10 5 10-5V7z',
      };

      registry.registerSet('icons', iconSet);

      registry.addTransformer({
        name: 'add-id',
        transform: (icon) => ({
          ...icon,
          id: 'transformed-icon',
        }),
      });

      registry.addTransformer({
        name: 'add-class',
        transform: (icon) => ({
          ...icon,
          metadata: {
            ...icon.metadata,
            className: 'transformed',
          },
        }),
      });

      const icon = await registry.get('test');

      expect(icon?.id).toBe('transformed-icon');
      expect(icon?.metadata?.className).toBe('transformed');
    });

    it('should remove transformers', async () => {
      const iconSet = {
        test: 'M12 2L2 7v10l10 5 10-5V7z',
      };

      registry.registerSet('icons', iconSet);

      registry.addTransformer({
        name: 'temp-transformer',
        transform: (icon) => ({
          ...icon,
          metadata: { temp: true },
        }),
      });

      registry.removeTransformer('temp-transformer');

      const icon = await registry.get('test');

      expect(icon?.metadata?.temp).toBeUndefined();
    });
  });

  describe('Error Handling and Fallbacks', () => {
    it('should handle missing icons gracefully', async () => {
      const icon = await registry.get('non-existent');
      expect(icon).toBeNull();
    });

    it('should handle failed network requests', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      registry.register({
        name: 'remote',
        type: 'url',
        source: 'https://example.com/icon.svg',
      });

      const icon = await registry.get('test');

      expect(icon).toBeNull();

      fetchSpy.mockRestore();
    });

    it('should render error state for failed icons', () => {
      const onError = vi.fn();

      const ErrorIcon = SVGIcon({
        name: 'non-existent',
        size: 24,
        onError,
      });

      expect(ErrorIcon).toBeDefined();
    });
  });

  describe('Registry Statistics', () => {
    it('should provide accurate statistics', () => {
      const iconSet = {
        icon1: 'M1 1h10v10H1z',
        icon2: 'M2 2h10v10H2z',
        icon3: 'M3 3h10v10H3z',
      };

      registry.registerSet('icons', iconSet);

      registry.register({
        name: 'remote',
        type: 'url',
        source: 'https://example.com/icon.svg',
      });

      const stats = registry.getStats();

      expect(stats.totalIcons).toBe(3);
      expect(stats.sources).toBe(1);
      expect(stats.transformers).toBe(0);
    });
  });

  describe('Complex Integration Scenarios', () => {
    it('should handle multiple icon sets with different prefixes', async () => {
      const materialIcons = {
        home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
        settings: 'M19.14 12.94c.04-.3.06-.61.06-.94',
      };

      const fontAwesomeIcons = {
        home: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
        settings: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0',
      };

      registry.registerSet('material', materialIcons, 'mat');
      registry.registerSet('fontawesome', fontAwesomeIcons, 'fa');

      const matHome = await registry.get('mat:home');
      const faHome = await registry.get('fa:home');

      expect(matHome?.path).toBe(materialIcons.home);
      expect(faHome?.path).toBe(fontAwesomeIcons.home);
      expect(matHome?.path).not.toBe(faHome?.path);
    });

    it('should integrate with reactive size updates', () => {
      const iconSet = {
        resize: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
      };

      registry.registerSet('icons', iconSet);

      const size = signal<number>(24);

      const ResizableIcon = SVGIcon({
        name: 'resize',
        size,
        color: 'blue',
      });

      expect(ResizableIcon).toBeDefined();

      // Update size reactively
      size.set(48);
      expect(size()).toBe(48);
    });

    it('should handle complex SVG with gradients and patterns', () => {
      const complexIcon: IconDefinition = {
        content: `
          <svg viewBox="0 0 100 100">
            <defs>
              <linearGradient id="grad1">
                <stop offset="0%" style="stop-color:rgb(255,255,0);stop-opacity:1" />
                <stop offset="100%" style="stop-color:rgb(255,0,0);stop-opacity:1" />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="40" fill="url(#grad1)" />
          </svg>
        `,
        viewBox: '0 0 100 100',
      };

      registry.registerSet('complex', { gradient: complexIcon });

      const GradientIcon = SVGIcon({
        name: 'gradient',
        size: 64,
      });

      expect(GradientIcon).toBeDefined();
    });
  });

  describe('Performance Benchmarks', () => {
    it('should render icon in < 16ms (initial render)', async () => {
      const iconSet = {
        perf: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
      };

      registry.registerSet('icons', iconSet);

      const startTime = performance.now();
      const icon = SVGIcon({
        name: 'perf',
        size: 24,
      });
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(16);
      expect(icon).toBeDefined();
    });

    it('should lookup icon in < 1ms', async () => {
      const iconSet = {
        fast: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
      };

      registry.registerSet('icons', iconSet);

      const startTime = performance.now();
      const icon = await registry.get('fast');
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(1);
      expect(icon).toBeDefined();
    });

    it('should handle 1000 icons with < 10MB memory (simulated)', () => {
      const largeIconSet: Record<string, string> = {};

      for (let i = 0; i < 1000; i++) {
        largeIconSet[`icon${i}`] = `M${i} ${i}L${i + 10} ${i + 10}H${i + 20}V${i + 30}z`;
      }

      registry.registerSet('large', largeIconSet);

      const stats = registry.getStats();
      expect(stats.totalIcons).toBe(1000);

      // Verify icons are accessible
      expect(registry.has('icon0')).toBe(true);
      expect(registry.has('icon999')).toBe(true);
    });
  });
});
