/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import {
  NumberInput,
  NumberInputField,
  NumberInputIncrement,
  NumberInputDecrement,
  __resetNumberInputContext,
} from '../../../src/primitives/NumberInput.js';
import { renderComponent, createSpy } from '../../helpers/test-utils.js';

describe('NumberInput', () => {
  // Track cleanup functions to dispose reactive roots
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    // Clean up all components after each test
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      cleanup?.();
    }
  });

  beforeEach(() => {
    // Clear DOM
    document.body.innerHTML = '';

    // Reset global context
    __resetNumberInputContext();
  });

  // Wrap renderComponent to automatically track cleanups
  const render = (component: () => any) => {
    const result = renderComponent(component);
    cleanups.push(result.cleanup);
    return result;
  };

  describe('Basic Rendering', () => {
    it('should render root container with children', () => {
      const component = () =>
        NumberInput({
          children: [
            NumberInputField({}),
            NumberInputIncrement({}),
            NumberInputDecrement({}),
          ],
        });

      const { container } = render(component);

      const root = container.querySelector('[data-number-input]');
      expect(root).toBeTruthy();
      expect(root?.getAttribute('role')).toBe('group');
    });

    it('should render input field', () => {
      const component = () =>
        NumberInput({
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]');
      expect(input).toBeTruthy();
      expect(input?.tagName).toBe('INPUT');
    });

    it('should render increment button', () => {
      const component = () =>
        NumberInput({
          children: NumberInputIncrement({}),
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-increment]');
      expect(button).toBeTruthy();
      expect(button?.tagName).toBe('BUTTON');
      expect(button?.getAttribute('type')).toBe('button');
    });

    it('should render decrement button', () => {
      const component = () =>
        NumberInput({
          children: NumberInputDecrement({}),
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-decrement]');
      expect(button).toBeTruthy();
      expect(button?.tagName).toBe('BUTTON');
      expect(button?.getAttribute('type')).toBe('button');
    });

    it('should render all sub-components together', () => {
      const component = () =>
        NumberInput({
          children: [
            NumberInputField({}),
            NumberInputIncrement({}),
            NumberInputDecrement({}),
          ],
        });

      const { container } = render(component);

      expect(container.querySelector('[data-number-input-field]')).toBeTruthy();
      expect(container.querySelector('[data-number-input-increment]')).toBeTruthy();
      expect(container.querySelector('[data-number-input-decrement]')).toBeTruthy();
    });

    it('should have default increment button content', () => {
      const component = () =>
        NumberInput({
          children: NumberInputIncrement({}),
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-increment]');
      expect(button?.textContent).toBe('▲');
    });

    it('should have default decrement button content', () => {
      const component = () =>
        NumberInput({
          children: NumberInputDecrement({}),
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-decrement]');
      expect(button?.textContent).toBe('▼');
    });

    it('should allow custom increment button content', () => {
      const component = () =>
        NumberInput({
          children: NumberInputIncrement({ children: '+' }),
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-increment]');
      expect(button?.textContent).toBe('+');
    });

    it('should allow custom decrement button content', () => {
      const component = () =>
        NumberInput({
          children: NumberInputDecrement({ children: '-' }),
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-decrement]');
      expect(button?.textContent).toBe('-');
    });
  });

  describe('Default Value (Uncontrolled Mode)', () => {
    it('should use defaultValue of 0 when not provided', () => {
      const component = () =>
        NumberInput({
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.value).toBe('0');
    });

    it('should use provided defaultValue', () => {
      const component = () =>
        NumberInput({
          defaultValue: 50,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.value).toBe('50');
    });

    it('should allow defaultValue to be negative', () => {
      const component = () =>
        NumberInput({
          defaultValue: -25,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.value).toBe('-25');
    });

    it('should allow defaultValue with decimals', () => {
      const component = () =>
        NumberInput({
          defaultValue: 3.14,
          precision: 2,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.value).toBe('3.14');
    });
  });

  describe('Controlled Mode', () => {
    it('should use controlled value', () => {
      const component = () =>
        NumberInput({
          value: 75,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.value).toBe('75');
    });

    it('should update when controlled value changes', () => {
      const value = signal(30);

      const component = () =>
        NumberInput({
          value: value as any, // Pass signal directly, not value()
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.value).toBe('30');

      value.set(60);
      expect(input.value).toBe('60');
    });

    it('should call onValueChange when value is modified', () => {
      const onValueChange = createSpy();

      const component = () =>
        NumberInput({
          defaultValue: 10,
          onValueChange,
          children: [
            NumberInputField({}),
            NumberInputIncrement({}),
          ],
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-increment]') as HTMLButtonElement;
      button.click();

      expect(onValueChange.callCount).toBe(1);
      expect(onValueChange.calls[0][0]).toBe(11);
    });

    it('should handle controlled mode with signal', () => {
      const value = signal(0);
      const onValueChange = (newValue: number) => value.set(newValue);

      const component = () =>
        NumberInput({
          value: value as any, // Pass signal directly, not value()
          onValueChange,
          children: [
            NumberInputField({}),
            NumberInputIncrement({}),
          ],
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-increment]') as HTMLButtonElement;
      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      button.click();
      expect(value()).toBe(1);
      expect(input.value).toBe('1');
    });
  });

  describe('Min and Max Props', () => {
    it('should default to -Infinity min and Infinity max', () => {
      const component = () =>
        NumberInput({
          defaultValue: 50,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.getAttribute('aria-valuemin')).toBe('-Infinity');
      expect(input.getAttribute('aria-valuemax')).toBe('Infinity');
    });

    it('should use custom min value', () => {
      const component = () =>
        NumberInput({
          min: 10,
          defaultValue: 50,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.getAttribute('aria-valuemin')).toBe('10');
    });

    it('should use custom max value', () => {
      const component = () =>
        NumberInput({
          max: 100,
          defaultValue: 50,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.getAttribute('aria-valuemax')).toBe('100');
    });

    it('should clamp value to min when keepWithinRange is true', () => {
      const component = () =>
        NumberInput({
          min: 10,
          defaultValue: 5,
          keepWithinRange: true,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.value).toBe('10');
    });

    it('should clamp value to max when keepWithinRange is true', () => {
      const component = () =>
        NumberInput({
          max: 100,
          defaultValue: 150,
          keepWithinRange: true,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.value).toBe('100');
    });

    it('should not clamp during typing when keepWithinRange is true by default', () => {
      const component = () =>
        NumberInput({
          min: 10,
          max: 100,
          defaultValue: 50,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      // Simulate typing a value outside range
      input.value = '5';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      // Value should be clamped to min
      expect(input.value).toBe('10');
    });
  });

  describe('Step Prop', () => {
    it('should default to step of 1', () => {
      const component = () =>
        NumberInput({
          defaultValue: 10,
          children: [
            NumberInputField({}),
            NumberInputIncrement({}),
          ],
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-increment]') as HTMLButtonElement;
      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      button.click();
      expect(input.value).toBe('11');
    });

    it('should increment by custom step', () => {
      const component = () =>
        NumberInput({
          defaultValue: 10,
          step: 5,
          children: [
            NumberInputField({}),
            NumberInputIncrement({}),
          ],
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-increment]') as HTMLButtonElement;
      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      button.click();
      expect(input.value).toBe('15');
    });

    it('should decrement by custom step', () => {
      const component = () =>
        NumberInput({
          defaultValue: 10,
          step: 5,
          children: [
            NumberInputField({}),
            NumberInputDecrement({}),
          ],
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-decrement]') as HTMLButtonElement;
      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      button.click();
      expect(input.value).toBe('5');
    });

    it('should support decimal step', () => {
      const component = () =>
        NumberInput({
          defaultValue: 1.0,
          step: 0.1,
          precision: 1,
          children: [
            NumberInputField({}),
            NumberInputIncrement({}),
          ],
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-increment]') as HTMLButtonElement;
      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      button.click();
      expect(input.value).toBe('1.1');
    });
  });

  describe('Precision Prop', () => {
    it('should default to precision of 0', () => {
      const component = () =>
        NumberInput({
          defaultValue: 5,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.value).toBe('5');
    });

    it('should format value with specified precision', () => {
      const component = () =>
        NumberInput({
          defaultValue: 5,
          precision: 2,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.value).toBe('5.00');
    });

    it('should round to precision when setting value', () => {
      const component = () =>
        NumberInput({
          defaultValue: 3.14159,
          precision: 2,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.value).toBe('3.14');
    });

    it('should handle precision with increment', () => {
      const component = () =>
        NumberInput({
          defaultValue: 0,
          step: 0.01,
          precision: 2,
          children: [
            NumberInputField({}),
            NumberInputIncrement({}),
          ],
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-increment]') as HTMLButtonElement;
      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      button.click();
      expect(input.value).toBe('0.01');
    });
  });

  describe('Increment Button', () => {
    it('should increment value when clicked', () => {
      const component = () =>
        NumberInput({
          defaultValue: 5,
          children: [
            NumberInputField({}),
            NumberInputIncrement({}),
          ],
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-increment]') as HTMLButtonElement;
      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      button.click();
      expect(input.value).toBe('6');
    });

    it('should be disabled when value is at max', () => {
      const component = () =>
        NumberInput({
          defaultValue: 100,
          max: 100,
          children: NumberInputIncrement({}),
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-increment]') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('should be enabled when value is below max', () => {
      const component = () =>
        NumberInput({
          defaultValue: 50,
          max: 100,
          children: NumberInputIncrement({}),
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-increment]') as HTMLButtonElement;
      expect(button.disabled).toBe(false);
    });

    it('should not increment beyond max', () => {
      const component = () =>
        NumberInput({
          defaultValue: 99,
          max: 100,
          step: 5,
          children: [
            NumberInputField({}),
            NumberInputIncrement({}),
          ],
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-increment]') as HTMLButtonElement;
      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      button.click();
      // Should be clamped to 100 instead of 104
      expect(input.value).toBe('100');
    });

    it('should have aria-label', () => {
      const component = () =>
        NumberInput({
          children: NumberInputIncrement({}),
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-increment]') as HTMLButtonElement;
      expect(button.getAttribute('aria-label')).toBe('Increment');
    });
  });

  describe('Decrement Button', () => {
    it('should decrement value when clicked', () => {
      const component = () =>
        NumberInput({
          defaultValue: 5,
          children: [
            NumberInputField({}),
            NumberInputDecrement({}),
          ],
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-decrement]') as HTMLButtonElement;
      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      button.click();
      expect(input.value).toBe('4');
    });

    it('should be disabled when value is at min', () => {
      const component = () =>
        NumberInput({
          defaultValue: 0,
          min: 0,
          children: NumberInputDecrement({}),
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-decrement]') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('should be enabled when value is above min', () => {
      const component = () =>
        NumberInput({
          defaultValue: 50,
          min: 0,
          children: NumberInputDecrement({}),
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-decrement]') as HTMLButtonElement;
      expect(button.disabled).toBe(false);
    });

    it('should not decrement below min', () => {
      const component = () =>
        NumberInput({
          defaultValue: 5,
          min: 0,
          step: 10,
          children: [
            NumberInputField({}),
            NumberInputDecrement({}),
          ],
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-decrement]') as HTMLButtonElement;
      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      button.click();
      // Should be clamped to 0 instead of -5
      expect(input.value).toBe('0');
    });

    it('should have aria-label', () => {
      const component = () =>
        NumberInput({
          children: NumberInputDecrement({}),
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-decrement]') as HTMLButtonElement;
      expect(button.getAttribute('aria-label')).toBe('Decrement');
    });
  });

  describe('Disabled State', () => {
    it('should set disabled attribute on root', () => {
      const component = () =>
        NumberInput({
          disabled: true,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const root = container.querySelector('[data-number-input]');
      expect(root?.hasAttribute('data-disabled')).toBe(true);
    });

    it('should disable input field', () => {
      const component = () =>
        NumberInput({
          disabled: true,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.disabled).toBe(true);
    });

    it('should disable increment button', () => {
      const component = () =>
        NumberInput({
          disabled: true,
          children: NumberInputIncrement({}),
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-increment]') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('should disable decrement button', () => {
      const component = () =>
        NumberInput({
          disabled: true,
          children: NumberInputDecrement({}),
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-decrement]') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('should not increment when disabled', () => {
      const component = () =>
        NumberInput({
          disabled: true,
          defaultValue: 5,
          children: [
            NumberInputField({}),
            NumberInputIncrement({}),
          ],
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-increment]') as HTMLButtonElement;
      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      button.click();
      expect(input.value).toBe('5');
    });

    it('should not decrement when disabled', () => {
      const component = () =>
        NumberInput({
          disabled: true,
          defaultValue: 5,
          children: [
            NumberInputField({}),
            NumberInputDecrement({}),
          ],
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-decrement]') as HTMLButtonElement;
      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      button.click();
      expect(input.value).toBe('5');
    });
  });

  describe('ReadOnly State', () => {
    it('should set readonly attribute on root', () => {
      const component = () =>
        NumberInput({
          readonly: true,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const root = container.querySelector('[data-number-input]');
      expect(root?.hasAttribute('data-readonly')).toBe(true);
    });

    it('should set readonly on input field', () => {
      const component = () =>
        NumberInput({
          readonly: true,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.readOnly).toBe(true);
    });

    it('should disable increment button when readonly', () => {
      const component = () =>
        NumberInput({
          readonly: true,
          children: NumberInputIncrement({}),
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-increment]') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('should disable decrement button when readonly', () => {
      const component = () =>
        NumberInput({
          readonly: true,
          children: NumberInputDecrement({}),
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-decrement]') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });

    it('should not increment when readonly', () => {
      const component = () =>
        NumberInput({
          readonly: true,
          defaultValue: 5,
          children: [
            NumberInputField({}),
            NumberInputIncrement({}),
          ],
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-increment]') as HTMLButtonElement;
      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      button.click();
      expect(input.value).toBe('5');
    });

    it('should not decrement when readonly', () => {
      const component = () =>
        NumberInput({
          readonly: true,
          defaultValue: 5,
          children: [
            NumberInputField({}),
            NumberInputDecrement({}),
          ],
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-decrement]') as HTMLButtonElement;
      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      button.click();
      expect(input.value).toBe('5');
    });
  });

  describe('Keyboard Navigation', () => {
    it('should increment on ArrowUp', () => {
      const component = () =>
        NumberInput({
          defaultValue: 50,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
      input.dispatchEvent(event);

      expect(input.value).toBe('51');
    });

    it('should decrement on ArrowDown', () => {
      const component = () =>
        NumberInput({
          defaultValue: 50,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
      input.dispatchEvent(event);

      expect(input.value).toBe('49');
    });

    it('should increment by 10 steps on PageUp', () => {
      const component = () =>
        NumberInput({
          defaultValue: 50,
          step: 1,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      const event = new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true });
      input.dispatchEvent(event);

      expect(input.value).toBe('60');
    });

    it('should decrement by 10 steps on PageDown', () => {
      const component = () =>
        NumberInput({
          defaultValue: 50,
          step: 1,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      const event = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true });
      input.dispatchEvent(event);

      expect(input.value).toBe('40');
    });

    it('should jump to min on Home', () => {
      const component = () =>
        NumberInput({
          min: 10,
          max: 100,
          defaultValue: 50,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      const event = new KeyboardEvent('keydown', { key: 'Home', bubbles: true });
      input.dispatchEvent(event);

      expect(input.value).toBe('10');
    });

    it('should jump to max on End', () => {
      const component = () =>
        NumberInput({
          min: 0,
          max: 100,
          defaultValue: 50,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      const event = new KeyboardEvent('keydown', { key: 'End', bubbles: true });
      input.dispatchEvent(event);

      expect(input.value).toBe('100');
    });

    it('should prevent default on handled keys', () => {
      const component = () =>
        NumberInput({
          defaultValue: 50,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
      const spy = vi.spyOn(event, 'preventDefault');
      input.dispatchEvent(event);

      expect(spy).toHaveBeenCalled();
    });

    it('should not respond to keyboard when disabled', () => {
      const component = () =>
        NumberInput({
          disabled: true,
          defaultValue: 50,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
      input.dispatchEvent(event);

      expect(input.value).toBe('50');
    });

    it('should not respond to keyboard when readonly', () => {
      const component = () =>
        NumberInput({
          readonly: true,
          defaultValue: 50,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
      input.dispatchEvent(event);

      expect(input.value).toBe('50');
    });

    it('should not exceed max on keyboard increment', () => {
      const component = () =>
        NumberInput({
          max: 100,
          defaultValue: 100,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
      input.dispatchEvent(event);

      expect(input.value).toBe('100');
    });

    it('should not go below min on keyboard decrement', () => {
      const component = () =>
        NumberInput({
          min: 0,
          defaultValue: 0,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
      input.dispatchEvent(event);

      expect(input.value).toBe('0');
    });
  });

  describe('Manual Input', () => {
    it('should update value on input', () => {
      const component = () =>
        NumberInput({
          defaultValue: 0,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      input.value = '42';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(input.value).toBe('42');
    });

    it('should parse numeric string input', () => {
      const onValueChange = createSpy();

      const component = () =>
        NumberInput({
          defaultValue: 0,
          onValueChange,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      input.value = '123';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(onValueChange.calls[0][0]).toBe(123);
    });

    it('should handle negative input', () => {
      const component = () =>
        NumberInput({
          defaultValue: 0,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      input.value = '-50';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(input.value).toBe('-50');
    });

    it('should handle decimal input', () => {
      const component = () =>
        NumberInput({
          defaultValue: 0,
          precision: 2,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      input.value = '3.14';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(input.value).toBe('3.14');
    });

    it('should handle invalid input as 0', () => {
      const onValueChange = createSpy();

      const component = () =>
        NumberInput({
          defaultValue: 10,
          onValueChange,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      input.value = 'abc';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(onValueChange.calls[0][0]).toBe(0);
    });
  });

  describe('Format Options', () => {
    it('should format as decimal by default', () => {
      const component = () =>
        NumberInput({
          defaultValue: 42,
          precision: 0,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.value).toBe('42');
    });

    it('should format as currency', () => {
      const component = () =>
        NumberInput({
          defaultValue: 99.99,
          precision: 2,
          format: 'currency',
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.value).toBe('$99.99');
    });

    it('should format as percentage', () => {
      const component = () =>
        NumberInput({
          defaultValue: 75,
          precision: 0,
          format: 'percentage',
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.value).toBe('75%');
    });

    it('should parse currency input', () => {
      const onValueChange = createSpy();

      const component = () =>
        NumberInput({
          defaultValue: 0,
          format: 'currency',
          precision: 2,
          onValueChange,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      input.value = '$100.00';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(onValueChange.calls[0][0]).toBe(100);
    });

    it('should parse percentage input', () => {
      const onValueChange = createSpy();

      const component = () =>
        NumberInput({
          defaultValue: 0,
          format: 'percentage',
          onValueChange,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      input.value = '50%';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(onValueChange.calls[0][0]).toBe(50);
    });
  });

  describe('Accessibility', () => {
    it('should have role="group" on root', () => {
      const component = () =>
        NumberInput({
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const root = container.querySelector('[data-number-input]');
      expect(root?.getAttribute('role')).toBe('group');
    });

    it('should have inputMode="numeric" on input', () => {
      const component = () =>
        NumberInput({
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]');
      expect(input?.getAttribute('inputMode')).toBe('numeric');
    });

    it('should have aria-valuemin on input', () => {
      const component = () =>
        NumberInput({
          min: 0,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]');
      expect(input?.getAttribute('aria-valuemin')).toBe('0');
    });

    it('should have aria-valuemax on input', () => {
      const component = () =>
        NumberInput({
          max: 100,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]');
      expect(input?.getAttribute('aria-valuemax')).toBe('100');
    });

    it('should have aria-valuenow on input', () => {
      const component = () =>
        NumberInput({
          defaultValue: 42,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]');
      expect(input?.getAttribute('aria-valuenow')).toBe('42');
    });

    it('should update aria-valuenow when value changes', () => {
      const value = signal(30);

      const component = () =>
        NumberInput({
          value: value as any, // Pass signal directly, not value()
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]');
      expect(input?.getAttribute('aria-valuenow')).toBe('30');

      value.set(60);
      expect(input?.getAttribute('aria-valuenow')).toBe('60');
    });

    it('should have aria-label on increment button', () => {
      const component = () =>
        NumberInput({
          children: NumberInputIncrement({}),
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-increment]');
      expect(button?.getAttribute('aria-label')).toBe('Increment');
    });

    it('should have aria-label on decrement button', () => {
      const component = () =>
        NumberInput({
          children: NumberInputDecrement({}),
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-decrement]');
      expect(button?.getAttribute('aria-label')).toBe('Decrement');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large numbers', () => {
      const component = () =>
        NumberInput({
          defaultValue: 999999999,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.value).toBe('999999999');
    });

    it('should handle very small numbers', () => {
      const component = () =>
        NumberInput({
          defaultValue: 0.0001,
          precision: 4,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.value).toBe('0.0001');
    });

    it('should handle zero', () => {
      const component = () =>
        NumberInput({
          defaultValue: 0,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.value).toBe('0');
    });

    it('should handle negative zero', () => {
      const component = () =>
        NumberInput({
          defaultValue: -0,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.value).toBe('0');
    });

    it('should handle negative numbers', () => {
      const component = () =>
        NumberInput({
          defaultValue: -100,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.value).toBe('-100');
    });

    it('should handle min equals max', () => {
      const component = () =>
        NumberInput({
          min: 50,
          max: 50,
          defaultValue: 50,
          children: [
            NumberInputField({}),
            NumberInputIncrement({}),
            NumberInputDecrement({}),
          ],
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      const incrementBtn = container.querySelector('[data-number-input-increment]') as HTMLButtonElement;
      const decrementBtn = container.querySelector('[data-number-input-decrement]') as HTMLButtonElement;

      expect(input.value).toBe('50');
      expect(incrementBtn.disabled).toBe(true);
      expect(decrementBtn.disabled).toBe(true);
    });

    it('should handle negative min and max', () => {
      const component = () =>
        NumberInput({
          min: -100,
          max: -10,
          defaultValue: -50,
          children: NumberInputField({}),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.value).toBe('-50');
      expect(input.getAttribute('aria-valuemin')).toBe('-100');
      expect(input.getAttribute('aria-valuemax')).toBe('-10');
    });

    it('should handle floating point precision issues', () => {
      const component = () =>
        NumberInput({
          defaultValue: 0.1,
          step: 0.1,
          precision: 1,
          children: [
            NumberInputField({}),
            NumberInputIncrement({}),
          ],
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-increment]') as HTMLButtonElement;
      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;

      button.click();
      button.click();

      // Should be 0.3, not 0.30000000000000004
      expect(input.value).toBe('0.3');
    });
  });

  describe('Custom Props Pass-through', () => {
    it('should pass custom props to input field', () => {
      const component = () =>
        NumberInput({
          children: NumberInputField({
            'data-testid': 'custom-input',
            class: 'my-input',
          }),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLElement;
      expect(input.getAttribute('data-testid')).toBe('custom-input');
      expect(input.classList.contains('my-input')).toBe(true);
    });

    it('should pass custom props to increment button', () => {
      const component = () =>
        NumberInput({
          children: NumberInputIncrement({
            'data-testid': 'inc-button',
            class: 'inc-btn',
          }),
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-increment]') as HTMLElement;
      expect(button.getAttribute('data-testid')).toBe('inc-button');
      expect(button.classList.contains('inc-btn')).toBe(true);
    });

    it('should pass custom props to decrement button', () => {
      const component = () =>
        NumberInput({
          children: NumberInputDecrement({
            'data-testid': 'dec-button',
            class: 'dec-btn',
          }),
        });

      const { container } = render(component);

      const button = container.querySelector('[data-number-input-decrement]') as HTMLElement;
      expect(button.getAttribute('data-testid')).toBe('dec-button');
      expect(button.classList.contains('dec-btn')).toBe(true);
    });
  });

  describe('Real-world Scenarios', () => {
    it('should work as quantity selector', () => {
      const component = () =>
        NumberInput({
          min: 1,
          max: 99,
          defaultValue: 1,
          step: 1,
          children: [
            NumberInputDecrement({ children: '-' }),
            NumberInputField({}),
            NumberInputIncrement({ children: '+' }),
          ],
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      const incBtn = container.querySelector('[data-number-input-increment]') as HTMLButtonElement;
      const decBtn = container.querySelector('[data-number-input-decrement]') as HTMLButtonElement;

      expect(input.value).toBe('1');
      expect(decBtn.disabled).toBe(true);
      expect(incBtn.disabled).toBe(false);

      incBtn.click();
      expect(input.value).toBe('2');
      expect(decBtn.disabled).toBe(false);
    });

    it('should work as price input', () => {
      const component = () =>
        NumberInput({
          min: 0,
          step: 0.01,
          precision: 2,
          format: 'currency',
          defaultValue: 19.99,
          children: [
            NumberInputField({ placeholder: '$0.00' }),
            NumberInputIncrement({}),
            NumberInputDecrement({}),
          ],
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.value).toBe('$19.99');
    });

    it('should work as percentage input', () => {
      const component = () =>
        NumberInput({
          min: 0,
          max: 100,
          step: 1,
          format: 'percentage',
          defaultValue: 50,
          children: [
            NumberInputField({}),
            NumberInputIncrement({}),
            NumberInputDecrement({}),
          ],
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.value).toBe('50%');
    });

    it('should work with form', () => {
      const component = () =>
        NumberInput({
          defaultValue: 42,
          children: NumberInputField({ name: 'quantity' }),
        });

      const { container } = render(component);

      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input.name).toBe('quantity');
      expect(input.value).toBe('42');
    });
  });
});
