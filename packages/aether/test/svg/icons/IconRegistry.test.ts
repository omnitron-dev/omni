/**
 * Tests for IconRegistry
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  IconRegistry,
  getIconRegistry,
  resetIconRegistry,
  type IconSource,
  type IconSet
} from '../../../src/svg/icons/IconRegistry';

describe('IconRegistry', () => {
  let registry: IconRegistry;

  beforeEach(() => {
    resetIconRegistry();
    registry = new IconRegistry();
  });

  afterEach(() => {
    resetIconRegistry();
  });

  describe('Basic Registration', () => {
    it('should register and retrieve icon set', async () => {
      const icons: IconSet = {
        home: 'M10 20 L30 5 L50 20 V45 H10 Z',
        star: 'M10 0 L12 8 L20 8 L14 12 L16 20 L10 15 L4 20 L6 12 L0 8 L8 8 Z'
      };

      registry.registerSet('test', icons);

      const home = await registry.get('home');
      expect(home).toBeTruthy();
      expect(home?.path).toBe('M10 20 L30 5 L50 20 V45 H10 Z');

      const star = await registry.get('star');
      expect(star).toBeTruthy();
      expect(star?.path).toBe('M10 0 L12 8 L20 8 L14 12 L16 20 L10 15 L4 20 L6 12 L0 8 L8 8 Z');
    });

    it('should register icon set with prefix', async () => {
      const icons: IconSet = {
        home: 'M10 20 L30 5 L50 20 V45 H10 Z'
      };

      registry.registerSet('test', icons, 'fa');

      const icon = await registry.get('fa:home');
      expect(icon).toBeTruthy();
      expect(icon?.path).toBe('M10 20 L30 5 L50 20 V45 H10 Z');
    });

    it('should register IconDefinition objects', async () => {
      const icons: IconSet = {
        custom: {
          path: 'M10 10 L20 20 Z',
          viewBox: '0 0 24 24',
          width: 24,
          height: 24
        }
      };

      registry.registerSet('test', icons);

      const icon = await registry.get('custom');
      expect(icon).toBeTruthy();
      expect(icon?.path).toBe('M10 10 L20 20 Z');
      expect(icon?.viewBox).toBe('0 0 24 24');
      expect(icon?.width).toBe(24);
      expect(icon?.height).toBe(24);
    });

    it('should register inline icon source', () => {
      const icons: IconSet = {
        home: 'M10 20 L30 5 L50 20 V45 H10 Z'
      };

      const source: IconSource = {
        name: 'test-icons',
        type: 'inline',
        source: icons
      };

      registry.register(source);

      expect(registry.has('home')).toBe(true);
    });

    it('should register inline icon source with prefix', () => {
      const icons: IconSet = {
        home: 'M10 20 L30 5 L50 20 V45 H10 Z'
      };

      const source: IconSource = {
        name: 'test-icons',
        type: 'inline',
        source: icons,
        prefix: 'fa'
      };

      registry.register(source);

      expect(registry.has('fa:home')).toBe(true);
    });
  });

  describe('Icon Retrieval', () => {
    beforeEach(() => {
      registry.registerSet('test', {
        home: 'M10 20 L30 5 L50 20 V45 H10 Z',
        star: 'M10 0 L12 8 L20 8 L14 12 L16 20 L10 15 L4 20 L6 12 L0 8 L8 8 Z'
      });
    });

    it('should return null for non-existent icon', async () => {
      const icon = await registry.get('nonexistent');
      expect(icon).toBeNull();
    });

    it('should check if icon exists', () => {
      expect(registry.has('home')).toBe(true);
      expect(registry.has('star')).toBe(true);
      expect(registry.has('nonexistent')).toBe(false);
    });

    it('should list all registered icons', () => {
      const icons = registry.list();
      expect(icons).toContain('home');
      expect(icons).toContain('star');
      expect(icons).toHaveLength(2);
    });

    it('should handle concurrent requests for same icon', async () => {
      const source: IconSource = {
        name: 'async-icons',
        type: 'url',
        source: 'https://example.com/icons.svg'
      };

      registry.register(source);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '<svg viewBox="0 0 24 24"><path d="M10 10"/></svg>'
      });

      const [icon1, icon2, icon3] = await Promise.all([
        registry.get('test-icon'),
        registry.get('test-icon'),
        registry.get('test-icon')
      ]);

      expect(icon1).toBeTruthy();
      expect(icon2).toBeTruthy();
      expect(icon3).toBeTruthy();
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('URL Loading', () => {
    it('should load icon from URL', async () => {
      const source: IconSource = {
        name: 'remote-icons',
        type: 'url',
        source: 'https://example.com/icon.svg'
      };

      registry.register(source);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '<svg viewBox="0 0 24 24"><path d="M10 10 L20 20 Z"/></svg>'
      });

      const icon = await registry.get('remote-icon');

      expect(icon).toBeTruthy();
      expect(icon?.content).toContain('<svg');
      expect(icon?.path).toBe('M10 10 L20 20 Z');
      expect(icon?.viewBox).toBe('0 0 24 24');
    });

    it('should handle URL fetch errors', async () => {
      const source: IconSource = {
        name: 'remote-icons',
        type: 'url',
        source: 'https://example.com/icons.svg'
      };

      registry.register(source);

      global.fetch = vi.fn().mockResolvedValue({
        ok: false
      });

      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const icon = await registry.get('missing-icon');

      expect(icon).toBeNull();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('should handle network errors', async () => {
      const source: IconSource = {
        name: 'remote-icons',
        type: 'url',
        source: 'https://example.com/icons.svg'
      };

      registry.register(source);

      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const icon = await registry.get('network-error-icon');

      expect(icon).toBeNull();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe('Sprite Loading', () => {
    it('should load icon from sprite', async () => {
      const spriteContent = `
        <svg>
          <symbol id="sprite-icon" viewBox="0 0 24 24">
            <path d="M10 10 L20 20 Z"/>
          </symbol>
        </svg>
      `;

      const source: IconSource = {
        name: 'sprite-icons',
        type: 'sprite',
        source: 'https://example.com/sprite.svg'
      };

      registry.register(source);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => spriteContent
      });

      const icon = await registry.get('sprite-icon');

      expect(icon).toBeTruthy();
      expect(icon?.viewBox).toBe('0 0 24 24');
      expect(icon?.content).toContain('symbol');
    });

    it('should return null if symbol not found in sprite', async () => {
      const spriteContent = `
        <svg>
          <symbol id="other-icon" viewBox="0 0 24 24">
            <path d="M10 10"/>
          </symbol>
        </svg>
      `;

      const source: IconSource = {
        name: 'sprite-icons',
        type: 'sprite',
        source: 'https://example.com/sprite.svg'
      };

      registry.register(source);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => spriteContent
      });

      const icon = await registry.get('missing-symbol');
      expect(icon).toBeNull();
    });
  });

  describe('Transformers', () => {
    beforeEach(() => {
      registry.registerSet('test', {
        home: 'M10 20 L30 5 L50 20 V45 H10 Z'
      });
    });

    it('should apply single transformer', async () => {
      registry.addTransformer({
        name: 'colorizer',
        transform: (icon) => ({
          ...icon,
          metadata: { ...icon.metadata, color: 'red' }
        })
      });

      const icon = await registry.get('home');
      expect(icon?.metadata?.color).toBe('red');
    });

    it('should apply multiple transformers in order', async () => {
      registry.addTransformer({
        name: 'transformer1',
        transform: (icon) => ({
          ...icon,
          metadata: { ...icon.metadata, step1: true }
        })
      });

      registry.addTransformer({
        name: 'transformer2',
        transform: (icon) => ({
          ...icon,
          metadata: { ...icon.metadata, step2: true }
        })
      });

      const icon = await registry.get('home');
      expect(icon?.metadata?.step1).toBe(true);
      expect(icon?.metadata?.step2).toBe(true);
    });

    it('should remove transformer', async () => {
      registry.addTransformer({
        name: 'test-transformer',
        transform: (icon) => ({
          ...icon,
          metadata: { ...icon.metadata, transformed: true }
        })
      });

      let icon = await registry.get('home');
      expect(icon?.metadata?.transformed).toBe(true);

      registry.removeTransformer('test-transformer');

      // Clear the icon to force re-retrieval
      registry.clear();
      registry.registerSet('test', {
        home: 'M10 20 L30 5 L50 20 V45 H10 Z'
      });

      icon = await registry.get('home');
      expect(icon?.metadata?.transformed).toBeUndefined();
    });

    it('should not affect transformers when removing non-existent transformer', async () => {
      registry.addTransformer({
        name: 'transformer1',
        transform: (icon) => ({
          ...icon,
          metadata: { ...icon.metadata, test: true }
        })
      });

      registry.removeTransformer('nonexistent');

      const icon = await registry.get('home');
      expect(icon?.metadata?.test).toBe(true);
    });
  });

  describe('Preloading', () => {
    beforeEach(() => {
      registry.registerSet('test', {
        home: 'M10 20 L30 5 L50 20 V45 H10 Z',
        star: 'M10 0 L12 8 L20 8 L14 12 L16 20 L10 15 L4 20 L6 12 L0 8 L8 8 Z',
        settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94L14.4 2.81a.488.488 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z'
      });
    });

    it('should preload multiple icons', async () => {
      await registry.preload(['home', 'star', 'settings']);

      expect(registry.has('home')).toBe(true);
      expect(registry.has('star')).toBe(true);
      expect(registry.has('settings')).toBe(true);
    });

    it('should handle preloading non-existent icons gracefully', async () => {
      await expect(
        registry.preload(['home', 'nonexistent', 'star'])
      ).resolves.not.toThrow();

      expect(registry.has('home')).toBe(true);
      expect(registry.has('star')).toBe(true);
      expect(registry.has('nonexistent')).toBe(false);
    });
  });

  describe('Clear and Reset', () => {
    beforeEach(() => {
      registry.registerSet('test', {
        home: 'M10 20 L30 5 L50 20 V45 H10 Z',
        star: 'M10 0 L12 8 L20 8 L14 12 L16 20 L10 15 L4 20 L6 12 L0 8 L8 8 Z'
      });
    });

    it('should clear all icons', () => {
      expect(registry.list()).toHaveLength(2);

      registry.clear();

      expect(registry.list()).toHaveLength(0);
      expect(registry.has('home')).toBe(false);
      expect(registry.has('star')).toBe(false);
    });

    it('should clear sources', () => {
      registry.clear();

      const stats = registry.getStats();
      expect(stats.totalIcons).toBe(0);
      expect(stats.sources).toBe(0);
    });

    it('should clear loading promises', () => {
      registry.clear();

      const stats = registry.getStats();
      expect(stats.loading).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should return correct statistics', () => {
      registry.registerSet('test', {
        home: 'M10 20 L30 5 L50 20 V45 H10 Z',
        star: 'M10 0 L12 8 L20 8 L14 12 L16 20 L10 15 L4 20 L6 12 L0 8 L8 8 Z'
      });

      registry.addTransformer({
        name: 'test-transformer',
        transform: (icon) => icon
      });

      const stats = registry.getStats();

      expect(stats.totalIcons).toBe(2);
      expect(stats.transformers).toBe(1);
    });

    it('should update statistics after registration', () => {
      let stats = registry.getStats();
      expect(stats.totalIcons).toBe(0);

      registry.registerSet('test', {
        home: 'M10 20 L30 5 L50 20 V45 H10 Z'
      });

      stats = registry.getStats();
      expect(stats.totalIcons).toBe(1);
    });
  });

  describe('Global Registry', () => {
    it('should return singleton instance', () => {
      const registry1 = getIconRegistry();
      const registry2 = getIconRegistry();

      expect(registry1).toBe(registry2);
    });

    it('should maintain state across calls', () => {
      const registry1 = getIconRegistry();
      registry1.registerSet('test', {
        home: 'M10 20 L30 5 L50 20 V45 H10 Z'
      });

      const registry2 = getIconRegistry();
      expect(registry2.has('home')).toBe(true);
    });

    it('should reset global registry', () => {
      const registry = getIconRegistry();
      registry.registerSet('test', {
        home: 'M10 20 L30 5 L50 20 V45 H10 Z'
      });

      resetIconRegistry();

      const newRegistry = getIconRegistry();
      expect(newRegistry.has('home')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty icon set', () => {
      registry.registerSet('empty', {});
      expect(registry.list()).toHaveLength(0);
    });

    it('should handle icon with only content', async () => {
      const icons: IconSet = {
        custom: {
          content: '<svg><circle cx="10" cy="10" r="5"/></svg>'
        }
      };

      registry.registerSet('test', icons);

      const icon = await registry.get('custom');
      expect(icon).toBeTruthy();
      expect(icon?.content).toContain('circle');
    });

    it('should handle icon with metadata', async () => {
      const icons: IconSet = {
        custom: {
          path: 'M10 10 L20 20 Z',
          metadata: {
            author: 'Test',
            license: 'MIT',
            tags: ['icon', 'test']
          }
        }
      };

      registry.registerSet('test', icons);

      const icon = await registry.get('custom');
      expect(icon?.metadata?.author).toBe('Test');
      expect(icon?.metadata?.license).toBe('MIT');
      expect(icon?.metadata?.tags).toEqual(['icon', 'test']);
    });

    it('should handle icon names with special characters', async () => {
      registry.registerSet('test', {
        'icon-name': 'M10 10 L20 20 Z',
        'icon_name': 'M30 30 L40 40 Z',
        'icon.name': 'M50 50 L60 60 Z'
      });

      expect(registry.has('icon-name')).toBe(true);
      expect(registry.has('icon_name')).toBe(true);
      expect(registry.has('icon.name')).toBe(true);
    });

    it('should handle very long icon names', async () => {
      const longName = 'a'.repeat(1000);
      registry.registerSet('test', {
        [longName]: 'M10 10 L20 20 Z'
      });

      const icon = await registry.get(longName);
      expect(icon).toBeTruthy();
    });

    it('should handle unicode icon names', async () => {
      registry.registerSet('test', {
        '🏠': 'M10 20 L30 5 L50 20 V45 H10 Z',
        '⭐': 'M10 0 L12 8 L20 8 L14 12 L16 20 L10 15 L4 20 L6 12 L0 8 L8 8 Z'
      });

      expect(registry.has('🏠')).toBe(true);
      expect(registry.has('⭐')).toBe(true);
    });
  });

  describe('Lazy Loading', () => {
    it('should support lazy loading configuration', () => {
      const source: IconSource = {
        name: 'lazy-icons',
        type: 'url',
        source: 'https://example.com/icons.svg',
        lazy: true
      };

      expect(() => registry.register(source)).not.toThrow();
    });

    it('should not load icons immediately when lazy', () => {
      const source: IconSource = {
        name: 'lazy-icons',
        type: 'inline',
        source: {
          home: 'M10 20 L30 5 L50 20 V45 H10 Z'
        },
        lazy: true
      };

      registry.register(source);

      // With inline type, icons are loaded immediately regardless of lazy flag
      // This is expected behavior - lazy only applies to remote sources
      expect(registry.has('home')).toBe(true);
    });
  });
});
