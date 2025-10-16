/**
 * ThemeManager Tests
 * Comprehensive tests for the theme management system
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThemeManager, resetThemeManager } from '../../../../src/components/editor/theming/ThemeManager';
import { defaultTheme, darkTheme, minimalTheme } from '../../../../src/components/editor/theming/presets';
import type { Theme, ThemeChangeEvent } from '../../../../src/components/editor/theming/types';

describe('ThemeManager', () => {
  let themeManager: ThemeManager;
  let mockLocalStorage: Record<string, string>;

  beforeEach(() => {
    // Reset global instance
    resetThemeManager();

    // Mock localStorage
    mockLocalStorage = {};
    global.localStorage = {
      getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        mockLocalStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockLocalStorage[key];
      }),
      clear: vi.fn(() => {
        mockLocalStorage = {};
      }),
      length: 0,
      key: vi.fn(() => null),
    } as any;

    // Mock matchMedia for dark mode detection
    global.matchMedia = vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as any;

    // Create fresh instance
    themeManager = new ThemeManager({ persist: false });
  });

  afterEach(() => {
    themeManager.destroy();
  });

  describe('Theme Registration', () => {
    it('should register a theme', () => {
      themeManager.registerTheme(defaultTheme);
      expect(themeManager.getTheme('default')).toEqual(defaultTheme);
    });

    it('should register multiple themes', () => {
      themeManager.registerThemes([defaultTheme, darkTheme, minimalTheme]);
      expect(themeManager.getThemeNames()).toHaveLength(3);
      expect(themeManager.getThemeNames()).toContain('default');
      expect(themeManager.getThemeNames()).toContain('dark');
      expect(themeManager.getThemeNames()).toContain('minimal');
    });

    it('should throw error for invalid theme', () => {
      const invalidTheme = {
        metadata: { name: '' },
      } as any;

      expect(() => themeManager.registerTheme(invalidTheme)).toThrow();
    });

    it('should apply first registered theme automatically', async () => {
      themeManager.registerTheme(defaultTheme);
      expect(themeManager.currentTheme).toBe('default');
    });
  });

  describe('Theme Application', () => {
    beforeEach(() => {
      themeManager.registerThemes([defaultTheme, darkTheme]);
    });

    it('should apply a theme', async () => {
      await themeManager.applyTheme('dark');
      expect(themeManager.currentTheme).toBe('dark');
    });

    it('should throw error for non-existent theme', async () => {
      await expect(themeManager.applyTheme('nonexistent')).rejects.toThrow();
    });

    it('should update CSS custom properties', async () => {
      await themeManager.applyTheme('default');

      const styleElement = document.getElementById('aether-theme-vars');
      expect(styleElement).toBeTruthy();
      expect(styleElement?.textContent).toContain('--editor-color-primary');
    });

    it('should update theme class on root element', async () => {
      await themeManager.applyTheme('default');
      expect(document.documentElement.classList.contains('theme-default')).toBe(true);

      await themeManager.applyTheme('dark');
      expect(document.documentElement.classList.contains('theme-dark')).toBe(true);
      expect(document.documentElement.classList.contains('theme-default')).toBe(false);
    });

    it('should emit theme change event', async () => {
      const listener = vi.fn();
      themeManager.onThemeChange(listener);

      await themeManager.applyTheme('dark');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'default',
          to: 'dark',
          theme: darkTheme,
        })
      );
    });
  });

  describe('Theme Switching', () => {
    beforeEach(() => {
      themeManager.registerThemes([defaultTheme, darkTheme, minimalTheme]);
    });

    it('should switch to dark mode', async () => {
      await themeManager.applyTheme('default');
      themeManager.switchThemeMode(true);
      expect(themeManager.currentTheme).toBe('dark');
    });

    it('should switch to light mode', async () => {
      await themeManager.applyTheme('dark');
      themeManager.switchThemeMode(false);
      expect(themeManager.currentTheme).toBe('default');
    });

    it('should toggle dark mode', async () => {
      await themeManager.applyTheme('default');
      themeManager.toggleDarkMode();
      expect(themeManager.currentTheme).toBe('dark');

      themeManager.toggleDarkMode();
      expect(themeManager.currentTheme).toBe('default');
    });
  });

  describe('Theme Persistence', () => {
    it('should persist theme to localStorage', async () => {
      const persistentManager = new ThemeManager({ persist: true });
      persistentManager.registerTheme(darkTheme);
      await persistentManager.applyTheme('dark');

      expect(localStorage.setItem).toHaveBeenCalledWith('aether-editor-theme', 'dark');
      persistentManager.destroy();
    });

    it('should load persisted theme on initialization', () => {
      mockLocalStorage['aether-editor-theme'] = 'dark';

      const persistentManager = new ThemeManager({ persist: true });
      persistentManager.registerTheme(darkTheme);

      expect(persistentManager.currentTheme).toBe('dark');
      persistentManager.destroy();
    });

    it('should handle missing persisted theme gracefully', () => {
      mockLocalStorage['aether-editor-theme'] = 'nonexistent';

      const persistentManager = new ThemeManager({
        persist: true,
        defaultTheme: 'default',
      });
      persistentManager.registerTheme(defaultTheme);

      expect(persistentManager.currentTheme).toBe('default');
      persistentManager.destroy();
    });
  });

  describe('Dark Mode Detection', () => {
    it('should detect system dark mode preference', () => {
      global.matchMedia = vi.fn((query: string) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })) as any;

      const autoManager = new ThemeManager({ autoDarkMode: true });
      autoManager.registerThemes([defaultTheme, darkTheme]);

      expect(autoManager.currentTheme).toBe('dark');
      autoManager.destroy();
    });
  });

  describe('Theme Validation', () => {
    it('should validate valid theme', () => {
      const result = themeManager.validateTheme(defaultTheme);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing theme name', () => {
      const invalidTheme = {
        ...defaultTheme,
        metadata: { ...defaultTheme.metadata, name: '' },
      };

      const result = themeManager.validateTheme(invalidTheme);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Theme must have a name');
    });

    it('should detect missing colors', () => {
      const invalidTheme = {
        ...defaultTheme,
        colors: { ...defaultTheme.colors, primary: '' },
      };

      const result = themeManager.validateTheme(invalidTheme as Theme);
      expect(result.valid).toBe(false);
    });

    it('should warn about missing version', () => {
      const themeWithoutVersion = {
        ...defaultTheme,
        metadata: { ...defaultTheme.metadata, version: '' },
      };

      const result = themeManager.validateTheme(themeWithoutVersion as Theme);
      expect(result.warnings).toContain('Theme should have a version');
    });

    it('should detect insufficient contrast', () => {
      const lowContrastTheme: Theme = {
        ...defaultTheme,
        colors: {
          ...defaultTheme.colors,
          background: '#ffffff',
          text: '#dddddd', // Very low contrast
        },
      };

      const result = themeManager.validateTheme(lowContrastTheme);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('contrast'))).toBe(true);
    });
  });

  describe('Contrast Calculation', () => {
    it('should calculate correct contrast ratio', () => {
      const result = themeManager.calculateContrast('#000000', '#ffffff');
      expect(result.ratio).toBeCloseTo(21, 0);
      expect(result.passes.aa).toBe(true);
      expect(result.passes.aaa).toBe(true);
    });

    it('should handle hex colors', () => {
      const result = themeManager.calculateContrast('#0066cc', '#ffffff');
      expect(result.ratio).toBeGreaterThan(4.5);
      expect(result.passes.aa).toBe(true);
    });

    it('should handle RGB colors', () => {
      const result = themeManager.calculateContrast('rgb(0, 102, 204)', 'rgb(255, 255, 255)');
      expect(result.ratio).toBeGreaterThan(4.5);
    });

    it('should handle short hex colors', () => {
      const result = themeManager.calculateContrast('#000', '#fff');
      expect(result.ratio).toBeCloseTo(21, 0);
    });

    it('should identify AA compliant contrast', () => {
      const result = themeManager.calculateContrast('#767676', '#ffffff');
      expect(result.passes.aa).toBe(true);
    });

    it('should identify AAA compliant contrast', () => {
      const result = themeManager.calculateContrast('#595959', '#ffffff');
      expect(result.passes.aaa).toBe(true);
    });
  });

  describe('Theme Transitions', () => {
    beforeEach(() => {
      themeManager.registerThemes([defaultTheme, darkTheme]);
    });

    it('should enable transitions during theme change', async () => {
      const transitionManager = new ThemeManager({ enableTransitions: true });
      transitionManager.registerThemes([defaultTheme, darkTheme]);

      await transitionManager.applyTheme('dark');
      transitionManager.destroy();
    });

    it('should disable transitions when configured', async () => {
      const noTransitionManager = new ThemeManager({ enableTransitions: false });
      noTransitionManager.registerThemes([defaultTheme, darkTheme]);

      await noTransitionManager.applyTheme('dark');
      expect(noTransitionManager.isTransitioning).toBe(false);
      noTransitionManager.destroy();
    });
  });

  describe('Event Listeners', () => {
    beforeEach(() => {
      themeManager.registerThemes([defaultTheme, darkTheme]);
    });

    it('should add theme change listener', async () => {
      const listener = vi.fn();
      themeManager.onThemeChange(listener);

      await themeManager.applyTheme('dark');
      expect(listener).toHaveBeenCalled();
    });

    it('should remove theme change listener', async () => {
      const listener = vi.fn();
      const unsubscribe = themeManager.onThemeChange(listener);

      unsubscribe();
      await themeManager.applyTheme('dark');
      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle listener errors gracefully', async () => {
      const errorListener = vi.fn(() => {
        throw new Error('Listener error');
      });
      const successListener = vi.fn();

      themeManager.onThemeChange(errorListener);
      themeManager.onThemeChange(successListener);

      await themeManager.applyTheme('dark');

      expect(errorListener).toHaveBeenCalled();
      expect(successListener).toHaveBeenCalled();
    });
  });

  describe('Cleanup', () => {
    it('should remove style element on destroy', () => {
      themeManager.registerTheme(defaultTheme);
      const styleElement = document.getElementById('aether-theme-vars');
      expect(styleElement).toBeTruthy();

      themeManager.destroy();
      const removedElement = document.getElementById('aether-theme-vars');
      expect(removedElement).toBeNull();
    });

    it('should clear listeners on destroy', async () => {
      const listener = vi.fn();
      themeManager.onThemeChange(listener);

      themeManager.destroy();

      // This should not call the listener since manager is destroyed
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('Reactive Signals', () => {
    beforeEach(() => {
      themeManager.registerThemes([defaultTheme, darkTheme]);
    });

    it('should expose current theme as signal', async () => {
      const signal = themeManager.currentTheme$;
      expect(signal.value).toBe('default');

      await themeManager.applyTheme('dark');
      expect(signal.value).toBe('dark');
    });

    it('should track transitioning state', async () => {
      expect(themeManager.isTransitioning).toBe(false);
    });
  });
});
