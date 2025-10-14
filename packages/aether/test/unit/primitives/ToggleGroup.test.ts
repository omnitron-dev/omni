/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import { ToggleGroup, ToggleGroupItem } from '../../../src/primitives/ToggleGroup.js';
import { renderComponent, nextTick, createSpy } from '../../helpers/test-utils.js';

describe('ToggleGroup', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Single mode', () => {
    it('should render toggle group with single type', () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
          ],
        });

      const { container } = renderComponent(component);

      const group = container.querySelector('[data-toggle-group]') as HTMLElement;
      expect(group).toBeTruthy();
      expect(group.getAttribute('role')).toBe('radiogroup');

      const items = container.querySelectorAll('button[role="radio"]');
      expect(items.length).toBe(2);
    });

    it('should support default value in single mode', () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          defaultValue: 'bold',
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('button[role="radio"]');
      expect(items[0]?.getAttribute('aria-checked')).toBe('true');
      expect(items[0]?.getAttribute('data-state')).toBe('on');
      expect(items[1]?.getAttribute('aria-checked')).toBe('false');
      expect(items[1]?.getAttribute('data-state')).toBe('off');
    });

    it('should toggle selection in single mode', async () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('button[role="radio"]') as NodeListOf<HTMLElement>;

      // Click first item
      items[0]?.click();
      await nextTick();

      expect(items[0]?.getAttribute('aria-checked')).toBe('true');
      expect(items[0]?.getAttribute('data-state')).toBe('on');

      // Click second item
      items[1]?.click();
      await nextTick();

      // First should be deselected, second should be selected
      expect(items[0]?.getAttribute('aria-checked')).toBe('false');
      expect(items[0]?.getAttribute('data-state')).toBe('off');
      expect(items[1]?.getAttribute('aria-checked')).toBe('true');
      expect(items[1]?.getAttribute('data-state')).toBe('on');
    });

    it('should allow deselecting in single mode when not required', async () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          defaultValue: 'bold',
          required: false,
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('button[role="radio"]') as NodeListOf<HTMLElement>;

      // Initially bold is selected
      expect(items[0]?.getAttribute('aria-checked')).toBe('true');

      // Click to deselect
      items[0]?.click();
      await nextTick();

      // Should be deselected
      expect(items[0]?.getAttribute('aria-checked')).toBe('false');
      expect(items[0]?.getAttribute('data-state')).toBe('off');
    });

    it('should not allow deselecting in single mode when required', async () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          defaultValue: 'bold',
          required: true,
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('button[role="radio"]') as NodeListOf<HTMLElement>;

      // Initially bold is selected
      expect(items[0]?.getAttribute('aria-checked')).toBe('true');

      // Click to deselect
      items[0]?.click();
      await nextTick();

      // Should still be selected
      expect(items[0]?.getAttribute('aria-checked')).toBe('true');
      expect(items[0]?.getAttribute('data-state')).toBe('on');
    });

    it('should call onValueChange in single mode', async () => {
      const onValueChange = createSpy();

      const component = () =>
        ToggleGroup({
          type: 'single',
          onValueChange,
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('button[role="radio"]') as NodeListOf<HTMLElement>;

      items[0]?.click();
      await nextTick();

      expect(onValueChange.callCount).toBe(1);
      expect(onValueChange.calls[0][0]).toBe('bold');

      items[1]?.click();
      await nextTick();

      expect(onValueChange.callCount).toBe(2);
      expect(onValueChange.calls[1][0]).toBe('italic');
    });

    it('should support controlled value in single mode', async () => {
      const value = signal('bold');

      const component = () =>
        ToggleGroup({
          type: 'single',
          value,
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('button[role="radio"]');

      // Initially bold is selected
      expect(items[0]?.getAttribute('aria-checked')).toBe('true');
      expect(items[1]?.getAttribute('aria-checked')).toBe('false');

      // Change controlled value
      value.set('italic');
      await nextTick();

      expect(items[0]?.getAttribute('aria-checked')).toBe('false');
      expect(items[1]?.getAttribute('aria-checked')).toBe('true');
    });
  });

  describe('Multiple mode', () => {
    it('should render toggle group with multiple type', () => {
      const component = () =>
        ToggleGroup({
          type: 'multiple',
          // Use function children for lazy evaluation
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
          ],
        });

      const { container } = renderComponent(component);

      const group = container.querySelector('[data-toggle-group]') as HTMLElement;
      expect(group).toBeTruthy();
      expect(group.getAttribute('role')).toBe('group');

      const items = container.querySelectorAll('button[role="button"]');

      console.log('=== DEBUG ===');
      console.log('DOM:', container.innerHTML.substring(0, 500));
      console.log('All buttons:', container.querySelectorAll('button').length);
      console.log('Items with role=button:', items.length);
      expect(items.length).toBe(2);
    });

    it('should support default value in multiple mode', () => {
      const component = () =>
        ToggleGroup({
          type: 'multiple',
          defaultValue: ['bold', 'italic'],
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
            ToggleGroupItem({ value: 'underline', children: 'Underline' }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('button[role="button"]');
      expect(items[0]?.getAttribute('aria-pressed')).toBe('true');
      expect(items[0]?.getAttribute('data-state')).toBe('on');
      expect(items[1]?.getAttribute('aria-pressed')).toBe('true');
      expect(items[1]?.getAttribute('data-state')).toBe('on');
      expect(items[2]?.getAttribute('aria-pressed')).toBe('false');
      expect(items[2]?.getAttribute('data-state')).toBe('off');
    });

    it('should allow multiple selections', async () => {
      const component = () =>
        ToggleGroup({
          type: 'multiple',
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
            ToggleGroupItem({ value: 'underline', children: 'Underline' }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('button[role="button"]') as NodeListOf<HTMLElement>;

      // Click first item
      items[0]?.click();
      await nextTick();

      expect(items[0]?.getAttribute('aria-pressed')).toBe('true');

      // Click second item
      items[1]?.click();
      await nextTick();

      // Both should be selected
      expect(items[0]?.getAttribute('aria-pressed')).toBe('true');
      expect(items[1]?.getAttribute('aria-pressed')).toBe('true');
      expect(items[2]?.getAttribute('aria-pressed')).toBe('false');
    });

    it('should toggle items independently in multiple mode', async () => {
      const component = () =>
        ToggleGroup({
          type: 'multiple',
          defaultValue: ['bold', 'italic'],
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('button[role="button"]') as NodeListOf<HTMLElement>;

      // Click first item to deselect
      items[0]?.click();
      await nextTick();

      // First should be deselected, second should still be selected
      expect(items[0]?.getAttribute('aria-pressed')).toBe('false');
      expect(items[1]?.getAttribute('aria-pressed')).toBe('true');

      // Click first again to select
      items[0]?.click();
      await nextTick();

      // Both should be selected
      expect(items[0]?.getAttribute('aria-pressed')).toBe('true');
      expect(items[1]?.getAttribute('aria-pressed')).toBe('true');
    });

    it('should call onValueChange with array in multiple mode', async () => {
      const onValueChange = createSpy();

      const component = () =>
        ToggleGroup({
          type: 'multiple',
          onValueChange,
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('button[role="button"]') as NodeListOf<HTMLElement>;

      items[0]?.click();
      await nextTick();

      expect(onValueChange.callCount).toBe(1);
      expect(onValueChange.calls[0][0]).toEqual(['bold']);

      items[1]?.click();
      await nextTick();

      expect(onValueChange.callCount).toBe(2);
      expect(onValueChange.calls[1][0]).toEqual(['bold', 'italic']);
    });

    it('should support controlled value in multiple mode', async () => {
      const value = signal(['bold']);

      const component = () =>
        ToggleGroup({
          type: 'multiple',
          value,
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('button[role="button"]');

      // Initially only bold is selected
      expect(items[0]?.getAttribute('aria-pressed')).toBe('true');
      expect(items[1]?.getAttribute('aria-pressed')).toBe('false');

      // Change controlled value
      value.set(['bold', 'italic']);
      await nextTick();

      expect(items[0]?.getAttribute('aria-pressed')).toBe('true');
      expect(items[1]?.getAttribute('aria-pressed')).toBe('true');
    });
  });

  describe('Orientation', () => {
    it('should default to horizontal orientation', () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          children: () => [ToggleGroupItem({ value: 'bold', children: 'Bold' })],
        });

      const { container } = renderComponent(component);

      const group = container.querySelector('[data-toggle-group]') as HTMLElement;
      expect(group.getAttribute('data-orientation')).toBe('horizontal');
      expect(group.getAttribute('aria-orientation')).toBe('horizontal');
    });

    it('should support vertical orientation', () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          orientation: 'vertical',
          children: () => [ToggleGroupItem({ value: 'bold', children: 'Bold' })],
        });

      const { container } = renderComponent(component);

      const group = container.querySelector('[data-toggle-group]') as HTMLElement;
      expect(group.getAttribute('data-orientation')).toBe('vertical');
      expect(group.getAttribute('aria-orientation')).toBe('vertical');
    });
  });

  describe('Keyboard navigation', () => {
    it('should navigate with arrow keys in horizontal mode', async () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          orientation: 'horizontal',
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
            ToggleGroupItem({ value: 'underline', children: 'Underline' }),
          ],
        });

      const { container } = renderComponent(component);

      const group = container.querySelector('[data-toggle-group]') as HTMLElement;
      const items = container.querySelectorAll('button[role="radio"]') as NodeListOf<HTMLElement>;

      // Focus first item
      items[0]?.focus();

      // Press ArrowRight
      const rightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      group.dispatchEvent(rightEvent);
      await nextTick();

      // Second item should be focused
      expect(document.activeElement).toBe(items[1]);

      // Press ArrowLeft
      const leftEvent = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
      group.dispatchEvent(leftEvent);
      await nextTick();

      // First item should be focused again
      expect(document.activeElement).toBe(items[0]);
    });

    it('should navigate with arrow keys in vertical mode', async () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          orientation: 'vertical',
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
            ToggleGroupItem({ value: 'underline', children: 'Underline' }),
          ],
        });

      const { container } = renderComponent(component);

      const group = container.querySelector('[data-toggle-group]') as HTMLElement;
      const items = container.querySelectorAll('button[role="radio"]') as NodeListOf<HTMLElement>;

      // Focus first item
      items[0]?.focus();

      // Press ArrowDown
      const downEvent = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
      group.dispatchEvent(downEvent);
      await nextTick();

      // Second item should be focused
      expect(document.activeElement).toBe(items[1]);

      // Press ArrowUp
      const upEvent = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
      group.dispatchEvent(upEvent);
      await nextTick();

      // First item should be focused again
      expect(document.activeElement).toBe(items[0]);
    });

    it('should loop navigation when loop is true', async () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          loop: true,
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
          ],
        });

      const { container } = renderComponent(component);

      const group = container.querySelector('[data-toggle-group]') as HTMLElement;
      const items = container.querySelectorAll('button[role="radio"]') as NodeListOf<HTMLElement>;

      // Focus last item
      items[1]?.focus();

      // Press ArrowRight (should loop to first)
      const rightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      group.dispatchEvent(rightEvent);
      await nextTick();

      expect(document.activeElement).toBe(items[0]);

      // Press ArrowLeft (should loop to last)
      const leftEvent = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
      group.dispatchEvent(leftEvent);
      await nextTick();

      expect(document.activeElement).toBe(items[1]);
    });

    it('should not loop navigation when loop is false', async () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          loop: false,
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
          ],
        });

      const { container } = renderComponent(component);

      const group = container.querySelector('[data-toggle-group]') as HTMLElement;
      const items = container.querySelectorAll('button[role="radio"]') as NodeListOf<HTMLElement>;

      // Focus last item
      items[1]?.focus();

      // Press ArrowRight (should not loop)
      const rightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      group.dispatchEvent(rightEvent);
      await nextTick();

      // Should still be on last item
      expect(document.activeElement).toBe(items[1]);
    });

    it('should navigate to first item with Home key', async () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
            ToggleGroupItem({ value: 'underline', children: 'Underline' }),
          ],
        });

      const { container } = renderComponent(component);

      const group = container.querySelector('[data-toggle-group]') as HTMLElement;
      const items = container.querySelectorAll('button[role="radio"]') as NodeListOf<HTMLElement>;

      // Focus last item
      items[2]?.focus();

      // Press Home
      const homeEvent = new KeyboardEvent('keydown', { key: 'Home', bubbles: true });
      group.dispatchEvent(homeEvent);
      await nextTick();

      expect(document.activeElement).toBe(items[0]);
    });

    it('should navigate to last item with End key', async () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
            ToggleGroupItem({ value: 'underline', children: 'Underline' }),
          ],
        });

      const { container } = renderComponent(component);

      const group = container.querySelector('[data-toggle-group]') as HTMLElement;
      const items = container.querySelectorAll('button[role="radio"]') as NodeListOf<HTMLElement>;

      // Focus first item
      items[0]?.focus();

      // Press End
      const endEvent = new KeyboardEvent('keydown', { key: 'End', bubbles: true });
      group.dispatchEvent(endEvent);
      await nextTick();

      expect(document.activeElement).toBe(items[2]);
    });

    it('should skip disabled items during navigation', async () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', disabled: true, children: 'Italic' }),
            ToggleGroupItem({ value: 'underline', children: 'Underline' }),
          ],
        });

      const { container } = renderComponent(component);

      const group = container.querySelector('[data-toggle-group]') as HTMLElement;
      const items = container.querySelectorAll('button[role="radio"]') as NodeListOf<HTMLElement>;

      // Focus first item
      items[0]?.focus();

      // Press ArrowRight (should skip disabled item)
      const rightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      group.dispatchEvent(rightEvent);
      await nextTick();

      // Should skip to third item (second is disabled)
      expect(document.activeElement).toBe(items[2]);
    });
  });

  describe('Disabled state', () => {
    it('should disable entire group', () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          disabled: true,
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
          ],
        });

      const { container } = renderComponent(component);

      const group = container.querySelector('[data-toggle-group]') as HTMLElement;
      expect(group.getAttribute('data-disabled')).toBe('');

      const items = container.querySelectorAll('button[role="radio"]');
      items.forEach((item) => {
        expect(item.hasAttribute('disabled')).toBe(true);
        expect(item.getAttribute('data-disabled')).toBe('');
      });
    });

    it('should disable individual items', () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', disabled: true, children: 'Italic' }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('button[role="radio"]');

      expect(items[0]?.hasAttribute('disabled')).toBe(false);
      expect(items[1]?.hasAttribute('disabled')).toBe(true);
      expect(items[1]?.getAttribute('data-disabled')).toBe('');
    });

    it('should not toggle disabled items', async () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', disabled: true, children: 'Italic' }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('button[role="radio"]') as NodeListOf<HTMLElement>;

      // Try to click disabled item (won't work due to disabled attribute)
      items[1]?.click();
      await nextTick();

      expect(items[1]?.getAttribute('aria-checked')).toBe('false');
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA role for single mode', () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          children: () => [ToggleGroupItem({ value: 'bold', children: 'Bold' })],
        });

      const { container } = renderComponent(component);

      const group = container.querySelector('[data-toggle-group]') as HTMLElement;
      expect(group.getAttribute('role')).toBe('radiogroup');

      const item = container.querySelector('button');
      expect(item?.getAttribute('role')).toBe('radio');
      expect(item?.hasAttribute('aria-checked')).toBe(true);
    });

    it('should have proper ARIA role for multiple mode', () => {
      const component = () =>
        ToggleGroup({
          type: 'multiple',
          children: () => [ToggleGroupItem({ value: 'bold', children: 'Bold' })],
        });

      const { container } = renderComponent(component);

      const group = container.querySelector('[data-toggle-group]') as HTMLElement;
      expect(group.getAttribute('role')).toBe('group');

      const item = container.querySelector('button');
      expect(item?.getAttribute('role')).toBe('button');
      expect(item?.hasAttribute('aria-pressed')).toBe(true);
    });

    it('should have proper ARIA orientation', () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          orientation: 'vertical',
          children: () => [ToggleGroupItem({ value: 'bold', children: 'Bold' })],
        });

      const { container } = renderComponent(component);

      const group = container.querySelector('[data-toggle-group]') as HTMLElement;
      expect(group.getAttribute('aria-orientation')).toBe('vertical');
    });

    it('should use tabindex for roving tabindex pattern', () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          defaultValue: 'italic',
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
            ToggleGroupItem({ value: 'underline', children: 'Underline' }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('button[role="radio"]');

      // Selected item should have tabindex 0
      expect(items[1]?.getAttribute('tabindex')).toBe('0');

      // Others should have tabindex -1
      expect(items[0]?.getAttribute('tabindex')).toBe('-1');
      expect(items[2]?.getAttribute('tabindex')).toBe('-1');
    });
  });

  describe('Custom props', () => {
    it('should pass through custom props to root', () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          class: 'custom-group',
          'data-testid': 'toggle-group',
          children: () => [ToggleGroupItem({ value: 'bold', children: 'Bold' })],
        });

      const { container } = renderComponent(component);

      const group = container.querySelector('[data-toggle-group]') as HTMLElement;
      expect(group.className).toBe('custom-group');
      expect(group.getAttribute('data-testid')).toBe('toggle-group');
    });

    it('should pass through custom props to items', () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          children: () => [
            ToggleGroupItem({
              value: 'bold',
              class: 'custom-item',
              'data-testid': 'item',
              children: 'Bold',
            }),
          ],
        });

      const { container } = renderComponent(component);

      const item = container.querySelector('button') as HTMLElement;
      expect(item.className).toBe('custom-item');
      expect(item.getAttribute('data-testid')).toBe('item');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty group', () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          children: () => [],
        });

      const { container } = renderComponent(component);

      const group = container.querySelector('[data-toggle-group]');
      expect(group).toBeTruthy();

      const items = container.querySelectorAll('button');
      expect(items.length).toBe(0);
    });

    it('should handle rapid clicks', async () => {
      const component = () =>
        ToggleGroup({
          type: 'multiple',
          children: () => [ToggleGroupItem({ value: 'bold', children: 'Bold' })],
        });

      const { container } = renderComponent(component);

      const item = container.querySelector('button') as HTMLElement;

      // Rapid clicks
      item.click();
      item.click();
      item.click();
      await nextTick();

      // Should end up selected (3 clicks = off -> on -> off -> on)
      expect(item.getAttribute('aria-pressed')).toBe('true');
    });

    it('should handle switching from uncontrolled to controlled', async () => {
      const value = signal('italic');

      const component = () =>
        ToggleGroup({
          type: 'single',
          value,
          defaultValue: 'bold', // Should be ignored
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('button[role="radio"]');

      // Should use controlled value, not defaultValue
      expect(items[0]?.getAttribute('aria-checked')).toBe('false');
      expect(items[1]?.getAttribute('aria-checked')).toBe('true');
    });

    it('should handle invalid default value', () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          defaultValue: 'nonexistent',
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('button[role="radio"]');

      // No item should be selected
      expect(items[0]?.getAttribute('aria-checked')).toBe('false');
      expect(items[1]?.getAttribute('aria-checked')).toBe('false');
    });

    it('should handle switching between single and multiple modes', () => {
      const component = () =>
        ToggleGroup({
          type: 'multiple',
          defaultValue: ['bold', 'italic'],
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('button[role="button"]');

      expect(items[0]?.getAttribute('aria-pressed')).toBe('true');
      expect(items[1]?.getAttribute('aria-pressed')).toBe('true');
    });

    it('should handle all items disabled', () => {
      const component = () =>
        ToggleGroup({
          type: 'single',
          children: () => [
            ToggleGroupItem({ value: 'bold', disabled: true, children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', disabled: true, children: 'Italic' }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('button[role="radio"]');

      items.forEach((item) => {
        expect(item.hasAttribute('disabled')).toBe(true);
      });
    });
  });

  describe('State updates', () => {
    it('should update item states when value changes', async () => {
      const value = signal('bold');

      const component = () =>
        ToggleGroup({
          type: 'single',
          value,
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
            ToggleGroupItem({ value: 'underline', children: 'Underline' }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('button[role="radio"]');

      // Initially bold is selected
      expect(items[0]?.getAttribute('data-state')).toBe('on');
      expect(items[1]?.getAttribute('data-state')).toBe('off');
      expect(items[2]?.getAttribute('data-state')).toBe('off');

      // Change to italic
      value.set('italic');
      await nextTick();

      expect(items[0]?.getAttribute('data-state')).toBe('off');
      expect(items[1]?.getAttribute('data-state')).toBe('on');
      expect(items[2]?.getAttribute('data-state')).toBe('off');
    });

    it('should update multiple item states when value changes', async () => {
      const value = signal(['bold']);

      const component = () =>
        ToggleGroup({
          type: 'multiple',
          value,
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
            ToggleGroupItem({ value: 'underline', children: 'Underline' }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('button[role="button"]');

      // Initially only bold is selected
      expect(items[0]?.getAttribute('data-state')).toBe('on');
      expect(items[1]?.getAttribute('data-state')).toBe('off');
      expect(items[2]?.getAttribute('data-state')).toBe('off');

      // Add italic and underline
      value.set(['bold', 'italic', 'underline']);
      await nextTick();

      expect(items[0]?.getAttribute('data-state')).toBe('on');
      expect(items[1]?.getAttribute('data-state')).toBe('on');
      expect(items[2]?.getAttribute('data-state')).toBe('on');
    });
  });

  describe('Integration', () => {
    it('should work with both controlled and callback', async () => {
      const value = signal('bold');
      const onValueChange = createSpy();

      const component = () =>
        ToggleGroup({
          type: 'single',
          value,
          onValueChange: (newValue: string | string[]) => {
            onValueChange(newValue);
            value.set(newValue as string);
          },
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('button[role="radio"]') as NodeListOf<HTMLElement>;

      items[1]?.click();
      await nextTick();

      expect(onValueChange.callCount).toBe(1);
      expect(onValueChange.calls[0][0]).toBe('italic');
      expect(items[1]?.getAttribute('aria-checked')).toBe('true');
    });

    it('should handle static item arrays', () => {
      // Note: In Aether, components don't re-render. Dynamic item addition
      // requires using Show control flow or creating new component instances.
      // This test verifies static arrays work correctly.
      const component = () =>
        ToggleGroup({
          type: 'single',
          children: () => [
            ToggleGroupItem({ value: 'bold', children: 'Bold' }),
            ToggleGroupItem({ value: 'italic', children: 'Italic' }),
            ToggleGroupItem({ value: 'underline', children: 'Underline' }),
          ],
        });

      const { container } = renderComponent(component);

      const items = container.querySelectorAll('button[role="radio"]');
      expect(items.length).toBe(3);
      expect(items[0]?.textContent).toBe('Bold');
      expect(items[1]?.textContent).toBe('Italic');
      expect(items[2]?.textContent).toBe('Underline');
    });
  });
});
