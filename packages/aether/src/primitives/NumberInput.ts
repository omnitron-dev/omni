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
// Context
// ============================================================================

const NumberInputContext = createContext<NumberInputContextValue | null>(null);

const useNumberInputContext = (): NumberInputContextValue => {
  const context = useContext(NumberInputContext);
  if (!context) {
    throw new Error('NumberInput components must be used within a NumberInput');
  }
  return context;
};

// ============================================================================
// Helper Functions
// ============================================================================

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

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

  // State
  const internalValue: WritableSignal<number> = signal<number>(
    props.defaultValue ?? 0,
  );

  const inputRef: { current: HTMLInputElement | null } = { current: null };

  const currentValue = (): number => {
    if (props.value !== undefined) {
      return props.value;
    }
    return internalValue();
  };

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
    setValue(current + step);
  };

  const decrement = () => {
    if (disabled || readonly) return;
    const current = currentValue();
    setValue(current - step);
  };

  const canIncrement = (): boolean => {
    return !disabled && !readonly && currentValue() + step <= max;
  };

  const canDecrement = (): boolean => {
    return !disabled && !readonly && currentValue() - step >= min;
  };

  const formatValue = (value: number): string => {
    switch (format) {
      case 'currency':
        return `$${value.toFixed(precision)}`;
      case 'percentage':
        return `${value.toFixed(precision)}%`;
      case 'decimal':
      default:
        return value.toFixed(precision);
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

export const NumberInputField = defineComponent<NumberInputFieldProps>((props) => {
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

  return () => {
    const { ...rest } = props;

    return jsx('input', {
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
    });
  };
});

// ============================================================================
// NumberInput Increment
// ============================================================================

export const NumberInputIncrement = defineComponent<NumberInputIncrementProps>((props) => {
  const context = useNumberInputContext();

  const handleClick = () => {
    context.increment();
  };

  return () => {
    const { children = '▲', ...rest } = props;

    return jsx('button', {
      type: 'button',
      'data-number-input-increment': '',
      onClick: handleClick,
      disabled: context.disabled || context.readonly || !context.canIncrement(),
      'aria-label': 'Increment',
      ...rest,
      children,
    });
  };
});

// ============================================================================
// NumberInput Decrement
// ============================================================================

export const NumberInputDecrement = defineComponent<NumberInputDecrementProps>((props) => {
  const context = useNumberInputContext();

  const handleClick = () => {
    context.decrement();
  };

  return () => {
    const { children = '▼', ...rest } = props;

    return jsx('button', {
      type: 'button',
      'data-number-input-decrement': '',
      onClick: handleClick,
      disabled: context.disabled || context.readonly || !context.canDecrement(),
      'aria-label': 'Decrement',
      ...rest,
      children,
    });
  };
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
