/**
 * NumberInput - Numeric input with increment/decrement controls
 *
 * Features:
 * - Increment and decrement buttons
 * - Keyboard support (arrows, Page Up/Down, Home/End)
 * - Min/max constraints
 * - Step increments
 * - Precision control
 * - Format options (decimal, currency, percentage)
 * - Mouse wheel support
 * - Controlled and uncontrolled modes
 * - ARIA support for accessibility
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext } from '../core/component/context.js';
import type { Signal, WritableSignal } from '../core/reactivity/types.js';
import { signal, computed } from '../core/reactivity/index.js';
import { effect } from '../core/reactivity/effect.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface NumberInputProps {
  /** Controlled value */
  value?: number;
  /** Value change callback */
  onValueChange?: (value: number) => void;
  /** Default value (uncontrolled) */
  defaultValue?: number;
  /** Minimum value */
  min?: number;
  /** Maximum value */
  max?: number;
  /** Step increment */
  step?: number;
  /** Precision (decimal places) */
  precision?: number;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Whether the input is readonly */
  readonly?: boolean;
  /** Whether to allow mouse wheel */
  allowMouseWheel?: boolean;
  /** Whether to clamp value on blur */
  clampValueOnBlur?: boolean;
  /** Whether to keep value within bounds */
  keepWithinRange?: boolean;
  /** Format pattern (e.g., '$0.00' for currency) */
  format?: 'decimal' | 'currency' | 'percentage';
  /** Children */
  children?: any;
}

export interface NumberInputFieldProps {
  /** Additional props */
  [key: string]: any;
}

export interface NumberInputIncrementProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface NumberInputDecrementProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

interface NumberInputContextValue {
  /** Current value */
  value: Signal<number>;
  /** Increment value */
  increment: () => void;
  /** Decrement value */
  decrement: () => void;
  /** Set value */
  setValue: (value: number) => void;
  /** Min value */
  min: number;
  /** Max value */
  max: number;
  /** Step */
  step: number;
  /** Disabled state */
  disabled: boolean;
  /** Readonly state */
  readonly: boolean;
  /** Can increment */
  canIncrement: () => boolean;
  /** Can decrement */
  canDecrement: () => boolean;
  /** Format value for display */
  formatValue: (value: number) => string;
  /** Parse display string to number */
  parseValue: (str: string) => number;
  /** Input ref */
  inputRef: { current: HTMLInputElement | null };
}

// ============================================================================
// Global Signal Context
// ============================================================================

// Global reactive context signal that will be updated during NumberInput setup
// This allows children to access the context even if they're evaluated before the parent
// Using a SIGNAL makes the context reactive, so effects will rerun when it updates
const globalNumberInputContextSignal = signal<NumberInputContextValue | null>(null);

/**
 * Reset the global NumberInput context signal (for testing)
 * @internal
 */
export function __resetNumberInputContext() {
  globalNumberInputContextSignal.set(null);
}

// ============================================================================
// Context
// ============================================================================

// Create context with default implementation that delegates to global signal using getters
// This pattern ensures children can access context even if they're evaluated before parent setup
// EXACTLY matching RangeSlider pattern - all properties use getters that delegate to global signal
const NumberInputContext = createContext<NumberInputContextValue>(
  {
    // Use computed() for reactive value that delegates to global signal
    // Using same syntax as RangeSlider: ?.value() not ?.value?.()
    value: computed(() => globalNumberInputContextSignal()?.value() ?? 0),
    // Use arrow functions that delegate to global signal methods
    increment: () => globalNumberInputContextSignal()?.increment(),
    decrement: () => globalNumberInputContextSignal()?.decrement(),
    setValue: (value) => globalNumberInputContextSignal()?.setValue(value),
    // Use getters for all properties to delegate to global signal
    get min() {
      return globalNumberInputContextSignal()?.min ?? -Infinity;
    },
    get max() {
      return globalNumberInputContextSignal()?.max ?? Infinity;
    },
    get step() {
      return globalNumberInputContextSignal()?.step ?? 1;
    },
    get disabled() {
      return globalNumberInputContextSignal()?.disabled ?? false;
    },
    get readonly() {
      return globalNumberInputContextSignal()?.readonly ?? false;
    },
    canIncrement: () => globalNumberInputContextSignal()?.canIncrement() ?? false,
    canDecrement: () => globalNumberInputContextSignal()?.canDecrement() ?? false,
    formatValue: (value) => globalNumberInputContextSignal()?.formatValue(value) ?? String(value),
    parseValue: (str) => globalNumberInputContextSignal()?.parseValue(str) ?? 0,
    get inputRef() {
      return globalNumberInputContextSignal()?.inputRef ?? { current: null };
    },
  },
  'NumberInput'
);

