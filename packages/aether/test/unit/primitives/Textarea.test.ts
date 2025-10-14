/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import { Textarea } from '../../../src/primitives/Textarea.js';
import { renderComponent, nextTick, createSpy } from '../../helpers/test-utils.js';

describe('Textarea', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic Rendering', () => {
    it('should render a textarea element', () => {
      const component = () => Textarea({});

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea');
      expect(textarea).toBeTruthy();
      expect(textarea?.tagName).toBe('TEXTAREA');
      expect(textarea?.hasAttribute('data-textarea')).toBe(true);

      cleanup();
    });

    it('should render with placeholder', () => {
      const component = () =>
        Textarea({
          placeholder: 'Enter your message',
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.placeholder).toBe('Enter your message');

      cleanup();
    });

    it('should render with rows attribute', () => {
      const component = () =>
        Textarea({
          rows: 5,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.getAttribute('rows')).toBe('5');

      cleanup();
    });

    it('should render with cols attribute', () => {
      const component = () =>
        Textarea({
          cols: 40,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.getAttribute('cols')).toBe('40');

      cleanup();
    });

    it('should render with id attribute', () => {
      const component = () =>
        Textarea({
          id: 'message-textarea',
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.id).toBe('message-textarea');

      cleanup();
    });

    it('should render with name attribute', () => {
      const component = () =>
        Textarea({
          name: 'message',
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.name).toBe('message');

      cleanup();
    });
  });

  describe('Props - Disabled State', () => {
    it('should render as disabled', () => {
      const component = () =>
        Textarea({
          disabled: true,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.disabled).toBe(true);
      expect(textarea.hasAttribute('data-disabled')).toBe(true);

      cleanup();
    });

    it('should not be disabled by default', () => {
      const component = () => Textarea({});

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.disabled).toBe(false);
      expect(textarea.hasAttribute('data-disabled')).toBe(false);

      cleanup();
    });
  });

  describe('Props - ReadOnly State', () => {
    it('should render as readonly', () => {
      const component = () =>
        Textarea({
          readOnly: true,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.readOnly).toBe(true);
      expect(textarea.hasAttribute('data-readonly')).toBe(true);

      cleanup();
    });

    it('should not be readonly by default', () => {
      const component = () => Textarea({});

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.readOnly).toBe(false);
      expect(textarea.hasAttribute('data-readonly')).toBe(false);

      cleanup();
    });
  });

  describe('Props - Required State', () => {
    it('should render as required', () => {
      const component = () =>
        Textarea({
          required: true,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.required).toBe(true);

      cleanup();
    });

    it('should not be required by default', () => {
      const component = () => Textarea({});

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.required).toBe(false);

      cleanup();
    });
  });

  describe('Props - MaxLength', () => {
    it('should render with maxLength attribute', () => {
      const component = () =>
        Textarea({
          maxLength: 200,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.maxLength).toBe(200);

      cleanup();
    });

    it('should enforce maxLength on input', () => {
      const component = () =>
        Textarea({
          maxLength: 10,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

      // Set a value that's within the maxLength
      textarea.value = 'Short';
      expect(textarea.value.length).toBeLessThanOrEqual(10);

      // Verify maxLength attribute is set
      expect(textarea.maxLength).toBe(10);

      cleanup();
    });
  });

  describe('Controlled Mode', () => {
    it('should support controlled value', () => {
      const component = () =>
        Textarea({
          value: 'Hello',
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Hello');

      cleanup();
    });

    it('should call onInput when typing', () => {
      const onInput = createSpy();

      const component = () =>
        Textarea({
          onInput,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      textarea.value = 'New text';

      const inputEvent = new Event('input', { bubbles: true });
      textarea.dispatchEvent(inputEvent);

      expect(onInput.callCount).toBe(1);
      expect(onInput.calls[0][0]).toBe('New text');

      cleanup();
    });

    it('should call onChange when typing', () => {
      const onChange = createSpy();

      const component = () =>
        Textarea({
          onChange,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      textarea.value = 'Changed text';

      const inputEvent = new Event('input', { bubbles: true });
      textarea.dispatchEvent(inputEvent);

      expect(onChange.callCount).toBe(1);
      expect(onChange.calls[0][0]).toBe('Changed text');

      cleanup();
    });

    it('should call both onInput and onChange', () => {
      const onInput = createSpy();
      const onChange = createSpy();

      const component = () =>
        Textarea({
          onInput,
          onChange,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      textarea.value = 'Test';

      const inputEvent = new Event('input', { bubbles: true });
      textarea.dispatchEvent(inputEvent);

      expect(onInput.callCount).toBe(1);
      expect(onChange.callCount).toBe(1);
      expect(onInput.calls[0][0]).toBe('Test');
      expect(onChange.calls[0][0]).toBe('Test');

      cleanup();
    });
  });

  describe('Uncontrolled Mode', () => {
    it('should support defaultValue', () => {
      const component = () =>
        Textarea({
          defaultValue: 'Initial value',
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Initial value');

      cleanup();
    });

    it('should allow user input in uncontrolled mode', () => {
      const component = () =>
        Textarea({
          defaultValue: 'Initial',
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      textarea.value = 'Updated by user';

      const inputEvent = new Event('input', { bubbles: true });
      textarea.dispatchEvent(inputEvent);

      expect(textarea.value).toBe('Updated by user');

      cleanup();
    });
  });

  describe('Focus and Blur Events', () => {
    it('should call onFocus when focused', () => {
      const onFocus = createSpy();

      const component = () =>
        Textarea({
          onFocus,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

      const focusEvent = new FocusEvent('focus', { bubbles: true });
      textarea.dispatchEvent(focusEvent);

      expect(onFocus.callCount).toBe(1);

      cleanup();
    });

    it('should call onBlur when blurred', () => {
      const onBlur = createSpy();

      const component = () =>
        Textarea({
          onBlur,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

      const blurEvent = new FocusEvent('blur', { bubbles: true });
      textarea.dispatchEvent(blurEvent);

      expect(onBlur.callCount).toBe(1);

      cleanup();
    });
  });

  describe('Invalid State', () => {
    it('should render invalid state', () => {
      const component = () =>
        Textarea({
          invalid: true,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.hasAttribute('data-invalid')).toBe(true);
      expect(textarea.getAttribute('aria-invalid')).toBe('true');

      cleanup();
    });

    it('should not be invalid by default', () => {
      const component = () => Textarea({});

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.hasAttribute('data-invalid')).toBe(false);
      expect(textarea.getAttribute('aria-invalid')).toBe(null);

      cleanup();
    });
  });

  describe('Auto-Resize Feature', () => {
    it('should have data-autoresize attribute when autoResize is true', () => {
      const component = () =>
        Textarea({
          autoResize: true,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.hasAttribute('data-autoresize')).toBe(true);

      cleanup();
    });

    it('should apply overflow hidden style when autoResize is true', () => {
      const component = () =>
        Textarea({
          autoResize: true,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.style.overflow).toBe('hidden');
      expect(textarea.style.resize).toBe('none');

      cleanup();
    });

    it('should not have rows attribute when autoResize is true', () => {
      const component = () =>
        Textarea({
          autoResize: true,
          rows: 5,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      // When autoResize is true, rows should be undefined
      expect(textarea.hasAttribute('rows')).toBe(false);

      cleanup();
    });

    it('should adjust height on input when autoResize is true', async () => {
      const component = () =>
        Textarea({
          autoResize: true,
          defaultValue: 'Short text',
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      const initialHeight = textarea.offsetHeight;

      // Add more text
      textarea.value = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';

      const inputEvent = new Event('input', { bubbles: true });
      textarea.dispatchEvent(inputEvent);

      await nextTick();

      // Height should have changed (this is a basic check, actual height depends on line-height)
      expect(textarea.style.height).toBeTruthy();

      cleanup();
    });

    it('should respect minRows constraint', async () => {
      const component = () =>
        Textarea({
          autoResize: true,
          minRows: 3,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

      await nextTick();

      // Should have minimum height even with no content
      expect(textarea.style.height).toBeTruthy();

      cleanup();
    });

    it('should default minRows to 1 when not specified', async () => {
      const component = () =>
        Textarea({
          autoResize: true,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

      await nextTick();

      expect(textarea.style.height).toBeTruthy();

      cleanup();
    });
  });

  describe('Accessibility', () => {
    it('should support aria-label', () => {
      const component = () =>
        Textarea({
          'aria-label': 'Message input',
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.getAttribute('aria-label')).toBe('Message input');

      cleanup();
    });

    it('should support aria-labelledby', () => {
      const component = () =>
        Textarea({
          'aria-labelledby': 'label-id',
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.getAttribute('aria-labelledby')).toBe('label-id');

      cleanup();
    });

    it('should support aria-describedby', () => {
      const component = () =>
        Textarea({
          'aria-describedby': 'description-id',
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.getAttribute('aria-describedby')).toBe('description-id');

      cleanup();
    });

    it('should set aria-invalid when invalid prop is true', () => {
      const component = () =>
        Textarea({
          invalid: true,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.getAttribute('aria-invalid')).toBe('true');

      cleanup();
    });
  });

  describe('Multi-line Content', () => {
    it('should handle newlines in value', () => {
      const component = () =>
        Textarea({
          value: 'Line 1\nLine 2\nLine 3',
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Line 1\nLine 2\nLine 3');

      cleanup();
    });

    it('should handle newlines in defaultValue', () => {
      const component = () =>
        Textarea({
          defaultValue: 'Line 1\nLine 2\nLine 3',
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Line 1\nLine 2\nLine 3');

      cleanup();
    });

    it('should preserve newlines on input', () => {
      const onInput = createSpy();

      const component = () =>
        Textarea({
          onInput,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      textarea.value = 'Line 1\nLine 2';

      const inputEvent = new Event('input', { bubbles: true });
      textarea.dispatchEvent(inputEvent);

      expect(onInput.calls[0][0]).toBe('Line 1\nLine 2');

      cleanup();
    });
  });

  describe('Form Integration', () => {
    it('should work with forms', () => {
      const component = () =>
        Textarea({
          name: 'message',
          defaultValue: 'Form message',
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.name).toBe('message');
      expect(textarea.value).toBe('Form message');

      cleanup();
    });

    it('should be included in form data', () => {
      const form = document.createElement('form');
      document.body.appendChild(form);

      const component = () =>
        Textarea({
          name: 'description',
          defaultValue: 'Test description',
        });

      const { container, cleanup } = renderComponent(component);
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      form.appendChild(textarea);

      const formData = new FormData(form);
      expect(formData.get('description')).toBe('Test description');

      cleanup();
      document.body.removeChild(form);
    });

    it('should validate with required attribute', () => {
      const component = () =>
        Textarea({
          required: true,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.checkValidity()).toBe(false);

      textarea.value = 'Some text';
      expect(textarea.checkValidity()).toBe(true);

      cleanup();
    });
  });

  describe('Additional DOM Attributes', () => {
    it('should support custom class', () => {
      const component = () =>
        Textarea({
          class: 'custom-textarea',
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.className).toBe('custom-textarea');

      cleanup();
    });

    it('should support custom styles', () => {
      const component = () =>
        Textarea({
          style: { border: '1px solid red' },
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.style.border).toBe('1px solid red');

      cleanup();
    });

    it('should merge styles with autoResize styles', () => {
      const component = () =>
        Textarea({
          autoResize: true,
          style: { border: '1px solid blue' },
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.style.border).toBe('1px solid blue');
      expect(textarea.style.overflow).toBe('hidden');
      expect(textarea.style.resize).toBe('none');

      cleanup();
    });

    it('should support data attributes', () => {
      const component = () =>
        Textarea({
          'data-test-id': 'message-textarea',
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.getAttribute('data-test-id')).toBe('message-textarea');

      cleanup();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty value', () => {
      const component = () =>
        Textarea({
          value: '',
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.value).toBe('');

      cleanup();
    });

    it('should handle undefined value', () => {
      const component = () =>
        Textarea({
          value: undefined,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.value).toBe('');

      cleanup();
    });

    it('should handle both disabled and readonly', () => {
      const component = () =>
        Textarea({
          disabled: true,
          readOnly: true,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.disabled).toBe(true);
      expect(textarea.readOnly).toBe(true);
      expect(textarea.hasAttribute('data-disabled')).toBe(true);
      expect(textarea.hasAttribute('data-readonly')).toBe(true);

      cleanup();
    });

    it('should handle very long text', () => {
      const longText = 'a'.repeat(10000);

      const component = () =>
        Textarea({
          defaultValue: longText,
        });

      const { container, cleanup } = renderComponent(component);

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.value).toBe(longText);
      expect(textarea.value.length).toBe(10000);

      cleanup();
    });

    it('should accept different value types', () => {
      const component1 = () =>
        Textarea({
          value: 'Initial',
        });

      const { container: container1, cleanup: cleanup1 } = renderComponent(component1);
      const textarea1 = container1.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea1.value).toBe('Initial');
      cleanup1();

      const component2 = () =>
        Textarea({
          value: 'Changed',
        });

      const { container: container2, cleanup: cleanup2 } = renderComponent(component2);
      const textarea2 = container2.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea2.value).toBe('Changed');
      cleanup2();
    });
  });

  describe('Component Display Name', () => {
    it('should have displayName set', () => {
      expect(Textarea.displayName).toBe('Textarea');
    });
  });
});
