/**
 * Controlled State Utility
 *
 * Provides a unified way to handle controlled/uncontrolled state with Pattern 19 support.
 * Pattern 19: Components accept either `WritableSignal<T>` or `T` for controlled state.
 */

import { signal, type WritableSignal } from '../core/reactivity/index.js';

/**
 * Type guard to check if a value is a WritableSignal
 */
export function isSignal<T>(val: any): val is WritableSignal<T> {
  return typeof val === 'function' && 'set' in val;
}

/**
 * Hook to handle controlled/uncontrolled state with Pattern 19 support
 *
 * @param controlledValue - The controlled value (can be WritableSignal<T> | T | undefined)
 * @param defaultValue - Default value for uncontrolled mode
 * @param onChange - Callback when value changes
 * @returns [getter, setter] tuple for the state
 *
 * @example
 * ```typescript
 * export const Input = defineComponent<InputProps>((props) => {
 *   const [value, setValue] = useControlledState(
 *     props.value,
 *     props.defaultValue ?? '',
 *     props.onValueChange
 *   );
 *
 *   return () => jsx('input', {
 *     value: value(),
 *     onInput: (e) => setValue(e.target.value)
 *   });
 * });
 * ```
 */
export function useControlledState<T>(
  controlledValue: WritableSignal<T> | T | undefined,
  defaultValue: T,
  onChange?: (value: T) => void
): [() => T, (value: T) => void] {
  // If a signal was passed, use it directly
  if (isSignal<T>(controlledValue)) {
    const getter = (): T => controlledValue();
    const setter = (value: T): void => {
      controlledValue.set(value);
      onChange?.(value);
    };
    return [getter, setter];
  }

  // Otherwise create internal signal for uncontrolled mode
  const internalSignal = signal<T>(defaultValue);

  const getter = (): T => {
    // If controlled value is provided, use it
    if (controlledValue !== undefined) {
      return controlledValue as T;
    }
    // Otherwise use internal signal
    return internalSignal();
  };

  const setter = (value: T): void => {
    // If controlled, only fire callback (parent handles state)
    if (controlledValue !== undefined) {
      onChange?.(value);
    } else {
      // If uncontrolled, update internal state and fire callback
      internalSignal.set(value);
      onChange?.(value);
    }
  };

  return [getter, setter];
}

/**
 * Simplified version for boolean state (most common case for overlays)
 *
 * @example
 * ```typescript
 * export const Popover = defineComponent<PopoverProps>((props) => {
 *   const [isOpen, setIsOpen] = useControlledBooleanState(
 *     props.open,
 *     props.defaultOpen ?? false,
 *     props.onOpenChange
 *   );
 *
 *   return () => jsx('div', {
 *     'data-state': isOpen() ? 'open' : 'closed'
 *   });
 * });
 * ```
 */
export function useControlledBooleanState(
  controlledValue: WritableSignal<boolean> | boolean | undefined,
  defaultValue: boolean,
  onChange?: (value: boolean) => void
): [() => boolean, (value: boolean) => void] {
  return useControlledState(controlledValue, defaultValue, onChange);
}
