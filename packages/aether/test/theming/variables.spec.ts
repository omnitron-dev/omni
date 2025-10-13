/**
 * CSS Variable Generation Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateCSSVariables,
  generateScopedVariables,
  applyTheme,
  removeTheme,
  getCSSVariable,
  createThemeVars,
  generateThemeTypes,
} from '../../src/theming/variables.js';
import { createDefaultLightTheme, createDefaultDarkTheme, defineTheme } from '../../src/theming/defineTheme.js';

describe('CSS Variable Generation', () => {
  describe('generateCSSVariables', () => {
    it('should generate CSS variables from theme', () => {
      const theme = defineTheme({
        name: 'test',
        colors: {
          primary: '#3b82f6',
        },
        typography: {
          fontSize: {
            base: '1rem',
          },
        },
        spacing: {
          4: '1rem',
        },
      });

      const css = generateCSSVariables(theme);

      expect(css).toContain(':root {');
      expect(css).toContain('--aether-color-primary: #3b82f6');
      expect(css).toContain('--aether-typography-fontSize-base: 1rem');
      expect(css).toContain('--aether-spacing-4: 1rem');
    });

    it('should handle nested color scales', () => {
      const theme = defineTheme({
        name: 'test',
        colors: {
          primary: {
            500: '#3b82f6',
            600: '#2563eb',
          },
        },
        typography: {},
        spacing: {},
      });

      const css = generateCSSVariables(theme);

      expect(css).toContain('--aether-color-primary-500: #3b82f6');
      expect(css).toContain('--aether-color-primary-600: #2563eb');
    });

    it('should handle custom prefix', () => {
      const theme = defineTheme({
        name: 'test',
        colors: {
          primary: '#3b82f6',
        },
        typography: {},
        spacing: {},
      });

      const css = generateCSSVariables(theme, 'custom');

      expect(css).toContain('--custom-color-primary: #3b82f6');
    });

    it('should handle all token types', () => {
      const theme = defineTheme({
        name: 'test',
        colors: { primary: '#3b82f6' },
        typography: { fontSize: { base: '1rem' } },
        spacing: { 4: '1rem' },
        radius: { md: '0.375rem' },
        shadow: { md: '0 4px 6px rgba(0,0,0,0.1)' },
      });

      const css = generateCSSVariables(theme);

      expect(css).toContain('--aether-color-primary');
      expect(css).toContain('--aether-typography-fontSize-base');
      expect(css).toContain('--aether-spacing-4');
      expect(css).toContain('--aether-radius-md');
      expect(css).toContain('--aether-shadow-md');
    });

    it('should handle custom tokens', () => {
      const theme = defineTheme({
        name: 'test',
        colors: {},
        typography: {},
        spacing: {},
        custom: {
          brandColor: '#ff0000',
        },
      });

      const css = generateCSSVariables(theme);

      expect(css).toContain('--aether-custom-brandColor: #ff0000');
    });
  });

  describe('generateScopedVariables', () => {
    it('should generate scoped variables', () => {
      const theme = defineTheme({
        name: 'dark',
        colors: {
          background: { primary: '#111827' },
        },
        typography: {},
        spacing: {},
      });

      const css = generateScopedVariables(theme, '.dark');

      expect(css).toContain('.dark {');
      expect(css).not.toContain(':root');
      expect(css).toContain('--aether-color-background-primary: #111827');
    });

    it('should handle data attributes', () => {
      const theme = defineTheme({
        name: 'dark',
        colors: {
          primary: '#3b82f6',
        },
        typography: {},
        spacing: {},
      });

      const css = generateScopedVariables(theme, '[data-theme="dark"]');

      expect(css).toContain('[data-theme="dark"] {');
    });
  });

  describe('applyTheme', () => {
    let testElement: HTMLDivElement;

    beforeEach(() => {
      testElement = document.createElement('div');
      document.body.appendChild(testElement);
    });

    afterEach(() => {
      if (testElement.parentNode) {
        testElement.parentNode.removeChild(testElement);
      }
    });

    it('should apply theme to element', () => {
      const theme = defineTheme({
        name: 'test',
        colors: {
          primary: '#3b82f6',
        },
        typography: {},
        spacing: {},
      });

      applyTheme(theme, testElement);

      expect(testElement.style.getPropertyValue('--aether-color-primary')).toBe('#3b82f6');
      expect(testElement.getAttribute('data-theme')).toBe('test');
    });

    it('should apply theme to document root if no element provided', () => {
      const theme = defineTheme({
        name: 'test',
        colors: {
          primary: '#3b82f6',
        },
        typography: {},
        spacing: {},
      });

      applyTheme(theme);

      expect(document.documentElement.style.getPropertyValue('--aether-color-primary')).toBe('#3b82f6');

      // Cleanup
      removeTheme();
    });

    it('should handle custom prefix', () => {
      const theme = defineTheme({
        name: 'test',
        colors: {
          primary: '#3b82f6',
        },
        typography: {},
        spacing: {},
      });

      applyTheme(theme, testElement, 'custom');

      expect(testElement.style.getPropertyValue('--custom-color-primary')).toBe('#3b82f6');
    });

    it('should handle nested tokens', () => {
      const theme = defineTheme({
        name: 'test',
        colors: {
          primary: {
            500: '#3b82f6',
            600: '#2563eb',
          },
        },
        typography: {},
        spacing: {},
      });

      applyTheme(theme, testElement);

      expect(testElement.style.getPropertyValue('--aether-color-primary-500')).toBe('#3b82f6');
      expect(testElement.style.getPropertyValue('--aether-color-primary-600')).toBe('#2563eb');
    });
  });

  describe('removeTheme', () => {
    let testElement: HTMLDivElement;

    beforeEach(() => {
      testElement = document.createElement('div');
      document.body.appendChild(testElement);
    });

    afterEach(() => {
      if (testElement.parentNode) {
        testElement.parentNode.removeChild(testElement);
      }
    });

    it('should remove theme from element', () => {
      const theme = defineTheme({
        name: 'test',
        colors: {
          primary: '#3b82f6',
        },
        typography: {},
        spacing: {},
      });

      applyTheme(theme, testElement);

      expect(testElement.style.getPropertyValue('--aether-color-primary')).toBe('#3b82f6');

      removeTheme(testElement);

      expect(testElement.style.getPropertyValue('--aether-color-primary')).toBe('');
      expect(testElement.getAttribute('data-theme')).toBeNull();
    });
  });

  describe('getCSSVariable', () => {
    it('should get CSS variable reference', () => {
      const varRef = getCSSVariable('colors.primary.500');

      expect(varRef).toBe('var(--aether-color-primary-500)');
    });

    it('should handle custom prefix', () => {
      const varRef = getCSSVariable('colors.primary', 'custom');

      expect(varRef).toBe('var(--custom-color-primary)');
    });

    it('should convert colors to color', () => {
      const varRef = getCSSVariable('colors.primary');

      expect(varRef).toContain('--aether-color-primary');
    });

    it('should handle nested paths', () => {
      const varRef = getCSSVariable('typography.fontSize.base');

      expect(varRef).toBe('var(--aether-typography-fontSize-base)');
    });
  });

  describe('createThemeVars', () => {
    it('should create theme vars map', () => {
      const theme = defineTheme({
        name: 'test',
        colors: {
          primary: '#3b82f6',
          secondary: '#6c757d',
        },
        typography: {
          fontSize: {
            base: '1rem',
          },
        },
        spacing: {
          4: '1rem',
        },
      });

      const vars = createThemeVars(theme);

      expect(vars['colors.primary']).toBe('var(--aether-color-primary)');
      expect(vars['colors.secondary']).toBe('var(--aether-color-secondary)');
      expect(vars['typography.fontSize.base']).toBe('var(--aether-typography-fontSize-base)');
      expect(vars['spacing.4']).toBe('var(--aether-spacing-4)');
    });

    it('should handle nested tokens', () => {
      const theme = defineTheme({
        name: 'test',
        colors: {
          primary: {
            500: '#3b82f6',
            600: '#2563eb',
          },
        },
        typography: {},
        spacing: {},
      });

      const vars = createThemeVars(theme);

      expect(vars['colors.primary.500']).toBe('var(--aether-color-primary-500)');
      expect(vars['colors.primary.600']).toBe('var(--aether-color-primary-600)');
    });

    it('should handle custom prefix', () => {
      const theme = defineTheme({
        name: 'test',
        colors: {
          primary: '#3b82f6',
        },
        typography: {},
        spacing: {},
      });

      const vars = createThemeVars(theme, 'custom');

      expect(vars['colors.primary']).toBe('var(--custom-color-primary)');
    });
  });

  describe('generateThemeTypes', () => {
    it('should generate TypeScript types', () => {
      const theme = defineTheme({
        name: 'test',
        colors: {
          primary: '#3b82f6',
        },
        typography: {
          fontSize: {
            base: '1rem',
          },
        },
        spacing: {
          4: '1rem',
        },
      });

      const types = generateThemeTypes(theme);

      expect(types).toContain('export type ThemeToken =');
      expect(types).toContain("'colors.primary'");
      expect(types).toContain("'typography.fontSize.base'");
      expect(types).toContain("'spacing.4'");
    });
  });

  describe('Default themes', () => {
    it('should generate variables for light theme', () => {
      const lightTheme = createDefaultLightTheme();
      const css = generateCSSVariables(lightTheme);

      expect(css).toContain('--aether-color-primary');
      expect(css).toContain('--aether-color-gray');
      expect(css).toContain('--aether-typography-fontFamily');
      expect(css).toContain('--aether-spacing');
    });

    it('should generate variables for dark theme', () => {
      const darkTheme = createDefaultDarkTheme();
      const css = generateCSSVariables(darkTheme);

      expect(css).toContain('--aether-color-background-primary');
      expect(css).toContain('--aether-color-text-primary');
    });
  });
});
