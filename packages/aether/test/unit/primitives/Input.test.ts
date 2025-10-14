/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import { Input } from '../../../src/primitives/Input.js';
import { renderComponent, createSpy } from '../../helpers/test-utils.js';

describe('Input', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic Rendering', () => {
    it('should render an input element', () => {
      const component = () => Input({});
      const { container } = renderComponent(component);

      const input = container.querySelector('input');
      expect(input).toBeTruthy();
      expect(input?.tagName).toBe('INPUT');
    });

    it('should have data-input attribute', () => {
      const component = () => Input({});
      const { container } = renderComponent(component);

      const input = container.querySelector('input');
      expect(input?.hasAttribute('data-input')).toBe(true);
    });

    it('should render with default type as text', () => {
      const component = () => Input({});
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input?.type).toBe('text');
    });

    it('should render with custom class', () => {
      const component = () => Input({ class: 'custom-input' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input');
      expect(input?.classList.contains('custom-input')).toBe(true);
    });

    it('should have displayName', () => {
      expect((Input as any).displayName).toBe('Input');
    });
  });

  describe('Input Types', () => {
    it('should render with type text', () => {
      const component = () => Input({ type: 'text' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.type).toBe('text');
    });

    it('should render with type email', () => {
      const component = () => Input({ type: 'email' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.type).toBe('email');
    });

    it('should render with type password', () => {
      const component = () => Input({ type: 'password' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.type).toBe('password');
    });

    it('should render with type number', () => {
      const component = () => Input({ type: 'number' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.type).toBe('number');
    });

    it('should render with type tel', () => {
      const component = () => Input({ type: 'tel' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.type).toBe('tel');
    });

    it('should render with type url', () => {
      const component = () => Input({ type: 'url' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.type).toBe('url');
    });

    it('should render with type search', () => {
      const component = () => Input({ type: 'search' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.type).toBe('search');
    });

    it('should render with type date', () => {
      const component = () => Input({ type: 'date' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.type).toBe('date');
    });

    it('should render with type time', () => {
      const component = () => Input({ type: 'time' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.type).toBe('time');
    });

    it('should render with type datetime-local', () => {
      const component = () => Input({ type: 'datetime-local' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.type).toBe('datetime-local');
    });
  });

  describe('Basic Props', () => {
    it('should render with placeholder', () => {
      const component = () => Input({ placeholder: 'Enter text' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.placeholder).toBe('Enter text');
    });

    it('should render with name attribute', () => {
      const component = () => Input({ name: 'username' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.name).toBe('username');
    });

    it('should render with id attribute', () => {
      const component = () => Input({ id: 'email-input' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.id).toBe('email-input');
    });

    it('should render with autocomplete attribute', () => {
      const component = () => Input({ autoComplete: 'email' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.getAttribute('autocomplete')).toBe('email');
    });
  });

  describe('State Props', () => {
    it('should render as disabled', () => {
      const component = () => Input({ disabled: true });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.disabled).toBe(true);
      expect(input.hasAttribute('data-disabled')).toBe(true);
    });

    it('should not have data-disabled when not disabled', () => {
      const component = () => Input({ disabled: false });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.disabled).toBe(false);
      expect(input.hasAttribute('data-disabled')).toBe(false);
    });

    it('should render as readonly', () => {
      const component = () => Input({ readOnly: true });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.readOnly).toBe(true);
      expect(input.hasAttribute('data-readonly')).toBe(true);
    });

    it('should not have data-readonly when not readonly', () => {
      const component = () => Input({ readOnly: false });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.readOnly).toBe(false);
      expect(input.hasAttribute('data-readonly')).toBe(false);
    });

    it('should render as required', () => {
      const component = () => Input({ required: true });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.required).toBe(true);
    });

    it('should render with invalid state', () => {
      const component = () => Input({ invalid: true });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.hasAttribute('data-invalid')).toBe(true);
      expect(input.getAttribute('aria-invalid')).toBe('true');
    });

    it('should not have invalid attributes when not invalid', () => {
      const component = () => Input({ invalid: false });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.hasAttribute('data-invalid')).toBe(false);
      expect(input.hasAttribute('aria-invalid')).toBe(false);
    });
  });

  describe('Uncontrolled Mode', () => {
    it('should render with defaultValue as string', () => {
      const component = () => Input({ defaultValue: 'initial text' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.value).toBe('initial text');
    });

    it('should render with defaultValue as number', () => {
      const component = () => Input({ type: 'number', defaultValue: 42 });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.value).toBe('42');
    });

    it('should allow user input in uncontrolled mode', () => {
      const component = () => Input({ defaultValue: 'initial' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;

      // Simulate user input
      input.value = 'updated';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(input.value).toBe('updated');
    });
  });

  describe('Controlled Mode', () => {
    it('should render with controlled value as string', () => {
      const component = () => Input({ value: 'controlled' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.value).toBe('controlled');
    });

    it('should render with controlled value as number', () => {
      const component = () => Input({ type: 'number', value: 100 });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.value).toBe('100');
    });

    it('should work with signal value for reactive updates', () => {
      const value = signal('initial');

      const component = () => Input({ value: value() });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      // The component renders with the current signal value
      expect(input.value).toBe('initial');
    });

    it('should handle empty string value', () => {
      const component = () => Input({ value: '' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.value).toBe('');
    });

    it('should handle zero as value', () => {
      const component = () => Input({ type: 'number', value: 0 });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.value).toBe('0');
    });
  });

  describe('Event Handlers', () => {
    it('should call onInput when user types', () => {
      const onInput = createSpy();
      const component = () => Input({ onInput });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;

      input.value = 'test';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(onInput.callCount).toBe(1);
      expect(onInput.calls[0][0]).toBe('test');
    });

    it('should call onChange when user types', () => {
      const onChange = createSpy();
      const component = () => Input({ onChange });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;

      input.value = 'test';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(onChange.callCount).toBe(1);
      expect(onChange.calls[0][0]).toBe('test');
    });

    it('should call both onInput and onChange', () => {
      const onInput = createSpy();
      const onChange = createSpy();
      const component = () => Input({ onInput, onChange });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;

      input.value = 'test';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(onInput.callCount).toBe(1);
      expect(onChange.callCount).toBe(1);
    });

    it('should call onFocus when input is focused', () => {
      const onFocus = createSpy();
      const component = () => Input({ onFocus });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;

      input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

      expect(onFocus.callCount).toBe(1);
    });

    it('should call onBlur when input loses focus', () => {
      const onBlur = createSpy();
      const component = () => Input({ onBlur });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;

      input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

      expect(onBlur.callCount).toBe(1);
    });

    it('should pass FocusEvent to onFocus handler', () => {
      const onFocus = vi.fn();
      const component = () => Input({ onFocus });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      const focusEvent = new FocusEvent('focus', { bubbles: true });

      input.dispatchEvent(focusEvent);

      expect(onFocus).toHaveBeenCalledWith(focusEvent);
    });

    it('should pass FocusEvent to onBlur handler', () => {
      const onBlur = vi.fn();
      const component = () => Input({ onBlur });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      const blurEvent = new FocusEvent('blur', { bubbles: true });

      input.dispatchEvent(blurEvent);

      expect(onBlur).toHaveBeenCalledWith(blurEvent);
    });
  });

  describe('Accessibility', () => {
    it('should render with aria-label', () => {
      const component = () => Input({ 'aria-label': 'Email address' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.getAttribute('aria-label')).toBe('Email address');
    });

    it('should render with aria-labelledby', () => {
      const component = () => Input({ 'aria-labelledby': 'email-label' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.getAttribute('aria-labelledby')).toBe('email-label');
    });

    it('should render with aria-describedby', () => {
      const component = () => Input({ 'aria-describedby': 'email-description' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.getAttribute('aria-describedby')).toBe('email-description');
    });

    it('should set aria-invalid when invalid prop is true', () => {
      const component = () => Input({ invalid: true });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.getAttribute('aria-invalid')).toBe('true');
    });

    it('should handle both invalid prop and aria-invalid together', () => {
      const component = () => Input({ invalid: true, 'aria-invalid': 'grammar' as any });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      // When invalid is true, aria-invalid is set to 'true'
      expect(input.getAttribute('aria-invalid')).toBe('true');
    });

    it('should not set aria-invalid when invalid is false', () => {
      const component = () => Input({ invalid: false });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.hasAttribute('aria-invalid')).toBe(false);
    });
  });

  describe('Form Integration', () => {
    it('should work with form submission', () => {
      const component = () => Input({ name: 'email', value: 'test@example.com' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.name).toBe('email');
      expect(input.value).toBe('test@example.com');
    });

    it('should support required attribute for validation', () => {
      const component = () => Input({ required: true });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.required).toBe(true);
    });

    it('should collect value in FormData', () => {
      const form = document.createElement('form');
      document.body.appendChild(form);

      const component = () => Input({ name: 'username', value: 'john_doe' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      form.appendChild(input);

      const formData = new FormData(form);
      expect(formData.get('username')).toBe('john_doe');

      document.body.removeChild(form);
    });
  });

  describe('Additional HTML Attributes', () => {
    it('should support pattern attribute', () => {
      const component = () => Input({ pattern: '[a-z]+' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.getAttribute('pattern')).toBe('[a-z]+');
    });

    it('should support minLength attribute', () => {
      const component = () => Input({ minLength: 5 });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.getAttribute('minlength')).toBe('5');
    });

    it('should support maxLength attribute', () => {
      const component = () => Input({ maxLength: 100 });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.getAttribute('maxlength')).toBe('100');
    });

    it('should support min attribute for number input', () => {
      const component = () => Input({ type: 'number', min: 0 });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.getAttribute('min')).toBe('0');
    });

    it('should support max attribute for number input', () => {
      const component = () => Input({ type: 'number', max: 100 });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.getAttribute('max')).toBe('100');
    });

    it('should support step attribute for number input', () => {
      const component = () => Input({ type: 'number', step: 0.1 });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.getAttribute('step')).toBe('0.1');
    });

    it('should support size attribute', () => {
      const component = () => Input({ size: 20 });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.getAttribute('size')).toBe('20');
    });

    it('should support title attribute', () => {
      const component = () => Input({ title: 'Enter your email' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.title).toBe('Enter your email');
    });

    it('should support multiple custom data attributes', () => {
      const component = () =>
        Input({
          'data-testid': 'email-input',
          'data-cy': 'email',
        });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.getAttribute('data-testid')).toBe('email-input');
      expect(input.getAttribute('data-cy')).toBe('email');
    });

    it('should support style attribute', () => {
      const component = () => Input({ style: 'color: red;' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.getAttribute('style')).toBe('color: red;');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty value in controlled mode', () => {
      const component = () => Input({ value: '' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.value).toBe('');
    });

    it('should handle undefined value', () => {
      const component = () => Input({ value: undefined });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.value).toBe('');
    });

    it('should handle special characters in value', () => {
      const component = () => Input({ value: '<script>alert("xss")</script>' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.value).toBe('<script>alert("xss")</script>');
    });

    it('should handle unicode characters', () => {
      const component = () => Input({ value: '你好世界 🌍' });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.value).toBe('你好世界 🌍');
    });

    it('should handle very long text', () => {
      const longText = 'a'.repeat(10000);
      const component = () => Input({ value: longText });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.value).toBe(longText);
    });

    it('should handle null as value gracefully', () => {
      const component = () => Input({ value: null as any });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.value).toBe('');
    });
  });

  describe('Signal Integration', () => {
    it('should accept signal value for placeholder', () => {
      const placeholder = signal('Initial placeholder');

      const component = () => Input({ placeholder: placeholder() });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.placeholder).toBe('Initial placeholder');
    });

    it('should accept signal value for disabled state', () => {
      const disabled = signal(true);

      const component = () => Input({ disabled: disabled() });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.disabled).toBe(true);
      expect(input.hasAttribute('data-disabled')).toBe(true);
    });

    it('should accept signal value for readonly state', () => {
      const readOnly = signal(true);

      const component = () => Input({ readOnly: readOnly() });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.readOnly).toBe(true);
      expect(input.hasAttribute('data-readonly')).toBe(true);
    });

    it('should accept signal value for invalid state', () => {
      const invalid = signal(true);

      const component = () => Input({ invalid: invalid() });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.hasAttribute('data-invalid')).toBe(true);
      expect(input.getAttribute('aria-invalid')).toBe('true');
    });

    it('should accept signal value for type', () => {
      const type = signal<'text' | 'password'>('password');

      const component = () => Input({ type: type() });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.type).toBe('password');
    });
  });

  describe('Combined States', () => {
    it('should handle disabled and required together', () => {
      const component = () => Input({ disabled: true, required: true });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.disabled).toBe(true);
      expect(input.required).toBe(true);
    });

    it('should handle readonly and required together', () => {
      const component = () => Input({ readOnly: true, required: true });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.readOnly).toBe(true);
      expect(input.required).toBe(true);
    });

    it('should handle invalid and disabled together', () => {
      const component = () => Input({ invalid: true, disabled: true });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.hasAttribute('data-invalid')).toBe(true);
      expect(input.hasAttribute('data-disabled')).toBe(true);
    });

    it('should handle all state props together', () => {
      const component = () =>
        Input({
          disabled: true,
          readOnly: true,
          required: true,
          invalid: true,
        });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.disabled).toBe(true);
      expect(input.readOnly).toBe(true);
      expect(input.required).toBe(true);
      expect(input.hasAttribute('data-invalid')).toBe(true);
    });
  });

  describe('Real-world Scenarios', () => {
    it('should work as email input with validation', () => {
      const component = () =>
        Input({
          type: 'email',
          name: 'email',
          placeholder: 'Enter your email',
          required: true,
          'aria-label': 'Email address',
        });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.type).toBe('email');
      expect(input.name).toBe('email');
      expect(input.placeholder).toBe('Enter your email');
      expect(input.required).toBe(true);
      expect(input.getAttribute('aria-label')).toBe('Email address');
    });

    it('should work as password input with requirements', () => {
      const component = () =>
        Input({
          type: 'password',
          name: 'password',
          placeholder: 'Enter password',
          required: true,
          minLength: 8,
          maxLength: 128,
          'aria-describedby': 'password-requirements',
        });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.type).toBe('password');
      expect(input.required).toBe(true);
      expect(input.getAttribute('minlength')).toBe('8');
      expect(input.getAttribute('maxlength')).toBe('128');
    });

    it('should work as number input with min/max', () => {
      const component = () =>
        Input({
          type: 'number',
          name: 'age',
          min: 0,
          max: 150,
          step: 1,
          placeholder: 'Enter your age',
        });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.type).toBe('number');
      expect(input.getAttribute('min')).toBe('0');
      expect(input.getAttribute('max')).toBe('150');
      expect(input.getAttribute('step')).toBe('1');
    });

    it('should work with error state and message', () => {
      const component = () =>
        Input({
          type: 'email',
          value: 'invalid-email',
          invalid: true,
          'aria-describedby': 'error-message',
          'aria-invalid': true,
        });
      const { container } = renderComponent(component);

      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.hasAttribute('data-invalid')).toBe(true);
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.getAttribute('aria-describedby')).toBe('error-message');
    });
  });
});
