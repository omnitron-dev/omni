/**
 * RadioGroup Primitive Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RadioGroup, RadioGroupItem, RadioGroupIndicator } from '../../../src/primitives/RadioGroup.js';
import { signal } from '../../../src/core/reactivity/signal.js';
import { renderComponent } from '../../helpers/test-utils.js';

// Track active element globally for focus/blur mocking
let _activeElement: Element | null = null;

describe('RadioGroup', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    cleanup?.();
    cleanup = undefined;

    // Reset active element tracking
    _activeElement = document.body;

    // Mock document.activeElement with a getter that tracks focus
    Object.defineProperty(document, 'activeElement', {
      get() {
        return _activeElement || document.body;
      },
      configurable: true,
    });

    // Mock focus/blur for happy-dom compatibility
    Object.defineProperty(HTMLElement.prototype, 'focus', {
      value(this: HTMLElement) {
        _activeElement = this;
        this.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      },
      writable: true,
      configurable: true,
    });

    Object.defineProperty(HTMLElement.prototype, 'blur', {
      value(this: HTMLElement) {
        _activeElement = document.body;
        this.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      },
      writable: true,
      configurable: true,
    });
  });

  describe('Rendering', () => {
    it('should render a div with role="radiogroup"', () => {
      const component = () =>
        RadioGroup({
          children: () => [],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const group = container.querySelector('div[role="radiogroup"]');
      expect(group).toBeTruthy();
    });

    it('should render children', () => {
      const component = () =>
        RadioGroup({
          children: 'Radio options',
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      expect(container.textContent).toContain('Radio options');
    });

    it('should generate unique ID', () => {
      const component = () =>
        RadioGroup({
          children: () => [],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const group = container.querySelector('div[role="radiogroup"]');
      expect(group?.id).toBeTruthy();
      expect(group?.id).toMatch(/^aether-/);
    });

    it('should default to vertical orientation', () => {
      const component = () =>
        RadioGroup({
          children: () => [],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const group = container.querySelector('div[role="radiogroup"]');
      expect(group?.getAttribute('aria-orientation')).toBe('vertical');
      expect(group?.getAttribute('data-orientation')).toBe('vertical');
    });

    it('should support horizontal orientation', () => {
      const component = () =>
        RadioGroup({
          orientation: 'horizontal',
          children: () => [],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const group = container.querySelector('div[role="radiogroup"]');
      expect(group?.getAttribute('aria-orientation')).toBe('horizontal');
      expect(group?.getAttribute('data-orientation')).toBe('horizontal');
    });
  });

  describe('Value State - Uncontrolled', () => {
    it('should have no value by default', () => {
      const component = () =>
        RadioGroup({
          children: () => [RadioGroupItem({ value: 'option1' })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]');
      expect(item?.getAttribute('aria-checked')).toBe('false');
    });

    it('should use defaultValue', () => {
      const component = () =>
        RadioGroup({
          defaultValue: 'option1',
          children: () => [RadioGroupItem({ value: 'option1' })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]');
      expect(item?.getAttribute('aria-checked')).toBe('true');
      expect(item?.getAttribute('data-state')).toBe('checked');
    });

    it('should select item on click', () => {
      const component = () =>
        RadioGroup({
          children: () => [RadioGroupItem({ value: 'option1' })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]') as HTMLButtonElement;
      expect(item.getAttribute('aria-checked')).toBe('false');

      item.click();

      expect(item.getAttribute('aria-checked')).toBe('true');
      expect(item.getAttribute('data-state')).toBe('checked');
    });
  });

  describe('Value State - Controlled', () => {
    it('should use controlled value signal', () => {
      const value = signal<string | undefined>('option1');
      const component = () =>
        RadioGroup({
          value,
          children: () => [RadioGroupItem({ value: 'option1' })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]');
      expect(item?.getAttribute('aria-checked')).toBe('true');

      value.set('option2');

      expect(item?.getAttribute('aria-checked')).toBe('false');
    });

    it('should update when controlled signal changes', () => {
      const value = signal<string | undefined>(undefined);
      const component = () =>
        RadioGroup({
          value,
          children: () => [
            RadioGroupItem({ value: 'option1', id: 'opt1' }),
            RadioGroupItem({ value: 'option2', id: 'opt2' }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item1 = container.querySelector('#opt1');
      const item2 = container.querySelector('#opt2');

      expect(item1?.getAttribute('aria-checked')).toBe('false');
      expect(item2?.getAttribute('aria-checked')).toBe('false');

      value.set('option1');

      expect(item1?.getAttribute('aria-checked')).toBe('true');
      expect(item2?.getAttribute('aria-checked')).toBe('false');

      value.set('option2');

      expect(item1?.getAttribute('aria-checked')).toBe('false');
      expect(item2?.getAttribute('aria-checked')).toBe('true');
    });

    it('should NOT update controlled signal on click', () => {
      const value = signal<string | undefined>(undefined);
      const component = () =>
        RadioGroup({
          value,
          children: () => [RadioGroupItem({ value: 'option1' })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]') as HTMLButtonElement;
      item.click();

      // Signal should NOT change (controlled by parent)
      expect(value()).toBe(undefined);
    });
  });

  describe('onValueChange Callback', () => {
    it('should call onValueChange when value changes', () => {
      const onValueChange = vi.fn();
      const component = () =>
        RadioGroup({
          onValueChange,
          children: () => [RadioGroupItem({ value: 'option1' })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]') as HTMLButtonElement;
      item.click();

      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(onValueChange).toHaveBeenCalledWith('option1');
    });

    it('should not call onValueChange on render', () => {
      const onValueChange = vi.fn();
      const component = () =>
        RadioGroup({
          defaultValue: 'option1',
          onValueChange,
          children: () => [RadioGroupItem({ value: 'option1' })],
        });
      const { dispose } = renderComponent(component);
      cleanup = dispose;

      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('should call onValueChange in controlled mode', () => {
      const value = signal<string | undefined>(undefined);
      const onValueChange = vi.fn();
      const component = () =>
        RadioGroup({
          value,
          onValueChange,
          children: () => [RadioGroupItem({ value: 'option1' })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]') as HTMLButtonElement;
      item.click();

      expect(onValueChange).toHaveBeenCalledWith('option1');
    });
  });

  describe('Disabled State', () => {
    it('should not be disabled by default', () => {
      const component = () =>
        RadioGroup({
          children: () => [RadioGroupItem({ value: 'option1' })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const group = container.querySelector('div[role="radiogroup"]');
      const item = container.querySelector('button[role="radio"]');
      expect(group?.hasAttribute('data-disabled')).toBe(false);
      expect(item?.hasAttribute('disabled')).toBe(false);
    });

    it('should disable group when disabled=true', () => {
      const component = () =>
        RadioGroup({
          disabled: true,
          children: () => [RadioGroupItem({ value: 'option1' })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const group = container.querySelector('div[role="radiogroup"]');
      const item = container.querySelector('button[role="radio"]');
      expect(group?.hasAttribute('data-disabled')).toBe(true);
      expect(item?.hasAttribute('disabled')).toBe(true);
    });

    it('should not select on click when disabled', () => {
      const onValueChange = vi.fn();
      const component = () =>
        RadioGroup({
          disabled: true,
          onValueChange,
          children: () => [RadioGroupItem({ value: 'option1' })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]') as HTMLButtonElement;
      item.click();

      expect(item.getAttribute('aria-checked')).toBe('false');
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('should disable individual item', () => {
      const component = () =>
        RadioGroup({
          children: () => [
            RadioGroupItem({ value: 'option1', id: 'opt1', disabled: true }),
            RadioGroupItem({ value: 'option2', id: 'opt2' }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item1 = container.querySelector('#opt1');
      const item2 = container.querySelector('#opt2');
      expect(item1?.hasAttribute('disabled')).toBe(true);
      expect(item2?.hasAttribute('disabled')).toBe(false);
    });

    it('should not select disabled item on click', () => {
      const onValueChange = vi.fn();
      const component = () =>
        RadioGroup({
          onValueChange,
          children: () => [RadioGroupItem({ value: 'option1', disabled: true })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]') as HTMLButtonElement;
      item.click();

      expect(item.getAttribute('aria-checked')).toBe('false');
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  describe('Required State', () => {
    it('should not be required by default', () => {
      const component = () =>
        RadioGroup({
          children: () => [],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const group = container.querySelector('div[role="radiogroup"]');
      expect(group?.getAttribute('aria-required')).toBeNull();
    });

    it('should have aria-required when required=true', () => {
      const component = () =>
        RadioGroup({
          required: true,
          children: () => [],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const group = container.querySelector('div[role="radiogroup"]');
      expect(group?.getAttribute('aria-required')).toBe('true');
    });
  });

  describe('Keyboard Navigation - Vertical', () => {
    it('should focus next item on ArrowDown', () => {
      const component = () =>
        RadioGroup({
          children: () => [
            RadioGroupItem({ value: 'option1', id: 'opt1' }),
            RadioGroupItem({ value: 'option2', id: 'opt2' }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const group = container.querySelector('div[role="radiogroup"]') as HTMLElement;
      const item1 = container.querySelector('#opt1') as HTMLElement;
      const item2 = container.querySelector('#opt2') as HTMLElement;

      item1.focus();
      group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

      expect(document.activeElement).toBe(item2);
      expect(item2.getAttribute('aria-checked')).toBe('true');
    });

    it('should focus previous item on ArrowUp', () => {
      const component = () =>
        RadioGroup({
          children: () => [
            RadioGroupItem({ value: 'option1', id: 'opt1' }),
            RadioGroupItem({ value: 'option2', id: 'opt2' }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const group = container.querySelector('div[role="radiogroup"]') as HTMLElement;
      const item1 = container.querySelector('#opt1') as HTMLElement;
      const item2 = container.querySelector('#opt2') as HTMLElement;

      item2.focus();
      group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));

      expect(document.activeElement).toBe(item1);
      expect(item1.getAttribute('aria-checked')).toBe('true');
    });

    it('should loop to first item on ArrowDown from last', () => {
      const component = () =>
        RadioGroup({
          children: () => [
            RadioGroupItem({ value: 'option1', id: 'opt1' }),
            RadioGroupItem({ value: 'option2', id: 'opt2' }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const group = container.querySelector('div[role="radiogroup"]') as HTMLElement;
      const item1 = container.querySelector('#opt1') as HTMLElement;
      const item2 = container.querySelector('#opt2') as HTMLElement;

      item2.focus();
      group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

      expect(document.activeElement).toBe(item1);
    });

    it('should loop to last item on ArrowUp from first', () => {
      const component = () =>
        RadioGroup({
          children: () => [
            RadioGroupItem({ value: 'option1', id: 'opt1' }),
            RadioGroupItem({ value: 'option2', id: 'opt2' }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const group = container.querySelector('div[role="radiogroup"]') as HTMLElement;
      const item1 = container.querySelector('#opt1') as HTMLElement;
      const item2 = container.querySelector('#opt2') as HTMLElement;

      item1.focus();
      group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));

      expect(document.activeElement).toBe(item2);
    });

    it('should not loop when loop=false', () => {
      const component = () =>
        RadioGroup({
          loop: false,
          children: () => [
            RadioGroupItem({ value: 'option1', id: 'opt1' }),
            RadioGroupItem({ value: 'option2', id: 'opt2' }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const group = container.querySelector('div[role="radiogroup"]') as HTMLElement;
      const item1 = container.querySelector('#opt1') as HTMLElement;

      item1.focus();
      group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));

      expect(document.activeElement).toBe(item1);
    });
  });

  describe('Keyboard Navigation - Horizontal', () => {
    it('should focus next item on ArrowRight', () => {
      const component = () =>
        RadioGroup({
          orientation: 'horizontal',
          children: () => [
            RadioGroupItem({ value: 'option1', id: 'opt1' }),
            RadioGroupItem({ value: 'option2', id: 'opt2' }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const group = container.querySelector('div[role="radiogroup"]') as HTMLElement;
      const item1 = container.querySelector('#opt1') as HTMLElement;
      const item2 = container.querySelector('#opt2') as HTMLElement;

      item1.focus();
      group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

      expect(document.activeElement).toBe(item2);
    });

    it('should focus previous item on ArrowLeft', () => {
      const component = () =>
        RadioGroup({
          orientation: 'horizontal',
          children: () => [
            RadioGroupItem({ value: 'option1', id: 'opt1' }),
            RadioGroupItem({ value: 'option2', id: 'opt2' }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const group = container.querySelector('div[role="radiogroup"]') as HTMLElement;
      const item1 = container.querySelector('#opt1') as HTMLElement;
      const item2 = container.querySelector('#opt2') as HTMLElement;

      item2.focus();
      group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));

      expect(document.activeElement).toBe(item1);
    });

    it('should not respond to vertical arrows in horizontal mode', () => {
      const component = () =>
        RadioGroup({
          orientation: 'horizontal',
          children: () => [
            RadioGroupItem({ value: 'option1', id: 'opt1' }),
            RadioGroupItem({ value: 'option2', id: 'opt2' }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const group = container.querySelector('div[role="radiogroup"]') as HTMLElement;
      const item1 = container.querySelector('#opt1') as HTMLElement;

      item1.focus();
      group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

      expect(document.activeElement).toBe(item1);
    });
  });

  describe('Keyboard Navigation - Home/End', () => {
    it('should focus first item on Home key', () => {
      const component = () =>
        RadioGroup({
          children: () => [
            RadioGroupItem({ value: 'option1', id: 'opt1' }),
            RadioGroupItem({ value: 'option2', id: 'opt2' }),
            RadioGroupItem({ value: 'option3', id: 'opt3' }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const group = container.querySelector('div[role="radiogroup"]') as HTMLElement;
      const item1 = container.querySelector('#opt1') as HTMLElement;
      const item3 = container.querySelector('#opt3') as HTMLElement;

      item3.focus();
      group.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));

      expect(document.activeElement).toBe(item1);
    });

    it('should focus last item on End key', () => {
      const component = () =>
        RadioGroup({
          children: () => [
            RadioGroupItem({ value: 'option1', id: 'opt1' }),
            RadioGroupItem({ value: 'option2', id: 'opt2' }),
            RadioGroupItem({ value: 'option3', id: 'opt3' }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const group = container.querySelector('div[role="radiogroup"]') as HTMLElement;
      const item1 = container.querySelector('#opt1') as HTMLElement;
      const item3 = container.querySelector('#opt3') as HTMLElement;

      item1.focus();
      group.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));

      expect(document.activeElement).toBe(item3);
    });
  });

  describe('Keyboard Navigation - Disabled Items', () => {
    it('should skip disabled items', () => {
      const component = () =>
        RadioGroup({
          children: () => [
            RadioGroupItem({ value: 'option1', id: 'opt1' }),
            RadioGroupItem({ value: 'option2', id: 'opt2', disabled: true }),
            RadioGroupItem({ value: 'option3', id: 'opt3' }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const group = container.querySelector('div[role="radiogroup"]') as HTMLElement;
      const item1 = container.querySelector('#opt1') as HTMLElement;
      const item3 = container.querySelector('#opt3') as HTMLElement;

      item1.focus();
      group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

      expect(document.activeElement).toBe(item3);
    });

    it('should not navigate when group is disabled', () => {
      const component = () =>
        RadioGroup({
          disabled: true,
          children: () => [
            RadioGroupItem({ value: 'option1', id: 'opt1' }),
            RadioGroupItem({ value: 'option2', id: 'opt2' }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const group = container.querySelector('div[role="radiogroup"]') as HTMLElement;
      const item1 = container.querySelector('#opt1') as HTMLElement;

      item1.focus();
      const initialFocus = document.activeElement;
      group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

      expect(document.activeElement).toBe(initialFocus);
    });
  });

  describe('Form Integration', () => {
    it('should not render hidden input when name is not provided', () => {
      const component = () =>
        RadioGroup({
          children: () => [],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const hiddenInput = container.querySelector('input[type="hidden"]');
      expect(hiddenInput).toBeNull();
    });

    it('should render hidden input when name is provided', () => {
      const component = () =>
        RadioGroup({
          name: 'color',
          children: () => [],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const hiddenInput = container.querySelector('input[type="hidden"]');
      expect(hiddenInput).toBeTruthy();
      expect((hiddenInput as HTMLInputElement).name).toBe('color');
    });

    it('should sync hidden input value with selected value', () => {
      const component = () =>
        RadioGroup({
          name: 'color',
          children: () => [RadioGroupItem({ value: 'red' })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]') as HTMLButtonElement;
      const hiddenInput = container.querySelector('input[type="hidden"]') as HTMLInputElement;

      expect(hiddenInput.value).toBe('');

      item.click();

      expect(hiddenInput.value).toBe('red');
    });

    it('should have empty value when nothing selected', () => {
      const component = () =>
        RadioGroup({
          name: 'color',
          children: () => [],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const hiddenInput = container.querySelector('input[type="hidden"]') as HTMLInputElement;
      expect(hiddenInput.value).toBe('');
    });

    it('should have aria-hidden on hidden input', () => {
      const component = () =>
        RadioGroup({
          name: 'color',
          children: () => [],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const hiddenInput = container.querySelector('input[type="hidden"]');
      expect(hiddenInput?.getAttribute('aria-hidden')).toBe('true');
    });

    it('should hide hidden input with styles', () => {
      const component = () =>
        RadioGroup({
          name: 'color',
          children: () => [],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const hiddenInput = container.querySelector('input[type="hidden"]') as HTMLInputElement;
      expect(hiddenInput.style.position).toBe('absolute');
      expect(hiddenInput.style.opacity).toBe('0');
      expect(hiddenInput.style.pointerEvents).toBe('none');
    });
  });
});

describe('RadioGroupItem', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  describe('Rendering', () => {
    it('should render a button with role="radio"', () => {
      const component = () =>
        RadioGroup({
          children: () => [RadioGroupItem({ value: 'option1' })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]');
      expect(item).toBeTruthy();
    });

    it('should render with type="button"', () => {
      const component = () =>
        RadioGroup({
          children: () => [RadioGroupItem({ value: 'option1' })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button') as HTMLButtonElement;
      expect(item.type).toBe('button');
    });

    it('should render children', () => {
      const component = () =>
        RadioGroup({
          children: () => [
            RadioGroupItem({
              value: 'option1',
              children: 'Option 1',
            }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      expect(container.textContent).toContain('Option 1');
    });

    it('should generate unique ID when not provided', () => {
      const component = () =>
        RadioGroup({
          children: () => [RadioGroupItem({ value: 'option1' })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button');
      expect(item?.id).toBeTruthy();
      expect(item?.id).toMatch(/^aether-/);
    });

    it('should use provided ID', () => {
      const component = () =>
        RadioGroup({
          children: () => [
            RadioGroupItem({
              value: 'option1',
              id: 'my-radio',
            }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button');
      expect(item?.id).toBe('my-radio');
    });

    it('should have data-value attribute', () => {
      const component = () =>
        RadioGroup({
          children: () => [RadioGroupItem({ value: 'option1' })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]');
      expect(item?.getAttribute('data-value')).toBe('option1');
    });
  });

  describe('Checked State', () => {
    it('should be unchecked by default', () => {
      const component = () =>
        RadioGroup({
          children: () => [RadioGroupItem({ value: 'option1' })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]');
      expect(item?.getAttribute('aria-checked')).toBe('false');
      expect(item?.getAttribute('data-state')).toBe('unchecked');
    });

    it('should be checked when value matches group value', () => {
      const component = () =>
        RadioGroup({
          defaultValue: 'option1',
          children: () => [RadioGroupItem({ value: 'option1' })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]');
      expect(item?.getAttribute('aria-checked')).toBe('true');
      expect(item?.getAttribute('data-state')).toBe('checked');
    });

    it('should update checked state when group value changes', () => {
      const value = signal<string | undefined>('option1');
      const component = () =>
        RadioGroup({
          value,
          children: () => [
            RadioGroupItem({ value: 'option1', id: 'opt1' }),
            RadioGroupItem({ value: 'option2', id: 'opt2' }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item1 = container.querySelector('#opt1');
      const item2 = container.querySelector('#opt2');

      expect(item1?.getAttribute('aria-checked')).toBe('true');
      expect(item2?.getAttribute('aria-checked')).toBe('false');

      value.set('option2');

      expect(item1?.getAttribute('aria-checked')).toBe('false');
      expect(item2?.getAttribute('aria-checked')).toBe('true');
    });
  });

  describe('TabIndex', () => {
    it('should have tabIndex=0 when checked', () => {
      const component = () =>
        RadioGroup({
          defaultValue: 'option1',
          children: () => [RadioGroupItem({ value: 'option1' })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]') as HTMLButtonElement;
      expect(item.tabIndex).toBe(0);
    });

    it('should have tabIndex=-1 when unchecked', () => {
      const component = () =>
        RadioGroup({
          children: () => [RadioGroupItem({ value: 'option1' })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]') as HTMLButtonElement;
      expect(item.tabIndex).toBe(-1);
    });
  });

  describe('Keyboard Handling', () => {
    it('should select on Space key', () => {
      const component = () =>
        RadioGroup({
          children: () => [RadioGroupItem({ value: 'option1' })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]') as HTMLButtonElement;
      expect(item.getAttribute('aria-checked')).toBe('false');

      item.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));

      expect(item.getAttribute('aria-checked')).toBe('true');
    });

    it('should select on Enter key', () => {
      const component = () =>
        RadioGroup({
          children: () => [RadioGroupItem({ value: 'option1' })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]') as HTMLButtonElement;
      expect(item.getAttribute('aria-checked')).toBe('false');

      item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(item.getAttribute('aria-checked')).toBe('true');
    });

    it('should not select on other keys', () => {
      const onValueChange = vi.fn();
      const component = () =>
        RadioGroup({
          onValueChange,
          children: () => [RadioGroupItem({ value: 'option1' })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]') as HTMLButtonElement;
      item.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('should not select on Space when disabled', () => {
      const onValueChange = vi.fn();
      const component = () =>
        RadioGroup({
          onValueChange,
          children: () => [RadioGroupItem({ value: 'option1', disabled: true })],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]') as HTMLButtonElement;
      item.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));

      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  describe('Props', () => {
    it('should accept and apply className', () => {
      const component = () =>
        RadioGroup({
          children: () => [
            RadioGroupItem({
              value: 'option1',
              className: 'custom-radio',
            }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]');
      expect(item?.className).toBe('custom-radio');
    });

    it('should accept and apply style', () => {
      const component = () =>
        RadioGroup({
          children: () => [
            RadioGroupItem({
              value: 'option1',
              style: { backgroundColor: 'blue' },
            }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]') as HTMLButtonElement;
      expect(item.style.backgroundColor).toBe('blue');
    });

    it('should accept and apply data attributes', () => {
      const component = () =>
        RadioGroup({
          children: () => [
            RadioGroupItem({
              value: 'option1',
              'data-testid': 'my-radio',
            }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]');
      expect(item?.getAttribute('data-testid')).toBe('my-radio');
    });

    it('should accept and apply aria attributes', () => {
      const component = () =>
        RadioGroup({
          children: () => [
            RadioGroupItem({
              value: 'option1',
              'aria-label': 'Select option',
            }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const item = container.querySelector('button[role="radio"]');
      expect(item?.getAttribute('aria-label')).toBe('Select option');
    });
  });
});

describe('RadioGroupIndicator', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  describe('Rendering', () => {
    it('should not render when radio is unchecked', () => {
      const component = () =>
        RadioGroup({
          children: () => [
            RadioGroupItem({
              value: 'option1',
              children: () =>
                RadioGroupIndicator({
                  children: 'Checked!',
                }),
            }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      expect(container.textContent).not.toContain('Checked!');
    });

    it('should render when radio is checked', () => {
      const component = () =>
        RadioGroup({
          defaultValue: 'option1',
          children: () => [
            RadioGroupItem({
              value: 'option1',
              children: () =>
                RadioGroupIndicator({
                  children: 'Checked!',
                }),
            }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      expect(container.textContent).toContain('Checked!');
    });

    it('should show/hide when radio is toggled', () => {
      const value = signal<string | undefined>(undefined);
      const component = () =>
        RadioGroup({
          value,
          children: () => [
            RadioGroupItem({
              value: 'option1',
              children: () =>
                RadioGroupIndicator({
                  children: 'Checked!',
                }),
            }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      expect(container.textContent).not.toContain('Checked!');

      value.set('option1');

      expect(container.textContent).toContain('Checked!');

      value.set('option2');

      expect(container.textContent).not.toContain('Checked!');
    });

    it('should render as span element', () => {
      const component = () =>
        RadioGroup({
          defaultValue: 'option1',
          children: () => [
            RadioGroupItem({
              value: 'option1',
              children: () =>
                RadioGroupIndicator({
                  children: '',
                }),
            }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const indicator = container.querySelector('span[data-state]');
      expect(indicator).toBeTruthy();
    });
  });

  describe('Data State', () => {
    it('should have data-state="checked" when visible', () => {
      const component = () =>
        RadioGroup({
          defaultValue: 'option1',
          children: () => [
            RadioGroupItem({
              value: 'option1',
              children: () => RadioGroupIndicator({}),
            }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const indicator = container.querySelector('span[data-state]');
      expect(indicator?.getAttribute('data-state')).toBe('checked');
    });

    it('should update data-state when radio state changes', () => {
      const value = signal<string | undefined>('option1');
      const component = () =>
        RadioGroup({
          value,
          children: () => [
            RadioGroupItem({
              value: 'option1',
              children: () => RadioGroupIndicator({}),
            }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const indicator = container.querySelector('span[data-state]');
      expect(indicator?.getAttribute('data-state')).toBe('checked');

      value.set('option2');

      expect(container.querySelector('span[data-state]')).toBeNull();
    });
  });

  describe('Props', () => {
    it('should accept and apply className', () => {
      const component = () =>
        RadioGroup({
          defaultValue: 'option1',
          children: () => [
            RadioGroupItem({
              value: 'option1',
              children: () =>
                RadioGroupIndicator({
                  className: 'custom-indicator',
                }),
            }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const indicator = container.querySelector('span[data-state]');
      expect(indicator?.className).toBe('custom-indicator');
    });

    it('should accept and apply style', () => {
      const component = () =>
        RadioGroup({
          defaultValue: 'option1',
          children: () => [
            RadioGroupItem({
              value: 'option1',
              children: () =>
                RadioGroupIndicator({
                  style: { color: 'green' },
                }),
            }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const indicator = container.querySelector('span[data-state]') as HTMLElement;
      expect(indicator.style.color).toBe('green');
    });

    it('should accept and apply data attributes', () => {
      const component = () =>
        RadioGroup({
          defaultValue: 'option1',
          children: () => [
            RadioGroupItem({
              value: 'option1',
              children: () =>
                RadioGroupIndicator({
                  'data-testid': 'my-indicator',
                }),
            }),
          ],
        });
      const { container, dispose } = renderComponent(component);
      cleanup = dispose;

      const indicator = container.querySelector('span[data-state]');
      expect(indicator?.getAttribute('data-testid')).toBe('my-indicator');
    });
  });
});
