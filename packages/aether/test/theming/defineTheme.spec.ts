/**
 * Theme Definition Tests
 */

import { describe, it, expect } from 'vitest';
import {
  defineTheme,
  getToken,
  createDefaultLightTheme,
  createDefaultDarkTheme,
} from '../../src/theming/defineTheme.js';

describe('Theme Definition', () => {
  describe('defineTheme', () => {
    it('should create a basic theme', () => {
      const theme = defineTheme({
        name: 'test',
        colors: {
          primary: '#3b82f6',
        },
        typography: {
          fontFamily: {
            sans: 'Inter, sans-serif',
          },
        },
        spacing: {
          4: '1rem',
        },
      });

      expect(theme.name).toBe('test');
      expect(theme.colors.primary).toBe('#3b82f6');
      expect(theme.typography.fontFamily?.sans).toBe('Inter, sans-serif');
      expect(theme.spacing[4]).toBe('1rem');
    });

    it('should support color scales', () => {
      const theme = defineTheme({
        name: 'test',
        colors: {
          primary: {
            500: '#3b82f6',
            600: '#2563eb',
            700: '#1d4ed8',
          },
        },
        typography: {},
        spacing: {},
      });

      expect(theme.colors.primary).toEqual({
        500: '#3b82f6',
        600: '#2563eb',
        700: '#1d4ed8',
      });
    });

    it('should support semantic colors', () => {
      const theme = defineTheme({
        name: 'test',
        colors: {
          background: {
            primary: '#ffffff',
            secondary: '#f3f4f6',
          },
          text: {
            primary: '#111827',
            secondary: '#6b7280',
          },
        },
        typography: {},
        spacing: {},
      });

      expect(theme.colors.background?.primary).toBe('#ffffff');
      expect(theme.colors.text?.primary).toBe('#111827');
    });

    it('should support theme inheritance', () => {
      const baseTheme = defineTheme({
        name: 'base',
        colors: {
          primary: '#3b82f6',
          secondary: '#6c757d',
        },
        typography: {
          fontFamily: {
            sans: 'Inter, sans-serif',
          },
        },
        spacing: {
          4: '1rem',
        },
      });

      const extendedTheme = defineTheme({
        name: 'extended',
        extends: baseTheme,
        colors: {
          primary: '#2563eb', // Override
        },
        typography: {},
        spacing: {},
      });

      expect(extendedTheme.colors.primary).toBe('#2563eb'); // Overridden
      expect(extendedTheme.colors.secondary).toBe('#6c757d'); // Inherited
      expect(extendedTheme.typography.fontFamily?.sans).toBe('Inter, sans-serif'); // Inherited
    });

    it('should support custom tokens', () => {
      const theme = defineTheme({
        name: 'test',
        colors: {},
        typography: {},
        spacing: {},
        custom: {
          brandColor: '#ff0000',
          logoSize: '2rem',
        },
      });

      expect(theme.custom).toEqual({
        brandColor: '#ff0000',
        logoSize: '2rem',
      });
    });

    it('should support all token types', () => {
      const theme = defineTheme({
        name: 'complete',
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
        sizing: {
          md: '16rem',
        },
        radius: {
          md: '0.375rem',
        },
        shadow: {
          md: '0 4px 6px rgba(0,0,0,0.1)',
        },
        zIndex: {
          modal: 1000,
        },
        animation: {
          duration: {
            base: '200ms',
          },
        },
        breakpoints: {
          md: '768px',
        },
      });

      expect(theme.sizing?.md).toBe('16rem');
      expect(theme.radius?.md).toBe('0.375rem');
      expect(theme.shadow?.md).toBe('0 4px 6px rgba(0,0,0,0.1)');
      expect(theme.zIndex?.modal).toBe(1000);
      expect(theme.animation?.duration?.base).toBe('200ms');
      expect(theme.breakpoints?.md).toBe('768px');
    });
  });

  describe('getToken', () => {
    const theme = defineTheme({
      name: 'test',
      colors: {
        primary: {
          500: '#3b82f6',
          600: '#2563eb',
        },
        background: {
          primary: '#ffffff',
        },
      },
      typography: {
        fontSize: {
          base: '1rem',
          lg: '1.125rem',
        },
      },
      spacing: {
        4: '1rem',
      },
    });

    it('should get token by path', () => {
      expect(getToken(theme, 'colors.primary.500')).toBe('#3b82f6');
      expect(getToken(theme, 'typography.fontSize.base')).toBe('1rem');
      expect(getToken(theme, 'spacing.4')).toBe('1rem');
    });

    it('should get nested token', () => {
      expect(getToken(theme, 'colors.background.primary')).toBe('#ffffff');
    });

    it('should return undefined for non-existent path', () => {
      expect(getToken(theme, 'colors.nonexistent')).toBeUndefined();
      expect(getToken(theme, 'invalid.path.here')).toBeUndefined();
    });

    it('should get object at path', () => {
      const primary = getToken(theme, 'colors.primary');

      expect(primary).toEqual({
        500: '#3b82f6',
        600: '#2563eb',
      });
    });
  });

  describe('createDefaultLightTheme', () => {
    it('should create default light theme', () => {
      const theme = createDefaultLightTheme();

      expect(theme.name).toBe('light');
      expect(theme.colors).toBeDefined();
      expect(theme.typography).toBeDefined();
      expect(theme.spacing).toBeDefined();
    });

    it('should have primary colors', () => {
      const theme = createDefaultLightTheme();

      expect(theme.colors.primary).toBeDefined();
      expect(typeof theme.colors.primary).toBe('object');
    });

    it('should have gray scale', () => {
      const theme = createDefaultLightTheme();

      expect(theme.colors.gray).toBeDefined();
      expect(typeof theme.colors.gray).toBe('object');
    });

    it('should have semantic colors', () => {
      const theme = createDefaultLightTheme();

      expect(theme.colors.background?.primary).toBeDefined();
      expect(theme.colors.text?.primary).toBeDefined();
      expect(theme.colors.border?.default).toBeDefined();
    });

    it('should have typography tokens', () => {
      const theme = createDefaultLightTheme();

      expect(theme.typography.fontFamily).toBeDefined();
      expect(theme.typography.fontSize).toBeDefined();
      expect(theme.typography.fontWeight).toBeDefined();
      expect(theme.typography.lineHeight).toBeDefined();
    });

    it('should have spacing scale', () => {
      const theme = createDefaultLightTheme();

      expect(theme.spacing[0]).toBeDefined();
      expect(theme.spacing[4]).toBeDefined();
      expect(theme.spacing[8]).toBeDefined();
    });

    it('should have radius tokens', () => {
      const theme = createDefaultLightTheme();

      expect(theme.radius).toBeDefined();
      expect(theme.radius?.md).toBeDefined();
    });

    it('should have shadow tokens', () => {
      const theme = createDefaultLightTheme();

      expect(theme.shadow).toBeDefined();
      expect(theme.shadow?.md).toBeDefined();
    });
  });

  describe('createDefaultDarkTheme', () => {
    it('should create default dark theme', () => {
      const theme = createDefaultDarkTheme();

      expect(theme.name).toBe('dark');
    });

    it('should extend light theme', () => {
      const darkTheme = createDefaultDarkTheme();
      const lightTheme = createDefaultLightTheme();

      // Should inherit primary colors
      expect(darkTheme.colors.primary).toEqual(lightTheme.colors.primary);

      // Should override semantic colors
      expect(darkTheme.colors.background?.primary).not.toBe(lightTheme.colors.background?.primary);
      expect(darkTheme.colors.text?.primary).not.toBe(lightTheme.colors.text?.primary);
    });

    it('should have dark semantic colors', () => {
      const theme = createDefaultDarkTheme();

      // Dark background should be dark color
      expect(theme.colors.background?.primary).toMatch(/#[0-9a-f]{6}/i);

      // Dark text should be light color
      expect(theme.colors.text?.primary).toMatch(/#[0-9a-f]{6}/i);
    });
  });
});
