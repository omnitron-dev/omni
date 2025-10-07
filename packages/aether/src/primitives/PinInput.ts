/**
 * PinInput - Input component for entering PIN codes or OTP
 *
 * Features:
 * - Automatic focus management
 * - Support for numeric, alphanumeric, or custom patterns
 * - Paste support (splits pasted value across inputs)
 * - Keyboard navigation (arrows, backspace)
 * - Masked/hidden input support
 * - Controlled and uncontrolled modes
 * - Auto-submit on complete
 * - ARIA support for accessibility
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext } from '../core/component/context.js';
import type { Signal, WritableSignal } from '../core/reactivity/types.js';
import { signal, computed } from '../core/reactivity/index.js';
import { onMount } from '../core/component/lifecycle.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface PinInputProps {
  /** Controlled value */
  value?: string;
  /** Value change callback */
  onValueChange?: (value: string) => void;
  /** Default value (uncontrolled) */
  defaultValue?: string;
  /** Number of input fields */
  length?: number;
  /** Input type: 'numeric' | 'alphanumeric' | 'all' */
  type?: 'numeric' | 'alphanumeric' | 'all';
  /** Whether to mask the input (password-style) */
  mask?: boolean;
  /** Placeholder character */
  placeholder?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Whether to auto-focus first input on mount */
  autoFocus?: boolean;
  /** Called when all inputs are filled */
  onComplete?: (value: string) => void;
  /** Whether to submit automatically on complete */
  autoSubmit?: boolean;
  /** Children (PinInput.Input components) */
  children?: any;
}

export interface PinInputInputProps {
  /** Index of this input (0-based) */
  index: number;
  /** Additional props */
  [key: string]: any;
}

interface PinInputContextValue {
  /** Current value array */
  values: Signal<string[]>;
  /** Length of PIN */
  length: number;
  /** Input type */
  type: 'numeric' | 'alphanumeric' | 'all';
  /** Mask state */
  mask: boolean;
  /** Placeholder */
  placeholder: string;
  /** Disabled state */
  disabled: boolean;
  /** Set value at index */
  setValue: (index: number, value: string) => void;
  /** Focus input at index */
  focusInput: (index: number) => void;
  /** Register input element */
  registerInput: (index: number, element: HTMLInputElement) => void;
  /** Unregister input element */
  unregisterInput: (index: number) => void;
  /** Handle paste */
  handlePaste: (index: number, value: string) => void;
}

// ============================================================================
// Context
// ============================================================================

const PinInputContext = createContext<PinInputContextValue | null>(null);

const usePinInputContext = (): PinInputContextValue => {
  const context = useContext(PinInputContext);
  if (!context) {
    throw new Error('PinInput.Input must be used within a PinInput');
  }
  return context;
};

// ============================================================================
// PinInput Root
// ============================================================================

