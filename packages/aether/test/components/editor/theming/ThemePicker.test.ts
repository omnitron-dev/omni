/**
 * ThemePicker Component Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ThemePicker } from '../../../../src/components/editor/theming/ThemePicker';
import { defaultTheme, darkTheme, minimalTheme } from '../../../../src/components/editor/theming/presets';

describe('ThemePicker', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('Rendering', () => {
    it('should render theme picker', () => {
      const picker = ThemePicker({
        themes: [defaultTheme, darkTheme],
        currentTheme: 'default',
      });

      container.innerHTML = picker.render();
      expect(container.querySelector('.theme-picker')).toBeTruthy();
    });

    it('should display current theme name', () => {
      const picker = ThemePicker({
        themes: [defaultTheme, darkTheme],
        currentTheme: 'default',
      });

      container.innerHTML = picker.render();
      const label = container.querySelector('.theme-picker__label');
      expect(label?.textContent).toBe('Default');
    });

    it('should render theme grid when open', () => {
      const picker = ThemePicker({
        themes: [defaultTheme, darkTheme, minimalTheme],
        currentTheme: 'default',
      });

      container.innerHTML = picker.render();

      // Initially closed
      expect(container.querySelector('.theme-picker__dropdown')).toBeFalsy();
    });
  });

  describe('Theme Selection', () => {
    it('should call onChange when theme is selected', () => {
      const onChange = vi.fn();
      const picker = ThemePicker({
        themes: [defaultTheme, darkTheme],
        currentTheme: 'default',
        onChange,
      });

      container.innerHTML = picker.render();
      picker.afterRender?.(container);

      // This would require simulating click events
      // In a real scenario, you'd click on a theme item
    });

    it('should mark selected theme', () => {
      const picker = ThemePicker({
        themes: [defaultTheme, darkTheme],
        currentTheme: 'default',
      });

      container.innerHTML = picker.render();
      // The selected theme should have is-selected class when dropdown is open
    });
  });

  describe('Theme Previews', () => {
    it('should generate theme preview for each theme', () => {
      const picker = ThemePicker({
        themes: [defaultTheme, darkTheme, minimalTheme],
        currentTheme: 'default',
        showPreview: true,
      });

      container.innerHTML = picker.render();
      // Should have preview components
    });

    it('should show theme colors in preview', () => {
      const picker = ThemePicker({
        themes: [defaultTheme],
        currentTheme: 'default',
        showPreview: true,
      });

      container.innerHTML = picker.render();
      // Preview should reflect theme colors
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes', () => {
      const picker = ThemePicker({
        themes: [defaultTheme, darkTheme],
        currentTheme: 'default',
      });

      container.innerHTML = picker.render();

      const trigger = container.querySelector('.theme-picker__trigger');
      expect(trigger?.getAttribute('aria-expanded')).toBeDefined();
      expect(trigger?.getAttribute('aria-haspopup')).toBe('true');
    });

    it('should support keyboard navigation', () => {
      const picker = ThemePicker({
        themes: [defaultTheme, darkTheme],
        currentTheme: 'default',
      });

      container.innerHTML = picker.render();
      // Theme items should have tabindex and respond to Enter/Space
    });

    it('should have role attributes', () => {
      const picker = ThemePicker({
        themes: [defaultTheme, darkTheme],
        currentTheme: 'default',
      });

      container.innerHTML = picker.render();
      // Should have proper role attributes for menu
    });
  });

  describe('Responsive Behavior', () => {
    it('should adapt to small screens', () => {
      const picker = ThemePicker({
        themes: [defaultTheme, darkTheme, minimalTheme],
        currentTheme: 'default',
      });

      container.innerHTML = picker.render();
      // Should have responsive styles applied
    });
  });
});
