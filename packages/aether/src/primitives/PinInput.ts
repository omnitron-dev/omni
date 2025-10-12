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
import { createContext, useContext, provideContext } from '../core/component/context.js';
import type { WritableSignal } from '../core/reactivity/types.js';
import { signal } from '../core/reactivity/index.js';
import { effect } from '../core/reactivity/effect.js';
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
  values: () => string[];
  /** Length of PIN */
  length: number;
  /** Input type */
  readonly type: 'numeric' | 'alphanumeric' | 'all';
  /** Mask state */
  readonly mask: boolean;
  /** Placeholder */
  readonly placeholder: string;
  /** Disabled state */
  readonly disabled: boolean;
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

// Global reactive context signal that will be updated during PinInput setup
// This allows children to access the context even if they're evaluated before the parent
// Using a SIGNAL makes the context reactive, so effects will rerun when it updates
const globalPinInputContextSignal = signal<PinInputContextValue | null>(null);

// Create context with default implementation that delegates to global signal
const emptyArray: string[] = [];

const PinInputContext = createContext<PinInputContextValue>({
  values: () => globalPinInputContextSignal()?.values?.() ?? emptyArray,
  get length() { return globalPinInputContextSignal()?.length ?? 6; },
  get type() { return globalPinInputContextSignal()?.type ?? 'numeric'; },
  get mask() { return globalPinInputContextSignal()?.mask ?? false; },
  get placeholder() { return globalPinInputContextSignal()?.placeholder ?? '○'; },
  get disabled() { return globalPinInputContextSignal()?.disabled ?? false; },
  setValue: (index, value) => globalPinInputContextSignal()?.setValue(index, value),
  focusInput: (index) => globalPinInputContextSignal()?.focusInput(index),
  registerInput: (index, element) => globalPinInputContextSignal()?.registerInput(index, element),
  unregisterInput: (index) => globalPinInputContextSignal()?.unregisterInput(index),
  handlePaste: (index, value) => globalPinInputContextSignal()?.handlePaste(index, value),
}, 'PinInput');

const usePinInputContext = (): PinInputContextValue => {
  const context = useContext(PinInputContext);

  // Note: Validation is not possible due to timing - children render before parent sets context
  // The default context delegates to globalPinInputContextSignal which is null initially
  // This is expected behavior in single-render architecture

  return context;
};

// ============================================================================
// PinInput Root
// ============================================================================

export const PinInput = defineComponent<PinInputProps>((props) => {
  // Make all props reactive signals
  const length = props.length ?? 6;
  const autoFocus = props.autoFocus ?? false;

  // State
  const internalValue: WritableSignal<string[]> = signal<string[]>(
    Array(length).fill(''),
  );

  // Working values for optimistic updates in controlled mode
  const workingValues: WritableSignal<string[] | null> = signal<string[] | null>(null);

  // Track last prop value to detect changes
  let lastPropValue: string | undefined = undefined;

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
      // Use queueMicrotask instead of setTimeout for better test compatibility
      // Microtasks run before next tick, so await nextTick() in tests will catch this
      queueMicrotask(() => focusInput(0));
    }
  });

  // currentValues now directly reads from props each time
  // In controlled mode, merges prop value with optimistic updates
  const currentValues = (): string[] => {
    // Check if prop value changed - if so, clear working values (prop update wins)
    if (props.value !== lastPropValue) {
      lastPropValue = props.value;
      workingValues.set(null);
    }

    // If we have pending changes (optimistic update), use them
    const working = workingValues();
    if (working !== null) {
      return working;
    }

    // Otherwise use prop or internal value
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
    const type = props.type ?? 'numeric';
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

    // Allow empty string for clearing, but validate non-empty values
    if (newChar && !isValidChar(newChar)) return;

    const newValues = [...currentValues()];
    newValues[index] = newChar;

    // In controlled mode, set as working values for optimistic update
    if (props.value !== undefined) {
      workingValues.set(newValues);
    }

    setValues(newValues);

    // Auto-advance to next input only if value is not empty
    if (newChar && index < length - 1) {
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

  // Create context value ONCE in setup phase
  const contextValue: PinInputContextValue = {
    // values function reads props directly each time it's called
    values: () => currentValues(),
    length,
    get type() { return props.type ?? 'numeric'; },
    get mask() { return props.mask ?? false; },
    get placeholder() { return props.placeholder ?? '○'; },
    get disabled() { return props.disabled ?? false; },
    setValue,
    focusInput,
    registerInput,
    unregisterInput,
    handlePaste,
  };

  // Set global context signal so children can access it
  globalPinInputContextSignal.set(contextValue);

  // Provide context via the standard API
  provideContext(PinInputContext, contextValue);

  return () => {
    const disabled = props.disabled ?? false;

    return jsx(PinInputContext.Provider, {
      value: contextValue,
      children: jsx('div', {
        'data-pin-input': '',
        'data-disabled': disabled ? '' : undefined,
        role: 'group',
        'aria-label': 'PIN input',
        children: props.children,
      }),
    });
  };
});