export const PinInput = defineComponent<PinInputProps>((props) => {
  const length = props.length ?? 6;
  const type = props.type ?? 'numeric';
  const mask = props.mask ?? false;
  const placeholder = props.placeholder ?? '○';
  const disabled = props.disabled ?? false;
  const autoFocus = props.autoFocus ?? false;

  // State
  const internalValue: WritableSignal<string[]> = signal<string[]>(
    Array(length).fill(''),
  );

  // Input elements registry
  const inputs = new Map<number, HTMLInputElement>();

  const parseValue = (value: string): string[] => {
    const chars = value.slice(0, length).split('');
    return [...chars, ...Array(Math.max(0, length - chars.length)).fill('')];
  };

  onMount(() => {
    if (props.defaultValue) {
      internalValue.set(parseValue(props.defaultValue));
    }

    if (autoFocus) {
      setTimeout(() => focusInput(0), 0);
    }
  });

  const currentValues = (): string[] => {
    if (props.value !== undefined) {
      return parseValue(props.value);
    }
    return internalValue();
  };

  const setValues = (newValues: string[]) => {
    if (props.value === undefined) {
      internalValue.set(newValues);
    }

    const fullValue = newValues.join('');
    props.onValueChange?.(fullValue);

    // Check if complete
    if (fullValue.length === length && newValues.every((v) => v !== '')) {
      props.onComplete?.(fullValue);
    }
  };

  const isValidChar = (char: string): boolean => {
    if (type === 'numeric') {
      return /^[0-9]$/.test(char);
    } else if (type === 'alphanumeric') {
      return /^[a-zA-Z0-9]$/.test(char);
    }
    return char.length === 1; // 'all' accepts any single character
  };

  const setValue = (index: number, value: string) => {
    if (index < 0 || index >= length) return;

    const newChar = value.slice(-1); // Take last character
    if (!newChar || !isValidChar(newChar)) return;

    const newValues = [...currentValues()];
    newValues[index] = newChar;
    setValues(newValues);

    // Auto-advance to next input
    if (index < length - 1) {
      focusInput(index + 1);
    }
  };

  const focusInput = (index: number) => {
    const input = inputs.get(index);
    if (input) {
      input.focus();
    }
  };

  const registerInput = (index: number, element: HTMLInputElement) => {
    inputs.set(index, element);
  };

  const unregisterInput = (index: number) => {
    inputs.delete(index);
  };

  const handlePaste = (index: number, pastedValue: string) => {
    // Filter to valid characters
    const validChars = pastedValue
      .split('')
      .filter((char) => isValidChar(char))
      .slice(0, length - index);

    if (validChars.length === 0) return;

    const newValues = [...currentValues()];
    validChars.forEach((char, i) => {
      if (index + i < length) {
        newValues[index + i] = char;
      }
    });

    setValues(newValues);

    // Focus last filled input or next empty
    const lastFilledIndex = Math.min(index + validChars.length - 1, length - 1);
    const nextEmptyIndex = newValues.findIndex((v, i) => i > lastFilledIndex && v === '');

    if (nextEmptyIndex !== -1) {
      focusInput(nextEmptyIndex);
    } else {
      focusInput(lastFilledIndex);
    }
  };

  const contextValue: PinInputContextValue = {
    values: computed(() => currentValues()),
    length,
    type,
    mask,
    placeholder,
    disabled,
    setValue,
    focusInput,
    registerInput,
    unregisterInput,
    handlePaste,
  };

  return () =>
    jsx(PinInputContext.Provider, {
      value: contextValue,
      children: jsx('div', {
        'data-pin-input': '',
        'data-disabled': disabled ? '' : undefined,
        role: 'group',
        'aria-label': 'PIN input',
        children: props.children,
      }),
    });
});

// ============================================================================
// PinInput Input
// ============================================================================

export const PinInputInput = defineComponent<PinInputInputProps>((props) => {
  const context = usePinInputContext();
  const inputRef: { current: HTMLInputElement | null } = { current: null };

  const handleInput = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const value = target.value;

    if (value) {
      context.setValue(props.index, value);
      // Clear input to allow re-entry
      target.value = '';
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const values = context.values();

      if (values[props.index]) {
        // Clear current value
        const newValues = [...values];
        newValues[props.index] = '';
        context.setValue(props.index, '');
      } else if (props.index > 0) {
        // Move to previous and clear
        context.focusInput(props.index - 1);
        const newValues = [...values];
        newValues[props.index - 1] = '';
        context.setValue(props.index - 1, '');
      }
    } else if (e.key === 'ArrowLeft' && props.index > 0) {
      e.preventDefault();
      context.focusInput(props.index - 1);
    } else if (e.key === 'ArrowRight' && props.index < context.length - 1) {
      e.preventDefault();
      context.focusInput(props.index + 1);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      const newValues = [...context.values()];
      newValues[props.index] = '';
      context.setValue(props.index, '');
    }
  };

  const handlePaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const pastedValue = e.clipboardData?.getData('text') ?? '';
    context.handlePaste(props.index, pastedValue);
  };

  const handleFocus = (e: FocusEvent) => {
    const target = e.target as HTMLInputElement;
    target.select();
  };

  return () => {
    const { index, ...rest } = props;
    const values = context.values();
    const value = values[index] ?? '';

    // Register/unregister on mount/unmount
    if (inputRef.current) {
      context.registerInput(index, inputRef.current);
    } else {
      context.unregisterInput(index);
    }

    return jsx('input', {
      ref: inputRef,
      type: context.mask ? 'password' : 'text',
      inputMode: context.type === 'numeric' ? 'numeric' : 'text',
      pattern: context.type === 'numeric' ? '[0-9]*' : undefined,
      placeholder: context.placeholder,
      value: value,
      disabled: context.disabled,
      'data-pin-input-field': '',
      'data-index': index,
      'data-complete': value !== '' ? '' : undefined,
      maxLength: 1,
      autoComplete: 'off',
      'aria-label': `PIN digit ${index + 1}`,
      onInput: handleInput,
      onKeyDown: handleKeyDown,
      onPaste: handlePaste,
      onFocus: handleFocus,
      ...rest,
    });
  };
});

// ============================================================================
// Attach sub-components
// ============================================================================

(PinInput as any).Input = PinInputInput;

// ============================================================================
// Export types
// ============================================================================

export type { PinInputContextValue };
