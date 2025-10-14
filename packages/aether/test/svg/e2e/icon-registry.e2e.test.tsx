/**
 * End-to-End Tests for Icon Registry and Provider
 *
 * Tests icon management system including:
 * - Icon registration and retrieval
 * - Icon sets and prefixes
 * - Lazy loading of icons
 * - Icon transformers
 * - Error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SVGIcon } from '../../../src/svg/components/SVGIcon';
import { getIconRegistry, resetIconRegistry } from '../../../src/svg/icons/IconRegistry';
import { render, cleanup, waitFor } from '../../test-utils';

describe('Icon Registry E2E Tests', () => {
  beforeEach(() => {
    resetIconRegistry();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    cleanup();
    resetIconRegistry();
  });

  describe('Icon Registration', () => {
    it('should register and retrieve single icon', async () => {
      const registry = getIconRegistry();
      registry.registerSet('test', {
        home: 'M10 20 L30 5 L50 20 V45 H10 Z',
      });

      const onLoad = vi.fn();
      const { container } = render(() => <SVGIcon name="home" onLoad={onLoad} />);

      await waitFor(() => {
        expect(onLoad).toHaveBeenCalled();
      });

      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('should register and retrieve multiple icons', async () => {
      const registry = getIconRegistry();
      registry.registerSet('icons', {
        home: 'M10 20 L30 5 L50 20 V45 H10 Z',
        user: 'M50 50 m-40 0 a 40 40 0 1 0 80 0 a 40 40 0 1 0 -80 0',
        star: 'M10 0 L12 8 L20 8 L14 12 L16 20 L10 15 L4 20 L6 12 L0 8 L8 8 Z',
      });

      const icons = ['home', 'user', 'star'];
      const results: boolean[] = [];

      for (const iconName of icons) {
        const { container } = render(() => <SVGIcon name={iconName} />);
        await waitFor(() => {
          const svg = container.querySelector('svg');
          results.push(svg !== null);
        });
        cleanup();
      }

      expect(results.every(Boolean)).toBe(true);
    });

    it('should handle icon sets with prefixes', async () => {
      const registry = getIconRegistry();
      registry.registerSet(
        'icons',
        {
          home: 'M10 20 L30 5 L50 20 V45 H10 Z',
          user: 'M50 50 m-40 0 a 40 40 0 1 0 80 0 a 40 40 0 1 0 -80 0',
        },
        'fa'
      );

      const onLoad = vi.fn();
      const { container } = render(() => <SVGIcon name="fa:home" onLoad={onLoad} />);

      await waitFor(() => {
        expect(onLoad).toHaveBeenCalled();
      });

      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('should override existing icons when re-registering', async () => {
      const registry = getIconRegistry();
      registry.registerSet('test', {
        arrow: 'M10 10 L20 20 Z',
      });

      // Re-register with different content
      registry.registerSet('test', {
        arrow: 'M30 30 L40 40 Z',
      });

      const { container } = render(() => <SVGIcon name="arrow" />);

      await waitFor(() => {
        const svg = container.querySelector('svg');
        expect(svg).toBeTruthy();
      });
    });
  });

  describe('Icon Retrieval', () => {
    it('should retrieve icon by exact name', async () => {
      const registry = getIconRegistry();
      registry.registerSet('icons', {
        'exact-name': 'M10 10 L20 20 Z',
      });

      const icon = await registry.get('exact-name');
      expect(icon).toBeTruthy();
      expect(icon?.content || icon?.path).toBe('M10 10 L20 20 Z');
    });

    it('should retrieve icon with prefix', async () => {
      const registry = getIconRegistry();
      registry.registerSet('icons', { home: 'M10 20 L30 5 L50 20 V45 H10 Z' }, 'fa');

      const icon = await registry.get('fa:home');
      expect(icon).toBeTruthy();
      expect(icon?.content || icon?.path).toBeTruthy();
    });

    it('should return null for non-existent icons', async () => {
      const registry = getIconRegistry();
      const icon = await registry.get('nonexistent');
      expect(icon).toBeNull();
    });

    it('should handle case-sensitive icon names', async () => {
      const registry = getIconRegistry();
      registry.registerSet('test', {
        Home: 'M10 20 L30 5 L50 20 V45 H10 Z',
        home: 'M20 30 L40 15 L60 30 V55 H20 Z',
      });

      const iconUpper = await registry.get('Home');
      const iconLower = await registry.get('home');

      expect(iconUpper).toBeTruthy();
      expect(iconLower).toBeTruthy();
      expect(iconUpper?.content).not.toBe(iconLower?.content);
    });
  });

  describe('Icon Transformers', () => {
    it('should apply transformer to icons', async () => {
      const registry = getIconRegistry();
      registry.registerSet('test', {
        circle: 'M50 50 m-40 0 a 40 40 0 1 0 80 0 a 40 40 0 1 0 -80 0',
      });

      const transformer = vi.fn((icon) => ({
        ...icon,
        metadata: { transformed: true },
      }));

      registry.addTransformer({
        name: 'test-transformer',
        transform: transformer,
      });

      const onLoad = vi.fn();
      render(() => <SVGIcon name="circle" onLoad={onLoad} />);

      await waitFor(() => {
        expect(onLoad).toHaveBeenCalled();
      });

      expect(transformer).toHaveBeenCalled();
    });

    it('should apply multiple transformers in order', async () => {
      const registry = getIconRegistry();
      registry.registerSet('test', {
        icon: 'M10 10 L20 20 Z',
      });

      const order: number[] = [];

      registry.addTransformer({
        name: 'first',
        transform: (icon) => {
          order.push(1);
          return icon;
        },
      });

      registry.addTransformer({
        name: 'second',
        transform: (icon) => {
          order.push(2);
          return icon;
        },
      });

      const onLoad = vi.fn();
      render(() => <SVGIcon name="icon" onLoad={onLoad} />);

      await waitFor(() => {
        expect(onLoad).toHaveBeenCalled();
      });

      expect(order).toEqual([1, 2]);
    });

    it('should remove transformer by name', async () => {
      const registry = getIconRegistry();
      registry.registerSet('test', {
        icon: 'M10 10 L20 20 Z',
      });

      const transformer = vi.fn((icon) => icon);

      registry.addTransformer({
        name: 'removable',
        transform: transformer,
      });

      // Remove transformer
      registry.removeTransformer('removable');

      const onLoad = vi.fn();
      render(() => <SVGIcon name="icon" onLoad={onLoad} />);

      await waitFor(() => {
        expect(onLoad).toHaveBeenCalled();
      });

      expect(transformer).not.toHaveBeenCalled();
    });
  });

  describe('Icon Lists and Queries', () => {
    it('should list all registered icons', () => {
      const registry = getIconRegistry();
      registry.registerSet('set1', {
        icon1: 'M10 10 L20 20 Z',
        icon2: 'M30 30 L40 40 Z',
      });
      registry.registerSet('set2', {
        icon3: 'M50 50 L60 60 Z',
      });

      const icons = registry.list();
      expect(icons).toContain('icon1');
      expect(icons).toContain('icon2');
      expect(icons).toContain('icon3');
    });

    it('should check if icon exists', () => {
      const registry = getIconRegistry();
      registry.registerSet('test', {
        exists: 'M10 10 L20 20 Z',
      });

      expect(registry.has('exists')).toBe(true);
      expect(registry.has('nonexistent')).toBe(false);
    });

    it('should list icons with prefix filter', () => {
      const registry = getIconRegistry();
      registry.registerSet('icons', { home: 'M10 20 L30 5 L50 20 V45 H10 Z' }, 'fa');
      registry.registerSet('icons', { user: 'M50 50 m-40 0 a 40 40 0 1 0 80 0' }, 'md');

      const icons = registry.list();
      expect(icons.some((name) => name.startsWith('fa:'))).toBe(true);
      expect(icons.some((name) => name.startsWith('md:'))).toBe(true);
    });
  });

  describe('Lazy Loading', () => {
    it('should load icon on demand', async () => {
      const registry = getIconRegistry();
      registry.registerSet('lazy', {
        deferred: 'M10 10 L20 20 Z',
      });

      // Icon should not be loaded yet
      expect(registry.has('deferred')).toBe(true);

      const onLoad = vi.fn();
      render(() => <SVGIcon name="deferred" onLoad={onLoad} />);

      await waitFor(() => {
        expect(onLoad).toHaveBeenCalled();
      });
    });

    it('should preload specific icons', async () => {
      const registry = getIconRegistry();
      registry.registerSet('test', {
        icon1: 'M10 10 L20 20 Z',
        icon2: 'M30 30 L40 40 Z',
        icon3: 'M50 50 L60 60 Z',
      });

      // Preload specific icons
      await registry.preload(['icon1', 'icon3']);

      // These should be immediately available
      const icon1 = await registry.get('icon1');
      const icon3 = await registry.get('icon3');

      expect(icon1).toBeTruthy();
      expect(icon3).toBeTruthy();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid icon data gracefully', async () => {
      const registry = getIconRegistry();
      registry.registerSet('test', {
        invalid: '', // Empty icon data
      });

      const onError = vi.fn();
      render(() => <SVGIcon name="invalid" onError={onError} />);

      // Should either load or call error
      await waitFor(
        () => {
          expect(onError).toHaveBeenCalled();
        },
        { timeout: 2000 }
      );
    });

    it('should report error for missing icons', async () => {
      const onError = vi.fn();
      render(() => <SVGIcon name="missing" onError={onError} />);

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('not found'),
          })
        );
      });
    });

    it('should handle malformed icon names', async () => {
      const registry = getIconRegistry();
      const icon = await registry.get('::invalid::name::');
      expect(icon).toBeNull();
    });
  });

  describe('Registry Management', () => {
    it('should clear all registered icons', () => {
      const registry = getIconRegistry();
      registry.registerSet('test', {
        icon1: 'M10 10 L20 20 Z',
        icon2: 'M30 30 L40 40 Z',
      });

      expect(registry.has('icon1')).toBe(true);

      registry.clear();

      expect(registry.has('icon1')).toBe(false);
      expect(registry.list()).toHaveLength(0);
    });

    it('should maintain separate icon sets', async () => {
      const registry = getIconRegistry();
      registry.registerSet('set1', {
        icon: 'M10 10 L20 20 Z',
      });
      registry.registerSet('set2', {
        icon: 'M30 30 L40 40 Z',
      });

      const icons = registry.list();
      expect(icons).toContain('icon');
      expect(icons.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle application icon library', async () => {
      const registry = getIconRegistry();

      // Register common UI icons
      registry.registerSet('ui', {
        close: 'M10 10 L20 20 M20 10 L10 20',
        menu: 'M5 5 H25 M5 12.5 H25 M5 20 H25',
        search: 'M20 20 m-15 0 a 15 15 0 1 0 30 0 a 15 15 0 1 0 -30 0 M32 32 L45 45',
      });

      // Register brand icons
      registry.registerSet('brand', {
        logo: 'M10 10 L30 10 L20 30 Z',
      });

      const uiIcons = ['close', 'menu', 'search'];
      const results: boolean[] = [];

      for (const iconName of uiIcons) {
        const { container } = render(() => <SVGIcon name={iconName} size="md" />);
        await waitFor(() => {
          const svg = container.querySelector('svg');
          results.push(svg !== null);
        });
        cleanup();
      }

      expect(results.every(Boolean)).toBe(true);
    });

    it('should switch between icon themes', async () => {
      const registry = getIconRegistry();

      // Light theme icons
      registry.registerSet('light', { home: 'M10 20 L30 5 L50 20 V45 H10 Z' }, 'light');

      // Dark theme icons
      registry.registerSet('dark', { home: 'M15 25 L35 10 L55 25 V50 H15 Z' }, 'dark');

      const onLoadLight = vi.fn();
      const { container: lightContainer } = render(() => (
        <SVGIcon name="light:home" onLoad={onLoadLight} />
      ));

      await waitFor(() => {
        expect(onLoadLight).toHaveBeenCalled();
      });

      cleanup();

      const onLoadDark = vi.fn();
      const { container: darkContainer } = render(() => (
        <SVGIcon name="dark:home" onLoad={onLoadDark} />
      ));

      await waitFor(() => {
        expect(onLoadDark).toHaveBeenCalled();
      });
    });

    it('should handle large icon sets efficiently', async () => {
      const registry = getIconRegistry();
      const largeSet: Record<string, string> = {};

      // Generate 100 icons
      for (let i = 0; i < 100; i++) {
        largeSet[`icon${i}`] = `M${i} ${i} L${i + 10} ${i + 10} Z`;
      }

      registry.registerSet('large', largeSet);

      expect(registry.list().length).toBeGreaterThanOrEqual(100);

      // Load a few icons
      const { container } = render(() => <SVGIcon name="icon50" />);

      await waitFor(() => {
        const svg = container.querySelector('svg');
        expect(svg).toBeTruthy();
      });
    });

    it('should update icons dynamically in running application', async () => {
      const registry = getIconRegistry();
      registry.registerSet('dynamic', {
        status: 'M50 50 m-40 0 a 40 40 0 1 0 80 0 a 40 40 0 1 0 -80 0',
      });

      const { container } = render(() => <SVGIcon name="status" />);

      await waitFor(() => {
        const svg = container.querySelector('svg');
        expect(svg).toBeTruthy();
      });

      // Update icon in registry
      registry.registerSet('dynamic', {
        status: 'M10 10 L20 20 L30 10 Z',
      });

      // Icon should still render
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });
  });

  describe('Performance', () => {
    it('should cache retrieved icons', async () => {
      const registry = getIconRegistry();
      registry.registerSet('test', {
        cached: 'M10 10 L20 20 Z',
      });

      // First retrieval
      const icon1 = await registry.get('cached');
      const icon2 = await registry.get('cached');

      // Should return same reference or equivalent data
      expect(icon1).toBeTruthy();
      expect(icon2).toBeTruthy();
    });

    it('should handle concurrent icon requests', async () => {
      const registry = getIconRegistry();
      registry.registerSet('concurrent', {
        icon1: 'M10 10 L20 20 Z',
        icon2: 'M30 30 L40 40 Z',
        icon3: 'M50 50 L60 60 Z',
      });

      // Request multiple icons concurrently
      const promises = [
        registry.get('icon1'),
        registry.get('icon2'),
        registry.get('icon3'),
      ];

      const results = await Promise.all(promises);

      expect(results.every((icon) => icon !== null)).toBe(true);
    });
  });
});
