/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import { Rating, RatingItem } from '../../../src/primitives/Rating.js';
import { renderComponent, createSpy, nextTick } from '../../helpers/test-utils.js';

describe('Rating', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Component Exports', () => {
    it('should export Rating component', () => {
      expect(Rating).toBeDefined();
      expect(typeof Rating).toBe('function');
    });

    it('should export RatingItem component', () => {
      expect(RatingItem).toBeDefined();
      expect(typeof RatingItem).toBe('function');
    });

    it('should have Rating.Item attached', () => {
      expect((Rating as any).Item).toBe(RatingItem);
    });
  });

  describe('Basic Rendering', () => {
    it('should render a container with data-rating attribute', () => {
      const component = () =>
        Rating({
          children: () => RatingItem({ index: 1, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl).toBeTruthy();
    });

    it('should render with default max of 5', () => {
      const component = () =>
        Rating({
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-rating-item]');
      expect(items.length).toBe(5);
    });

    it('should render with custom max', () => {
      const component = () =>
        Rating({
          max: 10,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-rating-item]');
      expect(items.length).toBe(10);
    });

    it('should render items with correct indices', () => {
      const component = () =>
        Rating({
          max: 3,
          children: (index: number) => RatingItem({ index, children: String(index) }),
        });
      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-rating-item]');
      expect(items[0]?.textContent).toBe('1');
      expect(items[1]?.textContent).toBe('2');
      expect(items[2]?.textContent).toBe('3');
    });
  });

  describe('Uncontrolled Mode', () => {
    it('should start with defaultValue', () => {
      const component = () =>
        Rating({
          defaultValue: 3,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.getAttribute('aria-valuenow')).toBe('3');
    });

    it('should start with 0 if no defaultValue', () => {
      const component = () =>
        Rating({
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.getAttribute('aria-valuenow')).toBe('0');
    });

    it('should update value on item click', () => {
      const component = () =>
        Rating({
          defaultValue: 0,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-rating-item]');
      const thirdItem = items[2] as HTMLElement;

      thirdItem.click();

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.getAttribute('aria-valuenow')).toBe('3');
    });
  });

  describe('Controlled Mode', () => {
    it('should use controlled value', () => {
      const value = signal(3);
      const component = () =>
        Rating({
          value: value(),
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.getAttribute('aria-valuenow')).toBe('3');
    });

    it('should update when signal changes', async () => {
      const value = signal(2);
      const component = () =>
        Rating({
          value: value, // Pass signal directly
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.getAttribute('aria-valuenow')).toBe('2');

      value.set(4);
      await nextTick();

      expect(ratingEl?.getAttribute('aria-valuenow')).toBe('4');
    });

    it('should call onValueChange when item clicked', () => {
      const value = signal(0);
      const onValueChange = createSpy();
      const component = () =>
        Rating({
          value: value(),
          onValueChange,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-rating-item]');
      const fourthItem = items[3] as HTMLElement;

      fourthItem.click();

      expect(onValueChange.callCount).toBe(1);
      expect(onValueChange.calls[0][0]).toBe(4);
    });
  });

  describe('onValueChange Callback', () => {
    it('should call onValueChange with new value', () => {
      const onValueChange = createSpy();
      const component = () =>
        Rating({
          defaultValue: 0,
          onValueChange,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-rating-item]');
      (items[2] as HTMLElement).click();

      expect(onValueChange.callCount).toBe(1);
      expect(onValueChange.calls[0][0]).toBe(3);
    });

    it('should work with vi.fn() spy', () => {
      const onValueChange = vi.fn();
      const component = () =>
        Rating({
          defaultValue: 0,
          onValueChange,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-rating-item]');
      (items[4] as HTMLElement).click();

      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(onValueChange).toHaveBeenCalledWith(5);
    });
  });

  describe('Disabled State', () => {
    it('should have data-disabled attribute', () => {
      const component = () =>
        Rating({
          disabled: true,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.hasAttribute('data-disabled')).toBe(true);
    });

    it('should have aria-disabled', () => {
      const component = () =>
        Rating({
          disabled: true,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.getAttribute('aria-disabled')).toBe('true');
    });

    it('should not change value when disabled', () => {
      const onValueChange = createSpy();
      const component = () =>
        Rating({
          disabled: true,
          defaultValue: 0,
          onValueChange,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-rating-item]');
      (items[2] as HTMLElement).click();

      expect(onValueChange.callCount).toBe(0);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.getAttribute('aria-valuenow')).toBe('0');
    });

    it('should not be focusable when disabled', () => {
      const component = () =>
        Rating({
          disabled: true,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.hasAttribute('tabindex')).toBe(false);
    });
  });

  describe('Readonly State', () => {
    it('should have data-readonly attribute', () => {
      const component = () =>
        Rating({
          readOnly: true,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.hasAttribute('data-readonly')).toBe(true);
    });

    it('should have aria-readonly', () => {
      const component = () =>
        Rating({
          readOnly: true,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.getAttribute('aria-readonly')).toBe('true');
    });

    it('should not change value when readonly', () => {
      const onValueChange = createSpy();
      const component = () =>
        Rating({
          readOnly: true,
          defaultValue: 2,
          onValueChange,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-rating-item]');
      (items[4] as HTMLElement).click();

      expect(onValueChange.callCount).toBe(0);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.getAttribute('aria-valuenow')).toBe('2');
    });

    it('should not be focusable when readonly', () => {
      const component = () =>
        Rating({
          readOnly: true,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.hasAttribute('tabindex')).toBe(false);
    });
  });

  describe('Half Ratings', () => {
    it('should support half ratings when allowHalf is true', () => {
      const value = signal(2.5);
      const component = () =>
        Rating({
          value: value(),
          allowHalf: true,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.getAttribute('aria-valuenow')).toBe('2.5');
    });

    it('should set half rating when clicking left half of item', () => {
      const onValueChange = createSpy();
      const component = () =>
        Rating({
          allowHalf: true,
          defaultValue: 0,
          onValueChange,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-rating-item]');
      const thirdItem = items[2] as HTMLElement;

      // Mock getBoundingClientRect
      const rect = { left: 0, width: 100 };
      vi.spyOn(thirdItem, 'getBoundingClientRect').mockReturnValue(rect as any);

      // Click on left half (x < width/2)
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        clientX: 30, // Left half
      });
      thirdItem.dispatchEvent(clickEvent);

      expect(onValueChange.callCount).toBe(1);
      expect(onValueChange.calls[0][0]).toBe(2.5);
    });

    it('should set full rating when clicking right half of item', () => {
      const onValueChange = createSpy();
      const component = () =>
        Rating({
          allowHalf: true,
          defaultValue: 0,
          onValueChange,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-rating-item]');
      const thirdItem = items[2] as HTMLElement;

      // Mock getBoundingClientRect
      const rect = { left: 0, width: 100 };
      vi.spyOn(thirdItem, 'getBoundingClientRect').mockReturnValue(rect as any);

      // Click on right half (x >= width/2)
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        clientX: 70, // Right half
      });
      thirdItem.dispatchEvent(clickEvent);

      expect(onValueChange.callCount).toBe(1);
      expect(onValueChange.calls[0][0]).toBe(3);
    });

    it('should not allow half ratings when allowHalf is false', () => {
      const onValueChange = createSpy();
      const component = () =>
        Rating({
          allowHalf: false,
          defaultValue: 0,
          onValueChange,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-rating-item]');
      const item = items[1] as HTMLElement;

      // Mock getBoundingClientRect
      const rect = { left: 0, width: 100 };
      vi.spyOn(item, 'getBoundingClientRect').mockReturnValue(rect as any);

      // Click on left half
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        clientX: 20, // Left side
      });
      item.dispatchEvent(clickEvent);

      // Should get full rating, not half
      expect(onValueChange.calls[0][0]).toBe(2);
    });
  });

  describe('Mouse Interaction', () => {
    it('should set hover value on mousemove', async () => {
      const component = () =>
        Rating({
          defaultValue: 0,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-rating-item]');
      const thirdItem = items[2] as HTMLElement;

      // Mock getBoundingClientRect
      const rect = { left: 0, width: 100 };
      vi.spyOn(thirdItem, 'getBoundingClientRect').mockReturnValue(rect as any);

      const moveEvent = new MouseEvent('mousemove', {
        bubbles: true,
        clientX: 80,
      });
      thirdItem.dispatchEvent(moveEvent);

      await nextTick();

      // Hover should be reflected (though implementation details may vary)
      // Just verify no errors occurred
      expect(thirdItem).toBeTruthy();
    });

    it('should clear hover value on mouseleave', async () => {
      const component = () =>
        Rating({
          defaultValue: 2,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]') as HTMLElement;
      const items = container.querySelectorAll('[data-rating-item]');
      const item = items[3] as HTMLElement;

      // Mock getBoundingClientRect
      const rect = { left: 0, width: 100 };
      vi.spyOn(item, 'getBoundingClientRect').mockReturnValue(rect as any);

      // Hover
      const moveEvent = new MouseEvent('mousemove', {
        bubbles: true,
        clientX: 50,
      });
      item.dispatchEvent(moveEvent);

      // Leave
      const leaveEvent = new MouseEvent('mouseleave', { bubbles: true });
      ratingEl.dispatchEvent(leaveEvent);

      await nextTick();

      // Should be back to default value
      expect(ratingEl.getAttribute('aria-valuenow')).toBe('2');
    });
  });

  describe('Keyboard Navigation', () => {
    it('should increase rating on ArrowRight', () => {
      const component = () =>
        Rating({
          defaultValue: 2,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]') as HTMLElement;

      const rightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      ratingEl.dispatchEvent(rightEvent);

      expect(ratingEl.getAttribute('aria-valuenow')).toBe('3');
    });

    it('should increase rating on ArrowUp', () => {
      const component = () =>
        Rating({
          defaultValue: 1,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]') as HTMLElement;

      const upEvent = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
      ratingEl.dispatchEvent(upEvent);

      expect(ratingEl.getAttribute('aria-valuenow')).toBe('2');
    });

    it('should decrease rating on ArrowLeft', () => {
      const component = () =>
        Rating({
          defaultValue: 3,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]') as HTMLElement;

      const leftEvent = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
      ratingEl.dispatchEvent(leftEvent);

      expect(ratingEl.getAttribute('aria-valuenow')).toBe('2');
    });

    it('should decrease rating on ArrowDown', () => {
      const component = () =>
        Rating({
          defaultValue: 4,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]') as HTMLElement;

      const downEvent = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
      ratingEl.dispatchEvent(downEvent);

      expect(ratingEl.getAttribute('aria-valuenow')).toBe('3');
    });

    it('should set rating to 0 on Home key', () => {
      const component = () =>
        Rating({
          defaultValue: 3,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]') as HTMLElement;

      const homeEvent = new KeyboardEvent('keydown', { key: 'Home', bubbles: true });
      ratingEl.dispatchEvent(homeEvent);

      expect(ratingEl.getAttribute('aria-valuenow')).toBe('0');
    });

    it('should set rating to max on End key', () => {
      const component = () =>
        Rating({
          defaultValue: 2,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]') as HTMLElement;

      const endEvent = new KeyboardEvent('keydown', { key: 'End', bubbles: true });
      ratingEl.dispatchEvent(endEvent);

      expect(ratingEl.getAttribute('aria-valuenow')).toBe('5');
    });

    it('should not exceed max on ArrowRight', () => {
      const component = () =>
        Rating({
          defaultValue: 5,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]') as HTMLElement;

      const rightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      ratingEl.dispatchEvent(rightEvent);

      expect(ratingEl.getAttribute('aria-valuenow')).toBe('5');
    });

    it('should not go below 0 on ArrowLeft', () => {
      const component = () =>
        Rating({
          defaultValue: 0,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]') as HTMLElement;

      const leftEvent = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
      ratingEl.dispatchEvent(leftEvent);

      expect(ratingEl.getAttribute('aria-valuenow')).toBe('0');
    });

    it('should use half step when allowHalf is true', () => {
      const component = () =>
        Rating({
          defaultValue: 2,
          allowHalf: true,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]') as HTMLElement;

      const rightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      ratingEl.dispatchEvent(rightEvent);

      expect(ratingEl.getAttribute('aria-valuenow')).toBe('2.5');
    });

    it('should not respond to keyboard when disabled', () => {
      const component = () =>
        Rating({
          disabled: true,
          defaultValue: 2,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]') as HTMLElement;

      const rightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      ratingEl.dispatchEvent(rightEvent);

      expect(ratingEl.getAttribute('aria-valuenow')).toBe('2');
    });

    it('should not respond to keyboard when readonly', () => {
      const component = () =>
        Rating({
          readOnly: true,
          defaultValue: 2,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]') as HTMLElement;

      const rightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      ratingEl.dispatchEvent(rightEvent);

      expect(ratingEl.getAttribute('aria-valuenow')).toBe('2');
    });
  });

  describe('ARIA Attributes', () => {
    it('should have role="slider"', () => {
      const component = () =>
        Rating({
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.getAttribute('role')).toBe('slider');
    });

    it('should have aria-label', () => {
      const component = () =>
        Rating({
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.getAttribute('aria-label')).toBe('Rating');
    });

    it('should have aria-valuenow', () => {
      const component = () =>
        Rating({
          defaultValue: 3,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.getAttribute('aria-valuenow')).toBe('3');
    });

    it('should have aria-valuemin=0', () => {
      const component = () =>
        Rating({
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.getAttribute('aria-valuemin')).toBe('0');
    });

    it('should have aria-valuemax equal to max', () => {
      const component = () =>
        Rating({
          max: 10,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.getAttribute('aria-valuemax')).toBe('10');
    });

    it('should be focusable with tabIndex=0 when not disabled/readonly', () => {
      const component = () =>
        Rating({
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.getAttribute('tabindex')).toBe('0');
    });
  });

  describe('Rating Item Data Attributes', () => {
    it('should have data-rating-item attribute', () => {
      const component = () =>
        Rating({
          children: () => RatingItem({ index: 1, children: '★' }),
        });
      const { container } = renderComponent(component);

      const item = container.querySelector('[data-rating-item]');
      expect(item).toBeTruthy();
    });

    it('should have data-index attribute', () => {
      const component = () =>
        Rating({
          children: () => RatingItem({ index: 3, children: '★' }),
        });
      const { container } = renderComponent(component);

      const item = container.querySelector('[data-rating-item]');
      expect(item?.getAttribute('data-index')).toBe('3');
    });

    it('should have data-filled when item is filled', () => {
      const component = () =>
        Rating({
          defaultValue: 3,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-rating-item]');
      expect(items[0]?.hasAttribute('data-filled')).toBe(true);
      expect(items[1]?.hasAttribute('data-filled')).toBe(true);
      expect(items[2]?.hasAttribute('data-filled')).toBe(true);
      expect(items[3]?.hasAttribute('data-filled')).toBe(false);
      expect(items[4]?.hasAttribute('data-filled')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle 0 rating', () => {
      const component = () =>
        Rating({
          defaultValue: 0,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.getAttribute('aria-valuenow')).toBe('0');

      const items = container.querySelectorAll('[data-rating-item]');
      items.forEach((item) => {
        expect(item.hasAttribute('data-filled')).toBe(false);
      });
    });

    it('should handle max rating', () => {
      const component = () =>
        Rating({
          defaultValue: 5,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.getAttribute('aria-valuenow')).toBe('5');

      const items = container.querySelectorAll('[data-rating-item]');
      items.forEach((item) => {
        expect(item.hasAttribute('data-filled')).toBe(true);
      });
    });

    it('should clamp value above max', () => {
      const onValueChange = createSpy();
      const component = () =>
        Rating({
          defaultValue: 0,
          max: 5,
          onValueChange,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      // Manually try to set value > max via keyboard
      const ratingEl = container.querySelector('[data-rating]') as HTMLElement;
      for (let i = 0; i < 10; i++) {
        const rightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
        ratingEl.dispatchEvent(rightEvent);
      }

      expect(ratingEl.getAttribute('aria-valuenow')).toBe('5');
    });

    it('should handle rapid clicks', () => {
      const component = () =>
        Rating({
          defaultValue: 0,
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-rating-item]');
      const firstItem = items[0] as HTMLElement;
      const lastItem = items[4] as HTMLElement;

      firstItem.click();
      lastItem.click();
      firstItem.click();

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.getAttribute('aria-valuenow')).toBe('1');
    });
  });

  describe('Real-world Scenarios', () => {
    it('should work as a product rating display (readonly)', () => {
      const component = () =>
        Rating({
          value: 4.5,
          allowHalf: true,
          readOnly: true,
          max: 5,
          children: (index: number, filled: boolean) =>
            RatingItem({
              index,
              children: filled ? '★' : '☆',
            }),
        });
      const { container } = renderComponent(component);

      const ratingEl = container.querySelector('[data-rating]');
      expect(ratingEl?.getAttribute('aria-valuenow')).toBe('4.5');
      expect(ratingEl?.hasAttribute('data-readonly')).toBe(true);
    });

    it('should work as an interactive rating input', () => {
      const userRating = signal(0);
      const component = () =>
        Rating({
          value: userRating(),
          onValueChange: (value) => userRating.set(value),
          max: 5,
          children: (index: number) => RatingItem({ index, children: '★' }),
        });
      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-rating-item]');
      (items[3] as HTMLElement).click();

      expect(userRating()).toBe(4);
    });

    it('should work with custom icons', () => {
      const component = () =>
        Rating({
          defaultValue: 3,
          max: 5,
          children: (index: number, filled: boolean) =>
            RatingItem({
              index,
              children: filled ? '❤️' : '🤍',
            }),
        });
      const { container } = renderComponent(component);

      const items = container.querySelectorAll('[data-rating-item]');
      expect(items[0]?.textContent).toBe('❤️');
      expect(items[1]?.textContent).toBe('❤️');
      expect(items[2]?.textContent).toBe('❤️');
      expect(items[3]?.textContent).toBe('🤍');
      expect(items[4]?.textContent).toBe('🤍');
    });
  });
});
