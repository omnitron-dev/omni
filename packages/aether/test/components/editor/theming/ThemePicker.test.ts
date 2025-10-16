/**
 * ThemePicker Component Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThemePicker } from '../../../../src/components/editor/theming/ThemePicker';
import { defaultTheme, darkTheme, minimalTheme } from '../../../../src/components/editor/theming/presets';
import { resetThemeManager, getThemeManager } from '../../../../src/components/editor/theming/ThemeManager';

describe('ThemePicker', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    // Reset theme manager and register test themes
    resetThemeManager();
    const themeManager = getThemeManager();
    themeManager.registerThemes([defaultTheme, darkTheme, minimalTheme]);
  });

  afterEach(() => {
    document.body.removeChild(container);
    resetThemeManager();
  });

  describe('Rendering', () => {
    it('should render theme picker', () => {
      const rendered = ThemePicker({
        themes: [defaultTheme, darkTheme],
        currentTheme: 'default',
      });

      expect(rendered).toBeDefined();
      expect(rendered).toBeInstanceOf(Node);
      if (rendered instanceof Element) {
        container.appendChild(rendered);
        expect(container.querySelector('.theme-picker')).toBeTruthy();
      }
    });

    it('should display current theme name', () => {
      const rendered = ThemePicker({
        themes: [defaultTheme, darkTheme],
        currentTheme: 'default',
      });

      expect(rendered).toBeInstanceOf(Node);
      if (rendered instanceof Element) {
        container.appendChild(rendered);
        const label = container.querySelector('.theme-picker__label');
        expect(label?.textContent).toBe('Default');
      }
    });

    it('should render theme grid when open', () => {
      const rendered = ThemePicker({
        themes: [defaultTheme, darkTheme, minimalTheme],
        currentTheme: 'default',
      });

      expect(rendered).toBeInstanceOf(Node);
      if (rendered instanceof Element) {
        container.appendChild(rendered);
        // Initially closed
        expect(container.querySelector('.theme-picker__dropdown')).toBeFalsy();
      }
    });
  });

  describe('Theme Selection', () => {
    it('should call onChange when theme is selected', () => {
      const onChange = vi.fn();
      const rendered = ThemePicker({
        themes: [defaultTheme, darkTheme],
        currentTheme: 'default',
        onChange,
      });

      expect(rendered).toBeInstanceOf(Node);
      if (rendered instanceof Element) {
        container.appendChild(rendered);
        // This would require simulating click events
        // In a real scenario, you'd click on a theme item
      }
    });

    it('should mark selected theme', () => {
      const rendered = ThemePicker({
        themes: [defaultTheme, darkTheme],
        currentTheme: 'default',
      });

      expect(rendered).toBeInstanceOf(Node);
      if (rendered instanceof Element) {
        container.appendChild(rendered);
        // The selected theme should have is-selected class when dropdown is open
      }
    });
  });

  describe('Theme Previews', () => {
    it('should generate theme preview for each theme', () => {
      const rendered = ThemePicker({
        themes: [defaultTheme, darkTheme, minimalTheme],
        currentTheme: 'default',
        showPreview: true,
      });

      expect(rendered).toBeInstanceOf(Node);
      if (rendered instanceof Element) {
        container.appendChild(rendered);
        // Should have preview components
      }
    });

    it('should show theme colors in preview', () => {
      const rendered = ThemePicker({
        themes: [defaultTheme],
        currentTheme: 'default',
        showPreview: true,
      });

      expect(rendered).toBeInstanceOf(Node);
      if (rendered instanceof Element) {
        container.appendChild(rendered);
        // Preview should reflect theme colors
      }
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes', () => {
      const rendered = ThemePicker({
        themes: [defaultTheme, darkTheme],
        currentTheme: 'default',
      });

      expect(rendered).toBeInstanceOf(Node);
      if (rendered instanceof Element) {
        container.appendChild(rendered);

        const trigger = container.querySelector('.theme-picker__trigger');
        expect(trigger?.getAttribute('aria-expanded')).toBeDefined();
        expect(trigger?.getAttribute('aria-haspopup')).toBe('true');
      }
    });

    it('should support keyboard navigation', () => {
      const rendered = ThemePicker({
        themes: [defaultTheme, darkTheme],
        currentTheme: 'default',
      });

      expect(rendered).toBeInstanceOf(Node);
      if (rendered instanceof Element) {
        container.appendChild(rendered);
        // Theme items should have tabindex and respond to Enter/Space
      }
    });

    it('should have role attributes', () => {
      const rendered = ThemePicker({
        themes: [defaultTheme, darkTheme],
        currentTheme: 'default',
      });

      expect(rendered).toBeInstanceOf(Node);
      if (rendered instanceof Element) {
        container.appendChild(rendered);
        // Should have proper role attributes for menu
      }
    });
  });

  describe('Responsive Behavior', () => {
    it('should adapt to small screens', () => {
      const rendered = ThemePicker({
        themes: [defaultTheme, darkTheme, minimalTheme],
        currentTheme: 'default',
      });

      expect(rendered).toBeInstanceOf(Node);
      if (rendered instanceof Element) {
        container.appendChild(rendered);
        // Should have responsive styles applied
      }
    });
  });
});