const useNumberInputContext = (): NumberInputContextValue =>
  // Simply return the context - it delegates to global signal via getters
  useContext(NumberInputContext);
// ============================================================================
// Helper Functions
// ============================================================================

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const roundToPrecision = (value: number, precision: number): number => {
  const multiplier = Math.pow(10, precision);
  return Math.round(value * multiplier) / multiplier;
};

// ============================================================================
// NumberInput Root
// ============================================================================

export const NumberInput = defineComponent<NumberInputProps>((props) => {
  const min = props.min ?? -Infinity;
  const max = props.max ?? Infinity;
  const step = props.step ?? 1;
  const precision = props.precision ?? 0;
  const disabled = props.disabled ?? false;
  const readonly = props.readonly ?? false;
  const keepWithinRange = props.keepWithinRange ?? true;
  const format = props.format ?? 'decimal';

  // Calculate initial value with proper clamping and precision
  const calculateInitialValue = (): number => {
    const rawValue =
      props.value !== undefined
        ? typeof props.value === 'function'
          ? (props.value as any)()
          : props.value
        : (props.defaultValue ?? 0);

    let value = roundToPrecision(rawValue, precision);
    if (keepWithinRange) {
      value = clamp(value, min, max);
    }
    return value;
  };

  // State - always use internal signal for reactivity
  const internalValue: WritableSignal<number> = signal<number>(calculateInitialValue());

  // Sync external controlled signal to internal state (Pattern 8)
  if (props.value !== undefined && typeof props.value === 'function') {
    effect(() => {
      let newValue = (props.value as any)();
      newValue = roundToPrecision(newValue, precision);
      if (keepWithinRange) {
        newValue = clamp(newValue, min, max);
      }
      internalValue.set(newValue);
    });
  }

  const inputRef: { current: HTMLInputElement | null } = { current: null };

  // Always use internal signal for consistency
  const currentValue = (): number => internalValue();

  const setValue = (newValue: number) => {
    let finalValue = roundToPrecision(newValue, precision);

    if (keepWithinRange) {
      finalValue = clamp(finalValue, min, max);
    }

    if (props.value === undefined) {
      internalValue.set(finalValue);
    }
    props.onValueChange?.(finalValue);
  };

  const increment = () => {
    if (disabled || readonly) return;
    const current = currentValue();
    const newValue = current + step;
    // Clamp to max if we would exceed it
    setValue(newValue > max ? max : newValue);
  };

  const decrement = () => {
    if (disabled || readonly) return;
    const current = currentValue();
    const newValue = current - step;
    // Clamp to min if we would go below it
    setValue(newValue < min ? min : newValue);
  };

  const canIncrement = (): boolean => {
    if (disabled || readonly) return false;
    const current = currentValue();
    // Can increment if current value is strictly less than max
    return current < max;
  };

  const canDecrement = (): boolean => {
    if (disabled || readonly) return false;
    const current = currentValue();
    // Can decrement if current value is strictly greater than min
    return current > min;
  };

  const formatValue = (value: number): string => {
    // Format the number based on precision
    const formattedNumber = precision === 0 ? String(Math.round(value)) : value.toFixed(precision);

    switch (format) {
      case 'currency':
        return `$${formattedNumber}`;
      case 'percentage':
        return `${formattedNumber}%`;
      case 'decimal':
      default:
        return formattedNumber;
    }
  };

  const parseValue = (str: string): number => {
    // Remove formatting characters
    const cleaned = str.replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  };

  const contextValue: NumberInputContextValue = {
    value: computed(() => currentValue()),
    increment,
    decrement,
    setValue,
    min,
    max,
    step,
    disabled,
    readonly,
    canIncrement,
    canDecrement,
    formatValue,
    parseValue,
    inputRef,
  };

  // CRITICAL FIX: Set global context signal IMMEDIATELY so children can access it
  // This ensures context is available even if children are evaluated before parent renders
  globalNumberInputContextSignal.set(contextValue);

  // Provide context via Provider during render
  return () =>
    jsx(NumberInputContext.Provider, {
      value: contextValue,
      children: jsx('div', {
        'data-number-input': '',
        'data-disabled': disabled ? '' : undefined,
        'data-readonly': readonly ? '' : undefined,
        role: 'group',
        children: props.children,
      }),
    });
});

// ============================================================================
// NumberInput Field
// ============================================================================

