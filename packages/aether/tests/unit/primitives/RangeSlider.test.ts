/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import {
  RangeSlider,
  RangeSliderTrack,
  RangeSliderRange,
  RangeSliderThumb,
} from '../../../src/primitives/RangeSlider.js';
import { renderComponent, nextTick } from '../../helpers/test-utils.js';

describe('RangeSlider', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic rendering', () => {
    it('should render range slider root with default props', () => {
      const component = () =>
        RangeSlider({
          children: [
            RangeSliderTrack({
              children: RangeSliderRange({}),
            }),
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[role="group"]');
      expect(root).toBeTruthy();
      expect(root?.getAttribute('data-orientation')).toBe('horizontal');
      expect(root?.getAttribute('aria-label')).toBe('Range slider');
    });

    it('should render range slider track', () => {
      const component = () =>
        RangeSlider({
          children: RangeSliderTrack({
            class: 'track',
            children: RangeSliderRange({}),
          }),
        });

      const { container } = renderComponent(component);

      const track = container.querySelector('.track');
      expect(track).toBeTruthy();
      expect(track?.hasAttribute('data-range-slider-track')).toBe(true);
    });

    it('should render range slider range', () => {
      const component = () =>
        RangeSlider({
          defaultValue: { min: 25, max: 75 },
          children: RangeSliderTrack({
            children: RangeSliderRange({ class: 'range' }),
          }),
        });

      const { container } = renderComponent(component);

      const range = container.querySelector('.range');
      expect(range).toBeTruthy();
      expect(range?.hasAttribute('data-range-slider-range')).toBe(true);
    });

    it('should render two thumbs (min and max)', () => {
      const component = () =>
        RangeSlider({
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMin = container.querySelector('.thumb-min');
      const thumbMax = container.querySelector('.thumb-max');

      expect(thumbMin).toBeTruthy();
      expect(thumbMax).toBeTruthy();
      expect(thumbMin?.getAttribute('role')).toBe('slider');
      expect(thumbMax?.getAttribute('role')).toBe('slider');
      expect(thumbMin?.getAttribute('data-position')).toBe('min');
      expect(thumbMax?.getAttribute('data-position')).toBe('max');
    });
  });

  describe('Default value', () => {
    it('should use defaultValue prop', async () => {
      const component = () =>
        RangeSlider({
          defaultValue: { min: 30, max: 70 },
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      await nextTick();

      const thumbs = container.querySelectorAll('[role="slider"]');
      expect(thumbs[0]?.getAttribute('aria-valuenow')).toBe('30');
      expect(thumbs[1]?.getAttribute('aria-valuenow')).toBe('70');
    });

    it('should default to min and max if no defaultValue provided', () => {
      const component = () =>
        RangeSlider({
          min: 10,
          max: 100,
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');
      expect(thumbs[0]?.getAttribute('aria-valuenow')).toBe('10');
      expect(thumbs[1]?.getAttribute('aria-valuenow')).toBe('100');
    });
  });

  describe('Controlled mode', () => {
    it('should use controlled value signal', () => {
      const value = signal({ min: 25, max: 75 });

      const component = () =>
        RangeSlider({
          value: value,
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');
      expect(thumbs[0]?.getAttribute('aria-valuenow')).toBe('25');
      expect(thumbs[1]?.getAttribute('aria-valuenow')).toBe('75');

      // Update signal
      value.set({ min: 40, max: 80 });

      expect(thumbs[0]?.getAttribute('aria-valuenow')).toBe('40');
      expect(thumbs[1]?.getAttribute('aria-valuenow')).toBe('80');
    });

    it('should call onValueChange callback during interaction', () => {
      const onValueChange = vi.fn();

      const component = () =>
        RangeSlider({
          defaultValue: { min: 30, max: 70 },
          onValueChange,
          children: [RangeSliderThumb({ position: 'min' }), RangeSliderThumb({ position: 'max' })],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');
      const thumbMin = thumbs[0] as HTMLElement;

      // Simulate arrow key press
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      thumbMin.dispatchEvent(event);

      expect(onValueChange).toHaveBeenCalledWith({ min: 31, max: 70 });
    });
  });

  describe('Min, max, and step props', () => {
    it('should use default min (0) and max (100)', () => {
      const component = () =>
        RangeSlider({
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');
      expect(thumbs[0]?.getAttribute('aria-valuemin')).toBe('0');
      expect(thumbs[0]?.getAttribute('aria-valuemax')).toBe('100');
      expect(thumbs[1]?.getAttribute('aria-valuemin')).toBe('0');
      expect(thumbs[1]?.getAttribute('aria-valuemax')).toBe('100');
    });

    it('should use custom min and max', () => {
      const component = () =>
        RangeSlider({
          min: 10,
          max: 200,
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');
      expect(thumbs[0]?.getAttribute('aria-valuemin')).toBe('10');
      expect(thumbs[0]?.getAttribute('aria-valuemax')).toBe('200');
    });

    it('should respect step value', () => {
      const component = () =>
        RangeSlider({
          min: 0,
          max: 100,
          step: 5,
          defaultValue: { min: 23, max: 77 },
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');

      // Values should be rounded to nearest step
      expect(thumbs[0]?.getAttribute('aria-valuenow')).toBe('25');
      expect(thumbs[1]?.getAttribute('aria-valuenow')).toBe('75');
    });

    it('should increment by step on arrow key', () => {
      const component = () =>
        RangeSlider({
          min: 0,
          max: 100,
          step: 10,
          defaultValue: { min: 30, max: 70 },
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');
      const thumbMin = thumbs[0] as HTMLElement;

      // Press arrow right
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      thumbMin.dispatchEvent(event);

      expect(thumbMin?.getAttribute('aria-valuenow')).toBe('40');
    });
  });

  describe('Two thumbs interaction', () => {
    it('should move thumbs independently', () => {
      const component = () =>
        RangeSlider({
          defaultValue: { min: 30, max: 70 },
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMin = container.querySelector('.thumb-min') as HTMLElement;
      const thumbMax = container.querySelector('.thumb-max') as HTMLElement;

      // Move min thumb right
      const eventMin = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      thumbMin.dispatchEvent(eventMin);

      expect(thumbMin.getAttribute('aria-valuenow')).toBe('31');
      expect(thumbMax.getAttribute('aria-valuenow')).toBe('70');

      // Move max thumb left
      const eventMax = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
      thumbMax.dispatchEvent(eventMax);

      expect(thumbMin.getAttribute('aria-valuenow')).toBe('31');
      expect(thumbMax.getAttribute('aria-valuenow')).toBe('69');
    });

    it('should prevent min thumb from exceeding max thumb', () => {
      const component = () =>
        RangeSlider({
          min: 0,
          max: 100,
          defaultValue: { min: 40, max: 45 },
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMin = container.querySelector('.thumb-min') as HTMLElement;
      const thumbMax = container.querySelector('.thumb-max') as HTMLElement;

      // Try to move min thumb beyond max thumb
      for (let i = 0; i < 10; i++) {
        const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
        thumbMin.dispatchEvent(event);
      }

      // Min thumb should be clamped to max thumb value
      expect(Number(thumbMin.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(
        Number(thumbMax.getAttribute('aria-valuenow'))
      );
    });

    it('should prevent max thumb from going below min thumb', () => {
      const component = () =>
        RangeSlider({
          min: 0,
          max: 100,
          defaultValue: { min: 55, max: 60 },
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMin = container.querySelector('.thumb-min') as HTMLElement;
      const thumbMax = container.querySelector('.thumb-max') as HTMLElement;

      // Try to move max thumb below min thumb
      for (let i = 0; i < 10; i++) {
        const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
        thumbMax.dispatchEvent(event);
      }

      // Max thumb should be clamped to min thumb value
      expect(Number(thumbMax.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(
        Number(thumbMin.getAttribute('aria-valuenow'))
      );
    });
  });

  describe('Min distance between thumbs', () => {
    it('should respect minDistance prop', () => {
      const component = () =>
        RangeSlider({
          min: 0,
          max: 100,
          defaultValue: { min: 40, max: 60 },
          minDistance: 10,
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMin = container.querySelector('.thumb-min') as HTMLElement;
      const thumbMax = container.querySelector('.thumb-max') as HTMLElement;

      // Try to move min thumb close to max thumb
      for (let i = 0; i < 20; i++) {
        const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
        thumbMin.dispatchEvent(event);
      }

      const minValue = Number(thumbMin.getAttribute('aria-valuenow'));
      const maxValue = Number(thumbMax.getAttribute('aria-valuenow'));

      // Distance should be at least 10
      expect(maxValue - minValue).toBeGreaterThanOrEqual(10);
    });

    it('should enforce minDistance when moving max thumb', () => {
      const component = () =>
        RangeSlider({
          min: 0,
          max: 100,
          defaultValue: { min: 40, max: 60 },
          minDistance: 15,
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMin = container.querySelector('.thumb-min') as HTMLElement;
      const thumbMax = container.querySelector('.thumb-max') as HTMLElement;

      // Try to move max thumb close to min thumb
      for (let i = 0; i < 20; i++) {
        const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
        thumbMax.dispatchEvent(event);
      }

      const minValue = Number(thumbMin.getAttribute('aria-valuenow'));
      const maxValue = Number(thumbMax.getAttribute('aria-valuenow'));

      // Distance should be at least 15
      expect(maxValue - minValue).toBeGreaterThanOrEqual(15);
    });
  });

  describe('Range visualization', () => {
    it('should render range between thumbs', () => {
      const component = () =>
        RangeSlider({
          min: 0,
          max: 100,
          defaultValue: { min: 20, max: 80 },
          children: RangeSliderTrack({
            children: RangeSliderRange({ class: 'range' }),
          }),
        });

      const { container } = renderComponent(component);

      const range = container.querySelector('.range') as HTMLElement;

      expect(range.style.left).toBe('20%');
      expect(range.style.width).toBe('60%'); // 80 - 20 = 60
    });

    it('should update range when thumbs move', () => {
      const value = signal({ min: 30, max: 70 });

      const component = () =>
        RangeSlider({
          value: value,
          children: RangeSliderTrack({
            children: RangeSliderRange({ class: 'range' }),
          }),
        });

      const { container } = renderComponent(component);

      const range = container.querySelector('.range') as HTMLElement;
      expect(range.style.left).toBe('30%');
      expect(range.style.width).toBe('40%');

      // Update values
      value.set({ min: 10, max: 90 });

      expect(range.style.left).toBe('10%');
      expect(range.style.width).toBe('80%');
    });

    it('should position range correctly for vertical orientation', () => {
      const component = () =>
        RangeSlider({
          orientation: 'vertical',
          defaultValue: { min: 25, max: 75 },
          children: RangeSliderTrack({
            children: RangeSliderRange({ class: 'range' }),
          }),
        });

      const { container } = renderComponent(component);

      const range = container.querySelector('.range') as HTMLElement;

      expect(range.style.bottom).toBe('25%');
      expect(range.style.height).toBe('50%'); // 75 - 25 = 50
    });

    it('should handle zero width range', () => {
      const component = () =>
        RangeSlider({
          defaultValue: { min: 50, max: 50 },
          children: RangeSliderTrack({
            children: RangeSliderRange({ class: 'range' }),
          }),
        });

      const { container } = renderComponent(component);

      const range = container.querySelector('.range') as HTMLElement;

      expect(range.style.left).toBe('50%');
      expect(range.style.width).toBe('0%');
    });
  });

  describe('Orientation', () => {
    it('should default to horizontal orientation', () => {
      const component = () =>
        RangeSlider({
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[role="group"]');
      const thumbs = container.querySelectorAll('[role="slider"]');

      expect(root?.getAttribute('data-orientation')).toBe('horizontal');
      expect(thumbs[0]?.getAttribute('aria-orientation')).toBe('horizontal');
      expect(thumbs[1]?.getAttribute('aria-orientation')).toBe('horizontal');
    });

    it('should support vertical orientation', () => {
      const component = () =>
        RangeSlider({
          orientation: 'vertical',
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[role="group"]');
      const thumbs = container.querySelectorAll('[role="slider"]');

      expect(root?.getAttribute('data-orientation')).toBe('vertical');
      expect(thumbs[0]?.getAttribute('aria-orientation')).toBe('vertical');
      expect(thumbs[1]?.getAttribute('aria-orientation')).toBe('vertical');
    });
  });

  describe('Disabled state', () => {
    it('should render disabled state', () => {
      const component = () =>
        RangeSlider({
          disabled: true,
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[role="group"]');
      const thumbs = container.querySelectorAll('[role="slider"]');

      expect(root?.getAttribute('data-disabled')).toBe('');
      expect(thumbs[0]?.getAttribute('aria-disabled')).toBe('true');
      expect(thumbs[1]?.getAttribute('aria-disabled')).toBe('true');
      expect(thumbs[0]?.getAttribute('tabindex')).toBe('-1');
      expect(thumbs[1]?.getAttribute('tabindex')).toBe('-1');
    });

    it('should not respond to keyboard when disabled', () => {
      const onValueChange = vi.fn();

      const component = () =>
        RangeSlider({
          disabled: true,
          defaultValue: { min: 30, max: 70 },
          onValueChange,
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');
      const thumbMin = thumbs[0] as HTMLElement;

      // Try to press arrow key
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      thumbMin.dispatchEvent(event);

      expect(onValueChange).not.toHaveBeenCalled();
      expect(thumbMin?.getAttribute('aria-valuenow')).toBe('30');
    });

    it('should not respond to pointer events when disabled', () => {
      const onValueChange = vi.fn();

      const component = () =>
        RangeSlider({
          disabled: true,
          defaultValue: { min: 30, max: 70 },
          onValueChange,
          children: [RangeSliderThumb({ position: 'min' }), RangeSliderThumb({ position: 'max' })],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');
      const thumbMin = thumbs[0] as HTMLElement;

      // Try to initiate drag
      const event = new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 });
      thumbMin.dispatchEvent(event);

      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  describe('Keyboard navigation', () => {
    it('should increment min thumb value on ArrowRight', () => {
      const component = () =>
        RangeSlider({
          defaultValue: { min: 30, max: 70 },
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMin = container.querySelector('.thumb-min') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      thumbMin.dispatchEvent(event);

      expect(thumbMin?.getAttribute('aria-valuenow')).toBe('31');
    });

    it('should decrement min thumb value on ArrowLeft', () => {
      const component = () =>
        RangeSlider({
          defaultValue: { min: 30, max: 70 },
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMin = container.querySelector('.thumb-min') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
      thumbMin.dispatchEvent(event);

      expect(thumbMin?.getAttribute('aria-valuenow')).toBe('29');
    });

    it('should increment max thumb value on ArrowUp', () => {
      const component = () =>
        RangeSlider({
          defaultValue: { min: 30, max: 70 },
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMax = container.querySelector('.thumb-max') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
      thumbMax.dispatchEvent(event);

      expect(thumbMax?.getAttribute('aria-valuenow')).toBe('71');
    });

    it('should decrement max thumb value on ArrowDown', () => {
      const component = () =>
        RangeSlider({
          defaultValue: { min: 30, max: 70 },
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMax = container.querySelector('.thumb-max') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
      thumbMax.dispatchEvent(event);

      expect(thumbMax?.getAttribute('aria-valuenow')).toBe('69');
    });

    it('should jump by 10 steps on PageUp', () => {
      const component = () =>
        RangeSlider({
          defaultValue: { min: 30, max: 70 },
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMin = container.querySelector('.thumb-min') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true });
      thumbMin.dispatchEvent(event);

      expect(thumbMin?.getAttribute('aria-valuenow')).toBe('40');
    });

    it('should jump by 10 steps on PageDown', () => {
      const component = () =>
        RangeSlider({
          defaultValue: { min: 30, max: 70 },
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMax = container.querySelector('.thumb-max') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true });
      thumbMax.dispatchEvent(event);

      expect(thumbMax?.getAttribute('aria-valuenow')).toBe('60');
    });

    it('should jump min thumb to minimum on Home', () => {
      const component = () =>
        RangeSlider({
          min: 10,
          max: 100,
          defaultValue: { min: 30, max: 70 },
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMin = container.querySelector('.thumb-min') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'Home', bubbles: true });
      thumbMin.dispatchEvent(event);

      expect(thumbMin?.getAttribute('aria-valuenow')).toBe('10');
    });

    it('should jump max thumb to maximum on End', () => {
      const component = () =>
        RangeSlider({
          min: 0,
          max: 100,
          defaultValue: { min: 30, max: 70 },
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMax = container.querySelector('.thumb-max') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'End', bubbles: true });
      thumbMax.dispatchEvent(event);

      expect(thumbMax?.getAttribute('aria-valuenow')).toBe('100');
    });

    it('should respect Home key with minDistance for max thumb', () => {
      const component = () =>
        RangeSlider({
          min: 0,
          max: 100,
          minDistance: 10,
          defaultValue: { min: 30, max: 70 },
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMax = container.querySelector('.thumb-max') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'Home', bubbles: true });
      thumbMax.dispatchEvent(event);

      // Max thumb Home should go to min + minDistance (30 + 10 = 40)
      expect(thumbMax?.getAttribute('aria-valuenow')).toBe('40');
    });

    it('should respect End key with minDistance for min thumb', () => {
      const component = () =>
        RangeSlider({
          min: 0,
          max: 100,
          minDistance: 10,
          defaultValue: { min: 30, max: 70 },
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMin = container.querySelector('.thumb-min') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'End', bubbles: true });
      thumbMin.dispatchEvent(event);

      // Min thumb End should go to max - minDistance (70 - 10 = 60)
      expect(thumbMin?.getAttribute('aria-valuenow')).toBe('60');
    });

    it('should prevent default for handled keys', () => {
      const component = () =>
        RangeSlider({
          defaultValue: { min: 30, max: 70 },
          children: [RangeSliderThumb({ position: 'min' }), RangeSliderThumb({ position: 'max' })],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');
      const thumbMin = thumbs[0] as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      const spy = vi.spyOn(event, 'preventDefault');
      thumbMin.dispatchEvent(event);

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('Thumb positioning', () => {
    it('should position thumbs at correct percentages (horizontal)', () => {
      const component = () =>
        RangeSlider({
          min: 0,
          max: 100,
          defaultValue: { min: 25, max: 75 },
          orientation: 'horizontal',
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMin = container.querySelector('.thumb-min') as HTMLElement;
      const thumbMax = container.querySelector('.thumb-max') as HTMLElement;

      expect(thumbMin.style.left).toBe('25%');
      expect(thumbMax.style.left).toBe('75%');
    });

    it('should position thumbs at correct percentages (vertical)', () => {
      const component = () =>
        RangeSlider({
          min: 0,
          max: 100,
          defaultValue: { min: 25, max: 75 },
          orientation: 'vertical',
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMin = container.querySelector('.thumb-min') as HTMLElement;
      const thumbMax = container.querySelector('.thumb-max') as HTMLElement;

      expect(thumbMin.style.bottom).toBe('25%');
      expect(thumbMax.style.bottom).toBe('75%');
    });

    it('should update thumb positions on value change', () => {
      const value = signal({ min: 20, max: 80 });

      const component = () =>
        RangeSlider({
          value: value,
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMin = container.querySelector('.thumb-min') as HTMLElement;
      const thumbMax = container.querySelector('.thumb-max') as HTMLElement;

      expect(thumbMin.style.left).toBe('20%');
      expect(thumbMax.style.left).toBe('80%');

      value.set({ min: 40, max: 60 });

      expect(thumbMin.style.left).toBe('40%');
      expect(thumbMax.style.left).toBe('60%');
    });
  });

  describe('Accessibility', () => {
    it('should have role="slider" on both thumbs', () => {
      const component = () =>
        RangeSlider({
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');
      expect(thumbs.length).toBe(2);
    });

    it('should have distinct aria-label for each thumb', () => {
      const component = () =>
        RangeSlider({
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMin = container.querySelector('.thumb-min');
      const thumbMax = container.querySelector('.thumb-max');

      expect(thumbMin?.getAttribute('aria-label')).toBe('Minimum value');
      expect(thumbMax?.getAttribute('aria-label')).toBe('Maximum value');
    });

    it('should have aria-valuemin and aria-valuemax on both thumbs', () => {
      const component = () =>
        RangeSlider({
          min: 10,
          max: 200,
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');

      expect(thumbs[0]?.getAttribute('aria-valuemin')).toBe('10');
      expect(thumbs[0]?.getAttribute('aria-valuemax')).toBe('200');
      expect(thumbs[1]?.getAttribute('aria-valuemin')).toBe('10');
      expect(thumbs[1]?.getAttribute('aria-valuemax')).toBe('200');
    });

    it('should have aria-valuenow for each thumb', () => {
      const component = () =>
        RangeSlider({
          defaultValue: { min: 35, max: 65 },
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');
      expect(thumbs[0]?.getAttribute('aria-valuenow')).toBe('35');
      expect(thumbs[1]?.getAttribute('aria-valuenow')).toBe('65');
    });

    it('should update aria-valuenow on value change', () => {
      const value = signal({ min: 30, max: 70 });

      const component = () =>
        RangeSlider({
          value: value,
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');
      expect(thumbs[0]?.getAttribute('aria-valuenow')).toBe('30');
      expect(thumbs[1]?.getAttribute('aria-valuenow')).toBe('70');

      value.set({ min: 20, max: 80 });

      expect(thumbs[0]?.getAttribute('aria-valuenow')).toBe('20');
      expect(thumbs[1]?.getAttribute('aria-valuenow')).toBe('80');
    });

    it('should have aria-orientation on both thumbs', () => {
      const component = () =>
        RangeSlider({
          orientation: 'vertical',
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');
      expect(thumbs[0]?.getAttribute('aria-orientation')).toBe('vertical');
      expect(thumbs[1]?.getAttribute('aria-orientation')).toBe('vertical');
    });

    it('should have aria-disabled when disabled', () => {
      const component = () =>
        RangeSlider({
          disabled: true,
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');
      expect(thumbs[0]?.getAttribute('aria-disabled')).toBe('true');
      expect(thumbs[1]?.getAttribute('aria-disabled')).toBe('true');
    });

    it('should be focusable (tabindex 0) when not disabled', () => {
      const component = () =>
        RangeSlider({
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');
      expect(thumbs[0]?.getAttribute('tabindex')).toBe('0');
      expect(thumbs[1]?.getAttribute('tabindex')).toBe('0');
    });

    it('should not be focusable (tabindex -1) when disabled', () => {
      const component = () =>
        RangeSlider({
          disabled: true,
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');
      expect(thumbs[0]?.getAttribute('tabindex')).toBe('-1');
      expect(thumbs[1]?.getAttribute('tabindex')).toBe('-1');
    });
  });

  describe('Edge cases', () => {
    it('should handle min equals max', () => {
      const component = () =>
        RangeSlider({
          min: 50,
          max: 50,
          defaultValue: { min: 50, max: 50 },
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMin = container.querySelector('.thumb-min') as HTMLElement;
      const thumbMax = container.querySelector('.thumb-max') as HTMLElement;

      expect(thumbMin?.getAttribute('aria-valuenow')).toBe('50');
      expect(thumbMax?.getAttribute('aria-valuenow')).toBe('50');

      // Try to increment
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      thumbMin.dispatchEvent(event);

      // Should still be 50
      expect(thumbMin?.getAttribute('aria-valuenow')).toBe('50');
    });

    it('should handle negative ranges', () => {
      const component = () =>
        RangeSlider({
          min: -100,
          max: 100,
          defaultValue: { min: -50, max: 50 },
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');
      expect(thumbs[0]?.getAttribute('aria-valuenow')).toBe('-50');
      expect(thumbs[1]?.getAttribute('aria-valuenow')).toBe('50');
    });

    it('should handle decimal steps', () => {
      const component = () =>
        RangeSlider({
          min: 0,
          max: 1,
          step: 0.1,
          defaultValue: { min: 0.3, max: 0.7 },
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMin = container.querySelector('.thumb-min') as HTMLElement;
      const thumbMax = container.querySelector('.thumb-max') as HTMLElement;

      // Use numerical comparison with tolerance for floating-point precision
      expect(Number(thumbMin?.getAttribute('aria-valuenow'))).toBeCloseTo(0.3, 10);
      expect(Number(thumbMax?.getAttribute('aria-valuenow'))).toBeCloseTo(0.7, 10);

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      thumbMin.dispatchEvent(event);

      expect(Number(thumbMin?.getAttribute('aria-valuenow'))).toBeCloseTo(0.4, 10);
    });

    it('should handle very small step values', () => {
      const component = () =>
        RangeSlider({
          min: 0,
          max: 1,
          step: 0.01,
          defaultValue: { min: 0.25, max: 0.75 },
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMin = container.querySelector('.thumb-min') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      thumbMin.dispatchEvent(event);

      expect(thumbMin?.getAttribute('aria-valuenow')).toBe('0.26');
    });

    it('should round to step correctly', () => {
      const component = () =>
        RangeSlider({
          min: 0,
          max: 100,
          step: 5,
          defaultValue: { min: 23, max: 77 },
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');

      // Values should round to nearest step
      expect(thumbs[0]?.getAttribute('aria-valuenow')).toBe('25');
      expect(thumbs[1]?.getAttribute('aria-valuenow')).toBe('75');
    });

    it('should handle zero range', () => {
      const component = () =>
        RangeSlider({
          min: 0,
          max: 100,
          defaultValue: { min: 50, max: 50 },
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');
      expect(thumbs[0]?.getAttribute('aria-valuenow')).toBe('50');
      expect(thumbs[1]?.getAttribute('aria-valuenow')).toBe('50');
    });

    it('should handle large ranges', () => {
      const component = () =>
        RangeSlider({
          min: 0,
          max: 10000,
          step: 100,
          defaultValue: { min: 2000, max: 8000 },
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMin = container.querySelector('.thumb-min') as HTMLElement;
      expect(thumbMin?.getAttribute('aria-valuenow')).toBe('2000');

      const event = new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true });
      thumbMin.dispatchEvent(event);

      // PageUp should increment by 10 * step = 1000
      expect(thumbMin?.getAttribute('aria-valuenow')).toBe('3000');
    });
  });

  describe('Data attributes', () => {
    it('should have data-range-slider on root', () => {
      const component = () =>
        RangeSlider({
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[role="group"]');
      expect(root?.hasAttribute('data-range-slider')).toBe(true);
    });

    it('should have data-orientation on root', () => {
      const component = () =>
        RangeSlider({
          orientation: 'vertical',
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[role="group"]');
      expect(root?.getAttribute('data-orientation')).toBe('vertical');
    });

    it('should have data-disabled on root when disabled', () => {
      const component = () =>
        RangeSlider({
          disabled: true,
          children: [
            RangeSliderThumb({ position: 'min' }),
            RangeSliderThumb({ position: 'max' }),
          ],
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[role="group"]');
      expect(root?.getAttribute('data-disabled')).toBe('');
    });

    it('should have data-range-slider-track on track', () => {
      const component = () =>
        RangeSlider({
          children: RangeSliderTrack({ class: 'track', children: null }),
        });

      const { container } = renderComponent(component);

      const track = container.querySelector('.track');
      expect(track?.hasAttribute('data-range-slider-track')).toBe(true);
    });

    it('should have data-range-slider-range on range', () => {
      const component = () =>
        RangeSlider({
          children: RangeSliderTrack({
            children: RangeSliderRange({ class: 'range' }),
          }),
        });

      const { container } = renderComponent(component);

      const range = container.querySelector('.range');
      expect(range?.hasAttribute('data-range-slider-range')).toBe(true);
    });

    it('should have data-range-slider-thumb on thumbs', () => {
      const component = () =>
        RangeSlider({
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMin = container.querySelector('.thumb-min');
      const thumbMax = container.querySelector('.thumb-max');

      expect(thumbMin?.hasAttribute('data-range-slider-thumb')).toBe(true);
      expect(thumbMax?.hasAttribute('data-range-slider-thumb')).toBe(true);
    });

    it('should have data-position on thumbs', () => {
      const component = () =>
        RangeSlider({
          children: [
            RangeSliderThumb({ position: 'min', class: 'thumb-min' }),
            RangeSliderThumb({ position: 'max', class: 'thumb-max' }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMin = container.querySelector('.thumb-min');
      const thumbMax = container.querySelector('.thumb-max');

      expect(thumbMin?.getAttribute('data-position')).toBe('min');
      expect(thumbMax?.getAttribute('data-position')).toBe('max');
    });
  });

  describe('Custom props pass-through', () => {
    it('should pass custom props to track', () => {
      const component = () =>
        RangeSlider({
          children: RangeSliderTrack({
            'data-testid': 'track',
            class: 'custom-track',
            children: null,
          }),
        });

      const { container } = renderComponent(component);

      const track = container.querySelector('[data-testid="track"]') as HTMLElement;
      expect(track.className).toBe('custom-track');
    });

    it('should pass custom props to range', () => {
      const component = () =>
        RangeSlider({
          children: RangeSliderTrack({
            children: RangeSliderRange({
              'data-testid': 'range',
              class: 'custom-range',
            }),
          }),
        });

      const { container } = renderComponent(component);

      const range = container.querySelector('[data-testid="range"]') as HTMLElement;
      expect(range.className).toBe('custom-range');
    });

    it('should pass custom props to thumbs', () => {
      const component = () =>
        RangeSlider({
          children: [
            RangeSliderThumb({
              position: 'min',
              'data-testid': 'thumb-min',
              class: 'custom-thumb-min',
            }),
            RangeSliderThumb({
              position: 'max',
              'data-testid': 'thumb-max',
              class: 'custom-thumb-max',
            }),
          ],
        });

      const { container } = renderComponent(component);

      const thumbMin = container.querySelector('[data-testid="thumb-min"]') as HTMLElement;
      const thumbMax = container.querySelector('[data-testid="thumb-max"]') as HTMLElement;

      expect(thumbMin.className).toBe('custom-thumb-min');
      expect(thumbMax.className).toBe('custom-thumb-max');
    });
  });
});
