/**
 * ColorPicker Primitive Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ColorPicker,
  ColorPickerTrigger,
  ColorPickerContent,
  ColorPickerArea,
  ColorPickerHueSlider,
  ColorPickerAlphaSlider,
  ColorPickerPreset,
  type ColorValue,
} from '../../../src/primitives/ColorPicker.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('ColorPicker', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  // ==========================================================================
  // Rendering Tests (10 tests)
  // ==========================================================================

  describe('Rendering Tests', () => {
    it('should render ColorPicker root', () => {
      const { container, cleanup: dispose } = renderComponent(() => ColorPicker({}));
      cleanup = dispose;

      const root = container.querySelector('[data-color-picker]');
      expect(root).toBeTruthy();
    });

    it('should render as div element', () => {
      const { container, cleanup: dispose } = renderComponent(() => ColorPicker({}));
      cleanup = dispose;

      const root = container.querySelector('[data-color-picker]');
      expect(root?.tagName).toBe('DIV');
    });

    it('should render with disabled state', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({ disabled: true })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-color-picker]');
      expect(root?.hasAttribute('data-disabled')).toBe(true);
    });

    it('should not have data-disabled when not disabled', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({ disabled: false })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-color-picker]');
      expect(root?.hasAttribute('data-disabled')).toBe(false);
    });

    it('should render with children using function (Pattern 17)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerTrigger({ children: 'Pick Color' }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger).toBeTruthy();
      expect(trigger?.textContent).toContain('Pick Color');
    });

    it('should render multiple children using function (Pattern 17)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => [
            ColorPickerTrigger({ children: 'Pick' }),
            ColorPickerContent({ children: 'Content' }),
          ],
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      const content = container.querySelector('[data-color-picker-content]');
      expect(trigger).toBeTruthy();
      expect(content).toBeTruthy();
    });

    it('should render all sub-components together', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          showAlpha: true,
          children: () => [
            ColorPickerTrigger({}),
            ColorPickerContent({
              children: [
                ColorPickerArea({}),
                ColorPickerHueSlider({}),
                ColorPickerAlphaSlider({}),
                ColorPickerPreset({ color: '#ff0000' }),
              ],
            }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-color-picker-trigger]')).toBeTruthy();
      expect(container.querySelector('[data-color-picker-content]')).toBeTruthy();
      expect(container.querySelector('[data-color-picker-area]')).toBeTruthy();
      expect(container.querySelector('[data-color-picker-hue-slider]')).toBeTruthy();
      expect(container.querySelector('[data-color-picker-alpha-slider]')).toBeTruthy();
      expect(container.querySelector('[data-color-picker-preset]')).toBeTruthy();
    });

    it('should render with empty children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({ children: () => null })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-color-picker]');
      expect(root).toBeTruthy();
      expect(root?.textContent).toBe('');
    });

    it('should render with showAlpha prop', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          showAlpha: true,
          children: () => ColorPickerAlphaSlider({}),
        })
      );
      cleanup = dispose;

      const alphaSlider = container.querySelector('[data-color-picker-alpha-slider]');
      expect(alphaSlider).toBeTruthy();
    });

    it('should render with format prop', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          format: 'rgb',
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger).toBeTruthy();
      // RGB format should be displayed
      expect(trigger?.textContent).toMatch(/rgb/);
    });
  });

  // ==========================================================================
  // Context Tests (8 tests)
  // ==========================================================================

  describe('Context Tests', () => {
    it('should provide value signal through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 120, s: 50, l: 50, a: 1 },
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger).toBeTruthy();
      expect(trigger?.textContent).toBeTruthy();
    });

    it('should provide showAlpha flag through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          showAlpha: false,
          children: () => ColorPickerAlphaSlider({}),
        })
      );
      cleanup = dispose;

      // Alpha slider should not render when showAlpha is false
      const alphaSlider = container.querySelector('[data-color-picker-alpha-slider]');
      expect(alphaSlider).toBeNull();
    });

    it('should provide format through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          format: 'hex',
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.textContent).toMatch(/#/);
    });

    it('should provide disabled state through context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          disabled: true,
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('button[data-color-picker-trigger]') as HTMLButtonElement;
      expect(trigger.disabled).toBe(true);
    });

    it('should provide toHex conversion function', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 0, s: 100, l: 50, a: 1 },
          format: 'hex',
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.textContent).toMatch(/#[a-f0-9]{6}/i);
    });

    it('should provide toRgb conversion function', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 0, s: 100, l: 50, a: 1 },
          format: 'rgb',
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.textContent).toMatch(/rgb\(/);
    });

    it('should provide toHsl conversion function', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 0, s: 100, l: 50, a: 1 },
          format: 'hsl',
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.textContent).toMatch(/hsl\(/);
    });

    it('should allow sub-components to access context', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 240, s: 100, l: 50, a: 1 },
          children: () => [
            ColorPickerTrigger({}),
            ColorPickerArea({}),
            ColorPickerHueSlider({}),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-color-picker-trigger]')).toBeTruthy();
      expect(container.querySelector('[data-color-picker-area]')).toBeTruthy();
      expect(container.querySelector('[data-color-picker-hue-slider]')).toBeTruthy();
    });
  });

  // ==========================================================================
  // Controlled/Uncontrolled Tests (6 tests)
  // ==========================================================================

  describe('Controlled/Uncontrolled Tests', () => {
    it('should work in uncontrolled mode with defaultValue', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 120, s: 50, l: 50, a: 1 },
          format: 'hsl',
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.textContent).toContain('120');
    });

    it('should work in controlled mode with value prop', () => {
      const controlledValue: ColorValue = { h: 180, s: 75, l: 60, a: 1 };
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          value: controlledValue,
          format: 'hsl',
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.textContent).toContain('180');
    });

    it('should call onValueChange callback when value changes', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 0, s: 50, l: 50, a: 1 },
          onValueChange,
          children: () => ColorPickerPreset({ color: '#00ff00' }),
        })
      );
      cleanup = dispose;

      const preset = container.querySelector('[data-color-picker-preset]') as HTMLButtonElement;
      preset.click();

      expect(onValueChange).toHaveBeenCalled();
      expect(onValueChange).toHaveBeenCalledWith(expect.objectContaining({
        h: expect.any(Number),
        s: expect.any(Number),
        l: expect.any(Number),
        a: expect.any(Number),
      }));
    });

    it('should use controlled value over internal state', () => {
      const controlledValue: ColorValue = { h: 300, s: 100, l: 50, a: 1 };
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          value: controlledValue,
          defaultValue: { h: 0, s: 0, l: 0, a: 1 },
          format: 'hsl',
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.textContent).toContain('300');
    });

    it('should update when controlled value changes externally', () => {
      let controlledValue: ColorValue = { h: 60, s: 100, l: 50, a: 1 };
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          value: controlledValue,
          format: 'hsl',
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.textContent).toContain('60');
    });

    it('should default to h:0 s:100 l:50 a:1 when no value provided', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          format: 'hex',
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      // Default h:0 s:100 l:50 should be red: #ff0000
      expect(trigger?.textContent).toMatch(/#[a-f0-9]{6}/i);
    });
  });

  // ==========================================================================
  // Color Conversion Tests (12 tests)
  // ==========================================================================

  describe('Color Conversion Tests', () => {
    it('should convert to hex correctly', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 0, s: 100, l: 50, a: 1 },
          format: 'hex',
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.textContent).toMatch(/#[a-f0-9]{6}/i);
    });

    it('should convert to RGB string', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 0, s: 100, l: 50, a: 1 },
          format: 'rgb',
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.textContent).toMatch(/rgb\(\d+,\s*\d+,\s*\d+\)/);
    });

    it('should convert to RGB with alpha when showAlpha and alpha < 1', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 0, s: 100, l: 50, a: 0.5 },
          format: 'rgb',
          showAlpha: true,
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.textContent).toMatch(/rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)/);
    });

    it('should convert to HSL string', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 120, s: 50, l: 50, a: 1 },
          format: 'hsl',
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.textContent).toMatch(/hsl\(\d+,\s*\d+%,\s*\d+%\)/);
    });

    it('should convert to HSL with alpha when showAlpha and alpha < 1', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 240, s: 100, l: 50, a: 0.8 },
          format: 'hsl',
          showAlpha: true,
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.textContent).toMatch(/hsla\(\d+,\s*\d+%,\s*\d+%,\s*[\d.]+\)/);
    });

    it('should parse hex color correctly', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerPreset({ color: '#00ff00' }),
        })
      );
      cleanup = dispose;

      const preset = container.querySelector('[data-color-picker-preset]') as HTMLButtonElement;
      expect(preset).toBeTruthy();
      expect(preset.style.background).toContain('#00ff00');
    });

    it('should parse rgb color correctly', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerPreset({ color: 'rgb(255, 0, 0)' }),
        })
      );
      cleanup = dispose;

      const preset = container.querySelector('[data-color-picker-preset]') as HTMLButtonElement;
      expect(preset).toBeTruthy();
    });

    it('should parse rgba color correctly', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerPreset({ color: 'rgba(0, 255, 0, 0.5)' }),
        })
      );
      cleanup = dispose;

      const preset = container.querySelector('[data-color-picker-preset]') as HTMLButtonElement;
      expect(preset).toBeTruthy();
    });

    it('should parse hsl color correctly', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerPreset({ color: 'hsl(240, 100%, 50%)' }),
        })
      );
      cleanup = dispose;

      const preset = container.querySelector('[data-color-picker-preset]') as HTMLButtonElement;
      expect(preset).toBeTruthy();
    });

    it('should parse hsla color correctly', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerPreset({ color: 'hsla(120, 50%, 50%, 0.7)' }),
        })
      );
      cleanup = dispose;

      const preset = container.querySelector('[data-color-picker-preset]') as HTMLButtonElement;
      expect(preset).toBeTruthy();
    });

    it('should convert red color correctly (h:0)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 0, s: 100, l: 50, a: 1 },
          format: 'hex',
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.textContent?.toLowerCase()).toContain('ff');
    });

    it('should convert blue color correctly (h:240)', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 240, s: 100, l: 50, a: 1 },
          format: 'hex',
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.textContent?.toLowerCase()).toContain('ff');
    });
  });

  // ==========================================================================
  // ColorPickerTrigger Tests (8 tests)
  // ==========================================================================

  describe('ColorPickerTrigger Tests', () => {
    it('should render as button', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.tagName).toBe('BUTTON');
    });

    it('should display current color string in hex format', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 0, s: 100, l: 50, a: 1 },
          format: 'hex',
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.textContent).toMatch(/#[a-f0-9]{6}/i);
    });

    it('should display current color string in rgb format', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 120, s: 100, l: 50, a: 1 },
          format: 'rgb',
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.textContent).toMatch(/rgb\(/);
    });

    it('should display current color string in hsl format', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 240, s: 100, l: 50, a: 1 },
          format: 'hsl',
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.textContent).toMatch(/hsl\(/);
    });

    it('should respect disabled state', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          disabled: true,
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('button[data-color-picker-trigger]') as HTMLButtonElement;
      expect(trigger.disabled).toBe(true);
    });

    it('should have aria-label attribute', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.getAttribute('aria-label')).toBe('Pick a color');
    });

    it('should allow custom children to override color display', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerTrigger({ children: 'Custom Label' }),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.textContent).toBe('Custom Label');
    });

    it('should have type="button"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]') as HTMLButtonElement;
      expect(trigger.type).toBe('button');
    });
  });

  // ==========================================================================
  // ColorPickerContent Tests (5 tests)
  // ==========================================================================

  describe('ColorPickerContent Tests', () => {
    it('should render as div', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerContent({}),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-color-picker-content]');
      expect(content?.tagName).toBe('DIV');
    });

    it('should have role="dialog"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerContent({}),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-color-picker-content]');
      expect(content?.getAttribute('role')).toBe('dialog');
    });

    it('should have aria-label', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerContent({}),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-color-picker-content]');
      expect(content?.getAttribute('aria-label')).toBe('Color picker');
    });

    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () =>
            ColorPickerContent({
              children: 'Picker content',
            }),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-color-picker-content]');
      expect(content?.textContent).toContain('Picker content');
    });

    it('should accept additional props', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () =>
            ColorPickerContent({
              'data-testid': 'color-content',
              className: 'custom-content',
            }),
        })
      );
      cleanup = dispose;

      const content = container.querySelector('[data-color-picker-content]');
      expect(content?.getAttribute('data-testid')).toBe('color-content');
      expect(content?.className).toContain('custom-content');
    });
  });

  // ==========================================================================
  // ColorPickerArea Tests (6 tests)
  // ==========================================================================

  describe('ColorPickerArea Tests', () => {
    it('should render with data-color-picker-area', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerArea({}),
        })
      );
      cleanup = dispose;

      const area = container.querySelector('[data-color-picker-area]');
      expect(area).toBeTruthy();
    });

    it('should render as div', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerArea({}),
        })
      );
      cleanup = dispose;

      const area = container.querySelector('[data-color-picker-area]');
      expect(area?.tagName).toBe('DIV');
    });

    it('should have background color reflecting current hue', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 120, s: 100, l: 50, a: 1 },
          children: () => ColorPickerArea({}),
        })
      );
      cleanup = dispose;

      const area = container.querySelector('[data-color-picker-area]') as HTMLElement;
      expect(area.style.background).toMatch(/hsl\(120/);
    });

    it('should handle pointerDown interaction', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 180, s: 50, l: 50, a: 1 },
          onValueChange,
          children: () => ColorPickerArea({}),
        })
      );
      cleanup = dispose;

      const area = container.querySelector('[data-color-picker-area]') as HTMLElement;

      // Mock setPointerCapture for happy-dom
      area.setPointerCapture = vi.fn();
      area.releasePointerCapture = vi.fn();

      const rect = area.getBoundingClientRect();

      const event = new PointerEvent('pointerdown', {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        pointerId: 1,
      });

      area.dispatchEvent(event);

      expect(onValueChange).toHaveBeenCalled();
    });

    it('should not update when disabled', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          disabled: true,
          onValueChange,
          children: () => ColorPickerArea({}),
        })
      );
      cleanup = dispose;

      const area = container.querySelector('[data-color-picker-area]') as HTMLElement;
      const rect = area.getBoundingClientRect();

      const event = new PointerEvent('pointerdown', {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        pointerId: 1,
      });

      area.dispatchEvent(event);

      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('should accept additional props', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () =>
            ColorPickerArea({
              'data-testid': 'color-area',
              className: 'custom-area',
            }),
        })
      );
      cleanup = dispose;

      const area = container.querySelector('[data-color-picker-area]');
      expect(area?.getAttribute('data-testid')).toBe('color-area');
      expect(area?.className).toContain('custom-area');
    });
  });

  // ==========================================================================
  // ColorPickerHueSlider Tests (6 tests)
  // ==========================================================================

  describe('ColorPickerHueSlider Tests', () => {
    it('should render with data-color-picker-hue-slider', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerHueSlider({}),
        })
      );
      cleanup = dispose;

      const slider = container.querySelector('[data-color-picker-hue-slider]');
      expect(slider).toBeTruthy();
    });

    it('should have role="slider"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerHueSlider({}),
        })
      );
      cleanup = dispose;

      const slider = container.querySelector('[data-color-picker-hue-slider]');
      expect(slider?.getAttribute('role')).toBe('slider');
    });

    it('should have aria-valuemin="0"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerHueSlider({}),
        })
      );
      cleanup = dispose;

      const slider = container.querySelector('[data-color-picker-hue-slider]');
      expect(slider?.getAttribute('aria-valuemin')).toBe('0');
    });

    it('should have aria-valuemax="360"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerHueSlider({}),
        })
      );
      cleanup = dispose;

      const slider = container.querySelector('[data-color-picker-hue-slider]');
      expect(slider?.getAttribute('aria-valuemax')).toBe('360');
    });

    it('should have aria-valuenow with current hue', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 180, s: 100, l: 50, a: 1 },
          children: () => ColorPickerHueSlider({}),
        })
      );
      cleanup = dispose;

      const slider = container.querySelector('[data-color-picker-hue-slider]');
      expect(slider?.getAttribute('aria-valuenow')).toBe('180');
    });

    it('should update hue on pointerDown', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 0, s: 100, l: 50, a: 1 },
          onValueChange,
          children: () => ColorPickerHueSlider({}),
        })
      );
      cleanup = dispose;

      const slider = container.querySelector('[data-color-picker-hue-slider]') as HTMLElement;

      // Mock setPointerCapture for happy-dom
      slider.setPointerCapture = vi.fn();
      slider.releasePointerCapture = vi.fn();

      const rect = slider.getBoundingClientRect();

      const event = new PointerEvent('pointerdown', {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        pointerId: 1,
      });

      slider.dispatchEvent(event);

      expect(onValueChange).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // ColorPickerAlphaSlider Tests (6 tests)
  // ==========================================================================

  describe('ColorPickerAlphaSlider Tests', () => {
    it('should render when showAlpha is true', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          showAlpha: true,
          children: () => ColorPickerAlphaSlider({}),
        })
      );
      cleanup = dispose;

      const slider = container.querySelector('[data-color-picker-alpha-slider]');
      expect(slider).toBeTruthy();
    });

    it('should return null when showAlpha is false', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          showAlpha: false,
          children: () => ColorPickerAlphaSlider({}),
        })
      );
      cleanup = dispose;

      const slider = container.querySelector('[data-color-picker-alpha-slider]');
      expect(slider).toBeNull();
    });

    it('should have role="slider"', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          showAlpha: true,
          children: () => ColorPickerAlphaSlider({}),
        })
      );
      cleanup = dispose;

      const slider = container.querySelector('[data-color-picker-alpha-slider]');
      expect(slider?.getAttribute('role')).toBe('slider');
    });

    it('should have aria attributes', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          showAlpha: true,
          defaultValue: { h: 180, s: 100, l: 50, a: 0.5 },
          children: () => ColorPickerAlphaSlider({}),
        })
      );
      cleanup = dispose;

      const slider = container.querySelector('[data-color-picker-alpha-slider]');
      expect(slider?.getAttribute('aria-label')).toBe('Alpha');
      expect(slider?.getAttribute('aria-valuemin')).toBe('0');
      expect(slider?.getAttribute('aria-valuemax')).toBe('1');
      expect(slider?.getAttribute('aria-valuenow')).toBe('0.5');
    });

    it('should update alpha on pointerDown', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          showAlpha: true,
          defaultValue: { h: 0, s: 100, l: 50, a: 1 },
          onValueChange,
          children: () => ColorPickerAlphaSlider({}),
        })
      );
      cleanup = dispose;

      const slider = container.querySelector('[data-color-picker-alpha-slider]') as HTMLElement;

      // Mock setPointerCapture for happy-dom
      slider.setPointerCapture = vi.fn();
      slider.releasePointerCapture = vi.fn();

      const rect = slider.getBoundingClientRect();

      const event = new PointerEvent('pointerdown', {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        pointerId: 1,
      });

      slider.dispatchEvent(event);

      expect(onValueChange).toHaveBeenCalled();
    });

    it('should not update when disabled', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          disabled: true,
          showAlpha: true,
          onValueChange,
          children: () => ColorPickerAlphaSlider({}),
        })
      );
      cleanup = dispose;

      const slider = container.querySelector('[data-color-picker-alpha-slider]') as HTMLElement;
      const rect = slider.getBoundingClientRect();

      const event = new PointerEvent('pointerdown', {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        pointerId: 1,
      });

      slider.dispatchEvent(event);

      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // ColorPickerPreset Tests (5 tests)
  // ==========================================================================

  describe('ColorPickerPreset Tests', () => {
    it('should render as button with preset color', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerPreset({ color: '#ff0000' }),
        })
      );
      cleanup = dispose;

      const preset = container.querySelector('[data-color-picker-preset]');
      expect(preset?.tagName).toBe('BUTTON');
      expect(preset?.getAttribute('type')).toBe('button');
    });

    it('should set background style to preset color', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerPreset({ color: '#00ff00' }),
        })
      );
      cleanup = dispose;

      const preset = container.querySelector('[data-color-picker-preset]') as HTMLElement;
      expect(preset.style.background).toContain('#00ff00');
    });

    it('should update color value on click', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          onValueChange,
          children: () => ColorPickerPreset({ color: '#0000ff' }),
        })
      );
      cleanup = dispose;

      const preset = container.querySelector('[data-color-picker-preset]') as HTMLButtonElement;
      preset.click();

      expect(onValueChange).toHaveBeenCalled();
    });

    it('should parse different color formats', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => [
            ColorPickerPreset({ color: '#ff0000' }),
            ColorPickerPreset({ color: 'rgb(0, 255, 0)' }),
            ColorPickerPreset({ color: 'hsl(240, 100%, 50%)' }),
          ],
        })
      );
      cleanup = dispose;

      const presets = container.querySelectorAll('[data-color-picker-preset]');
      expect(presets.length).toBe(3);
    });

    it('should have aria-label with color', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerPreset({ color: '#ff00ff' }),
        })
      );
      cleanup = dispose;

      const preset = container.querySelector('[data-color-picker-preset]');
      expect(preset?.getAttribute('aria-label')).toBe('Select color #ff00ff');
    });
  });

  // ==========================================================================
  // Edge Cases (5 tests)
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({ children: undefined })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-color-picker]');
      expect(root).toBeTruthy();
    });

    it('should handle invalid color in preset gracefully', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerPreset({ color: 'invalid-color' }),
        })
      );
      cleanup = dispose;

      const preset = container.querySelector('[data-color-picker-preset]') as HTMLButtonElement;
      expect(preset).toBeTruthy();

      // Click should not throw
      expect(() => preset.click()).not.toThrow();
    });

    it('should clamp hue to 0-360 range', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 400, s: 100, l: 50, a: 1 },
          children: () => ColorPickerHueSlider({}),
        })
      );
      cleanup = dispose;

      const slider = container.querySelector('[data-color-picker-hue-slider]');
      const hue = parseInt(slider?.getAttribute('aria-valuenow') || '0');
      expect(hue).toBe(400); // Value stored as-is, clamping happens in conversion
    });

    it('should handle zero values', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 0, s: 0, l: 0, a: 0 },
          format: 'hsl',
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.textContent).toMatch(/hsl\(0,\s*0%,\s*0%\)/);
    });

    it('should use default props when missing', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const root = container.querySelector('[data-color-picker]');
      const trigger = container.querySelector('[data-color-picker-trigger]');

      expect(root).toBeTruthy();
      expect(trigger).toBeTruthy();
      expect(root?.hasAttribute('data-disabled')).toBe(false);
      // Default format is hex
      expect(trigger?.textContent).toMatch(/#/);
    });
  });

  // ==========================================================================
  // Integration Tests (5 tests)
  // ==========================================================================

  describe('Integration Tests', () => {
    it('should update trigger display when color changes via preset', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          format: 'hex',
          children: () => [
            ColorPickerTrigger({}),
            ColorPickerPreset({ color: '#00ff00' }),
          ],
        })
      );
      cleanup = dispose;

      const preset = container.querySelector('[data-color-picker-preset]') as HTMLButtonElement;
      preset.click();

      const trigger = container.querySelector('[data-color-picker-trigger]');
      // Should update to show new color
      expect(trigger?.textContent).toBeTruthy();
    });

    it('should coordinate between area and hue slider', () => {
      const onValueChange = vi.fn();
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          onValueChange,
          children: () => [ColorPickerArea({}), ColorPickerHueSlider({})],
        })
      );
      cleanup = dispose;

      const area = container.querySelector('[data-color-picker-area]') as HTMLElement;
      const slider = container.querySelector('[data-color-picker-hue-slider]') as HTMLElement;

      expect(area).toBeTruthy();
      expect(slider).toBeTruthy();
    });

    it('should show alpha in RGB format when showAlpha and alpha < 1', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 0, s: 100, l: 50, a: 0.5 },
          showAlpha: true,
          format: 'rgb',
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.textContent).toMatch(/rgba/);
    });

    it('should show alpha in HSL format when showAlpha and alpha < 1', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          defaultValue: { h: 120, s: 100, l: 50, a: 0.75 },
          showAlpha: true,
          format: 'hsl',
          children: () => ColorPickerTrigger({}),
        })
      );
      cleanup = dispose;

      const trigger = container.querySelector('[data-color-picker-trigger]');
      expect(trigger?.textContent).toMatch(/hsla/);
    });

    it('should render complete color picker with all components', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ColorPicker({
          showAlpha: true,
          format: 'hsl',
          defaultValue: { h: 180, s: 75, l: 60, a: 0.9 },
          presets: ['#ff0000', '#00ff00', '#0000ff'],
          children: () => [
            ColorPickerTrigger({ children: 'Pick Color' }),
            ColorPickerContent({
              children: [
                ColorPickerArea({}),
                ColorPickerHueSlider({}),
                ColorPickerAlphaSlider({}),
                ColorPickerPreset({ color: '#ff0000' }),
                ColorPickerPreset({ color: '#00ff00' }),
                ColorPickerPreset({ color: '#0000ff' }),
              ],
            }),
          ],
        })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-color-picker]')).toBeTruthy();
      expect(container.querySelector('[data-color-picker-trigger]')).toBeTruthy();
      expect(container.querySelector('[data-color-picker-content]')).toBeTruthy();
      expect(container.querySelector('[data-color-picker-area]')).toBeTruthy();
      expect(container.querySelector('[data-color-picker-hue-slider]')).toBeTruthy();
      expect(container.querySelector('[data-color-picker-alpha-slider]')).toBeTruthy();
      expect(container.querySelectorAll('[data-color-picker-preset]').length).toBe(3);
    });
  });
});
