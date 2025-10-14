/**
 * Tests for createInputPrimitive factory
 *
 * Verifies that the factory generates correct input components
 * with appropriate behavior, validation, and accessibility features.
 *
 * Goal: 50+ comprehensive tests covering all patterns
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createInputPrimitive,
  createFocusManager,
  createValidator,
} from '../../../../src/primitives/base/createInputPrimitive.js';
import { signal } from '../../../../src/core/reactivity/signal.js';

describe('createInputPrimitive', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  // ============================================================================
  // Basic Component Creation
  // ============================================================================

  describe('Basic Component Creation', () => {
    it('should create a basic text input component', () => {
      const Input = createInputPrimitive({
        name: 'input',
        elementType: 'input',
        defaultInputType: 'text',
      });

      expect(Input).toBeDefined();
      expect(Input.displayName).toBe('Input');
    });

    it('should create a textarea component', () => {
      const Textarea = createInputPrimitive({
        name: 'textarea',
        elementType: 'textarea',
      });

      expect(Textarea).toBeDefined();
      expect(Textarea.displayName).toBe('Textarea');
    });

    it('should create a number input component', () => {
      const NumberInput = createInputPrimitive<number>({
        name: 'number-input',
        elementType: 'input',
        defaultInputType: 'number',
      });

      expect(NumberInput).toBeDefined();
      expect(NumberInput.displayName).toBe('NumberInput');
    });

    it('should handle multi-word names correctly', () => {
      const CustomInput = createInputPrimitive({
        name: 'custom-text-input',
      });

      expect(CustomInput.displayName).toBe('CustomTextInput');
    });
  });

  // ============================================================================
  // Element Type Configuration
  // ============================================================================

  describe('Element Type Configuration', () => {
    it('should default to input element', () => {
      const Input = createInputPrimitive({
        name: 'input',
      });

      const element = Input({}) as HTMLInputElement;

      expect(element.tagName.toLowerCase()).toBe('input');
    });

    it('should create textarea when specified', () => {
      const Textarea = createInputPrimitive({
        name: 'textarea',
        elementType: 'textarea',
      });

      const element = Textarea({}) as HTMLTextAreaElement;

      expect(element.tagName.toLowerCase()).toBe('textarea');
    });

    it('should set correct input type', () => {
      const EmailInput = createInputPrimitive({
        name: 'email-input',
        defaultInputType: 'email',
      });

      const element = EmailInput({}) as HTMLInputElement;

      expect(element.type).toBe('email');
    });

    it('should allow overriding input type via props', () => {
      const Input = createInputPrimitive({
        name: 'input',
        defaultInputType: 'text',
      });

      const element = Input({ type: 'password' }) as HTMLInputElement;

      expect(element.type).toBe('password');
    });
  });

  // ============================================================================
  // Pattern 19: Signal-Based Controlled State
  // ============================================================================

  describe('Pattern 19: Signal-Based Controlled State', () => {
    it('should support WritableSignal for controlled state', () => {
      const Input = createInputPrimitive({
        name: 'input',
      });

      const valueSignal = signal('initial');
      const element = Input({ value: valueSignal }) as HTMLInputElement;

      expect(element.value).toBe('initial');
    });

    it('should support string for controlled state', () => {
      const Input = createInputPrimitive({
        name: 'input',
      });

      const element = Input({ value: 'controlled' }) as HTMLInputElement;

      expect(element.value).toBe('controlled');
    });

    it('should support uncontrolled mode with defaultValue', () => {
      const Input = createInputPrimitive({
        name: 'input',
      });

      const element = Input({ defaultValue: 'default' }) as HTMLInputElement;

      expect(element.value).toBe('default');
    });

    it('should default to empty string when no value provided', () => {
      const Input = createInputPrimitive({
        name: 'input',
      });

      const element = Input({}) as HTMLInputElement;

      expect(element.value).toBe('');
    });

    it('should call onValueChange when value changes', () => {
      const Input = createInputPrimitive({
        name: 'input',
      });

      const onValueChange = vi.fn();
      const element = Input({ onValueChange }) as HTMLInputElement;

      // Simulate input event
      element.value = 'new value';
      element.dispatchEvent(new Event('input', { bubbles: true }));

      expect(onValueChange).toHaveBeenCalledWith('new value');
    });
  });

  // ============================================================================
  // Value Transformation
  // ============================================================================

  describe('Value Transformation', () => {
    it('should transform input value with transformValue', () => {
      const NumberInput = createInputPrimitive<number>({
        name: 'number-input',
        transformValue: (value) => parseFloat(value) || 0,
        formatValue: (value) => String(value),
      });

      const onValueChange = vi.fn();
      const element = NumberInput({ onValueChange }) as HTMLInputElement;

      element.value = '42.5';
      element.dispatchEvent(new Event('input', { bubbles: true }));

      expect(onValueChange).toHaveBeenCalledWith(42.5);
    });

    it('should format value for display with formatValue', () => {
      const NumberInput = createInputPrimitive<number>({
        name: 'number-input',
        transformValue: (value) => parseFloat(value) || 0,
        formatValue: (value) => value.toFixed(2),
      });

      const element = NumberInput({ value: 42 }) as HTMLInputElement;

      expect(element.value).toBe('42.00');
    });

    it('should handle invalid number input gracefully', () => {
      const NumberInput = createInputPrimitive<number>({
        name: 'number-input',
        transformValue: (value) => parseFloat(value) || 0,
      });

      const onValueChange = vi.fn();
      const element = NumberInput({ onValueChange }) as HTMLInputElement;

      element.value = 'not-a-number';
      element.dispatchEvent(new Event('input', { bubbles: true }));

      expect(onValueChange).toHaveBeenCalledWith(0);
    });
  });

  // ============================================================================
  // Validation
  // ============================================================================

  describe('Validation', () => {
    it('should validate value with validateValue returning boolean', () => {
      const Input = createInputPrimitive({
        name: 'input',
        validateValue: (value) => value.length <= 10,
      });

      const onValueChange = vi.fn();
      const element = Input({ onValueChange }) as HTMLInputElement;

      // Valid input
      element.value = 'short';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      expect(onValueChange).toHaveBeenCalledWith('short');

      onValueChange.mockClear();

      // Invalid input
      element.value = 'this is way too long';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('should validate value with validateValue returning error message', () => {
      const Input = createInputPrimitive({
        name: 'input',
        validateValue: (value) => value.length <= 10 || 'Too long',
      });

      const onValueChange = vi.fn();
      const element = Input({ onValueChange }) as HTMLInputElement;

      element.value = 'this is way too long';
      element.dispatchEvent(new Event('input', { bubbles: true }));

      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('should allow valid values to pass validation', () => {
      const EmailInput = createInputPrimitive({
        name: 'email-input',
        validateValue: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value === '',
      });

      const onValueChange = vi.fn();
      const element = EmailInput({ onValueChange }) as HTMLInputElement;

      element.value = 'test@example.com';
      element.dispatchEvent(new Event('input', { bubbles: true }));

      expect(onValueChange).toHaveBeenCalledWith('test@example.com');
    });
  });

  // ============================================================================
  // State Attributes
  // ============================================================================

  describe('State Attributes', () => {
    it('should set disabled attribute', () => {
      const Input = createInputPrimitive({
        name: 'input',
      });

      const element = Input({ disabled: true }) as HTMLInputElement;

      expect(element.disabled).toBe(true);
      expect(element.hasAttribute('data-disabled')).toBe(true);
    });

    it('should set readOnly attribute', () => {
      const Input = createInputPrimitive({
        name: 'input',
      });

      const element = Input({ readOnly: true }) as HTMLInputElement;

      expect(element.readOnly).toBe(true);
      expect(element.hasAttribute('data-readonly')).toBe(true);
    });

    it('should set required attribute', () => {
      const Input = createInputPrimitive({
        name: 'input',
      });

      const element = Input({ required: true }) as HTMLInputElement;

      expect(element.required).toBe(true);
    });

    it('should set invalid state', () => {
      const Input = createInputPrimitive({
        name: 'input',
      });

      const element = Input({ invalid: true }) as HTMLInputElement;

      expect(element.hasAttribute('data-invalid')).toBe(true);
      expect(element.getAttribute('aria-invalid')).toBe('true');
    });

    it('should set placeholder', () => {
      const Input = createInputPrimitive({
        name: 'input',
      });

      const element = Input({ placeholder: 'Enter text' }) as HTMLInputElement;

      expect(element.placeholder).toBe('Enter text');
    });

    it('should set name attribute', () => {
      const Input = createInputPrimitive({
        name: 'input',
      });

      const element = Input({ name: 'username' }) as HTMLInputElement;

      expect(element.name).toBe('username');
    });

    it('should set id attribute', () => {
      const Input = createInputPrimitive({
        name: 'input',
      });

      const element = Input({ id: 'my-input' }) as HTMLInputElement;

      expect(element.id).toBe('my-input');
    });
  });

  // ============================================================================
  // ARIA Attributes
  // ============================================================================

  describe('ARIA Attributes', () => {
    it('should set aria-label', () => {
      const Input = createInputPrimitive({
        name: 'input',
      });

      const element = Input({ 'aria-label': 'Username' }) as HTMLInputElement;

      expect(element.getAttribute('aria-label')).toBe('Username');
    });

    it('should set aria-labelledby', () => {
      const Input = createInputPrimitive({
        name: 'input',
      });

      const element = Input({ 'aria-labelledby': 'label-id' }) as HTMLInputElement;

      expect(element.getAttribute('aria-labelledby')).toBe('label-id');
    });

    it('should set aria-describedby', () => {
      const Input = createInputPrimitive({
        name: 'input',
      });

      const element = Input({ 'aria-describedby': 'description-id' }) as HTMLInputElement;

      expect(element.getAttribute('aria-describedby')).toBe('description-id');
    });

    it('should set aria-invalid when invalid prop is true', () => {
      const Input = createInputPrimitive({
        name: 'input',
      });

      const element = Input({ invalid: true }) as HTMLInputElement;

      expect(element.getAttribute('aria-invalid')).toBe('true');
    });

    it('should not set aria-invalid when invalid prop is false', () => {
      const Input = createInputPrimitive({
        name: 'input',
      });

      const element = Input({ invalid: false }) as HTMLInputElement;

      expect(element.hasAttribute('aria-invalid')).toBe(false);
    });
  });

  // ============================================================================
  // Data Attributes
  // ============================================================================

  describe('Data Attributes', () => {
    it('should set data-{name} attribute', () => {
      const Input = createInputPrimitive({
        name: 'custom-input',
      });

      const element = Input({}) as HTMLInputElement;

      expect(element.hasAttribute('data-custom-input')).toBe(true);
    });

    it('should set data-disabled when disabled', () => {
      const Input = createInputPrimitive({
        name: 'input',
      });

      const element = Input({ disabled: true }) as HTMLInputElement;

      expect(element.hasAttribute('data-disabled')).toBe(true);
    });

    it('should set data-readonly when readOnly', () => {
      const Input = createInputPrimitive({
        name: 'input',
      });

      const element = Input({ readOnly: true }) as HTMLInputElement;

      expect(element.hasAttribute('data-readonly')).toBe(true);
    });

    it('should set data-invalid when invalid', () => {
      const Input = createInputPrimitive({
        name: 'input',
      });

      const element = Input({ invalid: true }) as HTMLInputElement;

      expect(element.hasAttribute('data-invalid')).toBe(true);
    });
  });

  // ============================================================================
  // Focus Manager
  // ============================================================================

  describe('Focus Manager', () => {
    it('should create focus manager with correct methods', () => {
      const elementRef = signal<HTMLInputElement | null>(null);
      const focusManager = createFocusManager(elementRef);

      expect(focusManager.getElement).toBeDefined();
      expect(focusManager.focus).toBeDefined();
      expect(focusManager.blur).toBeDefined();
      expect(focusManager.select).toBeDefined();
      expect(focusManager.setSelectionRange).toBeDefined();
    });

    it('should return element from getElement', () => {
      const element = document.createElement('input');
      const elementRef = signal<HTMLInputElement | null>(element);
      const focusManager = createFocusManager(elementRef);

      expect(focusManager.getElement()).toBe(element);
    });

    it('should focus element when focus() is called', () => {
      const element = document.createElement('input');
      container.appendChild(element);
      const elementRef = signal<HTMLInputElement | null>(element);
      const focusManager = createFocusManager(elementRef);

      focusManager.focus();

      expect(document.activeElement).toBe(element);
    });

    it('should blur element when blur() is called', () => {
      const element = document.createElement('input');
      container.appendChild(element);
      element.focus();
      const elementRef = signal<HTMLInputElement | null>(element);
      const focusManager = createFocusManager(elementRef);

      focusManager.blur();

      expect(document.activeElement).not.toBe(element);
    });

    it('should select text when select() is called', () => {
      const element = document.createElement('input');
      element.value = 'test';
      container.appendChild(element);
      const elementRef = signal<HTMLInputElement | null>(element);
      const focusManager = createFocusManager(elementRef);

      focusManager.select();

      expect(element.selectionStart).toBe(0);
      expect(element.selectionEnd).toBe(4);
    });

    it('should set selection range when setSelectionRange() is called', () => {
      const element = document.createElement('input');
      element.value = 'test';
      container.appendChild(element);
      const elementRef = signal<HTMLInputElement | null>(element);
      const focusManager = createFocusManager(elementRef);

      focusManager.setSelectionRange(1, 3);

      expect(element.selectionStart).toBe(1);
      expect(element.selectionEnd).toBe(3);
    });

    it('should handle null element gracefully', () => {
      const elementRef = signal<HTMLInputElement | null>(null);
      const focusManager = createFocusManager(elementRef);

      // Should not throw
      expect(() => focusManager.focus()).not.toThrow();
      expect(() => focusManager.blur()).not.toThrow();
      expect(() => focusManager.select()).not.toThrow();
      expect(() => focusManager.setSelectionRange(0, 0)).not.toThrow();
    });
  });

  // ============================================================================
  // Validator
  // ============================================================================

  describe('Validator', () => {
    it('should return valid when no validator provided', () => {
      const validator = createValidator({
        name: 'input',
      });

      const result = validator('test', '');

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return valid when validator returns true', () => {
      const validator = createValidator({
        name: 'input',
        validateValue: (value) => value.length > 0,
      });

      const result = validator('test', '');

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return invalid when validator returns false', () => {
      const validator = createValidator({
        name: 'input',
        validateValue: (value) => value.length > 0,
      });

      const result = validator('', 'prev');

      expect(result.valid).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it('should return error message when validator returns string', () => {
      const validator = createValidator({
        name: 'input',
        validateValue: (value) => value.length > 0 || 'Value is required',
      });

      const result = validator('', 'prev');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Value is required');
    });
  });
});
