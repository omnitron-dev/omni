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

export interface InputProps {
  /**
   * Input type
   */
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'search' | 'date' | 'time' | 'datetime-local';

  /**
   * Input value
   */
  value?: string | number;

  /**
   * Default value (uncontrolled)
   */
  defaultValue?: string | number;

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
  const handleInput = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const value = target.value;

    // Call both onInput and onChange for compatibility
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
      value,
      defaultValue,
      placeholder,
      disabled,
      readOnly,
      required,
      invalid,
      name,
      id,
      autoComplete,
      onChange,
      onInput,
      onBlur,
      onFocus,
      ...restProps
    } = props;

    return jsx('input', {
      ...restProps,
      type,
      value,
      defaultValue,
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