// ============================================================================
// PinInput Input
// ============================================================================

export const PinInputInput = defineComponent<PinInputInputProps>((props) => {
  const { index, ...rest } = props;
  const inputElement: WritableSignal<HTMLInputElement | null> = signal(null);

  // Access context in setup phase - will get default context that delegates to global signal
  const context = usePinInputContext();

  // Use effect to register after parent setup completes
  effect(() => {
    const element = inputElement();
    if (element) {
      // By the time effect runs, parent has set the global signal
      context.registerInput(index, element);

      // Return cleanup function
      return () => {
        context.unregisterInput(index);
      };
    }
  });

  return () => {
    // Simple ref callback - just store the element in signal
    const refCallback = (element: HTMLInputElement | null) => {
      inputElement.set(element);
    };

    const handleInput = (e: Event) => {
      const target = e.target as HTMLInputElement;
      const value = target.value;

      if (value) {
        context.setValue(index, value);
        // Note: Don't clear the input here - the effect will update it to the stored value
        // The browser handles replacing characters automatically due to maxLength=1
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Backspace') {
        e.preventDefault();
        const values = context.values();

        if (values[index]) {
          // Clear current value
          context.setValue(index, '');
        } else if (index > 0) {
          // Move to previous and clear
          context.focusInput(index - 1);
          context.setValue(index - 1, '');
        }
      } else if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault();
        context.focusInput(index - 1);
      } else if (e.key === 'ArrowRight' && index < context.length - 1) {
        e.preventDefault();
        context.focusInput(index + 1);
      } else if (e.key === 'Delete') {
        e.preventDefault();
        context.setValue(index, '');
      }
    };

    const handlePaste = (e: ClipboardEvent) => {
      e.preventDefault();
      const pastedValue = e.clipboardData?.getData('text') ?? '';
      context.handlePaste(index, pastedValue);
    };

    const handleFocus = (e: FocusEvent) => {
      const target = e.target as HTMLInputElement;
      target.select();
    };

    // Create input with initial values
    const input = jsx('input', {
      ref: refCallback,
      type: context.mask ? 'password' : 'text',
      inputMode: context.type === 'numeric' ? 'numeric' : 'text',
      pattern: context.type === 'numeric' ? '[0-9]*' : undefined,
      placeholder: context.placeholder,
      value: context.values()[index] ?? '',
      disabled: context.disabled,
      'data-pin-input-field': '',
      'data-index': index,
      'data-complete': (context.values()[index] ?? '') !== '' ? '' : undefined,
      maxLength: 1,
      autoComplete: 'off',
      'aria-label': `PIN digit ${index + 1}`,
      onInput: handleInput,
      onKeyDown: handleKeyDown,
      onPaste: handlePaste,
      onFocus: handleFocus,
      ...rest,
    }) as HTMLInputElement;

    // Set up reactive effect to update context-dependent attributes
    // CRITICAL: This ensures attributes update when parent context changes
    // Children are rendered before parent sets context, so effect handles updates
    effect(() => {
      // Update type (text vs password)
      input.type = context.mask ? 'password' : 'text';

      // Update inputMode
      input.inputMode = context.type === 'numeric' ? 'numeric' : 'text';

      // Update pattern attribute
      if (context.type === 'numeric') {
        input.setAttribute('pattern', '[0-9]*');
      } else {
        input.removeAttribute('pattern');
      }

      // Update placeholder
      input.placeholder = context.placeholder;

      // Update disabled state
      input.disabled = context.disabled;
    });

    // Separate effect for value updates - only update when context changes
    // This handles defaultValue and controlled mode updates
    effect(() => {
      const values = context.values();
      const value = values[index] ?? '';

      // Update visual value
      input.value = value;

      // Update data-complete attribute
      if (value !== '') {
        input.setAttribute('data-complete', '');
      } else {
        input.removeAttribute('data-complete');
      }
    });

    return input;
  };
});

// ============================================================================
// Attach sub-components
// ============================================================================

(PinInput as any).Input = PinInputInput;

// ============================================================================
// Export types and test utilities
// ============================================================================

export type { PinInputContextValue };

// Export for test cleanup
export { globalPinInputContextSignal as __resetGlobalContext__ };
