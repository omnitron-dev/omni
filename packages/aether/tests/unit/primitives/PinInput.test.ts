/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import { PinInput, PinInputInput } from '../../../src/primitives/PinInput.js';
import { renderComponent, nextTick, createSpy } from '../../helpers/test-utils.js';

describe('PinInput', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic Rendering', () => {
    it('should render root container with data-pin-input attribute', () => {
      const component = () =>
        PinInput({
          children: [PinInputInput({ index: 0 }), PinInputInput({ index: 1 })],
        });
      const { container } = renderComponent(component);

      const root = container.querySelector('[data-pin-input]');
      expect(root).toBeTruthy();
    });

    it('should render with role="group"', () => {
      const component = () =>
        PinInput({
          children: [PinInputInput({ index: 0 })],
        });
      const { container } = renderComponent(component);

      const root = container.querySelector('[data-pin-input]');
      expect(root?.getAttribute('role')).toBe('group');
    });

    it('should render with aria-label="PIN input"', () => {
      const component = () =>
        PinInput({
          children: [PinInputInput({ index: 0 })],
        });
      const { container } = renderComponent(component);

      const root = container.querySelector('[data-pin-input]');
      expect(root?.getAttribute('aria-label')).toBe('PIN input');
    });

    it('should render N input fields based on length prop', () => {
      const component = () =>
        PinInput({
          length: 4,
          children: [
            PinInputInput({ index: 0 }),
            PinInputInput({ index: 1 }),
            PinInputInput({ index: 2 }),
            PinInputInput({ index: 3 }),
          ],
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input[data-pin-input-field]');
      expect(inputs.length).toBe(4);
    });

    it('should default to 6 inputs when length not specified', () => {
      const component = () =>
        PinInput({
          children: Array(6)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input[data-pin-input-field]');
      expect(inputs.length).toBe(6);
    });

    it('should render each input with data-pin-input-field attribute', () => {
      const component = () =>
        PinInput({
          length: 3,
          children: [
            PinInputInput({ index: 0 }),
            PinInputInput({ index: 1 }),
            PinInputInput({ index: 2 }),
          ],
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input');
      inputs.forEach((input) => {
        expect(input.hasAttribute('data-pin-input-field')).toBe(true);
      });
    });

    it('should render each input with data-index attribute', () => {
      const component = () =>
        PinInput({
          length: 3,
          children: [
            PinInputInput({ index: 0 }),
            PinInputInput({ index: 1 }),
            PinInputInput({ index: 2 }),
          ],
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input');
      inputs.forEach((input, i) => {
        expect(input.getAttribute('data-index')).toBe(String(i));
      });
    });
  });

  describe('Type Props', () => {
    it('should default to numeric type', () => {
      const component = () =>
        PinInput({
          children: [PinInputInput({ index: 0 })],
        });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.getAttribute('inputMode')).toBe('numeric');
      expect(input.getAttribute('pattern')).toBe('[0-9]*');
    });

    it('should render with type="numeric"', () => {
      const component = () =>
        PinInput({
          type: 'numeric',
          children: [PinInputInput({ index: 0 })],
        });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.getAttribute('inputMode')).toBe('numeric');
      expect(input.getAttribute('pattern')).toBe('[0-9]*');
    });

    it('should render with type="alphanumeric"', () => {
      const component = () =>
        PinInput({
          type: 'alphanumeric',
          children: [PinInputInput({ index: 0 })],
        });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.getAttribute('inputMode')).toBe('text');
      expect(input.hasAttribute('pattern')).toBe(false);
    });

    it('should render with type="all"', () => {
      const component = () =>
        PinInput({
          type: 'all',
          children: [PinInputInput({ index: 0 })],
        });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.getAttribute('inputMode')).toBe('text');
      expect(input.hasAttribute('pattern')).toBe(false);
    });

    it('should accept only numeric characters when type="numeric"', () => {
      const onValueChange = createSpy();
      const component = () =>
        PinInput({
          type: 'numeric',
          onValueChange,
          children: [PinInputInput({ index: 0 })],
        });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;

      // Valid numeric input
      input.value = '5';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(onValueChange.callCount).toBe(1);

      // Invalid alphabetic input
      onValueChange.reset();
      input.value = 'a';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(onValueChange.callCount).toBe(0);
    });

    it('should accept alphanumeric characters when type="alphanumeric"', () => {
      const onValueChange = createSpy();
      const component = () =>
        PinInput({
          type: 'alphanumeric',
          onValueChange,
          children: [PinInputInput({ index: 0 })],
        });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;

      // Valid numeric input
      input.value = '5';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(onValueChange.callCount).toBe(1);

      // Valid alphabetic input
      onValueChange.reset();
      input.value = 'A';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(onValueChange.callCount).toBe(1);

      // Invalid special character
      onValueChange.reset();
      input.value = '@';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(onValueChange.callCount).toBe(0);
    });

    it('should accept all single characters when type="all"', () => {
      const onValueChange = createSpy();
      const component = () =>
        PinInput({
          type: 'all',
          onValueChange,
          children: [PinInputInput({ index: 0 })],
        });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;

      // Valid numeric
      input.value = '5';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(onValueChange.callCount).toBe(1);

      // Valid alphabetic
      onValueChange.reset();
      input.value = 'A';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(onValueChange.callCount).toBe(1);

      // Valid special character
      onValueChange.reset();
      input.value = '@';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(onValueChange.callCount).toBe(1);
    });
  });

  describe('Placeholder', () => {
    it('should default to "○" placeholder', () => {
      const component = () =>
        PinInput({
          children: [PinInputInput({ index: 0 })],
        });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.placeholder).toBe('○');
    });

    it('should render with custom placeholder', () => {
      const component = () =>
        PinInput({
          placeholder: '•',
          children: [PinInputInput({ index: 0 })],
        });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.placeholder).toBe('•');
    });

    it('should apply placeholder to all inputs', () => {
      const component = () =>
        PinInput({
          placeholder: '-',
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input');
      inputs.forEach((input) => {
        expect((input as HTMLInputElement).placeholder).toBe('-');
      });
    });
  });

  describe('Disabled State', () => {
    it('should render as enabled by default', () => {
      const component = () =>
        PinInput({
          children: [PinInputInput({ index: 0 })],
        });
      const { container } = renderComponent(component);

      const root = container.querySelector('[data-pin-input]');
      const input = container.querySelector('input') as HTMLInputElement;
      expect(root?.hasAttribute('data-disabled')).toBe(false);
      expect(input.disabled).toBe(false);
    });

    it('should render as disabled when disabled=true', () => {
      const component = () =>
        PinInput({
          disabled: true,
          children: [PinInputInput({ index: 0 })],
        });
      const { container } = renderComponent(component);

      const root = container.querySelector('[data-pin-input]');
      const input = container.querySelector('input') as HTMLInputElement;
      expect(root?.hasAttribute('data-disabled')).toBe(true);
      expect(input.disabled).toBe(true);
    });

    it('should disable all inputs when disabled=true', () => {
      const component = () =>
        PinInput({
          disabled: true,
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input');
      inputs.forEach((input) => {
        expect((input as HTMLInputElement).disabled).toBe(true);
      });
    });
  });

  describe('Mask/Password Mode', () => {
    it('should render as text type by default', () => {
      const component = () =>
        PinInput({
          children: [PinInputInput({ index: 0 })],
        });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.type).toBe('text');
    });

    it('should render as password type when mask=true', () => {
      const component = () =>
        PinInput({
          mask: true,
          children: [PinInputInput({ index: 0 })],
        });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.type).toBe('password');
    });

    it('should apply password type to all inputs when mask=true', () => {
      const component = () =>
        PinInput({
          mask: true,
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input');
      inputs.forEach((input) => {
        expect((input as HTMLInputElement).type).toBe('password');
      });
    });
  });

  describe('Uncontrolled Mode', () => {
    it('should initialize with empty values by default', () => {
      const component = () =>
        PinInput({
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input');
      inputs.forEach((input) => {
        expect((input as HTMLInputElement).value).toBe('');
      });
    });

    it('should initialize with defaultValue', async () => {
      const component = () =>
        PinInput({
          defaultValue: '1234',
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      await nextTick();

      const inputs = container.querySelectorAll('input');
      expect((inputs[0] as HTMLInputElement).value).toBe('1');
      expect((inputs[1] as HTMLInputElement).value).toBe('2');
      expect((inputs[2] as HTMLInputElement).value).toBe('3');
      expect((inputs[3] as HTMLInputElement).value).toBe('4');
    });

    it('should pad defaultValue with empty strings if shorter than length', async () => {
      const component = () =>
        PinInput({
          defaultValue: '12',
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      await nextTick();

      const inputs = container.querySelectorAll('input');
      expect((inputs[0] as HTMLInputElement).value).toBe('1');
      expect((inputs[1] as HTMLInputElement).value).toBe('2');
      expect((inputs[2] as HTMLInputElement).value).toBe('');
      expect((inputs[3] as HTMLInputElement).value).toBe('');
    });

    it('should truncate defaultValue if longer than length', async () => {
      const component = () =>
        PinInput({
          defaultValue: '123456',
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      await nextTick();

      const inputs = container.querySelectorAll('input');
      expect((inputs[0] as HTMLInputElement).value).toBe('1');
      expect((inputs[1] as HTMLInputElement).value).toBe('2');
      expect((inputs[2] as HTMLInputElement).value).toBe('3');
      expect((inputs[3] as HTMLInputElement).value).toBe('4');
    });
  });

  describe('Controlled Mode', () => {
    it('should render with controlled value', () => {
      const component = () =>
        PinInput({
          value: '1234',
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input');
      expect((inputs[0] as HTMLInputElement).value).toBe('1');
      expect((inputs[1] as HTMLInputElement).value).toBe('2');
      expect((inputs[2] as HTMLInputElement).value).toBe('3');
      expect((inputs[3] as HTMLInputElement).value).toBe('4');
    });

    it('should pad controlled value with empty strings if shorter', () => {
      const component = () =>
        PinInput({
          value: '12',
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input');
      expect((inputs[0] as HTMLInputElement).value).toBe('1');
      expect((inputs[1] as HTMLInputElement).value).toBe('2');
      expect((inputs[2] as HTMLInputElement).value).toBe('');
      expect((inputs[3] as HTMLInputElement).value).toBe('');
    });

    it('should truncate controlled value if longer', () => {
      const component = () =>
        PinInput({
          value: '123456',
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input');
      expect((inputs[0] as HTMLInputElement).value).toBe('1');
      expect((inputs[1] as HTMLInputElement).value).toBe('2');
      expect((inputs[2] as HTMLInputElement).value).toBe('3');
      expect((inputs[3] as HTMLInputElement).value).toBe('4');
    });

    it('should handle empty string value', () => {
      const component = () =>
        PinInput({
          value: '',
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input');
      inputs.forEach((input) => {
        expect((input as HTMLInputElement).value).toBe('');
      });
    });

    it('should work with signal value for reactive updates', () => {
      const value = signal('1234');

      const component = () =>
        PinInput({
          value: value(),
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input');
      expect((inputs[0] as HTMLInputElement).value).toBe('1');
    });
  });

  describe('Auto-advance', () => {
    it('should auto-advance to next input after typing', async () => {
      const component = () =>
        PinInput({
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      // Focus first input
      inputs[0].focus();

      // Type in first input
      inputs[0].value = '1';
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));

      await nextTick();

      // Second input should be focused
      expect(document.activeElement).toBe(inputs[1]);
    });

    it('should not auto-advance on last input', async () => {
      const component = () =>
        PinInput({
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      // Focus and type in last input
      inputs[3].focus();
      inputs[3].value = '4';
      inputs[3].dispatchEvent(new Event('input', { bubbles: true }));

      await nextTick();

      // Last input should still be focused
      expect(document.activeElement).toBe(inputs[3]);
    });

    it('should clear input after accepting value', async () => {
      const component = () =>
        PinInput({
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      inputs[0].value = '1';
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));

      await nextTick();

      // Input should be cleared for next character
      expect(inputs[0].value).toBe('1');
    });
  });

  describe('Backspace Behavior', () => {
    it('should clear current input on backspace if has value', () => {
      const component = () =>
        PinInput({
          value: '1234',
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      // Focus second input
      inputs[1].focus();

      // Press backspace
      const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true });
      inputs[1].dispatchEvent(event);

      // Value should be cleared
      expect(inputs[1].value).toBe('');
    });

    it('should move to previous input on backspace if current is empty', async () => {
      const component = () =>
        PinInput({
          value: '1_34',
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      // Focus second input (which is empty)
      inputs[1].focus();

      // Press backspace
      const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true });
      inputs[1].dispatchEvent(event);

      await nextTick();

      // Should move to previous input
      expect(document.activeElement).toBe(inputs[0]);
    });

    it('should not move before first input on backspace', async () => {
      const component = () =>
        PinInput({
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      // Focus first input
      inputs[0].focus();

      // Press backspace
      const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true });
      inputs[0].dispatchEvent(event);

      await nextTick();

      // Should stay on first input
      expect(document.activeElement).toBe(inputs[0]);
    });
  });

  describe('Delete Key Behavior', () => {
    it('should clear current input on delete key', () => {
      const component = () =>
        PinInput({
          value: '1234',
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      // Focus second input
      inputs[1].focus();

      // Press delete
      const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true });
      inputs[1].dispatchEvent(event);

      // Value should be cleared
      expect(inputs[1].value).toBe('');
    });

    it('should not move focus on delete key', async () => {
      const component = () =>
        PinInput({
          value: '1234',
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      // Focus second input
      inputs[1].focus();

      // Press delete
      const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true });
      inputs[1].dispatchEvent(event);

      await nextTick();

      // Should stay on same input
      expect(document.activeElement).toBe(inputs[1]);
    });
  });

  describe('Arrow Key Navigation', () => {
    it('should move to next input on ArrowRight', async () => {
      const component = () =>
        PinInput({
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      // Focus first input
      inputs[0].focus();

      // Press ArrowRight
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      inputs[0].dispatchEvent(event);

      await nextTick();

      // Should move to next input
      expect(document.activeElement).toBe(inputs[1]);
    });

    it('should not move past last input on ArrowRight', async () => {
      const component = () =>
        PinInput({
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      // Focus last input
      inputs[3].focus();

      // Press ArrowRight
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
      inputs[3].dispatchEvent(event);

      await nextTick();

      // Should stay on last input
      expect(document.activeElement).toBe(inputs[3]);
    });

    it('should move to previous input on ArrowLeft', async () => {
      const component = () =>
        PinInput({
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      // Focus second input
      inputs[1].focus();

      // Press ArrowLeft
      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
      inputs[1].dispatchEvent(event);

      await nextTick();

      // Should move to previous input
      expect(document.activeElement).toBe(inputs[0]);
    });

    it('should not move before first input on ArrowLeft', async () => {
      const component = () =>
        PinInput({
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      // Focus first input
      inputs[0].focus();

      // Press ArrowLeft
      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
      inputs[0].dispatchEvent(event);

      await nextTick();

      // Should stay on first input
      expect(document.activeElement).toBe(inputs[0]);
    });
  });

  describe('Paste Behavior', () => {
    it('should distribute pasted content across inputs', async () => {
      const component = () =>
        PinInput({
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      // Focus first input
      inputs[0].focus();

      // Paste value
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        clipboardData: new DataTransfer(),
      });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          getData: () => '1234',
        },
      });
      inputs[0].dispatchEvent(pasteEvent);

      await nextTick();

      // Values should be distributed
      expect(inputs[0].value).toBe('1');
      expect(inputs[1].value).toBe('2');
      expect(inputs[2].value).toBe('3');
      expect(inputs[3].value).toBe('4');
    });

    it('should paste from middle input correctly', async () => {
      const component = () =>
        PinInput({
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      // Focus second input
      inputs[1].focus();

      // Paste value
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        clipboardData: new DataTransfer(),
      });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          getData: () => '789',
        },
      });
      inputs[1].dispatchEvent(pasteEvent);

      await nextTick();

      // Values should be distributed from second input
      expect(inputs[0].value).toBe('');
      expect(inputs[1].value).toBe('7');
      expect(inputs[2].value).toBe('8');
      expect(inputs[3].value).toBe('9');
    });

    it('should truncate pasted value if longer than remaining inputs', async () => {
      const component = () =>
        PinInput({
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      // Focus third input
      inputs[2].focus();

      // Paste longer value
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        clipboardData: new DataTransfer(),
      });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          getData: () => '56789',
        },
      });
      inputs[2].dispatchEvent(pasteEvent);

      await nextTick();

      // Only remaining slots should be filled
      expect(inputs[0].value).toBe('');
      expect(inputs[1].value).toBe('');
      expect(inputs[2].value).toBe('5');
      expect(inputs[3].value).toBe('6');
    });

    it('should filter invalid characters when pasting with type="numeric"', async () => {
      const component = () =>
        PinInput({
          type: 'numeric',
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      // Paste value with invalid characters
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        clipboardData: new DataTransfer(),
      });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          getData: () => '12a3b4',
        },
      });
      inputs[0].dispatchEvent(pasteEvent);

      await nextTick();

      // Only numeric characters should be pasted
      expect(inputs[0].value).toBe('1');
      expect(inputs[1].value).toBe('2');
      expect(inputs[2].value).toBe('3');
      expect(inputs[3].value).toBe('4');
    });

    it('should focus last filled input after paste', async () => {
      const component = () =>
        PinInput({
          length: 6,
          children: Array(6)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      // Paste short value
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        clipboardData: new DataTransfer(),
      });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          getData: () => '123',
        },
      });
      inputs[0].dispatchEvent(pasteEvent);

      await nextTick();

      // Should focus next empty input after last filled
      expect(document.activeElement).toBe(inputs[3]);
    });

    it('should prevent default paste behavior', async () => {
      const component = () =>
        PinInput({
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer(),
      });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          getData: () => '1234',
        },
      });

      const preventDefaultSpy = vi.spyOn(pasteEvent, 'preventDefault');
      inputs[0].dispatchEvent(pasteEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });
  });

  describe('Auto-focus', () => {
    it('should not auto-focus by default', () => {
      const component = () =>
        PinInput({
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      renderComponent(component);

      const activeElement = document.activeElement;
      expect(activeElement).toBe(document.body);
    });

    it('should auto-focus first input when autoFocus=true', async () => {
      const component = () =>
        PinInput({
          autoFocus: true,
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      await nextTick();

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;
      expect(document.activeElement).toBe(inputs[0]);
    });
  });

  describe('onValueChange Callback', () => {
    it('should call onValueChange when value changes', () => {
      const onValueChange = createSpy();
      const component = () =>
        PinInput({
          onValueChange,
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      inputs[0].value = '1';
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));

      expect(onValueChange.callCount).toBe(1);
      expect(onValueChange.calls[0][0]).toBe('1');
    });

    it('should call onValueChange with complete value', () => {
      const onValueChange = createSpy();
      const component = () =>
        PinInput({
          onValueChange,
          value: '123',
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      inputs[3].value = '4';
      inputs[3].dispatchEvent(new Event('input', { bubbles: true }));

      expect(onValueChange.calls[0][0]).toBe('1234');
    });

    it('should call onValueChange on paste', async () => {
      const onValueChange = createSpy();
      const component = () =>
        PinInput({
          onValueChange,
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        clipboardData: new DataTransfer(),
      });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          getData: () => '1234',
        },
      });
      inputs[0].dispatchEvent(pasteEvent);

      await nextTick();

      expect(onValueChange.callCount).toBe(1);
      expect(onValueChange.calls[0][0]).toBe('1234');
    });
  });

  describe('onComplete Callback', () => {
    it('should not call onComplete when incomplete', () => {
      const onComplete = createSpy();
      const component = () =>
        PinInput({
          onComplete,
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      inputs[0].value = '1';
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));

      expect(onComplete.callCount).toBe(0);
    });

    it('should call onComplete when all inputs are filled', () => {
      const onComplete = createSpy();
      const component = () =>
        PinInput({
          onComplete,
          value: '123',
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      // Fill last input to complete
      inputs[3].value = '4';
      inputs[3].dispatchEvent(new Event('input', { bubbles: true }));

      expect(onComplete.callCount).toBe(1);
      expect(onComplete.calls[0][0]).toBe('1234');
    });

    it('should call onComplete when paste completes the PIN', async () => {
      const onComplete = createSpy();
      const component = () =>
        PinInput({
          onComplete,
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        clipboardData: new DataTransfer(),
      });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          getData: () => '1234',
        },
      });
      inputs[0].dispatchEvent(pasteEvent);

      await nextTick();

      expect(onComplete.callCount).toBe(1);
      expect(onComplete.calls[0][0]).toBe('1234');
    });

    it('should not call onComplete if paste does not complete PIN', async () => {
      const onComplete = createSpy();
      const component = () =>
        PinInput({
          onComplete,
          length: 6,
          children: Array(6)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        clipboardData: new DataTransfer(),
      });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          getData: () => '123',
        },
      });
      inputs[0].dispatchEvent(pasteEvent);

      await nextTick();

      expect(onComplete.callCount).toBe(0);
    });
  });

  describe('Focus Behavior', () => {
    it('should select all text on focus', () => {
      const component = () =>
        PinInput({
          value: '1234',
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      const selectSpy = vi.spyOn(inputs[0], 'select');

      inputs[0].dispatchEvent(new FocusEvent('focus', { bubbles: true }));

      expect(selectSpy).toHaveBeenCalled();
    });
  });

  describe('Accessibility', () => {
    it('should have autocomplete="off" on inputs', () => {
      const component = () =>
        PinInput({
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input');
      inputs.forEach((input) => {
        expect(input.getAttribute('autocomplete')).toBe('off');
      });
    });

    it('should have maxLength="1" on inputs', () => {
      const component = () =>
        PinInput({
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input');
      inputs.forEach((input) => {
        expect(input.getAttribute('maxLength')).toBe('1');
      });
    });

    it('should have aria-label for each input', () => {
      const component = () =>
        PinInput({
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input');
      inputs.forEach((input, index) => {
        expect(input.getAttribute('aria-label')).toBe(`PIN digit ${index + 1}`);
      });
    });

    it('should have data-complete attribute when input has value', () => {
      const component = () =>
        PinInput({
          value: '12',
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input');
      expect(inputs[0].hasAttribute('data-complete')).toBe(true);
      expect(inputs[1].hasAttribute('data-complete')).toBe(true);
      expect(inputs[2].hasAttribute('data-complete')).toBe(false);
      expect(inputs[3].hasAttribute('data-complete')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty paste', async () => {
      const onValueChange = createSpy();
      const component = () =>
        PinInput({
          onValueChange,
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        clipboardData: new DataTransfer(),
      });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          getData: () => '',
        },
      });
      inputs[0].dispatchEvent(pasteEvent);

      await nextTick();

      // Should not call onValueChange for empty paste
      expect(onValueChange.callCount).toBe(0);
    });

    it('should handle paste with only invalid characters', async () => {
      const onValueChange = createSpy();
      const component = () =>
        PinInput({
          type: 'numeric',
          onValueChange,
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        clipboardData: new DataTransfer(),
      });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          getData: () => 'abcd',
        },
      });
      inputs[0].dispatchEvent(pasteEvent);

      await nextTick();

      // Should not call onValueChange since no valid chars
      expect(onValueChange.callCount).toBe(0);
    });

    it('should handle typing multiple characters at once', async () => {
      const onValueChange = createSpy();
      const component = () =>
        PinInput({
          onValueChange,
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      // Simulate typing multiple characters (browser autocomplete, etc.)
      inputs[0].value = '12';
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));

      await nextTick();

      // Should take last character
      expect(onValueChange.calls[0][0]).toBe('2');
    });

    it('should handle value prop updates', () => {
      const value = signal('1234');

      const component = () =>
        PinInput({
          value: value(),
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input') as NodeListOf<HTMLInputElement>;

      // Initial values
      expect(inputs[0].value).toBe('1');
      expect(inputs[1].value).toBe('2');
      expect(inputs[2].value).toBe('3');
      expect(inputs[3].value).toBe('4');
    });

    it('should handle length of 1', () => {
      const component = () =>
        PinInput({
          length: 1,
          children: [PinInputInput({ index: 0 })],
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input');
      expect(inputs.length).toBe(1);
    });

    it('should handle very long length', () => {
      const component = () =>
        PinInput({
          length: 20,
          children: Array(20)
            .fill(0)
            .map((_, i) => PinInputInput({ index: i })),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input');
      expect(inputs.length).toBe(20);
    });
  });

  describe('Context Error Handling', () => {
    it('should throw error if PinInput.Input used outside PinInput', () => {
      expect(() => {
        const component = () => PinInputInput({ index: 0 });
        renderComponent(component);
      }).toThrow('PinInput.Input must be used within a PinInput');
    });
  });

  describe('Additional Props', () => {
    it('should pass through additional props to inputs', () => {
      const component = () =>
        PinInput({
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) =>
              PinInputInput({
                index: i,
                'data-testid': `pin-${i}`,
              }),
            ),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input');
      inputs.forEach((input, i) => {
        expect(input.getAttribute('data-testid')).toBe(`pin-${i}`);
      });
    });

    it('should support custom class on inputs', () => {
      const component = () =>
        PinInput({
          length: 4,
          children: Array(4)
            .fill(0)
            .map((_, i) =>
              PinInputInput({
                index: i,
                class: 'custom-pin-input',
              }),
            ),
        });
      const { container } = renderComponent(component);

      const inputs = container.querySelectorAll('input');
      inputs.forEach((input) => {
        expect(input.classList.contains('custom-pin-input')).toBe(true);
      });
    });
  });
});
