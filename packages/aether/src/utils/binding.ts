/**
 * Binding Utilities
 *
 * Two-way binding helpers for form elements, providing concise syntax
 * similar to directives but using standard TypeScript JSX
 */

import type { WritableSignal } from '../core/reactivity/signal.js';

/**
 * Input element binding props
 */
export interface InputBinding {
  value: string | number;
  onInput: (e: Event) => void;
}

/**
 * Checkbox binding props
 */
export interface CheckboxBinding {
  checked: boolean;
  onChange: (e: Event) => void;
}

/**
 * Create two-way binding props for text input
 *
 * @param signal - WritableSignal to bind to
 * @param transform - Optional transform function for the input value
 * @returns Props object with value and onInput handler
 *
 * @example
 * ```typescript
 * const text = signal('');
 * <input {...bindValue(text)} />
 *
 * // With transformation
 * <input {...bindValue(text, (v) => v.toUpperCase())} />
 * ```
 */
export function bindValue<T>(signal: WritableSignal<T>, transform?: (value: string) => T): InputBinding {
  return {
    value: signal() as string | number,
    onInput: (e: Event) => {
      const target = e.currentTarget as HTMLInputElement | HTMLTextAreaElement;
      const value = target.value;
      signal.set(transform ? transform(value) : (value as unknown as T));
    },
  };
}

/**
 * Create two-way binding props for number input
 *
 * Automatically converts string input to number
 *
 * @param signal - WritableSignal<number> to bind to
 * @returns Props object with value and onInput handler
 *
 * @example
 * ```typescript
 * const age = signal(0);
 * <input type="number" {...bindNumber(age)} />
 * ```
 */
export function bindNumber(signal: WritableSignal<number>): InputBinding {
  return {
    value: signal(),
    onInput: (e: Event) => {
      const target = e.currentTarget as HTMLInputElement;
      const value = target.value;
      const num = Number(value);
      if (!isNaN(num)) {
        signal.set(num);
      }
    },
  };
}

/**
 * Create two-way binding props for trimmed text input
 *
 * Automatically trims whitespace from input
 *
 * @param signal - WritableSignal<string> to bind to
 * @returns Props object with value and onInput handler
 *
 * @example
 * ```typescript
 * const name = signal('');
 * <input {...bindTrimmed(name)} />
 * ```
 */
export function bindTrimmed(signal: WritableSignal<string>): InputBinding {
  return {
    value: signal(),
    onInput: (e: Event) => {
      const target = e.currentTarget as HTMLInputElement | HTMLTextAreaElement;
      signal.set(target.value.trim());
    },
  };
}

/**
 * Create debounced two-way binding props
 *
 * Updates signal only after user stops typing for specified delay
 *
 * @param signal - WritableSignal to bind to
 * @param delay - Debounce delay in milliseconds
 * @param transform - Optional transform function
 * @returns Props object with value and onInput handler
 *
 * @example
 * ```typescript
 * const search = signal('');
 * <input {...bindDebounced(search, 500)} />
 * ```
 */
export function bindDebounced<T>(
  signal: WritableSignal<T>,
  delay: number,
  transform?: (value: string) => T
): InputBinding {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let currentValue = signal() as string | number;

  return {
    get value() {
      return currentValue;
    },
    set value(v: string | number) {
      currentValue = v;
    },
    onInput: (e: Event) => {
      const target = e.currentTarget as HTMLInputElement | HTMLTextAreaElement;
      const value = target.value;
      currentValue = value as string | number;

      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(() => {
        signal.set(transform ? transform(value) : (value as unknown as T));
        timeoutId = null;
      }, delay);
    },
  };
}

/**
 * Create throttled two-way binding props
 *
 * Updates signal at most once per specified interval
 *
 * @param signal - WritableSignal to bind to
 * @param limit - Throttle limit in milliseconds
 * @param transform - Optional transform function
 * @returns Props object with value and onInput handler
 *
 * @example
 * ```typescript
 * const value = signal('');
 * <input {...bindThrottled(value, 300)} />
 * ```
 */
export function bindThrottled<T>(
  signal: WritableSignal<T>,
  limit: number,
  transform?: (value: string) => T
): InputBinding {
  let inThrottle = false;
  let currentValue = signal() as string | number;

  return {
    get value() {
      return currentValue;
    },
    set value(v: string | number) {
      currentValue = v;
    },
    onInput: (e: Event) => {
      const target = e.currentTarget as HTMLInputElement | HTMLTextAreaElement;
      const value = target.value;
      currentValue = value as string | number;

      if (!inThrottle) {
        signal.set(transform ? transform(value) : (value as unknown as T));
        inThrottle = true;
        setTimeout(() => {
          inThrottle = false;
        }, limit);
      }
    },
  };
}

