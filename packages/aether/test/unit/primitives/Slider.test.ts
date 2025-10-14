/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import { Slider, SliderTrack, SliderRange, SliderThumb } from '../../../src/primitives/Slider.js';
import { renderComponent, nextTick } from '../../helpers/test-utils.js';

describe('Slider', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic rendering', () => {
    it('should render slider root with default props', () => {
      const component = () =>
        Slider({
          children: [
            SliderTrack({
              children: SliderRange({}),
            }),
            SliderThumb({}),
          ],
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[role="group"]');
      expect(root).toBeTruthy();
      expect(root?.getAttribute('data-orientation')).toBe('horizontal');
    });

    it('should render slider track', () => {
      const component = () =>
        Slider({
          children: SliderTrack({
            class: 'track',
            children: SliderRange({}),
          }),
        });

      const { container } = renderComponent(component);

      const track = container.querySelector('.track');
      expect(track).toBeTruthy();
      expect(track?.hasAttribute('data-slider-track')).toBe(true);
    });

    it('should render slider range', () => {
      const component = () =>
        Slider({
          defaultValue: 50,
          children: SliderTrack({
            children: SliderRange({ class: 'range' }),
          }),
        });

      const { container } = renderComponent(component);

      const range = container.querySelector('.range');
      expect(range).toBeTruthy();
      expect(range?.hasAttribute('data-slider-range')).toBe(true);
    });

    it('should render slider thumb', () => {
      const component = () =>
        Slider({
          children: SliderThumb({ class: 'thumb' }),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('.thumb');
      expect(thumb).toBeTruthy();
      expect(thumb?.hasAttribute('data-slider-thumb')).toBe(true);
      expect(thumb?.getAttribute('role')).toBe('slider');
    });

    it('should generate unique ID if not provided', () => {
      const component = () =>
        Slider({
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[role="group"]');
      expect(root?.id).toBeTruthy();
      expect(root?.id.length).toBeGreaterThan(0);
    });

    it('should use provided ID', () => {
      const component = () =>
        Slider({
          id: 'custom-slider',
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[role="group"]');
      expect(root?.id).toBe('custom-slider');
    });
  });

  describe('Default value', () => {
    it('should use defaultValue prop', async () => {
      const component = () =>
        Slider({
          defaultValue: 75,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      await nextTick();

      const thumb = container.querySelector('[role="slider"]');
      console.log('Container HTML:', container.innerHTML);
      console.log('Thumb:', thumb?.outerHTML);
      console.log('aria-valuenow:', thumb?.getAttribute('aria-valuenow'));
      expect(thumb?.getAttribute('aria-valuenow')).toBe('75');
    });

    it('should default to min value if no defaultValue provided', () => {
      const component = () =>
        Slider({
          min: 10,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]');
      expect(thumb?.getAttribute('aria-valuenow')).toBe('10');
    });

    it('should support array defaultValue for range slider', () => {
      const component = () =>
        Slider({
          defaultValue: [25, 75],
          children: [SliderThumb({ index: 0 }), SliderThumb({ index: 1 })],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');
      expect(thumbs[0]?.getAttribute('aria-valuenow')).toBe('25');
      expect(thumbs[1]?.getAttribute('aria-valuenow')).toBe('75');
    });
  });

  describe('Controlled mode', () => {
    it('should use controlled value signal', () => {
      const value = signal(60);

      const component = () =>
        Slider({
          value,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]');
      expect(thumb?.getAttribute('aria-valuenow')).toBe('60');

      // Update signal
      value.set(80);

      expect(thumb?.getAttribute('aria-valuenow')).toBe('80');
    });

    it('should call onValueChange callback during interaction', () => {
      const onValueChange = vi.fn();

      const component = () =>
        Slider({
          defaultValue: 50,
          onValueChange,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]') as HTMLElement;

      // Simulate arrow key press
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      thumb.dispatchEvent(event);

      expect(onValueChange).toHaveBeenCalled();
    });

    it('should call onValueCommit callback on release', () => {
      const onValueCommit = vi.fn();

      const component = () =>
        Slider({
          defaultValue: 50,
          onValueCommit,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]') as HTMLElement;

      // Simulate arrow key press (commits immediately)
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      thumb.dispatchEvent(event);

      expect(onValueCommit).toHaveBeenCalled();
    });
  });

  describe('Min, max, and step props', () => {
    it('should use default min (0) and max (100)', () => {
      const component = () =>
        Slider({
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]');
      expect(thumb?.getAttribute('aria-valuemin')).toBe('0');
      expect(thumb?.getAttribute('aria-valuemax')).toBe('100');
    });

    it('should use custom min and max', () => {
      const component = () =>
        Slider({
          min: 10,
          max: 200,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]');
      expect(thumb?.getAttribute('aria-valuemin')).toBe('10');
      expect(thumb?.getAttribute('aria-valuemax')).toBe('200');
    });

    it('should respect step value', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 100,
          step: 5,
          defaultValue: 47,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]') as HTMLElement;

      // Value should be rounded to nearest step (45)
      expect(thumb?.getAttribute('aria-valuenow')).toBe('45');
    });

    it('should increment by step on arrow key', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 100,
          step: 10,
          defaultValue: 50,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]') as HTMLElement;

      // Press arrow right
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      thumb.dispatchEvent(event);

      expect(thumb?.getAttribute('aria-valuenow')).toBe('60');
    });

    it('should clamp value to min', () => {
      const component = () =>
        Slider({
          min: 20,
          max: 100,
          defaultValue: 10,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]');
      expect(thumb?.getAttribute('aria-valuenow')).toBe('20');
    });

    it('should clamp value to max', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 100,
          defaultValue: 150,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]');
      expect(thumb?.getAttribute('aria-valuenow')).toBe('100');
    });
  });

  describe('Orientation', () => {
    it('should default to horizontal orientation', () => {
      const component = () =>
        Slider({
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[role="group"]');
      const thumb = container.querySelector('[role="slider"]');

      expect(root?.getAttribute('data-orientation')).toBe('horizontal');
      expect(thumb?.getAttribute('aria-orientation')).toBe('horizontal');
    });

    it('should support vertical orientation', () => {
      const component = () =>
        Slider({
          orientation: 'vertical',
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[role="group"]');
      const thumb = container.querySelector('[role="slider"]');

      expect(root?.getAttribute('data-orientation')).toBe('vertical');
      expect(thumb?.getAttribute('aria-orientation')).toBe('vertical');
    });

    it('should position range correctly for horizontal slider', () => {
      const component = () =>
        Slider({
          orientation: 'horizontal',
          defaultValue: 50,
          children: SliderTrack({
            children: SliderRange({ class: 'range' }),
          }),
        });

      const { container } = renderComponent(component);

      const range = container.querySelector('.range') as HTMLElement;
      const style = range.style;

      expect(style.left).toBe('0%');
      expect(style.width).toBe('50%');
    });

    it('should position range correctly for vertical slider', () => {
      const component = () =>
        Slider({
          orientation: 'vertical',
          defaultValue: 50,
          children: SliderTrack({
            children: SliderRange({ class: 'range' }),
          }),
        });

      const { container } = renderComponent(component);

      const range = container.querySelector('.range') as HTMLElement;
      const style = range.style;

      expect(style.bottom).toBe('0%');
      expect(style.height).toBe('50%');
    });
  });

  describe('Disabled state', () => {
    it('should render disabled state', () => {
      const component = () =>
        Slider({
          disabled: true,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[role="group"]');
      const thumb = container.querySelector('[role="slider"]');

      expect(root?.getAttribute('data-disabled')).toBe('');
      expect(thumb?.getAttribute('data-disabled')).toBe('');
      expect(thumb?.getAttribute('aria-disabled')).toBe('true');
      expect(thumb?.getAttribute('tabindex')).toBe('-1');
    });

    it('should not respond to keyboard when disabled', () => {
      const onValueChange = vi.fn();

      const component = () =>
        Slider({
          disabled: true,
          defaultValue: 50,
          onValueChange,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]') as HTMLElement;

      // Try to press arrow key
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      thumb.dispatchEvent(event);

      expect(onValueChange).not.toHaveBeenCalled();
      expect(thumb?.getAttribute('aria-valuenow')).toBe('50');
    });

    it('should not respond to pointer events when disabled', () => {
      const onValueChange = vi.fn();

      const component = () =>
        Slider({
          disabled: true,
          defaultValue: 50,
          onValueChange,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]') as HTMLElement;

      // Try to initiate drag
      const event = new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 });
      thumb.dispatchEvent(event);

      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  describe('Keyboard navigation', () => {
    it('should increment value on ArrowRight', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 100,
          step: 1,
          defaultValue: 50,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      thumb.dispatchEvent(event);

      expect(thumb?.getAttribute('aria-valuenow')).toBe('51');
    });

    it('should increment value on ArrowUp', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 100,
          step: 1,
          defaultValue: 50,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
      thumb.dispatchEvent(event);

      expect(thumb?.getAttribute('aria-valuenow')).toBe('51');
    });

    it('should decrement value on ArrowLeft', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 100,
          step: 1,
          defaultValue: 50,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
      thumb.dispatchEvent(event);

      expect(thumb?.getAttribute('aria-valuenow')).toBe('49');
    });

    it('should decrement value on ArrowDown', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 100,
          step: 1,
          defaultValue: 50,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
      thumb.dispatchEvent(event);

      expect(thumb?.getAttribute('aria-valuenow')).toBe('49');
    });

    it('should jump by 10 steps on PageUp', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 100,
          step: 1,
          defaultValue: 50,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true });
      thumb.dispatchEvent(event);

      expect(thumb?.getAttribute('aria-valuenow')).toBe('60');
    });

    it('should jump by 10 steps on PageDown', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 100,
          step: 1,
          defaultValue: 50,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true });
      thumb.dispatchEvent(event);

      expect(thumb?.getAttribute('aria-valuenow')).toBe('40');
    });

    it('should jump to minimum on Home', () => {
      const component = () =>
        Slider({
          min: 20,
          max: 100,
          defaultValue: 50,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'Home', bubbles: true });
      thumb.dispatchEvent(event);

      expect(thumb?.getAttribute('aria-valuenow')).toBe('20');
    });

    it('should jump to maximum on End', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 100,
          defaultValue: 50,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'End', bubbles: true });
      thumb.dispatchEvent(event);

      expect(thumb?.getAttribute('aria-valuenow')).toBe('100');
    });

    it('should not exceed max on increment', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 100,
          step: 1,
          defaultValue: 100,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      thumb.dispatchEvent(event);

      expect(thumb?.getAttribute('aria-valuenow')).toBe('100');
    });

    it('should not go below min on decrement', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 100,
          step: 1,
          defaultValue: 0,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
      thumb.dispatchEvent(event);

      expect(thumb?.getAttribute('aria-valuenow')).toBe('0');
    });

    it('should prevent default for handled keys', () => {
      const component = () =>
        Slider({
          defaultValue: 50,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      const spy = vi.spyOn(event, 'preventDefault');
      thumb.dispatchEvent(event);

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('Mouse/Pointer interaction', () => {
    it('should update value on track click (horizontal)', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 100,
          orientation: 'horizontal',
          defaultValue: 0,
          children: [SliderTrack({ class: 'track', children: SliderRange({}) }), SliderThumb({})],
        });

      const { container } = renderComponent(component);

      const track = container.querySelector('.track') as HTMLElement;
      const thumb = container.querySelector('[role="slider"]') as HTMLElement;

      // Mock getBoundingClientRect
      vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        right: 100,
        width: 100,
        top: 0,
        bottom: 20,
        height: 20,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Click at 50% position
      const event = new MouseEvent('click', {
        bubbles: true,
        clientX: 50,
        clientY: 10,
      });
      track.dispatchEvent(event);

      expect(thumb?.getAttribute('aria-valuenow')).toBe('50');
    });

    it('should not update on track click when disabled', () => {
      const component = () =>
        Slider({
          disabled: true,
          defaultValue: 50,
          children: [SliderTrack({ class: 'track', children: SliderRange({}) }), SliderThumb({})],
        });

      const { container } = renderComponent(component);

      const track = container.querySelector('.track') as HTMLElement;
      const thumb = container.querySelector('[role="slider"]') as HTMLElement;

      // Mock getBoundingClientRect
      vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        right: 100,
        width: 100,
        top: 0,
        bottom: 20,
        height: 20,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      const event = new MouseEvent('click', {
        bubbles: true,
        clientX: 80,
        clientY: 10,
      });
      track.dispatchEvent(event);

      expect(thumb?.getAttribute('aria-valuenow')).toBe('50');
    });
  });

  describe('Range slider (multiple thumbs)', () => {
    it('should support multiple thumbs', () => {
      const component = () =>
        Slider({
          defaultValue: [25, 75],
          children: [SliderThumb({ index: 0, class: 'thumb-0' }), SliderThumb({ index: 1, class: 'thumb-1' })],
        });

      const { container } = renderComponent(component);

      const thumbs = container.querySelectorAll('[role="slider"]');
      expect(thumbs.length).toBe(2);
      expect(thumbs[0]?.getAttribute('aria-valuenow')).toBe('25');
      expect(thumbs[1]?.getAttribute('aria-valuenow')).toBe('75');
    });

    it('should position thumbs correctly', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 100,
          defaultValue: [30, 70],
          children: [SliderThumb({ index: 0, class: 'thumb-0' }), SliderThumb({ index: 1, class: 'thumb-1' })],
        });

      const { container } = renderComponent(component);

      const thumb0 = container.querySelector('.thumb-0') as HTMLElement;
      const thumb1 = container.querySelector('.thumb-1') as HTMLElement;

      expect(thumb0.style.left).toBe('30%');
      expect(thumb1.style.left).toBe('70%');
    });

    it('should show range between thumbs', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 100,
          defaultValue: [20, 80],
          children: [
            SliderTrack({
              children: SliderRange({ class: 'range' }),
            }),
            SliderThumb({ index: 0 }),
            SliderThumb({ index: 1 }),
          ],
        });

      const { container } = renderComponent(component);

      const range = container.querySelector('.range') as HTMLElement;

      expect(range.style.left).toBe('20%');
      expect(range.style.width).toBe('60%'); // 80 - 20 = 60
    });

    it('should move individual thumbs independently', () => {
      const component = () =>
        Slider({
          defaultValue: [30, 70],
          children: [SliderThumb({ index: 0, class: 'thumb-0' }), SliderThumb({ index: 1, class: 'thumb-1' })],
        });

      const { container } = renderComponent(component);

      const thumb0 = container.querySelector('.thumb-0') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      thumb0.dispatchEvent(event);

      expect(thumb0?.getAttribute('aria-valuenow')).toBe('31');

      const thumb1 = container.querySelector('.thumb-1') as HTMLElement;
      expect(thumb1?.getAttribute('aria-valuenow')).toBe('70');
    });
  });

  describe('Range visual representation', () => {
    it('should render range from 0 to value for single thumb', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 100,
          defaultValue: 60,
          children: SliderTrack({
            children: SliderRange({ class: 'range' }),
          }),
        });

      const { container } = renderComponent(component);

      const range = container.querySelector('.range') as HTMLElement;

      expect(range.style.left).toBe('0%');
      expect(range.style.width).toBe('60%');
    });

    it('should update range when value changes', () => {
      const value = signal(40);

      const component = () =>
        Slider({
          value,
          children: SliderTrack({
            children: SliderRange({ class: 'range' }),
          }),
        });

      const { container } = renderComponent(component);

      const range = container.querySelector('.range') as HTMLElement;
      expect(range.style.width).toBe('40%');

      value.set(70);

      expect(range.style.width).toBe('70%');
    });

    it('should calculate percentage correctly with custom min/max', () => {
      const component = () =>
        Slider({
          min: 50,
          max: 150,
          defaultValue: 100,
          children: SliderTrack({
            children: SliderRange({ class: 'range' }),
          }),
        });

      const { container } = renderComponent(component);

      const range = container.querySelector('.range') as HTMLElement;

      // (100 - 50) / (150 - 50) = 50 / 100 = 50%
      expect(range.style.width).toBe('50%');
    });
  });

  describe('Accessibility', () => {
    it('should have role="slider" on thumb', () => {
      const component = () =>
        Slider({
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]');
      expect(thumb).toBeTruthy();
    });

    it('should have aria-valuemin', () => {
      const component = () =>
        Slider({
          min: 10,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]');
      expect(thumb?.getAttribute('aria-valuemin')).toBe('10');
    });

    it('should have aria-valuemax', () => {
      const component = () =>
        Slider({
          max: 200,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]');
      expect(thumb?.getAttribute('aria-valuemax')).toBe('200');
    });

    it('should have aria-valuenow', () => {
      const component = () =>
        Slider({
          defaultValue: 55,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]');
      expect(thumb?.getAttribute('aria-valuenow')).toBe('55');
    });

    it('should update aria-valuenow on value change', () => {
      const value = signal(30);

      const component = () =>
        Slider({
          value,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]');
      expect(thumb?.getAttribute('aria-valuenow')).toBe('30');

      value.set(60);

      expect(thumb?.getAttribute('aria-valuenow')).toBe('60');
    });

    it('should have aria-orientation', () => {
      const component = () =>
        Slider({
          orientation: 'vertical',
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]');
      expect(thumb?.getAttribute('aria-orientation')).toBe('vertical');
    });

    it('should have aria-disabled when disabled', () => {
      const component = () =>
        Slider({
          disabled: true,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]');
      expect(thumb?.getAttribute('aria-disabled')).toBe('true');
    });

    it('should not have aria-disabled when not disabled', () => {
      const component = () =>
        Slider({
          disabled: false,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]');
      expect(thumb?.getAttribute('aria-disabled')).toBeNull();
    });

    it('should be focusable (tabindex 0) when not disabled', () => {
      const component = () =>
        Slider({
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]');
      expect(thumb?.getAttribute('tabindex')).toBe('0');
    });

    it('should not be focusable (tabindex -1) when disabled', () => {
      const component = () =>
        Slider({
          disabled: true,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]');
      expect(thumb?.getAttribute('tabindex')).toBe('-1');
    });
  });

  describe('Edge cases', () => {
    it('should handle min equals max', () => {
      const component = () =>
        Slider({
          min: 50,
          max: 50,
          defaultValue: 50,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]') as HTMLElement;
      expect(thumb?.getAttribute('aria-valuenow')).toBe('50');

      // Try to increment
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      thumb.dispatchEvent(event);

      // Should still be 50
      expect(thumb?.getAttribute('aria-valuenow')).toBe('50');
    });

    it('should handle negative ranges', () => {
      const component = () =>
        Slider({
          min: -100,
          max: 100,
          defaultValue: -50,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]');
      expect(thumb?.getAttribute('aria-valuenow')).toBe('-50');
    });

    it('should handle decimal steps', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 1,
          step: 0.1,
          defaultValue: 0.5,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]') as HTMLElement;
      expect(thumb?.getAttribute('aria-valuenow')).toBe('0.5');

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      thumb.dispatchEvent(event);

      expect(thumb?.getAttribute('aria-valuenow')).toBe('0.6');
    });

    it('should handle very small step values', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 1,
          step: 0.01,
          defaultValue: 0.5,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]') as HTMLElement;

      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      thumb.dispatchEvent(event);

      expect(thumb?.getAttribute('aria-valuenow')).toBe('0.51');
    });

    it('should round to step correctly', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 100,
          step: 5,
          defaultValue: 23,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]');
      // 23 should round to 25 (nearest step)
      expect(thumb?.getAttribute('aria-valuenow')).toBe('25');
    });

    it('should handle zero as min value', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 100,
          defaultValue: 0,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]');
      expect(thumb?.getAttribute('aria-valuenow')).toBe('0');
    });

    it('should handle large ranges', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 10000,
          step: 100,
          defaultValue: 5000,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[role="slider"]') as HTMLElement;
      expect(thumb?.getAttribute('aria-valuenow')).toBe('5000');

      const event = new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true });
      thumb.dispatchEvent(event);

      // PageUp should increment by 10 * step = 1000
      expect(thumb?.getAttribute('aria-valuenow')).toBe('6000');
    });
  });

  describe('Thumb positioning', () => {
    it('should position thumb at correct percentage (horizontal)', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 100,
          defaultValue: 75,
          orientation: 'horizontal',
          children: SliderThumb({ class: 'thumb' }),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('.thumb') as HTMLElement;
      expect(thumb.style.left).toBe('75%');
    });

    it('should position thumb at correct percentage (vertical)', () => {
      const component = () =>
        Slider({
          min: 0,
          max: 100,
          defaultValue: 75,
          orientation: 'vertical',
          children: SliderThumb({ class: 'thumb' }),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('.thumb') as HTMLElement;
      expect(thumb.style.bottom).toBe('75%');
    });

    it('should update thumb position on value change', () => {
      const value = signal(25);

      const component = () =>
        Slider({
          value,
          children: SliderThumb({ class: 'thumb' }),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('.thumb') as HTMLElement;
      expect(thumb.style.left).toBe('25%');

      value.set(80);

      expect(thumb.style.left).toBe('80%');
    });
  });

  describe('Data attributes', () => {
    it('should have data-orientation on root', () => {
      const component = () =>
        Slider({
          orientation: 'vertical',
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[role="group"]');
      expect(root?.getAttribute('data-orientation')).toBe('vertical');
    });

    it('should have data-disabled on root when disabled', () => {
      const component = () =>
        Slider({
          disabled: true,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[role="group"]');
      expect(root?.getAttribute('data-disabled')).toBe('');
    });

    it('should not have data-disabled on root when not disabled', () => {
      const component = () =>
        Slider({
          disabled: false,
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[role="group"]');
      expect(root?.hasAttribute('data-disabled')).toBe(false);
    });

    it('should have data-slider-track on track', () => {
      const component = () =>
        Slider({
          children: SliderTrack({ class: 'track', children: null }),
        });

      const { container } = renderComponent(component);

      const track = container.querySelector('.track');
      expect(track?.hasAttribute('data-slider-track')).toBe(true);
    });

    it('should have data-slider-range on range', () => {
      const component = () =>
        Slider({
          children: SliderTrack({
            children: SliderRange({ class: 'range' }),
          }),
        });

      const { container } = renderComponent(component);

      const range = container.querySelector('.range');
      expect(range?.hasAttribute('data-slider-range')).toBe(true);
    });

    it('should have data-slider-thumb on thumb', () => {
      const component = () =>
        Slider({
          children: SliderThumb({ class: 'thumb' }),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('.thumb');
      expect(thumb?.hasAttribute('data-slider-thumb')).toBe(true);
    });

    it('should have data-disabled on thumb when disabled', () => {
      const component = () =>
        Slider({
          disabled: true,
          children: SliderThumb({ class: 'thumb' }),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('.thumb');
      expect(thumb?.getAttribute('data-disabled')).toBe('');
    });
  });

  describe('Custom props pass-through', () => {
    it('should pass custom props to root', () => {
      const component = () =>
        Slider({
          'data-testid': 'slider-root',
          class: 'custom-slider',
          children: SliderThumb({}),
        });

      const { container } = renderComponent(component);

      const root = container.querySelector('[role="group"]') as HTMLElement;
      expect(root.getAttribute('data-testid')).toBe('slider-root');
      expect(root.className).toBe('custom-slider');
    });

    it('should pass custom props to track', () => {
      const component = () =>
        Slider({
          children: SliderTrack({
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
        Slider({
          children: SliderTrack({
            children: SliderRange({
              'data-testid': 'range',
              class: 'custom-range',
            }),
          }),
        });

      const { container } = renderComponent(component);

      const range = container.querySelector('[data-testid="range"]') as HTMLElement;
      expect(range.className).toBe('custom-range');
    });

    it('should pass custom props to thumb', () => {
      const component = () =>
        Slider({
          children: SliderThumb({
            'data-testid': 'thumb',
            class: 'custom-thumb',
          }),
        });

      const { container } = renderComponent(component);

      const thumb = container.querySelector('[data-testid="thumb"]') as HTMLElement;
      expect(thumb.className).toBe('custom-thumb');
    });
  });
});
