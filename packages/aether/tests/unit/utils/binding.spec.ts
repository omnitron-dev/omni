import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal';
import {
  bindValue,
  bindNumber,
  bindTrimmed,
  bindDebounced,
  bindThrottled,
  bindLazy,
  bindChecked,
  bindGroup,
  bindSelect,
} from '../../../src/utils/binding';

describe('Binding Utilities', () => {
  describe('bindValue', () => {
    it('should create two-way binding props', () => {
      const text = signal('initial');
      const binding = bindValue(text);

      expect(binding.value).toBe('initial');
      expect(typeof binding.onInput).toBe('function');
    });

    it('should update signal on input', () => {
      const text = signal('');
      const binding = bindValue(text);

      const input = document.createElement('input');
      input.value = 'new value';

      const event = new Event('input');
      Object.defineProperty(event, 'currentTarget', {
        value: input,
        enumerable: true,
      });

      binding.onInput(event);

      expect(text()).toBe('new value');
    });

    it('should apply transform function', () => {
      const text = signal('');
      const binding = bindValue(text, (v) => v.toUpperCase());

      const input = document.createElement('input');
      input.value = 'hello';

      const event = new Event('input');
      Object.defineProperty(event, 'currentTarget', {
        value: input,
        enumerable: true,
      });

      binding.onInput(event);

      expect(text()).toBe('HELLO');
    });
  });

  describe('bindNumber', () => {
    it('should convert string to number', () => {
      const age = signal(0);
      const binding = bindNumber(age);

      const input = document.createElement('input');
      input.value = '25';

      const event = new Event('input');
      Object.defineProperty(event, 'currentTarget', {
        value: input,
        enumerable: true,
      });

      binding.onInput(event);

      expect(age()).toBe(25);
    });

    it('should not update signal for invalid numbers', () => {
      const age = signal(10);
      const binding = bindNumber(age);

      const input = document.createElement('input');
      input.value = 'not a number';

      const event = new Event('input');
      Object.defineProperty(event, 'currentTarget', {
        value: input,
        enumerable: true,
      });

      binding.onInput(event);

      expect(age()).toBe(10); // Unchanged
    });
  });

  describe('bindTrimmed', () => {
    it('should trim whitespace from input', () => {
      const name = signal('');
      const binding = bindTrimmed(name);

      const input = document.createElement('input');
      input.value = '  hello  ';

      const event = new Event('input');
      Object.defineProperty(event, 'currentTarget', {
        value: input,
        enumerable: true,
      });

      binding.onInput(event);

      expect(name()).toBe('hello');
    });
  });

  describe('bindDebounced', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('should debounce updates', () => {
      const search = signal('');
      const binding = bindDebounced(search, 500);

      const input = document.createElement('input');

      // First input
      input.value = 'h';
      let event = new Event('input');
      Object.defineProperty(event, 'currentTarget', {
        value: input,
        enumerable: true,
      });
      binding.onInput(event);

      expect(search()).toBe(''); // Not updated yet

      // Second input before delay
      input.value = 'he';
      event = new Event('input');
      Object.defineProperty(event, 'currentTarget', {
        value: input,
        enumerable: true,
      });
      binding.onInput(event);

      vi.advanceTimersByTime(500);

      expect(search()).toBe('he');

      vi.useRealTimers();
    });
  });

  describe('bindThrottled', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('should throttle updates', () => {
      const value = signal('');
      const binding = bindThrottled(value, 300);

      const input = document.createElement('input');

      // First input - should update immediately
      input.value = 'a';
      let event = new Event('input');
      Object.defineProperty(event, 'currentTarget', {
        value: input,
        enumerable: true,
      });
      binding.onInput(event);

      expect(value()).toBe('a');

      // Second input - should be throttled
      input.value = 'ab';
      event = new Event('input');
      Object.defineProperty(event, 'currentTarget', {
        value: input,
        enumerable: true,
      });
      binding.onInput(event);

      expect(value()).toBe('a'); // Still 'a'

      // After throttle period
      vi.advanceTimersByTime(300);

      input.value = 'abc';
      event = new Event('input');
      Object.defineProperty(event, 'currentTarget', {
        value: input,
        enumerable: true,
      });
      binding.onInput(event);

      expect(value()).toBe('abc');

      vi.useRealTimers();
    });
  });

  describe('bindLazy', () => {
    it('should update on blur instead of input', () => {
      const name = signal('initial');
      const binding = bindLazy(name);

      expect(binding.value).toBe('initial');
      expect(typeof binding.onBlur).toBe('function');

      const input = document.createElement('input');
      input.value = 'new value';

      const event = new Event('blur');
      Object.defineProperty(event, 'currentTarget', {
        value: input,
        enumerable: true,
      });

      binding.onBlur(event);

      expect(name()).toBe('new value');
    });
  });

  describe('bindChecked', () => {
    it('should bind to checkbox checked state', () => {
      const agreed = signal(false);
      const binding = bindChecked(agreed);

      expect(binding.checked).toBe(false);
      expect(typeof binding.onChange).toBe('function');
    });

    it('should update signal on change', () => {
      const agreed = signal(false);
      const binding = bindChecked(agreed);

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;

      const event = new Event('change');
      Object.defineProperty(event, 'currentTarget', {
        value: checkbox,
        enumerable: true,
      });

      binding.onChange(event);

      expect(agreed()).toBe(true);
    });
  });

  describe('bindGroup', () => {
    it('should bind to radio group', () => {
      const selected = signal('option1');
      const binding = bindGroup(selected, 'option2');

      expect(binding.checked).toBe(false);

      const selected2 = signal('option2');
      const binding2 = bindGroup(selected2, 'option2');

      expect(binding2.checked).toBe(true);
    });

    it('should update signal when radio is checked', () => {
      const selected = signal('option1');
      const binding = bindGroup(selected, 'option2');

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.checked = true;

      const event = new Event('change');
      Object.defineProperty(event, 'currentTarget', {
        value: radio,
        enumerable: true,
      });

      binding.onChange(event);

      expect(selected()).toBe('option2');
    });

    it('should not update signal when radio is unchecked', () => {
      const selected = signal('option1');
      const binding = bindGroup(selected, 'option2');

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.checked = false;

      const event = new Event('change');
      Object.defineProperty(event, 'currentTarget', {
        value: radio,
        enumerable: true,
      });

      binding.onChange(event);

      expect(selected()).toBe('option1'); // Unchanged
    });
  });

  describe('bindSelect', () => {
    it('should bind to select element', () => {
      const selection = signal('option1');
      const binding = bindSelect(selection);

      expect(binding.value).toBe('option1');
      expect(typeof binding.onChange).toBe('function');
    });

    it('should update signal on change', () => {
      const selection = signal('option1');
      const binding = bindSelect(selection);

      const select = document.createElement('select');
      const option1 = document.createElement('option');
      option1.value = 'option1';
      const option2 = document.createElement('option');
      option2.value = 'option2';
      select.appendChild(option1);
      select.appendChild(option2);
      select.value = 'option2';

      const event = new Event('change');
      Object.defineProperty(event, 'currentTarget', {
        value: select,
        enumerable: true,
      });

      binding.onChange(event);

      expect(selection()).toBe('option2');
    });

    it('should apply transform function', () => {
      const numSelection = signal(1);
      const binding = bindSelect(numSelection, Number);

      const select = document.createElement('select');
      const option = document.createElement('option');
      option.value = '42';
      select.appendChild(option);
      select.value = '42';

      const event = new Event('change');
      Object.defineProperty(event, 'currentTarget', {
        value: select,
        enumerable: true,
      });

      binding.onChange(event);

      expect(numSelection()).toBe(42);
    });
  });
});