export const NumberInputField = defineComponent<NumberInputFieldProps>((props) => () => {
  // Access context in render phase
  const context = useNumberInputContext();

  const handleInput = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const value = context.parseValue(target.value);
    context.setValue(value);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (context.disabled || context.readonly) return;

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        context.increment();
        break;
      case 'ArrowDown':
        e.preventDefault();
        context.decrement();
        break;
      case 'PageUp':
        e.preventDefault();
        context.setValue(context.value() + context.step * 10);
        break;
      case 'PageDown':
        e.preventDefault();
        context.setValue(context.value() - context.step * 10);
        break;
      case 'Home':
        e.preventDefault();
        context.setValue(context.min);
        break;
      case 'End':
        e.preventDefault();
        context.setValue(context.max);
        break;
    }
  };

  const handleWheel = (e: WheelEvent) => {
    const parentProps = (context as any).props;
    const allowMouseWheel = parentProps?.allowMouseWheel ?? false;

    if (!allowMouseWheel || context.disabled || context.readonly) return;

    e.preventDefault();
    if (e.deltaY < 0) {
      context.increment();
    } else {
      context.decrement();
    }
  };

  const handleBlur = () => {
    const parentProps = (context as any).props;
    const clampValueOnBlur = parentProps?.clampValueOnBlur ?? true;

    if (clampValueOnBlur) {
      const value = context.value();
      if (value < context.min) {
        context.setValue(context.min);
      } else if (value > context.max) {
        context.setValue(context.max);
      }
    }
  };

  const { ...rest } = props;

  // Create input with initial values
  const input = jsx('input', {
    ref: context.inputRef,
    type: 'text',
    inputMode: 'numeric',
    'data-number-input-field': '',
    value: context.formatValue(context.value()),
    disabled: context.disabled,
    readOnly: context.readonly,
    'aria-valuemin': context.min,
    'aria-valuemax': context.max,
    'aria-valuenow': context.value(),
    onInput: handleInput,
    onKeyDown: handleKeyDown,
    onWheel: handleWheel,
    onBlur: handleBlur,
    ...rest,
  }) as HTMLInputElement;

  // Set up reactive effect to update all context-dependent attributes
  // CRITICAL: This ensures attributes update when parent context changes
  // Children are rendered before parent sets context, so effect handles updates
  effect(() => {
    const currentValue = context.value();
    input.value = context.formatValue(currentValue);
    input.disabled = context.disabled;
    input.readOnly = context.readonly;
    input.setAttribute('aria-valuemin', String(context.min));
    input.setAttribute('aria-valuemax', String(context.max));
    input.setAttribute('aria-valuenow', String(currentValue));
  });

  return input;
});

// ============================================================================
// NumberInput Increment
// ============================================================================

export const NumberInputIncrement = defineComponent<NumberInputIncrementProps>((props) => () => {
  // Access context in render phase
  const context = useNumberInputContext();

  const handleClick = () => {
    context.increment();
  };

  const { children = '▲', ...rest } = props;

  // Create button with initial state
  const button = jsx('button', {
    type: 'button',
    'data-number-input-increment': '',
    onClick: handleClick,
    disabled: context.disabled || context.readonly || !context.canIncrement(),
    'aria-label': 'Increment',
    ...rest,
    children,
  }) as HTMLButtonElement;

  // Set up reactive effect to update disabled state
  effect(() => {
    button.disabled = context.disabled || context.readonly || !context.canIncrement();
  });

  return button;
});

// ============================================================================
// NumberInput Decrement
// ============================================================================

export const NumberInputDecrement = defineComponent<NumberInputDecrementProps>((props) => () => {
  // Access context in render phase
  const context = useNumberInputContext();

  const handleClick = () => {
    context.decrement();
  };

  const { children = '▼', ...rest } = props;

  // Create button with initial state
  const button = jsx('button', {
    type: 'button',
    'data-number-input-decrement': '',
    onClick: handleClick,
    disabled: context.disabled || context.readonly || !context.canDecrement(),
    'aria-label': 'Decrement',
    ...rest,
    children,
  }) as HTMLButtonElement;

  // Set up reactive effect to update disabled state
  effect(() => {
    button.disabled = context.disabled || context.readonly || !context.canDecrement();
  });

  return button;
});

// ============================================================================
// Attach sub-components
// ============================================================================

(NumberInput as any).Field = NumberInputField;
(NumberInput as any).Increment = NumberInputIncrement;
(NumberInput as any).Decrement = NumberInputDecrement;

// ============================================================================
// Export types
// ============================================================================

export type { NumberInputContextValue };