/**
 * Create lazy two-way binding props
 *
 * Updates signal on blur instead of on input
 *
 * @param signal - WritableSignal to bind to
 * @param transform - Optional transform function
 * @returns Props object with value and onBlur handler
 *
 * @example
 * ```typescript
 * const name = signal('');
 * <input {...bindLazy(name)} />
 * ```
 */
export function bindLazy<T>(
  signal: WritableSignal<T>,
  transform?: (value: string) => T
): { value: string | number; onBlur: (e: Event) => void } {
  return {
    value: signal() as string | number,
    onBlur: (e: Event) => {
      const target = e.currentTarget as HTMLInputElement | HTMLTextAreaElement;
      const value = target.value;
      signal.set(transform ? transform(value) : (value as unknown as T));
    },
  };
}

/**
 * Create two-way binding props for checkbox
 *
 * @param signal - WritableSignal<boolean> to bind to
 * @returns Props object with checked and onChange handler
 *
 * @example
 * ```typescript
 * const agreed = signal(false);
 * <input type="checkbox" {...bindChecked(agreed)} />
 * ```
 */
export function bindChecked(signal: WritableSignal<boolean>): CheckboxBinding {
  return {
    checked: signal(),
    onChange: (e: Event) => {
      const target = e.currentTarget as HTMLInputElement;
      signal.set(target.checked);
    },
  };
}

/**
 * Create two-way binding props for radio group
 *
 * @param signal - WritableSignal to bind to
 * @param value - Value for this radio button
 * @returns Props object with checked and onChange handler
 *
 * @example
 * ```typescript
 * const selected = signal('option1');
 *
 * <input
 *   type="radio"
 *   value="option1"
 *   {...bindGroup(selected, 'option1')}
 * />
 * <input
 *   type="radio"
 *   value="option2"
 *   {...bindGroup(selected, 'option2')}
 * />
 * ```
 */
export function bindGroup<T>(signal: WritableSignal<T>, value: T): CheckboxBinding {
  return {
    checked: signal() === value,
    onChange: (e: Event) => {
      const target = e.currentTarget as HTMLInputElement;
      if (target.checked) {
        signal.set(value);
      }
    },
  };
}

/**
 * Create two-way binding props for select element
 *
 * @param signal - WritableSignal to bind to
 * @param transform - Optional transform function
 * @returns Props object with value and onChange handler
 *
 * @example
 * ```typescript
 * const selection = signal('option1');
 *
 * <select {...bindSelect(selection)}>
 *   <option value="option1">Option 1</option>
 *   <option value="option2">Option 2</option>
 * </select>
 * ```
 */
export function bindSelect<T>(
  signal: WritableSignal<T>,
  transform?: (value: string) => T
): { value: string | number; onChange: (e: Event) => void } {
  return {
    value: signal() as string | number,
    onChange: (e: Event) => {
      const target = e.currentTarget as HTMLSelectElement;
      const value = target.value;
      signal.set(transform ? transform(value) : (value as unknown as T));
    },
  };
}

/**
 * Compose multiple binding modifiers
 *
 * @param base - Base binding function
 * @param modifiers - Additional modifiers to apply
 * @returns Composed binding function
 *
 * @example
 * ```typescript
 * const trimmedNumber = composeBinding(
 *   bindValue,
 *   [(v) => v.trim(), Number]
 * );
 *
 * const value = signal(0);
 * <input {...trimmedNumber(value)} />
 * ```
 */
export function composeBinding<T>(
  base: (signal: WritableSignal<T>) => InputBinding,
  modifiers: Array<(value: string) => unknown>
): (signal: WritableSignal<T>) => InputBinding {
  return (signal: WritableSignal<T>) => {
    const binding = base(signal);

    return {
      ...binding,
      onInput: (e: Event) => {
        const target = e.currentTarget as HTMLInputElement | HTMLTextAreaElement;
        let value: unknown = target.value;

        // Apply modifiers in sequence
        for (const modifier of modifiers) {
          value = modifier(value as string);
        }

        signal.set(value as T);
      },
    };
  };
}
