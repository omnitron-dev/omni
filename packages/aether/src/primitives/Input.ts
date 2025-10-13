/**
 * Input Component
 *
 * A headless input component with validation states and ARIA support.
 *
 * @example
 * ```tsx
 * <Input
 *   type="email"
 *   placeholder="Enter your email"
 *   invalid={hasError}
 *   disabled={isSubmitting}
 * />
 * ```
 */

import { jsx } from '../jsx-runtime.js';
import { defineComponent } from '../core/component/index.js';
import { useControlledState } from '../utils/controlled-state.js';
import { type WritableSignal } from '../core/reactivity/index.js';

export interface InputProps {
  /**
   * Input type
   */
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search' | 'date' | 'time' | 'datetime-local';

  /**
   * Controlled value (supports WritableSignal for reactive updates - Pattern 19)
   */
  value?: WritableSignal<string> | string;

  /**
   * Default value (uncontrolled)
   */
  defaultValue?: string;

  /**
   * Value change handler
   */
  onValueChange?: (value: string) => void;

  /**
   * Placeholder text
   */
  placeholder?: string;

  /**
   * Disabled state
   */
  disabled?: boolean;

  /**
   * Read-only state
   */
  readOnly?: boolean;

  /**
   * Required field
   */
  required?: boolean;

  /**
   * Invalid state (for validation errors)
   */
  invalid?: boolean;

  /**
   * Input name
   */
  name?: string;

  /**
   * Input ID
   */
  id?: string;

  /**
   * Autocomplete attribute
   */
  autoComplete?: string;

  /**
   * ARIA label
   */
  'aria-label'?: string;

  /**
   * ARIA labelledby
   */
  'aria-labelledby'?: string;

  /**
   * ARIA describedby
   */
  'aria-describedby'?: string;

  /**
   * ARIA invalid
   */
  'aria-invalid'?: boolean;

  /**
   * Change handler
   */
  onChange?: (value: string) => void;

  /**
   * Input handler
   */
  onInput?: (value: string) => void;

  /**
   * Blur handler
   */
  onBlur?: (event: FocusEvent) => void;

  /**
   * Focus handler
   */
  onFocus?: (event: FocusEvent) => void;

  /**
   * Additional HTML attributes
   */
  [key: string]: any;
}

/**
 * Input
 *
 * A headless input component with validation states.
 *
 * Features:
 * - Multiple input types support
 * - Validation states (invalid)
 * - Disabled and read-only states
 * - Full ARIA support
 * - Controlled and uncontrolled modes
 */
export const Input = defineComponent<InputProps>((props) => {
  const [getValue, setValue] = useControlledState(
    props.value,
    props.defaultValue ?? '',
    props.onValueChange
  );

  const handleInput = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const value = target.value;

    // Update controlled state
    setValue(value);

    // Call legacy handlers for compatibility
    props.onInput?.(value);
    props.onChange?.(value);
  };

  const handleBlur = (e: Event) => {
    props.onBlur?.(e as FocusEvent);
  };

  const handleFocus = (e: Event) => {
    props.onFocus?.(e as FocusEvent);
  };

  return () => {
    const {
      type = 'text',
      value: _value,
      defaultValue: _defaultValue,
      onValueChange: _onValueChange,
      placeholder,
      disabled,
      readOnly,
      required,
      invalid,
      name,
      id,
      autoComplete,
      onChange: _onChange,
      onInput: _onInput,
      onBlur: _onBlur,
      onFocus: _onFocus,
      ...restProps
    } = props;

    return jsx('input', {
      ...restProps,
      type,
      value: getValue(),
      placeholder,
      disabled,
      readOnly,
      required,
      name,
      id,
      autoComplete,
      'data-input': '',
      'data-disabled': disabled ? '' : undefined,
      'data-readonly': readOnly ? '' : undefined,
      'data-invalid': invalid ? '' : undefined,
      'aria-invalid': invalid ? 'true' : undefined,
      onInput: handleInput,
      onBlur: handleBlur,
      onFocus: handleFocus,
    });
  };
});

// Attach display name
Input.displayName = 'Input';
